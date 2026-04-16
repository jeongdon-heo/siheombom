import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { useStudent } from '../../context/StudentContext.jsx'

export default function NameNumberEntry() {
  const navigate = useNavigate()
  const { pendingClass, setStudent } = useStudent()

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // 학급코드 검증 안 하고 직접 들어온 경우 되돌림
  useEffect(() => {
    if (!pendingClass) navigate('/student', { replace: true })
  }, [pendingClass, navigate])

  if (!pendingClass) return null

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const n = parseInt(number, 10)
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      setLoading(false)
      setError('번호는 1~99 사이 숫자로 적어주세요.')
      return
    }

    const { data, error } = await supabase.rpc('student_join', {
      code: pendingClass.classCode,
      s_name: name.trim(),
      s_number: n,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      setError('입장에 실패했어요.')
      return
    }

    setStudent({
      classCode: pendingClass.classCode,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      className: row.class_name,
      studentId: row.id,
      name: row.name,
      number: row.number,
    })
    navigate('/student/exams', { replace: true })
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-student-bg">
      <Link to="/student" className="text-sm text-gray-500 mb-6">← 학급코드 다시 입력</Link>

      <div className="rounded-xl bg-white border border-gray-200 p-4 mb-6 text-center">
        <p className="text-xs text-gray-500">입장할 학급</p>
        <p className="mt-1 text-lg font-bold text-gray-900">{pendingClass.className}</p>
        <p className="text-sm text-gray-600">{pendingClass.teacherName} 선생님</p>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">이름과 번호를 적어주세요</h2>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-700">이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={20}
              autoComplete="off"
              className="text-xl py-4 px-4 rounded-2xl border-2 border-gray-300 bg-white focus:outline-none focus:border-student"
              placeholder="홍길동"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-700">번호</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ''))}
              required
              inputMode="numeric"
              maxLength={2}
              autoComplete="off"
              className="text-xl py-4 px-4 rounded-2xl border-2 border-gray-300 bg-white focus:outline-none focus:border-student"
              placeholder="3"
            />
          </label>

          {error && (
            <p className="text-center text-sm text-red-600 bg-red-50 rounded-lg py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-student text-white text-lg py-5 font-bold shadow disabled:opacity-40"
          >
            {loading ? '입장 중…' : '입장하기'}
          </button>
        </form>
      </div>
    </div>
  )
}
