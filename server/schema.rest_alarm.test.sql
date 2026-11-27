-- 휴식 끝 알림(rest_alarm)이 실제로 막을 것을 막는가.
--
-- postgres 역할은 BYPASSRLS라서 그대로 시험하면 정책이 늘 통과한다.
-- app_user로 돌리고, 넣는 쪽(rest-alarm 함수)은 잠깐 service_role이 되어 흉내 낸다.
--
--   psql -h /tmp -p 5433 -U app_user -d postgres -f server/schema.rest_alarm.test.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned

-- 지난 실행에서 남은 줄 (두 번 돌려도 같은 결과가 나오게)
set role service_role;
delete from public.rest_alarm;
reset role;

-- ── 사람은 직접 못 넣는다 — 넣는 것은 함수만
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
do $$
begin
  begin
    insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
    values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/x', 'p', 'a',
            gen_random_uuid(), now() + interval '90 seconds');
    raise notice '[정책] 내 id로 직접 넣기 → ✗ 들어감 (함수만 넣어야 함)';
  exception when insufficient_privilege or others then
    raise notice '[정책] 내 id로 직접 넣기 → 막힘 ✓';
  end;
end
$$;

-- ── 함수가 넣는다 (service_role)
set role service_role;
insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at) values
  ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/a1', 'p', 'a',
   'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '90 seconds'),
  ('22222222-2222-2222-2222-222222222222', 'https://web.push.apple.com/b1', 'p', 'a',
   'bbbbbbbb-0000-4000-8000-000000000001', now() + interval '90 seconds');

-- 같은 기기는 덮어쓴다 — 휴식마다 쌓이지 않는다
insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/a1', 'p', 'a',
        'aaaaaaaa-0000-4000-8000-000000000002', now() + interval '120 seconds')
on conflict (user_id, endpoint) do update
  set alarm_id = excluded.alarm_id, send_at = excluded.send_at, created_at = now();
reset role;

select '[덮어쓰기] 내 줄 수 → ' || count(*) || '줄 (1이어야 함) · 알람 번호 ' ||
  case when bool_and(alarm_id = 'aaaaaaaa-0000-4000-8000-000000000002') then '새 것 ✓' else '옛것 ✗' end
from public.rest_alarm;

-- ── 남의 알람은 안 보이고 못 지운다
select '[RLS] 보이는 줄 → ' || count(*) || '줄 (내 것 1줄이어야 함)' from public.rest_alarm;

do $$
declare changed integer;
begin
  delete from public.rest_alarm where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics changed = row_count;
  raise notice '[RLS] 남의 알람 지우기 → %줄 지움 (0이어야 함)', changed;

  update public.rest_alarm set send_at = now() + interval '1 second'
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics changed = row_count;
  raise notice '[RLS] 남의 알람 시각 바꾸기 → %줄 바뀜 (0이어야 함)', changed;

  update public.rest_alarm set send_at = now() + interval '1 second';
  get diagnostics changed = row_count;
  raise notice '[정책] 내 알람 시각 바꾸기 → %줄 바뀜 (0이어야 함 — 바꾸는 것도 함수만)', changed;
end
$$;

-- ── 지난 알람 번호로 취소하면 지금 알람은 남는다
select public.cancel_rest_alarm('aaaaaaaa-0000-4000-8000-000000000001');
select '[취소] 지난 번호로 취소 → 남은 줄 ' || count(*) || '줄 (1이어야 함)' from public.rest_alarm;

-- ── 지금 번호로 취소하면 사라진다 (화면으로 돌아왔다)
select public.cancel_rest_alarm('aaaaaaaa-0000-4000-8000-000000000002');
select '[취소] 지금 번호로 취소 → 남은 줄 ' || count(*) || '줄 (0이어야 함)' from public.rest_alarm;

-- ── 남의 취소에 내 것이 지워지지 않는다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[취소] 남의 알람은 그대로 → ' ||
  case when exists (select 1 from public.rest_alarm) then '남아 있음 ✓' else '지워짐 ✗' end;
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.cancel_rest_alarm();
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[취소] 남이 "전부 취소"해도 → ' ||
  case when exists (select 1 from public.rest_alarm) then '남아 있음 ✓' else '지워짐 ✗' end;
select public.cancel_rest_alarm();
select '[취소] 내 것 전부 취소 → 남은 줄 ' || count(*) || '줄 (0이어야 함)' from public.rest_alarm;

-- ── 16분보다 먼 알람은 표가 받지 않는다
set role service_role;
do $$
begin
  begin
    insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
    values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/far', 'p', 'a',
            gen_random_uuid(), now() + interval '1 hour');
    raise notice '[시각] 한 시간 뒤 알람 → ✗ 들어감';
  exception when check_violation then
    raise notice '[시각] 한 시간 뒤 알람 → 막힘 ✓';
  end;
end
$$;

-- ── 한 사람이 동시에 걸 수 있는 것은 기기 셋까지
do $$
declare n integer;
begin
  for n in 1..3 loop
    insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
    values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/dev' || n, 'p', 'a',
            gen_random_uuid(), now() + interval '60 seconds');
  end loop;
  begin
    insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
    values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/dev4', 'p', 'a',
            gen_random_uuid(), now() + interval '60 seconds');
    raise notice '[개수] 넷째 기기 → ✗ 들어감';
  exception when check_violation then
    raise notice '[개수] 넷째 기기 → 막힘 ✓';
  end;
  -- 이미 걸린 기기를 다시 거는 것(덮어쓰기)은 된다
  insert into public.rest_alarm (user_id, endpoint, p256dh, auth_key, alarm_id, send_at)
  values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/dev1', 'p', 'a',
          gen_random_uuid(), now() + interval '90 seconds')
  on conflict (user_id, endpoint) do update set alarm_id = excluded.alarm_id, send_at = excluded.send_at;
  raise notice '[개수] 걸린 기기 다시 걸기 → 됨 ✓';
end
$$;
delete from public.rest_alarm;
reset role;

-- ── 표에 건강 정보도 문장도 없다
select '[민감정보] 열 이름 → ' || string_agg(column_name, ', ' order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'rest_alarm';
