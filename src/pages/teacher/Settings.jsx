import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import { PROVIDERS, isValidProvider, ping } from '../../lib/ai.js'

export default function Settings() {
  const { teacher, loading, refreshTeacher } = useAuth()

  const [provider, setProvider] = useState('gemini')
  const [apiKey, setApiKey] = useState('')
  const [className, setClassName] = useState('')

  const [testState, setTestState] = useState({ status: 'idle', msg: null })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (!teacher) return
    setProvider(isValidProvider(teacher.provider) ? teacher.provider : 'gemini')
    setApiKey(teacher.api_key_encrypted || '')
    setClassName(teacher.class_name || '')
  }, [teacher])

  if (loading || !teacher) {
    return (
      <div className="min-h-full flex items-center justify-center text-gray-400 text-sm">
        불러오는 중…
      </div>
    )
  }

  const onTest = async () => {
    setTestState({ status: 'testing', msg: null })
    try {
      await ping(provider, apiKey.trim())
      setTestState({ status: 'ok', msg: '연결 성공!' })
    } catch (e) {
      setTestState({ status: 'fail', msg: e.message || '실패' })
    }
  }

  const onSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    const { error } = await supabase
      .from('teachers')
      .update({
        provider,
        api_key_encrypted: apiKey.trim() || null,
        class_name: className.trim() || teacher.class_name,
      })
      .eq('id', teacher.id)
    setSaving(false)
    if (error) {
      setSaveMsg({ type: 'error', text: error.message })
      return
    }
    setSaveMsg({ type: 'ok', text: '저장됐어요.' })
    await refreshTeacher()
  }

  const onRegenCode = async () => {
    if (!window.confirm('학급코드를 새로 만들까요? 이전 코드는 더 이상 사용할 수 없어요.')) return
    setRegenerating(true)
    const { error } = await supabase.rpc('regenerate_class_code')
    setRegenerating(false)
    if (error) {
      window.alert(error.message)
      return
    }
    await refreshTeacher()
  }

  const info = PROVIDERS[provider]

  return (
    <div className="min-h-full flex flex-col p-6 bg-white gap-8">
      <header className="flex items-center justify-between">
        <Link to="/teacher" className="text-sm text-gray-500">← 홈</Link>
        <h2 className="text-lg font-bold">설정</h2>
        <span className="w-10" />
      </header>

      {/* AI 설정 */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-900">AI 서비스</h3>

        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PROVIDERS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setProvider(key)
                setTestState({ status: 'idle', msg: null })
              }}
              className={`rounded-xl border-2 p-3 text-left ${
                provider === key
                  ? 'border-teacher bg-teacher/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-gray-900 text-sm">{p.label}</p>
              <p className="text-xs text-gray-500 mt-1">{p.model}</p>
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">API 키</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setTestState({ status: 'idle', msg: null })
            }}
            placeholder={info.keyHint}
            autoComplete="off"
            className="border border-gray-300 rounded-lg px-3 py-3 font-mono focus:outline-none focus:border-teacher"
          />
          <span className="text-xs text-gray-400">발급: {info.keyHelp}</span>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={!apiKey || testState.status === 'testing'}
            className="flex-1 rounded-lg border border-teacher text-teacher py-2 font-semibold disabled:opacity-40"
          >
            {testState.status === 'testing' ? '확인 중…' : '연결 테스트'}
          </button>
        </div>

        {testState.status === 'ok' && (
          <p className="text-sm text-green-600">✓ {testState.msg}</p>
        )}
        {testState.status === 'fail' && (
          <p className="text-sm text-red-600 break-all">✗ {testState.msg}</p>
        )}
      </section>

      {/* 학급 정보 */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-900">학급 정보</h3>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">학급명</span>
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-3 focus:outline-none focus:border-teacher"
          />
        </label>

        <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-3 py-3">
          <div>
            <p className="text-xs text-gray-500">학급코드</p>
            <p className="font-mono text-lg font-bold tracking-widest">
              {teacher.class_code}
            </p>
          </div>
          <button
            onClick={onRegenCode}
            disabled={regenerating}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 hover:border-teacher hover:text-teacher disabled:opacity-40"
          >
            {regenerating ? '재생성 중…' : '새로 만들기'}
          </button>
        </div>
      </section>

      {/* 저장 */}
      <div className="mt-auto flex flex-col gap-2">
        {saveMsg && (
          <p
            className={`text-sm text-center ${
              saveMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {saveMsg.text}
          </p>
        )}
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-teacher text-white py-3 font-semibold shadow disabled:opacity-50"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}
