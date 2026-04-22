-- 018: 보기 기호 스타일에 "원문자 한글 자음(㉠㉡㉢)" 추가

-- =====================================================
-- 1. option_style check 제약 확장
-- =====================================================
alter table public.questions
  drop constraint if exists questions_option_style_check;

alter table public.questions
  add constraint questions_option_style_check
  check (option_style in (
    'number_circle',
    'korean_consonant',
    'korean_consonant_circle',
    'number_paren',
    'korean_paren'
  ));

comment on column public.questions.option_style is
  '객관식 보기 기호 스타일. number_circle=①②③, korean_consonant=ㄱㄴㄷ, korean_consonant_circle=㉠㉡㉢, number_paren=(1)(2)(3), korean_paren=(가)(나)(다)';

-- =====================================================
-- 2. _mc_norm_token: 원문자 한글 자음 토큰 추가
-- =====================================================
drop function if exists public._mc_norm_token(text);
create or replace function public._mc_norm_token(t text)
returns text language sql immutable as $$
  with s as (select btrim(t) as v)
  select case v
    -- 원문자 숫자
    when '①' then '1'  when '②' then '2'  when '③' then '3'
    when '④' then '4'  when '⑤' then '5'  when '⑥' then '6'
    when '⑦' then '7'  when '⑧' then '8'  when '⑨' then '9'
    when '⑩' then '10'
    -- 한글 자음
    when 'ㄱ' then '1'  when 'ㄴ' then '2'  when 'ㄷ' then '3'
    when 'ㄹ' then '4'  when 'ㅁ' then '5'  when 'ㅂ' then '6'
    when 'ㅅ' then '7'  when 'ㅇ' then '8'  when 'ㅈ' then '9'
    when 'ㅊ' then '10'
    -- 원문자 한글 자음
    when '㉠' then '1'  when '㉡' then '2'  when '㉢' then '3'
    when '㉣' then '4'  when '㉤' then '5'  when '㉥' then '6'
    when '㉦' then '7'  when '㉧' then '8'  when '㉨' then '9'
    when '㉩' then '10'
    -- 괄호 숫자
    when '(1)' then '1'  when '(2)' then '2'  when '(3)' then '3'
    when '(4)' then '4'  when '(5)' then '5'  when '(6)' then '6'
    when '(7)' then '7'  when '(8)' then '8'  when '(9)' then '9'
    when '(10)' then '10'
    -- 괄호 한글
    when '(가)' then '1'  when '(나)' then '2'  when '(다)' then '3'
    when '(라)' then '4'  when '(마)' then '5'  when '(바)' then '6'
    when '(사)' then '7'  when '(아)' then '8'  when '(자)' then '9'
    when '(차)' then '10'
    else v
  end from s;
$$;
