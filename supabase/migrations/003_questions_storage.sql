-- siheombom: questions 테이블 + Storage 버킷
-- 실행: 002 다음에 SQL Editor 에 붙여넣기

-- =====================================================
-- 1. questions 테이블
-- =====================================================
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  number int not null,
  text text not null default '',
  type text not null check (type in ('multiple_choice', 'short_answer', 'essay')),
  options jsonb,
  correct_answer text,
  points int not null default 5,
  image_url text,
  learning_objective text,
  page int,
  position text check (position in ('top', 'middle', 'bottom')),
  created_at timestamptz not null default now(),
  unique (exam_id, number)
);

create index if not exists questions_exam_idx on public.questions (exam_id);

alter table public.questions enable row level security;

-- 교사: 자기 시험의 문항만
drop policy if exists "questions select by owner teacher" on public.questions;
create policy "questions select by owner teacher"
  on public.questions for select
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "questions insert by owner teacher" on public.questions;
create policy "questions insert by owner teacher"
  on public.questions for insert
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "questions update by owner teacher" on public.questions;
create policy "questions update by owner teacher"
  on public.questions for update
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()))
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "questions delete by owner teacher" on public.questions;
create policy "questions delete by owner teacher"
  on public.questions for delete
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

-- =====================================================
-- 2. 학생용: 학급코드로 문항 조회 (정답 제외)
--    학생이 시험 볼 때 questions 를 직접 SELECT 못 하므로 함수 제공
--    correct_answer 은 제외하고 반환 (채점 시 서버에서만 사용)
-- =====================================================
create or replace function public.list_questions_for_student(exam_id_in uuid, code text)
returns table(
  id uuid,
  number int,
  text text,
  type text,
  options jsonb,
  points int,
  image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

grant execute on function public.list_questions_for_student(uuid, text) to anon, authenticated;

-- =====================================================
-- 3. Storage 버킷: question-images
--    - 공개 읽기 (학생이 시험 볼 때 anon 으로 접근)
--    - 쓰기는 교사만 (자기 teacher_id 폴더에만)
-- =====================================================
insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do nothing;

-- 교사 업로드: 첫 폴더명 = 본인 teacher_id
drop policy if exists "question-images teacher upload" on storage.objects;
create policy "question-images teacher upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question-images teacher update" on storage.objects;
create policy "question-images teacher update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question-images teacher delete" on storage.objects;
create policy "question-images teacher delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 읽기는 public (버킷이 public 이라 별도 정책 없이 anon 접근 가능)
