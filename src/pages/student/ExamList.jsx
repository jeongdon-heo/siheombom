import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useStudent } from '../../context/StudentContext.jsx'

export default function ExamList() {
  const navigate = useNavigate()
  const { student, clearStudent } = useStudent()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!student) {
      navigate('/student', { replace: true })
      return
    }
    let mounted = true
    ;(async () => {
      const { data, error } = await supabase.rpc('list_student_exams', {
        code: student.classCode,
        student_id_in: student.studentId,
      })
      if (!mounted) return
      if (error) setError(error.message)
      else setExams(data || [])
      setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [student, navigate])

  if (!student) return null

  const onLeave = () => {
    clearStudent()
    navigate('/student', { replace: true })
  }

  // 이어서 풀기 (미제출 + 진행 중인 시험)
  const inProgress = exams.filter(
    (e) => e.session_id && !e.session_submitted && e.answered_count > 0,
  )
  // 시작 가능 (세션 없거나, 세션은 있지만 아직 0문항)
  const available = exams.filter(
    (e) => !e.session_submitted && !(e.session_id && e.answered_count > 0),
  )
  // 완료된 시험
  const completed = exams.filter((e) => e.session_submitted)

  return (
    <div className="min-h-full flex flex-col bg-student-bg">
      <header className="p-4 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-student text-white text-sm font-bold">
            {student.number}
          </span>
          <div>
            <p className="font-bold text-gray-900">{student.name}</p>
            <p className="text-xs text-gray-500">
              {student.className} · {student.teacherName} 선생님
            </p>
          </div>
        </div>
        <button onClick={onLeave} className="text-xs text-gray-400 underline">
          나가기
        </button>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-5">
        {loading && <p className="text-sm text-gray-400">불러오는 중…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && exams.length === 0 && (
          <div className="rounded-xl bg-white border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            아직 만들어진 시험이 없어요.
            <br />
            선생님이 시험을 올려주면 여기에 나타납니다.
          </div>
        )}

        {/* ── 이어서 풀기 ── */}
        {inProgress.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-student mb-2">이어서 풀기</h2>
            <ul className="flex flex-col gap-3">
              {inProgress.map((e) => {
                const pct =
                  e.question_count > 0
                    ? Math.round((e.answered_count / e.question_count) * 100)
                    : 0
                return (
                  <li
                    key={e.id}
                    onClick={() => navigate(`/student/exams/${e.id}`)}
                    className="rounded-xl bg-white border-2 border-student/30 p-4 flex flex-col gap-3 shadow-sm cursor-pointer active:bg-student/5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-lg bg-student/15 text-student text-xl font-bold flex items-center justify-center">
                        {(e.subject || '?').trim().charAt(0)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{e.subject}</p>
                        <p className="text-sm text-gray-500 truncate">{e.unit}</p>
                      </div>
                      <span className="text-xs text-student font-bold">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-student rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* ── 응시 가능한 시험 ── */}
        {available.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-700 mb-2">응시 가능한 시험</h2>
            <ul className="flex flex-col gap-3">
              {available.map((e) => (
                <li
                  key={e.id}
                  className="rounded-xl bg-white border border-gray-200 p-4 flex items-center gap-3 shadow-sm"
                >
                  <span className="w-12 h-12 rounded-lg bg-student/15 text-student text-xl font-bold flex items-center justify-center">
                    {(e.subject || '?').trim().charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{e.subject}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {e.unit}
                      {e.question_count > 0 && (
                        <span className="ml-1 text-gray-400">· {e.question_count}문항</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/student/exams/${e.id}`)}
                    className="text-sm text-white px-4 py-2 rounded-lg bg-student font-semibold shadow-sm"
                  >
                    시작
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── 완료된 시험 ── */}
        {completed.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-400 mb-2">완료된 시험</h2>
            <ul className="flex flex-col gap-3">
              {completed.map((e) => (
                <li
                  key={e.id}
                  onClick={() => navigate(`/student/exams/${e.id}`)}
                  className="rounded-xl bg-white border border-gray-200 p-4 flex items-center gap-3 cursor-pointer active:bg-gray-50 hover:border-student/40"
                >
                  <span className="w-12 h-12 rounded-lg bg-gray-100 text-gray-500 text-xl font-bold flex items-center justify-center">
                    {(e.subject || '?').trim().charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{e.subject}</p>
                    <p className="text-sm text-gray-500 truncate">{e.unit}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-700">
                      {e.session_score ?? 0}/{e.session_max_score ?? 0}
                    </p>
                    <p className="text-xs text-student">결과 보기 ›</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
