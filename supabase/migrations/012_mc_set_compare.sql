-- 012: 객관식 복수 정답을 순서 무관 Set 비교로 채점
-- "③, ②" vs "②, ③" → 정답 처리

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
  total_score int := 0;
  total_max int := 0;
  results_arr jsonb := '[]'::jsonb;
  stud_tokens text[];
  corr_tokens text[];
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

    if q.type = 'essay' then
      is_correct := null;
    elsif q.type = 'multiple_choice' then
      -- 쉼표 split → 각 토큰 trim → 정렬된 배열(Set)로 비교
      select array_agg(t order by t) into stud_tokens
      from (
        select btrim(x) as t
        from unnest(string_to_array(student_answer, ',')) as x
      ) s
      where t <> '';

      select array_agg(t order by t) into corr_tokens
      from (
        select btrim(x) as t
        from unnest(string_to_array(correct, ',')) as x
      ) s
      where t <> '';

      is_correct := coalesce(stud_tokens, array[]::text[])
                  = coalesce(corr_tokens, array[]::text[])
                  and corr_tokens is not null;
    else
      -- 단답형: 공백 제거 후 비교
      is_correct := (
        replace(btrim(student_answer), ' ', '') =
        replace(btrim(correct), ' ', '')
      );
    end if;

    if is_correct = true then
      total_score := total_score + q.points;
    end if;

    results_arr := results_arr || jsonb_build_object(
      'questionId', q.id,
      'number', q.number,
      'studentAnswer', student_answer,
      'correctAnswer', correct,
      'isCorrect', is_correct,
      'points', q.points,
      'earned', case when is_correct = true then q.points else 0 end
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
