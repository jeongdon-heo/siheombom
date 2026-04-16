-- siheombom: Storage 정책 수정 (foldername → LIKE 패턴)
-- 실행: 003 다음. 이미 003 실행했어도 다시 돌려도 안전.

-- 기존 정책 제거
drop policy if exists "question-images teacher upload" on storage.objects;
drop policy if exists "question-images teacher update" on storage.objects;
drop policy if exists "question-images teacher delete" on storage.objects;

-- LIKE 패턴: 객체 이름이 "{auth.uid}/" 로 시작하는지만 체크
create policy "question-images teacher upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

create policy "question-images teacher update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

create policy "question-images teacher delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'question-images'
    and name like auth.uid()::text || '/%'
  );

-- 혹시 RLS 자체가 꺼져있다면 다시 켜기 (Supabase 기본 ON 이지만 보험)
alter table storage.objects enable row level security;
