import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { supabase } from '../../../lib/supabase.js'
import { pdfToImages, extractTextPositions, computeBboxesFromTextLayer, findBboxOnPage } from '../../../lib/pdf.js'
import { cropByBbox, cropByPosition } from '../../../lib/crop.js'
import { analyzeExam } from '../../../lib/ai.js'
import QuestionCard from './QuestionCard.jsx'
import PassageEditor, { makePassageTitle } from './PassageEditor.jsx'

function StepBadge({ step, active, label }) {
  return (
    <div
      className={`flex-1 text-center text-xs py-2 rounded-full ${
        active ? 'bg-teacher text-white' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {step}. {label}
    </div>
  )
}

export default function NewExam() {
  const { teacher, session } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [subject, setSubject] = useState('')
  const [unit, setUnit] = useState('')
  const [examFile, setExamFile] = useState(null)
  const [answerFile, setAnswerFile] = useState(null)

  const [examImages, setExamImages] = useState([])
  const [answerImages, setAnswerImages] = useState([])
  const [questions, setQuestions] = useState([])
  const [passages, setPassages] = useState([])

  const [working, setWorking] = useState(false)
  const [workingMsg, setWorkingMsg] = useState('')
  const [error, setError] = useState(null)
  const [textLayerBboxMap, setTextLayerBboxMap] = useState(null)
  const [textLayerPositions, setTextLayerPositions] = useState([])

  // crop 결과 캐시
  const cropCacheRef = useRef(new Map())
  const getCrop = useCallback(
    async (page, position, bbox) => {
      // bbox가 있으면 bbox 기반, 없으면 position 폴백
      const key = bbox
        ? `${page}-bbox-${bbox.x}-${bbox.y}-${bbox.w}-${bbox.h}`
        : `${page}-${position}`
      const cache = cropCacheRef.current
      if (cache.has(key)) return cache.get(key)
      const pageImg = examImages.find((p) => p.page === page)
      if (!pageImg) return null
      const r = bbox
        ? await cropByBbox(pageImg.dataUrl, bbox)
        : await cropByPosition(pageImg.dataUrl, position)
      cache.set(key, r)
      return r
    },
    [examImages],
  )

  // step 1 → step 2
  const goAnalyze = async () => {
    setError(null)
    if (!subject.trim() || !unit.trim()) {
      setError('과목과 단원을 입력해주세요.')
      return
    }
    if (!examFile) {
      setError('시험지 PDF 를 업로드해주세요.')
      return
    }
    setWorking(true)
    setWorkingMsg('PDF 를 이미지로 변환하는 중…')
    try {
      const ex = await pdfToImages(examFile)
      const ans = answerFile ? await pdfToImages(answerFile) : []

      // 텍스트 레이어에서 문항 번호 위치 감지
      let bboxMap = null
      try {
        setWorkingMsg('문항 번호 위치를 감지하는 중…')
        const positions = await extractTextPositions(examFile)
        setTextLayerPositions(positions)
        if (positions.length > 0) {
          bboxMap = computeBboxesFromTextLayer(positions)
          console.log('[textLayer] 감지된 문항:', [...bboxMap.keys()])
        }
      } catch (e) {
        console.warn('텍스트 레이어 추출 실패 (스캔본일 수 있음):', e)
      }
      setTextLayerBboxMap(bboxMap)

      setExamImages(ex)
      setAnswerImages(ans)
      cropCacheRef.current = new Map()
      setStep(2)
      // step 2 에서 바로 AI 분석 실행
      await runAnalysis(ex, ans, bboxMap)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setWorking(false)
      setWorkingMsg('')
    }
  }

  const runAnalysis = async (exImgs = examImages, ansImgs = answerImages, tlBboxMap = textLayerBboxMap) => {
    if (!teacher?.api_key_encrypted || !teacher?.provider) {
      setError('설정에서 AI 공급자와 API 키를 먼저 저장해주세요.')
      return
    }
    setWorking(true)
    setWorkingMsg('AI 가 문항을 분석하는 중… (페이지 수에 따라 수십 초)')
    setError(null)
    try {
      const arr = await analyzeExam({
        provider: teacher.provider,
        apiKey: teacher.api_key_encrypted,
        examImages: exImgs,
        answerImages: ansImgs,
      })
      const normalized = arr.map((q, i) => {
        const qNumber = Number.isFinite(q.number) ? q.number : i + 1

        // 1순위: 텍스트 레이어 bbox (PDF 좌표 기반, 가장 정확)
        const tlBbox = tlBboxMap?.get(qNumber)
        let bbox = null
        let page = Math.min(Math.max(parseInt(q.page, 10) || 1, 1), exImgs.length || 1)

        if (tlBbox) {
          bbox = { x: tlBbox.x, y: tlBbox.y, w: tlBbox.w, h: tlBbox.h }
          page = tlBbox.page
        } else {
          // 2순위: AI bbox
          const rawBbox = q.bbox
          bbox =
            rawBbox &&
            Number.isFinite(rawBbox.x) &&
            Number.isFinite(rawBbox.y) &&
            Number.isFinite(rawBbox.w) &&
            Number.isFinite(rawBbox.h) &&
            rawBbox.w > 0 &&
            rawBbox.h > 0
              ? {
                  x: rawBbox.x,
                  y: rawBbox.y,
                  w: rawBbox.w > 65 ? 50 : rawBbox.w,
                  h: rawBbox.h,
                }
              : null
          if (bbox && rawBbox.w > 65) {
            const center = rawBbox.x + rawBbox.w / 2
            bbox.x = center >= 50 ? 50 : 0
          }
        }

        const qType = ['multiple_choice', 'short_answer', 'essay', 'matching'].includes(q.type)
          ? q.type
          : 'short_answer'
        const rawOptCount = parseInt(q.option_count, 10)
        const optionCount =
          qType === 'multiple_choice'
            ? Number.isFinite(rawOptCount) && rawOptCount >= 2 && rawOptCount <= 10
              ? rawOptCount
              : 5
            : 5
        return {
          id: `q-${i}-${Math.random().toString(36).slice(2, 8)}`,
          number: qNumber,
          type: qType,
          correct_answer: q.correct_answer ?? '',
          option_count: optionCount,
          option_style: 'number_circle',
          input_buttons: 'none',
          answer_format: 'text',
          answer_order_hint: '',
          match_count: 3,
          manual_grading: false,
          order_sensitive: false,
          essay_mode: 'general',
          answer_unit: '',
          example_solution: '',
          process_points: null,
          answer_points: null,
          points: 0, // 저장 시 100 ÷ 문항수로 자동 계산
          page,
          position: ['top', 'middle', 'bottom'].includes(q.position)
            ? q.position
            : 'middle',
          bbox,
          sub_count: Number.isFinite(q.sub_count) && q.sub_count > 1 ? q.sub_count : 1,
          learning_objective: q.learning_objective ?? '',
          expanded: false,
        }
      })
      setQuestions(normalized)
      setStep(3)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setWorking(false)
      setWorkingMsg('')
    }
  }

  const addBlankQuestion = () => {
    const maxNum = questions.reduce((m, q) => Math.max(m, q.number), 0)
    setQuestions([
      ...questions,
      {
        id: `q-new-${Date.now()}`,
        number: maxNum + 1,
        type: 'short_answer',
        correct_answer: '',
        option_count: 5,
        option_style: 'number_circle',
        input_buttons: 'none',
        answer_format: 'text',
        answer_order_hint: '',
        match_count: 3,
        manual_grading: false,
        order_sensitive: false,
        essay_mode: 'general',
        answer_unit: '',
        example_solution: '',
        process_points: null,
        answer_points: null,
        points: 0,
        page: 1,
        position: 'middle',
        bbox: null,
        sub_count: 1,
        learning_objective: '',
        expanded: true,
      },
    ])
  }

  const updateQuestion = (id, next) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? next : q)))
  const deleteQuestion = (id) =>
    setQuestions((qs) => qs.filter((q) => q.id !== id))

  const addPassage = () => {
    setPassages((ps) => [
      ...ps,
      {
        id: `p-new-${Date.now()}`,
        page: 1,
        bbox: { x: 0, y: 0, w: 100, h: 30 },
        questionNumbers: [],
        expanded: true,
      },
    ])
  }
  const updatePassage = (id, next) =>
    setPassages((ps) => ps.map((p) => (p.id === id ? next : p)))
  const deletePassage = (id) =>
    setPassages((ps) => ps.filter((p) => p.id !== id))

  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.number - b.number),
    [questions],
  )

  const saveExam = async () => {
    setError(null)
    if (!questions.length) {
      setError('저장할 문항이 없어요.')
      return
    }
    const numbers = questions.map((q) => q.number)
    if (new Set(numbers).size !== numbers.length) {
      setError('문항 번호가 중복됩니다. 번호를 다시 확인해주세요.')
      return
    }
    setWorking(true)
    setWorkingMsg('저장 중…')
    let createdExamId = null
    const uploadedPaths = []
    try {
      // ── DIAG: 업로드 직전에 실제 auth 상태를 찍는다 ──
      // teacher.id === session.user.id === whoami().uid 여야 Storage RLS 통과
      const { data: authUser } = await supabase.auth.getUser()
      const { data: who, error: whoErr } = await supabase.rpc('whoami')
      console.log('[saveExam DIAG]', {
        'teacher.id': teacher?.id,
        'session.user.id': session?.user?.id,
        'supabase.auth.getUser().id': authUser?.user?.id,
        'whoami() (PG 가 보는 값)': who,
        'whoami rpc error': whoErr,
        'access_token 존재?': Boolean(session?.access_token),
        'uploadPath prefix': `${teacher?.id}/`,
      })

      // [1/3] exams insert
      const { data: exam, error: e1 } = await supabase
        .from('exams')
        .insert({ teacher_id: teacher.id, subject: subject.trim(), unit: unit.trim() })
        .select()
        .single()
      if (e1) throw new Error(`[1/3 exams insert] ${e1.message}`)
      createdExamId = exam.id

      // 배점 자동 계산: 총점 100점 ÷ 문항 수
      const pointsPerQ = Math.floor(100 / sortedQuestions.length)
      const numberToQuestionId = new Map()

      for (const q of sortedQuestions) {
        setWorkingMsg(`저장 중… (${q.number}번 이미지 업로드)`)
        const crop = await getCrop(q.page, q.position, q.bbox)
        if (!crop) throw new Error(`p.${q.page} 이미지를 찾을 수 없습니다.`)

        const path = `${teacher.id}/${exam.id}/q${String(q.number).padStart(3, '0')}.jpg`
        // [2/3] storage upload
        const { error: e2 } = await supabase.storage
          .from('question-images')
          .upload(path, crop.blob, {
            contentType: 'image/jpeg',
            upsert: true,
          })
        if (e2) {
          console.error('[saveExam upload fail]', {
            path,
            'path firstSegment': path.split('/')[0],
            'teacher.id': teacher?.id,
            'session.user.id': session?.user?.id,
            error: e2,
            statusCode: e2.statusCode,
            errorName: e2.name,
          })
          throw new Error(`[2/3 storage upload @ ${path}] ${e2.message}`)
        }
        uploadedPaths.push(path)
        const { data: pub } = supabase.storage
          .from('question-images')
          .getPublicUrl(path)

        // [3/3] questions insert
        const { data: insertedQ, error: e3 } = await supabase
          .from('questions')
          .insert({
            exam_id: exam.id,
            number: q.number,
            text: '',
            type: q.type,
            options: null,
            correct_answer: q.correct_answer,
            points: pointsPerQ,
            image_url: pub.publicUrl,
            learning_objective: q.learning_objective,
            page: q.page,
            position: q.position,
            bbox: q.bbox,
            sub_count: q.sub_count ?? 1,
            option_count: q.type === 'multiple_choice' ? (q.option_count ?? 5) : 5,
            option_style:
              q.type === 'multiple_choice' ? (q.option_style || 'number_circle') : 'number_circle',
            input_buttons:
              q.type === 'multiple_choice' ? 'none' : (q.input_buttons || 'none'),
            answer_format:
              q.type === 'short_answer' ? (q.answer_format || 'text') : 'text',
            answer_order_hint:
              (q.sub_count ?? 1) > 1 ? (q.answer_order_hint || '') : '',
            match_count:
              q.type === 'matching'
                ? Math.max(2, Math.min(10, parseInt(q.match_count, 10) || 3))
                : 3,
            manual_grading:
              q.manual_grading === true ||
              (typeof q.correct_answer === 'string' &&
                q.correct_answer.trim().startsWith('(예)')),
            order_sensitive:
              q.type === 'short_answer' &&
              (q.sub_count ?? 1) === 1 &&
              (q.answer_format || 'text') !== 'fraction' &&
              q.order_sensitive === true,
            essay_mode:
              q.type === 'essay'
                ? (['general', 'math'].includes(q.essay_mode) ? q.essay_mode : 'general')
                : 'general',
            answer_unit:
              q.type === 'essay' && q.essay_mode === 'math' ? (q.answer_unit || null) : null,
            example_solution: q.type === 'essay' ? (q.example_solution || null) : null,
            process_points:
              q.type === 'essay' && q.essay_mode === 'math' && Number.isFinite(q.process_points)
                ? q.process_points
                : null,
            answer_points:
              q.type === 'essay' && q.essay_mode === 'math' && Number.isFinite(q.answer_points)
                ? q.answer_points
                : null,
          })
          .select('id, number')
          .single()
        if (e3) throw new Error(`[3/3 questions insert q${q.number}] ${e3.message}`)
        numberToQuestionId.set(insertedQ.number, insertedQ.id)
      }

      // ── 지문 업로드 + 삽입 + 연결 ──
      for (let i = 0; i < passages.length; i++) {
        const p = passages[i]
        if (!p.questionNumbers?.length) continue
        setWorkingMsg(`저장 중… (지문 ${i + 1} 업로드)`)

        const passageCrop = await getCrop(p.page, null, p.bbox)
        if (!passageCrop) throw new Error(`p.${p.page} 지문 이미지를 찾을 수 없습니다.`)

        const path = `${teacher.id}/${exam.id}/passages/p${String(i + 1).padStart(2, '0')}.jpg`
        const { error: pe1 } = await supabase.storage
          .from('question-images')
          .upload(path, passageCrop.blob, {
            contentType: 'image/jpeg',
            upsert: true,
          })
        if (pe1) throw new Error(`[passage upload @ ${path}] ${pe1.message}`)
        uploadedPaths.push(path)
        const { data: passagePub } = supabase.storage
          .from('question-images')
          .getPublicUrl(path)

        const { data: insertedP, error: pe2 } = await supabase
          .from('passages')
          .insert({
            exam_id: exam.id,
            title: makePassageTitle(p.questionNumbers),
            image_url: passagePub.publicUrl,
            page: p.page,
            bbox: p.bbox,
          })
          .select('id')
          .single()
        if (pe2) throw new Error(`[passage insert] ${pe2.message}`)

        const linkedIds = p.questionNumbers
          .map((n) => numberToQuestionId.get(n))
          .filter(Boolean)
        if (linkedIds.length) {
          const { error: pe3 } = await supabase
            .from('questions')
            .update({ passage_id: insertedP.id })
            .in('id', linkedIds)
          if (pe3) throw new Error(`[passage link] ${pe3.message}`)
        }
      }

      navigate('/teacher', { replace: true })
    } catch (e) {
      setError(e.message || String(e))
      // 부분 저장 롤백: 업로드된 이미지 삭제 → exam 행 삭제 (questions 는 CASCADE)
      if (uploadedPaths.length) {
        try {
          await supabase.storage.from('question-images').remove(uploadedPaths)
        } catch (cleanupErr) {
          console.warn('[rollback] storage cleanup failed', cleanupErr)
        }
      }
      if (createdExamId) {
        try {
          await supabase.from('exams').delete().eq('id', createdExamId)
        } catch (cleanupErr) {
          console.warn('[rollback] exam delete failed', cleanupErr)
        }
      }
    } finally {
      setWorking(false)
      setWorkingMsg('')
    }
  }

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-5">
      <header className="flex items-center justify-between">
        <Link to="/teacher" className="text-sm text-gray-500">← 홈</Link>
        <h2 className="text-lg font-bold">시험 만들기</h2>
        <span className="w-10" />
      </header>

      <div className="flex gap-1">
        <StepBadge step={1} active={step === 1} label="업로드" />
        <StepBadge step={2} active={step === 2} label="AI 분석" />
        <StepBadge step={3} active={step === 3} label="검수" />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">
          {error}
        </div>
      )}
      {working && (
        <div className="rounded-lg bg-teacher/10 text-teacher text-sm p-3">
          {workingMsg || '작업 중…'}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700">과목</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="수학"
              className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700">단원</span>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="1. 분수의 덧셈과 뺄셈"
              className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700">시험지 PDF</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setExamFile(e.target.files?.[0] ?? null)}
              className="border border-dashed border-gray-300 rounded-lg p-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700">정답지 PDF (선택)</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setAnswerFile(e.target.files?.[0] ?? null)}
              className="border border-dashed border-gray-300 rounded-lg p-3 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={goAnalyze}
            disabled={working}
            className="mt-2 rounded-lg bg-teacher text-white py-3 font-semibold shadow disabled:opacity-50"
          >
            다음 — AI 분석 시작
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 items-center py-10">
          {working ? (
            <>
              <div className="w-12 h-12 rounded-full border-4 border-teacher border-t-transparent animate-spin" />
              <p className="text-sm text-gray-600">AI 가 문항을 추출하는 중입니다…</p>
              <p className="text-xs text-gray-400 text-center">
                시험지 {examImages.length}장 / 정답지 {answerImages.length}장
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 text-center">
                AI 분석이 중단되었습니다. 다시 시도하거나 업로드 단계로 돌아갈 수 있어요.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setStep(1)
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm"
                >
                  업로드로 돌아가기
                </button>
                <button
                  type="button"
                  onClick={() => runAnalysis()}
                  className="px-4 py-2 rounded-lg bg-teacher text-white text-sm font-semibold"
                >
                  다시 시도
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-700">
              총 <span className="font-bold text-teacher">{questions.length}</span>문항
              · 만점 <span className="font-bold">100</span>점
              · 문항당{' '}
              <span className="font-bold">
                {questions.length > 0 ? Math.floor(100 / questions.length) : 0}
              </span>
              점
            </p>
            <button
              type="button"
              onClick={addBlankQuestion}
              className="text-xs px-3 py-1.5 rounded-lg border border-teacher text-teacher"
            >
              + 문항 추가
            </button>
          </div>

          {/* ── 지문 관리 ── */}
          <section className="rounded-xl bg-amber-50/50 border border-amber-100 p-3 flex flex-col gap-2">
            <h3 className="text-sm font-bold text-gray-800">📖 지문 관리</h3>
            {passages.length === 0 ? (
              <p className="text-xs text-gray-500">
                국어처럼 여러 문항이 공통 지문을 쓰는 경우 우측 하단의 "지문 추가" 버튼으로 추가하세요. 없으면 건너뜀.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {passages.map((p) => (
                  <PassageEditor
                    key={p.id}
                    p={p}
                    allNumbers={sortedQuestions.map((q) => q.number)}
                    pageCount={Math.max(examImages.length, 1)}
                    examImages={examImages}
                    onChange={(next) => updatePassage(p.id, next)}
                    onDelete={() => deletePassage(p.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="flex flex-col gap-2">
            {sortedQuestions.map((q) => {
              // 같은 페이지 문항들 중 이 문항의 순번(0부터)과 페이지 총 문항수
              const samePage = sortedQuestions.filter((sq) => sq.page === q.page)
              const pageIdx = samePage.indexOf(q)
              const pageTotal = samePage.length
              return (
              <QuestionCard
                key={q.id}
                q={q}
                pageIdx={pageIdx >= 0 ? pageIdx : 0}
                pageTotal={pageTotal}
                pageCount={Math.max(examImages.length, 1)}
                examImages={examImages}
                textLayerBboxMap={textLayerBboxMap}
                textLayerPositions={textLayerPositions}
                onChange={(next) => updateQuestion(q.id, next)}
                onDelete={() => deleteQuestion(q.id)}
              />
              )
            })}
          </div>

          <button
            type="button"
            onClick={saveExam}
            disabled={working || !questions.length}
            className="mt-4 mb-20 rounded-lg bg-teacher text-white py-3 font-semibold shadow disabled:opacity-50"
          >
            저장
          </button>

          {/* ── 플로팅: 지문 추가 ── */}
          <button
            type="button"
            onClick={addPassage}
            className="fixed right-6 bottom-20 z-40 flex items-center gap-2 px-5 py-3.5 rounded-full bg-amber-500 text-white text-sm font-bold shadow-lg shadow-amber-500/40 hover:bg-amber-600 active:scale-95 transition-all"
          >
            <span className="text-lg leading-none">📖</span>
            <span>지문 추가</span>
          </button>
        </div>
      )}
    </div>
  )
}
