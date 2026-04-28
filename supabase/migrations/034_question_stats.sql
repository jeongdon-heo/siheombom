-- 034: 시험 결과 화면용 문항별 정답률 집계 RPC
--   get_question_stats_for_exam: 시험의 모든 제출 세션을 합산해 문항별 정답률 계산
--   (응시자 중 isCorrect=true 비율, 채점 대기는 분모에서 제외)

drop function if exists public.get_question_stats_for_exam(uuid);
create or replace function public.get_question_stats_for_exam(exam_id_in uuid)
returns table(
  question_number int,
  question_id uuid,
  learning_objective text,
  points int,
  total_attempts int,
  correct_count int,
  pending_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select es.id, es.results
    from exam_sessions es
    join exams e on e.id = es.exam_id
    where es.exam_id = exam_id_in
      and e.teacher_id = auth.uid()
      and es.submitted = true
  ),
  per_q as (
    select
      (r->>'number')::int as q_number,
      (r->>'isCorrect') as is_correct_raw
    from sess s,
         jsonb_array_elements(coalesce(s.results, '[]'::jsonb)) r
  ),
  agg as (
    select
      q_number,
      count(*)::int as total_attempts,
      count(*) filter (where is_correct_raw = 'true')::int as correct_count,
      count(*) filter (where is_correct_raw is null)::int as pending_count
    from per_q
    group by q_number
  )
  select
    q.number,
    q.id,
    q.learning_objective,
    q.points,
    coalesce(a.total_attempts, 0)::int,
    coalesce(a.correct_count, 0)::int,
    coalesce(a.pending_count, 0)::int
  from questions q
  join exams e on e.id = q.exam_id
  left join agg a on a.q_number = q.number
  where q.exam_id = exam_id_in
    and e.teacher_id = auth.uid()
  order by q.number;
$$;

grant execute on function public.get_question_stats_for_exam(uuid) to authenticated;
