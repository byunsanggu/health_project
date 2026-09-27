-- 헬스장 공유가 실제로 막을 것을 막는가.
--
-- postgres 역할은 BYPASSRLS라서 그대로 시험하면 정책이 늘 통과한다 —
-- 그러면 아무것도 확인하지 못한 것이다. app_user로 돌린다.
--
--   psql -h /tmp -p 5433 -U app_user -d postgres -f server/schema.gyms.test.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned

-- ── 가: 헬스장 하나와 기구 확인을 올린다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';

select '[가] 헬스장 올리기 → 기구 ' || public.share_gym(
  '{"id":"gym-test-1","name":"바우짐","address":"경기 수원시 장안구 경수대로 910","floor":3,"lat":37.3,"lng":127.01}'::jsonb,
  '[{"id":"barbell-set","present":true},{"id":"leg-press-machine","present":true},{"id":"hack-squat-machine","present":false}]'::jsonb
) || '개';

-- ── 나: 같은 헬스장에 다른 답을 올린다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[나] 같은 헬스장에 기구 ' || public.share_gym(
  '{"id":"gym-test-1","name":"바우짐(다르게 적음)","address":"","lat":37.3,"lng":127.01}'::jsonb,
  '[{"id":"barbell-set","present":true},{"id":"hack-squat-machine","present":true}]'::jsonb
) || '개';

-- 나중 사람이 이름을 덮어쓰면 남의 화면에서 이름이 멋대로 바뀐다
select '[확인] 이름이 안 바뀌었나 → ' || name from public.gyms where id = 'gym-test-1';

-- ── 세는 규칙: 애매하면 없는 쪽
--   barbell-set        있음 2 · 없음 0  → 있음
--   leg-press-machine  있음 1 · 없음 0  → 있음
--   hack-squat-machine 있음 1 · 없음 1  → **없음** (같으면 없는 쪽)
select '[기구] ' || equipment_id || ' · ' || confirmations || '명 확인'
from public.gym_equipment_ids('gym-test-1') order by equipment_id;

select '[기구] 핵스쿼트가 목록에 없나 → ' ||
  case when not exists (
    select 1 from public.gym_equipment_ids('gym-test-1') where equipment_id = 'hack-squat-machine'
  ) then '없음 ✓ (애매하면 없는 쪽)' else '있음 ✗' end;

select '[사람] 이 헬스장 쓰는 사람 → ' || public.gym_people('gym-test-1') || '명';

-- ── 남의 확인 기록은 못 건드린다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
do $$
declare changed integer;
begin
  update public.gym_equipment
    set present = false
    where gym_id = 'gym-test-1' and user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics changed = row_count;
  raise notice '[RLS] 남의 확인 기록 고치기 → %줄 바뀜 (0이어야 함)', changed;
end
$$;

do $$
begin
  begin
    insert into public.gym_equipment (gym_id, user_id, equipment_id, present)
    values ('gym-test-1', '11111111-1111-1111-1111-111111111111', 'fake', true);
    raise notice '[RLS] 남의 id로 확인 남기기 → ✗ 뚫림';
  exception when insufficient_privilege or others then
    raise notice '[RLS] 남의 id로 확인 남기기 → 막힘 ✓';
  end;
end
$$;

-- ── 아파서 뺀 것은 DB가 받지 않는다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.share_skip('gym-test-1', 'barbell-row', 'dislike');
select public.share_skip('gym-test-1', 'conventional-deadlift', 'pain');

select '[민감정보] 뺀 종목 기록 → ' || string_agg(exercise_id || '(' || reason || ')', ', ')
from public.gym_skip_counts('gym-test-1');

select '[민감정보] 통증이 안 들어갔나 → ' ||
  case when not exists (select 1 from public.gym_skips where reason = 'pain')
    then '안 들어감 ✓' else '들어감 ✗' end;

do $$
begin
  begin
    insert into public.gym_skips (gym_id, user_id, exercise_id, reason)
    values ('gym-test-1', '11111111-1111-1111-1111-111111111111', 'x', 'pain');
    raise notice '[민감정보] 직접 INSERT로 통증 넣기 → ✗ 뚫림';
  exception when check_violation then
    raise notice '[민감정보] 직접 INSERT로 통증 넣기 → 막힘 ✓ (check 제약)';
  end;
end
$$;

-- ── 아파트는 올라가고 홈짐은 안 올라간다
select '[단지] 아파트 헬스장 올리기 → ' || public.share_gym(
  '{"id":"gym-apt-1","name":"예시아파트 커뮤니티 헬스장","visibility":"restricted","floor":-1}'::jsonb,
  '[{"id":"dumbbells","present":true}]'::jsonb
) || '개 (1이어야 함 — 같은 단지 주민끼리 나눈다)';

select '[단지] 딱지가 남았나 → ' || visibility from public.gyms where id = 'gym-apt-1';

select '[사생활] 홈짐 올리기 → ' || public.share_gym(
  '{"id":"gym-home-1","name":"우리집","visibility":"private"}'::jsonb, '[]'::jsonb
) || '개 (0이어야 함)';

select '[사생활] 홈짐이 목록에 없나 → ' ||
  case when not exists (select 1 from public.gyms where id = 'gym-home-1')
    then '없음 ✓' else '있음 ✗' end;

do $$
begin
  begin
    insert into public.gyms (id, name, visibility, created_by)
    values ('gym-home-2', '우리집', 'private', auth.uid());
    raise notice '[사생활] 직접 INSERT로 홈짐 넣기 → ✗ 뚫림';
  exception when check_violation or insufficient_privilege then
    raise notice '[사생활] 직접 INSERT로 홈짐 넣기 → 막힘 ✓';
  end;
end
$$;

-- ── 탈퇴하면 내 것만 사라지고 헬스장은 남는다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.delete_my_gym_data();

select '[탈퇴] 가의 확인 기록 → ' ||
  (select count(*) from public.gym_equipment
    where user_id = '11111111-1111-1111-1111-111111111111') || '줄 (0이어야 함)';
select '[탈퇴] 나의 확인 기록 → ' ||
  (select count(*) from public.gym_equipment
    where user_id = '22222222-2222-2222-2222-222222222222') || '줄 (남아 있어야 함)';
select '[탈퇴] 헬스장 자체 → ' ||
  case when exists (select 1 from public.gyms where id = 'gym-test-1')
    then '남음 ✓ (다른 사람들이 쓰고 있다)' else '사라짐 ✗' end;
