import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import { supabase } from '../../../lib/supabase.js'
import { generateFeedback as aiGenerateFeedback } from '../../../lib/ai.js'
import { useAuth } from '../../../context/AuthContext.jsx'

export default function ResultsExam() {
  const { examId } = useParams()
  const { teacher } = useAuth()
  const [sessions, setSessions] = useState([])
  const [questionStats, setQuestionStats] = useState([])
  const [exam, setExam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)

  const fetchSessions = async () => {
    const { data, error: err } = await supabase.rpc(
      'list_exam_sessions_for_teacher',
      { exam_id_in: examId },
    )
    if (err) throw new Error(err.message)
    return Array.isArray(data) ? data : []
  }

  const fetchQuestionStats = async () => {
    const { data, error: err } = await supabase.rpc(
      'get_question_stats_for_exam',
      { exam_id_in: examId },
    )
    if (err) throw new Error(err.message)
    return Array.isArray(data) ? data : []
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [sessionsData, statsData, examRes] = await Promise.all([
          fetchSessions(),
          fetchQuestionStats(),
          supabase.from('exams').select('id, subject, unit').eq('id', examId).single(),
        ])
        if (examRes.error) throw new Error(examRes.error.message)
        if (mounted) {
          setSessions(sessionsData)
          setQuestionStats(statsData)
          setExam(examRes.data)
        }
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  // AI 한 마디 일괄 생성 대상: 제출 완료 + 채점 대기 없음 + 아직 생성 안 됨
  const bulkTargets = sessions.filter(
    (s) => s.submitted && (s.pending_count ?? 0) === 0 && !s.has_feedback,
  )

  const downloadExcel = async () => {
    setError(null)
    setExcelBusy(true)
    try {
      if (!exam) throw new Error('시험 정보 로드 전입니다.')
      if (questionStats.length === 0) {
        throw new Error('문항 정보가 없습니다.')
      }
      const { data, error: err } = await supabase.rpc(
        'get_exam_results_matrix',
        { exam_id_in: examId },
      )
      if (err) throw new Error(err.message)
      const matrix = Array.isArray(data) ? data : []
      const submitted = matrix.filter((s) => s.submitted)
      if (submitted.length === 0) {
        throw new Error('응시한 학생이 없습니다.')
      }

      const questions = [...questionStats].sort(
        (a, b) => (a.question_number ?? 0) - (b.question_number ?? 0),
      )
      const header = [
        '번호',
        '이름',
        ...questions.map((q) => `${q.question_number}번`),
        '총점',
      ]
      const rows = [header]

      for (const s of submitted) {
        const byNumber = new Map()
        for (const r of Array.isArray(s.results) ? s.results : []) {
          byNumber.set(r.number, r)
        }
        const row = [s.student_number ?? '', s.student_name ?? '']
        for (const q of questions) {
          const r = byNumber.get(q.question_number)
          if (!r) row.push('')
          else if (r.isCorrect === true) row.push('O')
          else if (r.isCorrect === false) row.push('X')
          else row.push('대기')
        }
        row.push(s.score ?? 0)
        rows.push(row)
      }

      const rateRow = ['', '정답률(%)']
      for (const q of questions) {
        const graded = (q.total_attempts ?? 0) - (q.pending_count ?? 0)
        const rate =
          graded > 0
            ? Math.round(((q.correct_count ?? 0) / graded) * 1000) / 10
            : ''
        rateRow.push(rate)
      }
      rateRow.push(stats.avg != null ? `평균 ${stats.avg}` : '')
      rows.push(rateRow)

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 6 },
        { wch: 12 },
        ...questions.map(() => ({ wch: 6 })),
        { wch: 10 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '성적')

      const safe = (v) =>
        String(v ?? '').replace(/[\\/:*?"<>|]/g, '_').trim() || '시험'
      const filename = `${safe(exam.subject)}_${safe(exam.unit)}_성적.xlsx`
      XLSX.writeFile(wb, filename)
    } catch (e) {
      setError(e.message)
    } finally {
      setExcelBusy(false)
    }
  }

  const runBulk = async () => {
    setConfirmBulk(false)
    setBulkBusy(true)
    setError(null)
    setBulkProgress({ done: 0, total: bulkTargets.length })
    try {
      if (!teacher?.api_key_encrypted || !teacher?.provider) {
        throw new Error('설정에서 AI 공급자와 API 키를 먼저 저장해주세요.')
      }
      let done = 0
      for (const s of bulkTargets) {
        const { data: summary, error: sErr } = await supabase.rpc(
          'get_session_summary_for_ai',
          { session_id_in: s.session_id },
        )
        if (sErr) throw new Error(`${s.student_name}: ${sErr.message}`)
        if (!summary) throw new Error(`${s.student_name}: 세션 요약 불러오기 실패`)

        const { studentFeedback, teacherAnalysis } = await aiGenerateFeedback({
          provider: teacher.provider,
          apiKey: teacher.api_key_encrypted,
          summary,
        })
        const { error: saveErr } = await supabase.rpc('save_session_feedback', {
          session_id_in: s.session_id,
          student_feedback_in: studentFeedback,
          teacher_analysis_in: teacherAnalysis,
        })
        if (saveErr) throw new Error(`${s.student_name}: ${saveErr.message}`)
        done += 1
        setBulkProgress({ done, total: bulkTargets.length })
      }
      const [fresh, freshStats] = await Promise.all([
        fetchSessions(),
        fetchQuestionStats(),
      ])
      setSessions(fresh)
      setQuestionStats(freshStats)
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  const stats = useMemo(() => {
    const submitted = sessions.filter((s) => s.submitted)
    const scores = submitted.map((s) => s.score ?? 0)
    const maxScores = submitted.map((s) => s.max_score ?? 0).filter((n) => n > 0)
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const max = scores.length ? Math.max(...scores) : null
    const min = scores.length ? Math.min(...scores) : null
    const fullScore = maxScores.length ? Math.max(...maxScores) : 0
    const pendingStudents = submitted.filter((s) => (s.pending_count ?? 0) > 0).length
    return {
      submittedCount: submitted.length,
      totalCount: sessions.length,
      avg: avg != null ? Math.round(avg * 10) / 10 : null,
      max,
      min,
      fullScore,
      pendingStudents,
    }
  }, [sessions])

  // 점수 분포 (백분율 기준 — 시험마다 만점이 달라서 비율로 환산)
  const scoreDist = useMemo(() => {
    const submitted = sessions.filter((s) => s.submitted)
    const bins = [
      { label: '90~100', min: 90, max: Infinity, count: 0 },
      { label: '80~89', min: 80, max: 90, count: 0 },
      { label: '70~79', min: 70, max: 80, count: 0 },
      { label: '60~69', min: 60, max: 70, count: 0 },
      { label: '60 미만', min: -Infinity, max: 60, count: 0 },
    ]
    let pctSum = 0
    let pctCount = 0
    for (const s of submitted) {
      const max = s.max_score ?? 0
      const score = s.score ?? 0
      if (max <= 0) continue
      const pct = (score / max) * 100
      pctSum += pct
      pctCount += 1
      const bin = bins.find((b) => pct >= b.min && pct < b.max)
      if (bin) bin.count += 1
    }
    const total = pctCount
    const avgPct =
      pctCount > 0 ? Math.round((pctSum / pctCount) * 10) / 10 : null
    return {
      bins: bins.map((b) => ({
        label: b.label,
        count: b.count,
        ratio: total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0,
      })),
      total,
      avgPct,
    }
  }, [sessions])

  const avgBinLabel = useMemo(() => {
    const a = scoreDist.avgPct
    if (a == null) return null
    if (a >= 90) return '90~100'
    if (a >= 80) return '80~89'
    if (a >= 70) return '70~79'
    if (a >= 60) return '60~69'
    return '60 미만'
  }, [scoreDist.avgPct])

  // 문항별 정답률 (채점 대기는 분모에서 제외)
  const questionChartData = useMemo(() => {
    return questionStats.map((q) => {
      const graded = (q.total_attempts ?? 0) - (q.pending_count ?? 0)
      const rate = graded > 0 ? Math.round(((q.correct_count ?? 0) / graded) * 1000) / 10 : null
      return {
        number: q.question_number,
        label: `${q.question_number}번`,
        rate,
        graded,
        correct: q.correct_count ?? 0,
        pending: q.pending_count ?? 0,
        total: q.total_attempts ?? 0,
        learningObjective: q.learning_objective || '',
        needsReview: rate !== null && rate < 50,
      }
    })
  }, [questionStats])

  // 채점 대기 학생을 위로
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aPending = a.submitted && (a.pending_count ?? 0) > 0
      const bPending = b.submitted && (b.pending_count ?? 0) > 0
      if (aPending && !bPending) return -1
      if (!aPending && bPending) return 1
      return (a.student_number ?? 0) - (b.student_number ?? 0)
    })
  }, [sessions])

  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <Link to="/teacher/results" className="text-sm text-gray-500">
          ← 시험 선택
        </Link>
        <h2 className="text-base font-bold truncate px-2">
          {exam ? `${exam.subject} · ${exam.unit}` : '결과 분석'}
        </h2>
        <span className="w-12" />
      </header>

      {confirmBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-900">AI 일괄 생성</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              학생 <span className="font-bold">{bulkTargets.length}명</span>의
              "선생님의 한 마디"를 생성합니다. Claude API가{' '}
              <span className="font-bold">{bulkTargets.length}회</span> 호출됩니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulk(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={runBulk}
                className="flex-1 py-3 rounded-xl bg-teacher text-white text-sm font-bold shadow"
              >
                계속
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            불러오는 중…
          </div>
        ) : (
          <>
            {/* 요약 카드 */}
            <section className="grid grid-cols-2 gap-2">
              <StatCard
                label="응시 인원"
                value={`${stats.submittedCount}`}
                sub={`/ ${stats.totalCount}명`}
              />
              <StatCard
                label="평균 점수"
                value={stats.avg != null ? `${stats.avg}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              <StatCard
                label="최고 점수"
                value={stats.max != null ? `${stats.max}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              <StatCard
                label="최저 점수"
                value={stats.min != null ? `${stats.min}` : '-'}
                sub={stats.fullScore ? `/ ${stats.fullScore}점` : ''}
              />
              {stats.pendingStudents > 0 && (
                <div className="col-span-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-2">
                  <span className="text-base">📝</span>
                  <span className="text-sm text-amber-800">
                    채점 대기 학생{' '}
                    <span className="font-bold">{stats.pendingStudents}명</span>
                  </span>
                </div>
              )}
            </section>

            {/* 엑셀 다운로드 */}
            {scoreDist.total > 0 && (
              <button
                type="button"
                onClick={downloadExcel}
                disabled={excelBusy || !exam}
                className="self-end inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-teacher/40 text-teacher bg-white hover:bg-teacher/10 disabled:opacity-50"
              >
                {excelBusy ? '내보내는 중…' : '📥 엑셀 다운로드'}
              </button>
            )}

            {/* 점수 분포 */}
            {scoreDist.total > 0 && (
              <ScoreDistributionChart
                bins={scoreDist.bins}
                total={scoreDist.total}
                avgPct={scoreDist.avgPct}
                avgBinLabel={avgBinLabel}
              />
            )}

            {/* 문항별 정답률 */}
            {stats.submittedCount > 0 && questionChartData.length > 0 && (
              <QuestionRateChart data={questionChartData} />
            )}

            {/* AI 분석 일괄 생성 */}
            {(bulkTargets.length > 0 || bulkBusy) && (
              <section className="rounded-xl border border-teacher/20 bg-teacher/5 px-4 py-3 flex items-center gap-3">
                <span className="text-base shrink-0">💌</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">
                    선생님의 한 마디 일괄 생성
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {bulkBusy
                      ? `${bulkProgress.done}/${bulkProgress.total}명 생성 중…`
                      : `대상 ${bulkTargets.length}명 (제출 완료 + 채점 끝난 학생)`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={bulkBusy || bulkTargets.length === 0}
                  onClick={() => setConfirmBulk(true)}
                  className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-teacher text-white shadow disabled:opacity-50"
                >
                  {bulkBusy ? '생성 중…' : '🤖 일괄 생성'}
                </button>
              </section>
            )}

            {/* 학생 목록 */}
            {sorted.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">
                아직 응시 기록이 없어요.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sorted.map((s) => (
                  <StudentRow key={s.session_id ?? s.student_id} s={s} examId={examId} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-teacher">{value}</span>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </p>
    </div>
  )
}

function StudentRow({ s, examId }) {
  const isPending = s.submitted && (s.pending_count ?? 0) > 0
  const isAbsent = !s.session_id
  const detailHref = `/teacher/results/${examId}/${s.student_id}`
  return (
    <li
      className={`rounded-xl border p-3 flex items-center gap-3 ${
        isPending
          ? 'border-amber-300 bg-amber-50/40'
          : isAbsent
            ? 'border-gray-200 bg-gray-50/60'
            : 'border-gray-200'
      }`}
    >
      <Link
        to={`/teacher/students/${s.student_id}`}
        className="shrink-0 w-8 h-8 rounded-full bg-teacher/10 text-teacher text-sm font-bold flex items-center justify-center hover:bg-teacher/20"
        title="학생별 누적 기록"
      >
        {s.student_number}
      </Link>
      <Link
        to={`/teacher/students/${s.student_id}`}
        className="flex-1 min-w-0 hover:underline"
      >
        <p className="font-semibold text-gray-900 truncate">{s.student_name}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {s.submitted ? (
            isPending ? (
              <span className="text-amber-700 font-semibold">
                채점 대기 {s.pending_count}문항
              </span>
            ) : (
              <>
                {s.score ?? 0}점 / {s.max_score ?? 0}점
              </>
            )
          ) : isAbsent ? (
            <span className="text-gray-400">미응시</span>
          ) : (
            <span className="text-gray-400">미제출</span>
          )}
        </p>
      </Link>
      {s.submitted && s.has_feedback && (
        <span
          className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-teacher/10 text-teacher font-semibold"
          title="AI 한 마디 생성됨"
        >
          💌
        </span>
      )}
      {s.submitted && (
        <Link
          to={detailHref}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold ${
            isPending
              ? 'bg-amber-500 text-white'
              : 'border border-teacher/40 text-teacher hover:bg-teacher/10'
          }`}
        >
          {isPending ? '채점' : '상세'}
        </Link>
      )}
    </li>
  )
}

function ScoreDistributionChart({ bins, total, avgPct, avgBinLabel }) {
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0)
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">점수 분포</h3>
        <span className="text-xs text-gray-500">
          평균{' '}
          <span className="font-bold text-teacher">
            {avgPct != null ? `${avgPct}점` : '-'}
          </span>{' '}
          · 응시 {total}명
        </span>
      </div>

      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <BarChart
            data={bins}
            margin={{ top: 18, right: 12, bottom: 4, left: -16 }}
          >
            <XAxis dataKey="label" fontSize={11} stroke="#6b7280" tickLine={false} />
            <YAxis
              allowDecimals={false}
              fontSize={11}
              stroke="#9ca3af"
              domain={[0, Math.max(maxCount, 1)]}
            />
            <Tooltip
              cursor={{ fill: 'rgba(99,102,241,0.06)' }}
              content={<DistTooltip />}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            {avgBinLabel && (
              <ReferenceLine
                x={avgBinLabel}
                stroke="#ef4444"
                strokeDasharray="4 3"
                label={{
                  value: `평균 ${avgPct}`,
                  position: 'top',
                  fill: '#ef4444',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-5 gap-1 text-center">
        {bins.map((b) => (
          <div
            key={b.label}
            className={`rounded-md py-1 px-0.5 ${
              avgBinLabel === b.label ? 'bg-red-50' : 'bg-gray-50'
            }`}
          >
            <p className="text-[10px] text-gray-500">{b.label}</p>
            <p className="text-xs font-bold text-gray-800">
              {b.count}명{' '}
              <span className="text-gray-400 font-normal">{b.ratio}%</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function DistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 text-xs text-gray-700">
      <p className="font-bold text-gray-900">{d.label}</p>
      <p className="mt-0.5">
        <span className="font-bold text-teacher">{d.count}명</span>
        <span className="text-gray-500"> · {d.ratio}%</span>
      </p>
    </div>
  )
}

const RATE_BAR_OK = '#6366f1' // teacher
const RATE_BAR_LOW = '#ef4444' // red-500

function QuestionRateChart({ data }) {
  const reviewItems = data.filter((d) => d.needsReview)
  const chartHeight = Math.max(data.length * 36 + 40, 160)

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">문항별 정답률</h3>
        <span className="text-xs text-gray-400">정답률 50% 미만은 빨간색</span>
      </div>

      <div style={{ width: '100%', height: chartHeight }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
            barCategoryGap={6}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              fontSize={11}
              stroke="#9ca3af"
            />
            <YAxis
              type="category"
              dataKey="label"
              width={42}
              fontSize={11}
              stroke="#6b7280"
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(99,102,241,0.06)' }}
              content={<RateTooltip />}
            />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} label={<RateLabel />}>
              {data.map((d) => (
                <Cell
                  key={d.number}
                  fill={d.needsReview ? RATE_BAR_LOW : RATE_BAR_OK}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {reviewItems.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-red-600">⚠️ 보충 필요 문항</p>
          <ul className="flex flex-col gap-1">
            {reviewItems.map((d) => (
              <li
                key={d.number}
                className="text-xs text-gray-700 flex items-start gap-2"
              >
                <span className="shrink-0 font-bold text-red-600">
                  {d.number}번 ({d.rate}%)
                </span>
                <span className="text-gray-600 break-keep">
                  {d.learningObjective || '학습 목표 미입력'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function RateLabel({ x, y, width, height, value }) {
  if (value == null) return null
  const tx = (x ?? 0) + (width ?? 0) + 4
  const ty = (y ?? 0) + (height ?? 0) / 2 + 4
  return (
    <text x={tx} y={ty} fill="#374151" fontSize={11} fontWeight={600}>
      {value}%
    </text>
  )
}

function RateTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 text-xs text-gray-700 max-w-[260px]">
      <p className="font-bold text-gray-900">{d.label}</p>
      <p className="mt-1">
        정답률{' '}
        <span className={`font-bold ${d.needsReview ? 'text-red-600' : 'text-teacher'}`}>
          {d.rate != null ? `${d.rate}%` : '채점 대기'}
        </span>
      </p>
      <p className="text-gray-500">
        정답 {d.correct} / 채점 {d.graded} (응시 {d.total})
        {d.pending > 0 ? ` · 대기 ${d.pending}` : ''}
      </p>
      {d.learningObjective && (
        <p className="mt-1 text-gray-600 break-keep">🎯 {d.learningObjective}</p>
      )}
    </div>
  )
}
