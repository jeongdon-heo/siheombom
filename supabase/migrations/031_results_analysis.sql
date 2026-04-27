-- 031: 결과 분석 페이지용 RPC 모음
--   1) list_teacher_exams_with_stats: 시험 목록 + 평균/최고/최저/채점대기 학생수
--   2) get_session_id_by_student_exam: (시험, 학생) → 세션 id (라우팅용)
--   3) list_student_history: 학생의 모든 시험 응시 기록
--   4) get_student_for_teacher: 학생 단일 조회 (history 헤더용)

-- =====================================================
-- 1) list_teacher_exams_with_stats
-- =====================================================
drop function if exists public.list_teacher_exams_with_stats();
create or replace function public.list_teacher_exams_with_stats()
returns table(
  id uuid,
  subject text,
  unit text,
  created_at timestamptz,
  question_count bigint,
  submitted_count bigint,
  class_size bigint,
  avg_score numeric,
  max_score_observed int,
  min_score_observed int,
  max_score_total int,
  pending_student_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id, e.subject, e.unit, e.created_at,
    (select count(*) from questions q where q.exam_id = e.id) as question_count,
    (select count(*) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as submitted_count,
    (select count(*) from students st where st.teacher_id = e.teacher_id) as class_size,
    (select round(avg(s.score)::numeric, 1) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as avg_score,
    (select max(s.score) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as max_score_observed,
    (select min(s.score) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as min_score_observed,
    (select max(s.max_score) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as max_score_total,
    (select count(distinct s.id) from exam_sessions s
       where s.exam_id = e.id and s.submitted = true
       and exists (
         select 1 from jsonb_array_elements(coalesce(s.results, '[]'::jsonb)) r
         where (r->>'isCorrect') is null
       )) as pending_student_count
  from exams e
  where e.teacher_id = auth.uid()
  order by e.created_at desc;
$$;

grant execute on function public.list_teacher_exams_with_stats() to authenticated;

-- =====================================================
-- 2) get_session_id_by_student_exam
-- =====================================================
drop function if exists public.get_session_id_by_student_exam(uuid, uuid);
create or replace function public.get_session_id_by_student_exam(exam_id_in uuid, student_id_in uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select es.id
  from exam_sessions es
  join exams e on e.id = es.exam_id
  where es.exam_id = exam_id_in
    and es.student_id = student_id_in
    and e.teacher_id = auth.uid()
  limit 1;
$$;

grant execute on function public.get_session_id_by_student_exam(uuid, uuid) to authenticated;

-- =====================================================
-- 3) list_student_history
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
  pending_count int
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
    ), 0) as pending_count
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
-- 4) get_student_for_teacher
-- =====================================================
drop function if exists public.get_student_for_teacher(uuid);
create or replace function public.get_student_for_teacher(student_id_in uuid)
returns table(id uuid, name text, number int)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, number
  from students
  where id = student_id_in
    and teacher_id = auth.uid();
$$;

grant execute on function public.get_student_for_teacher(uuid) to authenticated;
