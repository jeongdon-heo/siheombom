-- siheombom: 학생 + 시험 테이블, 학생 접속 RPC
-- 실행: 001 다음에 SQL Editor 에 붙여넣기

-- =====================================================
-- 1. students (교사별 학생)
-- =====================================================
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  name text not null,
  number int not null,
  created_at timestamptz not null default now(),
  unique (teacher_id, name, number)
);

create index if not exists students_teacher_idx on public.students (teacher_id);

alter table public.students enable row level security;

drop policy if exists "students select by teacher" on public.students;
create policy "students select by teacher"
  on public.students for select
  using (teacher_id = auth.uid());

drop policy if exists "students delete by teacher" on public.students;
create policy "students delete by teacher"
  on public.students for delete
  using (teacher_id = auth.uid());

-- 학생 insert/update 는 RPC (student_join) 로만 수행. 직접 insert 정책 없음.

-- =====================================================
-- 2. exams
-- =====================================================
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  subject text not null,
  unit text not null,
  created_at timestamptz not null default now()
);

create index if not exists exams_teacher_idx on public.exams (teacher_id);

alter table public.exams enable row level security;

drop policy if exists "exams select by teacher" on public.exams;
create policy "exams select by teacher"
  on public.exams for select
  using (teacher_id = auth.uid());

drop policy if exists "exams insert by teacher" on public.exams;
create policy "exams insert by teacher"
  on public.exams for insert
  with check (teacher_id = auth.uid());

drop policy if exists "exams update by teacher" on public.exams;
create policy "exams update by teacher"
  on public.exams for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists "exams delete by teacher" on public.exams;
create policy "exams delete by teacher"
  on public.exams for delete
  using (teacher_id = auth.uid());

-- =====================================================
-- 3. student_join: 학급코드 + 이름 + 번호 → 학생 행 upsert
--    anon 키로 호출 가능, 입력값 검증 포함
-- =====================================================
create or replace function public.student_join(code text, s_name text, s_number int)
returns table(
  id uuid,
  teacher_id uuid,
  name text,
  number int,
  teacher_name text,
  class_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  t_name text;
  t_class text;
  clean_name text;
  s_id uuid;
begin
  clean_name := btrim(coalesce(s_name, ''));

  if length(clean_name) = 0 then
    raise exception 'invalid_name';
  end if;

  if s_number is null or s_number < 1 or s_number > 99 then
    raise exception 'invalid_number';
  end if;

  select tid.id, tid.name, tid.class_name
    into t_id, t_name, t_class
    from public.teachers tid
    where tid.class_code = upper(btrim(code))
    limit 1;

  if t_id is null then
    raise exception 'invalid_class_code';
  end if;

  insert into public.students (teacher_id, name, number)
  values (t_id, clean_name, s_number)
  on conflict (teacher_id, name, number) do update set name = excluded.name
  returning public.students.id into s_id;

  return query
    select s.id, s.teacher_id, s.name, s.number, t_name, t_class
    from public.students s
    where s.id = s_id;
end;
$$;

grant execute on function public.student_join(text, text, int) to anon, authenticated;

-- =====================================================
-- 4. list_exams_by_class_code: 학생이 자기 학급 시험 목록 조회
-- =====================================================
create or replace function public.list_exams_by_class_code(code text)
returns table(id uuid, subject text, unit text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.subject, e.unit, e.created_at
  from public.exams e
  join public.teachers t on t.id = e.teacher_id
  where t.class_code = upper(btrim(code))
  order by e.created_at desc;
$$;

grant execute on function public.list_exams_by_class_code(text) to anon, authenticated;
