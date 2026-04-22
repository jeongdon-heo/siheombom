import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'

export default function ResultsList() {
  const { examId } = useParams()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase.rpc('list_exam_sessions_for_teacher', {
          exam_id_in: examId,
        })
        if (err) throw new Error(err.message)
        if (mounted) setSessions(Array.isArray(data) ? data : [])
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [examId])

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-5">
      <header className="flex items-center justify-between">
        <Link to="/teacher/exams" className="text-sm text-gray-500">← 시험 목록</Link>
        <h2 className="text-lg font-bold">응시 결과</h2>
        <span className="w-12" />
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          불러오는 중…
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          아직 응시 기록이 없어요.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const pct =
              s.submitted && s.max_score > 0
                ? Math.round((s.score / s.max_score) * 100)
                : null
            return (
              <li key={s.session_id}>
                <Link
                  to={`/teacher/exams/${examId}/sessions/${s.session_id}`}
                  className="rounded-xl border border-gray-200 p-3 flex items-center gap-3 hover:border-teacher"
                >
                  <span className="shrink-0 w-8 h-8 rounded-full bg-teacher/10 text-teacher text-sm font-bold flex items-center justify-center">
                    {s.student_number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{s.student_name}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {s.submitted ? (
                        <>
                          {s.score ?? 0}/{s.max_score ?? 0}점
                          {pct !== null && ` · ${pct}%`}
                          {s.pending_count > 0 && (
                            <span className="ml-1 text-amber-600">
                              · 채점 대기 {s.pending_count}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">미제출</span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-gray-300 text-sm">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
