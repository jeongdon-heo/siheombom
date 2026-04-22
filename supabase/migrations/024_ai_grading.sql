-- 024: AI 1차 채점 + 교사 확정 파이프라인
--   * results 항목에 ai_suggested_score / ai_reasoning / final_score 추가
--   * update_question_grade → final_score(int) 기반으로 변경
--   * save_ai_suggestion RPC 신규

-- =====================================================
-- 1. submit_exam_session: final_score, ai_* 필드 동기화
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
    else
      is_correct := (
        replace(btrim(student_answer), ' ', '') =
        replace(btrim(correct), ' ', '')
      );
      auto_graded := true;
    end if;

    if auto_graded then
      final_score := case when is_correct = true then q.points else 0 end;
    else
      final_score := null;  -- 수동 채점 대기
    end if;

    if final_score is not null then
      total_score := total_score + final_score;
    end if;

    results_arr := results_arr || jsonb_build_object(
      'questionId', q.id,
      'number', q.number,
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

-- =====================================================
-- 2. update_question_grade: final_score(int) 기반
--    기존 boolean 버전은 드롭 후 재정의.
-- =====================================================
drop function if exists public.update_question_grade(uuid, int, boolean);
drop function if exists public.update_question_grade(uuid, int, int);
create or replace function public.update_question_grade(
  session_id_in uuid,
  question_number_in int,
  final_score_in int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  new_results jsonb := '[]'::jsonb;
  entry jsonb;
  points int;
  new_score int := 0;
  per_score int;
  is_correct_val boolean;
  updated boolean := false;
begin
  select es.* into sess
  from exam_sessions es
  join exams e on e.id = es.exam_id
  where es.id = session_id_in and e.teacher_id = auth.uid();

  if sess is null then
    raise exception 'session_not_found_or_unauthorized';
  end if;
  if not sess.submitted then
    raise exception 'not_submitted_yet';
  end if;

  for entry in select * from jsonb_array_elements(coalesce(sess.results, '[]'::jsonb)) loop
    if (entry->>'number')::int = question_number_in then
      points := (entry->>'points')::int;
      if final_score_in < 0 or final_score_in > points then
        raise exception 'score_out_of_range';
      end if;
      is_correct_val := (final_score_in = points and points > 0);
      entry := entry
        || jsonb_build_object(
          'isCorrect', is_correct_val,
          'earned', final_score_in,
          'finalScore', final_score_in,
          'teacherModified', true
        );
      updated := true;
    end if;

    per_score := coalesce(
      nullif(entry->>'finalScore', '')::int,
      case when (entry->>'isCorrect')::boolean = true
           then coalesce(nullif(entry->>'earned','')::int, 0)
           else 0 end
    );
    if per_score is not null then
      new_score := new_score + per_score;
    end if;
    new_results := new_results || entry;
  end loop;

  if not updated then
    raise exception 'question_number_not_found';
  end if;

  update exam_sessions set
    results = new_results,
    score = new_score
  where id = session_id_in;

  return jsonb_build_object(
    'score', new_score,
    'maxScore', sess.max_score,
    'results', new_results
  );
end;
$$;

grant execute on function public.update_question_grade(uuid, int, int) to authenticated;

-- =====================================================
-- 3. save_ai_suggestion
--    AI 제안 점수/이유만 저장. 총점·확정은 변경하지 않음.
-- =====================================================
drop function if exists public.save_ai_suggestion(uuid, int, int, text);
create or replace function public.save_ai_suggestion(
  session_id_in uuid,
  question_number_in int,
  ai_score_in int,
  ai_reasoning_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  new_results jsonb := '[]'::jsonb;
  entry jsonb;
  points int;
  updated boolean := false;
begin
  select es.* into sess
  from exam_sessions es
  join exams e on e.id = es.exam_id
  where es.id = session_id_in and e.teacher_id = auth.uid();

  if sess is null then
    raise exception 'session_not_found_or_unauthorized';
  end if;

  for entry in select * from jsonb_array_elements(coalesce(sess.results, '[]'::jsonb)) loop
    if (entry->>'number')::int = question_number_in then
      points := (entry->>'points')::int;
      entry := entry
        || jsonb_build_object(
          'aiSuggestedScore', least(greatest(ai_score_in, 0), points),
          'aiReasoning', ai_reasoning_in
        );
      updated := true;
    end if;
    new_results := new_results || entry;
  end loop;

  if not updated then
    raise exception 'question_number_not_found';
  end if;

  update exam_sessions set results = new_results where id = session_id_in;

  return new_results;
end;
$$;

grant execute on function public.save_ai_suggestion(uuid, int, int, text) to authenticated;

-- =====================================================
-- 4. get_question_for_ai_grading
--    Edge Function이 필요한 문항/답안 최소 정보만 조회
-- =====================================================
drop function if exists public.get_question_for_ai_grading(uuid, int);
create or replace function public.get_question_for_ai_grading(
  session_id_in uuid,
  question_number_in int
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'points', q.points,
    'correctAnswer', q.correct_answer,
    'imageUrl', q.image_url,
    'studentAnswer', coalesce(es.answers ->> q.id::text, ''),
    'type', q.type
  )
  from exam_sessions es
  join exams e on e.id = es.exam_id
  join questions q on q.exam_id = es.exam_id and q.number = question_number_in
  where es.id = session_id_in and e.teacher_id = auth.uid();
$$;

grant execute on function public.get_question_for_ai_grading(uuid, int) to authenticated;
