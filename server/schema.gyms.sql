-- 볼륨 코치 — 헬스장 공유 스키마
--
-- schema.sql 을 먼저 돌린 다음 이것을 돌립니다.
-- SQL Editor → New query → 전체 복사 → Run. 두 번 돌려도 안전합니다.
--
-- ──────────────────────────────────────────────────────────────
-- 무엇을 나누고 무엇을 안 나누는가
-- ──────────────────────────────────────────────────────────────
--
-- **사실은 나누고 취향은 안 나눈다.** 이 파일에 들어오는 것은 사실뿐입니다.
--
--   나눈다   — 헬스장 이름·주소·층, 어떤 기구가 있고 없는지, 빈 바 무게
--   안 나눈다 — 내 기록, 통증, 체중, 어떤 종목을 싫어하는지
--
-- 아파서 뺀 종목은 여기 오지 않습니다. 건강 정보(개인정보보호법 제23조)라서
-- 익명으로 모아도 "이 헬스장 사람들이 허리가 아프다"는 말이 만들어지는데,
-- 그건 우리가 만들어도 되는 말이 아닙니다.
--
-- ──────────────────────────────────────────────────────────────
-- 왜 기구 목록을 "덩어리"가 아니라 "확인 기록"으로 두는가
-- ──────────────────────────────────────────────────────────────
--
-- 기구 목록을 헬스장 행에 배열로 넣으면, 나중에 쓴 사람이 앞사람 것을
-- 통째로 덮어씁니다. 6개월 전에 누가 "레그프레스 있음"이라고 해 둔 것과
-- 어제 누가 "없음"이라고 한 것 중 어느 쪽이 맞는지 알 수 없게 됩니다.
--
-- 그래서 **사람마다 기구마다 한 줄**을 남깁니다. 누가 언제 뭐라고 했는지가
-- 남아 있어야, "3명이 확인 · 마지막 2주 전"을 보여줄 수 있고, 장난으로
-- 하나 찍은 사람이 전체를 망치지 않습니다.
--
-- 없는 기구로 처방이 나가면 사용자는 헬스장에 가서 못 합니다. 그게 이
-- 설계가 막으려는 단 하나입니다.

-- ──────────────────────────────────────────────────────────────
-- 헬스장
-- ──────────────────────────────────────────────────────────────

create table if not exists public.gyms (
  -- 좌표+이름에서 만든 결정적 id. 두 사람이 같은 곳을 등록하면 같은 값이 나온다.
  id          text        primary key,
  name        text        not null,
  address     text        not null default '',
  floor       integer,
  lat         double precision,
  lng         double precision,

  /*
   * 누가 갈 수 있는 곳인가.
   *
   *   public     — 누구나. 상업 헬스장.
   *   restricted — 입주민·직원·투숙객만. 아파트 단지, 사옥, 호텔.
   *
   * 아파트 헬스장도 나눈다. 밖에서는 뭐가 있는지 알 길이 없어서, 같은 단지
   * 주민이 채워 준 목록이 제일 값어치가 크다. 대신 앱이 "입주민·직원 전용"을
   * 붙이고 검색에서 뒤로 민다.
   *
   * **홈짐(private)은 여기 못 들어온다.** 그건 남의 집 주소다. 앱이 애초에
   * 안 보내지만 DB에서도 막는다 — 앱은 여러 버전이 돌아다니지만 DB는 하나다.
   */
  visibility  text        not null default 'public'
                          check (visibility in ('public', 'restricted')),

  -- 처음 올린 사람. 지워도 헬스장은 남는다(다른 사람들이 쓰고 있다).
  created_by  uuid        references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists gyms_name_idx on public.gyms (name);

-- ──────────────────────────────────────────────────────────────
-- 기구 확인 기록
-- ──────────────────────────────────────────────────────────────
--
-- "누가 · 어느 헬스장의 · 어떤 기구를 · 언제 · 있다/없다고 했는가"

create table if not exists public.gym_equipment (
  gym_id       text        not null references public.gyms on delete cascade,
  user_id      uuid        not null references auth.users on delete cascade,
  equipment_id text        not null,
  present      boolean     not null,
  confirmed_at timestamptz not null default now(),

  -- 한 사람은 한 기구에 대해 한 가지 답만 갖는다. 마음이 바뀌면 덮어쓴다.
  primary key (gym_id, user_id, equipment_id)
);

create index if not exists gym_equipment_gym_idx on public.gym_equipment (gym_id);

-- ──────────────────────────────────────────────────────────────
-- 뺀 종목 (집단 신호용)
-- ──────────────────────────────────────────────────────────────
--
-- 한 사람이 바벨 로우를 뺀 건 취향입니다. 열 중 여섯이 뺐으면 그건 그
-- 헬스장 이야기입니다 — 바가 휘었거나, 자리가 좁거나.
--
-- **아파서 뺀 것은 여기 오지 않습니다.** check 제약으로 DB가 막습니다.

create table if not exists public.gym_skips (
  gym_id      text        not null references public.gyms on delete cascade,
  user_id     uuid        not null references auth.users on delete cascade,
  exercise_id text        not null,
  reason      text        not null check (reason in ('noEquipment', 'dislike')),
  updated_at  timestamptz not null default now(),

  primary key (gym_id, user_id, exercise_id)
);

create index if not exists gym_skips_gym_idx on public.gym_skips (gym_id);

-- ──────────────────────────────────────────────────────────────
-- 누가 무엇을 할 수 있는가
-- ──────────────────────────────────────────────────────────────

alter table public.gyms          enable row level security;
alter table public.gym_equipment enable row level security;
alter table public.gym_skips     enable row level security;

drop policy if exists gyms_read        on public.gyms;
drop policy if exists gyms_insert      on public.gyms;
drop policy if exists gyms_update      on public.gyms;
drop policy if exists equipment_read   on public.gym_equipment;
drop policy if exists equipment_mine   on public.gym_equipment;
drop policy if exists skips_read       on public.gym_skips;
drop policy if exists skips_mine       on public.gym_skips;

/*
 * 헬스장은 누구나 읽는다. 로그인 안 한 사람도 읽는다 — 처음 켠 사람이
 * 제일 먼저 하는 일이 헬스장 고르기인데, 그 앞에 회원가입을 세우면
 * 거기서 절반이 나간다.
 */
create policy gyms_read on public.gyms
  for select using (true);

-- 만드는 건 로그인한 사람만. 익명으로 목록을 더럽힐 수 없어야 한다.
create policy gyms_insert on public.gyms
  for insert to authenticated
  with check (auth.uid() = created_by and visibility in ('public', 'restricted'));

/*
 * 고치는 것도 로그인한 사람이면 누구나 — 간판이 바뀌거나 층이 틀렸을 때
 * 처음 올린 사람만 고칠 수 있으면 영영 안 고쳐진다. 지우는 길은 아예 없다.
 * 다른 사람들이 쓰고 있는 항목이라서다.
 */
create policy gyms_update on public.gyms
  for update to authenticated
  using (true)
  with check (visibility in ('public', 'restricted'));

/*
 * 기구 확인은 누구나 읽고, **자기 것만** 쓴다.
 *
 * 남의 확인 기록을 고칠 수 있으면 한 사람이 전체를 뒤집을 수 있다.
 * 읽기는 열어야 "3명이 확인"을 셀 수 있다.
 */
create policy equipment_read on public.gym_equipment
  for select using (true);

create policy equipment_mine on public.gym_equipment
  for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy skips_read on public.gym_skips
  for select using (true);

create policy skips_mine on public.gym_skips
  for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- 읽을 때 — 셈해서 준다
-- ──────────────────────────────────────────────────────────────
--
-- 앱이 확인 기록을 통째로 받아서 세면, 사람이 많은 헬스장일수록 느려지고
-- 남들의 기록이 통째로 기기에 내려간다. 서버에서 세서 숫자만 보낸다.

create or replace view public.gym_equipment_summary as
select
  gym_id,
  equipment_id,
  count(*) filter (where present)       as present_count,
  count(*) filter (where not present)   as absent_count,
  max(confirmed_at)                     as last_confirmed_at
from public.gym_equipment
group by gym_id, equipment_id;

/*
 * 이 헬스장에 무엇이 있는가.
 *
 * "있다"가 "없다"보다 많으면 있는 것으로 본다. 같으면 없는 것으로 본다 —
 * **애매하면 없는 쪽이다.** 없는데 있다고 하면 사용자는 헬스장에 가서
 * 못 하고, 있는데 없다고 하면 종목 하나가 덜 나올 뿐이다. 두 실수의
 * 무게가 다르다.
 */
create or replace function public.gym_equipment_ids(target text)
returns table (equipment_id text, confirmations integer, last_confirmed_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select equipment_id, present_count::integer, last_confirmed_at
  from public.gym_equipment_summary
  where gym_id = target and present_count > absent_count;
$$;

/*
 * 이 헬스장에서 몇 명이 무엇을 뺐는가.
 *
 * 사람 수도 같이 준다. 비율은 앱이 낸다 — 몇 명부터 말할지, 몇 %부터
 * 신호로 볼지는 제품 판단이라 앱에 두는 편이 고치기 쉽다.
 */
create or replace function public.gym_skip_counts(target text)
returns table (exercise_id text, reason text, people integer)
language sql
stable
security invoker
set search_path = public
as $$
  select exercise_id, reason, count(*)::integer
  from public.gym_skips
  where gym_id = target
  group by exercise_id, reason;
$$;

/** 이 헬스장을 쓰는 사람 수. 비율의 분모다. */
create or replace function public.gym_people(target text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(distinct user_id)::integer
  from public.gym_equipment
  where gym_id = target;
$$;

-- ──────────────────────────────────────────────────────────────
-- 올릴 때
-- ──────────────────────────────────────────────────────────────

/*
 * 헬스장 하나와 내 기구 확인을 한 번에 올린다.
 *
 * 헬스장이 이미 있으면 안 덮어쓴다 — 두 사람이 같은 곳을 조금 다르게
 * 적었다고 나중 사람이 이기면, 남의 화면에서 이름이 멋대로 바뀐다.
 */
create or replace function public.share_gym(
  gym      jsonb,
  equipment jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  target text := gym ->> 'id';
  written integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  -- 홈짐은 올리지 않는다. 앱도 막지만 여기서 한 번 더 막는다.
  if coalesce(gym ->> 'visibility', 'public') not in ('public', 'restricted') then
    return 0;
  end if;

  insert into public.gyms (id, name, address, floor, lat, lng, visibility, created_by)
  values (
    target,
    gym ->> 'name',
    coalesce(gym ->> 'address', ''),
    (gym ->> 'floor')::integer,
    (gym ->> 'lat')::double precision,
    (gym ->> 'lng')::double precision,
    coalesce(gym ->> 'visibility', 'public'),
    auth.uid()
  )
  on conflict (id) do nothing;

  with incoming as (
    select
      target                                  as gym_id,
      auth.uid()                              as user_id,
      item ->> 'id'                           as equipment_id,
      (item ->> 'present')::boolean           as present
    from jsonb_array_elements(equipment) as item
  ),
  upserted as (
    insert into public.gym_equipment (gym_id, user_id, equipment_id, present, confirmed_at)
    select gym_id, user_id, equipment_id, present, now() from incoming
    on conflict (gym_id, user_id, equipment_id) do update
      set present = excluded.present,
          confirmed_at = now()
    returning 1
  )
  select count(*)::integer into written from upserted;

  return written;
end;
$$;

/*
 * 내가 뺀 종목을 남긴다.
 *
 * 'pain'은 받지 않는다. 앱이 안 보내지만, 앱은 여러 버전이 돌아다니고
 * DB는 하나다. check 제약이 한 번 더 막는다.
 */
create or replace function public.share_skip(
  target text,
  exercise text,
  skip_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  if skip_reason not in ('noEquipment', 'dislike') then
    return;  -- 건강 정보는 조용히 버린다
  end if;

  insert into public.gym_skips (gym_id, user_id, exercise_id, reason, updated_at)
  values (target, auth.uid(), exercise, skip_reason, now())
  on conflict (gym_id, user_id, exercise_id) do update
    set reason = excluded.reason, updated_at = now();
end;
$$;

/** 다시 하기로 했으면 지운다. */
create or replace function public.unshare_skip(target text, exercise text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.gym_skips
  where gym_id = target and user_id = auth.uid() and exercise_id = exercise;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 탈퇴
-- ──────────────────────────────────────────────────────────────
--
-- schema.sql 의 delete_my_data() 가 기록과 설정을 지웁니다. 여기 것도
-- 같이 지워야 합니다 — 기구 확인과 뺀 종목에는 user_id가 붙어 있습니다.
--
-- 헬스장 자체는 남습니다. 다른 사람들이 쓰고 있고, 거기엔 내 정보가
-- 없습니다(created_by는 on delete set null 로 끊깁니다).

create or replace function public.delete_my_gym_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.gym_equipment where user_id = auth.uid();
  delete from public.gym_skips     where user_id = auth.uid();
end;
$$;
