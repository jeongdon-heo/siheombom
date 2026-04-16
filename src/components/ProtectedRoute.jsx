import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-gray-400 text-sm">
        불러오는 중…
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/teacher/login" replace state={{ from: location }} />
  }

  return children
}
