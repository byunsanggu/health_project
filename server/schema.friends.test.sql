-- 친구가 실제로 막을 것을 막는가.
--
--   psql -h /tmp -p 5433 -U app_user -d postgres -f server/schema.friends.test.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned

-- ── 프로필 만들기
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.set_my_profile('관장님') as acode \gset
select '[가] 코드 → ' || :'acode' as _;

set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select public.set_my_profile('영수') as bcode \gset
select '[나] 코드 → ' || :'bcode' as _;

select '[코드] 글자가 규칙대로인가 → ' ||
  case when bool_and(friend_code ~ '^[2-9A-HJ-NP-Z]{6}$') then '네 ✓' else '✗' end
from public.profiles;

select '[코드] 서로 다른가 → ' ||
  case when count(distinct friend_code) = count(*) then '네 ✓' else '✗ 겹침' end
from public.profiles;

-- 이름을 바꿔도 코드는 그대로여야 한다 — 친구가 적어 둔 코드가 죽으면 안 된다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[코드] 이름 바꿔도 그대로인가 → ' ||
  case when public.set_my_profile('영수2') = :'bcode' then '네 ✓' else '✗ 바뀜' end as _;

-- ── 남의 프로필은 못 읽는다 (코드 긁기 방지)
--
--   남의 줄이 보이면 코드 목록을 긁어 아무한테나 친구를 걸 수 있다.
--   코드로 찾는 일은 add_friend만 하고, 그 함수는 코드를 정확히 아는
--   경우에만 답한다.
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select '[RLS] 남의 프로필이 보이나 → ' ||
  case when count(*) = 1 then '내 것만 ✓' else '✗ ' || count(*) || '줄' end
from public.profiles;

select '[RLS] 남의 코드를 표에서 꺼낼 수 있나 → ' ||
  case when (select count(*) from public.profiles where friend_code = :'bcode') = 0
    then '못 꺼냄 ✓' else '✗ 꺼냄' end;

-- ── 친구 맺기 — 코드를 직접 받은 사람만
select public.add_friend(:'bcode') as added \gset
select '[친구] 맺기 → ' || (:'added'::jsonb->>'ok') || ' · ' || coalesce(:'added'::jsonb->>'name', '') as _;

-- 내 쪽에서는 내 줄만 보인다(정책이 그렇다). 양쪽에 생겼는지는 양쪽에서 본다.
select '[친구] 내 쪽 → ' || count(*) || '줄 (1이어야 함)' from public.friendships;

set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[친구] 상대 쪽 → ' || count(*) || '줄 (1이어야 함 — 맺어 달라고 한 적 없어도 생긴다)'
from public.friendships;
set session "test.uid" = '11111111-1111-1111-1111-111111111111';

-- 두 번 맺어도 늘지 않는다
select public.add_friend(:'bcode');
select '[친구] 두 번 맺어도 → ' || count(*) || '줄' from public.friendships;

-- 사람이 적어 오는 꼴을 받아 준다
select '[친구] 소문자·붙임표 → ' ||
  (public.add_friend(lower(substr(:'bcode',1,3) || '-' || substr(:'bcode',4,3)))->>'ok') as _;

-- ── 없는 코드 · 나 자신
select '[친구] 없는 코드 → ' || (public.add_friend('ZZZZZZ')->>'reason') as _;
select '[친구] 내 코드 → ' || (public.add_friend(:'acode')->>'reason') as _;
select '[친구] 엉터리 코드 → ' || (public.add_friend('abc')->>'reason') as _;
select '[친구] 헷갈리는 글자(0) → ' || (public.add_friend('A2B3C0')->>'reason') as _;

-- ── 주간 요약 — 친구 것은 보이고 남 것은 안 보인다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.put_week_summary('2026-09-28', 2::smallint, 4::smallint, 7::smallint);
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select public.put_week_summary('2026-09-28', 3::smallint, 3::smallint, 2::smallint);

-- 친구가 아닌 사람
set session "test.uid" = '33333333-3333-3333-3333-333333333333';
select public.set_my_profile('모르는사람');
select public.put_week_summary('2026-09-28', 5::smallint, 5::smallint, 9::smallint);
select '[RLS] 남의 요약이 보이나 → ' ||
  case when count(*) = 1 then '내 것만 ✓' else '✗ ' || count(*) || '줄' end
from public.week_summaries;

set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select '[요약] 내 것 + 친구 것 → ' || count(*) || '줄 (2여야 함 · 모르는사람 것은 빠져야 함)'
from public.week_summaries;

select '[목록] ' || name || ' · ' || days || '/' || target || ' · ' || streak || '주 연속'
from public.my_friends('2026-09-28');

-- ── 남의 요약은 못 고친다
do $$
declare changed integer;
begin
  update public.week_summaries set days = 0
    where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics changed = row_count;
  raise notice '[RLS] 친구 출석 고치기 → %줄 바뀜 (0이어야 함)', changed;
end
$$;

-- ── 응원
select '[응원] 보내기 → ' || public.send_cheer('22222222-2222-2222-2222-222222222222', 'go') as _;
select '[응원] 같은 날 두 번 → ' || public.send_cheer('22222222-2222-2222-2222-222222222222', 'nice')
  || ' (false여야 함 — 하루 한 번)' as _;

do $$
begin
  begin
    perform public.send_cheer('33333333-3333-3333-3333-333333333333', 'go');
    raise notice '[RLS] 친구 아닌 사람에게 응원 → ✗ 뚫림';
  exception when insufficient_privilege or others then
    raise notice '[RLS] 친구 아닌 사람에게 응원 → 막힘 ✓';
  end;
end
$$;

do $$
begin
  begin
    insert into public.cheers (from_user, to_user, kind)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'go');
    raise notice '[RLS] 남인 척 응원 보내기 → ✗ 뚫림';
  exception when insufficient_privilege or others then
    raise notice '[RLS] 남인 척 응원 보내기 → 막힘 ✓';
  end;
end
$$;

do $$
begin
  begin
    perform public.send_cheer('22222222-2222-2222-2222-222222222222', '자유롭게 쓴 말');
    raise notice '[민감정보] 정해지지 않은 문구 → ✗ 들어감';
  exception when check_violation or others then
    raise notice '[민감정보] 정해지지 않은 문구 → 막힘 ✓';
  end;
end
$$;

set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[응원] 받은 것 → ' || name || ' · ' || kind from public.my_cheers();
select public.mark_cheers_seen();
select '[응원] 본 뒤 → ' || count(*) || '개 (0이어야 함)' from public.my_cheers();

-- ── 끊기는 양쪽 다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select public.remove_friend('22222222-2222-2222-2222-222222222222');
select '[끊기] 내 쪽 → ' || count(*) || '줄 (0이어야 함)' from public.friendships;
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[끊기] 상대 쪽 → ' || count(*) || '줄 (0이어야 함)' from public.friendships;
select '[끊기] 친구 요약이 안 보이나 → ' ||
  case when count(*) = 1 then '내 것만 ✓' else '✗ ' || count(*) || '줄' end
from public.week_summaries;

-- ── 표에 건강 정보가 없다
select '[민감정보] week_summaries 열 → ' || string_agg(column_name, ', ' order by ordinal_position)
from information_schema.columns where table_schema = 'public' and table_name = 'week_summaries';
select '[민감정보] cheers 열 → ' || string_agg(column_name, ', ' order by ordinal_position)
from information_schema.columns where table_schema = 'public' and table_name = 'cheers';

-- ── 닉네임 규칙
--
--   앱(nickname.ts)이 입력칸 아래에서 한국어로 먼저 막는다. 그런데
--   anon 키는 앱에 박혀 있어서 입력칸을 건너뛰고 PostgREST로 직접
--   쏠 수 있다. 그래서 DB가 마지막으로 한 번 더 본다.
set session "test.uid" = '33333333-3333-3333-3333-333333333333';

select '[닉네임] ' || rpad(name, 14) || ' → ' ||
  case when public.set_my_profile(name) is null then '막힘 ✓' else '✗ 통과해 버림' end
from (values
  ('가'), ('가나다라마바사아자차카타파'), ('ㅋㅋㅋ'), ('철수@짐'),
  ('_철수'), ('철수_'), ('철수__형'),
  ('01012345678'), ('김01012345678'), ('123456'),
  ('관리자'), ('운영자_김'), ('볼륨_코치'), ('Admin'), ('xx_support')
) as t(name);

select '[닉네임] 막혀도 쓰던 이름은 그대로인가 → ' ||
  case when display_name = '모르는사람' then '네 ✓' else '✗ ' || display_name end
from public.profiles where user_id = auth.uid();

select '[닉네임] 멀쩡한 이름 → ' ||
  case when public.set_my_profile('새벽리프터') is not null then '통과 ✓' else '✗ 막힘' end as _;

-- 공백은 거절하지 않고 밑줄로 바꾼다. 앱과 같은 처리여야 한다.
select public.set_my_profile('철수 형') as _ \gset
select '[닉네임] 공백 → 밑줄: ' || display_name ||
  case when display_name = '철수_형' then ' ✓' else ' ✗' end
from public.profiles where user_id = auth.uid();
