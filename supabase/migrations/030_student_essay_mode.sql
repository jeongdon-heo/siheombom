-- 030: list_questions_for_student 가 essay_mode / answer_unit 도 반환하도록
--   기존 029 정의에서는 두 컬럼이 빠져 있어 학생 화면에서 항상 essay_mode=undefined로 떨어져
--   수학 서술형 문항도 textarea 하나만 표시되던 문제를 수정.

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
  input_buttons text[],
  answer_format text,
  answer_order_hint text,
  match_count int,
  manual_grading boolean,
  order_sensitive boolean,
  essay_mode text,
  answer_unit text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style,
         q.input_buttons, q.answer_format, q.answer_order_hint, q.match_count,
         q.manual_grading, q.order_sensitive, q.essay_mode, q.answer_unit
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

grant execute on function public.list_questions_for_student(uuid, text) to anon, authenticated;
