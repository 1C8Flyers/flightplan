import { decodeMetar } from './metarDecoder'
import { decodeMosGuidance } from './mosDecoder'
import { decodeTaf } from './tafDecoder'

export type BriefResponse = {
  summary: string
  notes?: string
}

type AiErrorResponse = {
  error?: string
}

async function postAiBrief(path: string, payload: Record<string, unknown>): Promise<BriefResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const body = await response.json().catch(() => ({})) as Partial<BriefResponse> & AiErrorResponse

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

export function decodeMetarBrief(metar: string) {
  return Promise.resolve(decodeMetar(metar))
}

export function decodeTafBrief(taf: string) {
  return Promise.resolve(decodeTaf(taf))
}

export function decodeMosBrief(mos: unknown) {
  return Promise.resolve(decodeMosGuidance((mos ?? {}) as {
    station?: string | null
    mavRaw?: string | null
    mexRaw?: string | null
    metRaw?: string | null
  }))
}

export function airportBrief(airportData: unknown) {
  return postAiBrief('/api/ai/airport/brief', { airportData })
}

export function explainAirspace(airspaceData: unknown) {
  return postAiBrief('/api/ai/airspace/explain', { airspaceData })
}
