-- 013: 공통 지문(passage) 지원
-- 국어 시험의 "다음 글을 읽고 물음에 답하시오. (5~7)" 처럼
-- 하나의 지문이 여러 문항에 공통 적용되는 구조를 표현.

-- =====================================================
-- 1. passages 테이블
-- =====================================================
create table if not exists public.passages (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  title text not null default '',
  image_url text,
  text_content text,
  page int,
  bbox jsonb,
  created_at timestamptz not null default now()
);

create index if not exists passages_exam_idx on public.passages (exam_id);

alter table public.passages enable row level security;

-- 교사: 자기 시험의 지문만
drop policy if exists "passages select by owner teacher" on public.passages;
create policy "passages select by owner teacher"
  on public.passages for select
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "passages insert by owner teacher" on public.passages;
create policy "passages insert by owner teacher"
  on public.passages for insert
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "passages update by owner teacher" on public.passages;
create policy "passages update by owner teacher"
  on public.passages for update
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()))
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

drop policy if exists "passages delete by owner teacher" on public.passages;
create policy "passages delete by owner teacher"
  on public.passages for delete
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

comment on table public.passages is
  '시험의 공통 지문 (국어 "다음 글을 읽고..." 처럼 여러 문항이 공유하는 지문)';

-- =====================================================
-- 2. questions.passage_id 컬럼 추가
-- =====================================================
alter table public.questions
  add column if not exists passage_id uuid
    references public.passages(id) on delete set null;

create index if not exists questions_passage_idx on public.questions (passage_id);

comment on column public.questions.passage_id is
  '연결된 공통 지문. null이면 독립 문항.';

-- =====================================================
-- 3. list_questions_for_student: passage_id 포함하여 반환
-- =====================================================
drop function if exists public.list_questions_for_student(uuid, text);
create or replace function public.list_questions_for_student(exam_id_in uuid, code text)
returns table(
  id uuid,
  number int,
  text text,
  type text,
  options jsonb,
  points int,
  image_url text,
  sub_count int,
  passage_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url, q.sub_count, q.passage_id
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

-- =====================================================
-- 4. list_passages_for_student: 학생이 class_code로 지문 조회
-- =====================================================
drop function if exists public.list_passages_for_student(uuid, text);
create or replace function public.list_passages_for_student(exam_id_in uuid, code text)
returns table(
  id uuid,
  title text,
  image_url text,
  text_content text,
  page int
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.title, p.image_url, p.text_content, p.page
  from public.passages p
  join public.exams e on e.id = p.exam_id
  join public.teachers t on t.id = e.teacher_id
  where p.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by p.page nulls last, p.created_at;
$$;

grant execute on function public.list_passages_for_student(uuid, text) to anon, authenticated;
