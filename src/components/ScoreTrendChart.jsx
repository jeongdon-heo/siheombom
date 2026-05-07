import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * 성적 추이 라인 차트 (학급 평균 + 선택 학생, 최근 N회)
 *
 * data: [{ name, examId, pct, avg, total, studentPct?, studentScore?, studentMax? }]
 *   - pct/avg/total: 학급 평균 (필수)
 *   - studentPct/studentScore/studentMax: 학생 선택 시에만 (옵션)
 *
 * studentName: 선택된 학생 이름 (Legend/Tooltip 라벨용). null이면 학생 라인 안 그림.
 */
export default function ScoreTrendChart({ data, studentName }) {
  if (!data || data.length === 0) {
    return null // 응시 결과 없음 — 차트 자체를 숨김
  }

  if (data.length < 2) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-center text-xs text-gray-500">
        응시 결과가 <b>2회 이상</b> 쌓이면 추이 그래프가 표시됩니다.
      </div>
    )
  }

  const showStudent = !!studentName

  return (
    <div className="rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-700">📈 성적 추이</p>
        <p className="text-[10px] text-gray-400">최근 {data.length}회</p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 24, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={50}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
            formatter={(value, key, item) => {
              const p = item?.payload
              if (key === 'pct') {
                if (value == null) return ['—', '학급 평균']
                if (p?.avg != null && p?.total != null) {
                  return [`${value}점 (${p.avg}/${p.total})`, '학급 평균']
                }
                return [`${value}점`, '학급 평균']
              }
              if (key === 'studentPct') {
                if (value == null) return ['미응시', studentName ?? '학생']
                if (p?.studentScore != null && p?.studentMax != null) {
                  return [
                    `${value}점 (${p.studentScore}/${p.studentMax})`,
                    studentName ?? '학생',
                  ]
                }
                return [`${value}점`, studentName ?? '학생']
              }
              return [value, key]
            }}
          />
          {showStudent && (
            <Legend
              verticalAlign="top"
              align="right"
              iconType="line"
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="pct"
            name="학급 평균"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: '#6366f1' }}
            activeDot={{ r: 5 }}
          />
          {showStudent && (
            <Line
              type="monotone"
              dataKey="studentPct"
              name={studentName}
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 3, fill: '#10b981' }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
