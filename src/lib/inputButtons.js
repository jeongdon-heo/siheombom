// 학생 답 입력 보조 버튼 세트
// DB의 questions.input_buttons 키와 동일.

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
}

export const DEFAULT_INPUT_BUTTONS = 'none'

export function getButtonSymbols(key) {
  return (INPUT_BUTTON_SETS[key] || INPUT_BUTTON_SETS.none).symbols
}
