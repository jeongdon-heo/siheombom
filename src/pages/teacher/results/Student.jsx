import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import SessionDetail from '../exams/SessionDetail.jsx'

export default function ResultsStudent() {
  const { examId, studentId } = useParams()
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_session_id_by_student_exam', {
          exam_id_in: examId,
          student_id_in: studentId,
        })
        if (err) throw new Error(err.message)
        if (!data) throw new Error('이 학생의 응시 기록이 없습니다.')
        if (mounted) setSessionId(data)
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [examId, studentId])

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-gray-400 text-sm">
        불러오는 중…
      </div>
    )
  }

  if (error || !sessionId) {
    return (
      <div className="min-h-full flex flex-col p-6 bg-white gap-5">
        <Link to={`/teacher/results/${examId}`} className="text-sm text-gray-500">
          ← 응시 목록
        </Link>
        <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 break-all">
          {error || '세션을 찾을 수 없습니다.'}
        </p>
      </div>
    )
  }

  return (
    <SessionDetail
      sessionId={sessionId}
      backTo={`/teacher/results/${examId}`}
      backLabel="← 응시 목록"
    />
  )
}
