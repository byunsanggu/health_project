-- 사람 둘을 만든다
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;   -- 두 번 돌려도 안전하게

-- RLS를 우회하지 않는 역할로 시험해야 뜻이 있다. postgres는 BYPASSRLS라서.
drop role if exists app_user;
create role app_user login;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on public.records, public.settings to app_user;
grant execute on function public.push_records(jsonb), public.delete_my_data(), auth.uid() to app_user;
grant select on auth.users to app_user;

-- 헬스장 공유 쪽(schema.gyms.sql)도 같은 역할로 시험한다.
-- 정책이 `to authenticated`를 보므로 그 역할을 실제로 입혀야 뜻이 있다.
grant authenticated to app_user;
grant select, insert, update, delete on public.gyms, public.gym_equipment, public.gym_skips to app_user;
grant select on public.gym_equipment_summary to app_user;
grant execute on function
  public.share_gym(jsonb, jsonb),
  public.share_skip(text, text, text),
  public.unshare_skip(text, text),
  public.gym_equipment_ids(text),
  public.gym_skip_counts(text),
  public.gym_people(text),
  public.delete_my_gym_data()
  to app_user;

-- 알림 예약 쪽(schema.push.sql).
-- 실제 Supabase는 public 스키마의 새 표에 authenticated 권한을 자동으로 준다.
-- 여기서는 그걸 손으로 흉내 낸다.
grant select, insert, update, delete on public.push_queue to app_user;
grant execute on function
  public.queue_nudge(jsonb, timestamptz, text, text),
  public.cancel_nudge(),
  public.delete_my_push_data()
  to app_user;
