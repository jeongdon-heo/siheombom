import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}.${m}.${day}`
}

export default function StudentHistory() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [history, setHistory] = useState([])
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [historyRes, studentRes] = await Promise.all([
          supabase.rpc('list_student_history', { student_id_in: studentId }),
          supabase.rpc('get_student_for_teacher', { student_id_in: studentId }),
        ])
        if (historyRes.error) throw new Error(historyRes.error.message)
        if (studentRes.error) throw new Error(studentRes.error.message)
        if (mounted) {
          setHistory(Array.isArray(historyRes.data) ? historyRes.data : [])
          setStudent(Array.isArray(studentRes.data) ? studentRes.data[0] : studentRes.data)
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
  }, [studentId])

  // 시간순(과거→현재) 차트용
  const chartData = useMemo(() => {
    const submitted = history.filter((h) => h.submitted && h.max_score > 0)
    return [...submitted].sort(
      (a, b) => new Date(a.exam_created_at) - new Date(b.exam_created_at),
    )
  }, [history])

  const summary = useMemo(() => {
    if (chartData.length === 0) return null
    const pcts = chartData.map((h) => Math.round((h.score / h.max_score) * 100))
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    return { count: chartData.length, avg }
  }, [chartData])

  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500"
        >
          ← 뒤로
        </button>
        <h2 className="text-base font-bold truncate px-2">
          {student ? `${student.number}번 ${student.name}` : '학생 기록'}
        </h2>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            불러오는 중…
          </div>
        ) : history.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            아직 응시 기록이 없어요.
          </p>
        ) : (
          <>
            {summary && (
              <section className="grid grid-cols-2 gap-2">
                <StatCard label="응시한 시험" value={`${summary.count}회`} />
                <StatCard label="평균 정답률" value={`${summary.avg}%`} />
              </section>
            )}

            {chartData.length > 0 && (
              <section className="rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
                <h3 className="text-sm font-bold text-gray-700">점수 추이</h3>
                <ScoreBarChart data={chartData} />
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-700">시험별 결과</h3>
              {history.map((h) => {
                const isPending = h.submitted && (h.pending_count ?? 0) > 0
                const pct =
                  h.submitted && h.max_score > 0
                    ? Math.round((h.score / h.max_score) * 100)
                    : null
                return (
                  <Link
                    key={h.session_id}
                    to={`/teacher/results/${h.exam_id}/${studentId}`}
                    className={`rounded-xl border p-3 flex items-center gap-3 hover:border-teacher ${
                      isPending ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {h.subject} · {h.unit}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatDate(h.exam_created_at)}
                        {' · '}
                        {h.submitted ? (
                          isPending ? (
                            <span className="text-amber-700 font-semibold">
                              채점 대기 {h.pending_count}문항
                            </span>
                          ) : (
                            <>
                              {h.score ?? 0}/{h.max_score ?? 0}점
                              {pct != null && ` · ${pct}%`}
                            </>
                          )
                        ) : (
                          <span className="text-gray-400">미제출</span>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-gray-300 text-sm">›</span>
                  </Link>
                )
              })}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-teacher">{value}</p>
    </div>
  )
}

function ScoreBarChart({ data }) {
  return (
    <div className="flex items-end gap-2 h-36">
      {data.map((h) => {
        const pct = h.max_score > 0 ? Math.round((h.score / h.max_score) * 100) : 0
        const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-teacher' : 'bg-red-400'
        return (
          <div key={h.session_id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-xs font-semibold text-gray-700">{pct}%</span>
            <div className="w-full bg-gray-100 rounded-t flex-1 flex items-end overflow-hidden">
              <div
                className={`w-full ${color} transition-all`}
                style={{ height: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 truncate w-full text-center">
              {h.subject}
            </span>
          </div>
        )
      })}
    </div>
  )
}
