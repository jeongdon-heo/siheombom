import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}.${m}.${day}`
}

export default function ResultsIndex() {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('list_teacher_exams_with_stats')
        if (err) throw new Error(err.message)
        if (mounted) setExams(Array.isArray(data) ? data : [])
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-5">
      <header className="flex items-center justify-between">
        <Link to="/teacher" className="text-sm text-gray-500">← 홈</Link>
        <h2 className="text-lg font-bold">결과 분석</h2>
        <span className="w-10" />
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          불러오는 중…
        </div>
      ) : exams.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 text-sm">
          <p>아직 만든 시험이 없어요.</p>
          <Link to="/teacher/exams/new" className="text-teacher underline">
            첫 시험 만들러 가기
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {exams.map((e) => {
            const submitted = Number(e.submitted_count ?? 0)
            const classSize = Number(e.class_size ?? 0)
            const avg = e.avg_score
            const hasPending = Number(e.pending_student_count ?? 0) > 0
            return (
              <li key={e.id}>
                <Link
                  to={`/teacher/results/${e.id}`}
                  className="block rounded-xl border border-gray-200 p-3 hover:border-teacher"
                >
                  <p className="font-semibold text-gray-900 truncate">
                    {e.subject} · {e.unit}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    응시 {submitted}/{classSize}명 ·{' '}
                    {avg != null ? `평균 ${avg}점` : '평균 -'} ·{' '}
                    {formatDate(e.created_at)}
                    {hasPending && (
                      <span className="ml-1 text-amber-600 font-semibold">
                        · 채점 대기
                      </span>
                    )}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
