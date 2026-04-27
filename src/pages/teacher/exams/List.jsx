import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { supabase } from '../../../lib/supabase.js'

const CONFIRM_COOLDOWN_SEC = 3

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}.${m}.${day}`
}

export default function ExamsList() {
  const { teacher } = useAuth()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // 모달이 열리는 순간 3초 카운트다운 시작 (오클릭 방지)
  useEffect(() => {
    if (!confirmTarget) {
      setCooldown(0)
      return
    }
    setCooldown(CONFIRM_COOLDOWN_SEC)
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(id)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [confirmTarget])

  const fetchExams = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('list_teacher_exams')
      if (err) throw new Error(err.message)
      setExams(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchExams()
  }, [fetchExams])

  const handleDelete = async (exam) => {
    if (!teacher?.id) return
    setDeleting(true)
    setError(null)
    try {
      // 1) Storage: 문항 이미지 + 지문 이미지 전체 제거
      const prefix = `${teacher.id}/${exam.id}`
      const [rootList, passageList] = await Promise.all([
        supabase.storage.from('question-images').list(prefix),
        supabase.storage.from('question-images').list(`${prefix}/passages`),
      ])

      const paths = [
        ...((rootList.data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`)),
        ...((passageList.data ?? []).filter((f) => f.id).map((f) => `${prefix}/passages/${f.name}`)),
      ]
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from('question-images').remove(paths)
        if (rmErr) console.warn('[delete exam] storage remove failed', rmErr)
      }

      // 2) DB: exams 행 삭제 (questions/exam_sessions/passages 는 cascade)
      const { error: delErr } = await supabase.from('exams').delete().eq('id', exam.id)
      if (delErr) throw new Error(delErr.message)

      setConfirmTarget(null)
      await fetchExams()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-5">
      <header className="flex items-center justify-between">
        <Link to="/teacher" className="text-sm text-gray-500">← 홈</Link>
        <h2 className="text-lg font-bold">시험 관리</h2>
        <Link
          to="/teacher/exams/new"
          className="text-xs px-3 py-1.5 rounded-lg bg-teacher text-white font-semibold"
        >
          + 새 시험
        </Link>
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">
          {error}
        </div>
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
          {exams.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-gray-200 p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">
                  {e.subject} · {e.unit}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {e.question_count}문항 · 응시 {e.session_count}명 · {formatDate(e.created_at)}
                </p>
              </div>
              <Link
                to={`/teacher/exams/${e.id}/results`}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-teacher border border-teacher/30 hover:bg-teacher/10"
              >
                결과
              </Link>
              <button
                onClick={() => setConfirmTarget(e)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-red-600 border border-red-200 hover:bg-red-50"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 삭제 확인 모달 */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-900">⚠️ 이 시험을 삭제하시겠습니까?</h3>
            <dl className="text-sm text-gray-700 leading-relaxed grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-gray-500">과목</dt>
              <dd className="font-semibold">{confirmTarget.subject}</dd>
              <dt className="text-gray-500">단원</dt>
              <dd className="font-semibold">{confirmTarget.unit}</dd>
              <dt className="text-gray-500">응시 인원</dt>
              <dd className="font-semibold">{confirmTarget.session_count}명</dd>
            </dl>
            <p className="text-sm text-red-600 leading-relaxed">
              삭제하면 학생 응시 기록도 함께 삭제됩니다.
              <br />
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => handleDelete(confirmTarget)}
                disabled={deleting || cooldown > 0}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-bold shadow disabled:opacity-50"
              >
                {deleting
                  ? '삭제 중…'
                  : cooldown > 0
                    ? `삭제하기 (${cooldown}초)`
                    : '삭제하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
