-- 008: student_join 함수의 "column reference 'teacher_id' is ambiguous" 오류 수정
-- 원인: returns table(teacher_id, name, number ...) 출력 컬럼명이
--       함수 내부 SQL의 테이블 컬럼명과 충돌
-- 해결: #variable_conflict use_column 지시문으로 컬럼 우선 참조

drop function if exists public.student_join(text, text, int);
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
#variable_conflict use_column
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
  returning students.id into s_id;

  return query
    select s.id, s.teacher_id, s.name, s.number, t_name, t_class
    from public.students s
    where s.id = s_id;
end;
$$;
