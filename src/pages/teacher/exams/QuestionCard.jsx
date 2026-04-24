import { useMemo, useState } from 'react'
import BboxEditor from './BboxEditor.jsx'
import { findBboxOnPage } from '../../../lib/pdf.js'
import { OPTION_STYLES } from '../../../lib/optionStyle.js'
import { INPUT_BUTTON_SETS } from '../../../lib/inputButtons.js'
import { splitFractionInput, joinFractionInput } from '../../../lib/fraction.js'

const TYPE_LABEL = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  essay: '서술형',
  matching: '연결형',
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
  const update = (patch) => {
    const next = { ...q, ...patch }
    // 정답이 "(예)"로 시작하면 자동으로 수동 채점 체크
    if (
      typeof patch.correct_answer === 'string' &&
      patch.correct_answer.trim().startsWith('(예)')
    ) {
      next.manual_grading = true
    }
    onChange(next)
  }
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
              <option value="matching">연결형</option>
            </select>
          </label>

          {q.type === 'essay' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">서술형 모드</span>
              <select
                value={q.essay_mode || 'general'}
                onChange={(e) => update({ essay_mode: e.target.value })}
                className="border border-gray-300 rounded px-2 py-2"
              >
                <option value="general">일반 서술형 (국어·사회 등)</option>
                <option value="math">수학 서술형 (풀이+답 분리)</option>
              </select>
            </label>
          )}

          <label
            className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
              q.manual_grading
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-gray-50 border-gray-200 text-gray-700'
            }`}
          >
            <input
              type="checkbox"
              checked={q.manual_grading === true}
              onChange={(e) => update({ manual_grading: e.target.checked })}
              className="w-4 h-4 accent-teacher"
            />
            <span className="flex-1">
              선생님이 채점 (자동 채점하지 않음)
              {q.type === 'essay' && (q.essay_mode || 'general') === 'math' && (
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  체크 안 하면 답 부분만 자동 채점, 풀이 과정은 수동/AI 채점
                </span>
              )}
              {q.type === 'essay' && (q.essay_mode || 'general') === 'general' && (
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  일반 서술형은 전체 수동/AI 채점
                </span>
              )}
            </span>
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

          {q.type === 'matching' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">연결 개수</span>
              <input
                type="number"
                min={2}
                max={10}
                value={q.match_count ?? 3}
                onChange={(e) =>
                  update({
                    match_count: Math.max(2, Math.min(10, parseInt(e.target.value, 10) || 3)),
                  })
                }
                className="border border-gray-300 rounded px-2 py-2"
              />
            </label>
          )}

          {(q.type === 'short_answer' || q.type === 'essay') && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">입력 보조 버튼 (복수 선택)</span>
              <div className="flex flex-col gap-1 border border-gray-300 rounded px-2 py-2 bg-white">
                {Object.entries(INPUT_BUTTON_SETS).map(([key, { label, hint }]) => {
                  const selected = Array.isArray(q.input_buttons) ? q.input_buttons : []
                  const checked = selected.includes(key)
                  return (
                    <label key={key} className="flex items-center gap-2 cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected.filter((k) => k !== key), key]
                            : selected.filter((k) => k !== key)
                          update({ input_buttons: next })
                        }}
                      />
                      <span className="text-gray-800">{label}</span>
                      {hint && <span className="text-xs text-gray-400">({hint})</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {q.type === 'short_answer' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">답 형식</span>
              <select
                value={q.answer_format || 'text'}
                onChange={(e) => update({ answer_format: e.target.value })}
                className="border border-gray-300 rounded px-2 py-2"
              >
                <option value="text">일반 텍스트</option>
                <option value="fraction">분수</option>
              </select>
            </label>
          )}

          {q.type === 'short_answer' &&
            (q.sub_count ?? 1) === 1 &&
            (q.answer_format || 'text') !== 'fraction' && (
              <label
                className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${
                  q.order_sensitive
                    ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={q.order_sensitive === true}
                  onChange={(e) => update({ order_sensitive: e.target.checked })}
                  className="w-4 h-4 mt-0.5 accent-teacher"
                />
                <span className="flex-1">
                  순서대로 채점
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    체크 시 답의 순서가 일치해야 정답 (예: "ㄱ, ㄷ, ㄴ").
                    체크 안 하면 순서 무관 (Set 비교)
                  </span>
                </span>
              </label>
            )}

          {(q.sub_count ?? 1) > 1 && q.type !== 'multiple_choice' && (
            <AnswerOrderHintInput
              value={q.answer_order_hint || ''}
              onChange={(v) => update({ answer_order_hint: v })}
            />
          )}

          {q.type === 'short_answer' && q.answer_format === 'fraction' ? (
            <FractionAnswerInput
              value={q.correct_answer || ''}
              subCount={q.sub_count ?? 1}
              onChange={(v) => update({ correct_answer: v })}
            />
          ) : q.type === 'short_answer' && (q.sub_count ?? 1) > 1 ? (
            <MultiTextAnswerInput
              value={q.correct_answer || ''}
              subCount={q.sub_count ?? 1}
              onChange={(v) => update({ correct_answer: v })}
            />
          ) : q.type === 'essay' ? (
            (q.essay_mode || 'general') === 'math' ? (
              <EssayAnswerInput q={q} update={update} />
            ) : (
              <GeneralEssayAnswerInput q={q} update={update} />
            )
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-gray-500">
                정답
                {q.type === 'multiple_choice' && ' (번호만, 복수면 쉼표로 구분)'}
                {q.type === 'matching' && ` (왼쪽 위부터 짝 지어질 오른쪽 번호, 쉼표 구분 · 예: "2,3,1")`}
              </span>
              <input
                value={q.correct_answer}
                onChange={(e) => update({ correct_answer: e.target.value })}
                placeholder={
                  q.type === 'multiple_choice'
                    ? '예) 2  또는  ②, ③'
                    : q.type === 'matching'
                      ? '예) 2, 3, 1'
                      : ''
                }
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              />
            </label>
          )}

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

// ─── 답 순서 안내 입력 ─────────────────────────────────
const ORDER_HINT_PRESETS = [
  '위에서 아래로',
  '왼쪽부터 순서대로',
  '순서대로',
  '(1)(2) 순서대로',
]

function AnswerOrderHintInput({ value, onChange }) {
  const appendPreset = (p) => {
    const cur = (value ?? '').trim()
    onChange(cur ? `${cur}, ${p}` : p)
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-gray-500">답 순서 안내 (학생 화면에 표시)</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예) 위에서 아래로 순서대로 입력하세요"
        className="border border-gray-300 rounded px-2 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-1.5 pt-1">
        {ORDER_HINT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => appendPreset(p)}
            className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 text-xs hover:bg-gray-200"
          >
            + {p}
          </button>
        ))}
        {(value ?? '').length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-2 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100"
          >
            지우기
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 일반 서술형 예시 정답 입력 (교사용) ──────────────
function GeneralEssayAnswerInput({ q, update }) {
  return (
    <div className="flex flex-col gap-2 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">예시 정답 (교사/AI 채점 참고용)</span>
        <textarea
          rows={3}
          value={q.example_solution || ''}
          onChange={(e) => update({ example_solution: e.target.value })}
          placeholder="예) 도전적이고 용기 있는 성격이다"
          className="border border-gray-300 rounded px-2 py-2 text-sm resize-none"
        />
      </label>
      <p className="text-[11px] text-gray-500">
        일반 서술형은 자동 채점이 없고 교사/AI가 전체 답을 직접 채점합니다.
      </p>
    </div>
  )
}

// ─── 서술형 정답·예시풀이·배점 입력 (교사용) ─────────────
function EssayAnswerInput({ q, update }) {
  const points = Math.max(1, q.points ?? 5)
  const procDefault = Math.ceil(points * 0.6)
  const ansDefault = points - procDefault
  const procPts = q.process_points ?? procDefault
  const ansPts = q.answer_points ?? ansDefault
  const subCount = q.sub_count ?? 1
  const sum = procPts + ansPts

  const setProc = (v) => {
    const next = Math.max(0, Math.min(points, parseInt(v, 10) || 0))
    update({ process_points: next, answer_points: points - next })
  }
  const setAns = (v) => {
    const next = Math.max(0, Math.min(points, parseInt(v, 10) || 0))
    update({ answer_points: next, process_points: points - next })
  }

  return (
    <div className="flex flex-col gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
      {/* 답 부분 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">정답 (답 부분 · 자동 채점 대상)</span>
        {subCount > 1 ? (
          <MultiTextAnswerInput
            value={q.correct_answer || ''}
            subCount={subCount}
            onChange={(v) => update({ correct_answer: v })}
          />
        ) : (
          <input
            value={q.correct_answer || ''}
            onChange={(e) => update({ correct_answer: e.target.value })}
            placeholder="예) 145"
            className="border border-gray-300 rounded px-2 py-2 text-sm"
          />
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500 shrink-0">단위</span>
          <input
            value={q.answer_unit || ''}
            onChange={(e) => update({ answer_unit: e.target.value })}
            placeholder="예) °, cm (없으면 공백)"
            className="w-40 border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* 예시 풀이 */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">예시 풀이 (AI 채점 참고용)</span>
        <textarea
          rows={3}
          value={q.example_solution || ''}
          onChange={(e) => update({ example_solution: e.target.value })}
          placeholder="예) ㉮=60°, ㉯=85°, 60°+85°=145°"
          className="border border-gray-300 rounded px-2 py-2 text-sm resize-none"
        />
      </label>

      {/* 배점 분할 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">부분 배점 (과정 + 답 = 총점)</span>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-xs text-gray-500">과정</span>
            <input
              type="number"
              min={0}
              max={points}
              value={procPts}
              onChange={(e) => setProc(e.target.value)}
              className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
            />
          </label>
          <span className="text-gray-400">+</span>
          <label className="flex items-center gap-1">
            <span className="text-xs text-gray-500">답</span>
            <input
              type="number"
              min={0}
              max={points}
              value={ansPts}
              onChange={(e) => setAns(e.target.value)}
              className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
            />
          </label>
          <span className={`text-xs ${sum === points ? 'text-gray-400' : 'text-amber-600 font-semibold'}`}>
            = {sum}점 / 총 {points}점
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── 복수 답칸 텍스트 정답 입력 (교사용) ────────────────
function MultiTextAnswerInput({ value, subCount, onChange }) {
  const parts = (value || '').split(',').map((s) => s.trim())
  while (parts.length < subCount) parts.push('')

  const updatePart = (idx, nextStr) => {
    const next = [...parts]
    next[idx] = nextStr
    onChange(next.slice(0, subCount).join(', '))
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-gray-500">정답</span>
      {Array.from({ length: subCount }).map((_, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8 shrink-0">({idx + 1})</span>
          <input
            value={parts[idx] || ''}
            onChange={(e) => updatePart(idx, e.target.value)}
            className="flex-1 border border-gray-300 rounded px-2 py-2 text-sm"
          />
        </div>
      ))}
    </div>
  )
}

// ─── 분수 정답 입력 (교사용) ───────────────────────────
function FractionAnswerInput({ value, subCount, onChange }) {
  const parts = (value || '').split(',').map((s) => s.trim())
  while (parts.length < subCount) parts.push('')

  const updatePart = (idx, nextStr) => {
    const next = [...parts]
    next[idx] = nextStr
    onChange(next.slice(0, subCount).join(', '))
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-gray-500">정답 (분수)</span>
      {Array.from({ length: subCount }).map((_, idx) => (
        <FractionSingleInput
          key={idx}
          label={subCount > 1 ? `(${idx + 1})` : null}
          value={parts[idx] || ''}
          onChange={(v) => updatePart(idx, v)}
        />
      ))}
    </div>
  )
}

function FractionSingleInput({ label, value, onChange }) {
  const detected = /\s/.test(value.trim())
  const [isMixed, setIsMixed] = useState(detected)
  const { whole, num, den } = splitFractionInput(value)

  const setField = (patch) => {
    const next = joinFractionInput({ whole, num, den, ...patch }, isMixed)
    onChange(next)
  }

  const toggleMixed = (mixed) => {
    setIsMixed(mixed)
    if (!mixed) {
      onChange(joinFractionInput({ whole: '', num, den }, false))
    } else {
      onChange(joinFractionInput({ whole: whole || '', num, den }, true))
    }
  }

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-400 w-6 shrink-0">{label}</span>}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggleMixed(false)}
          className={`px-2 py-1 rounded text-xs ${
            !isMixed ? 'bg-teacher text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          분수
        </button>
        <button
          type="button"
          onClick={() => toggleMixed(true)}
          className={`px-2 py-1 rounded text-xs ${
            isMixed ? 'bg-teacher text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          대분수
        </button>
      </div>
      {isMixed && (
        <input
          type="number"
          value={whole}
          onChange={(e) => setField({ whole: e.target.value })}
          placeholder="정수"
          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
        />
      )}
      <div className="inline-flex flex-col items-center">
        <input
          type="number"
          value={num}
          onChange={(e) => setField({ num: e.target.value })}
          placeholder="분자"
          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
        />
        <div className="w-14 h-px bg-gray-400 my-0.5" />
        <input
          type="number"
          value={den}
          onChange={(e) => setField({ den: e.target.value })}
          placeholder="분모"
          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
        />
      </div>
    </div>
  )
}
