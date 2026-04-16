import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'

const MIN_PCT = 3

function round2(n) {
  return Math.round(n * 100) / 100
}

function clampBbox(b) {
  let { x, y, w, h } = b
  w = Math.max(MIN_PCT, Math.min(100, w))
  h = Math.max(MIN_PCT, Math.min(100, h))
  x = Math.max(0, Math.min(100 - w, x))
  y = Math.max(0, Math.min(100 - h, y))
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h) }
}

// ─── 핸들 스타일 ───
const CORNER = {
  width: 14, height: 14,
  background: '#fff', border: '2.5px solid #6366f1',
  borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.35)', zIndex: 20,
}
const EDGE_H = {
  width: 28, height: 6,
  background: '#fff', border: '1.5px solid #6366f1',
  borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,.25)', zIndex: 20,
}
const EDGE_V = {
  width: 6, height: 28,
  background: '#fff', border: '1.5px solid #6366f1',
  borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,.25)', zIndex: 20,
}
const HANDLE_STYLES = {
  topLeft: CORNER, topRight: CORNER, bottomLeft: CORNER, bottomRight: CORNER,
  top: EDGE_H, bottom: EDGE_H, left: EDGE_V, right: EDGE_V,
}

export default function BboxEditor({ pageDataUrl, bbox, onChange }) {
  const containerRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [containerSize, setContainerSize] = useState(null)
  const [imgNatural, setImgNatural] = useState(null)
  const [imgLoaded, setImgLoaded] = useState(false)

  // 드래그 중 로컬 상태 (부모 리렌더링 없이 실시간 피드백)
  const [local, setLocal] = useState(bbox)

  // prop → local 동기화 (값 기반 비교로 불필요한 리셋 방지)
  const bboxKey = `${bbox.x},${bbox.y},${bbox.w},${bbox.h}`
  useEffect(() => {
    setLocal(bbox)
  }, [bboxKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 이미지 URL 변경 시 리셋 ───
  const prevUrlRef = useRef(pageDataUrl)
  useEffect(() => {
    if (prevUrlRef.current !== pageDataUrl) {
      prevUrlRef.current = pageDataUrl
      setImgLoaded(false)
      setContainerSize(null)
      setImgNatural(null)
    }
  }, [pageDataUrl])

  // ─── 컨테이너 측정 ───
  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height })
    }
  }, [])

  // 이미지 로드 완료 → 측정
  const onImgLoad = useCallback(
    (e) => {
      setImgNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })
      setImgLoaded(true)
      // 레이아웃 완료 후 측정
      requestAnimationFrame(() => requestAnimationFrame(measure))
    },
    [measure],
  )

  // ResizeObserver: 윈도우 리사이즈 대응
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        setContainerSize({ width, height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ─── 퍼센트 → 픽셀 (메모이즈) ───
  const px = useMemo(() => {
    if (!containerSize) return null
    return {
      x: (local.x / 100) * containerSize.width,
      y: (local.y / 100) * containerSize.height,
      width: Math.max(10, (local.w / 100) * containerSize.width),
      height: Math.max(10, (local.h / 100) * containerSize.height),
    }
  }, [local.x, local.y, local.w, local.h, containerSize])

  // ─── 드래그: 로컬만 업데이트 (부모 리렌더 없음) ───
  const onDrag = useCallback(
    (_e, d) => {
      if (!containerSize) return
      setLocal((prev) =>
        clampBbox({
          x: (d.x / containerSize.width) * 100,
          y: (d.y / containerSize.height) * 100,
          w: prev.w,
          h: prev.h,
        }),
      )
    },
    [containerSize],
  )

  // ─── 드래그 종료: 부모 state 반영 ───
  const onDragStop = useCallback(
    (_e, d) => {
      if (!containerSize) return
      setLocal((prev) => {
        const next = clampBbox({
          x: (d.x / containerSize.width) * 100,
          y: (d.y / containerSize.height) * 100,
          w: prev.w,
          h: prev.h,
        })
        onChangeRef.current(next)
        return next
      })
    },
    [containerSize],
  )

  // ─── 리사이즈: 로컬만 업데이트 ───
  const onResizeHandler = useCallback(
    (_e, _dir, ref, _delta, pos) => {
      if (!containerSize) return
      setLocal(
        clampBbox({
          x: (pos.x / containerSize.width) * 100,
          y: (pos.y / containerSize.height) * 100,
          w: (ref.offsetWidth / containerSize.width) * 100,
          h: (ref.offsetHeight / containerSize.height) * 100,
        }),
      )
    },
    [containerSize],
  )

  // ─── 리사이즈 종료: 부모 state 반영 ───
  const onResizeStop = useCallback(
    (_e, _dir, ref, _delta, pos) => {
      if (!containerSize) return
      const next = clampBbox({
        x: (pos.x / containerSize.width) * 100,
        y: (pos.y / containerSize.height) * 100,
        w: (ref.offsetWidth / containerSize.width) * 100,
        h: (ref.offsetHeight / containerSize.height) * 100,
      })
      setLocal(next)
      onChangeRef.current(next)
    },
    [containerSize],
  )

  // ─── 디버그 로그 (값 변경 시에만) ───
  useEffect(() => {
    console.log('[BboxEditor]', {
      imgLoaded,
      containerSize: containerSize
        ? `${Math.round(containerSize.width)}×${Math.round(containerSize.height)}`
        : null,
      bbox: `(${bbox.x},${bbox.y}) ${bbox.w}×${bbox.h}`,
    })
  }, [bboxKey, imgLoaded, containerSize]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pageDataUrl) return null

  // 로딩 중
  if (!imgLoaded) {
    return (
      <div className="flex flex-col gap-3">
        <div ref={containerRef} className="relative rounded-lg border border-gray-200 bg-gray-100">
          <img
            src={pageDataUrl}
            onLoad={onImgLoad}
            className="w-full block"
            draggable={false}
            alt="시험지 페이지"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <span className="text-xs text-gray-400">이미지 로딩 중…</span>
          </div>
        </div>
      </div>
    )
  }

  const b = local // 디밍 + 미리보기는 로컬 상태 기반 (실시간)

  return (
    <div className="flex flex-col gap-3">
      {/* ── 에디터 영역 ── */}
      <div
        ref={containerRef}
        className="relative select-none touch-none rounded-lg border border-gray-200 bg-gray-100"
        style={{ overflow: 'hidden' }}
      >
        <img
          src={pageDataUrl}
          onLoad={onImgLoad}
          className="w-full block"
          draggable={false}
          alt="시험지 페이지"
        />

        {/* 어두운 오버레이 */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
          <div className="absolute bg-black/30" style={{ left: 0, top: 0, right: 0, height: `${b.y}%` }} />
          <div className="absolute bg-black/30" style={{ left: 0, bottom: 0, right: 0, height: `${Math.max(0, 100 - b.y - b.h)}%` }} />
          <div className="absolute bg-black/30" style={{ left: 0, top: `${b.y}%`, width: `${b.x}%`, height: `${b.h}%` }} />
          <div className="absolute bg-black/30" style={{ right: 0, top: `${b.y}%`, width: `${Math.max(0, 100 - b.x - b.w)}%`, height: `${b.h}%` }} />
        </div>

        {/* react-rnd 드래그 박스 */}
        {px ? (
          <Rnd
            bounds="parent"
            position={{ x: px.x, y: px.y }}
            size={{ width: px.width, height: px.height }}
            onDrag={onDrag}
            onDragStop={onDragStop}
            onResize={onResizeHandler}
            onResizeStop={onResizeStop}
            minWidth={containerSize ? Math.max(10, (containerSize.width * MIN_PCT) / 100) : 10}
            minHeight={containerSize ? Math.max(10, (containerSize.height * MIN_PCT) / 100) : 10}
            enableResizing={{
              top: true, right: true, bottom: true, left: true,
              topRight: true, bottomRight: true, bottomLeft: true, topLeft: true,
            }}
            style={{
              border: '3px solid #6366f1',
              background: 'rgba(99, 102, 241, 0.1)',
              zIndex: 10,
              cursor: 'move',
            }}
            resizeHandleStyles={HANDLE_STYLES}
          />
        ) : (
          /* containerSize 로딩 전 CSS 폴백 */
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.w}%`,
              height: `${b.h}%`,
              border: '3px dashed #6366f1',
              background: 'rgba(99, 102, 241, 0.1)',
              zIndex: 10,
            }}
          />
        )}
      </div>

      {/* ── crop 미리보기 ── */}
      {imgNatural && b.w > 0 && b.h > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">미리보기</p>
          <div
            className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
            style={{
              width: '100%',
              aspectRatio: `${b.w * imgNatural.w} / ${b.h * imgNatural.h}`,
              maxHeight: 180,
            }}
          >
            <img
              src={pageDataUrl}
              className="block"
              draggable={false}
              alt=""
              style={{
                width: '100%',
                transformOrigin: '0 0',
                transform: `scale(${100 / b.w}) translate(${-b.x}%, ${-b.y}%)`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
