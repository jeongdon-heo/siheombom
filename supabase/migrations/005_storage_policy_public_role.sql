-- siheombom: Storage 정책 최종화
--
-- 배경 (2026-04):
-- 1) 이 Supabase 프로젝트는 JWT 를 ES256 (asymmetric) 으로 서명하는데,
--    Storage 서비스가 요청을 Postgres 로 전달할 때 role 을 'authenticated' 로
--    전환해주지 않아 "to authenticated" 정책이 평가되지 않음.
--    auth.uid() 는 정상이므로 role 은 public 으로 풀고 uid 매칭만 사용.
-- 2) Storage 가 정책을 내부적으로 캐싱하는데, 같은 이름으로 drop+recreate
--    해도 캐시가 안 풀려서 구 정책(to authenticated) 이 계속 평가됨.
--    이름을 새로 주면 캐시 히트 없이 fresh 평가. 그래서 v2 suffix.
--
-- 실행: 004 다음. 재실행 안전.

-- 진단용으로 만들었던 임시 정책 전부 제거
drop policy if exists "qi insert test permissive" on storage.objects;
drop policy if exists "qi diag allow auth" on storage.objects;
drop policy if exists "qi diag allow any role" on storage.objects;
drop policy if exists "qi diag public with uid match" on storage.objects;

-- 003/004 에서 만들었던 캐시 오염된 정책 제거
drop policy if exists "question-images teacher upload" on storage.objects;
drop policy if exists "question-images teacher update" on storage.objects;
drop policy if exists "question-images teacher delete" on storage.objects;

-- 최종 정책: to public + auth.uid() 경로 매칭
-- anon 은 auth.uid() = null 이라 name like 'null/%' 은 false → 자동 차단
create policy "qi teacher upload v2"
  on storage.objects for insert
  to public
  with check (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

create policy "qi teacher update v2"
  on storage.objects for update
  to public
  using (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

create policy "qi teacher delete v2"
  on storage.objects for delete
  to public
  using (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

alter table storage.objects enable row level security;
