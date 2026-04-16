import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

export default function TeacherSignup() {
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [className, setClassName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  const onSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setInfo(null)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, class_name: className },
      },
    })
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    // 이메일 확인이 켜져 있으면 session 이 null → 확인 메일 안내
    if (!data.session) {
      setInfo('확인 메일을 보냈습니다. 메일의 링크를 눌러 가입을 완료한 뒤 로그인해주세요.')
      return
    }

    // 세션이 바로 만들어진 경우 → 홈으로
    navigate('/teacher', { replace: true })
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-white">
      <Link to="/teacher/login" className="text-sm text-gray-500 mb-8">← 로그인으로</Link>
      <h2 className="text-2xl font-bold mb-1">교사 회원가입</h2>
      <p className="text-sm text-gray-500 mb-8">
        가입하면 6자리 학급코드가 자동으로 발급됩니다.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
            placeholder="김선생"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">학급명</span>
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
            placeholder="4학년 2반"
          />
        </label>
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
          <span className="text-sm text-gray-700">비밀번호 (6자 이상)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-teacher">{info}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-lg bg-teacher text-white py-3 font-semibold shadow disabled:opacity-50"
        >
          {submitting ? '가입 중…' : '가입하기'}
        </button>
      </form>
    </div>
  )
}
