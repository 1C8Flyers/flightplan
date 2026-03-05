export type AiMapContext = {
  center: {
    lat: number
    lng: number
  }
  zoom: number
}

export type AiAskContext = {
  selectedAirport: Record<string, unknown> | null
  selectedAirspace: Record<string, unknown> | null
  route: Record<string, unknown> | null
  weather: {
    metarRaw: string | null
    tafRaw: string | null
  }
  map: AiMapContext
}

export type AiContextAnswer = {
  answer: string
  keyPoints: string[]
  warnings: string[]
}

type AiErrorResponse = {
  error?: string
}

export async function askAiWithContext(question: string, context: AiAskContext): Promise<AiContextAnswer> {
  const response = await fetch('/api/ai/context/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ question, context })
  })

  const body = await response.json().catch(() => ({})) as Partial<AiContextAnswer> & AiErrorResponse

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }

  if (body.error) {
    throw new Error(body.error)
  }

  if (typeof body.answer !== 'string' || !body.answer.trim() || !Array.isArray(body.keyPoints) || !Array.isArray(body.warnings)) {
    throw new Error('AI service returned an invalid response.')
  }

  return {
    answer: body.answer.trim(),
    keyPoints: body.keyPoints.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean),
    warnings: body.warnings.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  }
}
