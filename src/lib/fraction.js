// 분수 유틸
// 저장 형식:
//  - 일반 분수:  "a/b"    (예: "3/4")
//  - 대분수:     "w a/b"  (예: "1 3/4", 공백 1칸)
//  - 복수 답칸:  쉼표로 연결  "3/4, 1 3/4"

const gcd = (a, b) => {
  a = Math.abs(a | 0)
  b = Math.abs(b | 0)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a || 1
}

/**
 * "a/b" 또는 "w a/b" 문자열을 { num, den } (가분수, 약분됨)으로 파싱.
 * 부호는 num에 실어 반환. 파싱 실패 시 null.
 */
export function parseFraction(str) {
  if (str == null) return null
  const s = String(str).trim()
  if (!s) return null

  // 대분수: "w a/b"
  let m = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (m) {
    const w = parseInt(m[1], 10)
    const n = parseInt(m[2], 10)
    const d = parseInt(m[3], 10)
    if (d === 0) return null
    const sign = w < 0 ? -1 : 1
    const num = sign * (Math.abs(w) * d + n)
    return reduce(num, d)
  }

  // 일반 분수: "a/b"
  m = s.match(/^(-?\d+)\s*\/\s*(\d+)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    const d = parseInt(m[2], 10)
    if (d === 0) return null
    return reduce(n, d)
  }

  // 정수만: "5"  →  5/1
  m = s.match(/^(-?\d+)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    return reduce(n, 1)
  }

  return null
}

function reduce(num, den) {
  if (den < 0) {
    num = -num
    den = -den
  }
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

/** 두 분수 문자열이 같은 유리수인지 (약분 기준) */
export function fractionEquals(a, b) {
  const fa = parseFraction(a)
  const fb = parseFraction(b)
  if (!fa || !fb) return false
  return fa.num === fb.num && fa.den === fb.den
}

/**
 * 분수/대분수 UI용 파싱.
 * mode='simple'이면 { whole:'', num, den }
 * mode='mixed'이면 { whole, num, den }
 * 빈 값이면 모두 ''
 */
export function splitFractionInput(str) {
  const s = (str ?? '').trim()
  if (!s) return { whole: '', num: '', den: '' }

  let m = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (m) return { whole: m[1], num: m[2], den: m[3] }

  m = s.match(/^(-?\d+)\s*\/\s*(\d+)$/)
  if (m) return { whole: '', num: m[1], den: m[2] }

  return { whole: '', num: '', den: '' }
}

/** whole/num/den → 저장 문자열 */
export function joinFractionInput({ whole, num, den }, isMixed) {
  const n = String(num ?? '').trim()
  const d = String(den ?? '').trim()
  if (isMixed) {
    const w = String(whole ?? '').trim()
    if (!w && !n && !d) return ''
    if (!n || !d) return `${w || ''} ${n || ''}/${d || ''}`.trim()
    return `${w || '0'} ${n}/${d}`
  }
  if (!n && !d) return ''
  return `${n}/${d}`
}
