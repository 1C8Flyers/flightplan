import type { BriefResponse } from './briefApi'

const WEATHER_INTENSITY: Record<string, string> = {
  '-': 'light',
  '+': 'heavy',
  VC: 'in the vicinity'
}

const WEATHER_DESCRIPTORS: Record<string, string> = {
  MI: 'shallow',
  PR: 'partial',
  BC: 'patches',
  DR: 'low drifting',
  BL: 'blowing',
  SH: 'showers',
  TS: 'thunderstorm',
  FZ: 'freezing'
}

const WEATHER_PHENOMENA: Record<string, string> = {
  DZ: 'drizzle',
  RA: 'rain',
  SN: 'snow',
  SG: 'snow grains',
  IC: 'ice crystals',
  PL: 'ice pellets',
  GR: 'hail',
  GS: 'small hail',
  UP: 'unknown precipitation',
  BR: 'mist',
  FG: 'fog',
  FU: 'smoke',
  VA: 'volcanic ash',
  DU: 'widespread dust',
  SA: 'sand',
  HZ: 'haze',
  PY: 'spray',
  PO: 'dust/sand whirls',
  SQ: 'squalls',
  FC: 'funnel cloud/tornado',
  SS: 'sandstorm',
  DS: 'duststorm'
}

const CLOUD_LAYER_LABEL: Record<string, string> = {
  FEW: 'few',
  SCT: 'scattered',
  BKN: 'broken',
  OVC: 'overcast',
  VV: 'vertical visibility'
}

type ForecastSegment = {
  label: string
  tokens: string[]
}

function normalizeTaf(rawTaf: string) {
  return rawTaf
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function decodeWeatherToken(token: string) {
  if (!/^[-+A-Z]{2,9}$/u.test(token)) {
    return null
  }

  let cursor = token
  const parts: string[] = []

  if (cursor.startsWith('-') || cursor.startsWith('+')) {
    const label = WEATHER_INTENSITY[cursor[0]]
    if (label) {
      parts.push(label)
    }
    cursor = cursor.slice(1)
  }

  if (cursor.startsWith('VC')) {
    parts.push(WEATHER_INTENSITY.VC)
    cursor = cursor.slice(2)
  }

  const descriptor = cursor.slice(0, 2)
  if (WEATHER_DESCRIPTORS[descriptor]) {
    parts.push(WEATHER_DESCRIPTORS[descriptor])
    cursor = cursor.slice(2)
  }

  const phenomena: string[] = []
  while (cursor.length >= 2) {
    const code = cursor.slice(0, 2)
    const phenomenon = WEATHER_PHENOMENA[code]
    if (!phenomenon) {
      return null
    }
    phenomena.push(phenomenon)
    cursor = cursor.slice(2)
  }

  if (cursor.length > 0 || phenomena.length === 0) {
    return null
  }

  return [...parts, ...phenomena].join(' ')
}

function decodeCloudLayer(token: string) {
  const cloudMatch = token.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/)
  if (!cloudMatch) {
    return null
  }

  const layer = CLOUD_LAYER_LABEL[cloudMatch[1]]
  const altitudeFt = Number.parseInt(cloudMatch[2], 10) * 100
  const convective = cloudMatch[3] ? ` (${cloudMatch[3]})` : ''
  return `${layer} ${altitudeFt.toLocaleString()} ft${convective}`
}

function decodeWind(token: string) {
  const windMatch = token.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/)
  if (!windMatch) {
    return null
  }

  const directionToken = windMatch[1]
  const speed = Number.parseInt(windMatch[2], 10)
  const gust = windMatch[4] ? Number.parseInt(windMatch[4], 10) : null
  const direction = directionToken === 'VRB' ? 'variable' : `${directionToken}°`
  const gustText = gust != null ? ` gusting ${gust}` : ''
  return `wind ${direction} at ${speed}${gustText} kt`
}

function decodeVisibility(token: string) {
  if (/^\d+SM$/u.test(token) || /^P\d+SM$/u.test(token) || /^\d+\/\d+SM$/u.test(token)) {
    return `visibility ${token}`
  }

  if (/^\d{4}$/u.test(token)) {
    return `visibility ${token} m`
  }

  if (token === 'CAVOK') {
    return 'visibility 10 km+ and no significant cloud/weather'
  }

  return null
}

function formatPeriod(period: string) {
  const match = period.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/)
  if (!match) {
    return period
  }

  return `day ${match[1]} ${match[2]}00Z to day ${match[3]} ${match[4]}00Z`
}

function formatSegmentLabel(label: string) {
  const fmMatch = label.match(/^FM(\d{2})(\d{2})(\d{2})$/)
  if (fmMatch) {
    return `From day ${fmMatch[1]} at ${fmMatch[2]}:${fmMatch[3]}Z`
  }

  const tempoMatch = label.match(/^(TEMPO|BECMG)\s+(\d{4}\/\d{4})$/)
  if (tempoMatch) {
    return `${tempoMatch[1]} ${formatPeriod(tempoMatch[2])}`
  }

  const probMatch = label.match(/^(PROB30|PROB40)\s+(\d{4}\/\d{4})$/)
  if (probMatch) {
    return `${probMatch[1]} ${formatPeriod(probMatch[2])}`
  }

  return label
}

function summarizeSegment(tokens: string[]) {
  const wind = tokens.map((token) => decodeWind(token)).find((value) => value != null) ?? null
  const visibility = tokens.map((token) => decodeVisibility(token)).find((value) => value != null) ?? null

  const weather = tokens
    .map((token) => decodeWeatherToken(token))
    .filter((value): value is string => value != null)

  const clouds = tokens
    .map((token) => decodeCloudLayer(token))
    .filter((value): value is string => value != null)

  const parts: string[] = []
  if (wind) {
    parts.push(wind)
  }
  if (visibility) {
    parts.push(visibility)
  }
  if (weather.length > 0) {
    parts.push(`weather ${weather.join(', ')}`)
  }
  if (clouds.length > 0) {
    parts.push(`clouds ${clouds.join('; ')}`)
  }
  if (tokens.includes('NSW')) {
    parts.push('no significant weather')
  }

  return parts.length > 0 ? parts.join('; ') : 'details not parsed'
}

function parseSegments(tokens: string[], startIndex: number) {
  const segments: ForecastSegment[] = []
  let label = 'Initial'
  let segmentTokens: string[] = []

  function pushSegment() {
    if (!segmentTokens.length) {
      return
    }

    segments.push({
      label,
      tokens: segmentTokens
    })
    segmentTokens = []
  }

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) {
      continue
    }

    if (/^FM\d{6}$/u.test(token)) {
      pushSegment()
      label = token
      continue
    }

    if ((token === 'TEMPO' || token === 'BECMG') && /^\d{4}\/\d{4}$/u.test(tokens[index + 1] ?? '')) {
      pushSegment()
      label = `${token} ${tokens[index + 1]}`
      index += 1
      continue
    }

    if ((token === 'PROB30' || token === 'PROB40') && /^\d{4}\/\d{4}$/u.test(tokens[index + 1] ?? '')) {
      pushSegment()
      label = `${token} ${tokens[index + 1]}`
      index += 1
      continue
    }

    segmentTokens.push(token)
  }

  pushSegment()
  return segments
}

export function decodeTaf(rawTaf: string): BriefResponse {
  const normalized = normalizeTaf(rawTaf)
  if (!normalized) {
    throw new Error('TAF is required.')
  }

  const tokens = normalized.split(' ')
  let index = 0

  if (tokens[index] === 'TAF') {
    index += 1
  }

  if (tokens[index] === 'AMD' || tokens[index] === 'COR') {
    index += 1
  }

  const station = tokens[index] && /^[A-Z0-9]{4}$/u.test(tokens[index]) ? tokens[index] : null
  if (station) {
    index += 1
  }

  const issueTime = tokens[index] && /^\d{6}Z$/u.test(tokens[index]) ? tokens[index] : null
  if (issueTime) {
    index += 1
  }

  const validity = tokens[index] && /^\d{4}\/\d{4}$/u.test(tokens[index]) ? tokens[index] : null
  if (validity) {
    index += 1
  }

  const segments = parseSegments(tokens, index).slice(0, 5)
  const summaryParts: string[] = []

  if (station) {
    summaryParts.push(`TAF ${station}.`)
  }

  if (issueTime) {
    summaryParts.push(`Issued day ${issueTime.slice(0, 2)} at ${issueTime.slice(2, 4)}:${issueTime.slice(4, 6)}Z.`)
  }

  if (validity) {
    summaryParts.push(`Valid ${formatPeriod(validity)}.`)
  }

  if (segments.length > 0) {
    const segmentLines = segments.map((segment) => {
      const prefix = segment.label === 'Initial' ? 'Initial' : formatSegmentLabel(segment.label)
      return `${prefix}: ${summarizeSegment(segment.tokens)}.`
    })

    summaryParts.push(segmentLines.join(' '))
  } else {
    summaryParts.push('Forecast groups were not parsed from this TAF.')
  }

  return {
    summary: summaryParts.join(' ')
  }
}