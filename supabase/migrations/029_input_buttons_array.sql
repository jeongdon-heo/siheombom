-- 029: input_buttons를 복수 선택 가능하도록 text → text[] 로 전환
--   기존: 단일 키 문자열 ('none' | 'math' | ...)
--   변경: 키 배열. '없음'은 빈 배열([]).
--
--   마이그레이션 매핑:
--     'none' 또는 null  →  array[]::text[]
--     그 외 단일 키    →  array[<key>]::text[]
--
--   list_questions_for_student 반환 타입도 text → text[] 로 변경.

-- =====================================================
-- 1. questions.input_buttons 타입 변경
-- =====================================================
alter table public.questions
  drop constraint if exists questions_input_buttons_check;

alter table public.questions
  alter column input_buttons drop default;

alter table public.questions
  alter column input_buttons type text[] using
    case
      when input_buttons is null or input_buttons = 'none' or input_buttons = ''
        then array[]::text[]
      else array[input_buttons]::text[]
    end;

alter table public.questions
  alter column input_buttons set default array[]::text[];

alter table public.questions
  alter column input_buttons set not null;

comment on column public.questions.input_buttons is
  '학생 입력 보조 버튼 키 배열. 빈 배열이면 버튼 없음. 사용 가능 키: math, unit, ox, korean_consonant, korean_consonant_seq, circle_korean, circle_number.';

-- =====================================================
-- 2. list_questions_for_student: input_buttons 반환 타입 text[] 로
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
  input_buttons text[],
  answer_format text,
  answer_order_hint text,
  match_count int,
  manual_grading boolean,
  order_sensitive boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style,
         q.input_buttons, q.answer_format, q.answer_order_hint, q.match_count,
         q.manual_grading, q.order_sensitive
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

grant execute on function public.list_questions_for_student(uuid, text) to anon, authenticated;
