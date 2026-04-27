import BboxEditor from './BboxEditor.jsx'

export function makePassageTitle(numbers) {
  if (!numbers?.length) return '지문'
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length === 1) return `지문 (${sorted[0]}번)`
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const isRange = sorted.every((n, i) => n === first + i)
  return isRange ? `지문 (${first}~${last}번)` : `지문 (${sorted.join(', ')}번)`
}

export default function PassageEditor({
  p,
  allNumbers,
  pageCount,
  examImages,
  onChange,
  onDelete,
}) {
  const update = (patch) => onChange({ ...p, ...patch })
  const pageImg = examImages?.find((img) => img.page === p.page)
  const selected = new Set(p.questionNumbers || [])

  const toggleNumber = (n) => {
    const next = new Set(selected)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    update({ questionNumbers: [...next].sort((a, b) => a - b) })
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-left"
        onClick={() => update({ expanded: !p.expanded })}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">📖</span>
          <span className="text-sm font-semibold text-gray-800 truncate">
            {makePassageTitle(p.questionNumbers)}
          </span>
          <span className="text-sm text-gray-500 shrink-0">· p.{p.page}</span>
        </div>
        <span className="text-gray-400 text-sm shrink-0">{p.expanded ? '▲' : '▼'}</span>
      </button>

      {p.expanded && (
        <div className="border-t border-amber-200/60 p-3 flex flex-col gap-3">
          {/* 페이지 선택 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">페이지</span>
            <select
              value={p.page}
              onChange={(e) => update({ page: parseInt(e.target.value, 10) })}
              className="border border-gray-300 rounded px-2 py-1 bg-white"
            >
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((pg) => (
                <option key={pg} value={pg}>p.{pg}</option>
              ))}
            </select>
          </div>

          {/* bbox 에디터 */}
          {pageImg ? (
            <BboxEditor
              pageDataUrl={pageImg.dataUrl}
              bbox={p.bbox}
              onChange={(newBbox) => update({ bbox: newBbox })}
            />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 min-h-[60px] flex items-center justify-center">
              <span className="text-sm text-gray-400 py-6">이미지 없음</span>
            </div>
          )}

          {/* 연결 문항 선택 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-gray-500">연결 문항</span>
            {allNumbers.length === 0 ? (
              <p className="text-sm text-gray-400">먼저 문항을 추가하세요.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allNumbers.map((n) => {
                  const on = selected.has(n)
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleNumber(n)}
                      className={`min-w-[40px] px-2.5 py-1.5 rounded-lg text-sm font-bold border-2 transition-colors ${
                        on
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'
                      }`}
                    >
                      {n}번
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onDelete}
            className="self-start text-sm text-red-500"
          >
            이 지문 삭제
          </button>
        </div>
      )}
    </div>
  )
}
