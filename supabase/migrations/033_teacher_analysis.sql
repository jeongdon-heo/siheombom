-- 033: 학생용 짧은 피드백 + 교사용 상세 학습 분석 분리
--   * exam_sessions.ai_teacher_analysis (text) 추가
--   * save_session_feedback: 두 필드 동시 저장으로 시그니처 확장
--   * get_session_for_teacher: aiTeacherAnalysis 포함
--   * start_or_resume_session: ai_feedback 반환 (학생용만, 교사용은 안 노출)

-- =====================================================
-- 1. 컬럼 추가
-- =====================================================
alter table public.exam_sessions
  add column if not exists ai_teacher_analysis text;

comment on column public.exam_sessions.ai_teacher_analysis is
  '교사용 상세 학습 분석 (학습 목표 기반, 마크다운). 학생에게는 노출되지 않음.';

-- =====================================================
-- 2. save_session_feedback (시그니처 확장)
-- =====================================================
drop function if exists public.save_session_feedback(uuid, text);
drop function if exists public.save_session_feedback(uuid, text, text);
create or replace function public.save_session_feedback(
  session_id_in uuid,
  student_feedback_in text,
  teacher_analysis_in text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owns boolean;
begin
  select exists(
    select 1 from exam_sessions es
    join exams e on e.id = es.exam_id
    where es.id = session_id_in and e.teacher_id = auth.uid()
  ) into owns;

  if not owns then
    raise exception 'session_not_found_or_unauthorized';
  end if;

  update exam_sessions
  set ai_feedback = student_feedback_in,
      ai_teacher_analysis = teacher_analysis_in,
      ai_feedback_at = now()
  where id = session_id_in;
end;
$$;

grant execute on function public.save_session_feedback(uuid, text, text) to authenticated;

-- =====================================================
-- 3. get_session_for_teacher: aiTeacherAnalysis 포함
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
      'results', coalesce(es.results, '[]'::jsonb),
      'aiFeedback', es.ai_feedback,
      'aiTeacherAnalysis', es.ai_teacher_analysis,
      'aiFeedbackAt', es.ai_feedback_at
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

-- =====================================================
-- 4. start_or_resume_session: ai_feedback 반환 (학생용만)
-- =====================================================
drop function if exists public.start_or_resume_session(uuid, uuid);
create or replace function public.start_or_resume_session(
  exam_id_in uuid,
  student_id_in uuid
)
returns table(
  id uuid,
  answers jsonb,
  current_index int,
  submitted boolean,
  started_at timestamptz,
  score int,
  max_score int,
  results jsonb,
  ai_feedback text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sess_id uuid;
begin
  if not exists (
    select 1 from students s
    join exams e on e.teacher_id = s.teacher_id
    where s.id = student_id_in and e.id = exam_id_in
  ) then
    raise exception 'unauthorized';
  end if;

  select es.id into sess_id
  from exam_sessions es
  where es.exam_id = exam_id_in and es.student_id = student_id_in;

  if sess_id is null then
    insert into exam_sessions (exam_id, student_id)
    values (exam_id_in, student_id_in)
    returning exam_sessions.id into sess_id;
  end if;

  return query
    select es.id, es.answers, es.current_index, es.submitted,
           es.started_at, es.score, es.max_score, es.results,
           es.ai_feedback
    from exam_sessions es
    where es.id = sess_id;
end;
$$;

grant execute on function public.start_or_resume_session(uuid, uuid) to anon, authenticated;

-- =====================================================
-- 5. get_session_summary_for_ai: learning_objective 포함 (교사 분석용)
-- =====================================================
drop function if exists public.get_session_summary_for_ai(uuid);
create or replace function public.get_session_summary_for_ai(session_id_in uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with q_meta as (
    select id, learning_objective
    from questions
    where exam_id = (select exam_id from exam_sessions where id = session_id_in)
  ),
  numbered as (
    select ord, r, q.learning_objective
    from jsonb_array_elements(
      coalesce(
        (select results from exam_sessions where id = session_id_in),
        '[]'::jsonb
      )
    ) with ordinality as t(r, ord)
    left join q_meta q on q.id = (t.r->>'questionId')::uuid
  ),
  results_with_lo as (
    select coalesce(
      jsonb_agg(
        r || jsonb_build_object('learningObjective', learning_objective)
        order by ord
      ),
      '[]'::jsonb
    ) as items
    from numbered
  )
  select jsonb_build_object(
    'student', jsonb_build_object('name', s.name, 'number', s.number),
    'exam', jsonb_build_object('subject', e.subject, 'unit', e.unit),
    'score', es.score,
    'maxScore', es.max_score,
    'results', (select items from results_with_lo)
  )
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.id = session_id_in
    and e.teacher_id = auth.uid()
    and es.submitted = true;
$$;

grant execute on function public.get_session_summary_for_ai(uuid) to authenticated;
