-- 035: 엑셀 다운로드용 응시자 × 문항 결과 매트릭스 RPC
--   get_exam_results_matrix: 시험의 응시자별 점수와 results JSONB를 한 번에 반환

drop function if exists public.get_exam_results_matrix(uuid);
create or replace function public.get_exam_results_matrix(exam_id_in uuid)
returns table(
  student_id uuid,
  student_name text,
  student_number int,
  submitted boolean,
  submitted_at timestamptz,
  score int,
  max_score int,
  results jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.number,
    es.submitted,
    es.submitted_at,
    es.score,
    es.max_score,
    coalesce(es.results, '[]'::jsonb)
  from exam_sessions es
  join students s on s.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.exam_id = exam_id_in
    and e.teacher_id = auth.uid()
  order by s.number, s.name;
$$;

grant execute on function public.get_exam_results_matrix(uuid) to authenticated;
