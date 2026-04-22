-- 025: Essay 서술형 답/풀이 분리 + 부분 점수 자동 채점
--   * questions: answer_unit / example_solution / process_points / answer_points
--   * submit_exam_session: essay의 답 부분(JSON answer 필드) 자동 채점
--     (풀이 과정은 기존대로 수동/AI 채점)
--   * 학생 답 저장 형식(새 essay): JSON { "process": "...", "answer": "..." }
--     과거 plain string 답도 호환(읽을 때 process로 간주, answer는 빈 값)

-- =====================================================
-- 1. 컬럼 추가
-- =====================================================
alter table public.questions
  add column if not exists answer_unit text,
  add column if not exists example_solution text,
  add column if not exists process_points int,
  add column if not exists answer_points int;

comment on column public.questions.answer_unit is
  '답 입력 칸 옆에 표시할 단위 (예: °, cm, 원). null이면 단위 표시 없음.';
comment on column public.questions.example_solution is
  'essay 문항의 예시 풀이 과정 (AI 채점 참고 및 교사 참고용).';
comment on column public.questions.process_points is
  'essay 풀이 과정 배점. null이면 ceil(points*0.6)로 계산.';
comment on column public.questions.answer_points is
  'essay 답 배점. null이면 points - process_points로 계산.';

-- =====================================================
-- 2. 답 자동 비교 헬퍼
--    규칙: 숫자+부호+소수점만 남겨서 둘 다 유효 숫자면 숫자 비교,
--          아니면 btrim 텍스트 비교.
-- =====================================================
drop function if exists public._essay_answer_eq(text, text);
create or replace function public._essay_answer_eq(stud text, corr text)
returns boolean
language plpgsql
immutable
as $$
declare
  sa text;
  sb text;
begin
  if stud is null or corr is null then
    return false;
  end if;
  sa := regexp_replace(stud, '[^0-9.+\-]', '', 'g');
  sb := regexp_replace(corr, '[^0-9.+\-]', '', 'g');
  if sa ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
     and sb ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then
    begin
      return sa::numeric = sb::numeric;
    exception when others then
      -- 숫자 파싱 실패 시 텍스트 비교로 폴백
      null;
    end;
  end if;
  return btrim(stud) = btrim(corr);
end;
$$;

-- =====================================================
-- 3. submit_exam_session: essay 분기 추가
--    - correct_answer가 '(예)'로 시작하거나 manual_grading=true면
--      기존처럼 전체 수동.
--    - 그 외 essay는 JSON { process, answer } 파싱 시도 → 답 부분 자동 채점.
--      최종 확정 전이므로 isCorrect / finalScore 는 여전히 null
--      (answerScore만 저장해두고 교사 확정 시 합산).
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

    -- ── essay 분기 (수동 채점이지만 답 부분은 자동) ────────
    if q.type = 'essay' and not q.manual_grading and not is_example then
      -- 학생 답 JSON 파싱 시도 (실패 시 plain string → process로 간주)
      begin
        stud_obj := student_answer::jsonb;
        stud_process := coalesce(stud_obj->>'process', '');
        stud_answer_field := coalesce(stud_obj->>'answer', '');
      exception when others then
        stud_process := student_answer;
        stud_answer_field := '';
      end;

      -- 배점: 저장값 우선, 없으면 60:40 자동
      proc_pts := coalesce(q.process_points, ceil(q.points * 0.6)::int);
      ans_pts := coalesce(q.answer_points, q.points - proc_pts);

      -- 답 자동 채점 (정답 있으면만)
      if btrim(correct) = '' or btrim(stud_answer_field) = '' then
        answer_auto_correct := null;
        answer_score := null;
      else
        answer_auto_correct := _essay_answer_eq(stud_answer_field, correct);
        answer_score := case when answer_auto_correct then ans_pts else 0 end;
      end if;

      -- 전체 확정은 아직 — 교사 확정 전이라 null
      is_correct := null;
      auto_graded := false;
      final_score := null;

      results_arr := results_arr || jsonb_build_object(
        'questionId', q.id,
        'number', q.number,
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

    -- ── 기존 분기 (objective / matching / fraction / short_answer / manual) ──
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
      final_score := null;
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
