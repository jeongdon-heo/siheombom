// 객관식 보기 기호 스타일 정의
// DB의 questions.option_style 과 동일한 키를 사용.

export const OPTION_STYLES = {
  number_circle: {
    label: '①②③ (원문자 숫자)',
    symbols: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'],
  },
  korean_consonant: {
    label: 'ㄱㄴㄷ (한글 자음)',
    symbols: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'],
  },
  korean_consonant_circle: {
    label: '㉠㉡㉢ (원문자 한글 자음)',
    symbols: ['㉠', '㉡', '㉢', '㉣', '㉤', '㉥', '㉦', '㉧', '㉨', '㉩'],
  },
  number_paren: {
    label: '(1)(2)(3) (괄호 숫자)',
    symbols: ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)', '(9)', '(10)'],
  },
  korean_paren: {
    label: '(가)(나)(다) (괄호 한글)',
    symbols: ['(가)', '(나)', '(다)', '(라)', '(마)', '(바)', '(사)', '(아)', '(자)', '(차)'],
  },
}

export const DEFAULT_OPTION_STYLE = 'number_circle'

export function getSymbols(style, count) {
  const s = OPTION_STYLES[style] || OPTION_STYLES[DEFAULT_OPTION_STYLE]
  const n = Math.max(2, Math.min(10, count || 5))
  return s.symbols.slice(0, n)
}
