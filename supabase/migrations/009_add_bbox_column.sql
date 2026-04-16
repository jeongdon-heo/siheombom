-- 009: questions 테이블에 bbox 컬럼 추가
-- bbox: { "x": 0, "y": 12.5, "w": 100, "h": 25.0 } (퍼센트 좌표)
-- 기존 데이터는 bbox = null → position 폴백으로 동작

alter table public.questions
  add column if not exists bbox jsonb;

comment on column public.questions.bbox is
  '문항 이미지 crop 영역 (퍼센트 좌표). null이면 position 으로 폴백.';
