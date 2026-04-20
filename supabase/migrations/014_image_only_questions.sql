-- 014: 이미지 기반 문항으로 전환
-- 문제 텍스트/보기 내용은 사용하지 않고, 문항 이미지만 학생에게 노출.
-- 객관식은 번호 버튼으로 답하므로 option_count(보기 개수)만 저장.

-- =====================================================
-- 1. questions 스키마 변경
-- =====================================================

-- text: 기존 default '' 유지하되 NOT NULL 해제 (새 플로우는 '' 로 저장)
alter table public.questions
  alter column text drop not null;

-- options: 이미 nullable. 새 플로우에서는 null 로 저장.

-- option_count 컬럼 추가 (객관식 보기 개수, 기본 5)
alter table public.questions
  add column if not exists option_count int not null default 5;

-- 기존 객관식 데이터 backfill: options 배열 길이로 복원
update public.questions
set option_count = greatest(coalesce(jsonb_array_length(options), 5), 1)
where type = 'multiple_choice'
  and option_count = 5;

comment on column public.questions.option_count is
  '객관식 보기 개수. 학생 화면에 [①]~[⑤] 버튼 렌더링에 사용.';

-- =====================================================
-- 2. list_questions_for_student: option_count 추가
--    (013 시그니처 확장)
-- =====================================================
drop function if exists public.list_questions_for_student(uuid, text);
create or replace function public.list_questions_for_student(exam_id_in uuid, code text)
returns table(
  id uuid,
  number int,
  text text,
  type text,
  options jsonb,
  points int,
  image_url text,
  sub_count int,
  passage_id uuid,
  option_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.text, q.type, q.options, q.points, q.image_url,
         q.sub_count, q.passage_id, q.option_count
  from public.questions q
  join public.exams e on e.id = q.exam_id
  join public.teachers t on t.id = e.teacher_id
  where q.exam_id = exam_id_in
    and t.class_code = upper(btrim(code))
  order by q.number;
$$;

-- =====================================================
-- 3. submit_exam_session: 객관식 채점을 번호로 정규화
--    ①②③④⑤⑥⑦⑧⑨⑩ → 1~10 치환 후 Set 비교
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
      -- ①②③④⑤⑥⑦⑧⑨ → 1~9, ⑩ → 10 정규화 후 쉼표 split + trim + Set 비교
      select array_agg(t order by t) into stud_tokens
      from (
        select btrim(
          replace(translate(x, '①②③④⑤⑥⑦⑧⑨', '123456789'), '⑩', '10')
        ) as t
        from unnest(string_to_array(student_answer, ',')) as x
      ) s
      where t <> '';

      select array_agg(t order by t) into corr_tokens
      from (
        select btrim(
          replace(translate(x, '①②③④⑤⑥⑦⑧⑨', '123456789'), '⑩', '10')
        ) as t
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
