-- 032: 학생별 시험 결과에 대한 AI 한 마디
--   * exam_sessions.ai_feedback (text) + ai_feedback_at (timestamptz)
--   * get_session_summary_for_ai: edge function에서 프롬프트 빌드용 메타·결과 조회
--   * save_session_feedback: edge function에서 결과 저장
--   * get_session_for_teacher 갱신: aiFeedback 필드 추가

-- =====================================================
-- 1. 컬럼 추가
-- =====================================================
alter table public.exam_sessions
  add column if not exists ai_feedback text,
  add column if not exists ai_feedback_at timestamptz;

comment on column public.exam_sessions.ai_feedback is
  'AI가 생성한 학생 한 마디 (잘한 점/부족한 점 한 문단). null이면 아직 생성 전.';

-- =====================================================
-- 2. get_session_summary_for_ai
--    (edge function이 프롬프트 빌드를 위해 호출)
-- =====================================================
drop function if exists public.get_session_summary_for_ai(uuid);
create or replace function public.get_session_summary_for_ai(session_id_in uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'student', jsonb_build_object('name', s.name, 'number', s.number),
    'exam', jsonb_build_object('subject', e.subject, 'unit', e.unit),
    'score', es.score,
    'maxScore', es.max_score,
    'results', coalesce(es.results, '[]'::jsonb)
  )
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.id = session_id_in
    and e.teacher_id = auth.uid()
    and es.submitted = true;
$$;

grant execute on function public.get_session_summary_for_ai(uuid) to authenticated;

-- =====================================================
-- 3. save_session_feedback
-- =====================================================
drop function if exists public.save_session_feedback(uuid, text);
create or replace function public.save_session_feedback(
  session_id_in uuid,
  feedback_in text
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
  set ai_feedback = feedback_in,
      ai_feedback_at = now()
  where id = session_id_in;
end;
$$;

grant execute on function public.save_session_feedback(uuid, text) to authenticated;

-- =====================================================
-- 4. get_session_for_teacher: aiFeedback 필드 포함
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
-- 5. list_student_history: aiFeedback 포함 (#2 학생 누적 기록용)
-- =====================================================
drop function if exists public.list_student_history(uuid);
create or replace function public.list_student_history(student_id_in uuid)
returns table(
  session_id uuid,
  exam_id uuid,
  subject text,
  unit text,
  exam_created_at timestamptz,
  submitted boolean,
  submitted_at timestamptz,
  score int,
  max_score int,
  pending_count int,
  ai_feedback text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    es.id, es.exam_id, e.subject, e.unit, e.created_at,
    es.submitted, es.submitted_at, es.score, es.max_score,
    coalesce((
      select count(*)::int
      from jsonb_array_elements(coalesce(es.results, '[]'::jsonb)) r
      where (r->>'isCorrect') is null
    ), 0) as pending_count,
    es.ai_feedback
  from exam_sessions es
  join exams e on e.id = es.exam_id
  join students s on s.id = es.student_id
  where es.student_id = student_id_in
    and e.teacher_id = auth.uid()
    and s.teacher_id = auth.uid()
  order by e.created_at desc;
$$;

grant execute on function public.list_student_history(uuid) to authenticated;

-- =====================================================
-- 6. list_exam_sessions_for_teacher: has_feedback 포함
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
  pending_count int,
  has_feedback boolean
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
    ), 0) as pending_count,
    es.ai_feedback is not null and btrim(es.ai_feedback) <> '' as has_feedback
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.exam_id = exam_id_in
    and e.teacher_id = auth.uid()
  order by s.number, s.name;
$$;

grant execute on function public.list_exam_sessions_for_teacher(uuid) to authenticated;
