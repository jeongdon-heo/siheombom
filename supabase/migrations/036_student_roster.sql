-- 036: 교사 학생 명단 관리 (CRUD) + 시험 결과에 미응시 학생 통합
--   1) students 테이블 insert/update 정책 추가 (교사가 직접 관리)
--   2) list_exam_sessions_for_teacher 갱신: 명단에 있지만 응시 안 한 학생도 행으로 포함

-- =====================================================
-- 1. RLS: 교사가 자기 학생을 INSERT/UPDATE 가능
-- =====================================================
drop policy if exists "students insert by teacher" on public.students;
create policy "students insert by teacher"
  on public.students for insert
  with check (teacher_id = auth.uid());

drop policy if exists "students update by teacher" on public.students;
create policy "students update by teacher"
  on public.students for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- =====================================================
-- 2. list_exam_sessions_for_teacher 갱신
--    students LEFT JOIN exam_sessions: 미응시 학생도 session_id=null 로 포함
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
  with my_exam as (
    select id, teacher_id
    from exams
    where id = exam_id_in
      and teacher_id = auth.uid()
  )
  select
    es.id,
    s.id,
    s.name,
    s.number,
    coalesce(es.submitted, false),
    es.submitted_at,
    es.score,
    es.max_score,
    coalesce((
      select count(*)::int
      from jsonb_array_elements(coalesce(es.results, '[]'::jsonb)) r
      where (r->>'isCorrect') is null
    ), 0) as pending_count,
    (es.ai_feedback is not null and btrim(es.ai_feedback) <> '') as has_feedback
  from students s
  join my_exam me on me.teacher_id = s.teacher_id
  left join exam_sessions es on es.student_id = s.id and es.exam_id = me.id
  order by s.number, s.name;
$$;

grant execute on function public.list_exam_sessions_for_teacher(uuid) to authenticated;
