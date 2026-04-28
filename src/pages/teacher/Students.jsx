import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'

export default function Students() {
  const { teacher } = useAuth()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editNumber, setEditNumber] = useState('')
  const fileInputRef = useRef(null)

  const fetchStudents = async () => {
    const { data, error: err } = await supabase
      .from('students')
      .select('id, name, number, created_at')
      .order('number', { ascending: true })
    if (err) throw new Error(err.message)
    return Array.isArray(data) ? data : []
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await fetchStudents()
        if (mounted) setStudents(data)
      } catch (e) {
        if (mounted) setError(e.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const sorted = useMemo(
    () =>
      [...students].sort(
        (a, b) =>
          (a.number ?? 0) - (b.number ?? 0) ||
          (a.name ?? '').localeCompare(b.name ?? ''),
      ),
    [students],
  )

  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <Link to="/teacher" className="text-sm text-gray-500">
          ← 메인
        </Link>
        <h2 className="text-base font-bold">학생 명단</h2>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 text-sm p-3 break-all">
            {error}
          </div>
        )}

        <AddRow
          disabled={busy || !teacher}
          onAdd={async ({ name, number }) => {
            setError(null)
            setBusy(true)
            try {
              const { error: err } = await supabase
                .from('students')
                .insert({ teacher_id: teacher.id, name, number })
              if (err) {
                if (err.code === '23505') {
                  throw new Error('같은 이름·번호 학생이 이미 있습니다.')
                }
                throw new Error(err.message)
              }
              setStudents(await fetchStudents())
            } catch (e) {
              setError(e.message)
            } finally {
              setBusy(false)
            }
          }}
        />

        <BulkRow
          disabled={busy || !teacher}
          fileInputRef={fileInputRef}
          onPick={async (file) => {
            setError(null)
            setBusy(true)
            try {
              const parsed = await parseRosterFile(file)
              if (parsed.length === 0) {
                throw new Error('엑셀에서 학생을 읽지 못했습니다. (번호/이름 컬럼)')
              }
              const rows = parsed.map((p) => ({
                teacher_id: teacher.id,
                name: p.name,
                number: p.number,
              }))
              const { error: err } = await supabase
                .from('students')
                .upsert(rows, {
                  onConflict: 'teacher_id,name,number',
                  ignoreDuplicates: true,
                })
              if (err) throw new Error(err.message)
              setStudents(await fetchStudents())
            } catch (e) {
              setError(e.message)
            } finally {
              setBusy(false)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }
          }}
        />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            불러오는 중…
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            아직 등록된 학생이 없어요. 위에서 추가해 주세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            <li className="text-xs text-gray-400 px-2">
              총 {sorted.length}명
            </li>
            {sorted.map((s) => (
              <StudentItem
                key={s.id}
                s={s}
                editing={editingId === s.id}
                disabled={busy}
                editName={editName}
                editNumber={editNumber}
                onChangeEditName={setEditName}
                onChangeEditNumber={setEditNumber}
                onStartEdit={() => {
                  setEditingId(s.id)
                  setEditName(s.name ?? '')
                  setEditNumber(String(s.number ?? ''))
                }}
                onCancel={() => {
                  setEditingId(null)
                }}
                onSave={async () => {
                  setError(null)
                  const num = Number(editNumber)
                  if (!editName.trim()) return setError('이름을 입력해주세요.')
                  if (!Number.isInteger(num) || num < 1 || num > 99)
                    return setError('번호는 1~99 사이의 정수여야 합니다.')
                  setBusy(true)
                  try {
                    const { error: err } = await supabase
                      .from('students')
                      .update({ name: editName.trim(), number: num })
                      .eq('id', s.id)
                    if (err) {
                      if (err.code === '23505') {
                        throw new Error('같은 이름·번호 학생이 이미 있습니다.')
                      }
                      throw new Error(err.message)
                    }
                    setStudents(await fetchStudents())
                    setEditingId(null)
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setBusy(false)
                  }
                }}
                onDelete={async () => {
                  if (
                    !window.confirm(
                      `${s.number}번 ${s.name} 학생을 삭제하면 응시 기록도 모두 함께 사라집니다. 계속할까요?`,
                    )
                  )
                    return
                  setError(null)
                  setBusy(true)
                  try {
                    const { error: err } = await supabase
                      .from('students')
                      .delete()
                      .eq('id', s.id)
                    if (err) throw new Error(err.message)
                    setStudents(await fetchStudents())
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AddRow({ disabled, onAdd }) {
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [localError, setLocalError] = useState(null)

  const submit = async (e) => {
    e?.preventDefault?.()
    setLocalError(null)
    const num = Number(number)
    if (!name.trim()) return setLocalError('이름을 입력해주세요.')
    if (!Number.isInteger(num) || num < 1 || num > 99)
      return setLocalError('번호는 1~99 사이의 정수여야 합니다.')
    await onAdd({ name: name.trim(), number: num })
    setName('')
    setNumber('')
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-gray-200 p-3 flex flex-col gap-2"
    >
      <p className="text-xs font-semibold text-gray-700">학생 추가</p>
      <div className="flex gap-2">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="번호"
          inputMode="numeric"
          className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          disabled={disabled}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          disabled={disabled}
        />
        <button
          type="submit"
          disabled={disabled}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-teacher text-white shadow disabled:opacity-50"
        >
          추가
        </button>
      </div>
      {localError && (
        <p className="text-xs text-red-600">{localError}</p>
      )}
    </form>
  )
}

function BulkRow({ disabled, fileInputRef, onPick }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-700">엑셀 일괄 업로드</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          첫 행 헤더 <code className="bg-gray-100 px-1 rounded">번호</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">이름</code> 또는 두 컬럼만
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold border border-teacher/40 text-teacher bg-white hover:bg-teacher/10 disabled:opacity-50"
      >
        📤 파일 선택
      </button>
    </div>
  )
}

function StudentItem({
  s,
  editing,
  disabled,
  editName,
  editNumber,
  onChangeEditName,
  onChangeEditNumber,
  onStartEdit,
  onCancel,
  onSave,
  onDelete,
}) {
  if (editing) {
    return (
      <li className="rounded-xl border border-teacher/40 bg-teacher/5 p-3 flex items-center gap-2">
        <input
          value={editNumber}
          onChange={(e) => onChangeEditNumber(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          disabled={disabled}
        />
        <input
          value={editName}
          onChange={(e) => onChangeEditName(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-teacher text-white"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-500"
        >
          취소
        </button>
      </li>
    )
  }
  return (
    <li className="rounded-xl border border-gray-200 p-3 flex items-center gap-3">
      <span className="shrink-0 w-8 h-8 rounded-full bg-teacher/10 text-teacher text-sm font-bold flex items-center justify-center">
        {s.number}
      </span>
      <p className="flex-1 min-w-0 font-semibold text-gray-900 truncate">{s.name}</p>
      <button
        type="button"
        onClick={onStartEdit}
        disabled={disabled}
        className="shrink-0 px-2 py-1 rounded-md text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
      >
        수정
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="shrink-0 px-2 py-1 rounded-md text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        삭제
      </button>
    </li>
  )
}

async function parseRosterFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (!Array.isArray(aoa) || aoa.length === 0) return []

  // 첫 행이 헤더("번호", "이름")인지 자동 감지
  const first = aoa[0].map((c) => String(c).trim())
  let numIdx = first.findIndex((c) => c === '번호' || /number|no\.?/i.test(c))
  let nameIdx = first.findIndex((c) => c === '이름' || /name/i.test(c))
  let dataStart = 0
  if (numIdx >= 0 && nameIdx >= 0) {
    dataStart = 1
  } else {
    // 헤더 없음: 첫 컬럼=번호, 두 번째=이름 가정
    numIdx = 0
    nameIdx = 1
  }

  const out = []
  const seen = new Set()
  for (let i = dataStart; i < aoa.length; i++) {
    const row = aoa[i] || []
    const rawNum = row[numIdx]
    const rawName = row[nameIdx]
    const num = Number(String(rawNum ?? '').trim())
    const name = String(rawName ?? '').trim()
    if (!name || !Number.isInteger(num) || num < 1 || num > 99) continue
    const key = `${num}${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ number: num, name })
  }
  return out
}
