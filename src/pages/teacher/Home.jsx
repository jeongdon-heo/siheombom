import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import ScoreTrendChart from '../../components/ScoreTrendChart.jsx'

const MENU = [
  { key: 'create', label: '시험 만들기', desc: 'PDF 업로드 → AI 분석', to: '/teacher/exams/new' },
  { key: 'manage', label: '시험 관리', desc: '시험 목록·삭제', to: '/teacher/exams' },
  { key: 'result', label: '결과 분석', desc: '학생별 응시 결과', to: '/teacher/results' },
  { key: 'students', label: '학생 명단', desc: '번호·이름 등록·수정', to: '/teacher/students' },
  { key: 'settings', label: '설정', desc: 'AI · API 키 · 학급코드', to: '/teacher/settings' },
]

const MAX_TREND_POINTS = 10

export default function TeacherHome() {
  const { teacher, loading, signOut } = useAuth()
  const [copied, setCopied] = useState(false)
  const [examStats, setExamStats] = useState([])
  const [students, setStudents] = useState([])
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentHistory, setStudentHistory] = useState([])

  // 성적 추이용 데이터 fetch — 시험 통계 + 학생 명단 동시
  useEffect(() => {
    if (!teacher) return
    let mounted = true
    ;(async () => {
      const [statsRes, studentsRes] = await Promise.all([
        supabase.rpc('list_teacher_exams_with_stats'),
        supabase
          .from('students')
          .select('id, name, number')
          .order('number', { ascending: true }),
      ])
      if (statsRes.error) {
        console.error('[trend] stats failed', statsRes.error)
      } else if (mounted) {
        setExamStats(Array.isArray(statsRes.data) ? statsRes.data : [])
      }
      if (studentsRes.error) {
        console.error('[trend] students failed', studentsRes.error)
      } else if (mounted) {
        setStudents(Array.isArray(studentsRes.data) ? studentsRes.data : [])
      }
    })()
    return () => {
      mounted = false
    }
  }, [teacher])

  // 학생 선택 시 해당 학생의 응시 기록 fetch
  useEffect(() => {
    if (!selectedStudentId) {
      setStudentHistory([])
      return
    }
    let mounted = true
    ;(async () => {
      const { data, error } = await supabase.rpc('list_student_history', {
        student_id_in: selectedStudentId,
      })
      if (error) {
        console.error('[trend] student history failed', error)
        return
      }
      if (mounted) setStudentHistory(Array.isArray(data) ? data : [])
    })()
    return () => {
      mounted = false
    }
  }, [selectedStudentId])

  // 응시자 있고 만점 정보 있는 시험만, 시간순 asc 최근 N회
  // + 학생 선택 시 해당 시험의 학생 점수 join
  const trendData = useMemo(() => {
    const valid = examStats.filter(
      (e) =>
        Number(e.submitted_count ?? 0) > 0 &&
        e.avg_score != null &&
        Number(e.max_score_total ?? 0) > 0,
    )
    // 학생 응시 기록을 examId로 인덱싱 (submitted=true 만)
    const studentByExam = new Map()
    for (const h of studentHistory) {
      if (!h.submitted) continue
      studentByExam.set(h.exam_id, h)
    }
    // RPC는 created_at desc로 반환됨 → 최근 N회 추출 후 시간순 asc로 뒤집기
    return valid
      .slice(0, MAX_TREND_POINTS)
      .reverse()
      .map((e) => {
        const avg = Number(e.avg_score)
        const total = Number(e.max_score_total)
        const sh = studentByExam.get(e.id)
        const studentScore = sh?.score
        const studentMax = sh?.max_score
        const studentPct =
          studentScore != null && studentMax != null && studentMax > 0
            ? Math.round((studentScore / studentMax) * 100)
            : null
        return {
          name: `${e.subject}·${e.unit}`,
          examId: e.id,
          pct: total > 0 ? Math.round((avg / total) * 100) : 0,
          avg,
          total,
          studentPct,
          studentScore: studentScore ?? null,
          studentMax: studentMax ?? null,
        }
      })
  }, [examStats, studentHistory])

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [students, selectedStudentId],
  )

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

      {trendData.length > 0 && students.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="trend-student" className="text-xs text-gray-500 shrink-0">
            학생 비교
          </label>
          <select
            id="trend-student"
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white"
          >
            <option value="">— 선택 안 함 (학급 평균만) —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number ? `${s.number}번 ` : ''}
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <ScoreTrendChart
        data={trendData}
        studentName={selectedStudent ? selectedStudent.name : null}
      />

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
