import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { defaultFaaChartLayerId, faaCharts } from './config/faaCharts'
import { AiDrawer } from './components/AiDrawer'
import { BriefCard } from './components/BriefCard'
import { AirportDiagramsLayer } from './map/AirportDiagramsLayer'
import { airportBrief, decodeMetarBrief, decodeMosBrief, decodeTafBrief, explainAirspace } from './services/briefApi'
import type { AiAskContext } from './services/aiContextApi'

type BaseMapStyle = 'light' | 'dark'

type BaseMapLayer = {
  id: BaseMapStyle
  name: string
  tileUrl: string
  attribution: string
  maxZoom: number
}

const baseMapLayers: BaseMapLayer[] = [
  {
    id: 'light',
    name: 'Light',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  },
  {
    id: 'dark',
    name: 'Dark',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20
  }
]

type AirportResponse = {
  airport: {
    icao: string
    iata: string | null
    faa: string | null
    name: string
    lat: number
    lon: number
    elevationMeters: number | null
    state: string | null
    country: string | null
  }
  faa: {
    hasDelay: boolean
    delays: Array<{
      airportCode: string
      reason: string
      type: string
      minMinutes: string
      maxMinutes: string
      trend: string
    }>
  }
}

type NearestAirportResponse = AirportResponse & {
  distanceNm: number
}

type AirportSearchResult = {
  ident: string
  name: string
  city: string | null
  state: string | null
  lat: number
  lon: number
  type: string
}

type WeatherResponse = {
  metar: {
    rawOb?: string
    reportTime?: string
    temp?: number | null
    dewp?: number | null
    wdir?: number | null
    wspd?: number | null
    visib?: string | null
    altim?: number | null
    clouds?: Array<{
      cover: string
      base?: number | null
    }> | null
  } | null
  taf: { rawTAF?: string; issueTime?: string } | null
  mos?: {
    station?: string | null
    mavRaw?: string | null
    mexRaw?: string | null
    metRaw?: string | null
  } | null
  sourceStation?: string | null
  fallbackUsed?: boolean
  nearestReportingStation?: {
    icao: string
    name: string
    lat: number
    lon: number
    distanceNm: number
  } | null
}

type FrequencyResponse = {
  frequencies: Array<{
    type: string
    description: string
    frequencyMHz: string
    airportIdent: string
  }>
}

type SuggestedWaypoint = {
  ident: string
  name: string
  lat: number
  lon: number
  crossTrackNm: number
  progress: number
}

type WindsAloftResponse = {
  station: string
  stationLat: number
  stationLon: number
  stationDistanceNm: number
  requestedAltitudeFt: number
  selectedAltitudeFt: number
  direction: number | null
  speed: number
  temperatureC: number | null
}

type MagneticVariationResponse = {
  declination: number
  convention: string
}

type AirportDiagramResponse = {
  diagram: {
    icao: string
    faa: string | null
    chartName: string
    pdfUrl: string
    proxiedPdfUrl: string
  } | null
}

type RunwayResponse = {
  runways: Array<{
    id: string
    lengthFt: number | null
    widthFt: number | null
    surface: string | null
    lighted: boolean
    closed: boolean
    leIdent: string | null
    heIdent: string | null
    leHeadingDeg: number | null
    heHeadingDeg: number | null
  }>
}

type DataCycleResponse = {
  source: string
  effectiveDate: string
  downloadUrl: string
}

type AirportNotamsResponse = {
  notams: Array<{
    id: string
    title: string
    type: string
    source: string
    effective: string | null
    expires: string | null
    lastUpdated: string | null
    distanceNm: number | null
  }>
}

type AirportNotam = AirportNotamsResponse['notams'][number]

type PrintableDiagram = {
  role: 'Departure' | 'Arrival'
  airportIcao: string
  chartName: string
  pdfUrl: string | null
  imageUrl: string | null
  source: 'faa' | 'generated'
}

type DiagramFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: {
      type: string
      coordinates: unknown
    }
    properties: Record<string, unknown>
  }>
}

type GeneratedAirportDiagramResponse = {
  airport: {
    ident: string
    name: string
    arp: [number, number]
  }
  runways: DiagramFeatureCollection
  runwayLabels: DiagramFeatureCollection
  overlays: DiagramFeatureCollection
  schematic: {
    apron: DiagramFeatureCollection
    taxi: DiagramFeatureCollection
  }
}

type RouteNavaid = {
  ident: string
  name: string
  type: string
  frequencyKhz: number | null
  dmeFrequencyKhz: number | null
  morse: string
  closestDistanceNm: number
  offRouteDirection?: 'left' | 'right' | 'center'
  legIndex: number
}

type MapAirportTab = 'weather' | 'general' | 'winds' | 'frequencies' | 'runways' | 'charts' | 'notams'
type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | 'Unknown'

type LandmarkNameResponse = {
  ident: string | null
  label: string | null
  source: string | null
}

type ResolvedWaypoint = {
  inputIdent: string
  ident: string
  name: string
  lat: number
  lon: number
  source: 'airport' | 'navaid'
  navaidType: string | null
}

type WaypointResolveResponse = {
  waypoints: ResolvedWaypoint[]
}

type WaypointChip = {
  key: string
  label: string
  detail: string
  status: 'resolved' | 'manual' | 'unknown' | 'invalid'
}

type Point = {
  ident: string
  lat: number
  lon: number
  originalIdent?: string
  originalLat?: number
  originalLon?: number
}

type Leg = {
  from: string
  to: string
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  distanceNm: number
  trueCourse: number
  windDirection: number | null
  windSpeed: number
  windStation: string
  magneticVariation: number
  windCorrection: number
  trueHeading: number
  magneticHeading: number
  compassHeading: number
  groundSpeed: number
  eteMinutes: number
  fuelGallons: number
}

type TfrFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: unknown
    properties: Record<string, unknown>
  }>
}

type LoadTelemetryEntry = {
  id: number
  label: string
  durationMs: number
  status: 'ok' | 'error'
}

const routeNavaidTypeOptions = ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'] as const
const mapAirportTabs: Array<{ id: MapAirportTab; label: string }> = [
  { id: 'weather', label: 'Weather' },
  { id: 'general', label: 'General' },
  { id: 'winds', label: 'Winds' },
  { id: 'frequencies', label: 'Freqs' },
  { id: 'runways', label: 'Runways' },
  { id: 'charts', label: 'Charts' },
  { id: 'notams', label: 'NOTAMs' }
]

function toRad(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDeg(radians: number) {
  return (radians * 180) / Math.PI
}

function normalizeHeading(degrees: number) {
  const normalized = degrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function lonLatToMercatorPoint(lon: number, lat: number) {
  const earthRadiusMeters = 6378137
  const x = (lon * Math.PI * earthRadiusMeters) / 180
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const y = earthRadiusMeters * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return { x, y }
}

function geometryToPaths(geometry: { type: string; coordinates: unknown }) {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates as Array<[number, number]>]
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates as Array<Array<[number, number]>>
  }

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as Array<Array<[number, number]>>
    return rings.length ? [rings[0]] : []
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates as Array<Array<Array<[number, number]>>>
    return polygons
      .map((polygon) => polygon[0])
      .filter((ring): ring is Array<[number, number]> => Boolean(ring?.length))
  }

  return []
}

function renderGeneratedDiagramToImage(diagram: GeneratedAirportDiagramResponse) {
  const width = 1200
  const height = 900
  const padding = 52
  const mercatorPoints: Array<{ x: number; y: number }> = []

  const addGeometryBounds = (collection: DiagramFeatureCollection) => {
    collection.features.forEach((feature) => {
      const paths = geometryToPaths(feature.geometry)
      paths.forEach((path) => {
        path.forEach(([lon, lat]) => {
          mercatorPoints.push(lonLatToMercatorPoint(lon, lat))
        })
      })

      if (feature.geometry.type === 'Point') {
        const [lon, lat] = feature.geometry.coordinates as [number, number]
        mercatorPoints.push(lonLatToMercatorPoint(lon, lat))
      }
    })
  }

  addGeometryBounds(diagram.runways)
  addGeometryBounds(diagram.overlays)
  addGeometryBounds(diagram.schematic.apron)
  addGeometryBounds(diagram.schematic.taxi)
  addGeometryBounds(diagram.runwayLabels)

  if (!mercatorPoints.length) {
    return null
  }

  const minX = Math.min(...mercatorPoints.map((point) => point.x))
  const maxX = Math.max(...mercatorPoints.map((point) => point.x))
  const minY = Math.min(...mercatorPoints.map((point) => point.y))
  const maxY = Math.max(...mercatorPoints.map((point) => point.y))

  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)

  const project = (lon: number, lat: number) => {
    const point = lonLatToMercatorPoint(lon, lat)
    return {
      x: padding + (point.x - minX) * scale,
      y: height - (padding + (point.y - minY) * scale)
    }
  }

  const drawPath = (
    context: CanvasRenderingContext2D,
    path: Array<[number, number]>,
    options: { closePath?: boolean; fillStyle?: string; strokeStyle?: string; lineWidth?: number; dash?: number[] }
  ) => {
    if (!path.length) {
      return
    }

    context.beginPath()
    path.forEach(([lon, lat], index) => {
      const point = project(lon, lat)
      if (index === 0) {
        context.moveTo(point.x, point.y)
      } else {
        context.lineTo(point.x, point.y)
      }
    })

    if (options.closePath) {
      context.closePath()
    }

    if (options.fillStyle) {
      context.fillStyle = options.fillStyle
      context.fill()
    }

    if (options.strokeStyle) {
      context.setLineDash(options.dash ?? [])
      context.strokeStyle = options.strokeStyle
      context.lineWidth = options.lineWidth ?? 1
      context.stroke()
      context.setLineDash([])
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  diagram.schematic.apron.features.forEach((feature) => {
    geometryToPaths(feature.geometry).forEach((path) => {
      drawPath(context, path, {
        closePath: true,
        fillStyle: 'rgba(138, 167, 192, 0.18)',
        strokeStyle: 'rgba(138, 167, 192, 0.70)',
        lineWidth: 1.2,
        dash: [4, 4]
      })
    })
  })

  diagram.schematic.taxi.features.forEach((feature) => {
    geometryToPaths(feature.geometry).forEach((path) => {
      drawPath(context, path, {
        strokeStyle: 'rgba(138, 167, 192, 0.70)',
        lineWidth: 1.3,
        dash: [4, 4]
      })
    })
  })

  diagram.runways.features.forEach((feature) => {
    const surface = String(feature.properties.surface ?? '').toUpperCase()
    const isClosed = Boolean(feature.properties.closed)

    let fillStyle = 'rgba(111, 126, 141, 0.50)'
    let strokeStyle = 'rgba(61, 74, 91, 0.95)'
    let dash: number[] = []

    if (surface.includes('WATER')) {
      fillStyle = 'rgba(92, 124, 160, 0.08)'
      strokeStyle = 'rgba(92, 124, 160, 0.70)'
    } else if (
      surface.includes('GRAVEL') ||
      surface.includes('TURF') ||
      surface.includes('DIRT') ||
      surface.includes('GRASS')
    ) {
      fillStyle = 'rgba(196, 176, 144, 0.30)'
      strokeStyle = 'rgba(137, 107, 79, 0.85)'
      dash = [6, 4]
    }

    if (isClosed) {
      fillStyle = fillStyle.replace('0.50', '0.20').replace('0.30', '0.18').replace('0.08', '0.06')
      strokeStyle = strokeStyle.replace('0.95', '0.55').replace('0.85', '0.55').replace('0.70', '0.50')
    }

    geometryToPaths(feature.geometry).forEach((path) => {
      drawPath(context, path, {
        closePath: true,
        fillStyle,
        strokeStyle,
        lineWidth: 1.4,
        dash
      })
    })
  })

  diagram.overlays.features.forEach((feature) => {
    const kind = String(feature.properties.kind ?? '')
    geometryToPaths(feature.geometry).forEach((path) => {
      drawPath(context, path, {
        strokeStyle: kind === 'closed-x' ? 'rgba(179, 32, 32, 0.86)' : 'rgba(201, 209, 220, 0.95)',
        lineWidth: kind === 'closed-x' ? 2 : 1.5,
        dash: kind === 'closed-x' ? [] : [6, 5]
      })
    })
  })

  context.fillStyle = '#1f2937'
  context.font = '600 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  diagram.runwayLabels.features.forEach((feature) => {
    if (feature.geometry.type !== 'Point') {
      return
    }

    const [lon, lat] = feature.geometry.coordinates as [number, number]
    const point = project(lon, lat)
    const text = String(feature.properties.text ?? '').trim()
    if (!text) {
      return
    }

    const rotationDeg = Number(feature.properties.rotationDeg ?? 0)
    context.save()
    context.translate(point.x, point.y)
    context.rotate((rotationDeg * Math.PI) / 180)
    context.fillText(text, 0, 0)
    context.restore()
  })

  return canvas.toDataURL('image/png')
}

function normalizeMetarForAi(rawMetar: string | null | undefined) {
  if (!rawMetar) {
    return null
  }

  const normalized = rawMetar
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()

  return normalized.length > 0 ? normalized : null
}

function normalizeTafForBrief(rawTaf: string | null | undefined) {
  if (!rawTaf) {
    return null
  }

  const normalized = rawTaf
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()

  return normalized.length > 0 ? normalized : null
}

function hasMosGuidance(mos: WeatherResponse['mos']) {
  return Boolean(mos && (mos.mavRaw || mos.mexRaw || mos.metRaw))
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildTfrPopupHtml(properties: Record<string, unknown>) {
  const title = String(properties.TITLE ?? properties.NAME ?? properties.NOTAM_KEY ?? 'TFR')
  const notam = String(properties.NOTAM_KEY ?? properties.GID ?? 'N/A')
  const state = String(properties.STATE ?? properties.CITY ?? 'N/A')
  const legal = String(properties.LEGAL ?? properties.TYPE_CODE ?? '')
  const modifiedRaw = properties.LAST_MODIFICATION_DATETIME ?? properties.NOTEBOOK_UPDATE_DATETIME ?? null
  const modifiedTimestamp = typeof modifiedRaw === 'number'
    ? modifiedRaw
    : typeof modifiedRaw === 'string'
      ? Date.parse(modifiedRaw)
      : Number.NaN
  const modified = modifiedRaw
    ? Number.isNaN(modifiedTimestamp) ? String(modifiedRaw) : new Date(modifiedTimestamp).toLocaleString()
    : 'N/A'

  return [
    `<div class="tfr-popup">`,
    `<strong>${escapeHtml(title)}</strong>`,
    `<div>NOTAM: ${escapeHtml(notam)}</div>`,
    `<div>Area: ${escapeHtml(state)}</div>`,
    legal ? `<div>${escapeHtml(legal)}</div>` : '',
    `<div>Updated: ${escapeHtml(modified)}</div>`,
    `</div>`
  ].join('')
}

function haversineNm(from: Point, to: Point) {
  const radiusNm = 3440.065
  const dLat = toRad(to.lat - from.lat)
  const dLon = toRad(to.lon - from.lon)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return radiusNm * c
}

function initialBearing(from: Point, to: Point) {
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLon = toRad(to.lon - from.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return normalizeHeading(toDeg(Math.atan2(y, x)))
}

function computeLegs(
  points: Point[],
  tasKnots: number,
  fallbackWindDirFrom: number,
  fallbackWindSpeedKnots: number,
  fuelBurnGph: number,
  legWinds?: Array<{ direction: number | null; speed: number; station: string }>,
  legVariations?: Array<number>,
  compassDeviationDeg = 0
): Leg[] {
  const legs: Leg[] = []

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    const distanceNm = haversineNm(from, to)
    const trueCourse = initialBearing(from, to)
    const courseRad = toRad(trueCourse)
    const legWind = legWinds?.[i]
    const windDirFrom = legWind?.direction ?? fallbackWindDirFrom
    const windSpeedKnots = legWind?.speed ?? fallbackWindSpeedKnots
    const windRad = toRad(windDirFrom)

    const crosswind = windSpeedKnots * Math.sin(windRad - courseRad)
    const headwind = windSpeedKnots * Math.cos(windRad - courseRad)
    const correctionRatio = Math.max(-1, Math.min(1, crosswind / Math.max(tasKnots, 1)))
    const windCorrection = toDeg(Math.asin(correctionRatio))
    const trueHeading = normalizeHeading(trueCourse + windCorrection)
    const magneticVariation = legVariations?.[i] ?? 0
    const magneticHeading = normalizeHeading(trueHeading - magneticVariation)
    const compassHeading = normalizeHeading(magneticHeading - compassDeviationDeg)
    const groundSpeed = Math.max(40, tasKnots - headwind)
    const eteMinutes = (distanceNm / groundSpeed) * 60
    const fuelGallons = (eteMinutes / 60) * fuelBurnGph

    legs.push({
      from: from.ident,
      to: to.ident,
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
      distanceNm,
      trueCourse,
      windDirection: legWind?.direction ?? fallbackWindDirFrom,
      windSpeed: windSpeedKnots,
      windStation: legWind?.station ?? 'Manual',
      magneticVariation,
      windCorrection,
      trueHeading,
      magneticHeading,
      compassHeading,
      groundSpeed,
      eteMinutes,
      fuelGallons
    })
  }

  return legs
}

function App() {
  const fallbackWindDir = 270
  const fallbackWindSpeed = 15
  const defaultLocationZoom = 10
  const cruiseAltitudeOptions = [3000, 6000, 6500, 9000, 12000, 18000, 24000]

  const [departure, setDeparture] = useState('')
  const [arrival, setArrival] = useState('')
  const [waypointsInput, setWaypointsInput] = useState('')
  const [waypointDraft, setWaypointDraft] = useState('')
  const [waypointChips, setWaypointChips] = useState<WaypointChip[]>([])
  const [draggingWaypointIndex, setDraggingWaypointIndex] = useState<number | null>(null)
  const [dragWaypointInsertionIndex, setDragWaypointInsertionIndex] = useState<number | null>(null)
  const [cruiseAltitudeFt, setCruiseAltitudeFt] = useState(3000)
  const [tas, setTas] = useState(110)
  const [compassDeviation, setCompassDeviation] = useState(0)
  const [fuelBurn, setFuelBurn] = useState(9)
  const [includedNavaidTypes, setIncludedNavaidTypes] = useState<string[]>(['VOR', 'VOR-DME'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [depAirport, setDepAirport] = useState<AirportResponse | null>(null)
  const [arrAirport, setArrAirport] = useState<AirportResponse | null>(null)
  const [depWeather, setDepWeather] = useState<WeatherResponse | null>(null)
  const [arrWeather, setArrWeather] = useState<WeatherResponse | null>(null)
  const [depFrequencies, setDepFrequencies] = useState<FrequencyResponse['frequencies']>([])
  const [arrFrequencies, setArrFrequencies] = useState<FrequencyResponse['frequencies']>([])
  const [depRunways, setDepRunways] = useState<RunwayResponse['runways']>([])
  const [arrRunways, setArrRunways] = useState<RunwayResponse['runways']>([])
  const [legs, setLegs] = useState<Leg[]>([])
  const [printableDiagrams, setPrintableDiagrams] = useState<PrintableDiagram[]>([])
  const [printDiagramsLoading, setPrintDiagramsLoading] = useState(false)
  const [routeNavaids, setRouteNavaids] = useState<RouteNavaid[]>([])
  const [routePoints, setRoutePoints] = useState<Point[]>([])
  const [mapAirportSearchQuery, setMapAirportSearchQuery] = useState('')
  const [mapAirportSearchFocused, setMapAirportSearchFocused] = useState(false)
  const [mapAirportSearchLoading, setMapAirportSearchLoading] = useState(false)
  const [mapAirportSearchError, setMapAirportSearchError] = useState<string | null>(null)
  const [mapAirportSearchResults, setMapAirportSearchResults] = useState<AirportSearchResult[]>([])
  const [mapAirportSearchFlightConditions, setMapAirportSearchFlightConditions] = useState<Record<string, FlightCategory>>({})
  const [mapAirportSearchFlightConditionsLoading, setMapAirportSearchFlightConditionsLoading] = useState<Record<string, boolean>>({})
  const [selectedMapAirport, setSelectedMapAirport] = useState<AirportResponse | null>(null)
  const [selectedMapAirportLoading, setSelectedMapAirportLoading] = useState(false)
  const [selectedMapAirportDistanceNm, setSelectedMapAirportDistanceNm] = useState<number | null>(null)
  const [selectedMapAirportWeather, setSelectedMapAirportWeather] = useState<WeatherResponse | null>(null)
  const [selectedMapAirportError, setSelectedMapAirportError] = useState<string | null>(null)
  const [selectedMapAirportTab, setSelectedMapAirportTab] = useState<MapAirportTab>('weather')
  const [selectedMapAirportFrequencies, setSelectedMapAirportFrequencies] = useState<FrequencyResponse['frequencies']>([])
  const [selectedMapAirportFrequenciesLoading, setSelectedMapAirportFrequenciesLoading] = useState(false)
  const [selectedMapAirportFrequenciesError, setSelectedMapAirportFrequenciesError] = useState<string | null>(null)
  const [selectedMapAirportDiagram, setSelectedMapAirportDiagram] = useState<AirportDiagramResponse['diagram']>(null)
  const [selectedMapAirportDiagramLoading, setSelectedMapAirportDiagramLoading] = useState(false)
  const [selectedMapAirportDiagramError, setSelectedMapAirportDiagramError] = useState<string | null>(null)
  const [selectedMapAirportRunways, setSelectedMapAirportRunways] = useState<RunwayResponse['runways']>([])
  const [selectedMapAirportRunwaysLoading, setSelectedMapAirportRunwaysLoading] = useState(false)
  const [selectedMapAirportRunwaysError, setSelectedMapAirportRunwaysError] = useState<string | null>(null)
  const [selectedMapAirportNotams, setSelectedMapAirportNotams] = useState<AirportNotamsResponse['notams']>([])
  const [selectedMapAirportNotamsLoading, setSelectedMapAirportNotamsLoading] = useState(false)
  const [selectedMapAirportNotamsError, setSelectedMapAirportNotamsError] = useState<string | null>(null)
  const [selectedMapAirspaceId, setSelectedMapAirspaceId] = useState<string | null>(null)
  const [showFaaCharts, setShowFaaCharts] = useState(true)
  const [showAirportDiagrams, setShowAirportDiagrams] = useState(() => {
    if (typeof window === 'undefined') {
      return true
    }

    return window.localStorage.getItem('navlog:charts:airport-diagrams-enabled') !== '0'
  })
  const [showSchematicSurfaceLayout, setShowSchematicSurfaceLayout] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem('navlog:charts:airport-diagrams-schematic-enabled') === '1'
  })
  const [showTfrOverlay, setShowTfrOverlay] = useState(true)
  const [layerControlOpen, setLayerControlOpen] = useState(false)
  const [planLayerId, setPlanLayerId] = useState(() => {
    if (typeof window === 'undefined') {
      return defaultFaaChartLayerId
    }

    const stored = window.localStorage.getItem('navlog:charts:selected-layer')
    if (stored && faaCharts.some((layer) => layer.id === stored)) {
      return stored
    }

    return defaultFaaChartLayerId
  })
  const [planBaseMapId, setPlanBaseMapId] = useState<BaseMapStyle>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    const stored = window.localStorage.getItem('navlog:charts:selected-basemap')
    if (stored === 'light' || stored === 'dark') {
      return stored
    }

    return 'light'
  })
  const [planMapError, setPlanMapError] = useState<string | null>(null)
  const [mapInitializing, setMapInitializing] = useState(true)
  const [mapTilesLoading, setMapTilesLoading] = useState(false)
  const [, setLoadTelemetry] = useState<LoadTelemetryEntry[]>([])
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [dataCycle, setDataCycle] = useState<DataCycleResponse | null>(null)
  const [routeInsertDragging, setRouteInsertDragging] = useState(false)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)

  const recalcRequestIdRef = useRef(0)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapSearchContainerRef = useRef<HTMLDivElement | null>(null)
  const layerControlRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const baseLayerRef = useRef<any>(null)
  const chartLayerRef = useRef<any>(null)
  const tfrLayerRef = useRef<any>(null)
  const routeLayerRef = useRef<any>(null)
  const markerLayerRef = useRef<any>(null)
  const airportDiagramsLayerRef = useRef<AirportDiagramsLayer | null>(null)
  const lastMapTileLoadKeyRef = useRef('')
  const hasRunInitialTileRefreshRef = useRef(false)
  const hasRunInitialRelayoutRef = useRef(false)
  const telemetryIdRef = useRef(0)
  const suppressNextMapClickRef = useRef(false)
  const routeInsertHandleRef = useRef<any>(null)

  const totals = useMemo(() => {
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distanceNm, 0)
    const totalTime = legs.reduce((sum, leg) => sum + leg.eteMinutes, 0)
    const totalFuel = legs.reduce((sum, leg) => sum + leg.fuelGallons, 0)
    return { totalDistance, totalTime, totalFuel }
  }, [legs])
  const printWeatherTimestamp = useMemo(
    () => new Date().toLocaleString(),
    [
      depWeather?.metar?.reportTime,
      depWeather?.taf?.issueTime,
      arrWeather?.metar?.reportTime,
      arrWeather?.taf?.issueTime
    ]
  )

  const waypointLines = useMemo(
    () => waypointsInput.split('\n').map((line) => line.trim()).filter(Boolean),
    [waypointsInput]
  )
  const selectedPlanLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === planLayerId) ?? faaCharts[0],
    [planLayerId]
  )
  const selectedBaseMap = useMemo(
    () => baseMapLayers.find((baseMap) => baseMap.id === planBaseMapId) ?? baseMapLayers[0],
    [planBaseMapId]
  )
  const trimmedMapAirportSearchQuery = mapAirportSearchQuery.trim()
  const showMapAirportSearchPanel = mapAirportSearchFocused && trimmedMapAirportSearchQuery.length > 0
  const selectedMapAirportIcao = selectedMapAirport?.airport.icao ?? null
  const selectedMapAirportMetarRaw = selectedMapAirportWeather?.metar?.rawOb?.trim() ?? null
  const selectedMapAirportMetarForAi = normalizeMetarForAi(selectedMapAirportWeather?.metar?.rawOb)
  const selectedMapAirportTafForBrief = normalizeTafForBrief(selectedMapAirportWeather?.taf?.rawTAF)
  const selectedMapAirportMosForBrief = hasMosGuidance(selectedMapAirportWeather?.mos) ? selectedMapAirportWeather?.mos ?? null : null
  const selectedMapAirportAirspace = useMemo<AirportNotam | null>(
    () => selectedMapAirportNotams.find((notam) => notam.id === selectedMapAirspaceId) ?? null,
    [selectedMapAirportNotams, selectedMapAirspaceId]
  )
  const selectedMapAirportFlightCategory = useMemo(
    () => getFlightCategory(selectedMapAirportWeather),
    [selectedMapAirportWeather]
  )

  function getCurrentAiContext(): AiAskContext {
    const mapInstance = mapRef.current as {
      getCenter?: () => { lat: number; lng: number }
      getZoom?: () => number
    } | null

    const center = mapInstance?.getCenter?.()
    const zoom = mapInstance?.getZoom?.()
    const defaultLat = selectedMapAirport?.airport.lat ?? userLocation?.lat ?? 39.5
    const defaultLng = selectedMapAirport?.airport.lon ?? userLocation?.lon ?? -98.35

    const routeContext = routePoints.length >= 2
      ? {
          from: routePoints[0]?.ident ?? null,
          to: routePoints[routePoints.length - 1]?.ident ?? null,
          pointCount: routePoints.length,
          distanceNm: Number(totals.totalDistance.toFixed(1))
        }
      : null

    return {
      selectedAirport: selectedMapAirport as unknown as Record<string, unknown> | null,
      selectedAirspace: selectedMapAirportAirspace as unknown as Record<string, unknown> | null,
      route: routeContext,
      weather: {
        metarRaw: selectedMapAirportWeather?.metar?.rawOb?.trim() ?? null,
        tafRaw: selectedMapAirportWeather?.taf?.rawTAF?.trim() ?? null
      },
      map: {
        center: {
          lat: typeof center?.lat === 'number' ? center.lat : defaultLat,
          lng: typeof center?.lng === 'number' ? center.lng : defaultLng
        },
        zoom: typeof zoom === 'number' ? zoom : 0
      }
    }
  }

  function normalizeTelemetryPath(path: string) {
    const [base] = path.split('?')
    return base || path
  }

  function recordTelemetry(label: string, durationMs: number, status: 'ok' | 'error' = 'ok') {
    telemetryIdRef.current += 1
    const entry: LoadTelemetryEntry = {
      id: telemetryIdRef.current,
      label,
      durationMs,
      status
    }

    setLoadTelemetry((current) => [entry, ...current].slice(0, 10))
  }

  function forceMapRelayout() {
    const map = mapRef.current
    if (!map) {
      return
    }

    map.invalidateSize(false)
    const center = map.getCenter()
    const zoom = map.getZoom()
    map.setView(center, zoom, { animate: false })
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('navlog:charts:selected-layer', planLayerId)
    }
  }, [planLayerId])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('navlog:charts:selected-basemap', planBaseMapId)
    }
  }, [planBaseMapId])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('navlog:charts:airport-diagrams-enabled', showAirportDiagrams ? '1' : '0')
    }
  }, [showAirportDiagrams])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('navlog:charts:airport-diagrams-schematic-enabled', showSchematicSurfaceLayout ? '1' : '0')
    }
  }, [showSchematicSurfaceLayout])

  useEffect(() => {
    let cancelled = false

    async function loadDataCycle() {
      try {
        const response = await fetchJson<DataCycleResponse>('/api/data-cycle')
        if (!cancelled) {
          setDataCycle(response)
        }
      } catch {
        if (!cancelled) {
          setDataCycle(null)
        }
      }
    }

    void loadDataCycle()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const depCode = departure.trim().toUpperCase()
    const arrCode = arrival.trim().toUpperCase()

    if (depCode.length < 3 || arrCode.length < 3) {
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        const [depAirportResponse, arrAirportResponse] = await Promise.all([
          fetchJson<AirportResponse>(`/api/airport/${depCode}`),
          fetchJson<AirportResponse>(`/api/airport/${arrCode}`)
        ])

        if (cancelled) {
          return
        }

        setDepAirport(depAirportResponse)
        setArrAirport(arrAirportResponse)

        const userWaypoints = await parseWaypointLines(waypointsInput)

        if (cancelled) {
          return
        }

        const points: Point[] = [
          {
            ident: depAirportResponse.airport.icao,
            lat: depAirportResponse.airport.lat,
            lon: depAirportResponse.airport.lon,
            originalIdent: depAirportResponse.airport.icao,
            originalLat: depAirportResponse.airport.lat,
            originalLon: depAirportResponse.airport.lon
          },
          ...userWaypoints,
          {
            ident: arrAirportResponse.airport.icao,
            lat: arrAirportResponse.airport.lat,
            lon: arrAirportResponse.airport.lon,
            originalIdent: arrAirportResponse.airport.icao,
            originalLat: arrAirportResponse.airport.lat,
            originalLon: arrAirportResponse.airport.lon
          }
        ]

        setRoutePoints(points)
        setError(null)
      } catch {
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [departure, arrival, waypointsInput])

  useEffect(() => {
    const query = trimmedMapAirportSearchQuery
    if (query.length < 2) {
      setMapAirportSearchResults([])
      setMapAirportSearchError(null)
      setMapAirportSearchLoading(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        setMapAirportSearchLoading(true)
        setMapAirportSearchError(null)
        const response = await fetchJson<{ airports: AirportSearchResult[] }>(
          `/api/airports/search?q=${encodeURIComponent(query)}`
        )

        if (!cancelled) {
          setMapAirportSearchResults(response.airports)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setMapAirportSearchResults([])
          setMapAirportSearchError((caughtError as Error).message)
        }
      } finally {
        if (!cancelled) {
          setMapAirportSearchLoading(false)
        }
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [trimmedMapAirportSearchQuery])

  useEffect(() => {
    const airportsToLoad = mapAirportSearchResults
      .slice(0, 8)
      .map((airport) => airport.ident.toUpperCase())
      .filter((ident) => !mapAirportSearchFlightConditions[ident] && !mapAirportSearchFlightConditionsLoading[ident])

    if (!airportsToLoad.length) {
      return
    }

    let cancelled = false

    setMapAirportSearchFlightConditionsLoading((current) => {
      const next = { ...current }
      for (const ident of airportsToLoad) {
        next[ident] = true
      }
      return next
    })

    async function loadMapAirportSearchFlightConditions() {
      const results = await Promise.allSettled(
        airportsToLoad.map(async (ident) => {
          const weather = await fetchJson<WeatherResponse>(`/api/weather/${encodeURIComponent(ident)}`)
          return [ident, getFlightCategory(weather)] as const
        })
      )

      if (cancelled) {
        return
      }

      setMapAirportSearchFlightConditions((current) => {
        const next = { ...current }

        results.forEach((result, index) => {
          const requestedIdent = airportsToLoad[index]
          if (!requestedIdent) {
            return
          }

          if (result.status === 'fulfilled') {
            const [ident, category] = result.value
            next[ident] = category
            return
          }

          if (!next[requestedIdent]) {
            next[requestedIdent] = 'Unknown'
          }
        })

        return next
      })

      setMapAirportSearchFlightConditionsLoading((current) => {
        const next = { ...current }
        for (const ident of airportsToLoad) {
          delete next[ident]
        }
        return next
      })
    }

    void loadMapAirportSearchFlightConditions()

    return () => {
      cancelled = true
    }
  }, [mapAirportSearchResults, mapAirportSearchFlightConditions, mapAirportSearchFlightConditionsLoading])

  useEffect(() => {
    function handleDocumentPointerDown(event: MouseEvent) {
      if (!mapSearchContainerRef.current) {
        if (
          layerControlRef.current &&
          event.target instanceof Node &&
          !layerControlRef.current.contains(event.target)
        ) {
          setLayerControlOpen(false)
        }
        return
      }

      if (event.target instanceof Node && mapSearchContainerRef.current.contains(event.target)) {
        return
      }

      setMapAirportSearchFocused(false)

      if (
        layerControlRef.current &&
        event.target instanceof Node &&
        !layerControlRef.current.contains(event.target)
      ) {
        setLayerControlOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentPointerDown)

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown)
    }
  }, [])

  useEffect(() => {
    if (!selectedMapAirportIcao) {
      setSelectedMapAirportFrequencies([])
      setSelectedMapAirportFrequenciesLoading(false)
      setSelectedMapAirportFrequenciesError(null)
      setSelectedMapAirportDiagram(null)
      setSelectedMapAirportDiagramLoading(false)
      setSelectedMapAirportDiagramError(null)
      setSelectedMapAirportRunways([])
      setSelectedMapAirportRunwaysLoading(false)
      setSelectedMapAirportRunwaysError(null)
      setSelectedMapAirportNotams([])
      setSelectedMapAirportNotamsLoading(false)
      setSelectedMapAirportNotamsError(null)
      setSelectedMapAirspaceId(null)
      return
    }

    setSelectedMapAirportTab('weather')
    let cancelled = false

    async function loadFrequencies() {
      try {
        setSelectedMapAirportFrequenciesLoading(true)
        setSelectedMapAirportFrequenciesError(null)
        const response = await fetchJson<FrequencyResponse>(`/api/frequencies/${selectedMapAirportIcao}`)
        if (!cancelled) {
          setSelectedMapAirportFrequencies(response.frequencies)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setSelectedMapAirportFrequencies([])
          setSelectedMapAirportFrequenciesError((caughtError as Error).message)
        }
      } finally {
        if (!cancelled) {
          setSelectedMapAirportFrequenciesLoading(false)
        }
      }
    }

    async function loadDiagram() {
      try {
        setSelectedMapAirportDiagramLoading(true)
        setSelectedMapAirportDiagramError(null)
        const response = await fetchJson<AirportDiagramResponse>(`/api/airport-diagram/by-airport/${selectedMapAirportIcao}`)
        if (!cancelled) {
          setSelectedMapAirportDiagram(response.diagram)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setSelectedMapAirportDiagram(null)
          setSelectedMapAirportDiagramError((caughtError as Error).message)
        }
      } finally {
        if (!cancelled) {
          setSelectedMapAirportDiagramLoading(false)
        }
      }
    }

    async function loadRunways() {
      try {
        setSelectedMapAirportRunwaysLoading(true)
        setSelectedMapAirportRunwaysError(null)
        const response = await fetchJson<RunwayResponse>(`/api/runways/${selectedMapAirportIcao}`)
        if (!cancelled) {
          setSelectedMapAirportRunways(response.runways)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setSelectedMapAirportRunways([])
          setSelectedMapAirportRunwaysError((caughtError as Error).message)
        }
      } finally {
        if (!cancelled) {
          setSelectedMapAirportRunwaysLoading(false)
        }
      }
    }

    async function loadNotams() {
      try {
        setSelectedMapAirportNotamsLoading(true)
        setSelectedMapAirportNotamsError(null)
        const response = await fetchJson<AirportNotamsResponse>(`/api/notams/${selectedMapAirportIcao}`)
        if (!cancelled) {
          setSelectedMapAirportNotams(response.notams)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setSelectedMapAirportNotams([])
          setSelectedMapAirportNotamsError((caughtError as Error).message)
        }
      } finally {
        if (!cancelled) {
          setSelectedMapAirportNotamsLoading(false)
        }
      }
    }

    void Promise.all([loadFrequencies(), loadDiagram(), loadRunways(), loadNotams()])

    return () => {
      cancelled = true
    }
  }, [selectedMapAirportIcao])

  useEffect(() => {
    if (selectedMapAirportNotams.length === 0) {
      setSelectedMapAirspaceId(null)
      return
    }

    if (!selectedMapAirspaceId || !selectedMapAirportNotams.some((notam) => notam.id === selectedMapAirspaceId)) {
      setSelectedMapAirspaceId(selectedMapAirportNotams[0].id)
    }
  }, [selectedMapAirportNotams, selectedMapAirspaceId])

  async function fetchJson<T>(path: string): Promise<T> {
    const startedAt = performance.now()

    try {
      const response = await fetch(path)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        recordTelemetry(`HTTP ${response.status} ${normalizeTelemetryPath(path)}`, performance.now() - startedAt, 'error')
        throw new Error(body.error ?? `Request failed: ${path}`)
      }

      const data = await response.json() as T
      recordTelemetry(normalizeTelemetryPath(path), performance.now() - startedAt, 'ok')
      return data
    } catch (caughtError) {
      if ((caughtError as Error).name !== 'AbortError') {
        recordTelemetry(`ERR ${normalizeTelemetryPath(path)}`, performance.now() - startedAt, 'error')
      }

      throw caughtError
    }
  }

  async function selectMapAirportFromIdent(ident: string) {
    setSelectedMapAirportLoading(true)
    try {
      const airport = await fetchJson<AirportResponse>(`/api/airport/${ident}`)
      setSelectedMapAirport(airport)
      setSelectedMapAirportDistanceNm(null)
      setSelectedMapAirportError(null)

      try {
        const wx = await fetchJson<WeatherResponse>(`/api/weather/${airport.airport.icao}`)
        setSelectedMapAirportWeather(wx)
      } catch {
        setSelectedMapAirportWeather(null)
      }
    } catch {
      setSelectedMapAirport(null)
      setSelectedMapAirportDistanceNm(null)
      setSelectedMapAirportWeather(null)
      setSelectedMapAirportError(`No airport information available for ${ident}.`)
    } finally {
      setSelectedMapAirportLoading(false)
    }
  }

  async function selectMapAirportFromSearch(airport: AirportSearchResult) {
    setMapAirportSearchQuery(airport.ident)
    setMapAirportSearchFocused(false)

    if (mapRef.current) {
      mapRef.current.panTo([airport.lat, airport.lon])
    }

    await selectMapAirportFromIdent(airport.ident)
  }

  function clearSelectedMapAirport() {
    setSelectedMapAirport(null)
    setSelectedMapAirportLoading(false)
    setSelectedMapAirportDistanceNm(null)
    setSelectedMapAirportWeather(null)
    setSelectedMapAirportError(null)
    setSelectedMapAirspaceId(null)
    setSelectedMapAirportTab('weather')
  }

  function recenterToUserLocation(showErrorOnFailure = true) {
    if (!navigator.geolocation) {
      if (showErrorOnFailure) {
        setPlanMapError('Geolocation is not available in this browser.')
      }

      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        }

        setUserLocation(location)

        if (mapRef.current) {
          mapRef.current.setView([location.lat, location.lon], Math.max(selectedPlanLayer.minZoom, defaultLocationZoom))
        }

        setPlanMapError(null)
      },
      () => {
        if (showErrorOnFailure) {
          setPlanMapError('Unable to access your location. Check browser location permissions.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 300000
      }
    )
  }

  async function parseWaypointLines(input = waypointsInput): Promise<Point[]> {
    const lines = input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (!lines.length) {
      return []
    }

    const parsed = lines.map((line) => {
      const parts = line.split(',').map((value) => value.trim())

      if (parts.length === 1 && parts[0]) {
        return { kind: 'ident' as const, inputIdent: parts[0].toUpperCase() }
      }

      if (parts.length === 3) {
        const [ident, latText, lonText] = parts
        const lat = Number(latText)
        const lon = Number(lonText)

        if (!ident || Number.isNaN(lat) || Number.isNaN(lon)) {
          throw new Error(`Invalid waypoint line: ${line}`)
        }

        const normalizedIdent = ident.toUpperCase()
        return {
          kind: 'point' as const,
          point: {
            ident: normalizedIdent,
            lat,
            lon,
            originalIdent: normalizedIdent,
            originalLat: lat,
            originalLon: lon
          }
        }
      }

      throw new Error(`Invalid waypoint line: ${line}`)
    })

    const unresolvedIdents = parsed
      .filter((item): item is { kind: 'ident'; inputIdent: string } => item.kind === 'ident')
      .map((item) => item.inputIdent)

    const resolvedByInput = new Map<string, ResolvedWaypoint>()

    if (unresolvedIdents.length) {
      const uniqueIdents = Array.from(new Set(unresolvedIdents))
      const response = await fetchJson<WaypointResolveResponse>(
        `/api/waypoints/resolve?idents=${encodeURIComponent(uniqueIdents.join(','))}`
      )

      response.waypoints.forEach((waypoint) => {
        resolvedByInput.set(waypoint.inputIdent.toUpperCase(), waypoint)
      })

      const missing = uniqueIdents.filter((ident) => !resolvedByInput.has(ident))
      if (missing.length) {
        throw new Error(`Unrecognized waypoint ident(s): ${missing.join(', ')}`)
      }
    }

    return parsed.map((item) => {
      if (item.kind === 'point') {
        return item.point
      }

      const resolved = resolvedByInput.get(item.inputIdent)
      if (!resolved) {
        throw new Error(`Unrecognized waypoint ident: ${item.inputIdent}`)
      }

      return {
        ident: resolved.ident,
        lat: resolved.lat,
        lon: resolved.lon,
        originalIdent: resolved.ident,
        originalLat: resolved.lat,
        originalLon: resolved.lon
      }
    })
  }

  async function syncRouteFromWaypointLines(lines: string[]) {
    if (!depAirport || !arrAirport) {
      return
    }

    try {
      const waypointText = lines.join('\n')
      const userWaypoints = await parseWaypointLines(waypointText)
      const points: Point[] = [
        {
          ident: depAirport.airport.icao,
          lat: depAirport.airport.lat,
          lon: depAirport.airport.lon,
          originalIdent: depAirport.airport.icao,
          originalLat: depAirport.airport.lat,
          originalLon: depAirport.airport.lon
        },
        ...userWaypoints,
        {
          ident: arrAirport.airport.icao,
          lat: arrAirport.airport.lat,
          lon: arrAirport.airport.lon,
          originalIdent: arrAirport.airport.icao,
          originalLat: arrAirport.airport.lat,
          originalLon: arrAirport.airport.lon
        }
      ]

      setRoutePoints(points)
      await Promise.all([
        recomputeRouteCalculations(points),
        loadRouteNavaids(points)
      ])
    } catch {
    }
  }

  function setWaypointLines(lines: string[]) {
    setWaypointsInput(lines.join('\n'))
    void syncRouteFromWaypointLines(lines)
  }

  function appendWaypointDraft() {
    const value = waypointDraft.trim()
    if (!value) {
      return
    }

    setWaypointLines([...waypointLines, value])
    setWaypointDraft('')
  }

  function removeLastWaypointChip() {
    if (!waypointLines.length) {
      return
    }

    setWaypointLines(waypointLines.slice(0, -1))
  }

  function removeWaypointChip(index: number) {
    setWaypointLines(waypointLines.filter((_line, lineIndex) => lineIndex !== index))
  }

  function clearWaypointDragState() {
    setDraggingWaypointIndex(null)
    setDragWaypointInsertionIndex(null)
  }

  function reorderWaypointChips(insertionSlot: number) {
    if (draggingWaypointIndex == null) {
      clearWaypointDragState()
      return
    }

    const normalizedInsertionSlot = Math.max(0, Math.min(insertionSlot, waypointLines.length))
    if (normalizedInsertionSlot === draggingWaypointIndex || normalizedInsertionSlot === draggingWaypointIndex + 1) {
      clearWaypointDragState()
      return
    }

    const insertionIndexAfterRemove = normalizedInsertionSlot > draggingWaypointIndex
      ? normalizedInsertionSlot - 1
      : normalizedInsertionSlot

    if (insertionIndexAfterRemove < 0 || insertionIndexAfterRemove > waypointLines.length - 1) {
      clearWaypointDragState()
      return
    }

    const nextLines = [...waypointLines]
    const [dragged] = nextLines.splice(draggingWaypointIndex, 1)
    if (dragged == null) {
      clearWaypointDragState()
      return
    }

    nextLines.splice(insertionIndexAfterRemove, 0, dragged)
    clearWaypointDragState()
    setWaypointLines(nextLines)
  }

  function getWaypointInsertionSlot(chipElement: HTMLElement, clientX: number) {
    const index = Number(chipElement.dataset.waypointChipIndex)
    if (Number.isNaN(index)) {
      return null
    }

    const bounds = chipElement.getBoundingClientRect()
    const midpointX = bounds.left + (bounds.width / 2)
    return clientX >= midpointX ? index + 1 : index
  }

  function updateWaypointDragTarget(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)
    if (!(target instanceof HTMLElement)) {
      return
    }

    const chipElement = target.closest('[data-waypoint-chip-index]')
    if (!chipElement || !(chipElement instanceof HTMLElement)) {
      setDragWaypointInsertionIndex(waypointChips.length)
      return
    }

    const slot = getWaypointInsertionSlot(chipElement, clientX)
    if (slot != null) {
      setDragWaypointInsertionIndex(slot)
    }
  }

  function handleWaypointChipDragOver(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    const slot = getWaypointInsertionSlot(event.currentTarget, event.clientX)
    if (slot != null) {
      setDragWaypointInsertionIndex(slot)
      return
    }

    setDragWaypointInsertionIndex(index)
  }

  function handleWaypointChipDrop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    const slot = getWaypointInsertionSlot(event.currentTarget, event.clientX)
    reorderWaypointChips(slot ?? index)
  }

  function handleWaypointListDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    if (draggingWaypointIndex == null) {
      return
    }

    const target = event.target
    if (target instanceof HTMLElement && target.closest('[data-waypoint-chip-index]')) {
      return
    }

    setDragWaypointInsertionIndex(waypointChips.length)
  }

  function handleWaypointListDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    if (draggingWaypointIndex == null) {
      return
    }

    reorderWaypointChips(dragWaypointInsertionIndex ?? waypointChips.length)
  }

  function updateTouchDragTarget(clientX: number, clientY: number) {
    updateWaypointDragTarget(clientX, clientY)
  }

  function toWaypointInputFromRoute(points: Point[]) {
    if (points.length <= 2) {
      return ''
    }

    return points
      .slice(1, -1)
      .map((point) => `${point.ident},${point.lat.toFixed(6)},${point.lon.toFixed(6)}`)
      .join('\n')
  }

  function formatDecodedWeather(weather: WeatherResponse | null) {
    const metar = weather?.metar
    if (!metar) {
      return 'No METAR available'
    }

    const windDirection = metar.wdir == null ? 'VRB' : `${metar.wdir}°`
    const windSpeed = metar.wspd == null ? '—' : `${metar.wspd}kt`
    const visibility = metar.visib ? `${metar.visib}SM` : '—'
    const temperature = metar.temp == null ? '—' : `${metar.temp}°C`
    const dewpoint = metar.dewp == null ? '—' : `${metar.dewp}°C`
    const altimeter = metar.altim == null
      ? '—'
      : metar.altim > 200
        ? `${(metar.altim * 0.0295299830714).toFixed(2)} inHg`
        : `${metar.altim.toFixed(2)} inHg`

    const lowestCeilingFt = metar.clouds
      ?.filter((layer) => (layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV') && layer.base != null)
      .map((layer) => layer.base as number)
      .reduce<number | null>((lowest, base) => (lowest == null || base < lowest ? base : lowest), null)

    const ceilingPart = lowestCeilingFt == null ? '' : ` · Ceiling ${lowestCeilingFt.toLocaleString()} ft`

    return `Wind ${windDirection} @ ${windSpeed} · Vis ${visibility} · Temp/Dew ${temperature}/${dewpoint} · Alt ${altimeter}${ceilingPart}`
  }

  function parseVisibilitySm(value: string | null | undefined) {
    if (!value) {
      return null
    }

    const text = value.trim().toUpperCase().replace(/SM$/, '').trim()
    if (!text) {
      return null
    }

    if (/^\d+(?:\.\d+)?\+$/.test(text)) {
      return Number(text.slice(0, -1))
    }

    if (/^P\d+(?:\.\d+)?$/.test(text)) {
      return Number(text.slice(1))
    }

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return Number(text)
    }

    if (/^\d+\s+\d+\/\d+$/.test(text)) {
      const [wholePart, fractionPart] = text.split(/\s+/)
      const [numerator, denominator] = fractionPart.split('/').map(Number)
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null
      }
      return Number(wholePart) + numerator / denominator
    }

    if (/^M?\d+\/\d+$/.test(text)) {
      const normalized = text.startsWith('M') ? text.slice(1) : text
      const [numerator, denominator] = normalized.split('/').map(Number)
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null
      }
      return numerator / denominator
    }

    return null
  }

  function parseCeilingFeetFromMetar(rawMetar: string | undefined) {
    if (!rawMetar) {
      return null
    }

    const tokens = rawMetar.toUpperCase().split(/\s+/)
    let ceilingFeet: number | null = null

    for (const token of tokens) {
      const match = token.match(/^(BKN|OVC|VV)(\d{3})(?:CB|TCU)?$/)
      if (!match) {
        continue
      }

      const heightHundreds = Number(match[2])
      if (!Number.isFinite(heightHundreds)) {
        continue
      }

      const heightFeet = heightHundreds * 100
      ceilingFeet = ceilingFeet == null ? heightFeet : Math.min(ceilingFeet, heightFeet)
    }

    return ceilingFeet
  }

  function getFlightCategory(weather: WeatherResponse | null): FlightCategory {
    const metar = weather?.metar
    if (!metar) {
      return 'Unknown'
    }

    const visibilitySm = parseVisibilitySm(metar.visib)
    const ceilingFeet = parseCeilingFeetFromMetar(metar.rawOb)

    if (visibilitySm == null && ceilingFeet == null) {
      return 'Unknown'
    }

    if ((visibilitySm != null && visibilitySm < 1) || (ceilingFeet != null && ceilingFeet < 500)) {
      return 'LIFR'
    }

    if ((visibilitySm != null && visibilitySm < 3) || (ceilingFeet != null && ceilingFeet < 1000)) {
      return 'IFR'
    }

    if ((visibilitySm != null && visibilitySm <= 5) || (ceilingFeet != null && ceilingFeet <= 3000)) {
      return 'MVFR'
    }

    return 'VFR'
  }

  function formatFrequencyType(type: string, description?: string) {
    const normalized = type.toUpperCase()
    if (normalized.startsWith('ATIS') || normalized.startsWith('AWOS') || normalized.startsWith('ASOS')) return 'Weather'
    if (normalized.startsWith('CTAF')) return 'CTAF'
    if (normalized.startsWith('UNIC')) return 'UNICOM'
    if (normalized.startsWith('TWR')) {
      const normalizedDescription = String(description ?? '').toUpperCase()
      return normalizedDescription.includes('PART-TIME') ? 'Tower (Part-time)' : 'Tower'
    }
    if (normalized.startsWith('GND')) return 'Ground'
    if (normalized.startsWith('APP/DEP')) return 'Approach/Departure'
    if (normalized.startsWith('APP')) return 'Approach'
    if (normalized.startsWith('DEP')) return 'Departure'
    if (normalized.startsWith('CLNC')) return 'Clearance'
    if (normalized.startsWith('RDO')) return 'Flight Service Radio'
    if (normalized.startsWith('FSS')) return 'Flight Service'
    return normalized.slice(0, 6)
  }

  function formatNavaidFrequency(navaid: RouteNavaid) {
    if (navaid.frequencyKhz == null) {
      return '—'
    }

    if (navaid.frequencyKhz >= 100000 || navaid.type.startsWith('VOR') || navaid.type === 'TACAN') {
      return `${(navaid.frequencyKhz / 1000).toFixed(2)} MHz`
    }

    return `${navaid.frequencyKhz} kHz`
  }

  function formatOffRoute(navaid: RouteNavaid) {
    const legFrom = routePoints[navaid.legIndex - 1]
    const legTo = routePoints[navaid.legIndex]

    if (!legFrom || !legTo || !navaid.offRouteDirection) {
      return `? ${navaid.closestDistanceNm.toFixed(1)} NM`
    }

    if (navaid.offRouteDirection === 'center') {
      return `ON ROUTE ${navaid.closestDistanceNm.toFixed(1)} NM`
    }

    const legCourse = initialBearing(legFrom, legTo)
    const perpendicularBearing = normalizeHeading(
      navaid.offRouteDirection === 'left' ? legCourse - 90 : legCourse + 90
    )

    const cardinalLabels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    const cardinalIndex = Math.round(perpendicularBearing / 45) % 8
    const cardinal = cardinalLabels[cardinalIndex]

    return `${cardinal} ${navaid.closestDistanceNm.toFixed(1)} NM`
  }

  async function loadRouteNavaids(points: Point[], navaidTypes: string[] = includedNavaidTypes) {
    if (points.length < 2) {
      setRouteNavaids([])
      return
    }

    try {
      const pointsParam = points.map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`).join(';')
      const typesParam = navaidTypes.join(',')
      const response = await fetchJson<{ navaids: RouteNavaid[] }>(
        `/api/navaids/route?points=${encodeURIComponent(pointsParam)}&types=${encodeURIComponent(typesParam)}`
      )
      setRouteNavaids(response.navaids)
    } catch {
      setRouteNavaids([])
    }
  }

  function toggleIncludedNavaidType(type: string, enabled: boolean) {
    setIncludedNavaidTypes((current) => {
      const nextSet = new Set(current)
      if (enabled) {
        nextSet.add(type)
      } else {
        nextSet.delete(type)
      }

      const next = routeNavaidTypeOptions.filter((option) => nextSet.has(option))
      if (routePoints.length >= 2) {
        void loadRouteNavaids(routePoints, next)
      }

      return next
    })
  }

  async function loadPrintableDiagrams(depAirportResponse: AirportResponse, arrAirportResponse: AirportResponse) {
    setPrintDiagramsLoading(true)

    try {
      const diagramCandidates = [
        { role: 'Departure' as const, airportIcao: depAirportResponse.airport.icao },
        { role: 'Arrival' as const, airportIcao: arrAirportResponse.airport.icao }
      ]

      const loadGeneratedFallbackDiagram = async (airportIcao: string) => {
        try {
          const fallback = await fetchJson<GeneratedAirportDiagramResponse>(
            `/api/airports/${encodeURIComponent(airportIcao)}/diagram?schematic=${showSchematicSurfaceLayout ? '1' : '0'}`
          )

          if (!fallback.runways.features.length) {
            return null
          }

          const imageUrl = renderGeneratedDiagramToImage(fallback)
          if (!imageUrl) {
            return null
          }

          return {
            chartName: 'Airport Diagram',
            imageUrl
          }
        } catch {
          return null
        }
      }

      const resolved = await Promise.all(
        diagramCandidates.map(async (candidate) => {
          let response: AirportDiagramResponse | null = null
          try {
            response = await fetchJson<AirportDiagramResponse>(`/api/airport-diagram/by-airport/${candidate.airportIcao}`)
          } catch {
            response = null
          }

          if (response?.diagram) {
            const imageUrl = await renderPdfFirstPageToImage(response.diagram.proxiedPdfUrl)

            return {
              role: candidate.role,
              airportIcao: candidate.airportIcao,
              chartName: response.diagram.chartName,
              pdfUrl: response.diagram.proxiedPdfUrl,
              imageUrl,
              source: 'faa' as const
            }
          }

          const fallback = await loadGeneratedFallbackDiagram(candidate.airportIcao)
          if (!fallback) {
            return null
          }

          return {
            role: candidate.role,
            airportIcao: candidate.airportIcao,
            chartName: fallback.chartName,
            pdfUrl: null,
            imageUrl: fallback.imageUrl,
            source: 'generated' as const
          }
        })
      )

      setPrintableDiagrams(resolved.filter((item): item is NonNullable<typeof item> => item != null))
    } catch {
      setPrintableDiagrams([])
    } finally {
      setPrintDiagramsLoading(false)
    }
  }

  useEffect(() => {
    const rawLines = waypointsInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (!rawLines.length) {
      setWaypointChips([])
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      const identInputs: string[] = []
      const lineDescriptors = rawLines.map((line, index) => {
        const parts = line.split(',').map((value) => value.trim())

        if (parts.length === 1 && parts[0]) {
          const inputIdent = parts[0].toUpperCase()
          identInputs.push(inputIdent)
          return { index, kind: 'ident' as const, inputIdent }
        }

        if (parts.length === 3) {
          const [ident, latText, lonText] = parts
          const lat = Number(latText)
          const lon = Number(lonText)
          if (ident && !Number.isNaN(lat) && !Number.isNaN(lon)) {
            const inputIdent = ident.toUpperCase()
            identInputs.push(inputIdent)
            return {
              index,
              kind: 'manual' as const,
              inputIdent
            }
          }
        }

        return { index, kind: 'invalid' as const, label: line }
      })

      const resolvedByInput = new Map<string, ResolvedWaypoint>()
      if (identInputs.length) {
        try {
          const uniqueIdents = Array.from(new Set(identInputs))
          const response = await fetchJson<WaypointResolveResponse>(
            `/api/waypoints/resolve?idents=${encodeURIComponent(uniqueIdents.join(','))}`
          )
          response.waypoints.forEach((waypoint) => {
            resolvedByInput.set(waypoint.inputIdent.toUpperCase(), waypoint)
          })
        } catch {
          if (!cancelled) {
            setWaypointChips([])
          }
          return
        }
      }

      const nextChips: WaypointChip[] = lineDescriptors.map((descriptor) => {
        if (descriptor.kind === 'manual') {
          const resolved = resolvedByInput.get(descriptor.inputIdent)
          if (resolved) {
            return {
              key: `resolved-manual-${descriptor.index}`,
              label: resolved.ident,
              detail: resolved.source === 'navaid' && resolved.navaidType
                ? `${resolved.navaidType} · ${resolved.name} · Manual coords`
                : `${resolved.name} · Manual coords`,
              status: 'resolved'
            }
          }

          return {
            key: `manual-${descriptor.index}`,
            label: descriptor.inputIdent,
            detail: 'Manual waypoint',
            status: 'manual'
          }
        }

        if (descriptor.kind === 'invalid') {
          return {
            key: `invalid-${descriptor.index}`,
            label: descriptor.label,
            detail: 'Invalid format',
            status: 'invalid'
          }
        }

        const resolved = resolvedByInput.get(descriptor.inputIdent)
        if (!resolved) {
          return {
            key: `unknown-${descriptor.index}`,
            label: descriptor.inputIdent,
            detail: 'Unrecognized ident',
            status: 'unknown'
          }
        }

        return {
          key: `resolved-${descriptor.index}`,
          label: resolved.ident,
          detail: resolved.source === 'navaid' && resolved.navaidType ? `${resolved.navaidType} · ${resolved.name}` : resolved.name,
          status: 'resolved'
        }
      })

      if (!cancelled) {
        setWaypointChips(nextChips)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [waypointsInput])

  async function renderPdfFirstPageToImage(pdfUrl: string) {
    try {
      const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`

      const loadingTask = pdfjsLib.getDocument({ url: pdfUrl })
      const pdf = await loadingTask.promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2.2 })

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) {
        await pdf.destroy()
        return null
      }

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)

      await page.render({ canvasContext: context, viewport }).promise
      const imageUrl = canvas.toDataURL('image/png')

      page.cleanup()
      await pdf.destroy()
      return imageUrl
    } catch {
      return null
    }
  }

  async function recomputeRouteCalculations(points: Point[]) {
    if (points.length < 2) {
      setLegs([])
      return
    }

    const requestId = recalcRequestIdRef.current + 1
    recalcRequestIdRef.current = requestId

    setLegs(
      computeLegs(
        points,
        tas,
        fallbackWindDir,
        fallbackWindSpeed,
        fuelBurn,
        undefined,
        undefined,
        compassDeviation
      )
    )

    try {
      const midpointWinds = await fetchJson<WindsAloftResponse>(
        `/api/winds-aloft?depLat=${points[0].lat}&depLon=${points[0].lon}&arrLat=${points[points.length - 1].lat}&arrLon=${points[points.length - 1].lon}&altitudeFt=${cruiseAltitudeFt}`
      )

      if (requestId !== recalcRequestIdRef.current) {
        return
      }

      const resolvedWindDir = midpointWinds.direction ?? fallbackWindDir
      const resolvedWindSpeed = midpointWinds.speed || fallbackWindSpeed

      const legWindResults = await Promise.allSettled(
        points.slice(0, -1).map(async (point, index) => {
          const nextPoint = points[index + 1]
          const response = await fetchJson<WindsAloftResponse>(
            `/api/winds-aloft?depLat=${point.lat}&depLon=${point.lon}&arrLat=${nextPoint.lat}&arrLon=${nextPoint.lon}&altitudeFt=${cruiseAltitudeFt}`
          )

          return {
            direction: response.direction,
            speed: response.speed,
            station: response.station
          }
        })
      )

      const legVariationResults = await Promise.allSettled(
        points.slice(0, -1).map(async (point, index) => {
          const nextPoint = points[index + 1]
          const midpointLat = (point.lat + nextPoint.lat) / 2
          const midpointLon = (point.lon + nextPoint.lon) / 2
          const response = await fetchJson<MagneticVariationResponse>(
            `/api/magnetic-variation?lat=${midpointLat}&lon=${midpointLon}`
          )
          return response.declination
        })
      )

      if (requestId !== recalcRequestIdRef.current) {
        return
      }

      const legWindData = legWindResults.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : { direction: resolvedWindDir, speed: resolvedWindSpeed, station: 'Fallback' }
      )

      const legVariations = legVariationResults.map((result) =>
        result.status === 'fulfilled' ? result.value : 0
      )

      setLegs(
        computeLegs(
          points,
          tas,
          resolvedWindDir,
          resolvedWindSpeed,
          fuelBurn,
          legWindData,
          legVariations,
          compassDeviation
        )
      )
    } catch (caughtError) {
      if (requestId === recalcRequestIdRef.current) {
        setError((caughtError as Error).message)
      }
    }
  }

  async function buildNavLog() {
    setLoading(true)
    setError(null)

    try {
      const depIcao = departure.trim().toUpperCase()
      const arrIcao = arrival.trim().toUpperCase()

      const [
        depAirportResponse,
        arrAirportResponse,
        depWeatherResponse,
        arrWeatherResponse,
        depFrequencyResponse,
        arrFrequencyResponse,
        depRunwayResponse,
        arrRunwayResponse
      ] = await Promise.all([
        fetchJson<AirportResponse>(`/api/airport/${depIcao}`),
        fetchJson<AirportResponse>(`/api/airport/${arrIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${depIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${arrIcao}`),
        fetchJson<FrequencyResponse>(`/api/frequencies/${depIcao}`),
        fetchJson<FrequencyResponse>(`/api/frequencies/${arrIcao}`),
        fetchJson<RunwayResponse>(`/api/runways/${depIcao}`),
        fetchJson<RunwayResponse>(`/api/runways/${arrIcao}`)
      ])

      const suggestionResponse = await fetchJson<{ suggestions: SuggestedWaypoint[] }>(
        `/api/route/suggestions?depLat=${depAirportResponse.airport.lat}&depLon=${depAirportResponse.airport.lon}&arrLat=${arrAirportResponse.airport.lat}&arrLon=${arrAirportResponse.airport.lon}`
      )

      setDepAirport(depAirportResponse)
      setArrAirport(arrAirportResponse)
      setDepWeather(depWeatherResponse)
      setArrWeather(arrWeatherResponse)
      setDepFrequencies(depFrequencyResponse.frequencies)
      setArrFrequencies(arrFrequencyResponse.frequencies)
      setDepRunways(depRunwayResponse.runways)
      setArrRunways(arrRunwayResponse.runways)

      await loadPrintableDiagrams(depAirportResponse, arrAirportResponse)

      if (!waypointsInput.trim() && suggestionResponse.suggestions.length) {
        const value = suggestionResponse.suggestions
          .map((waypoint) => waypoint.ident)
          .join('\n')
        setWaypointsInput(value)
      }

      const userWaypoints = await parseWaypointLines()
      const waypointPoints: Point[] = userWaypoints.length
        ? userWaypoints
        : suggestionResponse.suggestions.map((waypoint) => ({
          ident: waypoint.ident,
          lat: waypoint.lat,
          lon: waypoint.lon,
          originalIdent: waypoint.ident,
          originalLat: waypoint.lat,
          originalLon: waypoint.lon
        }))

      const points: Point[] = [
        {
          ident: depAirportResponse.airport.icao,
          lat: depAirportResponse.airport.lat,
          lon: depAirportResponse.airport.lon,
          originalIdent: depAirportResponse.airport.icao,
          originalLat: depAirportResponse.airport.lat,
          originalLon: depAirportResponse.airport.lon
        },
        ...waypointPoints,
        {
          ident: arrAirportResponse.airport.icao,
          lat: arrAirportResponse.airport.lat,
          lon: arrAirportResponse.airport.lon,
          originalIdent: arrAirportResponse.airport.icao,
          originalLat: arrAirportResponse.airport.lat,
          originalLon: arrAirportResponse.airport.lon
        }
      ]

      setRoutePoints(points)
      await Promise.all([
        recomputeRouteCalculations(points),
        loadRouteNavaids(points)
      ])

    } catch (caughtError) {
      setError((caughtError as Error).message)
      setLegs([])
      setPrintableDiagrams([])
      setDepFrequencies([])
      setArrFrequencies([])
      setDepRunways([])
      setArrRunways([])
      setRouteNavaids([])
      setRoutePoints([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!mapContainerRef.current) {
      return
    }

    let cancelled = false
    const mapResizeTimers: number[] = []

    async function renderInteractivePlanMap() {
      const leaflet = await import('leaflet')
      if (cancelled || !mapContainerRef.current) {
        return
      }

      const mapTileLoadKey = `${selectedBaseMap.id}|${showFaaCharts ? selectedPlanLayer.id : 'basemap-only'}`
      const shouldShowTileLoader = !mapRef.current || lastMapTileLoadKeyRef.current !== mapTileLoadKey
      if (shouldShowTileLoader) {
        setMapTilesLoading(true)
        lastMapTileLoadKeyRef.current = mapTileLoadKey
      }

      const isRetinaDisplay = typeof window !== 'undefined' && window.devicePixelRatio > 1
      const faaMaxInteractiveZoom = Math.max(
        selectedPlanLayer.minZoom,
        selectedPlanLayer.maxZoom - (isRetinaDisplay ? 1 : 0)
      )
      const maxInteractiveZoom = showFaaCharts
        ? faaMaxInteractiveZoom
        : Math.max(selectedPlanLayer.maxZoom, selectedBaseMap.maxZoom)

      setPlanMapError(null)

      if (!mapRef.current) {
        setMapInitializing(true)
        mapRef.current = leaflet.map(mapContainerRef.current, {
          center: [39.5, -98.35],
          zoom: selectedPlanLayer.minZoom,
          minZoom: selectedPlanLayer.minZoom,
          maxZoom: maxInteractiveZoom,
          zoomControl: false,
          attributionControl: true
        })

        leaflet.control.zoom({ position: 'bottomleft' }).addTo(mapRef.current)

        mapResizeTimers.push(window.setTimeout(() => {
          if (!cancelled && mapRef.current) {
            forceMapRelayout()
          }
        }, 0))

        mapResizeTimers.push(window.setTimeout(() => {
          if (!cancelled && mapRef.current) {
            forceMapRelayout()
          }
        }, 220))

        if (!hasRunInitialRelayoutRef.current) {
          hasRunInitialRelayoutRef.current = true
          mapResizeTimers.push(window.setTimeout(() => {
            if (!cancelled && mapRef.current) {
              forceMapRelayout()
            }
          }, 650))
        }

        recenterToUserLocation(false)

        mapRef.current.on('click', async (event: { latlng: { lat: number; lng: number } }) => {
          if (suppressNextMapClickRef.current) {
            suppressNextMapClickRef.current = false
            return
          }

          setSelectedMapAirportLoading(true)
          try {
            const nearest = await fetchJson<NearestAirportResponse>(
              `/api/airport/nearest?lat=${event.latlng.lat}&lon=${event.latlng.lng}`
            )
            setSelectedMapAirport(nearest)
            setSelectedMapAirportDistanceNm(nearest.distanceNm)
            setSelectedMapAirportError(null)

            try {
              const weather = await fetchJson<WeatherResponse>(`/api/weather/${nearest.airport.icao}`)
              setSelectedMapAirportWeather(weather)
            } catch {
              setSelectedMapAirportWeather(null)
            }
          } catch {
            setSelectedMapAirport(null)
            setSelectedMapAirportDistanceNm(null)
            setSelectedMapAirportWeather(null)
            setSelectedMapAirportError('No nearby airport information available at this map position.')
          } finally {
            setSelectedMapAirportLoading(false)
          }
        })
      }

      const map = mapRef.current
      forceMapRelayout()
      map.setMinZoom(selectedPlanLayer.minZoom)
      map.setMaxZoom(maxInteractiveZoom)

      if (!airportDiagramsLayerRef.current) {
        airportDiagramsLayerRef.current = new AirportDiagramsLayer(map, {
          enabled: showAirportDiagrams,
          schematicEnabled: showSchematicSurfaceLayout,
          mode: selectedMapAirport ? 'selected' : 'in-view',
          selectedAirportIdent: selectedMapAirport?.airport.icao ?? null,
          maxAirports: 30,
          minZoom: 11
        })
      } else {
        airportDiagramsLayerRef.current.setEnabled(showAirportDiagrams)
        airportDiagramsLayerRef.current.setSchematicEnabled(showSchematicSurfaceLayout)
        airportDiagramsLayerRef.current.setMode(selectedMapAirport ? 'selected' : 'in-view')
        airportDiagramsLayerRef.current.setSelectedAirportIdent(selectedMapAirport?.airport.icao ?? null)
        airportDiagramsLayerRef.current.refreshNow()
      }

      function applyFallbackTileLayer(message?: string) {
        if (!mapRef.current) {
          return
        }

        if (chartLayerRef.current) {
          map.removeLayer(chartLayerRef.current)
          chartLayerRef.current = null
        }

        if (message) {
          setPlanMapError(message)
        }
      }

      if (chartLayerRef.current) {
        map.removeLayer(chartLayerRef.current)
      }

      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current)
      }

      const baseLayer = leaflet.tileLayer(selectedBaseMap.tileUrl, {
        minZoom: selectedPlanLayer.minZoom,
        maxZoom: Math.max(selectedPlanLayer.maxZoom, selectedBaseMap.maxZoom),
        attribution: selectedBaseMap.attribution,
        detectRetina: true
      })

      baseLayer.addTo(map)
      baseLayer.setZIndex(0)
      baseLayerRef.current = baseLayer

      let mapLoadingTimeoutId = window.setTimeout(() => {
        if (!cancelled) {
          setMapInitializing(false)
          setMapTilesLoading(false)
        }
      }, 6000)

      baseLayer.once('load', () => {
        if (!cancelled && !showFaaCharts) {
          forceMapRelayout()
          setMapInitializing(false)
          setMapTilesLoading(false)
          window.clearTimeout(mapLoadingTimeoutId)
        }
      })

      baseLayer.on('load', () => {
        if (!cancelled && mapRef.current) {
          forceMapRelayout()
        }
      })

      if (!showFaaCharts) {
        chartLayerRef.current = null
      } else if (!selectedPlanLayer.tileUrl || selectedPlanLayer.tileUrl.startsWith('REPLACE_WITH_')) {
        applyFallbackTileLayer('FAA chart tiles unavailable. Showing selected base map.')
      } else {
        let chartLayerLoaded = false

        const tileLayer = leaflet.tileLayer(selectedPlanLayer.tileUrl, {
          minZoom: selectedPlanLayer.minZoom,
          maxZoom: selectedPlanLayer.maxZoom,
          minNativeZoom: selectedPlanLayer.minNativeZoom,
          maxNativeZoom: selectedPlanLayer.maxZoom,
          attribution: selectedPlanLayer.attribution,
          detectRetina: true,
          crossOrigin: true,
          keepBuffer: 4,
          updateWhenIdle: false
        })

        tileLayer.on('tileerror', () => {
          if (!chartLayerLoaded && !cancelled) {
            setMapInitializing(false)
            setMapTilesLoading(false)
            window.clearTimeout(mapLoadingTimeoutId)
          }
        })

        tileLayer.on('tileload', () => {
          chartLayerLoaded = true
        })

        tileLayer.once('load', () => {
          chartLayerLoaded = true
          if (!cancelled) {
            setMapInitializing(false)
            setMapTilesLoading(false)
            window.clearTimeout(mapLoadingTimeoutId)
          }
        })

        tileLayer.addTo(map)
        tileLayer.setZIndex(10)
        chartLayerRef.current = tileLayer
      }

      if (!hasRunInitialTileRefreshRef.current) {
        hasRunInitialTileRefreshRef.current = true

        mapResizeTimers.push(window.setTimeout(() => {
          if (cancelled || !mapRef.current) {
            return
          }

          mapRef.current.invalidateSize()
          if (typeof baseLayerRef.current?.redraw === 'function') {
            baseLayerRef.current.redraw()
          }
          if (typeof chartLayerRef.current?.redraw === 'function') {
            chartLayerRef.current.redraw()
          }
        }, 320))

        mapResizeTimers.push(window.setTimeout(() => {
          if (cancelled || !mapRef.current) {
            return
          }

          mapRef.current.invalidateSize()

          if (baseLayerRef.current && mapRef.current.hasLayer(baseLayerRef.current)) {
            mapRef.current.removeLayer(baseLayerRef.current)
            baseLayerRef.current.addTo(mapRef.current)
            if (typeof baseLayerRef.current.setZIndex === 'function') {
              baseLayerRef.current.setZIndex(0)
            }
          }

          if (chartLayerRef.current && mapRef.current.hasLayer(chartLayerRef.current)) {
            mapRef.current.removeLayer(chartLayerRef.current)
            chartLayerRef.current.addTo(mapRef.current)
            if (typeof chartLayerRef.current.setZIndex === 'function') {
              chartLayerRef.current.setZIndex(10)
            }
          }
        }, 1100))
      }

      if (tfrLayerRef.current) {
        map.removeLayer(tfrLayerRef.current)
        tfrLayerRef.current = null
      }

      if (showTfrOverlay) {
        void (async () => {
          try {
            const tfrData = await fetchJson<TfrFeatureCollection>('/api/tfrs')
            if (!cancelled && mapRef.current) {
              tfrLayerRef.current = leaflet.geoJSON(tfrData as any, {
                style: {
                  color: '#d81b60',
                  weight: 2,
                  fillColor: '#d81b60',
                  fillOpacity: 0.12
                },
                onEachFeature: (feature: { properties?: Record<string, unknown> }, layer: { bindPopup: (content: string) => void }) => {
                  const popupHtml = buildTfrPopupHtml(feature.properties ?? {})
                  layer.bindPopup(popupHtml)
                }
              })
              tfrLayerRef.current.addTo(map)
            }
          } catch {
            setPlanMapError((current) => current ?? 'Unable to load TFR overlay.')
          }
        })()
      }

      if (routePoints.length < 2) {
        if (routeLayerRef.current) {
          map.removeLayer(routeLayerRef.current)
          routeLayerRef.current = null
        }

        if (markerLayerRef.current) {
          map.removeLayer(markerLayerRef.current)
          markerLayerRef.current = null
        }

        if (userLocation) {
          map.setView([userLocation.lat, userLocation.lon], Math.max(selectedPlanLayer.minZoom, defaultLocationZoom))
        }

        if (!cancelled) {
          setMapInitializing(false)
        }

        return
      }

      if (routeLayerRef.current) {
        map.removeLayer(routeLayerRef.current)
      }

      if (markerLayerRef.current) {
        map.removeLayer(markerLayerRef.current)
      }

      routeLayerRef.current = leaflet.polyline(
        routePoints.map((point) => [point.lat, point.lon]),
        {
          color: '#d00000',
          weight: 3,
          opacity: 0.95
        }
      )

      const findClosestLegIndex = (lat: number, lon: number) => {
        if (routePoints.length < 2) {
          return 0
        }

        const toLayerPoint = (valueLat: number, valueLon: number) => map.latLngToLayerPoint([valueLat, valueLon])
        const point = toLayerPoint(lat, lon)
        let closestLegIndex = 0
        let closestDistanceSquared = Number.POSITIVE_INFINITY

        for (let i = 0; i < routePoints.length - 1; i += 1) {
          const from = toLayerPoint(routePoints[i].lat, routePoints[i].lon)
          const to = toLayerPoint(routePoints[i + 1].lat, routePoints[i + 1].lon)
          const dx = to.x - from.x
          const dy = to.y - from.y
          const denominator = dx * dx + dy * dy
          const ratio = denominator === 0
            ? 0
            : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / denominator))
          const projectedX = from.x + ratio * dx
          const projectedY = from.y + ratio * dy
          const distanceSquared = (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2

          if (distanceSquared < closestDistanceSquared) {
            closestDistanceSquared = distanceSquared
            closestLegIndex = i
          }
        }

        return closestLegIndex
      }

      const buildInsertedRoute = (legIndex: number, lat: number, lon: number) => {
        const inserted = [...routePoints]
        inserted.splice(legIndex + 1, 0, {
          ident: `WP${legIndex + 1}`,
          lat,
          lon,
          originalIdent: `WP${legIndex + 1}`,
          originalLat: lat,
          originalLon: lon
        })
        return inserted
      }

      routeLayerRef.current.on('mousedown', (event: {
        latlng: { lat: number; lng: number }
        originalEvent?: { preventDefault?: () => void; stopPropagation?: () => void }
      }) => {
        if (!mapRef.current || routePoints.length < 2) {
          return
        }

        event.originalEvent?.preventDefault?.()
        event.originalEvent?.stopPropagation?.()

        suppressNextMapClickRef.current = true
        setRouteInsertDragging(true)

        const legIndex = findClosestLegIndex(event.latlng.lat, event.latlng.lng)
        let dragLat = event.latlng.lat
        let dragLon = event.latlng.lng

        const insertHandleIcon = leaflet.divIcon({
          className: 'route-insert-handle-icon',
          html: '<span class="route-insert-handle" aria-hidden="true">+</span>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })

        if (routeInsertHandleRef.current) {
          map.removeLayer(routeInsertHandleRef.current)
          routeInsertHandleRef.current = null
        }

        routeInsertHandleRef.current = leaflet.marker([dragLat, dragLon], {
          icon: insertHandleIcon,
          interactive: false
        }).addTo(map)

        const updatePreview = () => {
          if (!routeLayerRef.current) {
            return
          }

          const preview = buildInsertedRoute(legIndex, dragLat, dragLon)
          routeLayerRef.current.setLatLngs(preview.map((point) => [point.lat, point.lon]))

          if (routeInsertHandleRef.current) {
            routeInsertHandleRef.current.setLatLng([dragLat, dragLon])
          }
        }

        updatePreview()
        map.dragging.disable()

        const handleMouseMove = (moveEvent: { latlng: { lat: number; lng: number } }) => {
          dragLat = moveEvent.latlng.lat
          dragLon = moveEvent.latlng.lng
          updatePreview()
        }

        const handleMouseUp = (upEvent: { latlng: { lat: number; lng: number } }) => {
          map.off('mousemove', handleMouseMove)
          map.off('mouseup', handleMouseUp)
          map.dragging.enable()
          setRouteInsertDragging(false)

          if (routeInsertHandleRef.current) {
            map.removeLayer(routeInsertHandleRef.current)
            routeInsertHandleRef.current = null
          }

          void (async () => {
            try {
              const finalLat = upEvent.latlng.lat
              const finalLon = upEvent.latlng.lng
              const landmark = await fetchJson<LandmarkNameResponse>(
                `/api/landmark-name?lat=${finalLat}&lon=${finalLon}`
              )

              const waypointIdent = landmark.ident ?? `WP${legIndex + 1}`
              const insertedPoints = [...routePoints]
              insertedPoints.splice(legIndex + 1, 0, {
                ident: waypointIdent,
                lat: finalLat,
                lon: finalLon,
                originalIdent: waypointIdent,
                originalLat: finalLat,
                originalLon: finalLon
              })

              setRoutePoints(insertedPoints)
              setWaypointsInput(toWaypointInputFromRoute(insertedPoints))
              await Promise.all([
                recomputeRouteCalculations(insertedPoints),
                loadRouteNavaids(insertedPoints)
              ])
            } catch (caughtError) {
              if (routeLayerRef.current) {
                routeLayerRef.current.setLatLngs(routePoints.map((point) => [point.lat, point.lon]))
              }

              setError((caughtError as Error).message)
            }
          })()
        }

        map.on('mousemove', handleMouseMove)
        map.on('mouseup', handleMouseUp)
      })

      routeLayerRef.current.addTo(map)
      map.fitBounds(routeLayerRef.current.getBounds(), { padding: [20, 20] })

      const markers = routePoints.map((point, index) => {
        const isEndpoint = index === 0 || index === routePoints.length - 1
        const markerClass = index === 0 ? 'marker-start' : index === routePoints.length - 1 ? 'marker-end' : 'marker-waypoint'
        const icon = leaflet.divIcon({
          className: 'route-marker-icon',
          html: `<span class="route-marker ${markerClass}" title="${point.ident}"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        })

        const marker = leaflet.marker([point.lat, point.lon], { icon, draggable: !isEndpoint })

        marker.on('click', async () => {
          if (mapRef.current) {
            mapRef.current.panTo([point.lat, point.lon])
          }

          await selectMapAirportFromIdent(point.ident)
        })

        if (!isEndpoint) {
          marker.on('drag', () => {
            if (!routeLayerRef.current) {
              return
            }

            const markerLatLng = marker.getLatLng()
            const livePoints = routePoints.map((value, pointIndex) =>
              pointIndex === index
                ? { ...value, lat: markerLatLng.lat, lon: markerLatLng.lng }
                : value
            )

            routeLayerRef.current.setLatLngs(livePoints.map((value) => [value.lat, value.lon]))
          })

          marker.on('dragend', async () => {
            try {
              const markerLatLng = marker.getLatLng()
              const currentPoint = routePoints[index]
              const originalIdent = currentPoint.originalIdent ?? currentPoint.ident
              const originalLat = currentPoint.originalLat ?? currentPoint.lat
              const originalLon = currentPoint.originalLon ?? currentPoint.lon
              const movedFromOriginalNm = haversineNm(
                { ident: originalIdent, lat: originalLat, lon: originalLon },
                { ident: originalIdent, lat: markerLatLng.lat, lon: markerLatLng.lng }
              )

              let movedIdent = originalIdent

              if (movedFromOriginalNm > 0.1) {
                const landmark = await fetchJson<LandmarkNameResponse>(
                  `/api/landmark-name?lat=${markerLatLng.lat}&lon=${markerLatLng.lng}`
                )

                movedIdent = landmark.ident ?? `WP${index}`
              }

              if (movedFromOriginalNm <= 0.1) {
                movedIdent = originalIdent
              }

              const updatedPoints = routePoints.map((value, pointIndex) =>
                pointIndex === index
                  ? {
                    ...value,
                    ident: movedIdent,
                    lat: markerLatLng.lat,
                    lon: markerLatLng.lng,
                    originalIdent,
                    originalLat,
                    originalLon
                  }
                  : value
              )

              setRoutePoints(updatedPoints)
              setWaypointsInput(toWaypointInputFromRoute(updatedPoints))
              await Promise.all([
                recomputeRouteCalculations(updatedPoints),
                loadRouteNavaids(updatedPoints)
              ])
            } catch (caughtError) {
              setError((caughtError as Error).message)
            }
          })
        }

        return marker
      })

      markerLayerRef.current = leaflet.layerGroup(markers)
      markerLayerRef.current.addTo(map)

      if (!cancelled) {
        setMapInitializing(false)
      }
    }

    renderInteractivePlanMap().catch((caughtError) => {
      const message = (caughtError as Error).message || 'Failed to render route editing map.'
      setPlanMapError(message)
    })

    return () => {
      cancelled = true
      mapResizeTimers.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [
    routePoints,
    selectedPlanLayer,
    selectedBaseMap,
    showFaaCharts,
    showTfrOverlay,
    userLocation,
    showAirportDiagrams,
    showSchematicSurfaceLayout,
    selectedMapAirport
  ])

  useEffect(() => {
    if (!mapContainerRef.current || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      if (mapRef.current) {
        forceMapRelayout()
      }
    })

    observer.observe(mapContainerRef.current)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (airportDiagramsLayerRef.current) {
        airportDiagramsLayerRef.current.destroy()
      }

      if (mapRef.current) {
        mapRef.current.remove()
      }

      airportDiagramsLayerRef.current = null
      mapRef.current = null
      baseLayerRef.current = null
      chartLayerRef.current = null
      tfrLayerRef.current = null
      routeLayerRef.current = null
      markerLayerRef.current = null
      routeInsertHandleRef.current = null
    }
  }, [])

  return (
    <main className="app">
      <section className="screen-only map-shell">
        <div className="map-workspace">
          <div
            ref={mapContainerRef}
            className={`sectional-map${routeInsertDragging ? ' sectional-map-route-insert' : ''}`}
          />

          {(mapInitializing || mapTilesLoading) && (
            <div className="map-loading-overlay" role="status" aria-live="polite">
              <span className="map-loading-spinner" aria-hidden="true" />
              <p>{mapInitializing ? 'Loading map…' : 'Loading map tiles…'}</p>
            </div>
          )}

          <div className="map-search-overlay" ref={mapSearchContainerRef}>
            <div className="map-search-actions">
              <button
                type="button"
                className="map-ask-ai-toggle"
                onClick={() => setAiDrawerOpen((current) => !current)}
              >
                Ask AI
              </button>
            </div>
            <label className="map-search-box">
              <span className="map-search-icon" aria-hidden="true">⌕</span>
              <input
                type="text"
                value={mapAirportSearchQuery}
                onChange={(event) => setMapAirportSearchQuery(event.target.value)}
                onFocus={() => setMapAirportSearchFocused(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && mapAirportSearchResults[0]) {
                    event.preventDefault()
                    void selectMapAirportFromSearch(mapAirportSearchResults[0])
                  }
                }}
                placeholder="Search"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            {showMapAirportSearchPanel && (
              <div className="map-airport-search-panel" role="listbox" aria-label="Airport search results">
                {trimmedMapAirportSearchQuery.length === 1 && (
                  <p className="map-airport-search-status">Type at least 2 characters to search.</p>
                )}
                {mapAirportSearchLoading && (
                  <p className="map-airport-search-status">Searching airports…</p>
                )}
                {mapAirportSearchError && (
                  <p className="map-airport-search-status map-airport-search-status-error">{mapAirportSearchError}</p>
                )}

                {trimmedMapAirportSearchQuery.length >= 2 && !mapAirportSearchLoading && !mapAirportSearchError && (
                  mapAirportSearchResults.length === 0 ? (
                    <p className="map-airport-search-status">No airport matches found.</p>
                  ) : (
                    <ul className="map-airport-search-results">
                      {mapAirportSearchResults.map((airport) => (
                        <li key={`${airport.ident}-${airport.lat}-${airport.lon}`}>
                          <button
                            type="button"
                            onClick={() => {
                              void selectMapAirportFromSearch(airport)
                            }}
                          >
                            <span className="map-airport-search-ident-row">
                              <span className="map-airport-search-ident">{airport.ident}</span>
                              {(() => {
                                const ident = airport.ident.toUpperCase()
                                const isLoading = Boolean(mapAirportSearchFlightConditionsLoading[ident])
                                const category = mapAirportSearchFlightConditions[ident] ?? 'Unknown'

                                return (
                                  <span
                                    className={`map-airport-search-flight-badge ${
                                      isLoading
                                        ? 'map-airport-search-flight-badge-loading'
                                        : `map-airport-search-flight-badge-${category.toLowerCase()}`
                                    }`}
                                    aria-label={isLoading ? 'Flight conditions loading' : `Flight conditions ${category}`}
                                  >
                                    {isLoading ? '...' : category}
                                  </span>
                                )
                              })()}
                            </span>
                            <span className="map-airport-search-name">{airport.name}</span>
                            <span className="map-airport-search-meta">
                              {[airport.city, airport.state, 'USA'].filter(Boolean).join(', ')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            )}
          </div>

          <AiDrawer
            isOpen={aiDrawerOpen}
            onClose={() => setAiDrawerOpen(false)}
            context={getCurrentAiContext()}
          />

          {(selectedMapAirport || selectedMapAirportError) && (
            <div className="map-airport-info-overlay">
              {selectedMapAirport && (
                <article className="map-airport-info">
                  <header className="map-airport-info-header">
                    <div>
                      <p className="map-airport-info-eyebrow">Airport Info</p>
                      <h3>{selectedMapAirport.airport.icao} — {selectedMapAirport.airport.name}</h3>
                    </div>
                    <button type="button" className="map-airport-info-close" onClick={clearSelectedMapAirport} aria-label="Close airport info">×</button>
                  </header>

                  {selectedMapAirportLoading && (
                    <div className="map-airport-loading-inline" role="status" aria-live="polite">
                      <span className="map-loading-spinner map-loading-spinner-small" aria-hidden="true" />
                      <span>Loading airport details…</span>
                    </div>
                  )}

                  <div className={`map-airport-flight-conditions map-airport-flight-conditions-${selectedMapAirportFlightCategory.toLowerCase()}`}>
                    {selectedMapAirportFlightCategory}
                  </div>

                  <nav className="map-airport-tabs" aria-label="Airport detail tabs">
                    {mapAirportTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`map-airport-tab${selectedMapAirportTab === tab.id ? ' active' : ''}`}
                        onClick={() => setSelectedMapAirportTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </nav>

                  <div className="map-airport-tab-content">
                    {selectedMapAirportTab === 'weather' && (
                      <>
                        <p>{formatDecodedWeather(selectedMapAirportWeather)}</p>
                        {selectedMapAirportWeather?.sourceStation && (
                          <p>
                            Source: {selectedMapAirportWeather.sourceStation}
                            {selectedMapAirportWeather.fallbackUsed ? ' (nearest reporting station)' : ''}
                          </p>
                        )}
                        {selectedMapAirportWeather?.fallbackUsed && selectedMapAirportWeather.nearestReportingStation && (
                          <p>
                            Nearest station: {selectedMapAirportWeather.nearestReportingStation.icao}
                            {' · '}
                            {selectedMapAirportWeather.nearestReportingStation.name}
                            {' · '}
                            {selectedMapAirportWeather.nearestReportingStation.distanceNm.toFixed(1)} NM
                          </p>
                        )}
                        {selectedMapAirportMetarRaw && <p>METAR: {selectedMapAirportMetarRaw}</p>}
                        {selectedMapAirportWeather?.taf?.rawTAF && <p>TAF: {selectedMapAirportWeather.taf.rawTAF}</p>}
                        {selectedMapAirportMetarForAi && (
                          <BriefCard
                            title="METAR Brief"
                            cacheKey={`metar:${selectedMapAirportMetarForAi}`}
                            onGenerate={() => decodeMetarBrief(selectedMapAirportMetarForAi)}
                            autoGenerate
                            hideActions
                          />
                        )}
                        {selectedMapAirportTafForBrief && (
                          <BriefCard
                            title="TAF Brief"
                            cacheKey={`taf:${selectedMapAirportTafForBrief}`}
                            onGenerate={() => decodeTafBrief(selectedMapAirportTafForBrief)}
                            autoGenerate
                            hideActions
                          />
                        )}
                        {selectedMapAirportMosForBrief && (
                          <BriefCard
                            title="MOS Brief"
                            cacheKey={`mos:${selectedMapAirportMosForBrief.station ?? selectedMapAirportIcao ?? 'unknown'}:${selectedMapAirportMosForBrief.mavRaw ?? ''}:${selectedMapAirportMosForBrief.mexRaw ?? ''}:${selectedMapAirportMosForBrief.metRaw ?? ''}`}
                            onGenerate={() => decodeMosBrief(selectedMapAirportMosForBrief)}
                            autoGenerate
                            hideActions
                          />
                        )}
                      </>
                    )}

                    {selectedMapAirportTab === 'general' && (
                      <>
                        <p>
                          Position: {selectedMapAirport.airport.lat.toFixed(4)}, {selectedMapAirport.airport.lon.toFixed(4)}
                        </p>
                        <p>
                          State/Country: {[selectedMapAirport.airport.state, selectedMapAirport.airport.country].filter(Boolean).join(', ') || '—'}
                        </p>
                        <p>
                          Elevation: {selectedMapAirport.airport.elevationMeters == null
                            ? '—'
                            : `${(selectedMapAirport.airport.elevationMeters * 3.28084).toFixed(0)} ft`}
                        </p>
                        <p>
                          ICAO/IATA/FAA: {selectedMapAirport.airport.icao} / {selectedMapAirport.airport.iata ?? '—'} / {selectedMapAirport.airport.faa ?? '—'}
                        </p>
                        {selectedMapAirportDistanceNm != null && <p>Distance from click: {selectedMapAirportDistanceNm.toFixed(1)} NM</p>}
                        <BriefCard
                          title="AI Brief"
                          actionLabel="AI airport brief"
                          cacheKey={`airport:${selectedMapAirport.airport.icao}`}
                          onGenerate={() => airportBrief(selectedMapAirport)}
                        />
                      </>
                    )}

                    {selectedMapAirportTab === 'winds' && (
                      <>
                        <p>
                          Surface wind: {selectedMapAirportWeather?.metar?.wdir == null ? 'VRB' : `${selectedMapAirportWeather.metar.wdir}°`} @ {selectedMapAirportWeather?.metar?.wspd == null ? '—' : `${selectedMapAirportWeather.metar.wspd} kt`}
                        </p>
                        <p>Visibility: {selectedMapAirportWeather?.metar?.visib ? `${selectedMapAirportWeather.metar.visib} SM` : '—'}</p>
                        <p>
                          Altimeter: {selectedMapAirportWeather?.metar?.altim == null
                            ? '—'
                            : selectedMapAirportWeather.metar.altim > 200
                              ? `${(selectedMapAirportWeather.metar.altim * 0.0295299830714).toFixed(2)} inHg`
                              : `${selectedMapAirportWeather.metar.altim.toFixed(2)} inHg`}
                        </p>
                        <p>
                          Temp / Dew: {selectedMapAirportWeather?.metar?.temp == null ? '—' : `${selectedMapAirportWeather.metar.temp}°C`} / {selectedMapAirportWeather?.metar?.dewp == null ? '—' : `${selectedMapAirportWeather.metar.dewp}°C`}
                        </p>
                      </>
                    )}

                    {selectedMapAirportTab === 'frequencies' && (
                      <>
                        {selectedMapAirportFrequenciesLoading && (
                          <div className="loading-placeholder-lines" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                        {!selectedMapAirportFrequenciesLoading && selectedMapAirportFrequenciesError && <p className="map-airport-info-error">{selectedMapAirportFrequenciesError}</p>}
                        {!selectedMapAirportFrequenciesLoading && !selectedMapAirportFrequenciesError && selectedMapAirportFrequencies.length === 0 && (
                          <p>No published frequencies found.</p>
                        )}
                        {!selectedMapAirportFrequenciesLoading && !selectedMapAirportFrequenciesError && selectedMapAirportFrequencies.length > 0 && (
                          <ul className="map-airport-info-list">
                            {selectedMapAirportFrequencies.slice(0, 12).map((frequency) => (
                              <li key={`${frequency.type}-${frequency.description}-${frequency.frequencyMHz}`}>
                                <strong>{formatFrequencyType(frequency.type, frequency.description)}</strong>
                                <span>{frequency.frequencyMHz}</span>
                                <span>{frequency.description || frequency.type}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {selectedMapAirportTab === 'charts' && (
                      <>
                        {selectedMapAirportDiagramLoading && (
                          <div className="loading-placeholder-lines" aria-hidden="true">
                            <span />
                            <span />
                          </div>
                        )}
                        {!selectedMapAirportDiagramLoading && selectedMapAirportDiagramError && <p className="map-airport-info-error">{selectedMapAirportDiagramError}</p>}
                        {!selectedMapAirportDiagramLoading && !selectedMapAirportDiagramError && !selectedMapAirportDiagram && (
                          <p>No airport diagram available.</p>
                        )}
                        {!selectedMapAirportDiagramLoading && !selectedMapAirportDiagramError && selectedMapAirportDiagram && (
                          <p>
                            <a
                              href={selectedMapAirportDiagram.proxiedPdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="map-airport-info-link"
                            >
                              Open {selectedMapAirportDiagram.chartName}
                            </a>
                          </p>
                        )}
                      </>
                    )}

                    {selectedMapAirportTab === 'runways' && (
                      <>
                        {selectedMapAirportRunwaysLoading && (
                          <div className="loading-placeholder-lines" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                        {!selectedMapAirportRunwaysLoading && selectedMapAirportRunwaysError && <p className="map-airport-info-error">{selectedMapAirportRunwaysError}</p>}
                        {!selectedMapAirportRunwaysLoading && !selectedMapAirportRunwaysError && selectedMapAirportRunways.length === 0 && (
                          <p>No runway data available.</p>
                        )}
                        {!selectedMapAirportRunwaysLoading && !selectedMapAirportRunwaysError && selectedMapAirportRunways.length > 0 && (
                          <ul className="map-airport-info-list">
                            {selectedMapAirportRunways.slice(0, 10).map((runway) => (
                              <li key={runway.id}>
                                <strong>{runway.leIdent ?? '—'} / {runway.heIdent ?? '—'}</strong>
                                <span>
                                  {runway.lengthFt ? `${runway.lengthFt} x ` : '— x '}
                                  {runway.widthFt ? `${runway.widthFt} ft` : '—'}
                                </span>
                                <span>
                                  {runway.surface ?? 'Unknown surface'}
                                  {runway.lighted ? ' · Lighted' : ''}
                                  {runway.closed ? ' · Closed' : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {selectedMapAirportTab === 'notams' && (
                      <>
                        {selectedMapAirportNotamsLoading && (
                          <div className="loading-placeholder-lines" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                        {!selectedMapAirportNotamsLoading && selectedMapAirportNotamsError && <p className="map-airport-info-error">{selectedMapAirportNotamsError}</p>}
                        {!selectedMapAirportNotamsLoading && !selectedMapAirportNotamsError && selectedMapAirportNotams.length === 0 && (
                          <p>No nearby NOTAM/TFR advisories found.</p>
                        )}
                        {!selectedMapAirportNotamsLoading && !selectedMapAirportNotamsError && selectedMapAirportNotams.length > 0 && (
                          <ul className="map-airport-info-list">
                            {selectedMapAirportNotams.map((notam) => (
                              <li key={notam.id} className={selectedMapAirspaceId === notam.id ? 'map-airspace-list-item-active' : undefined}>
                                <button
                                  type="button"
                                  className="map-airspace-select"
                                  onClick={() => setSelectedMapAirspaceId(notam.id)}
                                >
                                  <strong>{notam.type} · {notam.id}</strong>
                                  <span>{notam.title}</span>
                                  <span>
                                    {notam.distanceNm == null ? 'Distance n/a' : `${notam.distanceNm.toFixed(1)} NM`}
                                    {notam.lastUpdated ? ` · Updated ${new Date(notam.lastUpdated).toLocaleString()}` : ''}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!selectedMapAirportNotamsLoading && !selectedMapAirportNotamsError && selectedMapAirportAirspace && (
                          <div className="map-airspace-brief">
                            <p className="map-airport-info-note">Selected airspace: {selectedMapAirportAirspace.type} {selectedMapAirportAirspace.id}</p>
                            <BriefCard
                              title="AI Brief"
                              actionLabel="Explain this airspace"
                              cacheKey={`airspace:${selectedMapAirportAirspace.id}`}
                              onGenerate={() => explainAirspace(selectedMapAirportAirspace)}
                            />
                          </div>
                        )}
                        <p className="map-airport-info-note">Source: FAA TFR feed near selected airport.</p>
                      </>
                    )}
                  </div>
                </article>
              )}
              {selectedMapAirportError && (
                <article className="map-airport-info map-airport-info-error-card">
                  <header className="map-airport-info-header">
                    <p className="map-airport-info-eyebrow">Airport Info</p>
                    <button type="button" className="map-airport-info-close" onClick={clearSelectedMapAirport} aria-label="Close airport info">×</button>
                  </header>
                  <p className="map-airport-info-error">{selectedMapAirportError}</p>
                </article>
              )}
            </div>
          )}

          <div className={`map-layer-control${layerControlOpen ? ' open' : ''}`} ref={layerControlRef}>
            <button
              type="button"
              className="map-layer-control-button"
              aria-expanded={layerControlOpen}
              aria-controls="map-layer-control-menu"
              onClick={() => setLayerControlOpen((current) => !current)}
            >
              🗺 Layers
            </button>

            {layerControlOpen && (
              <div id="map-layer-control-menu" className="map-layer-control-menu">
                <label className="map-overlay-check">
                  <input
                    type="checkbox"
                    checked={showFaaCharts}
                    onChange={(event) => setShowFaaCharts(event.target.checked)}
                  />
                  🛩 FAA Charts
                </label>

                <label className="map-overlay-check">
                  <input
                    type="checkbox"
                    checked={showAirportDiagrams}
                    onChange={(event) => setShowAirportDiagrams(event.target.checked)}
                  />
                  🛬 Airport Diagrams
                </label>

                <label className="map-overlay-check">
                  <input
                    type="checkbox"
                    checked={showSchematicSurfaceLayout}
                    disabled={!showAirportDiagrams}
                    onChange={(event) => setShowSchematicSurfaceLayout(event.target.checked)}
                  />
                  🧩 Schematic Surface (Approx.)
                </label>

                <label>
                  🗺 Map Layer
                  <select value={planLayerId} onChange={(event) => setPlanLayerId(event.target.value)}>
                    {faaCharts.map((layer) => (
                      <option key={layer.id} value={layer.id}>{layer.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  🌗 Basemap
                  <select value={planBaseMapId} onChange={(event) => setPlanBaseMapId(event.target.value as BaseMapStyle)}>
                    {baseMapLayers.map((baseMap) => (
                      <option key={baseMap.id} value={baseMap.id}>{baseMap.name}</option>
                    ))}
                  </select>
                </label>

                <label className="map-overlay-check">
                  <input
                    type="checkbox"
                    checked={showTfrOverlay}
                    onChange={(event) => setShowTfrOverlay(event.target.checked)}
                  />
                  🚫 TFR Overlay
                </label>
              </div>
            )}
          </div>

          {showAirportDiagrams && (
            <aside className="map-diagram-legend" role="note" aria-live="polite">
              <p>Runway diagram from FAA NASR; surface layout may be schematic.</p>
              {showSchematicSurfaceLayout && <p>Schematic surface layout (approx.).</p>}
            </aside>
          )}

          <aside className="map-flight-panel">
            <div className="map-flight-header">
              <h2>Flight Plan</h2>
              <div className="map-flight-header-actions">
                <span className="map-flight-badge">LIVE</span>
                {dataCycle && <span className="map-flight-badge map-flight-badge-secondary">NASR {dataCycle.effectiveDate}</span>}
                <button
                  type="button"
                  className="map-locate-button"
                  onClick={() => recenterToUserLocation(true)}
                >
                  Locate Me
                </button>
              </div>
            </div>

            <div className="map-flight-section">
            <div className="map-flight-inline-grid">
              <label>
                🛫 Departure
                <input value={departure} onChange={(event) => setDeparture(event.target.value.toUpperCase())} maxLength={4} />
              </label>
              <label>
                🛬 Arrival
                <input value={arrival} onChange={(event) => setArrival(event.target.value.toUpperCase())} maxLength={4} />
              </label>
            </div>
            </div>

            <div className="map-flight-section">
            <div className="map-flight-inline-grid map-flight-inline-grid-4">
              <label>
                Alt
                <select value={cruiseAltitudeFt} onChange={(event) => setCruiseAltitudeFt(Number(event.target.value))}>
                  {cruiseAltitudeOptions.map((altitude) => (
                    <option key={altitude} value={altitude}>{altitude}</option>
                  ))}
                </select>
              </label>
              <label>
                TAS
                <input type="number" value={tas} onChange={(event) => setTas(Number(event.target.value))} />
              </label>
              <label>
                Dev
                <input type="number" value={compassDeviation} onChange={(event) => setCompassDeviation(Number(event.target.value))} />
              </label>
              <label>
                GPH
                <input type="number" value={fuelBurn} onChange={(event) => setFuelBurn(Number(event.target.value))} />
              </label>
            </div>
            </div>

            <div className="map-flight-section">
            <label className="waypoints">
              📍 Waypoints
              <div className="waypoint-entry-box">
                {waypointChips.length > 0 && (
                  <div
                    className="waypoint-chip-list"
                    onDragOver={handleWaypointListDragOver}
                    onDrop={handleWaypointListDrop}
                  >
                    {waypointChips.map((chip, index) => (
                      <div
                        key={chip.key}
                        data-waypoint-chip-index={index}
                        className={`waypoint-chip waypoint-chip-${chip.status} waypoint-chip-draggable${draggingWaypointIndex === index ? ' dragging' : ''}${draggingWaypointIndex != null && dragWaypointInsertionIndex === index && draggingWaypointIndex !== index ? ' drop-before' : ''}${draggingWaypointIndex != null && dragWaypointInsertionIndex === index + 1 && draggingWaypointIndex !== index ? ' drop-after' : ''}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          setDraggingWaypointIndex(index)
                          setDragWaypointInsertionIndex(index)
                        }}
                        onDragOver={(event) => handleWaypointChipDragOver(index, event)}
                        onDrop={(event) => handleWaypointChipDrop(index, event)}
                        onDragEnd={clearWaypointDragState}
                        onTouchStart={() => {
                          setDraggingWaypointIndex(index)
                          setDragWaypointInsertionIndex(index)
                        }}
                        onTouchMove={(event) => {
                          const touch = event.touches[0]
                          if (!touch) {
                            return
                          }

                          event.preventDefault()
                          updateTouchDragTarget(touch.clientX, touch.clientY)
                        }}
                        onTouchEnd={(event) => {
                          event.preventDefault()
                          reorderWaypointChips(dragWaypointInsertionIndex ?? index)
                        }}
                        onTouchCancel={clearWaypointDragState}
                        title="Drag to reorder"
                      >
                        <span className="waypoint-chip-handle" aria-hidden="true">⋮⋮</span>
                        <span className="waypoint-chip-main">
                          <strong>{chip.label}</strong>
                          {' · '}
                          {chip.detail}
                        </span>
                        <button
                          type="button"
                          className="waypoint-chip-remove"
                          draggable={false}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            removeWaypointChip(index)
                          }}
                          onTouchStart={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onTouchEnd={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            removeWaypointChip(index)
                          }}
                          aria-label={`Remove ${chip.label}`}
                          title="Remove waypoint"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  value={waypointDraft}
                  onChange={(event) => {
                    const value = event.target.value

                    if (value.includes('\n')) {
                      const lines = value.split('\n').map((line) => line.trim())
                      const complete = lines.slice(0, -1).filter(Boolean)
                      if (complete.length) {
                        setWaypointLines([...waypointLines, ...complete])
                      }
                      setWaypointDraft(lines.length ? lines[lines.length - 1] : '')
                      return
                    }

                    if (value.endsWith(' ') && value.trim()) {
                      setWaypointLines([...waypointLines, value.trim()])
                      setWaypointDraft('')
                      return
                    }

                    setWaypointDraft(value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      appendWaypointDraft()
                      return
                    }

                    if (event.key === 'Backspace' && !waypointDraft.trim()) {
                      event.preventDefault()
                      removeLastWaypointChip()
                    }
                  }}
                  onBlur={appendWaypointDraft}
                  placeholder={waypointLines.length ? 'Type next waypoint and press Enter' : 'RIPON or RIPON,43.8427,-88.8445'}
                  className="waypoint-chip-input"
                />
              </div>
            </label>
            </div>

            <div className="navaid-type-selector map-flight-section">
              <p>📡 Included Route Navaid Types</p>
              <div className="review-checklist">
                {routeNavaidTypeOptions.map((type) => (
                  <label key={type} className="review-checkitem">
                    <input
                      type="checkbox"
                      checked={includedNavaidTypes.includes(type)}
                      onChange={(event) => toggleIncludedNavaidType(type, event.target.checked)}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <div className="map-flight-actions">
              <button onClick={buildNavLog} disabled={loading}>
                {loading ? 'Loading...' : '▶ Build Nav Log'}
              </button>
              {legs.length > 0 && (
                <button className="print-button" onClick={() => window.print()} type="button">
                  🖨 Print
                </button>
              )}
            </div>

            {error && <p className="error">{error}</p>}
            {planMapError && <p className="error">{planMapError}</p>}
          </aside>
        </div>

      </section>

      {legs.length > 0 && depAirport && arrAirport && (
        <section className="card print-packet">
          <div className="screen-only print-actions">
            <button type="button" onClick={() => window.print()}>Print Packet</button>
          </div>
          <article className="flight-plan-page">
            <h2>VFR Flight Plan Data</h2>
            <p>
              Route: {depAirport.airport.icao} to {arrAirport.airport.icao}
              {' · '}Date: __________{' · '}Aircraft: __________{' · '}Tail #: __________
            </p>
            <p>
              TAS {tas} kts · Cruise {cruiseAltitudeFt} ft · Fuel Burn {fuelBurn} gph ·
              Totals: {totals.totalDistance.toFixed(1)} NM / {totals.totalTime.toFixed(1)} min / {totals.totalFuel.toFixed(2)} gal
            </p>

            <div className="print-summary-grid">
              <article>
                <h3>Departure {depAirport.airport.icao}</h3>
                <p>{formatDecodedWeather(depWeather)}</p>
                <p className="print-weather-stamp">Weather snapshot printed: {printWeatherTimestamp}</p>
                <div className="print-weather-write-section">
                  <p className="print-weather-write-label">Current weather update (write-in):</p>
                  <div className="print-weather-write-box" />
                </div>
                <ul className="freq-list">
                  {depFrequencies.slice(0, 10).map((frequency) => (
                    <li key={`dep-${frequency.type}-${frequency.frequencyMHz}`}>
                      {formatFrequencyType(frequency.type, frequency.description)}: {frequency.frequencyMHz}
                    </li>
                  ))}
                </ul>
              </article>
              <article>
                <h3>Arrival {arrAirport.airport.icao}</h3>
                <p>{formatDecodedWeather(arrWeather)}</p>
                <p className="print-weather-stamp">Weather snapshot printed: {printWeatherTimestamp}</p>
                <div className="print-weather-write-section">
                  <p className="print-weather-write-label">Current weather update (write-in):</p>
                  <div className="print-weather-write-box" />
                </div>
                <ul className="freq-list">
                  {arrFrequencies.slice(0, 10).map((frequency) => (
                    <li key={`arr-${frequency.type}-${frequency.frequencyMHz}`}>
                      {formatFrequencyType(frequency.type, frequency.description)}: {frequency.frequencyMHz}
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <table className="print-navlog-table">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>From→To</th>
                  <th>TC</th>
                  <th>MH</th>
                  <th>CH</th>
                  <th>Dist</th>
                  <th>ETE</th>
                  <th>ATD</th>
                  <th>ATA</th>
                  <th>Fuel</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg, index) => (
                  <tr key={`print-leg-${leg.from}-${leg.to}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{leg.from}→{leg.to}</td>
                    <td>{leg.trueCourse.toFixed(0)}°</td>
                    <td>{leg.magneticHeading.toFixed(0)}°</td>
                    <td>{leg.compassHeading.toFixed(0)}°</td>
                    <td>{leg.distanceNm.toFixed(1)}</td>
                    <td>{leg.eteMinutes.toFixed(1)}</td>
                    <td className="write-cell" />
                    <td className="write-cell" />
                    <td className="write-cell" />
                    <td className="write-cell notes-cell" />
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Route Navaids (with Morse)</h3>
            {routeNavaids.length > 0 ? (
              <table className="print-navlog-table navaid-table">
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th>Ident</th>
                    <th>Type</th>
                    <th>Frequency</th>
                    <th>Morse (Ident)</th>
                    <th>Name</th>
                    <th>Off Route</th>
                  </tr>
                </thead>
                <tbody>
                  {routeNavaids.map((navaid) => (
                    <tr key={`navaid-${navaid.ident}-${navaid.legIndex}`}>
                      <td>{navaid.legIndex}</td>
                      <td>{navaid.ident}</td>
                      <td>{navaid.type}</td>
                      <td>{formatNavaidFrequency(navaid)}</td>
                      <td>{navaid.morse || '—'}</td>
                      <td>{navaid.name}</td>
                      <td>{formatOffRoute(navaid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No route navaids identified.</p>
            )}
          </article>

          {printDiagramsLoading && <p>Loading airport diagrams...</p>}
          {!printDiagramsLoading && printableDiagrams.length === 0 && (
            <p>Airport diagrams unavailable for this route.</p>
          )}

          <div className="print-charts-grid charts-two-up">
            {printableDiagrams.map((chart) => {
              const diagramFrequencies = chart.airportIcao === depAirport.airport.icao
                ? depFrequencies.slice(0, 8)
                : chart.airportIcao === arrAirport.airport.icao
                  ? arrFrequencies.slice(0, 8)
                  : []
              const diagramRunways = chart.airportIcao === depAirport.airport.icao
                ? depRunways.slice(0, 8)
                : chart.airportIcao === arrAirport.airport.icao
                  ? arrRunways.slice(0, 8)
                  : []

              return (
                <article key={`${chart.role}-${chart.airportIcao}-${chart.chartName}`} className="print-chart-item">
                  <h4>{chart.role} Diagram - {chart.airportIcao}</h4>
                  <p>{chart.chartName}</p>
                  {chart.source === 'generated' && (
                    <p className="print-diagram-disclaimer">
                      Generated from FAA NASR runway/taxiway data; not an official FAA airport diagram.
                    </p>
                  )}
                  {chart.imageUrl ? (
                    <img src={chart.imageUrl} alt={`${chart.role} airport diagram for ${chart.airportIcao}`} className="print-diagram-image" />
                  ) : (
                    <p>{chart.pdfUrl ? 'Diagram preview unavailable.' : 'Diagram preview unavailable for generated fallback.'}</p>
                  )}

                  {diagramFrequencies.length > 0 && (
                    <div className="print-diagram-frequencies">
                      <p className="print-diagram-frequencies-title">Airport Frequencies</p>
                      <ul className="freq-list">
                        {diagramFrequencies.map((frequency) => (
                          <li key={`${chart.airportIcao}-${frequency.type}-${frequency.frequencyMHz}`}>
                            {formatFrequencyType(frequency.type, frequency.description)}: {frequency.frequencyMHz}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {diagramRunways.length > 0 && (
                    <div className="print-diagram-runways">
                      <p className="print-diagram-runways-title">Runway Data</p>
                      <table className="print-runway-data-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Length</th>
                            <th>Width</th>
                            <th>Type</th>
                            <th>Condition</th>
                            <th>Lights</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagramRunways.map((runway) => {
                            const runwayId = [runway.leIdent, runway.heIdent].filter(Boolean).join('/') || runway.id
                            return (
                              <tr key={`${chart.airportIcao}-${runway.id}`}>
                                <td>{runwayId}</td>
                                <td>{runway.lengthFt == null ? '—' : `${runway.lengthFt} ft`}</td>
                                <td>{runway.widthFt == null ? '—' : `${runway.widthFt} ft`}</td>
                                <td>{runway.surface ?? 'Unknown'}</td>
                                <td>{runway.closed ? 'Closed' : 'Open'}</td>
                                <td>{runway.lighted ? 'Lighted' : 'Unlighted'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {chart.pdfUrl && (
                    <p className="screen-only">
                      <a href={chart.pdfUrl} target="_blank" rel="noreferrer">Open full PDF</a>
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}

      <footer className="app-copyright screen-only">© 1C8 Flyers, LLC</footer>
    </main>
  )
}

export default App
