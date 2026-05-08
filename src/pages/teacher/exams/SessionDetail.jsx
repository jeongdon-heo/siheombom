import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import {
  generateFeedback as aiGenerateFeedback,
  gradeAnswer as aiGradeAnswer,
} from '../../../lib/ai.js'
import { useAuth } from '../../../context/AuthContext.jsx'

export default function SessionDetail({
  sessionId: sessionIdProp,
  backTo: backToProp,
  backLabel: backLabelProp,
} = {}) {
  const params = useParams()
  const { teacher } = useAuth()
  const sessionId = sessionIdProp ?? params.sessionId
  const examId = params.examId
  const backTo = backToProp ?? `/teacher/exams/${examId}/results`
  const backLabel = backLabelProp ?? '← 응시 목록'
  const [data, setData] = useState(null)
  const [questionImages, setQuestionImages] = useState({}) // { [questionId]: image_url }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingNumber, setSavingNumber] = useState(null)
  const [aiBusyNumber, setAiBusyNumber] = useState(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [aiConfirmed, setAiConfirmed] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null) // { message, onConfirm }
  const [feedbackBusy, setFeedbackBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: d, error: err } = await supabase.rpc('get_session_for_teacher', {
        session_id_in: sessionId,
      })
      if (err) throw new Error(err.message)
      setData(d)

      // 문항 이미지를 별도로 로드 (results에는 imageUrl이 없음)
      const targetExamId = d?.exam?.id
      if (targetExamId) {
        const { data: qs, error: qErr } = await supabase
          .from('questions')
          .select('id, image_url')
          .eq('exam_id', targetExamId)
        if (!qErr && Array.isArray(qs)) {
          const map = {}
          for (const q of qs) {
            if (q?.id) map[q.id] = q.image_url || null
          }
          setQuestionImages(map)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const applyResults = (d) => {
    setData((prev) =>
      prev
        ? { ...prev, session: { ...prev.session, score: d.score, results: d.results } }
        : prev,
    )
  }

  const saveScore = async (number, finalScore) => {
    setSavingNumber(number)
    setError(null)
    try {
      const { data: d, error: err } = await supabase.rpc('update_question_grade', {
        session_id_in: sessionId,
        question_number_in: number,
        final_score_in: finalScore,
      })
      if (err) throw new Error(err.message)
      applyResults(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingNumber(null)
    }
  }

  const gradeOne = async (number) => {
    if (!teacher?.api_key_encrypted || !teacher?.provider) {
      throw new Error('설정에서 AI 공급자와 API 키를 먼저 저장해주세요.')
    }
    const { data: q, error: qErr } = await supabase.rpc('get_question_for_ai_grading', {
      session_id_in: sessionId,
      question_number_in: number,
    })
    if (qErr) throw new Error(qErr.message)
    if (!q) throw new Error('문항을 찾지 못했습니다.')

    const { score, reasoning } = await aiGradeAnswer({
      provider: teacher.provider,
      apiKey: teacher.api_key_encrypted,
      points: Number(q.points) || 0,
      correctAnswer: q.correctAnswer || '',
      studentAnswer: q.studentAnswer || '',
      imageUrl: q.imageUrl || null,
    })

    const { error: saveErr } = await supabase.rpc('save_ai_suggestion', {
      session_id_in: sessionId,
      question_number_in: number,
      ai_score_in: score,
      ai_reasoning_in: reasoning,
    })
    if (saveErr) throw new Error(saveErr.message)
  }

  const callAi = async (number) => {
    setAiBusyNumber(number)
    setError(null)
    try {
      await gradeOne(number)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setAiBusyNumber(null)
    }
  }

  const confirmAi = (message, onConfirm) => {
    if (aiConfirmed) {
      onConfirm()
      return
    }
    setConfirmModal({
      message,
      onConfirm: () => {
        setAiConfirmed(true)
        setConfirmModal(null)
        onConfirm()
      },
    })
  }

  const requestAi = (number) =>
    confirmAi('이 문항을 AI로 채점할까요? Claude API가 호출됩니다.', () => callAi(number))

  const generateFeedback = async () => {
    setFeedbackBusy(true)
    setError(null)
    try {
      if (!teacher?.api_key_encrypted || !teacher?.provider) {
        throw new Error('설정에서 AI 공급자와 API 키를 먼저 저장해주세요.')
      }
      if (!data?.session || !data?.student || !data?.exam) {
        throw new Error('세션 데이터가 비어있습니다.')
      }
      // 학습 목표를 포함한 요약을 RPC로 받아와서 더 나은 분석 생성
      const { data: summary, error: sErr } = await supabase.rpc(
        'get_session_summary_for_ai',
        { session_id_in: sessionId },
      )
      if (sErr) throw new Error(sErr.message)
      if (!summary) throw new Error('세션 요약을 불러오지 못했습니다.')

      const { studentFeedback, teacherAnalysis } = await aiGenerateFeedback({
        provider: teacher.provider,
        apiKey: teacher.api_key_encrypted,
        summary,
      })
      const { error: saveErr } = await supabase.rpc('save_session_feedback', {
        session_id_in: sessionId,
        student_feedback_in: studentFeedback,
        teacher_analysis_in: teacherAnalysis,
      })
      if (saveErr) throw new Error(saveErr.message)
      setData((prev) =>
        prev
          ? {
              ...prev,
              session: {
                ...prev.session,
                aiFeedback: studentFeedback,
                aiTeacherAnalysis: teacherAnalysis,
                aiFeedbackAt: new Date().toISOString(),
              },
            }
          : prev,
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setFeedbackBusy(false)
    }
  }

  const requestFeedback = (regen) =>
    confirmAi(
      regen
        ? '선생님의 한 마디를 다시 생성합니다. Claude API가 호출됩니다.'
        : '이 학생의 시험 결과로 "선생님의 한 마디"를 생성합니다. Claude API가 호출됩니다.',
      generateFeedback,
    )

  const requestBatchAi = (pendingNumbers) =>
    confirmAi(
      `채점 대기 ${pendingNumbers.length}문항을 AI로 일괄 채점합니다. Claude API가 ${pendingNumbers.length}회 호출됩니다.`,
      async () => {
        setBatchBusy(true)
        setError(null)
        try {
          for (const n of pendingNumbers) {
            setAiBusyNumber(n)
            await gradeOne(n)
          }
          await load()
        } catch (e) {
          setError(e.message)
        } finally {
          setBatchBusy(false)
          setAiBusyNumber(null)
        }
      },
    )

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-gray-400 text-sm">
        불러오는 중…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-full flex flex-col p-6 bg-white gap-5">
        <Link to={backTo} className="text-sm text-gray-500">
          {backLabel}
        </Link>
        <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 break-all">
          {error || '세션을 찾을 수 없습니다.'}
        </p>
      </div>
    )
  }

  const { student, session, exam } = data
  const results = Array.isArray(session.results) ? session.results : []
  const pct = session.maxScore > 0 ? Math.round((session.score / session.maxScore) * 100) : 0

  const pending = results.filter((r) => r.isCorrect === null || r.isCorrect === undefined)
  const graded = results.filter((r) => r.isCorrect === true || r.isCorrect === false)
  const pendingNumbers = pending.map((r) => r.number)

  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <Link to={backTo} className="text-sm text-gray-500">
          {backLabel}
        </Link>
        <h2 className="text-base font-bold truncate px-2">{exam.subject} · {exam.unit}</h2>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
        )}

        {/* 학생 + 총점 */}
        <div className="rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
          <span className="shrink-0 w-12 h-12 rounded-full bg-teacher text-white text-lg font-bold flex items-center justify-center">
            {student.number}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900">{student.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {session.submitted ? '제출 완료' : '미제출'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-teacher">
              {session.score ?? 0}
              <span className="text-sm text-gray-400">/{session.maxScore ?? 0}</span>
            </p>
            <p className="text-xs text-gray-400">{pct}%</p>
          </div>
        </div>

        {/* AI 분석: 학생용 한 마디 + 교사용 학습 분석 */}
        {session.submitted && (
          <FeedbackSection
            studentFeedback={session.aiFeedback}
            teacherAnalysis={session.aiTeacherAnalysis}
            busy={feedbackBusy}
            disabled={pending.length > 0}
            onRequest={requestFeedback}
          />
        )}

        {pending.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-amber-800">📝 채점 대기</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
                {pending.length}문항
              </span>
              <button
                type="button"
                disabled={batchBusy || pendingNumbers.length === 0}
                onClick={() => requestBatchAi(pendingNumbers)}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-teacher text-white disabled:opacity-50"
              >
                {batchBusy ? 'AI 채점 중…' : '🤖 전체 AI 채점'}
              </button>
            </div>
            {pending.map((r) => (
              <QuestionGradeCard
                key={r.number}
                r={r}
                imageUrl={questionImages[r.questionId] || null}
                saving={savingNumber === r.number}
                aiBusy={aiBusyNumber === r.number}
                onSaveScore={(fs) => saveScore(r.number, fs)}
                onRequestAi={() => requestAi(r.number)}
              />
            ))}
          </section>
        )}

        {graded.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-gray-700">채점 완료</h3>
            {graded.map((r) => (
              <QuestionGradeCard
                key={r.number}
                r={r}
                imageUrl={questionImages[r.questionId] || null}
                saving={savingNumber === r.number}
                aiBusy={aiBusyNumber === r.number}
                onSaveScore={(fs) => saveScore(r.number, fs)}
                onRequestAi={() => requestAi(r.number)}
              />
            ))}
          </section>
        )}
      </div>

      {/* AI 비용 확인 모달 */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-900">AI 채점</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold"
              >
                취소
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 py-3 rounded-xl bg-teacher text-white text-sm font-bold shadow"
              >
                계속
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QuestionGradeCard({ r, imageUrl, saving, aiBusy, onSaveScore, onRequestAi }) {
  const isPending = r.isCorrect === null || r.isCorrect === undefined
  const isAuto = r.autoGraded !== false
  const points = r.points ?? 0
  const currentScore =
    typeof r.finalScore === 'number'
      ? r.finalScore
      : r.isCorrect === true
        ? points
        : r.isCorrect === false
          ? 0
          : null

  // 틀린 문항은 기본 펼침 (원인 파악 도와주기), 그 외는 접힘
  const [imgOpen, setImgOpen] = useState(r.isCorrect === false)
  const hasImage = !!imageUrl

  const bg = isPending
    ? 'border-amber-300 bg-amber-50/60'
    : r.isCorrect === true
      ? 'border-green-200 bg-green-50/50'
      : 'border-red-200 bg-red-50/50'

  const badge = isPending
    ? { cls: 'bg-amber-400 text-white', text: '대기' }
    : r.isCorrect === true
      ? { cls: 'bg-green-500 text-white', text: 'O' }
      : { cls: 'bg-red-500 text-white', text: 'X' }

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${bg}`}>
      <button
        type="button"
        onClick={() => hasImage && setImgOpen((v) => !v)}
        disabled={!hasImage}
        className={`flex items-center gap-2 flex-wrap text-left -m-1 p-1 rounded-lg ${
          hasImage ? 'hover:bg-black/5 cursor-pointer' : 'cursor-default'
        }`}
        title={hasImage ? '클릭해서 문제 이미지 보기' : undefined}
      >
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${badge.cls}`}>
          {badge.text}
        </span>
        <span className="text-sm font-bold text-gray-800">{r.number}번</span>
        <span className="text-xs text-gray-400">{points}점</span>
        {r.teacherModified && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teacher/10 text-teacher font-semibold">
            교사 수정
          </span>
        )}
        {!isAuto && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
            수동 채점
          </span>
        )}
        {hasImage && (
          <span className="text-[10px] text-gray-400">
            {imgOpen ? '▲ 문제 접기' : '▼ 문제 보기'}
          </span>
        )}
        <span className="ml-auto text-xs font-bold text-gray-500">
          +{typeof currentScore === 'number' ? currentScore : 0}점
        </span>
      </button>

      {hasImage && imgOpen && (
        <div className="rounded-lg overflow-hidden border border-gray-200 bg-white">
          <img
            src={imageUrl}
            alt={`${r.number}번 문제`}
            className="w-full h-auto block"
          />
        </div>
      )}

      <div className="text-2xl text-gray-700 pl-9 flex flex-col gap-1">
        <p>학생 답: <span className="font-medium whitespace-pre-wrap">{r.studentAnswer || '(미작성)'}</span></p>
        <p className="text-gray-500">정답: {r.correctAnswer || '(없음)'}</p>
      </div>

      {!isAuto ? (
        <ManualGradeControls
          r={r}
          points={points}
          currentScore={currentScore}
          saving={saving}
          aiBusy={aiBusy}
          onSaveScore={onSaveScore}
          onRequestAi={onRequestAi}
        />
      ) : (
        <AutoGradeToggle
          currentScore={currentScore}
          points={points}
          saving={saving}
          onSaveScore={onSaveScore}
        />
      )}
    </div>
  )
}

function AutoGradeToggle({ currentScore, points, saving, onSaveScore }) {
  const isRight = currentScore === points && points > 0
  const isWrong = currentScore === 0
  return (
    <div className="pl-9 flex gap-2 pt-1">
      <button
        type="button"
        disabled={saving}
        onClick={() => onSaveScore(points)}
        className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
          isRight
            ? 'bg-green-600 text-white border-green-600'
            : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
        } disabled:opacity-50`}
      >
        ✅ 정답 처리
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => onSaveScore(0)}
        className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
          isWrong
            ? 'bg-red-600 text-white border-red-600'
            : 'bg-white text-red-700 border-red-300 hover:bg-red-50'
        } disabled:opacity-50`}
      >
        ❌ 오답 처리
      </button>
    </div>
  )
}

function ManualGradeControls({
  r,
  points,
  currentScore,
  saving,
  aiBusy,
  onSaveScore,
  onRequestAi,
}) {
  const [pickedScore, setPickedScore] = useState(null)
  const aiScore = typeof r.aiSuggestedScore === 'number' ? r.aiSuggestedScore : null
  const aiReasoning = r.aiReasoning || ''

  // 표시 점수: 교사가 방금 선택한 값 → finalScore → aiSuggested → null
  const displayScore =
    pickedScore != null
      ? pickedScore
      : typeof currentScore === 'number'
        ? currentScore
        : aiScore

  return (
    <div className="pl-9 flex flex-col gap-2 pt-1">
      {aiScore == null && !aiBusy && (
        <button
          type="button"
          disabled={aiBusy || saving}
          onClick={onRequestAi}
          className="self-start px-3 py-2 rounded-lg text-xs font-bold bg-white border border-teacher text-teacher hover:bg-teacher/5 disabled:opacity-50"
        >
          🤖 AI 채점 요청
        </button>
      )}
      {aiBusy && (
        <div className="text-xs text-teacher">AI가 채점 중…</div>
      )}

      {aiScore != null && (
        <div className="rounded-lg bg-white border border-gray-200 p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-teacher">🤖 AI 채점 제안</span>
            <span className="text-xs text-gray-500">
              {aiScore}/{points}점
            </span>
            <button
              type="button"
              disabled={aiBusy || saving}
              onClick={onRequestAi}
              className="ml-auto text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              다시 요청
            </button>
          </div>
          {aiReasoning && (
            <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
              {aiReasoning}
            </p>
          )}
        </div>
      )}

      {/* 점수 picker */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: points + 1 }).map((_, i) => {
          const picked = displayScore === i
          const isAiSuggestion = aiScore === i
          return (
            <button
              key={i}
              type="button"
              disabled={saving || aiBusy}
              onClick={() => setPickedScore(i)}
              className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors disabled:opacity-50 ${
                picked
                  ? 'bg-teacher text-white border-teacher'
                  : isAiSuggestion
                    ? 'bg-teacher/10 text-teacher border-teacher'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-teacher/40'
              }`}
              title={isAiSuggestion ? 'AI 제안' : undefined}
            >
              {i}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        disabled={saving || aiBusy || displayScore == null}
        onClick={() => {
          const fs = displayScore
          if (fs == null) return
          setPickedScore(null)
          onSaveScore(fs)
        }}
        className="mt-1 px-4 py-2 rounded-lg text-sm font-bold bg-teacher text-white shadow disabled:opacity-50"
      >
        {saving ? '저장 중…' : '채점 확정'}
      </button>
    </div>
  )
}

function FeedbackSection({
  studentFeedback,
  teacherAnalysis,
  busy,
  disabled,
  onRequest,
}) {
  const has = !!(studentFeedback || teacherAnalysis)
  return (
    <section className="rounded-2xl border border-teacher/20 bg-teacher/5 p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🤖</span>
        <h3 className="text-sm font-bold text-gray-800">AI 분석</h3>
        {has ? (
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => onRequest(true)}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-teacher/30 text-teacher disabled:opacity-50"
          >
            {busy ? '생성 중…' : '다시 생성'}
          </button>
        ) : (
          !disabled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRequest(false)}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-teacher text-white shadow disabled:opacity-50"
            >
              {busy ? '생성 중…' : 'AI 분석 생성'}
            </button>
          )
        )}
      </div>

      {disabled && !has && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          채점 대기 문항을 먼저 채점한 뒤 생성해 주세요.
        </p>
      )}

      {studentFeedback && (
        <div className="rounded-xl bg-white border border-teacher/20 p-3 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-base">💌</span>
            <span className="text-xs font-bold text-gray-700">
              선생님의 한 마디 (학생에게 보여지는 글)
            </span>
          </div>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {studentFeedback}
          </p>
        </div>
      )}

      {teacherAnalysis && (
        <div className="rounded-xl bg-white border border-gray-200 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">📊</span>
            <span className="text-xs font-bold text-gray-700">AI 학습 분석 (교사용)</span>
          </div>
          <TeacherAnalysisRenderer text={teacherAnalysis} />
        </div>
      )}
    </section>
  )
}

function TeacherAnalysisRenderer({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const blocks = []
  let currentList = null

  const flush = () => {
    if (currentList) {
      blocks.push({ type: 'list', items: currentList })
      currentList = null
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('- ')) {
      if (!currentList) currentList = []
      currentList.push(line.slice(2))
      continue
    }
    flush()
    blocks.push({ type: 'heading', text: line })
  }
  flush()

  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <h4
              key={i}
              className="text-sm font-bold text-gray-800 mt-1 first:mt-0"
            >
              {b.text}
            </h4>
          )
        }
        return (
          <ul key={i} className="flex flex-col gap-1 pl-1">
            {b.items.map((item, j) => (
              <li
                key={j}
                className="text-sm text-gray-700 leading-relaxed flex gap-2"
              >
                <span className="text-teacher shrink-0">•</span>
                <span className="whitespace-pre-wrap">{item}</span>
              </li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}
