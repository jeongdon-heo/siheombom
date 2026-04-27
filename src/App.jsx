import { Route, Routes } from 'react-router-dom'
import RoleSelect from './pages/RoleSelect.jsx'
import TeacherLogin from './pages/teacher/Login.jsx'
import TeacherSignup from './pages/teacher/Signup.jsx'
import TeacherHome from './pages/teacher/Home.jsx'
import TeacherSettings from './pages/teacher/Settings.jsx'
import NewExam from './pages/teacher/exams/New.jsx'
import ExamsList from './pages/teacher/exams/List.jsx'
import ResultsList from './pages/teacher/exams/ResultsList.jsx'
import SessionDetail from './pages/teacher/exams/SessionDetail.jsx'
import ResultsIndex from './pages/teacher/results/Index.jsx'
import ResultsExam from './pages/teacher/results/Exam.jsx'
import ResultsStudent from './pages/teacher/results/Student.jsx'
import StudentHistory from './pages/teacher/results/StudentHistory.jsx'
import ClassCodeEntry from './pages/student/ClassCodeEntry.jsx'
import NameNumberEntry from './pages/student/NameNumberEntry.jsx'
import ExamList from './pages/student/ExamList.jsx'
import TakeExam from './pages/student/TakeExam.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import { isSupabaseConfigured } from './lib/supabase.js'

function EnvBanner() {
  if (isSupabaseConfigured) return null
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs p-3 leading-relaxed">
      <strong>.env 설정이 필요합니다.</strong> 프로젝트 루트에{' '}
      <code className="bg-amber-100 px-1 rounded">.env</code> 파일을 만들고{' '}
      <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code>,{' '}
      <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
      를 채운 뒤 dev 서버를 재시작하세요. (
      <code className="bg-amber-100 px-1 rounded">.env.example</code> 참고)
    </div>
  )
}

export default function App() {
  return (
    <div className="h-full w-full md:max-w-[800px] mx-auto bg-white flex flex-col">
      <EnvBanner />
      <div className="flex-1 min-h-0">
        <Routes>
          <Route path="/" element={<RoleSelect />} />

          <Route path="/teacher/login" element={<TeacherLogin />} />
          <Route path="/teacher/signup" element={<TeacherSignup />} />
          <Route
            path="/teacher"
            element={
              <ProtectedRoute>
                <TeacherHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/settings"
            element={
              <ProtectedRoute>
                <TeacherSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams"
            element={
              <ProtectedRoute>
                <ExamsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/new"
            element={
              <ProtectedRoute>
                <NewExam />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/results"
            element={
              <ProtectedRoute>
                <ResultsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/sessions/:sessionId"
            element={
              <ProtectedRoute>
                <SessionDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/results"
            element={
              <ProtectedRoute>
                <ResultsIndex />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/results/:examId"
            element={
              <ProtectedRoute>
                <ResultsExam />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/results/:examId/:studentId"
            element={
              <ProtectedRoute>
                <ResultsStudent />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/students/:studentId"
            element={
              <ProtectedRoute>
                <StudentHistory />
              </ProtectedRoute>
            }
          />

          <Route path="/student" element={<ClassCodeEntry />} />
          <Route path="/student/enter" element={<NameNumberEntry />} />
          <Route path="/student/exams" element={<ExamList />} />
          <Route path="/student/exams/:examId" element={<TakeExam />} />
        </Routes>
      </div>
    </div>
  )
}
