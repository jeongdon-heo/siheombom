-- siheombom: 교사 프로필 + 학급코드 시스템
-- 실행: Supabase 대시보드 SQL Editor 에 그대로 붙여넣기

-- =====================================================
-- 1. teachers (프로필) 테이블
-- =====================================================
create table if not exists public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  class_name text not null,
  class_code text not null unique,
  provider text check (provider in ('gemini', 'claude')),
  api_key_encrypted text,
  created_at timestamptz not null default now()
);

-- 학급코드 조회 빠르게
create index if not exists teachers_class_code_idx on public.teachers (class_code);

-- =====================================================
-- 2. RLS
-- =====================================================
alter table public.teachers enable row level security;

drop policy if exists "teachers select own" on public.teachers;
create policy "teachers select own"
  on public.teachers for select
  using (auth.uid() = id);

drop policy if exists "teachers update own" on public.teachers;
create policy "teachers update own"
  on public.teachers for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "teachers insert own" on public.teachers;
create policy "teachers insert own"
  on public.teachers for insert
  with check (auth.uid() = id);

-- =====================================================
-- 3. 학급코드 생성기 (혼동 문자 제외: 0,1,I,O,L)
-- =====================================================
drop function if exists public.gen_class_code();
create or replace function public.gen_class_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text;
  i int;
  tries int := 0;
begin
  loop
    result := '';
    for i in 1..6 loop
      result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.teachers where class_code = result);
    tries := tries + 1;
    if tries > 100 then
      raise exception 'could not generate unique class code after 100 tries';
    end if;
  end loop;
  return result;
end;
$$;

-- =====================================================
-- 4. auth.users 신규 가입 시 teachers 프로필 자동 생성
--    회원가입 시 options.data 에 name, class_name 전달
-- =====================================================
drop function if exists public.handle_new_teacher() cascade;
create or replace function public.handle_new_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- teachers 에 해당 role 인 경우에만 생성 (학생은 auth 미사용이라 항상 교사)
  insert into public.teachers (id, name, email, class_name, class_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'class_name', ''),
    public.gen_class_code()
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_teacher();

-- =====================================================
-- 5. 학생용: 학급코드로 교사 조회 (anon 접근 가능)
--    RLS 때문에 teachers 를 직접 select 못 하므로 함수로 노출
-- =====================================================
drop function if exists public.find_teacher_by_class_code(text);
create or replace function public.find_teacher_by_class_code(code text)
returns table(id uuid, name text, class_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, class_name
  from public.teachers
  where class_code = upper(code)
  limit 1;
$$;

grant execute on function public.find_teacher_by_class_code(text) to anon, authenticated;

-- =====================================================
-- 6. 학급코드 재생성 (교사 본인만)
-- =====================================================
drop function if exists public.regenerate_class_code();
create or replace function public.regenerate_class_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  new_code := public.gen_class_code();
  update public.teachers set class_code = new_code where id = auth.uid();
  return new_code;
end;
$$;

grant execute on function public.regenerate_class_code() to authenticated;
