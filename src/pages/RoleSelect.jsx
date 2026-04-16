import { Link } from 'react-router-dom'

export default function RoleSelect() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-8 p-6 bg-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">시험봄</h1>
        <p className="mt-2 text-sm text-gray-500">PDF 시험지로 만드는 온라인 단원평가</p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          to="/teacher/login"
          className="px-6 py-5 rounded-2xl bg-teacher text-white text-lg font-semibold shadow-md hover:opacity-90 text-center"
        >
          교사로 시작하기
        </Link>
        <Link
          to="/student"
          className="px-6 py-5 rounded-2xl bg-student text-white text-lg font-semibold shadow-md hover:opacity-90 text-center"
        >
          학생으로 시작하기
        </Link>
      </div>
    </div>
  )
}
