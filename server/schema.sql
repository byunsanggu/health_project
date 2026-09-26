-- 볼륨 코치 — 서버 스키마
--
-- Supabase(PostgreSQL)에 그대로 붙여 넣으면 됩니다.
-- SQL Editor → New query → 전체 복사 → Run.
--
-- 설계 원칙 세 가지:
--
--   1. 로컬이 먼저다. 서버는 "같은 사람의 다른 기기"를 잇는 역할만 한다.
--      헬스장 지하에서 신호가 끊겨도 기록은 남아야 하므로, 앱은 서버를
--      기다리지 않는다.
--
--   2. 충돌은 마지막 수정 시각으로 푼다(LWW). 시각이 같으면 기기 id로
--      순서를 정해 어느 기기에서 보든 같은 결과가 나오게 한다.
--
--   3. 남의 기록은 DB가 막는다. 앱 코드에 버그가 나도 새지 않아야 한다.
--      건강 정보는 민감정보(개인정보보호법 제23조)라서 "앱이 잘 짜여
--      있으니 괜찮다"로는 부족하다.

-- ──────────────────────────────────────────────────────────────
-- 기록 한 덩어리
-- ──────────────────────────────────────────────────────────────
--
-- 세션과 체크인을 한 테이블에 담는다. 동기화 규칙이 둘 다 같으므로
-- 테이블을 나누면 같은 코드를 두 번 쓰게 된다.
--
-- 세트를 행으로 쪼개지 않고 body(jsonb)에 통째로 넣는다. 충돌을 푸는
-- 단위가 "세션 하나"라서, 세트를 쪼개면 반쪽만 올라간 세션이 생긴다.

create table if not exists public.records (
  user_id    uuid        not null references auth.users on delete cascade,
  -- 'session' | 'checkIn'
  kind       text        not null check (kind in ('session', 'checkIn')),
  -- 기기가 만든 id. 오프라인에서 만들어지므로 서버가 매기지 않는다.
  id         text        not null,

  -- 기기가 적은 수정 시각. 충돌은 이 값으로 푼다.
  updated_at timestamptz not null,

  /*
   * 서버가 적는 시각. "지난번 이후 바뀐 것"을 고를 때는 반드시 이 값을
   * 쓴다.
   *
   * updated_at을 쓰면 안 된다 — 그건 기기가 적은 값이라, 시계가 5분
   * 느린 폰이 올린 기록은 다음 동기화에서 걸러져 영영 안 내려온다.
   * 기록을 잃는 버그이고, 잃고 나서야 알게 된다.
   */
  synced_at  timestamptz not null default now(),

  -- 지운 기록도 행으로 남긴다. 지웠다는 사실이 다른 기기로 가야 한다.
  deleted    boolean     not null default false,

  body       jsonb       not null,

  primary key (user_id, kind, id)
);

-- "내 것 중에 지난번 이후 바뀐 것" — 앱이 제일 자주 하는 질문이다.
create index if not exists records_user_synced_idx
  on public.records (user_id, synced_at);

-- ──────────────────────────────────────────────────────────────
-- 설정 한 덩어리
-- ──────────────────────────────────────────────────────────────
--
-- 프로그램·헬스장·기구·휴식 띠처럼 사람마다 하나씩만 있는 것들.
-- 기록과 달리 합칠 일이 없으므로 통째로 덮어쓴다.

create table if not exists public.settings (
  /*
   * 기본값이 auth.uid()다. 앱은 자기 user_id를 모르고, 알 필요도 없다 —
   * 로그인한 사람의 id는 서버가 안다. 이게 없으면 앱이 user_id를
   * 채워 보내야 하고, 그러면 남의 id를 써 보낼 여지가 생긴다.
   */
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  body       jsonb       not null
);

-- ──────────────────────────────────────────────────────────────
-- 남의 기록은 DB가 막는다
-- ──────────────────────────────────────────────────────────────

alter table public.records  enable row level security;
alter table public.settings enable row level security;

-- 정책을 다시 만들 수 있게 먼저 지운다 (이 파일을 두 번 돌려도 안전하게)
drop policy if exists records_own  on public.records;
drop policy if exists settings_own on public.settings;

/*
 * 한 줄이 전부다: 로그인한 사람의 id와 행의 user_id가 같을 때만 보이고
 * 써진다. with check까지 있어야 "남의 user_id로 INSERT"를 막는다 —
 * using만 걸면 읽기는 막히는데 쓰기가 뚫린다.
 */
create policy records_own on public.records
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy settings_own on public.settings
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- 올릴 때 규칙
-- ──────────────────────────────────────────────────────────────
--
-- 오래된 기록이 새 기록을 덮어쓰면 안 된다. 비행기 모드였던 폰이
-- 사흘 뒤에 연결됐다고 그 사흘치가 사라지는 일이 실제로 일어난다.

create or replace function public.touch_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists records_touch  on public.records;
drop trigger if exists settings_touch on public.settings;

create trigger records_touch
  before insert or update on public.records
  for each row execute function public.touch_synced_at();

create trigger settings_touch
  before insert or update on public.settings
  for each row execute function public.touch_synced_at();

/*
 * 앱은 이 함수로 올린다.
 *
 * 한 번에 여러 개를 보내고, 각각에 대해 "서버에 있는 것보다 새 것일
 * 때만" 덮어쓴다. 앱에서 WHERE를 거는 것보다 여기서 막는 편이 낫다 —
 * 앱은 여러 버전이 동시에 돌아다니지만 DB는 하나다.
 */
create or replace function public.push_records(payload jsonb)
returns integer
language plpgsql
security invoker           -- RLS를 그대로 통과시킨다. definer로 두면 정책이 무력해진다.
set search_path = public   -- 검색 경로를 고정한다 (함수 가로채기 방지)
as $$
declare
  written integer;
begin
  with incoming as (
    select
      auth.uid()                                as user_id,
      item ->> 'kind'                           as kind,
      item ->> 'id'                             as id,
      (item ->> 'updatedAt')::timestamptz       as updated_at,
      coalesce((item ->> 'deleted')::boolean, false) as deleted,
      item -> 'body'                            as body
    from jsonb_array_elements(payload) as item
  ),
  upserted as (
    insert into public.records (user_id, kind, id, updated_at, deleted, body)
    select user_id, kind, id, updated_at, deleted, body from incoming
    on conflict (user_id, kind, id) do update
      set updated_at = excluded.updated_at,
          deleted    = excluded.deleted,
          body       = excluded.body
      -- 새 것일 때만. 같은 시각이면 덮어쓰지 않는다(이미 같은 내용이다).
      where excluded.updated_at > public.records.updated_at
    returning 1
  )
  select count(*)::integer into written from upserted;

  return written;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 탈퇴
-- ──────────────────────────────────────────────────────────────
--
-- 지우는 길이 없으면 개인정보를 받을 자격이 없다. auth.users에서 지우면
-- on delete cascade로 기록과 설정이 같이 사라진다.
--
-- 앱에서 부를 수 있게 함수로 열어 둔다.

create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.records  where user_id = auth.uid();
  delete from public.settings where user_id = auth.uid();
end;
$$;
