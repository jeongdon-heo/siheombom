-- siheombom: 시험 세션(응시 기록) + 자동 저장 / 이어보기 / 채점
-- 실행: 006 다음에 SQL Editor 에 붙여넣기

-- =====================================================
-- 1. exam_sessions 테이블
-- =====================================================
create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,   -- { "question_id": "학생답안", ... }
  current_index int not null default 0,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted boolean not null default false,
  score int,
  max_score int,
  results jsonb,   -- 문항별 채점 결과 배열
  analysis text,    -- AI 분석 코멘트
  unique (exam_id, student_id)
);

create index if not exists exam_sessions_exam_idx on public.exam_sessions (exam_id);
create index if not exists exam_sessions_student_idx on public.exam_sessions (student_id);

alter table public.exam_sessions enable row level security;

-- 교사는 자기 시험의 세션만 조회 가능
drop policy if exists "sessions select by teacher" on public.exam_sessions;
create policy "sessions select by teacher"
  on public.exam_sessions for select
  using (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.teacher_id = auth.uid()
  ));

-- 학생 직접 접근은 RPC 로만 (anon 키 사용)

-- =====================================================
-- 2. start_or_resume_session
--    학생이 시험 시작 또는 이어보기 할 때 호출
--    없으면 생성, 있으면 기존 세션 반환
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
  max_score int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sess_id uuid;
begin
  -- 학생이 해당 시험의 교사 소속인지 검증
  if not exists (
    select 1 from students s
    join exams e on e.teacher_id = s.teacher_id
    where s.id = student_id_in and e.id = exam_id_in
  ) then
    raise exception 'unauthorized';
  end if;

  -- 기존 세션 조회
  select es.id into sess_id
  from exam_sessions es
  where es.exam_id = exam_id_in and es.student_id = student_id_in;

  -- 없으면 새로 생성
  if sess_id is null then
    insert into exam_sessions (exam_id, student_id)
    values (exam_id_in, student_id_in)
    returning exam_sessions.id into sess_id;
  end if;

  return query
    select es.id, es.answers, es.current_index, es.submitted,
           es.started_at, es.score, es.max_score
    from exam_sessions es
    where es.id = sess_id;
end;
$$;

grant execute on function public.start_or_resume_session(uuid, uuid) to anon, authenticated;

-- =====================================================
-- 3. save_session_answers
--    답안 자동 저장 (매 답 변경 시 호출)
-- =====================================================
drop function if exists public.save_session_answers(uuid, uuid, jsonb, int);
create or replace function public.save_session_answers(
  session_id_in uuid,
  student_id_in uuid,
  answers_in jsonb,
  current_index_in int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update exam_sessions
  set answers = answers_in,
      current_index = current_index_in
  where id = session_id_in
    and student_id = student_id_in
    and submitted = false;
end;
$$;

grant execute on function public.save_session_answers(uuid, uuid, jsonb, int) to anon, authenticated;

-- =====================================================
-- 4. submit_exam_session
--    시험 제출 + 자동 채점
--    객관식/단답형: 자동 채점, 서술형: null 처리
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
  stripped_student text;
  stripped_correct text;
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
      -- 서술형: 자동 채점 불가
      is_correct := null;
    elsif q.type = 'multiple_choice' then
      -- 객관식: 직접 비교 → 기호 제거 후 비교
      if btrim(student_answer) = btrim(correct) then
        is_correct := true;
      else
        stripped_student := regexp_replace(btrim(student_answer), '^[①②③④⑤⑥⑦⑧⑨⑩]\s*', '');
        stripped_correct := regexp_replace(btrim(correct), '^[①②③④⑤⑥⑦⑧⑨⑩]\s*', '');
        is_correct := (stripped_student = stripped_correct);
      end if;
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

-- =====================================================
-- 5. list_student_exams (기존 list_exams_by_class_code 대체)
--    시험 목록 + 세션 상태(진행중/완료/미시작) 함께 반환
-- =====================================================
drop function if exists public.list_student_exams(text, uuid);
create or replace function public.list_student_exams(code text, student_id_in uuid)
returns table(
  id uuid,
  subject text,
  unit text,
  question_count bigint,
  created_at timestamptz,
  session_id uuid,
  session_submitted boolean,
  session_score int,
  session_max_score int,
  session_current_index int,
  answered_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.subject,
    e.unit,
    (select count(*) from questions qq where qq.exam_id = e.id) as question_count,
    e.created_at,
    es.id as session_id,
    coalesce(es.submitted, false) as session_submitted,
    es.score as session_score,
    es.max_score as session_max_score,
    coalesce(es.current_index, 0) as session_current_index,
    case
      when es.id is not null and es.answers is not null and es.answers != '{}'::jsonb
      then (select count(*) from jsonb_each_text(es.answers))
      else 0
    end as answered_count
  from exams e
  join teachers t on t.id = e.teacher_id
  left join exam_sessions es on es.exam_id = e.id and es.student_id = student_id_in
  where t.class_code = upper(btrim(code))
  order by e.created_at desc;
$$;

grant execute on function public.list_student_exams(text, uuid) to anon, authenticated;
