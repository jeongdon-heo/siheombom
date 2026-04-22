-- 021: (예) 예시답안 채점 보류 + 교사 수동 채점

-- =====================================================
-- 1. submit_exam_session: (예) 접두 감지 + autoGraded/teacherModified 필드 추가
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
    is_example := btrim(correct) like '(예)%';

    if q.type = 'essay' or is_example then
      -- 서술형 또는 예시답안: 자동 채점 보류
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

    if is_correct = true then
      total_score := total_score + q.points;
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

-- =====================================================
-- 2. update_question_grade
--    교사가 문항별 채점 결과 수동 수정 + 점수 재계산
-- =====================================================
drop function if exists public.update_question_grade(uuid, int, boolean);
create or replace function public.update_question_grade(
  session_id_in uuid,
  question_number_in int,
  is_correct_in boolean
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
  earned int;
  new_score int := 0;
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
      earned := case when is_correct_in then (entry->>'points')::int else 0 end;
      entry := entry
        || jsonb_build_object(
          'isCorrect', is_correct_in,
          'earned', earned,
          'teacherModified', true
        );
      updated := true;
    end if;
    if (entry->>'isCorrect')::boolean = true then
      new_score := new_score + (entry->>'earned')::int;
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

grant execute on function public.update_question_grade(uuid, int, boolean) to authenticated;

-- =====================================================
-- 3. list_exam_sessions_for_teacher
--    교사가 시험의 응시자 목록 + 점수/채점대기 수 조회
-- =====================================================
drop function if exists public.list_exam_sessions_for_teacher(uuid);
create or replace function public.list_exam_sessions_for_teacher(exam_id_in uuid)
returns table(
  session_id uuid,
  student_id uuid,
  student_name text,
  student_number int,
  submitted boolean,
  submitted_at timestamptz,
  score int,
  max_score int,
  pending_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    es.id,
    s.id,
    s.name,
    s.number,
    es.submitted,
    es.submitted_at,
    es.score,
    es.max_score,
    coalesce((
      select count(*)::int
      from jsonb_array_elements(coalesce(es.results, '[]'::jsonb)) r
      where (r->>'isCorrect') is null
    ), 0) as pending_count
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.exam_id = exam_id_in
    and e.teacher_id = auth.uid()
  order by s.number, s.name;
$$;

grant execute on function public.list_exam_sessions_for_teacher(uuid) to authenticated;

-- =====================================================
-- 4. get_session_for_teacher
--    교사가 단일 세션 상세 조회 (학생 답/정답/채점 결과 + 시험/학생 메타)
-- =====================================================
drop function if exists public.get_session_for_teacher(uuid);
create or replace function public.get_session_for_teacher(session_id_in uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', es.id,
      'submitted', es.submitted,
      'submittedAt', es.submitted_at,
      'score', es.score,
      'maxScore', es.max_score,
      'results', coalesce(es.results, '[]'::jsonb)
    ),
    'student', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'number', s.number
    ),
    'exam', jsonb_build_object(
      'id', e.id,
      'subject', e.subject,
      'unit', e.unit
    )
  )
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.id = session_id_in
    and e.teacher_id = auth.uid();
$$;

grant execute on function public.get_session_for_teacher(uuid) to authenticated;
