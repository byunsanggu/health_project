-- 볼륨 코치 — 친구
--
-- Supabase → SQL Editor → New query → 전체 복사 → Run.
--
-- ──────────────────────────────────────────────────────────────
-- 무엇이 오가는가
-- ──────────────────────────────────────────────────────────────
--
-- 친구에게 보이는 것은 **별명 · 이번 주 몇 번 · 연속 몇 주**뿐입니다.
-- 무게도 종목도 체중도 통증도 안 보입니다.
--
-- 건강 정보는 민감정보(개인정보보호법 제23조)라 친구에게 보이려면 완전히
-- 다른 동의가 필요하고, 그 동의를 받는다 해도 남의 스쿼트 무게는
-- 동기부여가 아니라 비교질이 됩니다.
--
-- 그래서 이 스키마는 **records 표를 아예 쳐다보지 않습니다.** 주간 요약을
-- 각자가 직접 올리고, 친구는 그 요약만 봅니다. 새고 싶어도 샐 통로가 없습니다.

-- ──────────────────────────────────────────────────────────────
-- 사람
-- ──────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  -- 친구에게 보일 이름. 본명을 요구하지 않는다.
  display_name text not null check (length(display_name) between 1 and 10),
  /*
   * 친구 코드.
   *
   * 이름·전화번호로 검색되게 만들면 모르는 사람이 붙는다. 헬스장은 실제
   * 장소라 "이 사람은 화·목 저녁에 온다"가 새면 위험하다. 코드를 직접
   * 주고받은 사이만 친구가 된다.
   */
  friend_code  text not null unique check (friend_code ~ '^[2-9A-HJ-NP-Z]{6}$'),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

/*
 * 내 줄만 만진다.
 *
 * 남의 줄을 통째로 읽게 두면 코드 목록을 긁어 아무한테나 친구를 걸 수
 * 있다. 코드로 찾는 것은 아래 add_friend 함수만 할 수 있고, 그 함수는
 * 코드를 정확히 아는 경우에만 답한다.
 */
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/** 코드를 하나 뽑는다. 헷갈리는 글자(0·O·1·I·L)는 안 쓴다. */
create or replace function public.new_friend_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
  tries integer := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = candidate);
    tries := tries + 1;
    -- 31^6 = 8억 가지다. 여기까지 부딪히면 무한 반복을 막는 쪽이 맞다.
    if tries > 20 then
      raise exception '친구 코드를 만들지 못했습니다';
    end if;
  end loop;
  return candidate;
end
$$;

/** 내 프로필을 만들거나 이름만 바꾼다. 코드는 처음 한 번만 정해진다. */
create or replace function public.set_my_profile(name text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  clean text := btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'));
  code  text;
begin
  if auth.uid() is null then return null; end if;
  if clean = '' then return null; end if;
  clean := left(clean, 10);

  select friend_code into code from public.profiles where user_id = auth.uid();
  if code is null then code := public.new_friend_code(); end if;

  insert into public.profiles (user_id, display_name, friend_code, updated_at)
  values (auth.uid(), clean, code, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now();

  return code;
end
$$;

-- ──────────────────────────────────────────────────────────────
-- 친구 관계
-- ──────────────────────────────────────────────────────────────
--
-- 주간 요약보다 **먼저** 만든다. 요약의 읽기 정책이 이 표를 보기 때문에,
-- 순서가 뒤바뀌면 스키마가 아예 안 붙는다.
--
-- 양쪽에 한 줄씩 넣는다. 한 줄로 두고 (a,b) 또는 (b,a)로 찾는 것보다
-- 정책이 단순해지고, 한쪽이 끊으면 양쪽이 같이 끊긴다.

create table if not exists public.friendships (
  user_id    uuid not null references auth.users on delete cascade,
  friend_id  uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table public.friendships enable row level security;

drop policy if exists friendships_own on public.friendships;
create policy friendships_own on public.friendships
  for select using (auth.uid() = user_id);

/*
 * 승낙을 받지 않는다.
 *
 * 코드를 직접 건네준 것이 이미 승낙이다. 거기에 수락 단계를 또 두면
 * 둘 다 앱을 열고 기다려야 한다 — 헬스장에서 옆에 서서 코드를 불러 준
 * 사이에게 그건 방해다. 대신 **끊기는 언제든, 상대에게 알림 없이** 된다.
 */
create or replace function public.add_friend(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean  text := upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g'));
  target uuid;
  name   text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'signedOut');
  end if;
  if clean !~ '^[2-9A-HJ-NP-Z]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'badCode');
  end if;

  select user_id, display_name into target, name
  from public.profiles where friend_code = clean;

  if target is null then
    return jsonb_build_object('ok', false, 'reason', 'notFound');
  end if;
  if target = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  insert into public.friendships (user_id, friend_id) values (auth.uid(), target)
    on conflict do nothing;
  insert into public.friendships (user_id, friend_id) values (target, auth.uid())
    on conflict do nothing;

  return jsonb_build_object('ok', true, 'name', name, 'userId', target);
end
$$;

/** 끊기 — 양쪽 다. 한쪽만 남으면 상대 화면에 유령이 남는다. */
create or replace function public.remove_friend(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.friendships
    where (user_id = auth.uid() and friend_id = other)
       or (user_id = other and friend_id = auth.uid());
  delete from public.cheers
    where (from_user = auth.uid() and to_user = other)
       or (from_user = other and to_user = auth.uid());
end
$$;

-- ──────────────────────────────────────────────────────────────
-- 이번 주 요약 — 친구에게 보이는 것 전부
-- ──────────────────────────────────────────────────────────────
--
-- 각자가 자기 것을 올린다. 서버가 records를 뒤져 만들지 않는다 —
-- 그러려면 서버가 세션 기록을 읽어야 하고, 그 통로를 열지 않는 것이
-- 이 설계의 요점이다.

create table if not exists public.week_summaries (
  user_id    uuid not null references auth.users on delete cascade,
  -- 그 주의 월요일
  week_start date not null,
  -- 그 주에 나온 날 수. 무엇을 했는지는 담지 않는다.
  days       smallint not null check (days between 0 and 7),
  -- 그 주에 하기로 한 횟수
  target     smallint not null check (target between 1 and 7),
  -- 연속으로 지킨 주
  streak     smallint not null default 0 check (streak >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.week_summaries enable row level security;

/*
 * 내 것은 쓰고, 친구 것은 읽는다.
 *
 * 친구가 아닌 사람의 요약은 못 읽는다 — 읽히면 코드만 알면 아무나
 * 남의 출석을 들여다보게 된다.
 */
drop policy if exists week_own_write on public.week_summaries;
create policy week_own_write on public.week_summaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists week_friend_read on public.week_summaries;
create policy week_friend_read on public.week_summaries
  for select using (exists (
    select 1 from public.friendships
    where user_id = auth.uid() and friend_id = week_summaries.user_id
  ));

create or replace function public.put_week_summary(
  week date, days_done smallint, week_target smallint, streak_weeks smallint
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.week_summaries (user_id, week_start, days, target, streak, updated_at)
  select auth.uid(), week, greatest(0, least(7, days_done)),
         greatest(1, least(7, week_target)), greatest(0, streak_weeks), now()
  where auth.uid() is not null
  on conflict (user_id, week_start) do update
    set days = excluded.days, target = excluded.target,
        streak = excluded.streak, updated_at = now();
$$;

-- ──────────────────────────────────────────────────────────────
-- 응원
-- ──────────────────────────────────────────────────────────────
--
-- 정해진 문구만. 자유롭게 쓴 말을 담는 칸이 **아예 없다** — 칸이 없으면
-- 괴롭힘도 스팸도 유출도 통로가 없다.

create table if not exists public.cheers (
  from_user uuid not null references auth.users on delete cascade,
  to_user   uuid not null references auth.users on delete cascade,
  -- 보낸 날. 하루에 친구당 한 번이라 날짜가 열쇠에 들어간다.
  sent_on   date not null default current_date,
  kind      text not null check (kind in ('go', 'nice', 'done', 'together')),
  seen      boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user, sent_on),
  check (from_user <> to_user)
);

alter table public.cheers enable row level security;

drop policy if exists cheers_mine on public.cheers;
create policy cheers_mine on public.cheers
  for select using (auth.uid() = to_user or auth.uid() = from_user);

drop policy if exists cheers_send on public.cheers;
create policy cheers_send on public.cheers
  for insert with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.friendships
      where user_id = auth.uid() and friend_id = cheers.to_user
    )
  );

drop policy if exists cheers_seen on public.cheers;
create policy cheers_seen on public.cheers
  for update using (auth.uid() = to_user) with check (auth.uid() = to_user);

/** 응원 보내기. 하루에 친구당 한 번은 기본 키가 막는다. */
create or replace function public.send_cheer(other uuid, cheer_kind text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.cheers (from_user, to_user, kind)
  values (auth.uid(), other, cheer_kind)
  on conflict (from_user, to_user, sent_on) do nothing;
  return found;
end
$$;

-- ──────────────────────────────────────────────────────────────
-- 화면이 한 번에 읽는 것
-- ──────────────────────────────────────────────────────────────

/*
 * security definer인 이유.
 *
 * 친구 이름을 보여주려면 그 사람의 profiles 줄을 읽어야 한다. 그렇다고
 * "친구면 프로필을 읽어도 된다"는 정책을 열면 **친구 코드까지 같이
 * 열린다** — RLS는 줄 단위라 칸을 골라 막지 못한다.
 *
 * 그래서 표는 통째로 닫아 두고, 이 함수만 대신 읽는다. 안에서 반드시
 * auth.uid()로 걸러야 한다 — 그 조건이 이 함수의 울타리 전부다.
 */
create or replace function public.my_friends(week date)
returns table (
  user_id uuid, name text, days smallint, target smallint, streak smallint,
  last_cheer_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select p.user_id,
         p.display_name,
         coalesce(w.days, 0::smallint),
         coalesce(w.target, 3::smallint),
         coalesce(w.streak, 0::smallint),
         c.created_at
  from public.friendships f
  join public.profiles p on p.user_id = f.friend_id
  left join public.week_summaries w
    on w.user_id = f.friend_id and w.week_start = week
  left join public.cheers c
    on c.from_user = auth.uid() and c.to_user = f.friend_id and c.sent_on = current_date
  where f.user_id = auth.uid()
  order by p.display_name;
$$;

/** 나에게 온 응원 중 아직 안 본 것. */
/* 보낸 사람 이름을 붙이려면 프로필을 읽어야 한다 — my_friends와 같은 이유. */
create or replace function public.my_cheers()
returns table (from_user uuid, name text, kind text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select c.from_user, p.display_name, c.kind, c.created_at
  from public.cheers c
  join public.profiles p on p.user_id = c.from_user
  where c.to_user = auth.uid() and not c.seen
  order by c.created_at desc
  limit 20;
$$;

create or replace function public.mark_cheers_seen()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.cheers set seen = true where to_user = auth.uid() and not seen;
$$;

/** 탈퇴·기록 삭제에서 같이 부른다. */
create or replace function public.delete_my_friend_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.cheers where from_user = auth.uid() or to_user = auth.uid();
  delete from public.friendships where user_id = auth.uid() or friend_id = auth.uid();
  delete from public.week_summaries where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
end
$$;

grant execute on function
  public.set_my_profile(text),
  public.put_week_summary(date, smallint, smallint, smallint),
  public.add_friend(text),
  public.remove_friend(uuid),
  public.send_cheer(uuid, text),
  public.my_friends(date),
  public.my_cheers(),
  public.mark_cheers_seen(),
  public.delete_my_friend_data()
  to authenticated;
