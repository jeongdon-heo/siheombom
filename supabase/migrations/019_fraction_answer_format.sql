-- 019: 답 형식(answer_format) 추가 + 분수 채점 지원

-- =====================================================
-- 1. questions.answer_format 컬럼
-- =====================================================
alter table public.questions
  add column if not exists answer_format text not null default 'text';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_answer_format_check'
  ) then
    alter table public.questions
      add constraint questions_answer_format_check
      check (answer_format in ('text', 'fraction'));
  end if;
end $$;

comment on column public.questions.answer_format is
  '단답형 답 형식. text=일반 텍스트, fraction=분수(저장은 "a/b" 또는 "w a/b")';

-- =====================================================
-- 2. 분수 파싱 헬퍼: "a/b" | "w a/b" | 정수 → int[]{num,den}
--    약분된 가분수 형태로 반환. 파싱 실패 시 NULL.
-- =====================================================
drop function if exists public._frac_parse(text);
create or replace function public._frac_parse(s text)
returns int[]
language plpgsql
immutable
as $$
declare
  v text;
  m text[];
  w int;
  n int;
  d int;
  g int;
  sign int;
begin
  v := btrim(coalesce(s, ''));
  if v = '' then return null; end if;

  -- 대분수: "w a/b"
  m := regexp_match(v, '^(-?\d+)\s+(\d+)\s*/\s*(\d+)$');
  if m is not null then
    w := m[1]::int;
    n := m[2]::int;
    d := m[3]::int;
    if d = 0 then return null; end if;
    sign := case when w < 0 then -1 else 1 end;
    n := sign * (abs(w) * d + n);
    g := gcd(abs(n), d);
    if g = 0 then g := 1; end if;
    return array[n / g, d / g];
  end if;

  -- 일반 분수: "a/b"
  m := regexp_match(v, '^(-?\d+)\s*/\s*(\d+)$');
  if m is not null then
    n := m[1]::int;
    d := m[2]::int;
    if d = 0 then return null; end if;
    g := gcd(abs(n), d);
    if g = 0 then g := 1; end if;
    return array[n / g, d / g];
  end if;

  -- 정수만: "5"
  m := regexp_match(v, '^(-?\d+)$');
  if m is not null then
    return array[m[1]::int, 1];
  end if;

  return null;
end;
$$;

-- =====================================================
-- 3. 분수 리스트 동치 비교
--    "3/4, 1 1/2" 형태를 쉼표로 분리 후 각각 약분해 Set(multiset) 비교
-- =====================================================
drop function if exists public._frac_list_eq(text, text);
create or replace function public._frac_list_eq(student text, correct text)
returns boolean
language plpgsql
immutable
as $$
declare
  stud_parts int[][];
  corr_parts int[][];
  part int[];
  x text;
begin
  stud_parts := array[]::int[][];
  for x in select unnest(string_to_array(coalesce(student, ''), ',')) loop
    part := _frac_parse(x);
    if part is null then return false; end if;
    stud_parts := stud_parts || array[part];
  end loop;

  corr_parts := array[]::int[][];
  for x in select unnest(string_to_array(coalesce(correct, ''), ',')) loop
    part := _frac_parse(x);
    if part is null then return false; end if;
    corr_parts := corr_parts || array[part];
  end loop;

  if array_length(stud_parts, 1) is distinct from array_length(corr_parts, 1) then
    return false;
  end if;

  -- 정렬 후 요소별 비교
  return (
    select coalesce(array_agg(p order by p), array[]::int[][])
    from unnest(stud_parts) p
  ) = (
    select coalesce(array_agg(p order by p), array[]::int[][])
    from unnest(corr_parts) p
  );
end;
$$;

-- =====================================================
-- 4. list_questions_for_student: answer_format 반환
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
  answer_format text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count, q.option_style,
         q.input_buttons, q.answer_format
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

-- =====================================================
-- 5. submit_exam_session: 분수 채점 분기 추가
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
    elsif q.answer_format = 'fraction' then
      -- 분수: 쉼표 분리 → 각 항을 약분해서 비교
      is_correct := _frac_list_eq(student_answer, correct);
    else
      -- 단답형 텍스트: 공백 제거 후 비교
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
