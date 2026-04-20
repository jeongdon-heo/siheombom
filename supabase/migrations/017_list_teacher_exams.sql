-- 017: 교사 시험 목록 RPC (문항수, 응시자수 포함)

drop function if exists public.list_teacher_exams();
create or replace function public.list_teacher_exams()
returns table(
  id uuid,
  subject text,
  unit text,
  created_at timestamptz,
  question_count bigint,
  session_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id, e.subject, e.unit, e.created_at,
    (select count(*) from questions q where q.exam_id = e.id) as question_count,
    (select count(*) from exam_sessions s where s.exam_id = e.id and s.submitted = true) as session_count
  from exams e
  where e.teacher_id = auth.uid()
  order by e.created_at desc;
$$;

grant execute on function public.list_teacher_exams() to authenticated;
