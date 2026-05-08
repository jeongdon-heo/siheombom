import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useStudent } from '../../context/StudentContext.jsx'
import { getSymbols } from '../../lib/optionStyle.js'
import { getButtonSymbols, isClearable } from '../../lib/inputButtons.js'
import { splitFractionInput, joinFractionInput } from '../../lib/fraction.js'

const STORAGE_PREFIX = 'siheombom.session'

// ─── 자동 저장 딜레이 (ms) ───
const SAVE_DEBOUNCE = 500

export default function TakeExam() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { student } = useStudent()

  const [questions, setQuestions] = useState([])
  const [passages, setPassages] = useState([])
  const [expandedPassageId, setExpandedPassageId] = useState(null)
  const [session, setSession] = useState(null)
  const [answers, setAnswers] = useState({})
  const [currentIndex, setCurrentIndex] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const saveTimerRef = useRef(null)
  const latestRef = useRef({ answers: {}, currentIndex: 0, sessionId: null })
  const dotContainerRef = useRef(null)

  // ─── localStorage 헬퍼 ───
  const storageKey = `${STORAGE_PREFIX}.${examId}.${student?.studentId}`

  const saveToLocal = useCallback(
    (ans, idx) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ answers: ans, currentIndex: idx }))
      } catch {
        /* quota 초과 등 무시 */
      }
    },
    [storageKey],
  )

  const loadFromLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [storageKey])

  // ─── Supabase 저장 (디바운스) ───
  const flushToDb = useCallback(
    async (ans, idx, sessId) => {
      setSaving(true)
      try {
        await supabase.rpc('save_session_answers', {
          session_id_in: sessId,
          student_id_in: student?.studentId,
          answers_in: ans,
          current_index_in: idx,
        })
      } catch {
        /* 네트워크 실패 시 localStorage 백업이 있음 */
      } finally {
        setSaving(false)
      }
    },
    [student],
  )

  const scheduleSave = useCallback(
    (ans, idx, sessId) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => flushToDb(ans, idx, sessId), SAVE_DEBOUNCE)
    },
    [flushToDb],
  )

  // ─── 초기 로드: 문항 + 세션 시작/복원 ───
  useEffect(() => {
    if (!student) {
      navigate('/student', { replace: true })
      return
    }
    let mounted = true

    ;(async () => {
      try {
        const [
          { data: qs, error: qErr },
          { data: sess, error: sErr },
          { data: ps, error: pErr },
        ] = await Promise.all([
          supabase.rpc('list_questions_for_student', {
            exam_id_in: examId,
            code: student.classCode,
          }),
          supabase.rpc('start_or_resume_session', {
            exam_id_in: examId,
            student_id_in: student.studentId,
          }),
          supabase.rpc('list_passages_for_student', {
            exam_id_in: examId,
            code: student.classCode,
          }),
        ])

        if (qErr) throw new Error(qErr.message)
        if (sErr) throw new Error(sErr.message)
        if (pErr) throw new Error(pErr.message)
        if (!qs?.length) throw new Error('문항을 불러올 수 없습니다.')

        const sessRow = Array.isArray(sess) ? sess[0] : sess
        if (!sessRow) throw new Error('세션을 생성할 수 없습니다.')

        if (!mounted) return

        const sorted = [...qs].sort((a, b) => a.number - b.number)
        setQuestions(sorted)
        setPassages(Array.isArray(ps) ? ps : [])
        setSession(sessRow)

        // 이미 제출된 시험이면 결과 표시 (results 포함)
        if (sessRow.submitted) {
          setResult({
            score: sessRow.score,
            maxScore: sessRow.max_score,
            results: sessRow.results ?? [],
            aiFeedback: sessRow.ai_feedback ?? null,
          })
          setLoading(false)
          return
        }

        // 답안 복원: DB vs localStorage 중 더 많은 쪽 사용
        const dbAnswers = sessRow.answers || {}
        const localData = loadFromLocal()
        const localAnswers = localData?.answers || {}

        const merged =
          Object.keys(localAnswers).length > Object.keys(dbAnswers).length
            ? { ...dbAnswers, ...localAnswers }
            : dbAnswers

        const idx = sessRow.current_index || localData?.currentIndex || 0
        const clampedIdx = Math.min(Math.max(idx, 0), sorted.length - 1)

        setAnswers(merged)
        setCurrentIndex(clampedIdx)

        latestRef.current = { answers: merged, currentIndex: clampedIdx, sessionId: sessRow.id }
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [examId, student, navigate, loadFromLocal])

  // ─── 브라우저 닫힐 때 최종 저장 ───
  useEffect(() => {
    const onBeforeUnload = () => {
      const { answers: a, currentIndex: i, sessionId: s } = latestRef.current
      if (!s) return
      saveToLocal(a, i)
      // sendBeacon 으로 최종 저장 시도 (best-effort)
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/save_session_answers`
        const body = JSON.stringify({
          session_id_in: s,
          student_id_in: student?.studentId,
          answers_in: a,
          current_index_in: i,
        })
        navigator.sendBeacon(
          url,
          new Blob([body], { type: 'application/json' }),
        )
      } catch {
        /* best-effort */
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [student, saveToLocal])

  // ─── 현재 dot 이 보이도록 스크롤 ───
  useEffect(() => {
    const container = dotContainerRef.current
    if (!container) return
    const dot = container.children[currentIndex]
    if (dot) dot.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [currentIndex])

  // ─── 답안 변경 핸들러 ───
  const setAnswer = useCallback(
    (questionId, value) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value }
        latestRef.current = { ...latestRef.current, answers: next }
        saveToLocal(next, latestRef.current.currentIndex)
        if (session) scheduleSave(next, latestRef.current.currentIndex, session.id)
        return next
      })
    },
    [session, saveToLocal, scheduleSave],
  )

  // ─── 문항 이동 ───
  const goTo = useCallback(
    (idx) => {
      const clamped = Math.max(0, Math.min(idx, questions.length - 1))
      setCurrentIndex(clamped)
      latestRef.current = { ...latestRef.current, currentIndex: clamped }
      saveToLocal(latestRef.current.answers, clamped)
      if (session) scheduleSave(latestRef.current.answers, clamped, session.id)
    },
    [questions.length, session, saveToLocal, scheduleSave],
  )

  // ─── 제출 ───
  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      // 최종 저장
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (session) {
        await flushToDb(answers, currentIndex, session.id)
      }

      const { data, error: err } = await supabase.rpc('submit_exam_session', {
        session_id_in: session.id,
        student_id_in: student.studentId,
      })
      if (err) throw new Error(err.message)

      localStorage.removeItem(storageKey)
      setResult(data)
      setShowSubmitModal(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── 파생 값 ───
  const answeredCount = questions.filter((q) => {
    const a = answers[q.id]
    return a !== undefined && a !== null && a !== ''
  }).length
  const totalCount = questions.length
  const progressPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0
  const currentQ = questions[currentIndex]
  const currentPassage = currentQ?.passage_id
    ? passages.find((p) => p.id === currentQ.passage_id)
    : null

  // 다른 지문의 문항으로 넘어가면 자동 접힘 (같은 passage_id면 유지)
  useEffect(() => {
    const pid = currentQ?.passage_id ?? null
    if (expandedPassageId && expandedPassageId !== pid) {
      setExpandedPassageId(null)
    }
  }, [currentQ?.passage_id, expandedPassageId])

  // ═══════════════════════════════════════════
  //  렌더링
  // ═══════════════════════════════════════════

  if (!student) return null

  // ─── 로딩 ───
  if (loading) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-student-bg gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-student border-t-transparent animate-spin" />
        <p className="text-sm text-gray-500">문항을 불러오는 중…</p>
      </div>
    )
  }

  // ─── 에러 (문항 못 불러옴) ───
  if (error && !questions.length) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-student-bg gap-4 p-6">
        <p className="text-sm text-red-600 bg-red-50 rounded-lg p-4 text-center">{error}</p>
        <button
          onClick={() => navigate('/student/exams', { replace: true })}
          className="text-sm text-student underline"
        >
          시험 목록으로 돌아가기
        </button>
      </div>
    )
  }

  // ─── 제출 완료 화면 (상세 결과) ───
  if (result) {
    const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0
    const items = Array.isArray(result.results) ? result.results : []
    const correctCount = items.filter((r) => r.isCorrect === true).length
    const wrongCount = items.filter((r) => r.isCorrect === false).length
    const essayCount = items.filter((r) => r.isCorrect === null).length

    return (
      <div className="min-h-full flex flex-col bg-student-bg">
        <header className="bg-white border-b border-gray-200 px-4 py-3 text-center">
          <h2 className="text-xl font-bold text-gray-900">시험 결과</h2>
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* 점수 원형 그래프 */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke={pct >= 60 ? '#10b981' : '#ef4444'}
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-gray-900">{result.score}</span>
                <span className="text-sm text-gray-400">/ {result.maxScore}점</span>
              </div>
            </div>
            <p className="text-base text-gray-600">
              {student.name}
            </p>
          </div>

          {/* 💌 선생님의 한 마디 */}
          <FeedbackPanel feedback={result.aiFeedback} />

          {/* 요약 카드 */}
          {items.length > 0 && (
            <div className="flex gap-2 text-center">
              <div className="flex-1 rounded-xl bg-green-50 border border-green-200 py-2.5">
                <span className="text-2xl font-bold text-green-600">{correctCount}</span>
                <p className="text-sm text-green-600">맞음</p>
              </div>
              <div className="flex-1 rounded-xl bg-red-50 border border-red-200 py-2.5">
                <span className="text-2xl font-bold text-red-500">{wrongCount}</span>
                <p className="text-sm text-red-500">틀림</p>
              </div>
              {essayCount > 0 && (
                <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 py-2.5">
                  <span className="text-2xl font-bold text-amber-500">{essayCount}</span>
                  <p className="text-sm text-amber-500">채점 대기</p>
                </div>
              )}
            </div>
          )}

          {/* 문항별 정오 목록 */}
          {items.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-bold text-gray-700">
                문항별 결과
                <span className="ml-1.5 text-xs font-normal text-gray-400">
                  (문항을 누르면 문제가 펼쳐져요)
                </span>
              </h3>
              {items.map((r) => {
                const q = questions.find((x) => x.id === r.questionId)
                return (
                  <ResultItemRow
                    key={r.questionId}
                    r={r}
                    imageUrl={q?.image_url || null}
                  />
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white border-t border-gray-200 px-4 py-3">
          <button
            onClick={() => navigate('/student/exams', { replace: true })}
            className="w-full rounded-2xl bg-student text-white text-lg py-4 font-bold shadow"
          >
            시험 목록으로
          </button>
        </div>
      </div>
    )
  }

  // ─── 시험 보기 메인 UI ───
  return (
    <div className="min-h-full flex flex-col bg-student-bg">
      {/* ── 헤더 ── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-student text-white text-sm font-bold">
              {student.number}
            </span>
            <span className="font-semibold text-gray-900 truncate">{student.name}</span>
          </div>
          <div className="text-right text-xs text-gray-500 shrink-0">
            {answeredCount}/{totalCount} 작성
            {saving && <span className="ml-1 text-student">저장 중…</span>}
          </div>
        </div>
      </header>

      {/* ── 프로그레스 바 ── */}
      <div className="bg-white px-4 pb-3">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>진행률</span>
          <span className="font-semibold text-student">{progressPct}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-student rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Dot 네비게이션 ── */}
      <div className="bg-white border-b border-gray-200 px-3 py-2">
        <div
          ref={dotContainerRef}
          className="flex gap-1.5 overflow-x-auto scrollbar-hide py-1"
        >
          {questions.map((q, i) => {
            const answered = answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== ''
            const isCurrent = i === currentIndex
            return (
              <button
                key={q.id}
                onClick={() => goTo(i)}
                className={`shrink-0 w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                  isCurrent
                    ? 'bg-student text-white ring-2 ring-student ring-offset-2'
                    : answered
                      ? 'bg-student/20 text-student'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {q.number}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 문항 카드 ── */}
      {currentQ && (
        <main className="flex-1 overflow-y-auto px-2 py-3">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            {/* 지문 토글 */}
            {currentPassage && (
              <div className="border-b border-amber-100 bg-amber-50/60">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedPassageId(
                      expandedPassageId === currentPassage.id ? null : currentPassage.id,
                    )
                  }
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-amber-900">
                    📖 {currentPassage.title || '지문'}
                  </span>
                  <span className="text-xs text-amber-700">
                    {expandedPassageId === currentPassage.id ? '▲ 접기' : '▼ 펼치기'}
                  </span>
                </button>
                {expandedPassageId === currentPassage.id && currentPassage.image_url && (
                  <div className="pb-2">
                    <img
                      src={currentPassage.image_url}
                      alt={currentPassage.title || '지문'}
                      className="w-full h-auto block border-y border-amber-200 bg-white"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 문항 이미지 */}
            {currentQ.image_url && (
              <div className="border-b border-gray-100 bg-gray-50">
                <img
                  src={currentQ.image_url}
                  alt={`${currentQ.number}번 문제`}
                  className="w-full h-auto block"
                />
              </div>
            )}

            <div className="p-4 flex flex-col gap-4">
              {/* 번호 + 배점 */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-student text-white text-sm font-bold">
                  {currentQ.number}
                </span>
                <span className="text-xs text-gray-400">{currentQ.points}점</span>
              </div>

              {/* ── 답 순서 안내 ── */}
              {(currentQ.sub_count ?? 1) > 1 &&
                currentQ.answer_order_hint?.trim() &&
                currentQ.type !== 'multiple_choice' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
                    <span className="shrink-0">💡</span>
                    <span>{currentQ.answer_order_hint}</span>
                  </div>
                )}

              {/* ── 답 입력 UI ── */}
              <AnswerInput
                question={currentQ}
                value={answers[currentQ.id] ?? ''}
                onChange={(v) => setAnswer(currentQ.id, v)}
              />
            </div>
          </div>

          {/* 인라인 에러 */}
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 text-red-600 text-sm p-3 text-center">
              {error}
            </div>
          )}
        </main>
      )}

      {/* ── 하단 네비게이션 ── */}
      <nav className="bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => goTo(currentIndex - 1)}
          disabled={currentIndex === 0}
          className="px-5 py-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 disabled:opacity-30"
        >
          ◀ 이전
        </button>

        <span className="text-sm text-gray-500 font-medium">
          {currentIndex + 1} / {totalCount}
        </span>

        {currentIndex < totalCount - 1 ? (
          <button
            onClick={() => goTo(currentIndex + 1)}
            className="px-5 py-3 rounded-xl text-sm font-semibold bg-student text-white"
          >
            다음 ▶
          </button>
        ) : (
          <button
            onClick={() => setShowSubmitModal(true)}
            className="px-5 py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white shadow"
          >
            제출하기
          </button>
        )}
      </nav>

      {/* ── 제출 확인 모달 ── */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-900 text-center">
              시험을 제출할까요?
            </h3>

            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between px-2">
                <span className="text-gray-600">작성한 문항</span>
                <span className="font-bold text-student">{answeredCount}문항</span>
              </div>
              <div className="flex justify-between px-2">
                <span className="text-gray-600">미작성 문항</span>
                <span className="font-bold text-red-500">
                  {totalCount - answeredCount}문항
                </span>
              </div>
            </div>

            {totalCount - answeredCount > 0 && (
              <p className="text-xs text-red-500 text-center bg-red-50 rounded-lg py-2">
                아직 풀지 않은 문제가 있어요!
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold"
              >
                돌아가기
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow disabled:opacity-50"
              >
                {submitting ? '제출 중…' : '제출하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
//  답 입력 컴포넌트 (유형별 분기)
// ═══════════════════════════════════════════

function AnswerInput({ question, value, onChange }) {
  // 포커스된 입력 추적: { el, partIdx(null=단일) }
  const activeRef = useRef(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const subCount = question.sub_count ?? 1
  const buttonSymbols = getButtonSymbols(question.input_buttons)
  const showClear = isClearable(question.input_buttons)

  // 활성 입력 칸에서 마지막 한 글자 삭제. 활성칸이 없으면 단일 입력의 끝 글자 삭제.
  const backspace = () => {
    const active = activeRef.current
    if (active) {
      const { el, partIdx } = active
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const cur = el.value ?? ''
      // 선택 범위가 있으면 그 부분 삭제, 없으면 커서 직전 한 글자 삭제
      const delStart = start === end ? Math.max(0, start - 1) : start
      const nextPart = cur.slice(0, delStart) + cur.slice(end)

      if (partIdx == null || typeof partIdx !== 'number') {
        onChange(nextPart)
      } else {
        const parts = (valueRef.current || '').split(',').map((s) => s.trim())
        while (parts.length < subCount) parts.push('')
        parts[partIdx] = nextPart
        onChange(parts.join(', '))
      }
      requestAnimationFrame(() => {
        el.focus()
        el.selectionStart = el.selectionEnd = delStart
      })
      return
    }
    // 포커스 없음 → 첫 입력칸의 마지막 글자 삭제
    if (subCount > 1) {
      const parts = (valueRef.current || '').split(',').map((s) => s.trim())
      while (parts.length < subCount) parts.push('')
      parts[0] = (parts[0] || '').slice(0, -1)
      onChange(parts.join(', '))
    } else {
      onChange((valueRef.current ?? '').slice(0, -1))
    }
  }

  const insertSymbol = (symbol) => {
    const active = activeRef.current
    if (!active) {
      // 포커스 없음 → 첫 입력칸에 덧붙이기
      if (subCount > 1) {
        const parts = (valueRef.current || '').split(',').map((s) => s.trim())
        while (parts.length < subCount) parts.push('')
        parts[0] = (parts[0] || '') + symbol
        onChange(parts.join(', '))
      } else {
        onChange((valueRef.current ?? '') + symbol)
      }
      return
    }
    const { el, partIdx } = active
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const cur = el.value ?? ''
    const nextPart = cur.slice(0, start) + symbol + cur.slice(end)

    if (partIdx == null) {
      onChange(nextPart)
    } else {
      const parts = (valueRef.current || '').split(',').map((s) => s.trim())
      while (parts.length < subCount) parts.push('')
      parts[partIdx] = nextPart
      onChange(parts.join(', '))
    }
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + symbol.length
    })
  }

  const ButtonBar = () =>
    buttonSymbols.length > 0 ? (
      <div className="flex flex-wrap gap-1.5">
        {buttonSymbols.map((s, i) => (
          <button
            key={`${s}-${i}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertSymbol(s)}
            className="min-w-[40px] h-10 px-2 rounded-lg bg-gray-100 text-gray-700 text-base font-medium hover:bg-gray-200 active:bg-gray-300"
          >
            {s}
          </button>
        ))}
        {showClear && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={backspace}
            className="min-w-[56px] h-10 px-2 rounded-lg bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 active:bg-red-200"
          >
            ← 지우기
          </button>
        )}
      </div>
    ) : null

  if (question.type === 'matching') {
    return (
      <MatchingInput
        count={question.match_count ?? 3}
        value={value}
        onChange={onChange}
      />
    )
  }

  if (question.type === 'multiple_choice') {
    const symbols = getSymbols(question.option_style, question.option_count)
    const selected = new Set(
      (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )

    const toggle = (sym) => {
      const next = new Set(selected)
      if (next.has(sym)) next.delete(sym)
      else next.add(sym)
      const ordered = symbols.filter((s) => next.has(s))
      onChange(ordered.join(', '))
    }

    // 괄호 기호는 너비가 넓어서 글자 크기 조정
    const isWide = symbols[0]?.length > 1
    const gridCols = symbols.length <= 5 ? 'grid-cols-5' : 'grid-cols-5'

    return (
      <div className={`grid ${gridCols} gap-2`}>
        {symbols.map((sym) => {
          const on = selected.has(sym)
          return (
            <button
              key={sym}
              onClick={() => toggle(sym)}
              className={`aspect-square rounded-2xl border-2 font-bold transition-all ${
                isWide ? 'text-base' : 'text-2xl'
              } ${
                on
                  ? 'border-student bg-student text-white shadow'
                  : 'border-gray-200 bg-white text-gray-700 active:border-student/40'
              }`}
            >
              {sym}
            </button>
          )
        })}
      </div>
    )
  }

  if (question.type === 'essay') {
    const essayMode = question.essay_mode || 'general'

    if (essayMode === 'math') {
      let parsed = { process: '', answer: '' }
      if (value) {
        try {
          const j = JSON.parse(value)
          if (j && typeof j === 'object') {
            parsed = { process: j.process || '', answer: j.answer || '' }
          }
        } catch {
          // 구 데이터 호환: plain string은 process로 취급
          parsed = { process: value, answer: '' }
        }
      }

      const setField = (key, v) => {
        onChange(JSON.stringify({ ...parsed, [key]: v }))
      }

      const mathSymbols = ['×', '÷', '+', '-', '=', '(', ')', '°']
      const insertMathSymbol = (s) => {
        const active = activeRef.current
        if (active && active.partIdx === 'process-math') {
          const el = active.el
          const start = el.selectionStart ?? el.value.length
          const end = el.selectionEnd ?? el.value.length
          const cur = el.value ?? ''
          const nextVal = cur.slice(0, start) + s + cur.slice(end)
          setField('process', nextVal)
          requestAnimationFrame(() => {
            el.focus()
            el.selectionStart = el.selectionEnd = start + s.length
          })
        } else {
          setField('process', (parsed.process || '') + s)
        }
      }

      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-600">풀이 과정</div>
            <div className="flex flex-wrap gap-1.5">
              {mathSymbols.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMathSymbol(s)}
                  className="min-w-[40px] h-10 px-2 rounded-lg bg-gray-100 text-gray-700 text-base font-medium hover:bg-gray-200 active:bg-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              value={parsed.process}
              onChange={(e) => setField('process', e.target.value)}
              onFocus={(e) => {
                activeRef.current = { el: e.target, partIdx: 'process-math' }
              }}
              rows={5}
              placeholder="풀이 과정을 작성하세요"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:border-student resize-none"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-600">답</div>
            <div className="flex items-center gap-2">
              <input
                value={parsed.answer}
                onChange={(e) => setField('answer', e.target.value)}
                onFocus={(e) => {
                  activeRef.current = { el: e.target, partIdx: 'answer-math' }
                }}
                placeholder="답을 입력하세요"
                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-student"
              />
              {question.answer_unit && (
                <span className="text-base font-semibold text-gray-700 shrink-0">
                  {question.answer_unit}
                </span>
              )}
            </div>
          </div>
        </div>
      )
    }

    // 일반 서술형
    return (
      <div className="flex flex-col gap-2">
        <ButtonBar />
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            activeRef.current = { el: e.target, partIdx: null }
          }}
          rows={5}
          placeholder="답을 작성하세요"
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:border-student resize-none"
        />
      </div>
    )
  }

  // short_answer → 분수 UI 분기
  if (question.answer_format === 'fraction') {
    const parts = (value || '').split(',').map((s) => s.trim())
    while (parts.length < subCount) parts.push('')

    const updatePart = (idx, v) => {
      const next = [...parts]
      next[idx] = v
      onChange(next.slice(0, subCount).join(', '))
    }

    return (
      <div className="flex flex-col gap-3">
        {parts.slice(0, subCount).map((part, idx) => (
          <FractionStudentInput
            key={idx}
            label={subCount > 1 ? `(${idx + 1})` : null}
            value={part}
            onChange={(v) => updatePart(idx, v)}
          />
        ))}
      </div>
    )
  }

  // short_answer (기본값)
  if (subCount > 1) {
    // 복수 답칸: 쉼표로 구분해서 저장
    const parts = (value || '').split(',').map((s) => s.trim())
    while (parts.length < subCount) parts.push('')

    const updatePart = (idx, v) => {
      const next = [...parts]
      next[idx] = v
      onChange(next.join(', '))
    }

    return (
      <div className="flex flex-col gap-2">
        <ButtonBar />
        {parts.slice(0, subCount).map((part, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 shrink-0 w-6 text-right">({idx + 1})</span>
            <input
              type="text"
              value={part}
              onChange={(e) => updatePart(idx, e.target.value)}
              onFocus={(e) => {
                activeRef.current = { el: e.target, partIdx: idx }
              }}
              placeholder={`(${idx + 1})의 답`}
              autoComplete="off"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-base font-medium focus:outline-none focus:border-student"
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ButtonBar />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          activeRef.current = { el: e.target, partIdx: null }
        }}
        placeholder="답이 여러 개이면 쉼표(,)로 구분"
        autoComplete="off"
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-center text-lg font-medium focus:outline-none focus:border-student"
      />
    </div>
  )
}

// ═══════════════════════════════════════════
//  결과 카드: 클릭 시 문제 이미지 펼침/접힘
// ═══════════════════════════════════════════

function ResultItemRow({ r, imageUrl }) {
  // 틀린 문항은 기본 펼침 (원인 파악 도움), 맞음/대기는 접힘
  const [imgOpen, setImgOpen] = useState(r.isCorrect === false)
  const hasImage = !!imageUrl

  const cardBg =
    r.isCorrect === true
      ? 'border-green-200 bg-green-50/50'
      : r.isCorrect === false
        ? 'border-red-200 bg-red-50/50'
        : 'border-amber-200 bg-amber-50/50'

  const badgeBg =
    r.isCorrect === true
      ? 'bg-green-500 text-white'
      : r.isCorrect === false
        ? 'bg-red-500 text-white'
        : 'bg-amber-400 text-white'

  return (
    <div className={`rounded-xl border ${cardBg}`}>
      <button
        type="button"
        onClick={() => hasImage && setImgOpen((v) => !v)}
        disabled={!hasImage}
        className={`w-full p-3.5 flex items-start gap-3 text-left rounded-xl ${
          hasImage ? 'hover:bg-black/5 cursor-pointer' : 'cursor-default'
        }`}
        title={hasImage ? '눌러서 문제 이미지 보기' : undefined}
      >
        <span
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${badgeBg}`}
        >
          {r.isCorrect === true ? 'O' : r.isCorrect === false ? 'X' : '?'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-700">{r.number}번</span>
            {hasImage && (
              <span className="text-xs text-gray-400">
                {imgOpen ? '▲ 접기' : '▼ 문제 보기'}
              </span>
            )}
          </div>
          {r.isCorrect === null ? (
            <p className="text-sm text-amber-600 mt-1">📝 선생님이 채점합니다</p>
          ) : (
            <div className="mt-1">
              <p className={`text-base ${r.isCorrect ? 'text-green-700' : 'text-red-600'}`}>
                내 답: <span className="font-semibold">{r.studentAnswer || '(미작성)'}</span>
              </p>
              {!r.isCorrect && (
                <p className="text-base text-gray-600 mt-0.5">
                  정답: <span className="font-semibold">{r.correctAnswer}</span>
                </p>
              )}
              {/* 교사 확정 후에만 AI 채점 설명 공개 (서술형 등) */}
              {r.aiReasoning && (
                <div className="mt-2 rounded-lg bg-white/70 border border-gray-200 p-2.5">
                  <p className="text-xs font-bold text-student mb-1">
                    🤖 AI 채점 설명
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {r.aiReasoning}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <span
          className={`text-sm font-bold shrink-0 ${
            r.isCorrect === true ? 'text-green-600' : 'text-gray-400'
          }`}
        >
          {r.isCorrect === true ? `+${r.earned}` : r.isCorrect === false ? '0' : '-'}점
        </span>
      </button>

      {hasImage && imgOpen && (
        <div className="border-t border-gray-200 bg-white rounded-b-xl overflow-hidden">
          <img
            src={imageUrl}
            alt={`${r.number}번 문제`}
            className="w-full h-auto block"
          />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
//  선생님의 한 마디 (학생 결과 화면)
// ═══════════════════════════════════════════

function FeedbackPanel({ feedback }) {
  return (
    <section
      className={`rounded-2xl border p-4 flex flex-col gap-2 ${
        feedback
          ? 'border-student/30 bg-student/5'
          : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">💌</span>
        <h3 className="text-base font-bold text-gray-800">선생님의 한 마디</h3>
      </div>
      {feedback ? (
        <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">
          {feedback}
        </p>
      ) : (
        <p className="text-base text-gray-500 leading-relaxed">
          선생님이 확인 후 피드백을 작성해 주실 거예요.
        </p>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════
//  연결형 입력 (학생용)
// ═══════════════════════════════════════════

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function MatchingInput({ count, value, onChange }) {
  const n = Math.max(2, Math.min(10, count || 3))
  const parts = (value || '').split(',').map((s) => s.trim())
  while (parts.length < n) parts.push('')

  // 중복 선택된 값: 같은 오른쪽 번호를 2개 이상이 가리키면 경고
  const countMap = new Map()
  parts.slice(0, n).forEach((v) => {
    if (!v) return
    countMap.set(v, (countMap.get(v) || 0) + 1)
  })
  const dupSet = new Set(
    [...countMap.entries()].filter(([, c]) => c > 1).map(([v]) => v),
  )

  const update = (idx, v) => {
    const next = [...parts]
    next[idx] = v
    onChange(next.slice(0, n).join(','))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
        <span className="shrink-0">💡</span>
        <span>왼쪽 항목에 맞는 오른쪽 번호를 선택하세요</span>
      </div>

      {Array.from({ length: n }).map((_, i) => {
        const cur = parts[i] || ''
        const isDup = cur && dupSet.has(cur)
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="shrink-0 text-base font-bold text-gray-700 w-16">
              왼쪽 {CIRCLED[i]}
            </span>
            <span className="text-gray-400">→</span>
            <select
              value={cur}
              onChange={(e) => update(i, e.target.value)}
              className={`flex-1 border-2 rounded-xl px-3 py-3 text-base font-medium focus:outline-none ${
                isDup
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : cur
                    ? 'border-student bg-white text-student'
                    : 'border-gray-200 bg-white text-gray-500'
              }`}
            >
              <option value="">선택</option>
              {Array.from({ length: n }).map((_, j) => (
                <option key={j} value={String(j + 1)}>
                  {CIRCLED[j]}
                </option>
              ))}
            </select>
          </div>
        )
      })}

      {dupSet.size > 0 && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          이미 선택된 번호입니다. 서로 다른 번호를 고르세요.
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
//  분수 전용 입력 (학생용)
// ═══════════════════════════════════════════

function FractionStudentInput({ label, value, onChange }) {
  const detected = /\s/.test((value || '').trim())
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
      onChange(joinFractionInput({ whole, num, den }, true))
    }
  }

  const fieldCls =
    'w-16 h-12 border-2 border-gray-200 rounded-lg text-center text-xl font-bold focus:outline-none focus:border-student'

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => toggleMixed(false)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
            !isMixed ? 'bg-student text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          분수
        </button>
        <button
          type="button"
          onClick={() => toggleMixed(true)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
            isMixed ? 'bg-student text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          대분수
        </button>
      </div>

      <div className="flex items-center gap-3">
        {isMixed && (
          <input
            type="number"
            inputMode="numeric"
            value={whole}
            onChange={(e) => setField({ whole: e.target.value })}
            placeholder="정수"
            className={`${fieldCls} self-center`}
          />
        )}
        <div className="inline-flex flex-col items-center">
          <input
            type="number"
            inputMode="numeric"
            value={num}
            onChange={(e) => setField({ num: e.target.value })}
            placeholder="분자"
            className={fieldCls}
          />
          <div className="w-20 h-0.5 bg-gray-500 my-1" />
          <input
            type="number"
            inputMode="numeric"
            value={den}
            onChange={(e) => setField({ den: e.target.value })}
            placeholder="분모"
            className={fieldCls}
          />
        </div>
      </div>
    </div>
  )
}
