-- 026: 서술형 모드(essay_mode) 도입
--   * general: 일반 서술형 (국어/사회 등) — 전체 수동/AI 채점
--   * math:    수학 서술형 — 답 부분 자동 채점 + 풀이 과정 수동/AI

-- =====================================================
-- 1. 컬럼 추가
-- =====================================================
alter table public.questions
  add column if not exists essay_mode text not null default 'general';

alter table public.questions
  drop constraint if exists questions_essay_mode_check;

alter table public.questions
  add constraint questions_essay_mode_check
  check (essay_mode in ('general', 'math'));

comment on column public.questions.essay_mode is
  '서술형 모드. general=일반(전체 수동), math=수학(답 자동 채점 + 풀이 수동). type=essay가 아니면 의미 없음.';

-- =====================================================
-- 2. submit_exam_session: essay_mode='math'일 때만 답 자동 채점
--    (general은 type=essay 기본 수동 분기로 흘러감)
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
