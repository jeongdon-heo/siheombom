-- 016: 학생 답 입력 보조 버튼 세트
-- 단답형/서술형 문항에 ○×, 수학 기호, 한글 자음 등 입력 버튼을 노출.

alter table public.questions
  add column if not exists input_buttons text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_input_buttons_check'
  ) then
    alter table public.questions
      add constraint questions_input_buttons_check
      check (input_buttons in ('none', 'ox', 'math', 'korean_consonant'));
  end if;
end $$;

comment on column public.questions.input_buttons is
  '학생 답 입력 보조 버튼 세트. none/ox/math/korean_consonant.';

-- list_questions_for_student 확장
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
  input_buttons text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style, q.input_buttons
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;
