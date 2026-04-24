-- 028: 단답형(short_answer, sub_count=1) 채점에도 기호-인덱스 매핑 적용
--   객관식에서 쓰던 _mc_norm_token (ㄷ = ㉢ = ③ = 3 = (3) = (다))을
--   단답형 토큰화 _sa_tokens 안에서 각 토큰에 적용한다.
--
--   효과:
--     정답 "㉢, ㉠, ㉡"  학생 "ㄷ, ㄱ, ㄴ"
--       → 토큰화 후 둘 다 ['3','1','2']
--       → order_sensitive=true  → 배열 비교로 정답
--       → order_sensitive=false → 정렬 Set 비교로 정답
--
--   매핑 테이블에 없는 토큰(일반 텍스트/숫자)은 _mc_norm_token의 else v로
--   원본 그대로 반환되므로 기존 동작과 동일하다.
--
--   submit_exam_session의 short_answer 분기는 그대로 유지되며,
--   _sa_tokens만 재정의하면 순서/Set 비교 양쪽에 자동 반영된다.

drop function if exists public._sa_tokens(text);
create or replace function public._sa_tokens(s text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(t order by ord),
    array[]::text[]
  )
  from (
    select _mc_norm_token(replace(btrim(x), ' ', '')) as t, ord
    from unnest(string_to_array(coalesce(s, ''), ',')) with ordinality as u(x, ord)
  ) s
  where t <> '';
$$;
