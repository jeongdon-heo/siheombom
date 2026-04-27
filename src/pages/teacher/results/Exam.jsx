import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import { generateFeedback as aiGenerateFeedback } from '../../../lib/ai.js'
import { useAuth } from '../../../context/AuthContext.jsx'

export default function ResultsExam() {
  const { examId } = useParams()
  const { teacher } = useAuth()
  const [sessions, setSessions] = useState([])
  const [exam, setExam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [confirmBulk, setConfirmBulk] = useState(false)

  const fetchSessions = async () => {
    const { data, error: err } = await supabase.rpc(
      'list_exam_sessions_for_teacher',
      { exam_id_in: examId },
    )
    if (err) throw new Error(err.message)
    return Array.isArray(data) ? data : []
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [sessionsData, examRes] = await Promise.all([
          fetchSessions(),
          supabase.from('exams').select('id, subject, unit').eq('id', examId).single(),
        ])
        if (examRes.error) throw new Error(examRes.error.message)
        if (mounted) {
          setSessions(sessionsData)
          setExam(examRes.data)
        }
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  // AI 한 마디 일괄 생성 대상: 제출 완료 + 채점 대기 없음 + 아직 생성 안 됨
  const bulkTargets = sessions.filter(
    (s) => s.submitted && (s.pending_count ?? 0) === 0 && !s.has_feedback,
  )

  const runBulk = async () => {
    setConfirmBulk(false)
    setBulkBusy(true)
    setError(null)
    setBulkProgress({ done: 0, total: bulkTargets.length })
    try {
      if (!teacher?.api_key_encrypted || !teacher?.provider) {
        throw new Error('설정에서 AI 공급자와 API 키를 먼저 저장해주세요.')
      }
      let done = 0
      for (const s of bulkTargets) {
        const { data: summary, error: sErr } = await supabase.rpc(
          'get_session_summary_for_ai',
          { session_id_in: s.session_id },
        )
        if (sErr) throw new Error(`${s.student_name}: ${sErr.message}`)
        if (!summary) throw new Error(`${s.student_name}: 세션 요약 불러오기 실패`)

        const { studentFeedback, teacherAnalysis } = await aiGenerateFeedback({
          provider: teacher.provider,
          apiKey: teacher.api_key_encrypted,
          summary,
        })
        const { error: saveErr } = await supabase.rpc('save_session_feedback', {
          session_id_in: s.session_id,
          student_feedback_in: studentFeedback,
          teacher_analysis_in: teacherAnalysis,
        })
        if (saveErr) throw new Error(`${s.student_name}: ${saveErr.message}`)
        done += 1
        setBulkProgress({ done, total: bulkTargets.length })
      }
      const fresh = await fetchSessions()
      setSessions(fresh)
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  const stats = useMemo(() => {
    const submitted = sessions.filter((s) => s.submitted)
    const scores = submitted.map((s) => s.score ?? 0)
    const maxScores = submitted.map((s) => s.max_score ?? 0).filter((n) => n > 0)
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const max = scores.length ? Math.max(...scores) : null
    const min = scores.length ? Math.min(...scores) : null
    const fullScore = maxScores.length ? Math.max(...maxScores) : 0
    const pendingStudents = submitted.filter((s) => (s.pending_count ?? 0) > 0).length
    return {
      submittedCount: submitted.length,
      totalCount: sessions.length,
      avg: avg != null ? Math.round(avg * 10) / 10 : null,
      max,
      min,
      fullScore,
      pendingStudents,
    }
  }, [sessions])

  // 채점 대기 학생을 위로
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aPending = a.submitted && (a.pending_count ?? 0) > 0
      const bPending = b.submitted && (b.pending_count ?? 0) > 0
      if (aPending && !bPending) return -1
      if (!aPending && bPending) return 1
      return (a.student_number ?? 0) - (b.student_number ?? 0)
    })
  }, [sessions])

  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <Link to="/teacher/results" className="text-sm text-gray-500">
          ← 시험 선택
        </Link>
        <h2 className="text-base font-bold truncate px-2">
          {exam ? `${exam.subject} · ${exam.unit}` : '결과 분석'}
        </h2>
        <span className="w-12" />
      </header>

      {confirmBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-900">AI 일괄 생성</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              학생 <span className="font-bold">{bulkTargets.length}명</span>의
              "선생님의 한 마디"를 생성합니다. Claude API가{' '}
              <span className="font-bold">{bulkTargets.length}회</span> 호출됩니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulk(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={runBulk}
                className="flex-1 py-3 rounded-xl bg-teacher text-white text-sm font-bold shadow"
              >
                계속
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            불러오는 중…
          </div>
        ) : (
          <>
            {/* 요약 카드 */}
            <section className="grid grid-cols-2 gap-2">
              <StatCard
                label="응시 인원"
                value={`${stats.submittedCount}`}
                sub={`/ ${stats.totalCount}명`}
              />
              <StatCard
                label="평균 점수"
                value={stats.avg != null ? `${stats.avg}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              <StatCard
                label="최고 점수"
                value={stats.max != null ? `${stats.max}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              <StatCard
                label="최저 점수"
                value={stats.min != null ? `${stats.min}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              {stats.pendingStudents > 0 && (
                <div className="col-span-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-2">
                  <span className="text-base">📝</span>
                  <span className="text-sm text-amber-800">
                    채점 대기 학생{' '}
                    <span className="font-bold">{stats.pendingStudents}명</span>
                  </span>
                </div>
              )}
            </section>

            {/* AI 분석 일괄 생성 */}
            {(bulkTargets.length > 0 || bulkBusy) && (
              <section className="rounded-xl border border-teacher/20 bg-teacher/5 px-4 py-3 flex items-center gap-3">
                <span className="text-base shrink-0">💌</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">
                    선생님의 한 마디 일괄 생성
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {bulkBusy
                      ? `${bulkProgress.done}/${bulkProgress.total}명 생성 중…`
                      : `대상 ${bulkTargets.length}명 (제출 완료 + 채점 끝난 학생)`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={bulkBusy || bulkTargets.length === 0}
                  onClick={() => setConfirmBulk(true)}
                  className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-teacher text-white shadow disabled:opacity-50"
                >
                  {bulkBusy ? '생성 중…' : '🤖 일괄 생성'}
                </button>
              </section>
            )}

            {/* 학생 목록 */}
            {sorted.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">
                아직 응시 기록이 없어요.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sorted.map((s) => (
                  <StudentRow key={s.session_id ?? s.student_id} s={s} examId={examId} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-teacher">{value}</span>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </p>
    </div>
  )
}

function StudentRow({ s, examId }) {
  const isPending = s.submitted && (s.pending_count ?? 0) > 0
  const detailHref = `/teacher/results/${examId}/${s.student_id}`
  return (
    <li
      className={`rounded-xl border p-3 flex items-center gap-3 ${
        isPending ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'
      }`}
    >
      <Link
        to={`/teacher/students/${s.student_id}`}
        className="shrink-0 w-8 h-8 rounded-full bg-teacher/10 text-teacher text-sm font-bold flex items-center justify-center hover:bg-teacher/20"
        title="학생별 누적 기록"
      >
        {s.student_number}
      </Link>
      <Link
        to={`/teacher/students/${s.student_id}`}
        className="flex-1 min-w-0 hover:underline"
      >
        <p className="font-semibold text-gray-900 truncate">{s.student_name}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {s.submitted ? (
            isPending ? (
              <span className="text-amber-700 font-semibold">
                채점 대기 {s.pending_count}문항
              </span>
            ) : (
              <>
                {s.score ?? 0}점 / {s.max_score ?? 0}점
              </>
            )
          ) : (
            <span className="text-gray-400">미제출</span>
          )}
        </p>
      </Link>
      {s.submitted && s.has_feedback && (
        <span
          className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-teacher/10 text-teacher font-semibold"
          title="AI 한 마디 생성됨"
        >
          💌
        </span>
      )}
      {s.submitted && (
        <Link
          to={detailHref}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold ${
            isPending
              ? 'bg-amber-500 text-white'
              : 'border border-teacher/40 text-teacher hover:bg-teacher/10'
          }`}
        >
          {isPending ? '채점' : '상세'}
        </Link>
      )}
    </li>
  )
}
