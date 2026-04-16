import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useStudent } from '../../context/StudentContext.jsx'

export default function ClassCodeEntry() {
  const navigate = useNavigate()
  const { student, setPendingClass } = useStudent()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // 이미 입장해있으면 시험 목록으로
  useEffect(() => {
    if (student) navigate('/student/exams', { replace: true })
  }, [student, navigate])

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const clean = code.trim().toUpperCase()
    const { data, error } = await supabase.rpc('find_teacher_by_class_code', { code: clean })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      setError('학급코드를 찾을 수 없어요. 다시 확인해주세요.')
      return
    }
    setPendingClass({
      classCode: clean,
      teacherId: row.id,
      teacherName: row.name,
      className: row.class_name,
    })
    navigate('/student/enter')
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-student-bg">
      <Link to="/" className="text-sm text-gray-500 mb-6">← 처음으로</Link>

      <div className="flex-1 flex flex-col justify-center gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">학급코드 입력</h2>
          <p className="mt-2 text-sm text-gray-500">
            선생님이 알려준 6자리 코드를 적어주세요.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            maxLength={6}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABC123"
            className="text-center text-4xl font-mono tracking-[0.4em] py-5 rounded-2xl border-2 border-gray-300 bg-white focus:outline-none focus:border-student"
          />

          {error && (
            <p className="text-center text-sm text-red-600 bg-red-50 rounded-lg py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="rounded-2xl bg-student text-white text-lg py-5 font-bold shadow disabled:opacity-40"
          >
            {loading ? '확인 중…' : '확인'}
          </button>
        </form>
      </div>
    </div>
  )
}
