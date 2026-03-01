import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { createRequire } from 'module'
import { parseStringPromise } from 'xml2js'
import { z } from 'zod'

const require = createRequire(import.meta.url)
const geomagnetism = require('geomagnetism')
const AdmZip = require('adm-zip')
const sharp = require('sharp')

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT ?? 4000)

const stationSchema = z.object({
  id: z.string(),
  icaoId: z.string(),
  iataId: z.string().nullable().optional(),
  faaId: z.string().nullable().optional(),
  site: z.string(),
  lat: z.number(),
  lon: z.number(),
  elev: z.number().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional()
})

const metarSchema = z.object({
  icaoId: z.string(),
  reportTime: z.string().optional(),
  rawOb: z.string().optional(),
  temp: z.number().nullable().optional(),
  dewp: z.number().nullable().optional(),
  wdir: z.number().nullable().optional(),
  wspd: z.number().nullable().optional(),
  visib: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value == null ? null : String(value))),
  altim: z.number().nullable().optional(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional()
})

const tafSchema = z.object({
  icaoId: z.string().optional(),
  issueTime: z.string().optional(),
  rawTAF: z.string().optional()
})

type FaaDelay = {
  airportCode: string
  reason: string
  type: string
  minMinutes: string
  maxMinutes: string
  trend: string
}

type AirportRecord = {
  ident: string
  name: string
  lat: number
  lon: number
  type: string
  isoCountry: string
  iataCode: string | null
  localCode: string | null
  gpsCode: string | null
}

type NavaidRecord = {
  ident: string
  name: string
  type: string
  lat: number
  lon: number
}

type WaypointSuggestion = {
  ident: string
  name: string
  lat: number
  lon: number
  crossTrackNm: number
  progress: number
}

type SectionalChart = {
  name: string
  effectiveDate: string
  url: string
  centerLat: number | null
  centerLon: number | null
}

type WindsAloftStation = {
  station: string
  levels: Record<number, { direction: number | null; speed: number; temperatureC: number | null }>
}

type ResolvedAirport = {
  inputCode: string
  station: z.infer<typeof stationSchema> | null
  dataset: AirportRecord | null
}

let faaCache: { loadedAt: number; delays: FaaDelay[] } | null = null
let airportCache: { loadedAt: number; airports: AirportRecord[] } | null = null
let navaidCache: { loadedAt: number; navaids: NavaidRecord[] } | null = null
let sectionalCache: { loadedAt: number; sectionals: SectionalChart[] } | null = null
let windsAloftCache: { loadedAt: number; stations: WindsAloftStation[] } | null = null
const sectionalGeoTiffCache = new Map<string, Buffer>()
const sectionalOverlayCache = new Map<string, { image: Buffer; bounds: [[number, number], [number, number]] }>()
type LandmarkResult = {
  ident: string | null
  label: string | null
  source: string | null
}

const landmarkCache = new Map<string, { loadedAt: number; result: LandmarkResult }>()

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${url} (${response.status})`)
  }
  const text = await response.text()
  if (!text.trim()) {
    return [] as T
  }
  return JSON.parse(text) as T
}

async function fetchFaaDelays(): Promise<FaaDelay[]> {
  const cacheWindowMs = 2 * 60 * 1000
  if (faaCache && Date.now() - faaCache.loadedAt < cacheWindowMs) {
    return faaCache.delays
  }

  const response = await fetch('https://nasstatus.faa.gov/api/airport-status-information')
  if (!response.ok) {
    throw new Error(`FAA feed request failed (${response.status})`)
  }

  const xmlBody = await response.text()
  const parsed = await parseStringPromise(xmlBody)

  const delayTypes = parsed?.AIRPORT_STATUS_INFORMATION?.Delay_type ?? []
  const delays: FaaDelay[] = []

  for (const group of delayTypes) {
    const list = group?.Arrival_Departure_Delay_List?.[0]?.Delay ?? []
    for (const item of list) {
      const arrivalDeparture = item?.Arrival_Departure?.[0] ?? {}
      delays.push({
        airportCode: String(item?.ARPT?.[0] ?? '').toUpperCase(),
        reason: String(item?.Reason?.[0] ?? 'Unknown'),
        type: String(arrivalDeparture?.$?.Type ?? 'Unknown'),
        minMinutes: String(arrivalDeparture?.Min?.[0] ?? '0'),
        maxMinutes: String(arrivalDeparture?.Max?.[0] ?? '0'),
        trend: String(arrivalDeparture?.Trend?.[0] ?? 'Unknown')
      })
    }
  }

  faaCache = { loadedAt: Date.now(), delays }
  return delays
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusNm = 3440.065
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return radiusNm * c
}

function routeProjection(depLat: number, depLon: number, arrLat: number, arrLon: number, pointLat: number, pointLon: number) {
  const lat0 = (depLat + arrLat) / 2
  const cosLat = Math.cos(toRadians(lat0))

  const depX = depLon * 60 * cosLat
  const depY = depLat * 60
  const arrX = arrLon * 60 * cosLat
  const arrY = arrLat * 60
  const pointX = pointLon * 60 * cosLat
  const pointY = pointLat * 60

  const vx = arrX - depX
  const vy = arrY - depY
  const wx = pointX - depX
  const wy = pointY - depY

  const len2 = vx * vx + vy * vy
  if (len2 === 0) {
    return { progress: 0, crossTrackNm: Number.POSITIVE_INFINITY }
  }

  const progress = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
  const closestX = depX + progress * vx
  const closestY = depY + progress * vy
  const crossTrackNm = Math.sqrt((pointX - closestX) ** 2 + (pointY - closestY) ** 2)

  return { progress, crossTrackNm }
}

async function fetchAirportsDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  if (airportCache && Date.now() - airportCache.loadedAt < cacheWindowMs) {
    return airportCache.airports
  }

  const response = await fetch('https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv')
  if (!response.ok) {
    throw new Error(`Airport dataset request failed (${response.status})`)
  }

  const csv = await response.text()
  const rows = csv.split(/\r?\n/)
  const headers = parseCsvLine(rows[0])

  const identIndex = headers.indexOf('ident')
  const nameIndex = headers.indexOf('name')
  const latIndex = headers.indexOf('latitude_deg')
  const lonIndex = headers.indexOf('longitude_deg')
  const typeIndex = headers.indexOf('type')
  const countryIndex = headers.indexOf('iso_country')
  const iataIndex = headers.indexOf('iata_code')
  const localIndex = headers.indexOf('local_code')
  const gpsIndex = headers.indexOf('gps_code')

  const airports: AirportRecord[] = []
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row.trim()) {
      continue
    }

    const cols = parseCsvLine(row)
    const ident = cols[identIndex] ?? ''
    const name = cols[nameIndex] ?? ''
    const type = cols[typeIndex] ?? ''
    const lat = Number(cols[latIndex])
    const lon = Number(cols[lonIndex])
    const isoCountry = cols[countryIndex] ?? ''
    const iataCode = cols[iataIndex] ? cols[iataIndex].toUpperCase() : null
    const localCode = cols[localIndex] ? cols[localIndex].toUpperCase() : null
    const gpsCode = cols[gpsIndex] ? cols[gpsIndex].toUpperCase() : null

    if (!ident || !name || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue
    }

    if (isoCountry !== 'US') {
      continue
    }

    airports.push({ ident, name, lat, lon, type, isoCountry, iataCode, localCode, gpsCode })
  }

  airportCache = { loadedAt: Date.now(), airports }
  return airports
}

async function fetchNavaidsDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  if (navaidCache && Date.now() - navaidCache.loadedAt < cacheWindowMs) {
    return navaidCache.navaids
  }

  const response = await fetch('https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/navaids.csv')
  if (!response.ok) {
    throw new Error(`Navaid dataset request failed (${response.status})`)
  }

  const csv = await response.text()
  const rows = csv.split(/\r?\n/)
  const headers = parseCsvLine(rows[0])

  const identIndex = headers.indexOf('ident')
  const nameIndex = headers.indexOf('name')
  const typeIndex = headers.indexOf('type')
  const latIndex = headers.indexOf('latitude_deg')
  const lonIndex = headers.indexOf('longitude_deg')

  const navaids: NavaidRecord[] = []
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row.trim()) {
      continue
    }

    const cols = parseCsvLine(row)
    const ident = (cols[identIndex] ?? '').toUpperCase().trim()
    const name = (cols[nameIndex] ?? '').trim()
    const type = (cols[typeIndex] ?? '').trim().toUpperCase()
    const lat = Number(cols[latIndex])
    const lon = Number(cols[lonIndex])

    if (!ident || !name || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue
    }

    navaids.push({ ident, name, type, lat, lon })
  }

  navaidCache = { loadedAt: Date.now(), navaids }
  return navaids
}

function getAirportCodeCandidates(code: string) {
  const value = code.toUpperCase().trim()
  const candidates = new Set<string>([value])

  if (value.length === 3) {
    candidates.add(`K${value}`)
  }
  if (value.length === 4 && value.startsWith('K')) {
    candidates.add(value.slice(1))
  }

  return [...candidates]
}

async function fetchStationByCandidateCodes(code: string) {
  const candidates = getAirportCodeCandidates(code)

  for (const candidate of candidates) {
    const payload = await fetchJson<unknown[]>(
      `https://aviationweather.gov/api/data/stationinfo?ids=${candidate}&format=json`
    )

    if (payload.length) {
      return stationSchema.parse(payload[0])
    }
  }

  return null
}

function findAirportInDataset(code: string, airports: AirportRecord[]) {
  const normalized = code.toUpperCase().trim()
  const candidates = getAirportCodeCandidates(normalized)

  return (
    airports.find((airport) =>
      candidates.includes(airport.ident.toUpperCase()) ||
      (airport.localCode ? candidates.includes(airport.localCode.toUpperCase()) : false) ||
      (airport.iataCode ? candidates.includes(airport.iataCode.toUpperCase()) : false) ||
      (airport.gpsCode ? candidates.includes(airport.gpsCode.toUpperCase()) : false)
    ) ?? null
  )
}

async function resolveAirport(code: string): Promise<ResolvedAirport> {
  const inputCode = code.toUpperCase().trim()
  const airports = await fetchAirportsDataset()

  const directStation = await fetchStationByCandidateCodes(inputCode)
  if (directStation) {
    const dataset = findAirportInDataset(directStation.icaoId, airports)
    return { inputCode, station: directStation, dataset }
  }

  const dataset = findAirportInDataset(inputCode, airports)
  if (!dataset) {
    throw new Error(`No airport found for ${inputCode}`)
  }

  let station = dataset.gpsCode ? await fetchStationByCandidateCodes(dataset.gpsCode) : null
  if (!station && dataset.ident) {
    station = await fetchStationByCandidateCodes(dataset.ident)
  }

  return { inputCode, station, dataset }
}

function decodeWindGroup(group: string, altitudeFt: number) {
  if (!group || group === '//////') {
    return null
  }

  if (group.startsWith('9900')) {
    return { direction: null, speed: 0, temperatureC: altitudeFt >= 6000 ? 0 : null }
  }

  const directionCode = Number(group.slice(0, 2))
  let speed = Number(group.slice(2, 4))
  let direction = directionCode * 10

  if (directionCode >= 51 && directionCode <= 86) {
    direction = (directionCode - 50) * 10
    speed += 100
  }

  let temperatureC: number | null = null
  if (group.length >= 6) {
    const tempRaw = group.slice(4)
    if (/^[+-]?\d{2}$/.test(tempRaw)) {
      const parsed = Number(tempRaw)
      if (altitudeFt >= 24000 && parsed > 0) {
        temperatureC = -parsed
      } else {
        temperatureC = parsed
      }
    }
  }

  return { direction, speed, temperatureC }
}

async function fetchWindsAloftStations() {
  const cacheWindowMs = 60 * 60 * 1000
  if (windsAloftCache && Date.now() - windsAloftCache.loadedAt < cacheWindowMs) {
    return windsAloftCache.stations
  }

  const response = await fetch('https://aviationweather.gov/api/data/windtemp?region=all')
  if (!response.ok) {
    throw new Error(`Winds aloft request failed (${response.status})`)
  }

  const text = await response.text()
  const lines = text.split(/\r?\n/)
  const headerLine = lines.find((line) => line.startsWith('FT'))
  if (!headerLine) {
    throw new Error('Unable to parse winds aloft header.')
  }

  const altitudeMatches = [...headerLine.matchAll(/\d{4,5}/g)]
  const altitudes = altitudeMatches.map((match) => Number(match[0]))

  const stations: WindsAloftStation[] = []
  for (const line of lines) {
    if (!/^[A-Z0-9]{3}\s/.test(line)) {
      continue
    }

    const station = line.slice(0, 3)
    const groups = line
      .slice(3)
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    const offset = Math.max(0, altitudes.length - groups.length)
    const levels: WindsAloftStation['levels'] = {}

    for (let index = 0; index < groups.length; index += 1) {
      const altitude = altitudes[offset + index]
      const decoded = decodeWindGroup(groups[index], altitude)
      if (decoded) {
        levels[altitude] = decoded
      }
    }

    stations.push({ station, levels })
  }

  windsAloftCache = { loadedAt: Date.now(), stations }
  return stations
}

async function fetchWeatherFromStationIds(ids: string[]) {
  if (!ids.length) {
    return { metar: null as z.infer<typeof metarSchema> | null, taf: null as z.infer<typeof tafSchema> | null, sourceStation: null as string | null }
  }

  const idList = ids.join(',')
  const [metarPayload, tafPayload] = await Promise.all([
    fetchJson<unknown[]>(`https://aviationweather.gov/api/data/metar?ids=${idList}&format=json`),
    fetchJson<unknown[]>(`https://aviationweather.gov/api/data/taf?ids=${idList}&format=json`)
  ])

  const parsedMetars = metarPayload
    .map((item) => metarSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data)

  const parsedTafs = tafPayload
    .map((item) => tafSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data)

  const metar = parsedMetars[0] ?? null
  const taf = parsedTafs.find((item) => item.icaoId === metar?.icaoId) ?? parsedTafs[0] ?? null
  const sourceStation = metar?.icaoId ?? taf?.icaoId ?? null

  return { metar, taf, sourceStation }
}

async function fetchNearestReportingWeather(lat: number, lon: number) {
  const airports = await fetchAirportsDataset()

  const nearestStations = airports
    .filter((airport) => Boolean(airport.gpsCode && /^[A-Z]\w{3}$/.test(airport.gpsCode)))
    .map((airport) => ({
      code: airport.gpsCode as string,
      distanceNm: haversineNm(lat, lon, airport.lat, airport.lon)
    }))
    .sort((a, b) => a.distanceNm - b.distanceNm)
    .slice(0, 30)

  const stationIds = nearestStations.map((station) => station.code)
  if (!stationIds.length) {
    return { metar: null as z.infer<typeof metarSchema> | null, taf: null as z.infer<typeof tafSchema> | null, sourceStation: null as string | null }
  }

  const direct = await fetchWeatherFromStationIds(stationIds)
  if (!direct.metar && !direct.taf) {
    return direct
  }

  return direct
}

async function findNearbyFaaWaypoint(lat: number, lon: number) {
  const [airports, navaids] = await Promise.all([fetchAirportsDataset(), fetchNavaidsDataset()])

  const airportCandidates = airports
    .filter((airport) =>
      ['small_airport', 'medium_airport', 'large_airport', 'seaplane_base'].includes(airport.type)
    )
    .map((airport) => ({
      ident: airport.ident.toUpperCase(),
      label: airport.name,
      source: 'faa-airport' as const,
      distanceNm: haversineNm(lat, lon, airport.lat, airport.lon)
    }))
    .filter((candidate) => candidate.distanceNm <= 8)
    .sort((a, b) => a.distanceNm - b.distanceNm)

  const navaidCandidates = navaids
    .map((navaid) => ({
      ident: navaid.ident,
      label: navaid.name,
      source: `faa-navaid-${navaid.type.toLowerCase()}`,
      distanceNm: haversineNm(lat, lon, navaid.lat, navaid.lon)
    }))
    .filter((candidate) => candidate.distanceNm <= 12)
    .sort((a, b) => a.distanceNm - b.distanceNm)

  const airport = airportCandidates[0] ?? null
  const navaid = navaidCandidates[0] ?? null

  if (!airport && !navaid) {
    return null
  }

  if (airport && navaid) {
    return airport.distanceNm <= navaid.distanceNm + 1 ? airport : navaid
  }

  return airport ?? navaid
}

function selectSuggestedWaypoints(depLat: number, depLon: number, arrLat: number, arrLon: number, airports: AirportRecord[]) {
  const routeAirportPool = airports.filter((airport) =>
    ['small_airport', 'medium_airport', 'large_airport'].includes(airport.type)
  )
  const routeDistanceNm = haversineNm(depLat, depLon, arrLat, arrLon)
  const desiredCount = Math.min(5, Math.max(2, Math.floor(routeDistanceNm / 90)))
  const corridorWidthNm = Math.min(35, Math.max(12, routeDistanceNm * 0.12))

  const corridorCandidates = routeAirportPool
    .map((airport) => {
      const projection = routeProjection(depLat, depLon, arrLat, arrLon, airport.lat, airport.lon)
      return {
        ...airport,
        progress: projection.progress,
        crossTrackNm: projection.crossTrackNm
      }
    })
    .filter((airport) => airport.progress > 0.08 && airport.progress < 0.92)
    .filter((airport) => airport.crossTrackNm <= corridorWidthNm)

  const targets = Array.from({ length: desiredCount }, (_value, index) => (index + 1) / (desiredCount + 1))
  const selected: WaypointSuggestion[] = []
  const used = new Set<string>()

  for (const target of targets) {
    const best = corridorCandidates
      .filter((candidate) => !used.has(candidate.ident))
      .sort((a, b) => {
        const aScore = Math.abs(a.progress - target) * 70 + a.crossTrackNm
        const bScore = Math.abs(b.progress - target) * 70 + b.crossTrackNm
        return aScore - bScore
      })[0]

    if (!best) {
      continue
    }

    used.add(best.ident)
    selected.push({
      ident: best.ident,
      name: best.name,
      lat: best.lat,
      lon: best.lon,
      crossTrackNm: Number(best.crossTrackNm.toFixed(1)),
      progress: Number(best.progress.toFixed(3))
    })
  }

  return selected.sort((a, b) => a.progress - b.progress)
}

async function fetchSectionalCharts() {
  const cacheWindowMs = 6 * 60 * 60 * 1000
  if (sectionalCache && Date.now() - sectionalCache.loadedAt < cacheWindowMs) {
    return sectionalCache.sectionals
  }

  const response = await fetch('https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/')
  if (!response.ok) {
    throw new Error(`FAA sectional page request failed (${response.status})`)
  }

  const html = await response.text()
  const regex = /https:\/\/aeronav\.faa\.gov\/visual\/(\d{2}-\d{2}-\d{4})\/PDFs\/([A-Za-z0-9_\-]+)\.pdf/g
  const byName = new Map<string, SectionalChart>()

  let match = regex.exec(html)
  while (match) {
    const [, effectiveDate, filename] = match
    const skip =
      filename.includes('_TAC') ||
      filename.includes('Heli') ||
      filename.includes('Grand_Canyon') ||
      filename.includes('Caribbean') ||
      filename.includes('Planning') ||
      filename.includes('_VFR')

    if (!skip) {
      const name = filename.replace(/_/g, ' ')
      const url = `https://aeronav.faa.gov/visual/${effectiveDate}/PDFs/${filename}.pdf`
      const existing = byName.get(name)

      if (!existing || existing.effectiveDate < effectiveDate) {
        byName.set(name, { name, effectiveDate, url, centerLat: null, centerLon: null })
      }
    }

    match = regex.exec(html)
  }

  const airports = await fetchAirportsDataset()

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const scoreAirport = (chartName: string, airportName: string, airportType: string) => {
    const chart = normalize(chartName)
    const airport = normalize(airportName)

    const chartTokens = chart.split(' ').filter((token) => token.length > 2)
    const matched = chartTokens.filter((token) => airport.includes(token)).length

    if (matched === 0 && !airport.includes(chart)) {
      return -1
    }

    const typeWeight = airportType === 'large_airport' ? 1 : airportType === 'medium_airport' ? 0.6 : 0.3
    return matched + typeWeight
  }

  const sectionals = [...byName.values()]
    .map((sectional) => {
      const bestAirport = airports
        .map((airport) => ({ airport, score: scoreAirport(sectional.name, airport.name, airport.type) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.airport

      return {
        ...sectional,
        centerLat: bestAirport?.lat ?? null,
        centerLon: bestAirport?.lon ?? null
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  sectionalCache = { loadedAt: Date.now(), sectionals }
  return sectionals
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/airport/:icao', async (req, res) => {
  try {
    const resolved = await resolveAirport(req.params.icao)
    const station = resolved.station
    const dataset = resolved.dataset
    const faaDelays = await fetchFaaDelays()

    const candidates = [
      station?.faaId,
      station?.iataId,
      station?.icaoId,
      station?.icaoId?.replace(/^K/, ''),
      dataset?.ident,
      dataset?.localCode,
      dataset?.iataCode,
      dataset?.gpsCode,
      resolved.inputCode
    ]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase())

    const matchingDelays = faaDelays.filter((delay) => candidates.includes(delay.airportCode))

    res.json({
      airport: {
        icao: station?.icaoId ?? dataset?.gpsCode ?? dataset?.ident ?? resolved.inputCode,
        iata: station?.iataId ?? dataset?.iataCode ?? null,
        faa: station?.faaId ?? dataset?.localCode ?? null,
        name: station?.site ?? dataset?.name ?? resolved.inputCode,
        lat: station?.lat ?? dataset?.lat ?? 0,
        lon: station?.lon ?? dataset?.lon ?? 0,
        elevationMeters: station?.elev ?? null,
        state: station?.state ?? null,
        country: station?.country ?? dataset?.isoCountry ?? null
      },
      faa: {
        hasDelay: matchingDelays.length > 0,
        delays: matchingDelays
      }
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/weather/:icao', async (req, res) => {
  try {
    const resolved = await resolveAirport(req.params.icao)
    const weatherStation = resolved.station?.icaoId ?? resolved.dataset?.gpsCode ?? null
    const lat = resolved.station?.lat ?? resolved.dataset?.lat ?? null
    const lon = resolved.station?.lon ?? resolved.dataset?.lon ?? null

    if (!weatherStation) {
      if (lat == null || lon == null) {
        res.json({
          metar: null,
          taf: null,
          sourceStation: null,
          fallbackUsed: false
        })
        return
      }

      const fallback = await fetchNearestReportingWeather(lat, lon)
      res.json({
        metar: fallback.metar,
        taf: fallback.taf,
        sourceStation: fallback.sourceStation,
        fallbackUsed: true
      })
      return
    }

    const primary = await fetchWeatherFromStationIds([weatherStation])

    if (primary.metar || primary.taf) {
      res.json({
        metar: primary.metar,
        taf: primary.taf,
        sourceStation: primary.sourceStation ?? weatherStation,
        fallbackUsed: false
      })
      return
    }

    if (lat == null || lon == null) {
      res.json({
        metar: null,
        taf: null,
        sourceStation: weatherStation,
        fallbackUsed: false
      })
      return
    }

    const fallback = await fetchNearestReportingWeather(lat, lon)

    res.json({
      metar: fallback.metar,
      taf: fallback.taf,
      sourceStation: fallback.sourceStation,
      fallbackUsed: true
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/route/suggestions', async (req, res) => {
  try {
    const depLat = Number(req.query.depLat)
    const depLon = Number(req.query.depLon)
    const arrLat = Number(req.query.arrLat)
    const arrLon = Number(req.query.arrLon)

    if ([depLat, depLon, arrLat, arrLon].some((value) => Number.isNaN(value))) {
      res.status(400).json({ error: 'Route coordinates are required.' })
      return
    }

    const airports = await fetchAirportsDataset()
    const suggestions = selectSuggestedWaypoints(depLat, depLon, arrLat, arrLon, airports)

    res.json({ suggestions })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/sectionals', async (_req, res) => {
  try {
    const sectionals = await fetchSectionalCharts()
    res.json({ sectionals })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/sectionals/pdf', async (req, res) => {
  try {
    const source = String(req.query.source ?? '')
    if (!source.startsWith('https://aeronav.faa.gov/visual/')) {
      res.status(400).json({ error: 'Invalid FAA sectional source URL.' })
      return
    }

    const upstream = await fetch(source)
    if (!upstream.ok) {
      res.status(502).json({ error: `FAA PDF request failed (${upstream.status})` })
      return
    }

    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    res.send(buffer)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/sectionals/geotiff', async (req, res) => {
  try {
    const source = String(req.query.source ?? '')
    if (!source.startsWith('https://aeronav.faa.gov/visual/')) {
      res.status(400).json({ error: 'Invalid FAA sectional source URL.' })
      return
    }

    const cached = sectionalGeoTiffCache.get(source)
    if (cached) {
      res.setHeader('Content-Type', 'image/tiff')
      res.send(cached)
      return
    }

    const match = source.match(/https:\/\/aeronav\.faa\.gov\/visual\/(\d{2}-\d{2}-\d{4})\/PDFs\/([^/]+)\.pdf/i)
    if (!match) {
      res.status(400).json({ error: 'Unable to derive FAA sectional GeoTIFF location.' })
      return
    }

    const [, cycle, chartName] = match
    const zipUrl = `https://aeronav.faa.gov/visual/${cycle}/sectional-files/${chartName}.zip`
    const upstream = await fetch(zipUrl)
    if (!upstream.ok) {
      res.status(502).json({ error: `FAA sectional ZIP request failed (${upstream.status})` })
      return
    }

    const zipBuffer = Buffer.from(await upstream.arrayBuffer())
    const zip = new AdmZip(zipBuffer)
    const tifEntry = zip
      .getEntries()
      .find((entry: { entryName: string }) => /\.tif(f)?$/i.test(entry.entryName))

    if (!tifEntry) {
      res.status(502).json({ error: 'FAA sectional ZIP did not contain a GeoTIFF file.' })
      return
    }

    const tifBuffer = tifEntry.getData() as Buffer
    sectionalGeoTiffCache.set(source, tifBuffer)

    res.setHeader('Content-Type', 'image/tiff')
    res.send(tifBuffer)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

async function buildSectionalOverlay(source: string) {
  const cached = sectionalOverlayCache.get(source)
  if (cached) {
    return cached
  }

  const match = source.match(/https:\/\/aeronav\.faa\.gov\/visual\/(\d{2}-\d{2}-\d{4})\/PDFs\/([^/]+)\.pdf/i)
  if (!match) {
    throw new Error('Unable to derive FAA sectional overlay source.')
  }

  const [, cycle, chartName] = match
  const zipUrl = `https://aeronav.faa.gov/visual/${cycle}/sectional-files/${chartName}.zip`
  const upstream = await fetch(zipUrl)
  if (!upstream.ok) {
    throw new Error(`FAA sectional ZIP request failed (${upstream.status})`)
  }

  const zipBuffer = Buffer.from(await upstream.arrayBuffer())
  const zip = new AdmZip(zipBuffer)
  const tifEntry = zip
    .getEntries()
    .find((entry: { entryName: string }) => /\.tif(f)?$/i.test(entry.entryName))
  const htmEntry = zip
    .getEntries()
    .find((entry: { entryName: string }) => /\.htm$/i.test(entry.entryName))
  const tfwEntry = zip
    .getEntries()
    .find((entry: { entryName: string }) => /\.tfw$/i.test(entry.entryName))

  if (!tifEntry) {
    throw new Error('FAA sectional ZIP missing GeoTIFF data.')
  }

  const tifBuffer = tifEntry.getData() as Buffer
  const image = sharp(tifBuffer, { limitInputPixels: false })
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (!width || !height) {
    throw new Error('FAA sectional dimensions unavailable.')
  }

  let bounds: [[number, number], [number, number]] | null = null

  if (htmEntry) {
    const html = String(htmEntry.getData())
    const extractCoordinate = (label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = html.match(new RegExp(`${escaped}:<\\/em>\\s*([-+]?\\d+(?:\\.\\d+)?)<\\/dt>`, 'i'))
      return match ? Number(match[1]) : Number.NaN
    }

    const west = extractCoordinate('West_Bounding_Coordinate')
    const east = extractCoordinate('East_Bounding_Coordinate')
    const north = extractCoordinate('North_Bounding_Coordinate')
    const south = extractCoordinate('South_Bounding_Coordinate')

    if (![west, east, north, south].some((value) => Number.isNaN(value))) {
      bounds = [
        [Math.min(south, north), Math.min(west, east)],
        [Math.max(south, north), Math.max(west, east)]
      ]
    }
  }

  if (!bounds) {
    if (!tfwEntry) {
      throw new Error('FAA sectional ZIP missing georeference bounds metadata.')
    }

    const tfwText = String(tfwEntry.getData())
    const tfwValues = tfwText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((line) => Number(line))

    if (tfwValues.length < 6 || tfwValues.some((value) => Number.isNaN(value))) {
      throw new Error('FAA sectional TFW values are invalid.')
    }

    const [pixelSizeX, rotationY, rotationX, pixelSizeY, centerX, centerY] = tfwValues
    const west = centerX - pixelSizeX / 2 - rotationY / 2
    const north = centerY - rotationX / 2 - pixelSizeY / 2
    const east = west + pixelSizeX * width + rotationY * height
    const south = north + rotationX * width + pixelSizeY * height

    bounds = [
      [Math.min(south, north), Math.min(west, east)],
      [Math.max(south, north), Math.max(west, east)]
    ]
  }

  const imageBuffer = await image
    .resize({ width: 5000, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  const overlay = { image: imageBuffer, bounds }
  sectionalOverlayCache.set(source, overlay)
  return overlay
}

app.get('/api/sectionals/overlay-metadata', async (req, res) => {
  try {
    const source = String(req.query.source ?? '')
    if (!source.startsWith('https://aeronav.faa.gov/visual/')) {
      res.status(400).json({ error: 'Invalid FAA sectional source URL.' })
      return
    }

    const overlay = await buildSectionalOverlay(source)
    res.json({
      bounds: overlay.bounds,
      imageUrl: `/api/sectionals/overlay-image?source=${encodeURIComponent(source)}`
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/sectionals/overlay-image', async (req, res) => {
  try {
    const source = String(req.query.source ?? '')
    if (!source.startsWith('https://aeronav.faa.gov/visual/')) {
      res.status(400).json({ error: 'Invalid FAA sectional source URL.' })
      return
    }

    const overlay = await buildSectionalOverlay(source)
    res.setHeader('Content-Type', 'image/jpeg')
    res.send(overlay.image)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/winds-aloft', async (req, res) => {
  try {
    const depLat = Number(req.query.depLat)
    const depLon = Number(req.query.depLon)
    const arrLat = Number(req.query.arrLat)
    const arrLon = Number(req.query.arrLon)
    const altitudeFt = Number(req.query.altitudeFt)

    if ([depLat, depLon, arrLat, arrLon, altitudeFt].some((value) => Number.isNaN(value))) {
      res.status(400).json({ error: 'depLat, depLon, arrLat, arrLon, and altitudeFt are required.' })
      return
    }

    const [airports, stations] = await Promise.all([fetchAirportsDataset(), fetchWindsAloftStations()])
    const midpointLat = (depLat + arrLat) / 2
    const midpointLon = (depLon + arrLon) / 2

    const stationCandidates = stations
      .map((station) => {
        const matchedAirport = airports.find((airport) =>
          airport.iataCode === station.station ||
          airport.localCode === station.station ||
          airport.ident === `K${station.station}` ||
          airport.gpsCode === `K${station.station}`
        )

        if (!matchedAirport) {
          return null
        }

        const distanceNm = haversineNm(midpointLat, midpointLon, matchedAirport.lat, matchedAirport.lon)
        return {
          station: station.station,
          levels: station.levels,
          lat: matchedAirport.lat,
          lon: matchedAirport.lon,
          distanceNm
        }
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((a, b) => a.distanceNm - b.distanceNm)

    const bestStation = stationCandidates.find((candidate) => Object.keys(candidate.levels).length > 0)
    if (!bestStation) {
      res.status(404).json({ error: 'No winds aloft station found for route.' })
      return
    }

    const availableAltitudes = Object.keys(bestStation.levels).map((value) => Number(value)).sort((a, b) => a - b)
    const selectedAltitudeFt = availableAltitudes.sort((a, b) => Math.abs(a - altitudeFt) - Math.abs(b - altitudeFt))[0]
    const selected = bestStation.levels[selectedAltitudeFt]

    res.json({
      station: bestStation.station,
      stationLat: bestStation.lat,
      stationLon: bestStation.lon,
      stationDistanceNm: Number(bestStation.distanceNm.toFixed(1)),
      requestedAltitudeFt: altitudeFt,
      selectedAltitudeFt,
      direction: selected.direction,
      speed: selected.speed,
      temperatureC: selected.temperatureC
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/magnetic-variation', (req, res) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'lat and lon are required.' })
      return
    }

    const model = geomagnetism.model()
    const point = model.point([lat, lon])
    const declination = Number(point.decl.toFixed(2))

    res.json({
      declination,
      convention: 'East positive, West negative. Magnetic = True - declination.'
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/landmark-name', async (req, res) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'lat and lon are required.' })
      return
    }

    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`
    const cached = landmarkCache.get(cacheKey)
    if (cached && Date.now() - cached.loadedAt < 24 * 60 * 60 * 1000) {
      res.json(cached.result)
      return
    }

    const faaNearby = await findNearbyFaaWaypoint(lat, lon)
    const selected = faaNearby

    const result: LandmarkResult = selected
      ? { ident: selected.ident, label: selected.label, source: selected.source }
      : { ident: null, label: null, source: null }

    landmarkCache.set(cacheKey, {
      loadedAt: Date.now(),
      result
    })

    res.json(result)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
