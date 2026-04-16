// 문항별 이미지 crop 유틸

import { loadImage } from './pdf.js'

// ─── position 폴백용 (레거시) ───
const REGIONS = {
  top: [0.0, 0.42],
  middle: [0.28, 0.72],
  bottom: [0.58, 1.0],
}

/**
 * 공통 캔버스 crop + 리사이즈
 * @param {HTMLImageElement} img
 * @param {number} sx 원본 x
 * @param {number} sy 원본 y
 * @param {number} sw 원본 width
 * @param {number} sh 원본 height
 * @param {{ mime?:string, quality?:number, maxWidth?:number }} opts
 */
async function cropRect(img, sx, sy, sw, sh, opts = {}) {
  const { mime = 'image/jpeg', quality = 0.85, maxWidth = 1200 } = opts

  // 최소 1px 보장
  const srcW = Math.max(Math.round(sw), 1)
  const srcH = Math.max(Math.round(sh), 1)

  const scale = srcW > maxWidth ? maxWidth / srcW : 1
  const dstW = Math.round(srcW * scale)
  const dstH = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = dstW
  canvas.height = dstH
  canvas.getContext('2d').drawImage(img, sx, sy, srcW, srcH, 0, 0, dstW, dstH)

  const dataUrl = canvas.toDataURL(mime, quality)
  const blob = await new Promise((res) => canvas.toBlob(res, mime, quality))
  return { dataUrl, blob, width: dstW, height: dstH }
}

/**
 * bbox 퍼센트 좌표로 crop
 * @param {string} pageDataUrl 원본 페이지 이미지
 * @param {{ x:number, y:number, w:number, h:number }} bbox 퍼센트(0~100)
 * @param {object} opts
 */
export async function cropByBbox(pageDataUrl, bbox, opts = {}) {
  const img = await loadImage(pageDataUrl)
  const sx = Math.floor(img.width * (bbox.x / 100))
  const sy = Math.floor(img.height * (bbox.y / 100))
  const sw = Math.ceil(img.width * (bbox.w / 100))
  const sh = Math.ceil(img.height * (bbox.h / 100))
  return cropRect(img, sx, sy, sw, sh, opts)
}

/**
 * position(top/middle/bottom) 기반 crop — 레거시 폴백
 * @param {string} pageDataUrl 원본 페이지 이미지
 * @param {'top'|'middle'|'bottom'} position
 * @param {object} opts
 */
export async function cropByPosition(pageDataUrl, position, opts = {}) {
  const region = REGIONS[position] ?? REGIONS.middle
  const img = await loadImage(pageDataUrl)
  const y0 = Math.floor(img.height * region[0])
  const y1 = Math.ceil(img.height * region[1])
  return cropRect(img, 0, y0, img.width, y1 - y0, opts)
}
