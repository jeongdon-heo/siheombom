-- 011: questions에 sub_count(소문항 수) 컬럼 추가
-- 하위 문항이 있는 문제 (1)...(2) 의 답칸 개수

alter table public.questions
  add column if not exists sub_count int not null default 1;

-- list_questions_for_student에 sub_count 추가 반환
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
  sub_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url, q.sub_count
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;
