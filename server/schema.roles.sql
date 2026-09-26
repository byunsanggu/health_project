-- 사람 둘을 만든다
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- RLS를 우회하지 않는 역할로 시험해야 뜻이 있다. postgres는 BYPASSRLS라서.
drop role if exists app_user;
create role app_user login;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on public.records, public.settings to app_user;
grant execute on function public.push_records(jsonb), public.delete_my_data(), auth.uid() to app_user;
grant select on auth.users to app_user;
