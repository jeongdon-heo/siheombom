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
첨부된 시험지 이미지와 정답지 이미지를 보고, 시험지에 실린 모든 문항을 추출해.

반환 형식: **JSON 배열만** 출력. 마크다운 코드블록(\`\`\`) 이나 설명 없이, 순수 JSON 배열 하나.

각 원소 스키마:
{
  "number": 1,
  "text": "문제 본문 (지문/질문) 전부",
  "type": "multiple_choice" | "short_answer" | "essay",
  "options": ["① ...", "② ...", "③ ...", "④ ..."],
  "correct_answer": "정답(정답지에서 읽음)",
  "sub_count": 1,
  "page": 1,
  "bbox": { "x": 0, "y": 12.5, "w": 100, "h": 25.0 },
  "learning_objective": "관련 학습 목표 한 문장"
}

규칙:
- number: 시험지에 적힌 문제 번호 그대로 (1부터 오름차순).
- text: 문제 본문. 긴 지문이 있으면 같이 포함.
- type: 보기 ①②③④(⑤) 있으면 multiple_choice, 짧은 답(단어/숫자) 요구면 short_answer, 문장/서술 요구면 essay.
- options: multiple_choice 만 작성. 시험지에 사용된 **원래 보기 기호를 그대로** 유지할 것 (①②③④⑤, ㄱㄴㄷㄹ, (가)(나)(다), 1234 등). 다른 유형은 빈 배열 [].
- correct_answer: 정답지에서 찾아 적을 것. multiple_choice 는 번호(예: "②" 또는 "2"), short_answer/essay 는 텍스트.
  - 하위 문항이 있는 경우 (sub_count > 1) 정답을 쉼표로 구분: 예) "570만, 3100만"
- sub_count: 하위 문항(소문항) 수. "(1) ... (2) ..." 형태면 2, 하위 없으면 1.
- page: 해당 문제가 실린 **시험지**(정답지 아님) 페이지 번호 (1부터).
  - 중요: 문항 1번은 보통 시험지 **첫 번째 페이지(page=1)**의 왼쪽 상단에서 시작한다. 시험지 이미지 순서(p.1, p.2, …)를 잘 확인할 것.
- bbox: 해당 문항이 시험지 페이지에서 차지하는 영역을 **퍼센트 좌표**로 표시.
  - x: 왼쪽 가장자리로부터의 시작 위치 (0~100). 문항이 페이지 전체 너비를 쓰면 0.
  - y: 위쪽 가장자리로부터의 시작 위치 (0~100). 페이지 맨 위가 0, 맨 아래가 100.
  - w: 영역 너비 (0~100). 대부분의 문항은 페이지 전체 너비를 쓰므로 100.
  - h: 영역 높이 (0~100). 문항의 실제 세로 크기에 맞게 설정.
  - 반드시 "문항 번호가 시작되는 줄"부터 "다음 문항이 시작되기 직전(또는 페이지 끝)"까지의 전체 영역을 포함할 것.
  - 그림, 보기, 풀이 공간 등 문항에 딸린 모든 요소를 빠짐없이 포함할 것.
  - 한 페이지에 문항이 여러 개이면 각각 개별 bbox 를 정밀하게 잡아야 함. 겹치지 않게 주의.
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
