import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useStudent } from '../../context/StudentContext.jsx'

const STORAGE_PREFIX = 'siheombom.session'

// ─── 자동 저장 딜레이 (ms) ───
const SAVE_DEBOUNCE = 500

export default function TakeExam() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { student } = useStudent()

  const [questions, setQuestions] = useState([])
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
        const [{ data: qs, error: qErr }, { data: sess, error: sErr }] = await Promise.all([
          supabase.rpc('list_questions_for_student', {
            exam_id_in: examId,
            code: student.classCode,
          }),
          supabase.rpc('start_or_resume_session', {
            exam_id_in: examId,
            student_id_in: student.studentId,
          }),
        ])

        if (qErr) throw new Error(qErr.message)
        if (sErr) throw new Error(sErr.message)
        if (!qs?.length) throw new Error('문항을 불러올 수 없습니다.')

        const sessRow = Array.isArray(sess) ? sess[0] : sess
        if (!sessRow) throw new Error('세션을 생성할 수 없습니다.')

        if (!mounted) return

        const sorted = [...qs].sort((a, b) => a.number - b.number)
        setQuestions(sorted)
        setSession(sessRow)

        // 이미 제출된 시험이면 결과 표시
        if (sessRow.submitted) {
          setResult({ score: sessRow.score, maxScore: sessRow.max_score })
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

  // ─── 제출 완료 화면 ───
  if (result) {
    const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-student-bg gap-6 p-6">
        {/* 점수 원형 그래프 */}
        <div className="relative w-40 h-40">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="#10b981"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900">{pct}점</span>
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900">시험 완료!</h2>
          <p className="mt-1 text-gray-600">
            {student.name} · {result.score} / {result.maxScore}점
          </p>
        </div>

        <button
          onClick={() => navigate('/student/exams', { replace: true })}
          className="rounded-2xl bg-student text-white text-lg py-4 px-10 font-bold shadow"
        >
          시험 목록으로
        </button>
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
        <main className="flex-1 overflow-y-auto p-4">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            {/* 문항 이미지 */}
            {currentQ.image_url && (
              <div className="border-b border-gray-100 bg-gray-50">
                <img
                  src={currentQ.image_url}
                  alt={`${currentQ.number}번 문제`}
                  className="w-full object-contain max-h-[50vh]"
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

              {/* 문제 텍스트 */}
              {currentQ.text && (
                <p className="text-gray-900 leading-relaxed whitespace-pre-wrap">
                  {currentQ.text}
                </p>
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
  if (question.type === 'multiple_choice') {
    const options = Array.isArray(question.options) ? question.options : []
    return (
      <div className="flex flex-col gap-2">
        {options.map((opt, idx) => {
          const selected = value === opt
          return (
            <button
              key={idx}
              onClick={() => onChange(selected ? '' : opt)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border-2 text-sm font-medium transition-all ${
                selected
                  ? 'border-student bg-student/10 text-student'
                  : 'border-gray-200 bg-white text-gray-700 active:border-student/40'
              }`}
            >
              {opt}
            </button>
          )
        })}
      </div>
    )
  }

  if (question.type === 'essay') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="답을 작성해주세요…"
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:border-student resize-none"
      />
    )
  }

  // short_answer (기본값)
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="답을 입력해주세요"
      autoComplete="off"
      className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-center text-lg font-medium focus:outline-none focus:border-student"
    />
  )
}
