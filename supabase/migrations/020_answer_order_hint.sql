-- 020: 답 순서 안내 문구 (sub_count > 1 문항에서 학생에게 표시)

-- =====================================================
-- 1. questions.answer_order_hint 컬럼
-- =====================================================
alter table public.questions
  add column if not exists answer_order_hint text not null default '';

comment on column public.questions.answer_order_hint is
  '답칸이 여러 개일 때 학생에게 보여줄 안내 문구. 빈 문자열이면 미표시.';

-- =====================================================
-- 2. list_questions_for_student: answer_order_hint 추가 반환
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
  passage_id uuid,
  option_count int,
  option_style text,
  input_buttons text,
  answer_format text,
  answer_order_hint text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style,
         q.input_buttons, q.answer_format, q.answer_order_hint
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;
