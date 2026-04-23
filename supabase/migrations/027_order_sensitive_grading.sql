-- 027: 단답형 순서 채점 옵션
--   order_sensitive = false (기본): 토큰 분리 후 정렬 비교(Set 비교) → 순서 무관
--   order_sensitive = true:        토큰 분리 후 배열 그대로 비교 → 순서 일치해야 정답
-- 적용 범위: type='short_answer' AND sub_count=1 AND answer_format != 'fraction'.
-- 기존 단순 문자열 비교는 "1,2,3" vs "1,3,2"를 다른 답으로 처리했으므로,
-- 이 마이그레이션 후 기본값(false)에서는 토큰 단위 Set 비교로 동작이 바뀐다.

-- =====================================================
-- 1. 컬럼 추가
-- =====================================================
alter table public.questions
  add column if not exists order_sensitive boolean not null default false;

comment on column public.questions.order_sensitive is
  '단답형(short_answer, sub_count=1) 정답이 쉼표로 구분된 토큰 배열일 때, true면 순서까지 일치해야 정답.';

-- =====================================================
-- 2. 토큰 정규화 헬퍼
--    공백 제거 후 쉼표로 분리, 빈 토큰 제외
-- =====================================================
drop function if exists public._sa_tokens(text);
create or replace function public._sa_tokens(s text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(t order by ord),
    array[]::text[]
  )
  from (
    select replace(btrim(x), ' ', '') as t, ord
    from unnest(string_to_array(coalesce(s, ''), ',')) with ordinality as u(x, ord)
  ) s
  where t <> '';
$$;

-- =====================================================
-- 3. list_questions_for_student: order_sensitive 반환 추가
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

-- =====================================================
-- 4. submit_exam_session: short_answer 분기에 order_sensitive 적용
--    수학 서술형 답 자동 채점은 _essay_answer_eq를 그대로 둔다(단일 값 비교).
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
  auto_graded boolean;
  is_example boolean;
  needs_manual boolean;
  total_score int := 0;
  total_max int := 0;
  results_arr jsonb := '[]'::jsonb;
  stud_tokens text[];
  corr_tokens text[];
  final_score int;
  -- essay 분기 로컬
  stud_obj jsonb;
  stud_process text;
  stud_answer_field text;
  answer_auto_correct boolean;
  proc_pts int;
  ans_pts int;
  answer_score int;
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
    is_example := btrim(correct) like '(예)%';
    needs_manual := q.manual_grading or q.type = 'essay' or is_example;

    -- ── 수학 서술형 분기: 답 부분 자동 채점 ──────────────
    if q.type = 'essay'
       and q.essay_mode = 'math'
       and not q.manual_grading
       and not is_example then
      begin
        stud_obj := student_answer::jsonb;
        stud_process := coalesce(stud_obj->>'process', '');
        stud_answer_field := coalesce(stud_obj->>'answer', '');
      exception when others then
        stud_process := student_answer;
        stud_answer_field := '';
      end;

      proc_pts := coalesce(q.process_points, ceil(q.points * 0.6)::int);
      ans_pts := coalesce(q.answer_points, q.points - proc_pts);

      if btrim(correct) = '' or btrim(stud_answer_field) = '' then
        answer_auto_correct := null;
        answer_score := null;
      else
        answer_auto_correct := _essay_answer_eq(stud_answer_field, correct);
        answer_score := case when answer_auto_correct then ans_pts else 0 end;
      end if;

      is_correct := null;
      auto_graded := false;
      final_score := null;

      results_arr := results_arr || jsonb_build_object(
        'questionId', q.id,
        'number', q.number,
        'type', q.type,
        'essayMode', q.essay_mode,
        'studentAnswer', student_answer,
        'studentProcess', stud_process,
        'studentAnswerField', stud_answer_field,
        'correctAnswer', correct,
        'exampleSolution', q.example_solution,
        'answerUnit', q.answer_unit,
        'processPoints', proc_pts,
        'answerPoints', ans_pts,
        'answerAutoCorrect', answer_auto_correct,
        'answerScore', answer_score,
        'processScore', null,
        'isCorrect', is_correct,
        'autoGraded', auto_graded,
        'teacherModified', false,
        'points', q.points,
        'earned', 0,
        'finalScore', final_score,
        'aiSuggestedScore', null,
        'aiReasoning', null
      );
      continue;
    end if;

    -- ── 기존 분기 ──────────────────────────────────────
    if needs_manual then
      is_correct := null;
      auto_graded := false;
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
      auto_graded := true;
    elsif q.type = 'matching' then
      is_correct := (
        replace(btrim(student_answer), ' ', '') =
        replace(btrim(correct), ' ', '')
        and btrim(correct) <> ''
      );
      auto_graded := true;
    elsif q.answer_format = 'fraction' then
      is_correct := _frac_list_eq(student_answer, correct);
      auto_graded := true;
    elsif q.type = 'short_answer' and coalesce(q.sub_count, 1) = 1 then
      -- 단답형 단일 답칸: 토큰 단위 비교 (order_sensitive로 분기)
      stud_tokens := _sa_tokens(student_answer);
      corr_tokens := _sa_tokens(correct);

      if array_length(corr_tokens, 1) is null then
        is_correct := false;
      elsif q.order_sensitive then
        is_correct := stud_tokens = corr_tokens;
      else
        -- Set 비교: 정렬 후 비교
        is_correct := (
          select coalesce(array_agg(t order by t), array[]::text[])
          from unnest(stud_tokens) as t
        ) = (
          select coalesce(array_agg(t order by t), array[]::text[])
          from unnest(corr_tokens) as t
        );
      end if;
      auto_graded := true;
    else
      -- 단답형 sub_count > 1: 위치별 비교(기존 그대로)
      is_correct := (
        replace(btrim(student_answer), ' ', '') =
        replace(btrim(correct), ' ', '')
      );
      auto_graded := true;
    end if;

    if auto_graded then
      final_score := case when is_correct = true then q.points else 0 end;
    else
      final_score := null;
    end if;

    if final_score is not null then
      total_score := total_score + final_score;
    end if;

    -- 일반 서술형도 exampleSolution / essayMode 정보는 전달
    if q.type = 'essay' then
      results_arr := results_arr || jsonb_build_object(
        'questionId', q.id,
        'number', q.number,
        'type', q.type,
        'essayMode', q.essay_mode,
        'studentAnswer', student_answer,
        'correctAnswer', correct,
        'exampleSolution', q.example_solution,
        'isCorrect', is_correct,
        'autoGraded', auto_graded,
        'teacherModified', false,
        'points', q.points,
        'earned', coalesce(final_score, 0),
        'finalScore', final_score,
        'aiSuggestedScore', null,
        'aiReasoning', null
      );
    else
      results_arr := results_arr || jsonb_build_object(
        'questionId', q.id,
        'number', q.number,
        'type', q.type,
        'studentAnswer', student_answer,
        'correctAnswer', correct,
        'isCorrect', is_correct,
        'autoGraded', auto_graded,
        'teacherModified', false,
        'points', q.points,
        'earned', coalesce(final_score, 0),
        'finalScore', final_score,
        'aiSuggestedScore', null,
        'aiReasoning', null
      );
    end if;
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
