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
  municipality: string | null
  isoRegion: string | null
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
  frequencyKhz: number | null
  dmeFrequencyKhz: number | null
}

type AirportFrequencyRecord = {
  airportIdent: string
  type: string
  description: string
  frequencyMHz: string
}

type RunwayRecord = {
  id: string
  airportIdent: string
  lengthFt: number | null
  widthFt: number | null
  surface: string | null
  lighted: boolean
  closed: boolean
  leIdent: string | null
  heIdent: string | null
  leHeadingDeg: number | null
  heHeadingDeg: number | null
}

type WaypointSuggestion = {
  ident: string
  name: string
  lat: number
  lon: number
  crossTrackNm: number
  progress: number
}

type ResolvedWaypointIdent = {
  inputIdent: string
  ident: string
  name: string
  lat: number
  lon: number
  source: 'airport' | 'navaid'
  navaidType: string | null
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

type AirportDiagram = {
  icao: string
  faa: string | null
  chartName: string
  pdfUrl: string
}

type TfrGeoJsonFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: {
      type: string
      coordinates: unknown
    } | null
    properties: Record<string, unknown>
  }>
}

let faaCache: { loadedAt: number; delays: FaaDelay[] } | null = null
let airportCache: { loadedAt: number; effectiveDate: string; airports: AirportRecord[] } | null = null
let navaidCache: { loadedAt: number; effectiveDate: string; navaids: NavaidRecord[] } | null = null
let airportFrequencyCache: { loadedAt: number; effectiveDate: string; frequencies: AirportFrequencyRecord[] } | null = null
let runwayCache: { loadedAt: number; effectiveDate: string; runways: RunwayRecord[] } | null = null
let sectionalCache: { loadedAt: number; sectionals: SectionalChart[] } | null = null
let windsAloftCache: { loadedAt: number; stations: WindsAloftStation[] } | null = null
let tfrCache: { loadedAt: number; data: TfrGeoJsonFeatureCollection } | null = null
const sectionalGeoTiffCache = new Map<string, Buffer>()
const sectionalOverlayCache = new Map<string, { image: Buffer; bounds: [[number, number], [number, number]] }>()
const nasrSubscriptionPageUrl = 'https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription'
const nasrZipBaseUrl = 'https://nfdc.faa.gov/webContent/28DaySub'

let nasrCycleCache: { loadedAt: number; effectiveDate: string; downloadUrl: string } | null = null
let nasrZipCache: { loadedAt: number; effectiveDate: string; zip: InstanceType<typeof AdmZip> } | null = null
type LandmarkResult = {
  ident: string | null
  label: string | null
  source: string | null
}

const landmarkCache = new Map<string, { loadedAt: number; result: LandmarkResult }>()
const airportDiagramCache = new Map<string, { loadedAt: number; diagram: AirportDiagram | null }>()

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

async function fetchTfrGeoJson(): Promise<TfrGeoJsonFeatureCollection> {
  const cacheWindowMs = 5 * 60 * 1000
  if (tfrCache && Date.now() - tfrCache.loadedAt < cacheWindowMs) {
    return tfrCache.data
  }

  const featureServiceQueryUrl = process.env.FAA_TFR_FEATURE_SERVICE_URL
    ?? 'https://services1.arcgis.com/fXHQyq63u0UsTeSM/arcgis/rest/services/FAA_TFR_AutoUpdate/FeatureServer/0/query'

  const queryUrl = `${featureServiceQueryUrl}?${new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'geojson'
  }).toString()}`

  const response = await fetch(queryUrl, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`TFR feed request failed (${response.status})`)
  }

  const parsed = await response.json() as TfrGeoJsonFeatureCollection
  const data: TfrGeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    features: Array.isArray(parsed?.features) ? parsed.features : []
  }

  tfrCache = {
    loadedAt: Date.now(),
    data
  }

  return data
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

function parseDmsCoordinate(value: string) {
  const text = value.trim().toUpperCase()
  const match = text.match(/^(\d{2,3})-(\d{2})-(\d{2}(?:\.\d+)?)\s*([NSEW])$/)
  if (!match) {
    return Number.NaN
  }

  const degrees = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const hemisphere = match[4]
  const decimal = degrees + minutes / 60 + seconds / 3600

  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal
}

function parseNumberOrNull(value: string) {
  const parsed = Number(value.trim())
  return Number.isNaN(parsed) ? null : parsed
}

function parseFreqMhzToKhz(value: string) {
  const text = value.trim()
  if (!text) {
    return null
  }

  const parsed = Number(text)
  if (Number.isNaN(parsed)) {
    return null
  }

  if (text.includes('.')) {
    return Math.round(parsed * 1000)
  }

  return parsed
}

async function fetchCurrentNasrCycle() {
  const cacheWindowMs = 6 * 60 * 60 * 1000
  if (nasrCycleCache && Date.now() - nasrCycleCache.loadedAt < cacheWindowMs) {
    return nasrCycleCache
  }

  const response = await fetch(nasrSubscriptionPageUrl)
  if (!response.ok) {
    throw new Error(`NASR subscription page request failed (${response.status})`)
  }

  const html = await response.text()
  const matches = [...html.matchAll(/28DaySubscription_Effective_(\d{4}-\d{2}-\d{2})\.zip/g)]
  const dates = [...new Set(matches.map((match) => match[1]))].sort()
  if (!dates.length) {
    throw new Error('Unable to determine current NASR cycle date from FAA subscription page.')
  }

  const today = new Date().toISOString().slice(0, 10)
  const currentOrPast = dates.filter((date) => date <= today)
  const effectiveDate = currentOrPast.length ? currentOrPast[currentOrPast.length - 1] : dates[0]
  const downloadUrl = `${nasrZipBaseUrl}/28DaySubscription_Effective_${effectiveDate}.zip`

  nasrCycleCache = {
    loadedAt: Date.now(),
    effectiveDate,
    downloadUrl
  }

  return nasrCycleCache
}

async function fetchNasrZip() {
  const cycle = await fetchCurrentNasrCycle()
  const cacheWindowMs = 6 * 60 * 60 * 1000

  if (
    nasrZipCache &&
    nasrZipCache.effectiveDate === cycle.effectiveDate &&
    Date.now() - nasrZipCache.loadedAt < cacheWindowMs
  ) {
    return { effectiveDate: nasrZipCache.effectiveDate, downloadUrl: cycle.downloadUrl, zip: nasrZipCache.zip }
  }

  const response = await fetch(cycle.downloadUrl)
  if (!response.ok) {
    throw new Error(`NASR subscription download failed (${response.status})`)
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer())
  const zip = new AdmZip(zipBuffer)

  nasrZipCache = {
    loadedAt: Date.now(),
    effectiveDate: cycle.effectiveDate,
    zip
  }

  return { effectiveDate: cycle.effectiveDate, downloadUrl: cycle.downloadUrl, zip }
}

function collectLatLonPairsFromGeometry(geometry: unknown) {
  const pairs: Array<{ lat: number; lon: number }> = []

  function walkCoordinates(value: unknown): void {
    if (!Array.isArray(value)) {
      return
    }

    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      pairs.push({ lon: value[0], lat: value[1] })
      return
    }

    for (const item of value) {
      walkCoordinates(item)
    }
  }

  if (typeof geometry !== 'object' || geometry == null) {
    return pairs
  }

  const coords = (geometry as { coordinates?: unknown }).coordinates
  walkCoordinates(coords)

  return pairs
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
    return { progress: 0, crossTrackNm: Number.POSITIVE_INFINITY, crossTrackSignedNm: 0 }
  }

  const progress = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
  const closestX = depX + progress * vx
  const closestY = depY + progress * vy
  const dx = pointX - closestX
  const dy = pointY - closestY
  const crossTrackNm = Math.sqrt(dx ** 2 + dy ** 2)
  const crossTrackSignedNm = (vx * dy - vy * dx) / Math.sqrt(len2)

  return { progress, crossTrackNm, crossTrackSignedNm }
}

async function fetchAirportsDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  const cycle = await fetchCurrentNasrCycle()
  if (
    airportCache &&
    airportCache.effectiveDate === cycle.effectiveDate &&
    Date.now() - airportCache.loadedAt < cacheWindowMs
  ) {
    return airportCache.airports
  }

  const { zip } = await fetchNasrZip()
  const aptText = zip.readAsText('APT.txt')
  const lines = aptText.split(/\r?\n/)

  const airports: AirportRecord[] = []
  for (const line of lines) {
    if (!line.startsWith('APT') || line.length < 1000) {
      continue
    }

    const ident = line.slice(27, 31).trim().toUpperCase()
    const name = line.slice(133, 183).trim()
    const city = line.slice(93, 133).trim()
    const state = line.slice(48, 50).trim().toUpperCase()
    const latText = line.slice(523, 538)
    const lonText = line.slice(550, 565)

    const lat = parseDmsCoordinate(latText)
    const lon = parseDmsCoordinate(lonText)

    if (!ident || !name || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue
    }

    airports.push({
      ident,
      name,
      municipality: city || null,
      isoRegion: state ? `US-${state}` : null,
      lat,
      lon,
      type: 'small_airport',
      isoCountry: 'US',
      iataCode: null,
      localCode: ident,
      gpsCode: ident
    })
  }

  airportCache = { loadedAt: Date.now(), effectiveDate: cycle.effectiveDate, airports }
  return airports
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function searchAirportsByQuery(query: string, airports: AirportRecord[]) {
  const normalizedQuery = normalizeSearchText(query)
  const uppercaseQuery = query.trim().toUpperCase()
  const queryCodeCandidates = getAirportCodeCandidates(uppercaseQuery)
  const tokens = normalizedQuery.split(' ').filter(Boolean)

  if (!normalizedQuery || !uppercaseQuery) {
    return []
  }

  return airports
    .filter((airport) => ['small_airport', 'medium_airport', 'large_airport', 'seaplane_base'].includes(airport.type))
    .map((airport) => {
      const ident = airport.ident.toUpperCase()
      const gps = airport.gpsCode?.toUpperCase() ?? ''
      const iata = airport.iataCode?.toUpperCase() ?? ''
      const local = airport.localCode?.toUpperCase() ?? ''
      const name = normalizeSearchText(airport.name)
      const city = normalizeSearchText(airport.municipality ?? '')
      const airportCodes = [ident, gps, iata, local].filter(Boolean)

      let score = 0

      if (queryCodeCandidates.some((candidate) => airportCodes.includes(candidate))) {
        score = 120
      } else if (
        queryCodeCandidates.some((candidate) =>
          airportCodes.some((value) => value.startsWith(candidate))
        )
      ) {
        score = 95
      } else if (name.startsWith(normalizedQuery)) {
        score = 80
      } else if (city.startsWith(normalizedQuery)) {
        score = 75
      } else if (name.includes(normalizedQuery)) {
        score = 68
      } else if (city.includes(normalizedQuery)) {
        score = 63
      }

      if (tokens.length > 1) {
        const tokenMatches = tokens.filter((token) => name.includes(token) || city.includes(token)).length
        if (tokenMatches === tokens.length) {
          score = Math.max(score, 56 + tokenMatches)
        }
      }

      if (score <= 0) {
        return null
      }

      const state = airport.isoRegion?.startsWith('US-') ? airport.isoRegion.slice(3) : null

      return {
        ident,
        name: airport.name,
        city: airport.municipality,
        state,
        lat: airport.lat,
        lon: airport.lon,
        type: airport.type,
        score
      }
    })
    .filter((value): value is {
      ident: string
      name: string
      city: string | null
      state: string | null
      lat: number
      lon: number
      type: string
      score: number
    } => Boolean(value))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }

      return a.name.localeCompare(b.name)
    })
    .slice(0, 12)
    .map(({ score, ...airport }) => airport)
}

async function fetchNavaidsDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  const cycle = await fetchCurrentNasrCycle()
  if (
    navaidCache &&
    navaidCache.effectiveDate === cycle.effectiveDate &&
    Date.now() - navaidCache.loadedAt < cacheWindowMs
  ) {
    return navaidCache.navaids
  }

  const { zip } = await fetchNasrZip()
  const navText = zip.readAsText('NAV.txt')
  const lines = navText.split(/\r?\n/)

  const navaids: NavaidRecord[] = []
  for (const line of lines) {
    if (!line.startsWith('NAV1') || line.length < 560) {
      continue
    }

    const ident = line.slice(4, 8).trim().toUpperCase()
    const type = line.slice(8, 28).trim().toUpperCase()
    const name = line.slice(42, 72).trim()
    const lat = parseDmsCoordinate(line.slice(371, 385))
    const lon = parseDmsCoordinate(line.slice(396, 410))
    const frequencyKhz = parseFreqMhzToKhz(line.slice(533, 539))
    const dmeFrequencyKhz = parseFreqMhzToKhz(line.slice(529, 533))

    if (!ident || !name || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue
    }

    navaids.push({
      ident,
      name,
      type,
      lat,
      lon,
      frequencyKhz,
      dmeFrequencyKhz
    })
  }

  navaidCache = { loadedAt: Date.now(), effectiveDate: cycle.effectiveDate, navaids }
  return navaids
}

async function fetchAirportFrequenciesDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  const cycle = await fetchCurrentNasrCycle()
  if (
    airportFrequencyCache &&
    airportFrequencyCache.effectiveDate === cycle.effectiveDate &&
    Date.now() - airportFrequencyCache.loadedAt < cacheWindowMs
  ) {
    return airportFrequencyCache.frequencies
  }

  const { zip } = await fetchNasrZip()
  const aptText = zip.readAsText('APT.txt')
  const lines = aptText.split(/\r?\n/)
  const airportIdentBySiteKey = new Map<string, string>()
  const knownAirportIdents = new Set<string>()

  const inferCommType = (text: string) => {
    const normalized = text.toUpperCase()
    if (normalized.includes('AWOS')) return 'AWOS'
    if (normalized.includes('ASOS')) return 'ASOS'
    if (normalized.includes('ATIS')) return 'ATIS'
    if (normalized.includes('CTAF')) return 'CTAF'
    if (normalized.includes('UNICOM') || normalized.includes('UNIC ')) return 'UNICOM'
    if (normalized.includes('MULTICOM')) return 'MULTICOM'
    if (normalized.includes('TOWER') || normalized.includes(' TWR')) return 'TWR'
    if (normalized.includes('GROUND') || normalized.includes(' GND')) return 'GND'
    if (normalized.includes('APPROACH') || normalized.includes(' APP')) return 'APP'
    if (normalized.includes('DEPARTURE') || normalized.includes(' DEP')) return 'DEP'
    if (normalized.includes('CLEARANCE') || normalized.includes('CLNC')) return 'CLNC'
    if (normalized.includes('FSS') || normalized.includes('RDO')) return 'FSS'
    return null
  }

  const commFrequencyRegex = /\b1(?:1[8-9]|2\d|3[0-6])\.\d{1,3}\b/g

  const frequencies: AirportFrequencyRecord[] = []
  for (const line of lines) {
    if (!line.startsWith('APT') || line.length < 1000) {
      continue
    }

    const siteKey = line.slice(3, 14).trim()
    const airportIdent = line.slice(27, 31).trim().toUpperCase()
    const unicom = line.slice(981, 988).trim()
    const ctaf = line.slice(988, 995).trim()

    if (!airportIdent) {
      continue
    }

    knownAirportIdents.add(airportIdent)

    if (siteKey) {
      airportIdentBySiteKey.set(siteKey, airportIdent)
    }

    if (unicom) {
      frequencies.push({
        airportIdent,
        type: 'UNICOM',
        description: 'UNICOM',
        frequencyMHz: unicom
      })
    }

    if (ctaf) {
      frequencies.push({
        airportIdent,
        type: 'CTAF',
        description: 'Common Traffic Advisory Frequency',
        frequencyMHz: ctaf
      })
    }
  }

  for (const line of lines) {
    if (!line.startsWith('RMK') || line.length < 32) {
      continue
    }

    const siteKey = line.slice(3, 14).trim()
    const airportIdent = airportIdentBySiteKey.get(siteKey)
    if (!airportIdent) {
      continue
    }

    const remarkElement = line.slice(16, 31).trim()
    const remarkText = line.slice(31).trim()
    const combinedRemark = `${remarkElement} ${remarkText}`.trim()
    const frequencyType = inferCommType(combinedRemark)
    if (!frequencyType) {
      continue
    }

    const matches = [...combinedRemark.matchAll(commFrequencyRegex)]
    for (const match of matches) {
      const rawFrequency = match[0]
      const parsed = Number(rawFrequency)
      if (Number.isNaN(parsed)) {
        continue
      }

      frequencies.push({
        airportIdent,
        type: frequencyType,
        description: frequencyType,
        frequencyMHz: parsed.toFixed(3)
      })
    }
  }

  const twrEntry = zip.getEntry('TWR.txt')
  if (twrEntry) {
    const twrText = zip.readAsText('TWR.txt')
    const twrLines = twrText.split(/\r?\n/)

    for (const line of twrLines) {
      if (!line.startsWith('TWR7') || line.length < 117) {
        continue
      }

      const satelliteFrequencyText = line.slice(8, 52)
      const satelliteUseText = line.slice(52, 102).trim()
      const satelliteSiteKey = line.slice(102, 113).trim()
      const satelliteIdent = line.slice(113, 117).trim().toUpperCase()

      const airportIdent = knownAirportIdents.has(satelliteIdent)
        ? satelliteIdent
        : airportIdentBySiteKey.get(satelliteSiteKey) ?? null

      if (!airportIdent) {
        continue
      }

      const frequencyType = inferCommType(satelliteUseText) ?? 'APP'
      const frequencyMatches = [...satelliteFrequencyText.toUpperCase().matchAll(commFrequencyRegex)]
      for (const match of frequencyMatches) {
        const rawFrequency = match[0]
        const parsed = Number(rawFrequency)
        if (Number.isNaN(parsed)) {
          continue
        }

        frequencies.push({
          airportIdent,
          type: frequencyType,
          description: satelliteUseText || 'TWR7 satellite service',
          frequencyMHz: parsed.toFixed(3)
        })
      }
    }
  }

  const supplementalFiles: Array<{ name: string; defaultType: string }> = [
    { name: 'COM.txt', defaultType: 'RDO' },
    { name: 'FSS.txt', defaultType: 'FSS' },
    { name: 'AWOS.txt', defaultType: 'AWOS' },
    { name: 'WXL.txt', defaultType: 'ASOS' }
  ]

  for (const { name, defaultType } of supplementalFiles) {
    const entry = zip.getEntry(name)
    if (!entry) {
      continue
    }

    const text = zip.readAsText(name)
    const supplementalLines = text.split(/\r?\n/)

    for (const line of supplementalLines) {
      if (!line.trim()) {
        continue
      }

      const upper = line.toUpperCase()
      const frequencyMatches = [...upper.matchAll(commFrequencyRegex)]
      if (!frequencyMatches.length) {
        continue
      }

      const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean)
      const airportIdent = tokens.find((token: string) => knownAirportIdents.has(token)) ?? null
      if (!airportIdent) {
        continue
      }

      const frequencyType = inferCommType(upper) ?? defaultType
      for (const match of frequencyMatches) {
        const rawFrequency = match[0]
        const parsed = Number(rawFrequency)
        if (Number.isNaN(parsed)) {
          continue
        }

        frequencies.push({
          airportIdent,
          type: frequencyType,
          description: frequencyType,
          frequencyMHz: parsed.toFixed(3)
        })
      }
    }
  }

  airportFrequencyCache = { loadedAt: Date.now(), effectiveDate: cycle.effectiveDate, frequencies }
  return frequencies
}

async function fetchRunwaysDataset() {
  const cacheWindowMs = 24 * 60 * 60 * 1000
  const cycle = await fetchCurrentNasrCycle()
  if (
    runwayCache &&
    runwayCache.effectiveDate === cycle.effectiveDate &&
    Date.now() - runwayCache.loadedAt < cacheWindowMs
  ) {
    return runwayCache.runways
  }

  const { zip } = await fetchNasrZip()
  const aptText = zip.readAsText('APT.txt')
  const lines = aptText.split(/\r?\n/)
  const airportIdentByKey = new Map<string, string>()

  for (const line of lines) {
    if (!line.startsWith('APT') || line.length < 32) {
      continue
    }

    const parentKey = line.slice(3, 11)
    const ident = line.slice(27, 31).trim().toUpperCase()
    if (parentKey && ident) {
      airportIdentByKey.set(parentKey, ident)
    }
  }

  const runways: RunwayRecord[] = []
  for (const line of lines) {
    if (!line.startsWith('RWY') || line.length < 120) {
      continue
    }

    const parentKey = line.slice(3, 11)
    const airportIdent = airportIdentByKey.get(parentKey) ?? ''
    const runwayIdent = line.slice(16, 23).trim().toUpperCase()
    if (!airportIdent || !runwayIdent) {
      continue
    }

    const [leIdent, heIdent] = runwayIdent.split('/').map((value: string) => value.trim() || null)
    const lengthFt = parseNumberOrNull(line.slice(24, 28))
    const widthFt = parseNumberOrNull(line.slice(29, 32))
    const surface = line.slice(32, 44).trim() || null
    const lighting = line.slice(44, 60).trim().toUpperCase()
    const lighted = lighting.includes('MED') || lighting.includes('HIGH') || lighting.includes('LOW')
    const closed = line.includes('CLSD')

    runways.push({
      id: `${airportIdent}-${runwayIdent}`,
      airportIdent,
      lengthFt,
      widthFt,
      surface,
      lighted,
      closed,
      leIdent,
      heIdent,
      leHeadingDeg: null,
      heHeadingDeg: null
    })
  }

  runwayCache = { loadedAt: Date.now(), effectiveDate: cycle.effectiveDate, runways }
  return runways
}

function rankFrequencyType(type: string) {
  const order = [
    'ATIS',
    'AWOS',
    'ASOS',
    'CTAF',
    'UNIC',
    'TWR',
    'GND',
    'CLNC',
    'APP',
    'DEP',
    'RDO',
    'FSS'
  ]

  const index = order.findIndex((item) => type.startsWith(item))
  return index === -1 ? order.length : index
}

function isMilitaryFrequency(type: string, description: string, frequencyMHzText: string) {
  const normalizedType = type.toUpperCase()
  const normalizedDescription = description.toUpperCase()
  const frequencyMHz = Number(frequencyMHzText)

  if (normalizedType.includes('MIL') || normalizedDescription.includes('MILITARY')) {
    return true
  }

  if (normalizedDescription.includes('UHF') || normalizedDescription.includes('TACAN')) {
    return true
  }

  if (!Number.isNaN(frequencyMHz) && frequencyMHz >= 137) {
    return true
  }

  return false
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

function resolveWaypointIdentInDatasets(
  ident: string,
  airports: AirportRecord[],
  navaids: NavaidRecord[]
): ResolvedWaypointIdent | null {
  const normalized = ident.toUpperCase().trim()
  if (!normalized) {
    return null
  }

  const airport = findAirportInDataset(normalized, airports)
  if (airport) {
    return {
      inputIdent: normalized,
      ident: airport.ident.toUpperCase(),
      name: airport.name,
      lat: airport.lat,
      lon: airport.lon,
      source: 'airport',
      navaidType: null
    }
  }

  const navaid = navaids.find((candidate) => candidate.ident.toUpperCase() === normalized)
  if (navaid) {
    return {
      inputIdent: normalized,
      ident: navaid.ident.toUpperCase(),
      name: navaid.name,
      lat: navaid.lat,
      lon: navaid.lon,
      source: 'navaid',
      navaidType: navaid.type
    }
  }

  return null
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

async function fetchAirportDiagram(icaoCode: string) {
  const normalized = icaoCode.toUpperCase().trim()
  const cacheWindowMs = 12 * 60 * 60 * 1000
  const cached = airportDiagramCache.get(normalized)
  if (cached && Date.now() - cached.loadedAt < cacheWindowMs) {
    return cached.diagram
  }

  const resolved = await resolveAirport(normalized)
  const candidates = [
    resolved.station?.icaoId,
    resolved.dataset?.gpsCode,
    resolved.dataset?.ident,
    resolved.inputCode
  ]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase())

  let selected: AirportDiagram | null = null

  for (const candidate of candidates) {
    const payload = await fetchJson<Record<string, Array<{
      chart_code?: string
      chart_name?: string
      pdf_path?: string
      icao_ident?: string
      faa_ident?: string
    }>>>(`https://api.aviationapi.com/v1/charts?apt=${candidate}&group=2`)

    const rows = payload[candidate] ?? []
    const diagram = rows.find((row) => row.chart_code === 'APD' && row.pdf_path)
    if (!diagram?.pdf_path) {
      continue
    }

    selected = {
      icao: (diagram.icao_ident ?? candidate).toUpperCase(),
      faa: diagram.faa_ident?.toUpperCase() ?? resolved.station?.faaId?.toUpperCase() ?? null,
      chartName: diagram.chart_name ?? 'Airport Diagram',
      pdfUrl: diagram.pdf_path
    }
    break
  }

  airportDiagramCache.set(normalized, {
    loadedAt: Date.now(),
    diagram: selected
  })

  return selected
}

function toMorsePattern(value: string) {
  const morseMap: Record<string, string> = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
    6: '-....', 7: '--...', 8: '---..', 9: '----.'
  }

  return value
    .toUpperCase()
    .split('')
    .map((char) => morseMap[char] ?? '')
    .filter(Boolean)
    .join(' ')
}

const routeNavaidTypeOptions = ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'] as const

function selectRouteNavaids(
  routePoints: Array<{ lat: number; lon: number }>,
  navaids: NavaidRecord[],
  includedTypes: string[] = [...routeNavaidTypeOptions]
) {
  if (routePoints.length < 2) {
    return []
  }

  const allowedTypes = new Set(includedTypes.length > 0 ? includedTypes : routeNavaidTypeOptions)
  const byIdent = new Map<string, {
    ident: string
    name: string
    type: string
    frequencyKhz: number | null
    dmeFrequencyKhz: number | null
    morse: string
    closestDistanceNm: number
    offRouteDirection: 'left' | 'right' | 'center'
    legIndex: number
  }>()

  for (let legIndex = 0; legIndex < routePoints.length - 1; legIndex += 1) {
    const dep = routePoints[legIndex]
    const arr = routePoints[legIndex + 1]

    const legCandidates = navaids
      .filter((navaid) => allowedTypes.has(navaid.type))
      .filter((navaid) => navaid.frequencyKhz != null)
      .map((navaid) => {
        const projection = routeProjection(dep.lat, dep.lon, arr.lat, arr.lon, navaid.lat, navaid.lon)
        return {
          ...navaid,
          progress: projection.progress,
          crossTrackNm: projection.crossTrackNm,
          crossTrackSignedNm: projection.crossTrackSignedNm
        }
      })
      .filter((candidate) => candidate.progress >= 0 && candidate.progress <= 1)
      .filter((candidate) => candidate.crossTrackNm <= 30)
      .sort((a, b) => a.crossTrackNm - b.crossTrackNm)
      .slice(0, 6)

    for (const candidate of legCandidates) {
      const existing = byIdent.get(candidate.ident)
      if (!existing || candidate.crossTrackNm < existing.closestDistanceNm) {
        byIdent.set(candidate.ident, {
          ident: candidate.ident,
          name: candidate.name,
          type: candidate.type,
          frequencyKhz: candidate.frequencyKhz,
          dmeFrequencyKhz: candidate.dmeFrequencyKhz,
          morse: toMorsePattern(candidate.ident),
          closestDistanceNm: Number(candidate.crossTrackNm.toFixed(1)),
          offRouteDirection:
            Math.abs(candidate.crossTrackSignedNm) < 0.05
              ? 'center'
              : candidate.crossTrackSignedNm > 0
                ? 'left'
                : 'right',
          legIndex: legIndex + 1
        })
      }
    }
  }

  return [...byIdent.values()]
    .sort((a, b) => a.legIndex - b.legIndex || a.closestDistanceNm - b.closestDistanceNm)
    .slice(0, 16)
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

app.get('/api/data-cycle', async (_req, res) => {
  try {
    const cycle = await fetchCurrentNasrCycle()
    res.json({
      source: 'FAA NASR 28-Day Subscription',
      effectiveDate: cycle.effectiveDate,
      downloadUrl: cycle.downloadUrl
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/airport/nearest', async (req, res) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'lat and lon query params are required.' })
      return
    }

    const airports = await fetchAirportsDataset()
    const candidates = airports
      .filter((airport) => airport.isoCountry === 'US' && airport.ident && airport.lat && airport.lon)
      .map((airport) => ({
        airport,
        distanceNm: haversineNm(lat, lon, airport.lat, airport.lon)
      }))
      .sort((a, b) => a.distanceNm - b.distanceNm)

    const nearest = candidates[0]
    if (!nearest) {
      res.status(404).json({ error: 'No nearby airport found.' })
      return
    }

    const resolved = await resolveAirport(nearest.airport.ident)
    const station = resolved.station
    const dataset = resolved.dataset ?? nearest.airport
    const faaDelays = await fetchFaaDelays()

    const delayCandidates = [
      station?.faaId,
      station?.iataId,
      station?.icaoId,
      station?.icaoId?.replace(/^K/, ''),
      dataset?.ident,
      dataset?.localCode,
      dataset?.iataCode,
      dataset?.gpsCode,
    ]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase())

    const matchingDelays = faaDelays.filter((delay) => delayCandidates.includes(delay.airportCode))

    res.json({
      airport: {
        icao: station?.icaoId ?? dataset?.gpsCode ?? dataset?.ident,
        iata: station?.iataId ?? dataset?.iataCode ?? null,
        faa: station?.faaId ?? dataset?.localCode ?? null,
        name: station?.site ?? dataset?.name,
        lat: station?.lat ?? dataset?.lat,
        lon: station?.lon ?? dataset?.lon,
        elevationMeters: station?.elev ?? null,
        state: station?.state ?? (dataset?.isoRegion?.startsWith('US-') ? dataset.isoRegion.slice(3) : null),
        country: station?.country ?? dataset?.isoCountry ?? null
      },
      distanceNm: Number(nearest.distanceNm.toFixed(1)),
      faa: {
        hasDelay: matchingDelays.length > 0,
        delays: matchingDelays
      }
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
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
        state: station?.state ?? (dataset?.isoRegion?.startsWith('US-') ? dataset.isoRegion.slice(3) : null),
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

app.get('/api/frequencies/:icao', async (req, res) => {
  try {
    const resolved = await resolveAirport(req.params.icao)
    const allFrequencies = await fetchAirportFrequenciesDataset()

    const candidates = [
      resolved.station?.icaoId,
      resolved.station?.faaId,
      resolved.station?.iataId,
      resolved.station?.icaoId?.replace(/^K/, ''),
      resolved.dataset?.ident,
      resolved.dataset?.gpsCode,
      resolved.dataset?.localCode,
      resolved.dataset?.iataCode,
      resolved.inputCode
    ]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase())

    const matches = allFrequencies
      .filter((frequency) => candidates.includes(frequency.airportIdent))
      .filter((frequency) => !isMilitaryFrequency(frequency.type, frequency.description, frequency.frequencyMHz))
      .map((frequency) => ({
        type: frequency.type,
        description: frequency.description,
        frequencyMHz: frequency.frequencyMHz,
        airportIdent: frequency.airportIdent
      }))

    const deduped = matches.filter((item, index, array) =>
      array.findIndex((candidate) =>
        candidate.type === item.type &&
        candidate.description === item.description &&
        candidate.frequencyMHz === item.frequencyMHz
      ) === index
    )

    const frequencies = deduped
      .sort((a, b) => {
        const typeDelta = rankFrequencyType(a.type) - rankFrequencyType(b.type)
        if (typeDelta !== 0) {
          return typeDelta
        }
        return Number(a.frequencyMHz) - Number(b.frequencyMHz)
      })
      .slice(0, 18)

    res.json({ frequencies })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/runways/:icao', async (req, res) => {
  try {
    const resolved = await resolveAirport(req.params.icao)
    const allRunways = await fetchRunwaysDataset()

    const candidates = [
      resolved.station?.icaoId,
      resolved.station?.faaId,
      resolved.station?.iataId,
      resolved.station?.icaoId?.replace(/^K/, ''),
      resolved.dataset?.ident,
      resolved.dataset?.gpsCode,
      resolved.dataset?.localCode,
      resolved.dataset?.iataCode,
      resolved.inputCode
    ]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase())

    const runways = allRunways
      .filter((runway) => candidates.includes(runway.airportIdent))
      .sort((a, b) => {
        const aLength = a.lengthFt ?? 0
        const bLength = b.lengthFt ?? 0
        return bLength - aLength
      })
      .slice(0, 16)

    res.json({ runways })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/notams/:icao', async (req, res) => {
  try {
    const resolved = await resolveAirport(req.params.icao)
    const lat = resolved.station?.lat ?? resolved.dataset?.lat ?? null
    const lon = resolved.station?.lon ?? resolved.dataset?.lon ?? null

    if (lat == null || lon == null) {
      res.json({ notams: [] })
      return
    }

    const tfrs = await fetchTfrGeoJson()
    const notams = tfrs.features
      .map((feature) => {
        const properties = feature.properties ?? {}
        const points = collectLatLonPairsFromGeometry(feature.geometry)
        const distanceNm = points.length
          ? Math.min(...points.map((point) => haversineNm(lat, lon, point.lat, point.lon)))
          : null

        return {
          id: String(properties.NOTAM_KEY ?? properties.GID ?? properties.NAME ?? 'TFR'),
          title: String(properties.TITLE ?? properties.NAME ?? 'Temporary Flight Restriction'),
          type: String(properties.TYPE_CODE ?? properties.TYPE ?? 'TFR'),
          source: 'FAA TFR',
          effective: properties.DATE_START ? String(properties.DATE_START) : null,
          expires: properties.DATE_END ? String(properties.DATE_END) : null,
          lastUpdated: properties.LAST_MODIFICATION_DATETIME
            ? String(properties.LAST_MODIFICATION_DATETIME)
            : properties.NOTEBOOK_UPDATE_DATETIME
              ? String(properties.NOTEBOOK_UPDATE_DATETIME)
              : null,
          distanceNm
        }
      })
      .filter((item) => item.distanceNm == null || item.distanceNm <= 150)
      .sort((a, b) => (a.distanceNm ?? Number.POSITIVE_INFINITY) - (b.distanceNm ?? Number.POSITIVE_INFINITY))
      .slice(0, 25)

    res.json({ notams })
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

app.get('/api/waypoints/resolve', async (req, res) => {
  try {
    const rawIdents = String(req.query.idents ?? '').trim()
    if (!rawIdents) {
      res.json({ waypoints: [] })
      return
    }

    const idents = rawIdents
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 50)

    if (!idents.length) {
      res.json({ waypoints: [] })
      return
    }

    const [airports, navaids] = await Promise.all([fetchAirportsDataset(), fetchNavaidsDataset()])
    const waypoints = idents
      .map((ident) => resolveWaypointIdentInDatasets(ident, airports, navaids))
      .filter((value): value is ResolvedWaypointIdent => Boolean(value))

    res.json({ waypoints })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/airports/search', async (req, res) => {
  try {
    const query = String(req.query.q ?? '').trim()
    if (query.length < 2) {
      res.json({ airports: [] })
      return
    }

    const airports = await fetchAirportsDataset()
    const matches = searchAirportsByQuery(query, airports)

    res.json({ airports: matches })
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

app.get('/api/navaids/route', async (req, res) => {
  try {
    const rawPoints = String(req.query.points ?? '').trim()
    const rawTypes = String(req.query.types ?? '').trim()
    if (!rawPoints) {
      res.status(400).json({ error: 'points query is required.' })
      return
    }

    const routePoints = rawPoints
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [latText, lonText] = pair.split(',').map((value) => value.trim())
        const lat = Number(latText)
        const lon = Number(lonText)
        return { lat, lon }
      })
      .filter((point) => !Number.isNaN(point.lat) && !Number.isNaN(point.lon))

    if (routePoints.length < 2) {
      res.status(400).json({ error: 'At least two valid points are required.' })
      return
    }

    const navaids = await fetchNavaidsDataset()
    const requestedTypes = rawTypes
      ? rawTypes
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
      : [...routeNavaidTypeOptions]

    const includedTypes = requestedTypes.filter((type, index) =>
      routeNavaidTypeOptions.includes(type as (typeof routeNavaidTypeOptions)[number]) && requestedTypes.indexOf(type) === index
    )

    const routeNavaids = selectRouteNavaids(routePoints, navaids, includedTypes)

    res.json({ navaids: routeNavaids })
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

app.get('/api/airport-diagram/by-airport/:icao', async (req, res) => {
  try {
    const diagram = await fetchAirportDiagram(req.params.icao)
    if (!diagram) {
      res.json({ diagram: null })
      return
    }

    res.json({
      diagram: {
        ...diagram,
        proxiedPdfUrl: `/api/airport-diagram/pdf?source=${encodeURIComponent(diagram.pdfUrl)}`
      }
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.get('/api/airport-diagram/pdf', async (req, res) => {
  try {
    const source = String(req.query.source ?? '')
    if (!source.startsWith('https://charts.aviationapi.com/')) {
      res.status(400).json({ error: 'Invalid airport diagram source URL.' })
      return
    }

    const upstream = await fetch(source)
    if (!upstream.ok) {
      res.status(502).json({ error: `Airport diagram PDF request failed (${upstream.status})` })
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

app.get('/api/tfrs', async (_req, res) => {
  try {
    const data = await fetchTfrGeoJson()
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
