import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없습니다. ' +
      '데이터베이스 호출은 실패합니다.',
  )
}

// 미설정이어도 앱이 크래시되지 않도록 placeholder 로 createClient 호출.
// 실제 네트워크 호출은 런타임에 실패하고, UI 는 배너로 안내한다.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
