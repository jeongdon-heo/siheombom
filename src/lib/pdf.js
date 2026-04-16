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
