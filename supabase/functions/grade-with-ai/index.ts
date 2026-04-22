// Supabase Edge Function: grade-with-ai
// POST { session_id: uuid, question_number: int }
// - 교사 JWT 로 인증 → 본인 시험만 접근
// - questions/answers 조회 → Claude Haiku 4.5 로 채점 제안 생성
// - save_ai_suggestion RPC 로 DB에 저장
// - 응답: { score, maxScore, reasoning, isCorrect }
//
// 배포:  supabase functions deploy grade-with-ai
// 시크릿: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

// @ts-nocheck  -- Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function stripExamplePrefix(s: string): string {
  return (s || '').replace(/^\s*\(예\)\s*/, '').trim()
}

function buildUserContent(q: {
  points: number
  correctAnswer: string
  studentAnswer: string
  imageUrl?: string | null
}) {
  const blocks: unknown[] = []

  if (q.imageUrl) {
    blocks.push({
      type: 'image',
      source: { type: 'url', url: q.imageUrl },
    })
  }

  const prompt = `다음은 초등학교 단원평가 서술형 문제입니다.
배점: ${q.points}점

예시 정답: ${q.correctAnswer || '(없음)'}
학생 답안: ${q.studentAnswer || '(미작성)'}

이 학생의 답안을 채점해 주세요.
- 풀이 과정과 최종 답이 정답과 본질적으로 같으면 만점
- 핵심 개념은 맞지만 계산이나 표현이 부분적으로 틀리면 부분 점수
- 전혀 다르거나 무응답이면 0점
- 한국어로 간결하게 이유를 적어주세요

JSON으로만 응답하세요 (다른 텍스트·코드 블록 금지):
{"score": <0~${q.points}>, "max_score": ${q.points}, "reasoning": "...", "is_correct": true|false}`

  blocks.push({ type: 'text', text: prompt })
  return blocks
}

function parseClaudeJson(text: string): {
  score: number
  reasoning: string
  is_correct: boolean
} | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.score !== 'number') return null
    return {
      score: obj.score,
      reasoning: String(obj.reasoning ?? ''),
      is_correct: Boolean(obj.is_correct),
    }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { session_id, question_number } = await req.json()
    if (!session_id || typeof question_number !== 'number') {
      return Response.json(
        { error: 'session_id, question_number required' },
        { status: 400, headers: corsHeaders },
      )
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: corsHeaders },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    // 1. 문항 + 학생 답안 조회 (RLS + teacher 검증은 RPC 내부에서 auth.uid() 로 수행)
    const { data: qData, error: qErr } = await supabase.rpc(
      'get_question_for_ai_grading',
      { session_id_in: session_id, question_number_in: question_number },
    )
    if (qErr) throw new Error(`db: ${qErr.message}`)
    if (!qData) {
      return Response.json(
        { error: 'question_not_found_or_unauthorized' },
        { status: 404, headers: corsHeaders },
      )
    }

    const points = Number(qData.points) || 0
    const correctAnswer = stripExamplePrefix(String(qData.correctAnswer || ''))
    const studentAnswer = String(qData.studentAnswer || '')
    const imageUrl = qData.imageUrl || null

    // 2. Claude 호출
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return Response.json(
        { error: 'anthropic_api_key_not_configured' },
        { status: 500, headers: corsHeaders },
      )
    }

    const claudeRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: [
          {
            type: 'text',
            text: '당신은 초등학교 단원평가 서술형 문항을 공정하고 일관되게 채점하는 조력자입니다. 최종 판정은 교사가 하므로, 명확한 근거와 함께 제안 점수를 제시하세요.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: buildUserContent({
              points,
              correctAnswer,
              studentAnswer,
              imageUrl,
            }),
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      return Response.json(
        { error: 'claude_api_error', detail: errText.slice(0, 500) },
        { status: 502, headers: corsHeaders },
      )
    }

    const claudeJson = await claudeRes.json()
    const text = claudeJson?.content?.[0]?.text ?? ''
    const parsed = parseClaudeJson(text)
    if (!parsed) {
      return Response.json(
        {
          error: 'parse_failed',
          raw: text.slice(0, 500),
        },
        { status: 502, headers: corsHeaders },
      )
    }

    const clampedScore = Math.max(0, Math.min(points, Math.round(parsed.score)))

    // 3. DB 저장
    const { error: saveErr } = await supabase.rpc('save_ai_suggestion', {
      session_id_in: session_id,
      question_number_in: question_number,
      ai_score_in: clampedScore,
      ai_reasoning_in: parsed.reasoning,
    })
    if (saveErr) throw new Error(`save: ${saveErr.message}`)

    return Response.json(
      {
        score: clampedScore,
        maxScore: points,
        reasoning: parsed.reasoning,
        isCorrect: parsed.is_correct,
      },
      { headers: corsHeaders },
    )
  } catch (e) {
    return Response.json(
      { error: 'internal', detail: String(e?.message || e) },
      { status: 500, headers: corsHeaders },
    )
  }
})
