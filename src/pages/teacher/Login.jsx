import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

export default function TeacherLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/teacher'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const onSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-white">
      <Link to="/" className="text-sm text-gray-500 mb-8">← 처음으로</Link>
      <h2 className="text-2xl font-bold mb-1">교사 로그인</h2>
      <p className="text-sm text-gray-500 mb-8">이메일과 비밀번호로 로그인하세요.</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">이메일</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-lg bg-teacher text-white py-3 font-semibold shadow disabled:opacity-50"
        >
          {submitting ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <p className="mt-8 text-sm text-gray-500 text-center">
        계정이 없으신가요?{' '}
        <Link to="/teacher/signup" className="text-teacher font-semibold">
          회원가입
        </Link>
      </p>
    </div>
  )
}
