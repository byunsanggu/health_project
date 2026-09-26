-- schema.sql이 실제로 하는 일을 확인한다.
--
-- Supabase에 붙이기 전에 로컬 PostgreSQL에서 돌려 본다. 붙여넣고 나서
-- "안 되는데요"를 주고받는 것보다, 여기서 먼저 틀리는 편이 싸다.
--
-- 쓰는 법 (PostgreSQL 16 기준):
--
--   initdb -D /tmp/pgcheck -A trust -U postgres
--   pg_ctl -D /tmp/pgcheck -o "-k /tmp -p 5433" start
--   psql -h /tmp -p 5433 -U postgres -f server/schema.stub.sql
--   psql -h /tmp -p 5433 -U postgres -f server/schema.sql
--   psql -h /tmp -p 5433 -U postgres -f server/schema.roles.sql
--   psql -h /tmp -p 5433 -U app_user -d postgres -f server/schema.test.sql
--
-- 확인하는 것:
--   · 남의 기록이 안 보이는가 (RLS)
--   · 남의 user_id로 INSERT가 막히는가 (with check)
--   · 오래된 기록이 새 기록을 덮지 않는가
--   · synced_at을 서버가 적는가
--   · 설정의 user_id가 저절로 채워지는가
--   · 탈퇴가 실제로 지우는가

\set QUIET on
\pset format unaligned
\pset tuples_only on

-- ── 가 사람이 기록을 올린다
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select '[가] 올리기 → ' || public.push_records('[
  {"kind":"session","id":"s1","updatedAt":"2026-09-26T10:00:00Z","deleted":false,"body":{"date":"2026-09-26"}}
]'::jsonb) || '줄';
select '[가] 내 기록 보임 → ' || count(*) || '줄' from public.records;

-- ── 나 사람으로 바꾼다
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select '[나] 가의 기록 보임 → ' || count(*) || '줄 (0이어야 함)' from public.records;

-- 나가 가의 id로 직접 넣으려 하면?
do $$
begin
  insert into public.records (user_id, kind, id, updated_at, body)
  values ('11111111-1111-1111-1111-111111111111','session','hack','2026-09-26T10:00:00Z','{}'::jsonb);
  raise notice '[나] 남의 id로 INSERT → 뚫림 ✗';
exception when others then
  raise notice '[나] 남의 id로 INSERT → 막힘 ✓ (%)', left(SQLERRM, 40);
end $$;

-- 오래된 기록이 새 기록을 덮는가
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
select '[가] 오래된 것 올리기 → ' || public.push_records('[
  {"kind":"session","id":"s1","updatedAt":"2026-09-20T00:00:00Z","deleted":false,"body":{"date":"낡은것"}}
]'::jsonb) || '줄 바뀜 (0이어야 함)';
select '[가] 남아 있는 body → ' || (body->>'date') from public.records where id='s1';

-- synced_at이 서버 시각인가
select '[가] synced_at이 updated_at보다 뒤 → ' ||
  case when synced_at > updated_at then '✓' else '✗' end from public.records where id='s1';

-- 설정: user_id를 안 보내도 채워지는가
insert into public.settings (updated_at, body) values ('2026-09-26T10:00:00Z','{"daysPerWeek":4}'::jsonb);
select '[가] 설정 user_id 자동 → ' || case when user_id = auth.uid() then '✓' else '✗' end from public.settings;

-- 탈퇴
select public.delete_my_data();
select '[가] 탈퇴 후 남은 기록 → ' || count(*) || '줄 (0이어야 함)' from public.records;
