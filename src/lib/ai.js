// siheombom AI 래퍼
// 공급자별로 브라우저에서 직접 API 호출 (동료 교사가 자기 키 입력해 사용)

import { dataUrlMediaType, dataUrlToBase64, resizeDataUrl } from './pdf.js'

export const PROVIDERS = {
  gemini: {
    label: 'Gemini (Google)',
    model: 'gemini-2.0-flash',
    keyHint: 'AIza...',
    keyHelp: 'Google AI Studio (aistudio.google.com) → API key',
  },
  claude: {
    label: 'Claude (Anthropic)',
    model: 'claude-sonnet-4-5',
    keyHint: 'sk-ant-...',
    keyHelp: 'Anthropic Console (console.anthropic.com) → API Keys',
  },
}

export function isValidProvider(p) {
  return p === 'gemini' || p === 'claude'
}

export async function ping(provider, apiKey) {
  if (!apiKey) throw new Error('API 키가 비어있습니다.')
  if (provider === 'claude') return pingClaude(apiKey)
  if (provider === 'gemini') return pingGemini(apiKey)
  throw new Error(`알 수 없는 공급자: ${provider}`)
}

async function pingClaude(apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: PROVIDERS.claude.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `HTTP ${res.status}`)
  }
  return true
}

async function pingGemini(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 8 },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `HTTP ${res.status}`)
  }
  return true
}

// =============================================================
// analyzeExam: 시험지 + 정답지 이미지 → 문항 JSON 배열
// =============================================================

const ANALYSIS_INSTRUCTION = `너는 한국 초등학교 단원평가 시험지를 분석하는 도우미야.
첨부된 시험지 이미지와 정답지 이미지를 보고, 시험지에 실린 모든 문항의 **메타데이터만** 추출해.
문제 본문이나 보기 텍스트는 **추출하지 않는다** (학생에게는 이미지로만 보여줌).

반환 형식: **JSON 배열만** 출력. 마크다운 코드블록(\`\`\`) 이나 설명 없이, 순수 JSON 배열 하나.

각 원소 스키마:
{
  "number": 1,
  "type": "multiple_choice" | "short_answer" | "essay",
  "correct_answer": "정답(정답지에서 읽음)",
  "option_count": 5,
  "sub_count": 1,
  "page": 1,
  "bbox": { "x": 0, "y": 12.5, "w": 100, "h": 25.0 },
  "learning_objective": "관련 학습 목표 한 문장"
}

규칙:
- number: 시험지에 적힌 문제 번호 그대로 (1부터 오름차순).
- type: 보기 ①②③④(⑤) 또는 "(1)(2)(3)" / "ㄱ.ㄴ.ㄷ" 등 선택지가 있으면 multiple_choice. 짧은 답(단어/숫자) 요구면 short_answer. 문장/서술 요구면 essay.
- correct_answer: 정답지에서 찾아 적을 것.
  - multiple_choice: 번호만 적되 원래 기호 유지 가능 ("②" 또는 "2"). 복수 정답은 쉼표 구분: "②, ③".
  - short_answer/essay: 텍스트. 하위 문항이 있으면 쉼표로 구분: "570만, 3100만".
- option_count: multiple_choice 의 보기 개수 (예: 4 또는 5). multiple_choice 가 아니면 0.
- sub_count: 하위 문항(소문항) 수. "(1) ... (2) ..." 형태면 2, 하위 없으면 1.
- page: 해당 문제가 실린 **시험지**(정답지 아님) 페이지 번호 (1부터).
  - 중요: 문항 1번은 보통 시험지 **첫 번째 페이지(page=1)**의 왼쪽 상단에서 시작한다.
- bbox: 해당 문항이 시험지 페이지에서 차지하는 영역을 **퍼센트 좌표**로 표시.
  - x: 왼쪽 가장자리로부터의 시작 위치 (0~100).
  - y: 위쪽 가장자리로부터의 시작 위치 (0~100).
  - w: 영역 너비 (0~100). 대부분의 문항은 전체 너비이므로 100.
  - h: 영역 높이 (0~100).
  - 반드시 "문항 번호가 시작되는 줄"부터 "다음 문항이 시작되기 직전(또는 페이지 끝)"까지의 전체 영역을 포함할 것.
  - 그림, 보기, 풀이 공간 등 문항에 딸린 모든 요소를 빠짐없이 포함할 것.
- learning_objective: 문제에서 평가하는 학습 목표를 한 문장으로 요약. 없으면 빈 문자열 "".

반드시 JSON 배열만 출력.`

function stripCodeFence(text) {
  const trimmed = (text ?? '').trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fence ? fence[1].trim() : trimmed
}

function parseQuestionsJson(raw) {
  const text = stripCodeFence(raw)
  // 모델이 서론을 붙인 경우 첫 '[' ~ 마지막 ']' 만 잘라서 파싱
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  const slice = first >= 0 && last > first ? text.slice(first, last + 1) : text
  const arr = JSON.parse(slice)
  if (!Array.isArray(arr)) throw new Error('AI 응답이 JSON 배열이 아닙니다.')
  return arr
}

/**
 * 시험지/정답지 이미지로 문항 분석
 * @param {{ provider:string, apiKey:string,
 *           examImages:Array<{page:number,dataUrl:string}>,
 *           answerImages:Array<{page:number,dataUrl:string}> }} args
 * @returns {Promise<Array>} 문항 JSON 배열
 */
export async function analyzeExam({ provider, apiKey, examImages, answerImages }) {
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다. 설정에서 먼저 저장해주세요.')
  if (!examImages?.length) throw new Error('시험지 이미지가 없습니다.')

  // AI 전송용으로만 폭 1024 제한 (원본 이미지는 crop 용으로 보존)
  const shrinkAll = async (list) =>
    Promise.all(
      list.map(async (img) => ({
        ...img,
        dataUrl: await resizeDataUrl(img.dataUrl, { maxWidth: 1024, quality: 0.82 }),
      })),
    )

  const exams = await shrinkAll(examImages)
  const answers = answerImages?.length ? await shrinkAll(answerImages) : []

  if (provider === 'claude') return analyzeWithClaude({ apiKey, exams, answers })
  if (provider === 'gemini') return analyzeWithGemini({ apiKey, exams, answers })
  throw new Error(`알 수 없는 공급자: ${provider}`)
}

// ---------- Claude ----------
async function analyzeWithClaude({ apiKey, exams, answers }) {
  const content = []

  content.push({ type: 'text', text: '=== 시험지 이미지 ===' })
  for (const img of exams) {
    content.push({ type: 'text', text: `시험지 p.${img.page}` })
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUrlMediaType(img.dataUrl),
        data: dataUrlToBase64(img.dataUrl),
      },
    })
  }

  if (answers.length) {
    content.push({ type: 'text', text: '=== 정답지 이미지 ===' })
    for (const img of answers) {
      content.push({ type: 'text', text: `정답지 p.${img.page}` })
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: dataUrlMediaType(img.dataUrl),
          data: dataUrlToBase64(img.dataUrl),
        },
      })
    }
  }

  content.push({ type: 'text', text: ANALYSIS_INSTRUCTION })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: PROVIDERS.claude.model,
      max_tokens: 8000,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Claude HTTP ${res.status}`)
  }
  const data = await res.json()
  const text = data?.content?.map((c) => c.text ?? '').join('') ?? ''
  return parseQuestionsJson(text)
}

// =============================================================
// generateFeedback: 학생 시험 결과 → "선생님의 한 마디" 한 문단
// =============================================================

function buildFeedbackPrompt(summary) {
  const stu = summary.student ?? {}
  const ex = summary.exam ?? {}
  const score = summary.score ?? 0
  const maxScore = summary.maxScore ?? 0
  const results = Array.isArray(summary.results) ? summary.results : []

  const lines = results.map((r) => {
    const flag =
      r.isCorrect === true ? '맞음' : r.isCorrect === false ? '틀림' : '대기'
    const ans = String(r.studentAnswer || '').slice(0, 100)
    const lo = r.learningObjective ? ` [학습목표: ${r.learningObjective}]` : ''
    return `  ${r.number}번: ${flag} (${r.earned ?? 0}/${r.points ?? 0}점) — 학생 답: "${ans}"${lo}`
  })

  return `초등학교 학생의 단원평가 결과입니다.

학생: ${stu.number ?? ''}번 ${stu.name ?? ''}
시험: ${ex.subject ?? ''} · ${ex.unit ?? ''}
총점: ${score}/${maxScore}점 (${maxScore > 0 ? Math.round((score / maxScore) * 100) : 0}%)

문항별 결과:
${lines.join('\n')}

위 결과를 바탕으로 두 가지 글을 작성해 주세요.

[1] studentFeedback — 학생에게 직접 보여줄 "선생님의 한 마디"
- 한 문단, 3~5문장
- 따뜻하고 격려하는 톤. 막연한 칭찬은 피하고 구체적으로
- 잘한 점(맞은 문항의 학습 목표) 한두 가지를 짚어주기
- 부족한 점이 있다면 다음에 어떻게 보완하면 좋을지 한 가지만 짧게
- 학생을 부르는 말투("○○야,"로 시작) 가능
- 헤더 텍스트 없이 본문만

[2] teacherAnalysis — 교사를 위한 상세 학습 분석
- 다음 형식 그대로 사용 (이모지·줄바꿈·하이픈 유지)
- 문항 번호 대신 학습 목표 이름을 주어로 사용
- 학습 목표가 비어 있는 문항은 "기타" 카테고리로 묶거나 생략

📊 전체 요약
- 총점·정답률·전반적 수준 한 줄 요약

✅ 잘한 영역
- [학습목표명]: 구체적 설명
- [학습목표명]: 구체적 설명

⚠️ 보충이 필요한 영역
- [학습목표명]: 어떤 부분이 부족하고, 어떤 유형의 실수를 했는지
- [학습목표명]: 구체적 설명

📝 지도 제안
- 이 학생에게 추천하는 보충 학습 방향 2~3가지

응답은 JSON으로만 (다른 텍스트·코드 블록 금지):
{"studentFeedback": "...", "teacherAnalysis": "..."}`
}

function parseFeedback(text) {
  const stripped = stripCodeFence(text)
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI 응답을 파싱할 수 없습니다.')
  const obj = JSON.parse(match[0])
  if (typeof obj.studentFeedback !== 'string' || typeof obj.teacherAnalysis !== 'string') {
    throw new Error('studentFeedback / teacherAnalysis 필드 누락')
  }
  return {
    studentFeedback: obj.studentFeedback.trim(),
    teacherAnalysis: obj.teacherAnalysis.trim(),
  }
}

const FEEDBACK_SYSTEM =
  '당신은 초등학교 담임 선생님으로, 학생의 단원평가 결과를 보고 학생용·교사용 두 가지 피드백을 작성합니다. 막연한 칭찬은 피하고 구체적인 학습 행동에 초점을 맞추세요.'

export async function generateFeedback({ provider, apiKey, summary }) {
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다. 설정에서 먼저 저장해주세요.')
  if (!summary) throw new Error('summary 가 비어있습니다.')
  if (provider === 'claude') return feedbackWithClaude({ apiKey, summary })
  if (provider === 'gemini') return feedbackWithGemini({ apiKey, summary })
  throw new Error(`알 수 없는 공급자: ${provider}`)
}

async function feedbackWithClaude({ apiKey, summary }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: PROVIDERS.claude.model,
      max_tokens: 2048,
      system: FEEDBACK_SYSTEM,
      messages: [
        { role: 'user', content: buildFeedbackPrompt(summary) },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Claude HTTP ${res.status}`)
  }
  const data = await res.json()
  const text = data?.content?.map((c) => c.text ?? '').join('') ?? ''
  return parseFeedback(text)
}

async function feedbackWithGemini({ apiKey, summary }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: FEEDBACK_SYSTEM }] },
      contents: [{ parts: [{ text: buildFeedbackPrompt(summary) }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gemini HTTP ${res.status}`)
  }
  const data = await res.json()
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  return parseFeedback(text)
}

// ---------- Gemini ----------
async function analyzeWithGemini({ apiKey, exams, answers }) {
  const parts = []

  parts.push({ text: '=== 시험지 이미지 ===' })
  for (const img of exams) {
    parts.push({ text: `시험지 p.${img.page}` })
    parts.push({
      inlineData: {
        mimeType: dataUrlMediaType(img.dataUrl),
        data: dataUrlToBase64(img.dataUrl),
      },
    })
  }

  if (answers.length) {
    parts.push({ text: '=== 정답지 이미지 ===' })
    for (const img of answers) {
      parts.push({ text: `정답지 p.${img.page}` })
      parts.push({
        inlineData: {
          mimeType: dataUrlMediaType(img.dataUrl),
          data: dataUrlToBase64(img.dataUrl),
        },
      })
    }
  }

  parts.push({ text: ANALYSIS_INSTRUCTION })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gemini HTTP ${res.status}`)
  }
  const data = await res.json()
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  return parseQuestionsJson(text)
}
