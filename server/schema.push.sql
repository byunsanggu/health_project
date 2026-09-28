-- 볼륨 코치 — 알림(웹 푸시)
--
-- Supabase → SQL Editor → New query → 전체 복사 → Run.
--
-- ──────────────────────────────────────────────────────────────
-- 서버가 판단하지 않는다
-- ──────────────────────────────────────────────────────────────
--
-- "누구를 언제 부를지"는 **앱이 정한다.** 서버는 앱이 적어 둔 것을 시간
-- 맞춰 보내기만 한다.
--
-- 그렇게 나눈 이유가 있다. 서버가 판단하려면 그 사람의 통증·세션 기록을
-- 읽어야 한다. 그건 민감정보(개인정보보호법 제23조)이고, 읽을 필요가
-- 없는 곳에서 읽게 만들면 언젠가 샌다. 앱은 이미 다 알고 있으므로
-- 앱이 정하고 **결론만** 올린다.
--
-- 그래서 이 표에는 "무엇을 보낼지"와 "언제 보낼지"만 있다. 통증도,
-- 무게도, 종목도 없다.

create table if not exists public.push_queue (
  -- 한 사람에 한 줄. 다음 알림 하나만 들고 있으면 된다.
  user_id    uuid        not null references auth.users on delete cascade,

  -- 브라우저가 준 구독 정보. endpoint가 사실상의 기기 주소다.
  endpoint   text        not null,
  p256dh     text        not null,
  auth_key   text        not null,

  -- 보낼 시각. 앱이 그 사람이 여는 시간에 맞춰 적는다.
  send_at    timestamptz not null,

  -- 보낼 말. 앱이 만든 문장을 그대로 싣는다.
  title      text        not null,
  body       text        not null,

  updated_at timestamptz not null default now(),

  primary key (user_id, endpoint)
);

create index if not exists push_queue_due on public.push_queue (send_at);

alter table public.push_queue enable row level security;

/*
 * 내 줄만 만진다.
 *
 * 남의 줄을 읽을 수 있으면 "누가 언제 헬스장에 가는지"가 새어 나간다.
 * 보내는 쪽(Edge Function)은 service_role로 도므로 이 정책을 지나간다.
 */
drop policy if exists push_queue_own on public.push_queue;
create policy push_queue_own on public.push_queue
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- 예약하기
-- ──────────────────────────────────────────────────────────────
--
-- 한 기기에 하나씩 덮어쓴다. 앱을 열 때마다 다시 계산해서 올리므로,
-- 쌓이지 않고 늘 최신 하나만 남는다.

create or replace function public.queue_nudge(
  sub        jsonb,
  at         timestamptz,
  nudge_title text,
  nudge_body  text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  /*
   * 과거로 예약하지 않는다. 시계가 틀어진 기기가 어제로 적어 두면
   * 다음 보내기에서 즉시 울린다 — 한밤중에.
   */
  if at <= now() then
    return;
  end if;

  insert into public.push_queue (user_id, endpoint, p256dh, auth_key, send_at, title, body, updated_at)
  values (
    auth.uid(),
    sub->>'endpoint',
    sub->>'p256dh',
    sub->>'auth',
    at,
    nudge_title,
    nudge_body,
    now()
  )
  on conflict (user_id, endpoint) do update
    set p256dh     = excluded.p256dh,
        auth_key   = excluded.auth_key,
        send_at    = excluded.send_at,
        title      = excluded.title,
        body       = excluded.body,
        updated_at = now();
end
$$;

/*
 * 취소.
 *
 * 오늘 운동을 했거나, 아프다고 적었거나, 알림을 껐을 때 부른다.
 * **이게 없으면 앱이 거짓말을 한다** — 방금 운동하고 나왔는데 두 시간 뒤에
 * "오늘 한 번 어떠세요"가 울린다.
 */
create or replace function public.cancel_nudge()
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.push_queue where user_id = auth.uid();
$$;

-- 탈퇴할 때 같이 지운다. auth.users에 걸려 있어 자동이지만, 계정을 남긴 채
-- 기록만 지우는 길에서도 불린다.
create or replace function public.delete_my_push_data()
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.push_queue where user_id = auth.uid();
$$;

grant execute on function public.queue_nudge(jsonb, timestamptz, text, text) to authenticated;
grant execute on function public.cancel_nudge() to authenticated;
grant execute on function public.delete_my_push_data() to authenticated;
