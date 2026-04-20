import { useMemo, useState } from 'react'
import BboxEditor from './BboxEditor.jsx'
import { findBboxOnPage } from '../../../lib/pdf.js'
import { OPTION_STYLES } from '../../../lib/optionStyle.js'
import { INPUT_BUTTON_SETS } from '../../../lib/inputButtons.js'

const TYPE_LABEL = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  essay: '서술형',
}

/**
 * bbox 폴백: 페이지 내 순번 기반 추정
 * 한국 시험지 세로쓰기 순서: 왼쪽 컬럼 위→아래 채운 후 오른쪽 컬럼
 *
 * @param {number} pageIdx  같은 페이지 내 이 문항의 순번 (0부터)
 * @param {number} pageTotal 같은 페이지의 전체 문항 수
 */
function estimateBbox(pageIdx, pageTotal) {
  const N = Math.max(pageTotal, 1)
  const leftCount = Math.ceil(N / 2)
  const rightCount = N - leftCount

  if (pageIdx < leftCount) {
    // 왼쪽 컬럼
    const h = round(100 / leftCount)
    return { x: 0, y: round(pageIdx * h), w: 50, h }
  }
  // 오른쪽 컬럼
  const rIdx = pageIdx - leftCount
  const rCount = Math.max(rightCount, 1)
  const h = round(100 / rCount)
  return { x: 50, y: round(rIdx * h), w: 50, h }
}

function round(n) {
  return Math.round(n * 100) / 100
}

/** bbox 유효성 보장: 모든 값이 유한한 숫자이고 크기가 있는지 */
function isValidBbox(b) {
  return (
    b &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.w) &&
    Number.isFinite(b.h) &&
    b.w > 1 &&
    b.h > 1
  )
}

export default function QuestionCard({ q, onChange, onDelete, examImages, pageCount, pageIdx, pageTotal, textLayerBboxMap, textLayerPositions }) {
  const update = (patch) => onChange({ ...q, ...patch })
  const [toastMsg, setToastMsg] = useState('')

  const pageImg = examImages?.find((p) => p.page === q.page)

  // bbox 결정: useMemo로 참조 안정화 (불필요한 자식 리렌더 방지)
  const effectiveBbox = useMemo(() => {
    if (isValidBbox(q.bbox)) return q.bbox
    return estimateBbox(pageIdx ?? 0, pageTotal ?? 1)
  }, [q.bbox, pageIdx, pageTotal])

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-left"
        onClick={() => update({ expanded: !q.expanded })}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-8 h-8 rounded-full bg-teacher text-white text-sm font-bold flex items-center justify-center">
            {q.number}
          </span>
          <span className="text-sm text-gray-500 truncate">
            {TYPE_LABEL[q.type]} · p.{q.page}
          </span>
        </div>
        <span className="text-gray-400 text-xs shrink-0">{q.expanded ? '▲' : '▼'}</span>
      </button>

      {q.expanded && (
        <div className="border-t border-gray-100 p-3 flex flex-col gap-3">
          {/* 페이지 선택 + AI 자동 배치 */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">페이지</span>
            <select
              value={q.page}
              onChange={(e) => update({ page: parseInt(e.target.value, 10) })}
              className="border border-gray-300 rounded px-2 py-1"
            >
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>p.{p}</option>
              ))}
            </select>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setToastMsg('')
                // 현재 선택된 페이지에서 이 번호 탐색
                const onPage = findBboxOnPage(textLayerPositions || [], q.number, q.page)
                if (onPage) {
                  update({ bbox: { x: onPage.x, y: onPage.y, w: onPage.w, h: onPage.h } })
                  return
                }
                // 현재 페이지에서 못 찾음 → 다른 페이지 정보만 안내 (페이지 변경 안 함)
                const tlBbox = textLayerBboxMap?.get(q.number)
                let msg
                if (tlBbox) {
                  msg = `현재 페이지에서 ${q.number}번을 찾지 못했습니다. (p.${tlBbox.page}에서 감지됨)`
                } else if (textLayerBboxMap?.size > 0) {
                  msg = `${q.number}번 문항을 PDF에서 찾지 못했습니다.`
                } else {
                  msg = '이 PDF는 스캔본이라 자동 배치를 지원하지 않습니다.'
                }
                setToastMsg(msg)
                setTimeout(() => setToastMsg(''), 3000)
              }}
              className="px-2.5 py-1 rounded border border-gray-300 text-gray-500 hover:border-teacher hover:text-teacher"
            >
              자동 배치
            </button>
          </div>
          {toastMsg && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg py-1.5 px-3 text-center">
              {toastMsg}
            </p>
          )}

          {/* 컬럼 빠른 전환 */}
          {pageImg && (() => {
            const b = effectiveBbox
            const mode = b.w > 65 ? 'full' : b.x < 25 ? 'left' : 'right'
            const btn = (label, active, onClick) => (
              <button
                type="button"
                onClick={onClick}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? 'bg-teacher text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            )
            return (
              <div className="flex gap-1.5">
                {btn('◀ 왼쪽', mode === 'left', () =>
                  update({ bbox: { ...b, x: 0, w: 50 } }),
                )}
                {btn('전체 너비', mode === 'full', () =>
                  update({ bbox: { ...b, x: 0, w: 100 } }),
                )}
                {btn('오른쪽 ▶', mode === 'right', () =>
                  update({ bbox: { ...b, x: 50, w: 50 } }),
                )}
              </div>
            )
          })()}

          {/* bbox 에디터 */}
          {pageImg ? (
            <BboxEditor
              pageDataUrl={pageImg.dataUrl}
              bbox={effectiveBbox}
              onChange={(newBbox) => update({ bbox: newBbox })}
            />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 min-h-[60px] flex items-center justify-center">
              <span className="text-xs text-gray-400 py-6">이미지 없음</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">번호</span>
              <input
                type="number"
                min={1}
                value={q.number}
                onChange={(e) => update({ number: parseInt(e.target.value, 10) || 1 })}
                className="border border-gray-300 rounded px-2 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">답칸 수</span>
              <input
                type="number"
                min={1}
                max={10}
                value={q.sub_count ?? 1}
                onChange={(e) => update({ sub_count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="border border-gray-300 rounded px-2 py-2"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-gray-500">유형</span>
            <select
              value={q.type}
              onChange={(e) => update({ type: e.target.value })}
              className="border border-gray-300 rounded px-2 py-2"
            >
              <option value="multiple_choice">객관식</option>
              <option value="short_answer">단답형</option>
              <option value="essay">서술형</option>
            </select>
          </label>

          {q.type === 'multiple_choice' && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">보기 개수</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={q.option_count ?? 5}
                  onChange={(e) =>
                    update({
                      option_count: Math.max(2, Math.min(10, parseInt(e.target.value, 10) || 5)),
                    })
                  }
                  className="border border-gray-300 rounded px-2 py-2"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">보기 기호</span>
                <select
                  value={q.option_style || 'number_circle'}
                  onChange={(e) => update({ option_style: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-2"
                >
                  {Object.entries(OPTION_STYLES).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(q.type === 'short_answer' || q.type === 'essay') && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">입력 보조 버튼</span>
              <select
                value={q.input_buttons || 'none'}
                onChange={(e) => update({ input_buttons: e.target.value })}
                className="border border-gray-300 rounded px-2 py-2"
              >
                {Object.entries(INPUT_BUTTON_SETS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-gray-500">
              정답{q.type === 'multiple_choice' && ' (번호만, 복수면 쉼표로 구분)'}
            </span>
            <input
              value={q.correct_answer}
              onChange={(e) => update({ correct_answer: e.target.value })}
              placeholder={q.type === 'multiple_choice' ? '예) 2  또는  ②, ③' : ''}
              className="border border-gray-300 rounded px-2 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-gray-500">학습 목표</span>
            <input
              value={q.learning_objective}
              onChange={(e) => update({ learning_objective: e.target.value })}
              className="border border-gray-300 rounded px-2 py-2 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={onDelete}
            className="self-start text-xs text-red-500 mt-2"
          >
            이 문항 삭제
          </button>
        </div>
      )}
    </div>
  )
}
