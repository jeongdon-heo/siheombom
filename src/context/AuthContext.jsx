import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [teacher, setTeacher] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadTeacher = useCallback(async (userId) => {
    if (!userId) {
      setTeacher(null)
      return
    }
    const { data, error } = await supabase
      .from('teachers')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('[auth] teacher load failed', error)
      setTeacher(null)
      return
    }
    setTeacher(data)
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      await loadTeacher(data.session?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      // Supabase auth 락 데드락 회피: 콜백 안에서 DB 쿼리 await 하지 말고 다음 틱으로 밀어낸다
      setTimeout(() => {
        if (!mounted) return
        loadTeacher(nextSession?.user?.id)
      }, 0)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadTeacher])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshTeacher = useCallback(async () => {
    await loadTeacher(session?.user?.id)
  }, [loadTeacher, session])

  return (
    <AuthContext.Provider value={{ session, teacher, loading, signOut, refreshTeacher }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
