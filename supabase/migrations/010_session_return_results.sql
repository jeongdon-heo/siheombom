-- 010: start_or_resume_session에 results 컬럼 추가 반환
-- 제출 완료된 시험의 문항별 채점 결과��� 학생에게 보여주기 위함

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
  results jsonb
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
           es.started_at, es.score, es.max_score, es.results
    from exam_sessions es
    where es.id = sess_id;
end;
$$;
