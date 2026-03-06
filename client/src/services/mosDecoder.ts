import type { BriefResponse } from './briefApi'

type MosGuidanceInput = {
  station?: string | null
  mavRaw?: string | null
  mexRaw?: string | null
  metRaw?: string | null
}

function summarizeProduct(label: string, raw: string | null | undefined) {
  if (!raw) {
    return null
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return null
  }

  const header = lines.find((line) => /MOS GUIDANCE/i.test(line)) ?? lines[0]
  const keyRows = lines
    .filter((line) => /^(HR|FHR|TMP|DPT|WDR|WSP|CLD|CIG|VIS|OBV|P06|P12|T06|T12|POZ|POS|TYP)\b/.test(line))
    .slice(0, 4)

  const rowSummary = keyRows.length ? ` ${keyRows.join(' · ')}` : ''
  return `${label}: ${header}.${rowSummary}`
}

export function decodeMosGuidance(mos: MosGuidanceInput): BriefResponse {
  const station = typeof mos.station === 'string' && mos.station.trim()
    ? mos.station.trim().toUpperCase()
    : null

  const productSummaries = [
    summarizeProduct('MAV', mos.mavRaw),
    summarizeProduct('MEX', mos.mexRaw),
    summarizeProduct('MET', mos.metRaw)
  ].filter((value): value is string => value != null)

  if (!productSummaries.length) {
    throw new Error('MOS guidance is not available for this station.')
  }

  const prefix = station ? `MOS guidance for ${station}.` : 'MOS guidance available.'
  return {
    summary: `${prefix} ${productSummaries.join(' ')}`
  }
}