import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'siheombom.student'

// shape:
// { classCode, teacherId, teacherName, className, studentId, name, number }

const StudentContext = createContext(null)

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(value) {
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  else localStorage.removeItem(STORAGE_KEY)
}

export function StudentProvider({ children }) {
  const [student, setStudentState] = useState(() => readStored())

  useEffect(() => {
    writeStored(student)
  }, [student])

  const setStudent = useCallback((next) => {
    setStudentState(next)
  }, [])

  const clearStudent = useCallback(() => {
    setStudentState(null)
  }, [])

  // 학급코드만 먼저 검증한 다음 이름/번호 단계로 넘어갈 때 쓰는 부분 상태
  const [pendingClass, setPendingClass] = useState(null)
  // { classCode, teacherId, teacherName, className }

  return (
    <StudentContext.Provider
      value={{ student, setStudent, clearStudent, pendingClass, setPendingClass }}
    >
      {children}
    </StudentContext.Provider>
  )
}

export function useStudent() {
  const ctx = useContext(StudentContext)
  if (!ctx) throw new Error('useStudent must be used within StudentProvider')
  return ctx
}
