// 학생 답 입력 보조 버튼 세트
// DB의 questions.input_buttons 는 키 배열(text[]). 빈 배열이면 버튼 없음.
// clearable=true 면 학생 UI가 "← 지우기" 버튼을 함께 노출한다.

export const INPUT_BUTTON_SETS = {
  math: {
    label: '수학 기호',
    hint: '× ÷ + - = ( )',
    symbols: ['×', '÷', '+', '-', '=', '(', ')'],
  },
  unit: {
    label: '자주 쓰는 단위',
    hint: '° cm m 만 억 원 개 명',
    symbols: ['°', 'cm', 'm', '만', '억', '원', '개', '명', '번'],
  },
  ox: {
    label: '○×',
    hint: '○ ×',
    symbols: ['○', '×'],
  },
  korean_consonant: {
    label: '한글 자음',
    hint: 'ㄱ ㄴ ㄷ ㄹ ㅁ',
    symbols: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'],
  },
  korean_consonant_seq: {
    label: '순서 기호',
    hint: 'ㄱ ㄴ ㄷ + 쉼표',
    symbols: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', ','],
    clearable: true,
  },
  circle_korean: {
    label: '원문자 한글',
    hint: '㉠ ㉡ ㉢ + 쉼표',
    symbols: ['㉠', '㉡', '㉢', '㉣', '㉤', ','],
    clearable: true,
  },
  circle_number: {
    label: '원문자 숫자',
    hint: '① ② ③ + 쉼표',
    symbols: ['①', '②', '③', '④', '⑤', ','],
    clearable: true,
  },
}

export const DEFAULT_INPUT_BUTTONS = []

// 레거시 안전장치: 문자열/null/배열 모두 받아 키 배열로 정규화.
// - 배열이면 유효 키만 남김
// - 문자열이면 'none'/''/null은 빈 배열, 그 외는 해당 키 하나
function normalizeKeys(keys) {
  if (Array.isArray(keys)) {
    return keys.filter((k) => typeof k === 'string' && INPUT_BUTTON_SETS[k])
  }
  if (typeof keys === 'string') {
    if (!keys || keys === 'none') return []
    return INPUT_BUTTON_SETS[keys] ? [keys] : []
  }
  return []
}

// 선택된 키 배열을 합쳐 중복 제거된 심볼 리스트 반환. 선택 순서 유지.
export function getButtonSymbols(keys) {
  const seen = new Set()
  const out = []
  for (const key of normalizeKeys(keys)) {
    for (const s of INPUT_BUTTON_SETS[key].symbols) {
      if (!seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  return out
}

// 선택된 세트 중 하나라도 clearable이면 "← 지우기" 버튼 노출
export function isClearable(keys) {
  return normalizeKeys(keys).some((k) => INPUT_BUTTON_SETS[k].clearable)
}
