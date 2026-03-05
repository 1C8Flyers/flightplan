import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { defaultFaaChartLayerId, faaCharts } from './config/faaCharts'
import { AirportDiagramsLayer } from './map/AirportDiagramsLayer'

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
  } | null
  taf: { rawTAF?: string; issueTime?: string } | null
  sourceStation?: string | null
  fallbackUsed?: boolean
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

type PrintableDiagram = {
  role: 'Departure' | 'Arrival'
  airportIcao: string
  chartName: string
  pdfUrl: string
  imageUrl: string | null
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
  const [dragOverWaypointIndex, setDragOverWaypointIndex] = useState<number | null>(null)
  const [cruiseAltitudeFt, setCruiseAltitudeFt] = useState(3000)
  const [tas, setTas] = useState(110)
  const [compassDeviation, setCompassDeviation] = useState(0)
  const [fuelBurn, setFuelBurn] = useState(9)
  const [includedNavaidTypes, setIncludedNavaidTypes] = useState<string[]>(['VOR', 'VOR-DME'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRawWeather, setShowRawWeather] = useState(false)
  const [showAdvancedNav, setShowAdvancedNav] = useState(false)
  const [showFaaDelayDetails, setShowFaaDelayDetails] = useState(false)
  const [reviewChecklist, setReviewChecklist] = useState({
    weatherBriefed: false,
    fuelChecked: false,
    alternatesReviewed: false,
    notamsReviewed: false
  })

  const [depAirport, setDepAirport] = useState<AirportResponse | null>(null)
  const [arrAirport, setArrAirport] = useState<AirportResponse | null>(null)
  const [depWeather, setDepWeather] = useState<WeatherResponse | null>(null)
  const [arrWeather, setArrWeather] = useState<WeatherResponse | null>(null)
  const [depFrequencies, setDepFrequencies] = useState<FrequencyResponse['frequencies']>([])
  const [arrFrequencies, setArrFrequencies] = useState<FrequencyResponse['frequencies']>([])
  const [suggestedWaypoints, setSuggestedWaypoints] = useState<SuggestedWaypoint[]>([])
  const [windsAloft, setWindsAloft] = useState<WindsAloftResponse | null>(null)
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
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [dataCycle, setDataCycle] = useState<DataCycleResponse | null>(null)
  const [routeInsertDragging, setRouteInsertDragging] = useState(false)

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
  const suppressNextMapClickRef = useRef(false)
  const routeInsertHandleRef = useRef<any>(null)

  const totals = useMemo(() => {
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distanceNm, 0)
    const totalTime = legs.reduce((sum, leg) => sum + leg.eteMinutes, 0)
    const totalFuel = legs.reduce((sum, leg) => sum + leg.fuelGallons, 0)
    return { totalDistance, totalTime, totalFuel }
  }, [legs])

  const hasNavData = Boolean(legs.length > 0 && depAirport && arrAirport)
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
  const selectedMapAirportFlightCategory = useMemo(
    () => getFlightCategory(selectedMapAirportWeather),
    [selectedMapAirportWeather]
  )

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

  async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(path)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `Request failed: ${path}`)
    }
    return response.json() as Promise<T>
  }

  async function selectMapAirportFromIdent(ident: string) {
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
    }
  }

  async function selectMapAirportFromSearch(airport: AirportSearchResult) {
    setMapAirportSearchQuery(airport.ident)
    setMapAirportSearchFocused(false)

    if (mapRef.current) {
      mapRef.current.setView([airport.lat, airport.lon], Math.max(mapRef.current.getZoom(), 9))
    }

    await selectMapAirportFromIdent(airport.ident)
  }

  function clearSelectedMapAirport() {
    setSelectedMapAirport(null)
    setSelectedMapAirportDistanceNm(null)
    setSelectedMapAirportWeather(null)
    setSelectedMapAirportError(null)
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

  function useSuggestedWaypointLines() {
    if (!suggestedWaypoints.length) {
      return
    }

    const lines = suggestedWaypoints.map((waypoint) => waypoint.ident)
    setWaypointLines(lines)
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

  function reorderWaypointChips(targetIndex: number) {
    if (draggingWaypointIndex == null || draggingWaypointIndex === targetIndex) {
      setDraggingWaypointIndex(null)
      setDragOverWaypointIndex(null)
      return
    }

    const nextLines = [...waypointLines]
    const [dragged] = nextLines.splice(draggingWaypointIndex, 1)
    if (dragged == null) {
      setDraggingWaypointIndex(null)
      setDragOverWaypointIndex(null)
      return
    }

    const insertionIndex = draggingWaypointIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextLines.splice(Math.max(0, insertionIndex), 0, dragged)
    setDraggingWaypointIndex(null)
    setDragOverWaypointIndex(null)
    setWaypointLines(nextLines)
  }

  function updateTouchDragTarget(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)
    const chipElement = target instanceof HTMLElement ? target.closest('[data-waypoint-chip-index]') : null
    if (!chipElement || !(chipElement instanceof HTMLElement)) {
      return
    }

    const index = Number(chipElement.dataset.waypointChipIndex)
    if (!Number.isNaN(index)) {
      setDragOverWaypointIndex(index)
    }
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

    return `Wind ${windDirection} @ ${windSpeed} · Vis ${visibility} · Temp/Dew ${temperature}/${dewpoint} · Alt ${altimeter}`
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

  function formatFrequencyType(type: string) {
    const normalized = type.toUpperCase()
    if (normalized.startsWith('ATIS') || normalized.startsWith('AWOS') || normalized.startsWith('ASOS')) return 'WX'
    if (normalized.startsWith('CTAF')) return 'CTAF'
    if (normalized.startsWith('UNIC')) return 'UNICOM'
    if (normalized.startsWith('TWR')) return 'TWR'
    if (normalized.startsWith('GND')) return 'GND'
    if (normalized.startsWith('APP')) return 'APP'
    if (normalized.startsWith('DEP')) return 'DEP'
    if (normalized.startsWith('CLNC')) return 'CLR'
    if (normalized.startsWith('FSS')) return 'FSS'
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

      const resolved = await Promise.all(
        diagramCandidates.map(async (candidate) => {
          const response = await fetchJson<AirportDiagramResponse>(`/api/airport-diagram/by-airport/${candidate.airportIcao}`)
          if (!response.diagram) {
            return null
          }

          const imageUrl = await renderPdfFirstPageToImage(response.diagram.proxiedPdfUrl)

          return {
            role: candidate.role,
            airportIcao: candidate.airportIcao,
            chartName: response.diagram.chartName,
            pdfUrl: response.diagram.proxiedPdfUrl,
            imageUrl
          }
        })
      )

      setPrintableDiagrams(resolved.filter((item): item is PrintableDiagram => Boolean(item)))
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

      setWindsAloft(midpointWinds)

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

      const [depAirportResponse, arrAirportResponse, depWeatherResponse, arrWeatherResponse, depFrequencyResponse, arrFrequencyResponse] = await Promise.all([
        fetchJson<AirportResponse>(`/api/airport/${depIcao}`),
        fetchJson<AirportResponse>(`/api/airport/${arrIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${depIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${arrIcao}`),
        fetchJson<FrequencyResponse>(`/api/frequencies/${depIcao}`),
        fetchJson<FrequencyResponse>(`/api/frequencies/${arrIcao}`)
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
      setSuggestedWaypoints(suggestionResponse.suggestions)

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

      setShowRawWeather(false)
      setShowAdvancedNav(false)
      setShowFaaDelayDetails(false)
      setReviewChecklist({
        weatherBriefed: false,
        fuelChecked: false,
        alternatesReviewed: false,
        notamsReviewed: false
      })
    } catch (caughtError) {
      setError((caughtError as Error).message)
      setLegs([])
      setSuggestedWaypoints([])
      setWindsAloft(null)
      setPrintableDiagrams([])
      setDepFrequencies([])
      setArrFrequencies([])
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

    async function renderInteractivePlanMap() {
      const leaflet = await import('leaflet')
      if (cancelled || !mapContainerRef.current) {
        return
      }

      const maxInteractiveZoom = showFaaCharts
        ? selectedPlanLayer.maxZoom
        : Math.max(selectedPlanLayer.maxZoom, selectedBaseMap.maxZoom)

      setPlanMapError(null)

      if (!mapRef.current) {
        mapRef.current = leaflet.map(mapContainerRef.current, {
          center: [39.5, -98.35],
          zoom: selectedPlanLayer.minZoom,
          minZoom: selectedPlanLayer.minZoom,
          maxZoom: maxInteractiveZoom,
          zoomControl: false,
          attributionControl: true
        })

        leaflet.control.zoom({ position: 'bottomleft' }).addTo(mapRef.current)

        recenterToUserLocation(false)

        mapRef.current.on('click', async (event: { latlng: { lat: number; lng: number } }) => {
          if (suppressNextMapClickRef.current) {
            suppressNextMapClickRef.current = false
            return
          }

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
          }
        })
      }

      const map = mapRef.current
      map.invalidateSize()
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

      let switchedToFallbackLayer = false

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

      if (!showFaaCharts) {
        chartLayerRef.current = null
      } else if (!selectedPlanLayer.tileUrl || selectedPlanLayer.tileUrl.startsWith('REPLACE_WITH_')) {
        applyFallbackTileLayer('FAA chart tiles unavailable. Showing selected base map.')
      } else {
        const BlobTileLayer = (leaflet as any).GridLayer.extend({
          createTile(coords: { x: number; y: number; z: number }, done: (error: Error | null, tile: HTMLElement) => void) {
            const tile = document.createElement('img')
            tile.alt = ''
            tile.setAttribute('role', 'presentation')

            const tileUrl = selectedPlanLayer.tileUrl
              .replace('{z}', String(coords.z))
              .replace('{x}', String(coords.x))
              .replace('{y}', String(coords.y))

            fetch(tileUrl)
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`Tile request failed (${response.status})`)
                }

                return response.blob()
              })
              .then((blob) => {
                const objectUrl = URL.createObjectURL(blob)

                tile.onload = () => {
                  URL.revokeObjectURL(objectUrl)
                  done(null, tile)
                }

                tile.onerror = () => {
                  URL.revokeObjectURL(objectUrl)
                  done(new Error('Tile image decode failed.'), tile)
                }

                tile.src = objectUrl
              })
              .catch((error) => {
                done(error as Error, tile)
              })

            return tile
          }
        })

        const tileLayer = new BlobTileLayer({
          minZoom: selectedPlanLayer.minZoom,
          maxZoom: selectedPlanLayer.maxZoom,
          minNativeZoom: selectedPlanLayer.minNativeZoom,
          maxNativeZoom: selectedPlanLayer.maxZoom,
          attribution: selectedPlanLayer.attribution
        })

        tileLayer.on('tileerror', () => {
          if (!switchedToFallbackLayer) {
            switchedToFallbackLayer = true
            applyFallbackTileLayer('FAA chart tiles unavailable. Showing selected base map.')
          }
        })

        tileLayer.addTo(map)
        tileLayer.setZIndex(10)
        chartLayerRef.current = tileLayer
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
    }

    renderInteractivePlanMap().catch((caughtError) => {
      const message = (caughtError as Error).message || 'Failed to render route editing map.'
      setPlanMapError(message)
    })

    return () => {
      cancelled = true
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

          <div className="map-search-overlay" ref={mapSearchContainerRef}>
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
                        {selectedMapAirportWeather?.metar?.rawOb && <p>METAR: {selectedMapAirportWeather.metar.rawOb}</p>}
                        {selectedMapAirportWeather?.taf?.rawTAF && <p>TAF: {selectedMapAirportWeather.taf.rawTAF}</p>}
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
                        {selectedMapAirportFrequenciesLoading && <p>Loading frequencies…</p>}
                        {!selectedMapAirportFrequenciesLoading && selectedMapAirportFrequenciesError && <p className="map-airport-info-error">{selectedMapAirportFrequenciesError}</p>}
                        {!selectedMapAirportFrequenciesLoading && !selectedMapAirportFrequenciesError && selectedMapAirportFrequencies.length === 0 && (
                          <p>No published frequencies found.</p>
                        )}
                        {!selectedMapAirportFrequenciesLoading && !selectedMapAirportFrequenciesError && selectedMapAirportFrequencies.length > 0 && (
                          <ul className="map-airport-info-list">
                            {selectedMapAirportFrequencies.slice(0, 12).map((frequency) => (
                              <li key={`${frequency.type}-${frequency.description}-${frequency.frequencyMHz}`}>
                                <strong>{formatFrequencyType(frequency.type)}</strong>
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
                        {selectedMapAirportDiagramLoading && <p>Loading airport diagram…</p>}
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
                        {selectedMapAirportRunwaysLoading && <p>Loading runway data…</p>}
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
                        {selectedMapAirportNotamsLoading && <p>Loading NOTAMs…</p>}
                        {!selectedMapAirportNotamsLoading && selectedMapAirportNotamsError && <p className="map-airport-info-error">{selectedMapAirportNotamsError}</p>}
                        {!selectedMapAirportNotamsLoading && !selectedMapAirportNotamsError && selectedMapAirportNotams.length === 0 && (
                          <p>No nearby NOTAM/TFR advisories found.</p>
                        )}
                        {!selectedMapAirportNotamsLoading && !selectedMapAirportNotamsError && selectedMapAirportNotams.length > 0 && (
                          <ul className="map-airport-info-list">
                            {selectedMapAirportNotams.map((notam) => (
                              <li key={notam.id}>
                                <strong>{notam.type} · {notam.id}</strong>
                                <span>{notam.title}</span>
                                <span>
                                  {notam.distanceNm == null ? 'Distance n/a' : `${notam.distanceNm.toFixed(1)} NM`}
                                  {notam.lastUpdated ? ` · Updated ${new Date(notam.lastUpdated).toLocaleString()}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
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
                  <div className="waypoint-chip-list">
                    {waypointChips.map((chip, index) => (
                      <div
                        key={chip.key}
                        data-waypoint-chip-index={index}
                        className={`waypoint-chip waypoint-chip-${chip.status} waypoint-chip-draggable${draggingWaypointIndex === index ? ' dragging' : ''}${draggingWaypointIndex != null && dragOverWaypointIndex === index && draggingWaypointIndex !== index ? ' drop-target' : ''}`}
                        draggable
                        onDragStart={() => {
                          setDraggingWaypointIndex(index)
                          setDragOverWaypointIndex(index)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDragOverWaypointIndex(index)
                        }}
                        onDragLeave={() => {
                          setDragOverWaypointIndex((current) => (current === index ? null : current))
                        }}
                        onDrop={() => reorderWaypointChips(index)}
                        onDragEnd={() => {
                          setDraggingWaypointIndex(null)
                          setDragOverWaypointIndex(null)
                        }}
                        onTouchStart={() => {
                          setDraggingWaypointIndex(index)
                          setDragOverWaypointIndex(index)
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
                          reorderWaypointChips(dragOverWaypointIndex ?? index)
                        }}
                        onTouchCancel={() => {
                          setDraggingWaypointIndex(null)
                          setDragOverWaypointIndex(null)
                        }}
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

        <p>
          Drag blue waypoint markers to edit existing waypoints, or drag the red route line to insert a new waypoint. Start/end markers stay fixed to departure/arrival airports.
        </p>
      </section>

      {hasNavData && depAirport && arrAirport && (
        <section className="card screen-only summary-card">
          <p>
            {depAirport.airport.icao} → {arrAirport.airport.icao}
            {' · '}TAS {tas} kt
            {' · '}Cruise {cruiseAltitudeFt} ft
            {' · '}Total {totals.totalDistance.toFixed(1)} NM / {totals.totalTime.toFixed(1)} min / {totals.totalFuel.toFixed(2)} gal
          </p>
        </section>
      )}

      {suggestedWaypoints.length > 0 && (
        <section className="card screen-only">
          <h2>Suggested Enroute Waypoints</h2>
          <p className="subtitle">Real airport checkpoints near your route corridor.</p>
          <div className="suggested-list">
            {suggestedWaypoints.map((waypoint) => (
              <div key={waypoint.ident} className="suggested-item">
                <strong>{waypoint.ident}</strong>
                <span>{waypoint.name}</span>
                <span>{waypoint.crossTrackNm.toFixed(1)} NM off-route</span>
              </div>
            ))}
          </div>
          <button onClick={useSuggestedWaypointLines}>Use Suggested Waypoints</button>
        </section>
      )}

      {windsAloft && (
        <section className="card screen-only">
          <h2>Winds Aloft (Live)</h2>
          <p>
            Station {windsAloft.station} · Requested {windsAloft.requestedAltitudeFt} ft · Forecast Level {windsAloft.selectedAltitudeFt} ft
          </p>
          <p>
            Wind {windsAloft.direction == null ? 'Variable' : `${windsAloft.direction}°`} at {windsAloft.speed} kts
            {windsAloft.temperatureC != null ? ` · Temp ${windsAloft.temperatureC}°C` : ''}
            {` · ${windsAloft.stationDistanceNm.toFixed(1)} NM from route midpoint`}
          </p>
        </section>
      )}

      {hasNavData && (
        <section className="card screen-only">
          <h2>Review Checklist</h2>
          <div className="review-checklist">
            <label className="review-checkitem">
              <input
                type="checkbox"
                checked={reviewChecklist.weatherBriefed}
                onChange={(event) => setReviewChecklist((current) => ({ ...current, weatherBriefed: event.target.checked }))}
              />
              Weather briefing reviewed
            </label>
            <label className="review-checkitem">
              <input
                type="checkbox"
                checked={reviewChecklist.fuelChecked}
                onChange={(event) => setReviewChecklist((current) => ({ ...current, fuelChecked: event.target.checked }))}
              />
              Fuel plan verified
            </label>
            <label className="review-checkitem">
              <input
                type="checkbox"
                checked={reviewChecklist.alternatesReviewed}
                onChange={(event) => setReviewChecklist((current) => ({ ...current, alternatesReviewed: event.target.checked }))}
              />
              Alternate options reviewed
            </label>
            <label className="review-checkitem">
              <input
                type="checkbox"
                checked={reviewChecklist.notamsReviewed}
                onChange={(event) => setReviewChecklist((current) => ({ ...current, notamsReviewed: event.target.checked }))}
              />
              NOTAMs reviewed
            </label>
          </div>
        </section>
      )}

      {depAirport && arrAirport && (
        <section className="card screen-only">
          <h2>Airport + FAA Status</h2>
          {(depAirport.faa.hasDelay || arrAirport.faa.hasDelay) && (
            <div className="review-actions">
              <button type="button" className="review-toggle" onClick={() => setShowFaaDelayDetails((current) => !current)}>
                {showFaaDelayDetails ? 'Hide FAA Delay Details' : 'Show FAA Delay Details'}
              </button>
            </div>
          )}
          <div className="columns">
            <article>
              <h3>{depAirport.airport.icao} — {depAirport.airport.name}</h3>
              <p>{depAirport.airport.lat.toFixed(4)}, {depAirport.airport.lon.toFixed(4)}</p>
              {depAirport.faa.hasDelay ? (
                <>
                  <p>FAA Delay: {depAirport.faa.delays.length} active</p>
                  {showFaaDelayDetails && depAirport.faa.delays.map((delay) => (
                    <p key={`${delay.airportCode}-${delay.reason}`}>
                      {delay.type} {delay.minMinutes}-{delay.maxMinutes} min ({delay.reason})
                    </p>
                  ))}
                </>
              ) : (
                <p>FAA Delay: None reported</p>
              )}
            </article>
            <article>
              <h3>{arrAirport.airport.icao} — {arrAirport.airport.name}</h3>
              <p>{arrAirport.airport.lat.toFixed(4)}, {arrAirport.airport.lon.toFixed(4)}</p>
              {arrAirport.faa.hasDelay ? (
                <>
                  <p>FAA Delay: {arrAirport.faa.delays.length} active</p>
                  {showFaaDelayDetails && arrAirport.faa.delays.map((delay) => (
                    <p key={`${delay.airportCode}-${delay.reason}`}>
                      {delay.type} {delay.minMinutes}-{delay.maxMinutes} min ({delay.reason})
                    </p>
                  ))}
                </>
              ) : (
                <p>FAA Delay: None reported</p>
              )}
            </article>
          </div>
        </section>
      )}

      {(depWeather || arrWeather) && (
        <section className="card screen-only">
          <h2>Weather</h2>
          <div className="review-actions">
            <button type="button" className="review-toggle" onClick={() => setShowRawWeather((current) => !current)}>
              {showRawWeather ? 'Hide Raw METAR/TAF' : 'Show Raw METAR/TAF'}
            </button>
          </div>
          <div className="columns weather">
            <article>
              <h3>{departure.toUpperCase()}</h3>
              <p><strong>Source:</strong> {depWeather?.sourceStation ?? 'N/A'}{depWeather?.fallbackUsed ? ' (nearest reporting station)' : ''}</p>
              <p><strong>Decoded:</strong> {formatDecodedWeather(depWeather)}</p>
              {showRawWeather && <p><strong>METAR:</strong> {depWeather?.metar?.rawOb ?? 'N/A'}</p>}
              {showRawWeather && <p><strong>TAF:</strong> {depWeather?.taf?.rawTAF ?? 'N/A'}</p>}
            </article>
            <article>
              <h3>{arrival.toUpperCase()}</h3>
              <p><strong>Source:</strong> {arrWeather?.sourceStation ?? 'N/A'}{arrWeather?.fallbackUsed ? ' (nearest reporting station)' : ''}</p>
              <p><strong>Decoded:</strong> {formatDecodedWeather(arrWeather)}</p>
              {showRawWeather && <p><strong>METAR:</strong> {arrWeather?.metar?.rawOb ?? 'N/A'}</p>}
              {showRawWeather && <p><strong>TAF:</strong> {arrWeather?.taf?.rawTAF ?? 'N/A'}</p>}
            </article>
          </div>
        </section>
      )}

      {legs.length > 0 && (
        <section className="card screen-only">
          <h2>Nav Log Legs</h2>
          <div className="review-actions">
            <button type="button" className="review-toggle" onClick={() => setShowAdvancedNav((current) => !current)}>
              {showAdvancedNav ? 'Show Compact View' : 'Show Advanced Nav Math'}
            </button>
          </div>

          {showAdvancedNav ? (
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Dist (NM)</th>
                  <th>TC</th>
                  <th>Var</th>
                  <th>Wind</th>
                  <th>WCA</th>
                  <th>TH</th>
                  <th>MH</th>
                  <th>CH</th>
                  <th>GS</th>
                  <th>ETE (min)</th>
                  <th>Fuel (gal)</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => (
                  <tr key={`${leg.from}-${leg.to}`}>
                    <td>{leg.from} ({leg.fromLat.toFixed(4)}, {leg.fromLon.toFixed(4)})</td>
                    <td>{leg.to} ({leg.toLat.toFixed(4)}, {leg.toLon.toFixed(4)})</td>
                    <td>{leg.distanceNm.toFixed(1)}</td>
                    <td>{leg.trueCourse.toFixed(0)}°</td>
                    <td>{leg.magneticVariation.toFixed(1)}°</td>
                    <td>{leg.windDirection == null ? 'VRB' : `${leg.windDirection}°`}/{leg.windSpeed} ({leg.windStation})</td>
                    <td>{leg.windCorrection.toFixed(0)}°</td>
                    <td>{leg.trueHeading.toFixed(0)}°</td>
                    <td>{leg.magneticHeading.toFixed(0)}°</td>
                    <td>{leg.compassHeading.toFixed(0)}°</td>
                    <td>{leg.groundSpeed.toFixed(0)}</td>
                    <td>{leg.eteMinutes.toFixed(1)}</td>
                    <td>{leg.fuelGallons.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>Route</th>
                  <th>CH</th>
                  <th>Dist (NM)</th>
                  <th>GS</th>
                  <th>ETE (min)</th>
                  <th>Fuel (gal)</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg, index) => (
                  <tr key={`compact-${leg.from}-${leg.to}`}>
                    <td>{index + 1}</td>
                    <td>{leg.from} → {leg.to}</td>
                    <td>{leg.compassHeading.toFixed(0)}°</td>
                    <td>{leg.distanceNm.toFixed(1)}</td>
                    <td>{leg.groundSpeed.toFixed(0)}</td>
                    <td>{leg.eteMinutes.toFixed(1)}</td>
                    <td>{leg.fuelGallons.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="totals">
            Total Distance: {totals.totalDistance.toFixed(1)} NM · Total Time: {totals.totalTime.toFixed(1)} min · Total Fuel: {totals.totalFuel.toFixed(2)} gal
          </p>
          <p className="legend">
            TVMDC quick check: Magnetic = True − Variation, Compass = Magnetic − Deviation.
            Enter East as positive and West as negative.
          </p>
        </section>
      )}

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
                <ul className="freq-list">
                  {depFrequencies.slice(0, 10).map((frequency) => (
                    <li key={`dep-${frequency.type}-${frequency.frequencyMHz}`}>
                      {formatFrequencyType(frequency.type)}: {frequency.frequencyMHz}
                    </li>
                  ))}
                </ul>
              </article>
              <article>
                <h3>Arrival {arrAirport.airport.icao}</h3>
                <p>{formatDecodedWeather(arrWeather)}</p>
                <ul className="freq-list">
                  {arrFrequencies.slice(0, 10).map((frequency) => (
                    <li key={`arr-${frequency.type}-${frequency.frequencyMHz}`}>
                      {formatFrequencyType(frequency.type)}: {frequency.frequencyMHz}
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
            {printableDiagrams.map((chart) => (
              <article key={`${chart.role}-${chart.airportIcao}-${chart.chartName}`} className="print-chart-item">
                <h4>{chart.role} Diagram - {chart.airportIcao}</h4>
                <p>{chart.chartName}</p>
                {chart.imageUrl ? (
                  <img src={chart.imageUrl} alt={`${chart.role} airport diagram for ${chart.airportIcao}`} className="print-diagram-image" />
                ) : (
                  <p>
                    Diagram preview unavailable. Open full PDF:
                    {' '}
                    <a href={chart.pdfUrl} target="_blank" rel="noreferrer">{chart.airportIcao} airport diagram</a>
                  </p>
                )}
                <p className="screen-only">
                  <a href={chart.pdfUrl} target="_blank" rel="noreferrer">Open full PDF</a>
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="app-copyright screen-only">© 1C8 Flyers, LLC</footer>
    </main>
  )
}

export default App
