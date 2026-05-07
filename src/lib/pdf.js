// PDF → 페이지별 이미지 (dataURL) 변환
// pdfjs-dist 5.x + Vite

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

/**
 * PDF 파일을 페이지별 이미지로 변환
 * @param {File|Blob|ArrayBuffer} source
 * @param {{ scale?: number, maxPages?: number, mime?: string, quality?: number }} opts
 * @returns {Promise<Array<{page:number, dataUrl:string, width:number, height:number}>>}
 */
export async function pdfToImages(source, opts = {}) {
  const { scale = 2.0, maxPages = 20, mime = 'image/jpeg', quality = 0.85 } = opts

  const data = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  const pdf = await getDocument({ data }).promise

  const pageCount = Math.min(pdf.numPages, maxPages)
  const results = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')

    await page.render({ canvasContext: ctx, viewport }).promise

    results.push({
      page: i,
      dataUrl: canvas.toDataURL(mime, quality),
      width: canvas.width,
      height: canvas.height,
    })

    page.cleanup()
  }

  await pdf.cleanup()
  await pdf.destroy()
  return results
}

/** dataURL → Blob */
export function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:([^;]+);/.exec(meta)?.[1] ?? 'application/octet-stream'
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** dataURL → base64 만 (data: prefix 제거) */
export function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

/** dataURL 의 media type 추출 (예: "image/jpeg") */
export function dataUrlMediaType(dataUrl) {
  return /data:([^;]+);/.exec(dataUrl)?.[1] ?? 'image/jpeg'
}

/** dataURL → HTMLImageElement */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** 이미지 가로폭을 maxWidth 로 제한해 dataURL 재인코딩 (AI 요청 크기 절감) */
export async function resizeDataUrl(
  dataUrl,
  { maxWidth = 1024, quality = 0.85, mime = 'image/jpeg' } = {},
) {
  const img = await loadImage(dataUrl)
  if (img.width <= maxWidth) return dataUrl
  const ratio = maxWidth / img.width
  const canvas = document.createElement('canvas')
  canvas.width = maxWidth
  canvas.height = Math.round(img.height * ratio)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL(mime, quality)
}

/* ──────── 텍스트 레이어 기반 문항 번호 위치 감지 ──────── */

/** 헤더 영역 기준 (페이지 상단 N%) — 학년/반/번호 등 메타 정보 영역 제외 */
const HEADER_ZONE_PCT = 5

/**
 * 텍스트 아이템에서 문항 번호 파싱
 * @returns {{ num: number, confident: boolean } | null}
 * confident=true: "1.", "2)" 등 구분자가 있어 확신 높음
 * confident=false: 단독 숫자 "1", "2" 등 오탐 가능
 */
function parseQuestionNumber(str) {
  const s = str.trim()
  if (!s) return null

  // ①②③④⑤ — 보기 번호이므로 제외
  // "4-1", "5-2" 같은 학년-학기 패턴도 제외
  if (/^\d+-\d+$/.test(s)) return null

  // "1.", "2.", "15." — 마침표 있으면 문항 번호 확신 높음
  let m = /^(\d{1,2})\.\s*$/.exec(s)
  if (m) return { num: parseInt(m[1], 10), confident: true }

  // "1)", "2)"
  m = /^(\d{1,2})\)\s*$/.exec(s)
  if (m) return { num: parseInt(m[1], 10), confident: true }

  // "(1)", "(2)" — 소문항 번호일 수 있으므로 낮은 신뢰도
  m = /^\((\d{1,2})\)\s*$/.exec(s)
  if (m) return { num: parseInt(m[1], 10), confident: false }

  // "1번", "2번"
  m = /^(\d{1,2})번\s*$/.exec(s)
  if (m) return { num: parseInt(m[1], 10), confident: true }

  // 단독 숫자 "1", "2" — 오탐 가능성 높으므로 낮은 신뢰도
  m = /^(\d{1,2})\s*$/.exec(s)
  if (m) return { num: parseInt(m[1], 10), confident: false }

  return null
}

/** 컬럼 시작점(0% 또는 50%)과의 거리 — 문항 번호 vs 본문 숫자 구분용 */
function columnStartDist(xPct) {
  return Math.min(Math.abs(xPct), Math.abs(xPct - 50))
}

/**
 * 중복 번호 필터:
 * 1. confident 후보 우선 (구분자 있는 "1.", "2)" 등)
 * 2. 같은 신뢰도면 컬럼 시작점에 가장 가까운 것 선택
 */
function deduplicatePositions(raw) {
  const byNum = new Map()
  for (const r of raw) {
    if (!byNum.has(r.number)) byNum.set(r.number, [])
    byNum.get(r.number).push(r)
  }
  const result = []
  for (const [num, candidates] of byNum) {
    // confident 후보가 있으면 그것만 남김
    const confidents = candidates.filter((c) => c.confident)
    const pool = confidents.length > 0 ? confidents : candidates
    pool.sort((a, b) => columnStartDist(a.xPct) - columnStartDist(b.xPct))
    const winner = pool[0]
    result.push(winner)
  }
  return result.sort((a, b) => a.number - b.number)
}

/**
 * PDF 텍스트 레이어에서 문항 번호의 (x, y) 좌표 추출
 * PDF 좌표(좌하단 원점)를 퍼센트(좌상단 원점)로 변환
 * @param {File|Blob|ArrayBuffer} source
 * @returns {Promise<Array<{page:number, number:number, xPct:number, yPct:number}>>}
 */
export async function extractTextPositions(source, opts = {}) {
  const { maxPages = 20 } = opts
  const data = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  const pdf = await getDocument({ data }).promise
  const pageCount = Math.min(pdf.numPages, maxPages)

  const raw = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()

    for (const item of tc.items) {
      const parsed = parseQuestionNumber(item.str)
      if (parsed == null || parsed.num < 1 || parsed.num > 50) continue

      const tx = item.transform
      // PDF 좌표(좌하단 원점) → 퍼센트(좌상단 원점): y축 반전
      const xPct = (tx[4] / vp.width) * 100
      const yPct = (1 - tx[5] / vp.height) * 100

      // 헤더 영역 필터: 페이지 상단 N% 이내는 제목/학년/반 등이므로 제외
      if (yPct < HEADER_ZONE_PCT) continue
      // 페이지 하단 5% 이내도 페이지 번호 등이므로 제외
      if (yPct > 95) continue

      raw.push({ page: i, number: parsed.num, xPct, yPct, confident: parsed.confident })
    }

    page.cleanup()
  }

  await pdf.cleanup()
  await pdf.destroy()

  return deduplicatePositions(raw)
}

/**
 * 텍스트 레이어 위치 기반 bbox 자동 계산
 * - 같은 페이지 문항들을 좌/우 컬럼으로 분리
 * - 각 문항의 높이 = 다음 문항(같은 컬럼) y − 현재 y (없으면 나머지 전부)
 * @param {Array<{page:number, number:number, xPct:number, yPct:number}>} positions
 * @returns {Map<number, {x:number, y:number, w:number, h:number, page:number}>}
 */
export function computeBboxesFromTextLayer(positions) {
  if (!positions.length) return new Map()

  const byPage = new Map()
  for (const p of positions) {
    if (!byPage.has(p.page)) byPage.set(p.page, [])
    byPage.get(p.page).push(p)
  }

  const result = new Map()
  const r = (n) => Math.round(n * 100) / 100

  for (const [page, items] of byPage) {
    const left = items.filter((i) => i.xPct < 50).sort((a, b) => a.yPct - b.yPct)
    const right = items.filter((i) => i.xPct >= 50).sort((a, b) => a.yPct - b.yPct)

    const processColumn = (col, colX) => {
      for (let i = 0; i < col.length; i++) {
        const curr = col[i]
        const next = col[i + 1]
        const y = Math.max(0, curr.yPct - 2) // 번호 위 약간 여백
        const h = next
          ? Math.max(5, next.yPct - curr.yPct) // 다음 문항까지
          : 100 - y // 마지막 문항: 페이지 끝까지
        result.set(curr.number, {
          x: colX,
          y: r(y),
          w: 50,
          h: r(Math.min(h, 100 - y)),
          page,
        })
      }
    }

    processColumn(left, 0)
    processColumn(right, 50)
  }

  return result
}

/**
 * 특정 페이지에서 특정 문항 번호의 bbox 계산 (자동 배치 버튼용)
 * 교사가 페이지를 수동 변경한 후 재탐색할 때 사용
 * @param {Array} positions  extractTextPositions 결과
 * @param {number} questionNumber
 * @param {number} targetPage
 * @returns {{ x:number, y:number, w:number, h:number } | null}
 */
export function findBboxOnPage(positions, questionNumber, targetPage) {
  const pageItems = positions.filter((p) => p.page === targetPage)
  if (!pageItems.length) return null

  const target = pageItems.find((p) => p.number === questionNumber)
  if (!target) return null

  const isLeft = target.xPct < 50
  const col = pageItems
    .filter((i) => (i.xPct < 50) === isLeft)
    .sort((a, b) => a.yPct - b.yPct)
  const colX = isLeft ? 0 : 50
  const idx = col.findIndex((c) => c.number === questionNumber)

  const curr = col[idx]
  const next = col[idx + 1]
  const y = Math.max(0, curr.yPct - 2)
  const h = next ? Math.max(5, next.yPct - curr.yPct) : 100 - y
  const r = (n) => Math.round(n * 100) / 100

  return { x: colX, y: r(y), w: 50, h: r(Math.min(h, 100 - y)) }
}
