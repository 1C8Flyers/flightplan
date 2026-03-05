export type AiBriefResponse = {
  summary: string
  notes?: string
}

type AiErrorResponse = {
  error?: string
}

async function postAiBrief(path: string, payload: Record<string, unknown>): Promise<AiBriefResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const body = await response.json().catch(() => ({})) as Partial<AiBriefResponse> & AiErrorResponse

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }

  if (body.error) {
    throw new Error(body.error)
  }

  if (typeof body.summary !== 'string' || body.summary.trim().length === 0) {
    throw new Error('AI service returned an invalid response.')
  }

  return {
    summary: body.summary,
    notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes : undefined
  }
}

export function explainMetar(metar: string) {
  return postAiBrief('/api/ai/metar/explain', { metar })
}

export function airportBrief(airportData: unknown) {
  return postAiBrief('/api/ai/airport/brief', { airportData })
}

export function explainAirspace(airspaceData: unknown) {
  return postAiBrief('/api/ai/airspace/explain', { airspaceData })
}
