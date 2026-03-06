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

function normalizeMetar(rawMetar: string) {
  return rawMetar
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function decodeTemperature(value: string) {
  const negative = value.startsWith('M')
  const numeric = Number.parseInt(negative ? value.slice(1) : value, 10)
  if (!Number.isFinite(numeric)) {
    return null
  }
  return negative ? -numeric : numeric
}

function decodeWind(token: string) {
  const windMatch = token.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS|KPH)$/)
  if (!windMatch) {
    return null
  }

  const directionToken = windMatch[1]
  const speed = Number.parseInt(windMatch[2], 10)
  const gust = windMatch[4] ? Number.parseInt(windMatch[4], 10) : null
  const units = windMatch[5]

  const direction = directionToken === 'VRB' ? 'variable' : `${directionToken}°`
  const gustText = gust != null ? ` gusting ${gust}` : ''
  return `Wind ${direction} at ${speed}${gustText} ${units.toLowerCase()}`
}

function decodeVisibility(tokens: string[], startIndex: number) {
  const token = tokens[startIndex]
  if (!token) {
    return null
  }

  if (token === 'CAVOK') {
    return { text: 'Visibility 10 km or more and no significant cloud/weather', consumed: 1 }
  }

  const combined = startIndex + 1 < tokens.length ? `${token} ${tokens[startIndex + 1]}` : token
  if (/^\d+ \d\/\dSM$/u.test(combined)) {
    return { text: `Visibility ${combined}`, consumed: 2 }
  }

  if (/^\d{4}$/u.test(token)) {
    return { text: `Visibility ${token} meters`, consumed: 1 }
  }

  if (/^P?\d+(?:\/\d+)?SM$/u.test(token)) {
    return { text: `Visibility ${token}`, consumed: 1 }
  }

  return null
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
  return `${layer} at ${altitudeFt.toLocaleString()} ft${convective}`
}

export function decodeMetar(rawMetar: string): BriefResponse {
  const normalized = normalizeMetar(rawMetar)
  if (!normalized) {
    throw new Error('METAR is required.')
  }

  const tokens = normalized.split(' ')
  const station = tokens[0] && /^[A-Z0-9]{4}$/u.test(tokens[0]) ? tokens[0] : null
  const timeToken = tokens.find((token) => /^\d{6}Z$/u.test(token)) ?? null
  const windText = tokens.map((token) => decodeWind(token)).find((value) => value != null) ?? null

  const weatherText = tokens
    .map((token) => decodeWeatherToken(token))
    .filter((value): value is string => value != null)

  const cloudLayers = tokens
    .map((token) => decodeCloudLayer(token))
    .filter((value): value is string => value != null)

  const tempToken = tokens.find((token) => /^M?\d{2}\/M?\d{2}$/u.test(token)) ?? null
  const altimeterToken = tokens.find((token) => /^A\d{4}$/u.test(token) || /^Q\d{4}$/u.test(token)) ?? null

  let visibilityText: string | null = null
  for (let index = 0; index < tokens.length; index += 1) {
    const decoded = decodeVisibility(tokens, index)
    if (decoded) {
      visibilityText = decoded.text
      index += decoded.consumed - 1
      break
    }
  }

  const summaryParts: string[] = []

  if (station) {
    summaryParts.push(`Station ${station}.`)
  }

  if (timeToken) {
    const day = Number.parseInt(timeToken.slice(0, 2), 10)
    const hour = timeToken.slice(2, 4)
    const minute = timeToken.slice(4, 6)
    summaryParts.push(`Observed on day ${day} at ${hour}:${minute}Z.`)
  }

  if (windText) {
    summaryParts.push(`${windText}.`)
  }

  if (visibilityText) {
    summaryParts.push(`${visibilityText}.`)
  }

  if (weatherText.length > 0) {
    summaryParts.push(`Weather: ${weatherText.join(', ')}.`)
  }

  if (cloudLayers.length > 0) {
    summaryParts.push(`Clouds: ${cloudLayers.join('; ')}.`)
  }

  if (tempToken) {
    const [tempRaw, dewRaw] = tempToken.split('/')
    const temp = decodeTemperature(tempRaw)
    const dew = decodeTemperature(dewRaw)
    if (temp != null && dew != null) {
      summaryParts.push(`Temperature ${temp}°C, dew point ${dew}°C.`)
    }
  }

  if (altimeterToken) {
    if (altimeterToken.startsWith('A')) {
      const inHg = Number.parseInt(altimeterToken.slice(1), 10) / 100
      summaryParts.push(`Altimeter ${inHg.toFixed(2)} inHg.`)
    } else {
      summaryParts.push(`Altimeter ${Number.parseInt(altimeterToken.slice(1), 10)} hPa.`)
    }
  }

  if (summaryParts.length === 0) {
    summaryParts.push('METAR decoded, but no standard groups were recognized.')
  }

  return {
    summary: summaryParts.join(' ')
  }
}