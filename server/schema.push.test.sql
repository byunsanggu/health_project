-- 알림 예약이 실제로 막을 것을 막는가.
--
-- postgres 역할은 BYPASSRLS라서 그대로 시험하면 정책이 늘 통과한다.
-- app_user로 돌린다.
--
--   psql -h /tmp -p 5433 -U app_user -d postgres -f server/schema.push.test.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned

set session "test.uid" = '11111111-1111-1111-1111-111111111111';

-- ── 예약
select public.queue_nudge(
  '{"endpoint":"https://push.example/aaa","p256dh":"pk","auth":"ak"}'::jsonb,
  now() + interval '5 hours', '한 번만 더', '오늘 나오시면 9주 연속입니다.');

select '[예약] 줄이 생겼나 → ' || count(*) || '줄' from public.push_queue;
select '[예약] 보낼 말 → ' || title || ' · ' || body from public.push_queue;

-- ── 같은 기기면 덮어쓴다 (쌓이지 않는다)
select public.queue_nudge(
  '{"endpoint":"https://push.example/aaa","p256dh":"pk2","auth":"ak2"}'::jsonb,
  now() + interval '6 hours', '이번 주 2번이 남았습니다', '4일 안에 2번입니다.');

select '[덮어쓰기] 줄 수 → ' || count(*) || '줄 (1이어야 함)' from public.push_queue;
select '[덮어쓰기] 바뀐 말 → ' || title from public.push_queue;

-- ── 기기가 둘이면 둘 다 받는다
select public.queue_nudge(
  '{"endpoint":"https://push.example/bbb","p256dh":"pk","auth":"ak"}'::jsonb,
  now() + interval '6 hours', '한 번만 더', '태블릿에서도 받습니다.');
select '[두 기기] 줄 수 → ' || count(*) || '줄 (2여야 함)' from public.push_queue;

-- ── 과거로는 예약되지 않는다
--   시계가 틀어진 기기가 어제로 적어 두면 다음 보내기에서 즉시 울린다 — 한밤중에.
select public.queue_nudge(
  '{"endpoint":"https://push.example/ccc","p256dh":"pk","auth":"ak"}'::jsonb,
  now() - interval '1 hour', '과거', '울리면 안 된다');
select '[시계] 과거 예약이 들어갔나 → ' ||
  case when not exists (select 1 from public.push_queue where endpoint like '%ccc')
    then '안 들어감 ✓' else '들어감 ✗' end;

-- ── 취소하면 사라진다 (운동하고 나왔는데 부르면 안 된다)
select public.cancel_nudge();
select '[취소] 남은 줄 → ' || count(*) || '줄 (0이어야 함)' from public.push_queue;

-- ── 남의 예약은 못 건드린다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.queue_nudge(
  '{"endpoint":"https://push.example/mine","p256dh":"pk","auth":"ak"}'::jsonb,
  now() + interval '5 hours', '내 것', '내 알림');

set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[RLS] 남의 예약이 보이나 → ' ||
  case when not exists (select 1 from public.push_queue) then '안 보임 ✓' else '보임 ✗' end;

do $$
declare changed integer;
begin
  update public.push_queue set body = '가로챈 말'
    where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics changed = row_count;
  raise notice '[RLS] 남의 알림 바꾸기 → %줄 바뀜 (0이어야 함)', changed;

  delete from public.push_queue
    where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics changed = row_count;
  raise notice '[RLS] 남의 알림 지우기 → %줄 지움 (0이어야 함)', changed;
end
$$;

do $$
begin
  begin
    insert into public.push_queue (user_id, endpoint, p256dh, auth_key, send_at, title, body)
    values ('11111111-1111-1111-1111-111111111111', 'x', 'p', 'a', now() + interval '1 hour', 't', 'b');
    raise notice '[RLS] 남의 id로 예약 넣기 → ✗ 뚫림';
  exception when insufficient_privilege or others then
    raise notice '[RLS] 남의 id로 예약 넣기 → 막힘 ✓';
  end;
end
$$;

-- ── 취소는 내 것만 지운다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select public.cancel_nudge();
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select '[취소] 남의 취소에 내 것이 지워졌나 → ' ||
  case when exists (select 1 from public.push_queue) then '안 지워짐 ✓' else '지워짐 ✗' end;

-- ── 표에 건강 정보가 없다
select '[민감정보] 열 이름 → ' || string_agg(column_name, ', ' order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'push_queue';
