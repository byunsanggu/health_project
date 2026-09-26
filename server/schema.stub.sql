-- Supabase에만 있는 것들을 흉내 낸다. 스키마가 문법적으로 도는지,
-- 정책과 함수가 실제로 붙는지 확인하려는 것이다.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());

-- 로그인한 사람의 id. 테스트에서는 세션 변수로 흉내 낸다.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
