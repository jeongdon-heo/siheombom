// 학생 답 입력 보조 버튼 세트
// DB의 questions.input_buttons 키와 동일.
// clearable=true 면 학생 UI가 "← 지우기" 버튼을 함께 노출한다.

export const INPUT_BUTTON_SETS = {
  none: {
    label: '없음',
    symbols: [],
  },
  ox: {
    label: '○× (O/X)',
    symbols: ['○', '×'],
  },
  math: {
    label: '수학 기호',
    symbols: ['×', '÷', '+', '-', '=', '(', ')', '만', '억'],
  },
  korean_consonant: {
    label: '한글 자음(ㄱㄴㄷ)',
    symbols: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'],
  },
  unit: {
    label: '자주 쓰는 단위',
    symbols: ['cm', 'm', '개', '만', '억', '원', '명', '번', '°'],
  },
  korean_consonant_seq: {
    label: '순서 기호 (ㄱ,ㄴ,ㄷ + 쉼표)',
    symbols: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', ','],
    clearable: true,
  },
  circle_korean: {
    label: '원문자 한글 (㉠㉡㉢ + 쉼표)',
    symbols: ['㉠', '㉡', '㉢', '㉣', '㉤', ','],
    clearable: true,
  },
  circle_number: {
    label: '원문자 숫자 (①②③ + 쉼표)',
    symbols: ['①', '②', '③', '④', '⑤', ','],
    clearable: true,
  },
}

export const DEFAULT_INPUT_BUTTONS = 'none'

export function getButtonSymbols(key) {
  return (INPUT_BUTTON_SETS[key] || INPUT_BUTTON_SETS.none).symbols
}

export function isClearable(key) {
  return Boolean((INPUT_BUTTON_SETS[key] || INPUT_BUTTON_SETS.none).clearable)
}
