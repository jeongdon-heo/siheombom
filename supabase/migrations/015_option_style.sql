-- 015: 객관식 보기 기호 스타일 선택
-- 시험지에 실제 쓰인 기호에 맞춰 학생 화면에 표시.

-- =====================================================
-- 1. questions.option_style 컬럼
-- =====================================================
alter table public.questions
  add column if not exists option_style text not null default 'number_circle';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_option_style_check'
  ) then
    alter table public.questions
      add constraint questions_option_style_check
      check (option_style in ('number_circle', 'korean_consonant', 'number_paren', 'korean_paren'));
  end if;
end $$;

comment on column public.questions.option_style is
  '객관식 보기 기호 스타일. number_circle=①②③, korean_consonant=ㄱㄴㄷ, number_paren=(1)(2)(3), korean_paren=(가)(나)(다)';

-- =====================================================
-- 2. 기호 → 숫자 정규화 헬퍼 (채점용)
-- =====================================================
drop function if exists public._mc_norm_token(text);
create or replace function public._mc_norm_token(t text)
returns text language sql immutable as $$
  with s as (select btrim(t) as v)
  select case v
    -- 원문자 숫자
    when '①' then '1'  when '②' then '2'  when '③' then '3'
    when '④' then '4'  when '⑤' then '5'  when '⑥' then '6'
    when '⑦' then '7'  when '⑧' then '8'  when '⑨' then '9'
    when '⑩' then '10'
    -- 한글 자음
    when 'ㄱ' then '1'  when 'ㄴ' then '2'  when 'ㄷ' then '3'
    when 'ㄹ' then '4'  when 'ㅁ' then '5'  when 'ㅂ' then '6'
    when 'ㅅ' then '7'  when 'ㅇ' then '8'  when 'ㅈ' then '9'
    when 'ㅊ' then '10'
    -- 괄호 숫자
    when '(1)' then '1'  when '(2)' then '2'  when '(3)' then '3'
    when '(4)' then '4'  when '(5)' then '5'  when '(6)' then '6'
    when '(7)' then '7'  when '(8)' then '8'  when '(9)' then '9'
    when '(10)' then '10'
    -- 괄호 한글
    when '(가)' then '1'  when '(나)' then '2'  when '(다)' then '3'
    when '(라)' then '4'  when '(마)' then '5'  when '(바)' then '6'
    when '(사)' then '7'  when '(아)' then '8'  when '(자)' then '9'
    when '(차)' then '10'
    else v
  end from s;
$$;

-- =====================================================
-- 3. list_questions_for_student: option_style 추가 반환
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
  option_style text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

-- =====================================================
-- 4. submit_exam_session: 정규화 헬퍼로 교체
--    모든 스타일의 기호를 숫자로 치환한 뒤 Set 비교
-- =====================================================
drop function if exists public.submit_exam_session(uuid, uuid);
create or replace function public.submit_exam_session(
  session_id_in uuid,
  student_id_in uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  q record;
  student_answer text;
  correct text;
  is_correct boolean;
  total_score int := 0;
  total_max int := 0;
  results_arr jsonb := '[]'::jsonb;
  stud_tokens text[];
  corr_tokens text[];
begin
  select * into sess
  from exam_sessions
  where id = session_id_in and student_id = student_id_in;

  if sess is null then
    raise exception 'session_not_found';
  end if;
  if sess.submitted then
    raise exception 'already_submitted';
  end if;

  for q in (
    select * from questions
    where exam_id = sess.exam_id
    order by number
  ) loop
    total_max := total_max + q.points;
    student_answer := coalesce(sess.answers ->> q.id::text, '');
    correct := coalesce(q.correct_answer, '');

    if q.type = 'essay' then
      is_correct := null;
    elsif q.type = 'multiple_choice' then
      -- 모든 스타일 기호를 1~10 숫자로 정규화 후 Set 비교
      select array_agg(t order by t) into stud_tokens
      from (
        select _mc_norm_token(x) as t
        from unnest(string_to_array(student_answer, ',')) as x
      ) s
      where t <> '';

      select array_agg(t order by t) into corr_tokens
      from (
        select _mc_norm_token(x) as t
        from unnest(string_to_array(correct, ',')) as x
      ) s
      where t <> '';

      is_correct := coalesce(stud_tokens, array[]::text[])
                  = coalesce(corr_tokens, array[]::text[])
                  and corr_tokens is not null;
    else
      -- 단답형: 공백 제거 후 비교
      is_correct := (
        replace(btrim(student_answer), ' ', '') =
        replace(btrim(correct), ' ', '')
      );
    end if;

    if is_correct = true then
      total_score := total_score + q.points;
    end if;

    results_arr := results_arr || jsonb_build_object(
      'questionId', q.id,
      'number', q.number,
      'studentAnswer', student_answer,
      'correctAnswer', correct,
      'isCorrect', is_correct,
      'points', q.points,
      'earned', case when is_correct = true then q.points else 0 end
    );
  end loop;

  update exam_sessions set
    submitted = true,
    submitted_at = now(),
    score = total_score,
    max_score = total_max,
    results = results_arr
  where id = session_id_in;

  return jsonb_build_object(
    'score', total_score,
    'maxScore', total_max,
    'results', results_arr
  );
end;
$$;

grant execute on function public.submit_exam_session(uuid, uuid) to anon, authenticated;
