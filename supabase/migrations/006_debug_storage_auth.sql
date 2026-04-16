-- siheombom: Storage RLS 디버깅 + 임시 업로드 허용
-- 목적:
--   1) 브라우저에서 auth.uid() 가 Storage 컨텍스트에서 어떻게 평가되는지 확인할 수 있는 RPC 제공
--   2) RLS 자체가 원인인지 격리하기 위해 임시 전면허용 정책 투입
--
-- 실행: 005 다음. SQL Editor 에 전체 붙여넣고 Run.
-- 디버깅 끝나면 반드시 하단 "롤백" 섹션을 돌려서 임시 정책 제거할 것.

-- =====================================================
-- 1. whoami RPC
--    브라우저 Supabase 클라이언트에서 호출하면 PG 가 보는 role + uid 그대로 돌려줌
--    Storage 는 별개 서비스라 여기서 보이는 uid 와 Storage 내부 uid 가 다를 수 있음 →
--    그 차이가 있으면 JWT 를 Storage 가 제대로 못 읽는다는 증거
-- =====================================================
create or replace function public.whoami()
returns table(uid uuid, role text, jwt_sub text, jwt_role text)
language sql
stable
security invoker
as $$
  select
    auth.uid()                                            as uid,
    current_setting('request.jwt.claim.role', true)       as role,
    current_setting('request.jwt.claim.sub', true)        as jwt_sub,
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') as jwt_role;
$$;

grant execute on function public.whoami() to anon, authenticated, public;

-- =====================================================
-- 2. 현재 적용된 Storage 정책 확인용 뷰 조회 (SQL Editor 에서 직접 SELECT)
--    아래 쿼리를 SQL Editor 에 따로 붙여 실행해서 005 의 v2 정책이 살아있는지 확인:
--
--    select policyname, roles, cmd, qual, with_check
--    from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--
--    기대 결과: "qi teacher upload v2" / roles = {public} / with_check 에 auth.uid() 포함
-- =====================================================

-- =====================================================
-- 3. 임시 전면허용 정책 (디버깅 전용!!)
--    - 이걸 켠 상태에서 업로드가 성공하면 → 원인은 100% RLS 정책 매칭 실패
--    - 이걸 켠 상태에서도 실패하면 → 원인은 RLS 가 아님 (버킷 미존재, CORS, 네트워크, 잘못된 키 등)
-- =====================================================
drop policy if exists "qi debug allow all insert" on storage.objects;
create policy "qi debug allow all insert"
  on storage.objects for insert
  to public
  with check (bucket_id = 'question-images');

drop policy if exists "qi debug allow all update" on storage.objects;
create policy "qi debug allow all update"
  on storage.objects for update
  to public
  using (bucket_id = 'question-images');

-- =====================================================
-- 4. 롤백 (디버깅 끝나면 이 블록만 떼서 실행!)
-- =====================================================
-- drop policy if exists "qi debug allow all insert" on storage.objects;
-- drop policy if exists "qi debug allow all update" on storage.objects;
