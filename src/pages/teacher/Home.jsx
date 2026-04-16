import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

const MENU = [
  { key: 'create', label: '시험 만들기', desc: 'PDF 업로드 → AI 분석', to: '/teacher/exams/new' },
  { key: 'manage', label: '시험 관리', desc: '시험 목록·삭제', to: null },
  { key: 'result', label: '결과 분석', desc: '학생별 응시 결과', to: null },
  { key: 'settings', label: '설정', desc: 'AI · API 키 · 학급코드', to: '/teacher/settings' },
]

export default function TeacherHome() {
  const { teacher, loading, signOut } = useAuth()
  const [copied, setCopied] = useState(false)

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-gray-400 text-sm">
        불러오는 중…
      </div>
    )
  }

  if (!teacher) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3 p-6">
        <p className="text-gray-500 text-sm">프로필을 불러오지 못했습니다.</p>
        <button onClick={signOut} className="text-sm text-teacher underline">
          다시 로그인
        </button>
      </div>
    )
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(teacher.class_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{teacher.class_name}</p>
          <p className="text-lg font-semibold">{teacher.name} 선생님</p>
        </div>
        <button onClick={signOut} className="text-sm text-gray-400 underline">
          로그아웃
        </button>
      </header>

      <section className="rounded-2xl bg-teacher text-white p-6 shadow-md">
        <p className="text-xs uppercase tracking-widest opacity-80">학급코드</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <span className="text-5xl font-extrabold tracking-[0.2em] font-mono">
            {teacher.class_code}
          </span>
          <button
            onClick={onCopy}
            className="shrink-0 px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-semibold"
          >
            {copied ? '복사됨 ✓' : '복사'}
          </button>
        </div>
        <p className="mt-3 text-xs opacity-80">
          칠판에 적어 학생들이 입력하게 하세요.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {MENU.map((m) => {
          const className =
            'text-left rounded-xl border border-gray-200 p-4 hover:border-teacher hover:bg-teacher/5 disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-transparent'
          const body = (
            <>
              <p className="font-semibold text-gray-900">{m.label}</p>
              <p className="mt-1 text-xs text-gray-500">{m.desc}</p>
            </>
          )
          return m.to ? (
            <Link key={m.key} to={m.to} className={className}>
              {body}
            </Link>
          ) : (
            <button key={m.key} className={className} disabled>
              {body}
            </button>
          )
        })}
      </section>
    </div>
  )
}
