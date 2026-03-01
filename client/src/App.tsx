import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'

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

type WeatherResponse = {
  metar: { rawOb?: string; reportTime?: string } | null
  taf: { rawTAF?: string; issueTime?: string } | null
  sourceStation?: string | null
  fallbackUsed?: boolean
}

type SuggestedWaypoint = {
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

type SectionalOverlayMetadata = {
  bounds: [[number, number], [number, number]]
  imageUrl: string
}

type PrintableChart = {
  role: 'Departure' | 'Arrival'
  airportIcao: string
  chartName: string
  effectiveDate: string
  imageUrl: string
}

type LandmarkNameResponse = {
  ident: string | null
  label: string | null
  source: string | null
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
  const cruiseAltitudeOptions = [3000, 6000, 6500, 9000, 12000, 18000, 24000]

  const [departure, setDeparture] = useState('KOSH')
  const [arrival, setArrival] = useState('KMSN')
  const [waypointsInput, setWaypointsInput] = useState('')
  const [cruiseAltitudeFt, setCruiseAltitudeFt] = useState(3000)
  const [tas, setTas] = useState(110)
  const [compassDeviation, setCompassDeviation] = useState(0)
  const [fuelBurn, setFuelBurn] = useState(9)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [depAirport, setDepAirport] = useState<AirportResponse | null>(null)
  const [arrAirport, setArrAirport] = useState<AirportResponse | null>(null)
  const [depWeather, setDepWeather] = useState<WeatherResponse | null>(null)
  const [arrWeather, setArrWeather] = useState<WeatherResponse | null>(null)
  const [suggestedWaypoints, setSuggestedWaypoints] = useState<SuggestedWaypoint[]>([])
  const [sectionals, setSectionals] = useState<SectionalChart[]>([])
  const [selectedSectionalUrl, setSelectedSectionalUrl] = useState('')
  const [windsAloft, setWindsAloft] = useState<WindsAloftResponse | null>(null)
  const [legs, setLegs] = useState<Leg[]>([])
  const [routePoints, setRoutePoints] = useState<Point[]>([])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [printableCharts, setPrintableCharts] = useState<PrintableChart[]>([])
  const [printChartsLoading, setPrintChartsLoading] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const rasterLayerRef = useRef<any>(null)
  const routeLayerRef = useRef<any>(null)
  const markerLayerRef = useRef<any>(null)
  const recalcRequestIdRef = useRef(0)

  const totals = useMemo(() => {
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distanceNm, 0)
    const totalTime = legs.reduce((sum, leg) => sum + leg.eteMinutes, 0)
    const totalFuel = legs.reduce((sum, leg) => sum + leg.fuelGallons, 0)
    return { totalDistance, totalTime, totalFuel }
  }, [legs])

  async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(path)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `Request failed: ${path}`)
    }
    return response.json() as Promise<T>
  }

  function parseWaypointLines(): Point[] {
    return waypointsInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ident, latText, lonText] = line.split(',').map((value) => value.trim())
        const lat = Number(latText)
        const lon = Number(lonText)
        if (!ident || Number.isNaN(lat) || Number.isNaN(lon)) {
          throw new Error('Waypoint format must be IDENT,lat,lon (example: RIPON,43.84,-88.84).')
        }
        const normalizedIdent = ident.toUpperCase()
        return {
          ident: normalizedIdent,
          lat,
          lon,
          originalIdent: normalizedIdent,
          originalLat: lat,
          originalLon: lon
        }
      })
  }

  function useSuggestedWaypointLines() {
    if (!suggestedWaypoints.length) {
      return
    }

    const value = suggestedWaypoints
      .map((waypoint) => `${waypoint.ident},${waypoint.lat.toFixed(6)},${waypoint.lon.toFixed(6)}`)
      .join('\n')

    setWaypointsInput(value)
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

  function findNearestSectional(lat: number, lon: number, availableSectionals: SectionalChart[]) {
    return availableSectionals
      .filter((sectional) => sectional.centerLat != null && sectional.centerLon != null)
      .sort((a, b) => {
        const aLat = a.centerLat ?? 0
        const aLon = a.centerLon ?? 0
        const bLat = b.centerLat ?? 0
        const bLon = b.centerLon ?? 0
        const aDist2 = (aLat - lat) ** 2 + (aLon - lon) ** 2
        const bDist2 = (bLat - lat) ** 2 + (bLon - lon) ** 2
        return aDist2 - bDist2
      })[0] ?? null
  }

  async function loadPrintableCharts(
    depAirportResponse: AirportResponse,
    arrAirportResponse: AirportResponse,
    availableSectionals: SectionalChart[]
  ) {
    setPrintChartsLoading(true)

    try {
      const depChart = findNearestSectional(depAirportResponse.airport.lat, depAirportResponse.airport.lon, availableSectionals)
      const arrChart = findNearestSectional(arrAirportResponse.airport.lat, arrAirportResponse.airport.lon, availableSectionals)

      const chartCandidates = [
        depChart
          ? {
            role: 'Departure' as const,
            airportIcao: depAirportResponse.airport.icao,
            chart: depChart
          }
          : null,
        arrChart
          ? {
            role: 'Arrival' as const,
            airportIcao: arrAirportResponse.airport.icao,
            chart: arrChart
          }
          : null
      ].filter((value): value is NonNullable<typeof value> => Boolean(value))

      if (!chartCandidates.length) {
        setPrintableCharts([])
        return
      }

      const overlays = await Promise.all(
        chartCandidates.map(async (candidate) => {
          const metadata = await fetchJson<SectionalOverlayMetadata>(
            `/api/sectionals/overlay-metadata?source=${encodeURIComponent(candidate.chart.url)}`
          )

          return {
            role: candidate.role,
            airportIcao: candidate.airportIcao,
            chartName: candidate.chart.name,
            effectiveDate: candidate.chart.effectiveDate,
            imageUrl: metadata.imageUrl
          }
        })
      )

      setPrintableCharts(overlays)
    } catch {
      setPrintableCharts([])
    } finally {
      setPrintChartsLoading(false)
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

      const [depAirportResponse, arrAirportResponse, depWeatherResponse, arrWeatherResponse] = await Promise.all([
        fetchJson<AirportResponse>(`/api/airport/${depIcao}`),
        fetchJson<AirportResponse>(`/api/airport/${arrIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${depIcao}`),
        fetchJson<WeatherResponse>(`/api/weather/${arrIcao}`)
      ])

      const [suggestionResponse, sectionalResponse] = await Promise.all([
        fetchJson<{ suggestions: SuggestedWaypoint[] }>(
          `/api/route/suggestions?depLat=${depAirportResponse.airport.lat}&depLon=${depAirportResponse.airport.lon}&arrLat=${arrAirportResponse.airport.lat}&arrLon=${arrAirportResponse.airport.lon}`
        ),
        fetchJson<{ sectionals: SectionalChart[] }>('/api/sectionals')
      ])

      setDepAirport(depAirportResponse)
      setArrAirport(arrAirportResponse)
      setDepWeather(depWeatherResponse)
      setArrWeather(arrWeatherResponse)
      setSuggestedWaypoints(suggestionResponse.suggestions)
      setSectionals(sectionalResponse.sectionals)

      const routeMidLat = (depAirportResponse.airport.lat + arrAirportResponse.airport.lat) / 2
      const routeMidLon = (depAirportResponse.airport.lon + arrAirportResponse.airport.lon) / 2
      const bestSectional = sectionalResponse.sectionals
        .filter((sectional) => sectional.centerLat != null && sectional.centerLon != null)
        .sort((a, b) => {
          const aLat = a.centerLat ?? 0
          const aLon = a.centerLon ?? 0
          const bLat = b.centerLat ?? 0
          const bLon = b.centerLon ?? 0
          const aDist2 = (aLat - routeMidLat) ** 2 + (aLon - routeMidLon) ** 2
          const bDist2 = (bLat - routeMidLat) ** 2 + (bLon - routeMidLon) ** 2
          return aDist2 - bDist2
        })[0]

      const selected = bestSectional ?? sectionalResponse.sectionals[0]
      if (selected) {
        setSelectedSectionalUrl(selected.url)
      }

      await loadPrintableCharts(depAirportResponse, arrAirportResponse, sectionalResponse.sectionals)

      if (!waypointsInput.trim() && suggestionResponse.suggestions.length) {
        const value = suggestionResponse.suggestions
          .map((waypoint) => `${waypoint.ident},${waypoint.lat.toFixed(6)},${waypoint.lon.toFixed(6)}`)
          .join('\n')
        setWaypointsInput(value)
      }

      const userWaypoints = parseWaypointLines()
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
      setWaypointsInput(toWaypointInputFromRoute(points))
      await recomputeRouteCalculations(points)
    } catch (caughtError) {
      setError((caughtError as Error).message)
      setLegs([])
      setSuggestedWaypoints([])
      setWindsAloft(null)
      setRoutePoints([])
      setPrintableCharts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const selectedSource = selectedSectionalUrl
    if (!selectedSource || routePoints.length < 2 || !mapContainerRef.current) {
      return
    }

    let cancelled = false

    async function renderChartOverlay() {
      setMapLoading(true)
      setMapError(null)

      const leaflet = await import('leaflet')

      if (cancelled || !mapContainerRef.current) {
        return
      }

      if (!mapRef.current) {
        mapRef.current = leaflet.map(mapContainerRef.current, {
          zoomControl: true,
          attributionControl: true
        })
      }

      mapRef.current.invalidateSize()

      const response = await fetch(`/api/sectionals/overlay-metadata?source=${encodeURIComponent(selectedSource)}`)
      if (!response.ok) {
        throw new Error('Failed to load sectional overlay metadata.')
      }

      const overlay = await response.json() as SectionalOverlayMetadata

      if (cancelled || !mapRef.current) {
        return
      }

      if (rasterLayerRef.current) {
        mapRef.current.removeLayer(rasterLayerRef.current)
      }

      rasterLayerRef.current = leaflet.imageOverlay(
        overlay.imageUrl,
        overlay.bounds,
        {
          interactive: false,
        opacity: 0.92,
          crossOrigin: false
        }
      )

      rasterLayerRef.current.addTo(mapRef.current)
      mapRef.current.fitBounds(overlay.bounds)

      if (routeLayerRef.current) {
        mapRef.current.removeLayer(routeLayerRef.current)
      }

      if (markerLayerRef.current) {
        mapRef.current.removeLayer(markerLayerRef.current)
      }

      routeLayerRef.current = leaflet.polyline(
        routePoints.map((point) => [point.lat, point.lon]),
        {
          color: '#d00000',
          weight: 3,
          opacity: 0.95
        }
      )

      routeLayerRef.current.addTo(mapRef.current)

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
              await recomputeRouteCalculations(updatedPoints)
            } catch (caughtError) {
              setError((caughtError as Error).message)
            }
          })
        }

        return marker
      })

      markerLayerRef.current = leaflet.layerGroup(markers)
      markerLayerRef.current.addTo(mapRef.current)
      setMapLoading(false)
    }

    renderChartOverlay().catch((caughtError) => {
      const message = (caughtError as Error).message || 'Failed to render sectional map.'
      setMapError(message)
      setMapLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [selectedSectionalUrl, routePoints])

  return (
    <main className="app">
      <h1 className="screen-only">VFR Nav Log Builder</h1>
      <p className="subtitle screen-only">Build a pilot nav log with live airport, weather, and FAA status data.</p>

      <section className="card screen-only">
        <h2>Flight Setup</h2>
        <div className="grid">
          <label>
            Departure (ICAO/IATA/FAA)
            <input value={departure} onChange={(event) => setDeparture(event.target.value.toUpperCase())} maxLength={4} />
          </label>
          <label>
            Arrival (ICAO/IATA/FAA)
            <input value={arrival} onChange={(event) => setArrival(event.target.value.toUpperCase())} maxLength={4} />
          </label>
          <label>
            Cruise Altitude (ft)
            <select value={cruiseAltitudeFt} onChange={(event) => setCruiseAltitudeFt(Number(event.target.value))}>
              {cruiseAltitudeOptions.map((altitude) => (
                <option key={altitude} value={altitude}>{altitude}</option>
              ))}
            </select>
          </label>
          <label>
            Cruise TAS (kts)
            <input type="number" value={tas} onChange={(event) => setTas(Number(event.target.value))} />
          </label>
          <label>
            Compass Deviation (°E + / °W -)
            <input type="number" value={compassDeviation} onChange={(event) => setCompassDeviation(Number(event.target.value))} />
          </label>
          <label>
            Fuel Burn (gph)
            <input type="number" value={fuelBurn} onChange={(event) => setFuelBurn(Number(event.target.value))} />
          </label>
        </div>

        <label className="waypoints">
          Optional Waypoints (one per line: IDENT,lat,lon)
          <textarea
            rows={4}
            value={waypointsInput}
            onChange={(event) => setWaypointsInput(event.target.value)}
            placeholder="RIPON,43.8427,-88.8445"
          />
        </label>

        <button onClick={buildNavLog} disabled={loading}>
          {loading ? 'Loading data...' : 'Build Nav Log'}
        </button>
        {legs.length > 0 && (
          <button className="print-button" onClick={() => window.print()} type="button">
            Print Nav Log Packet
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>

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

      {depAirport && arrAirport && (
        <section className="card screen-only">
          <h2>Airport + FAA Status</h2>
          <div className="columns">
            <article>
              <h3>{depAirport.airport.icao} — {depAirport.airport.name}</h3>
              <p>{depAirport.airport.lat.toFixed(4)}, {depAirport.airport.lon.toFixed(4)}</p>
              {depAirport.faa.hasDelay ? (
                depAirport.faa.delays.map((delay) => (
                  <p key={`${delay.airportCode}-${delay.reason}`}>
                    FAA Delay: {delay.type} {delay.minMinutes}-{delay.maxMinutes} ({delay.reason})
                  </p>
                ))
              ) : (
                <p>FAA Delay: None reported</p>
              )}
            </article>
            <article>
              <h3>{arrAirport.airport.icao} — {arrAirport.airport.name}</h3>
              <p>{arrAirport.airport.lat.toFixed(4)}, {arrAirport.airport.lon.toFixed(4)}</p>
              {arrAirport.faa.hasDelay ? (
                arrAirport.faa.delays.map((delay) => (
                  <p key={`${delay.airportCode}-${delay.reason}`}>
                    FAA Delay: {delay.type} {delay.minMinutes}-{delay.maxMinutes} ({delay.reason})
                  </p>
                ))
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
          <div className="columns weather">
            <article>
              <h3>{departure.toUpperCase()}</h3>
              <p><strong>Source:</strong> {depWeather?.sourceStation ?? 'N/A'}{depWeather?.fallbackUsed ? ' (nearest reporting station)' : ''}</p>
              <p><strong>METAR:</strong> {depWeather?.metar?.rawOb ?? 'N/A'}</p>
              <p><strong>TAF:</strong> {depWeather?.taf?.rawTAF ?? 'N/A'}</p>
            </article>
            <article>
              <h3>{arrival.toUpperCase()}</h3>
              <p><strong>Source:</strong> {arrWeather?.sourceStation ?? 'N/A'}{arrWeather?.fallbackUsed ? ' (nearest reporting station)' : ''}</p>
              <p><strong>METAR:</strong> {arrWeather?.metar?.rawOb ?? 'N/A'}</p>
              <p><strong>TAF:</strong> {arrWeather?.taf?.rawTAF ?? 'N/A'}</p>
            </article>
          </div>
        </section>
      )}

      {legs.length > 0 && (
        <section className="card screen-only">
          <h2>Nav Log Legs</h2>
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

          <p className="totals">
            Total Distance: {totals.totalDistance.toFixed(1)} NM · Total Time: {totals.totalTime.toFixed(1)} min · Total Fuel: {totals.totalFuel.toFixed(2)} gal
          </p>
          <p className="legend">
            TVMDC quick check: Magnetic = True − Variation, Compass = Magnetic − Deviation.
            Enter East as positive and West as negative.
          </p>
        </section>
      )}

      {sectionals.length > 0 && (
        <section className="card screen-only">
          <h2>FAA Sectional Chart + Route Overlay</h2>
          <label>
            Select Sectional
            <select
              value={selectedSectionalUrl}
              onChange={(event) => setSelectedSectionalUrl(event.target.value)}
            >
              {sectionals.map((sectional) => (
                <option key={sectional.url} value={sectional.url}>
                  {sectional.name} ({sectional.effectiveDate})
                </option>
              ))}
            </select>
          </label>
          {selectedSectionalUrl && (
            <>
              {mapLoading && <p>Loading sectional map...</p>}
              {mapError && <p className="error">{mapError}</p>}
              <div ref={mapContainerRef} className="sectional-map" />
              <p>
                Route is drawn on a georeferenced FAA sectional chart layer generated from the official sectional files.
                If needed, open the official FAA PDF directly:
                {' '}
                <a href={selectedSectionalUrl} target="_blank" rel="noreferrer">Open FAA sectional PDF</a>
              </p>
            </>
          )}
        </section>
      )}

      {legs.length > 0 && depAirport && arrAirport && (
        <section className="card print-packet">
          <h2>VFR Nav Log - Printable Flight Packet</h2>
          <p>
            Route: {depAirport.airport.icao} to {arrAirport.airport.icao}
            {' · '}
            Date: __________
            {' · '}
            Aircraft: __________
            {' · '}
            Tail #: __________
          </p>
          <p>
            Planned TAS: {tas} kts {' · '}
            Cruise Altitude: {cruiseAltitudeFt} ft {' · '}
            Fuel Burn: {fuelBurn} gph
          </p>

          <table className="print-navlog-table">
            <thead>
              <tr>
                <th>Leg</th>
                <th>From</th>
                <th>To</th>
                <th>TC</th>
                <th>MH</th>
                <th>Dist</th>
                <th>Plan GS</th>
                <th>Plan ETE</th>
                <th>ATD</th>
                <th>ATA</th>
                <th>Actual GS</th>
                <th>Fuel Used</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, index) => (
                <tr key={`print-${leg.from}-${leg.to}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{leg.from}</td>
                  <td>{leg.to}</td>
                  <td>{leg.trueCourse.toFixed(0)}°</td>
                  <td>{leg.magneticHeading.toFixed(0)}°</td>
                  <td>{leg.distanceNm.toFixed(1)} NM</td>
                  <td>{leg.groundSpeed.toFixed(0)} kt</td>
                  <td>{leg.eteMinutes.toFixed(1)} min</td>
                  <td className="write-cell" />
                  <td className="write-cell" />
                  <td className="write-cell" />
                  <td className="write-cell" />
                  <td className="write-cell notes-cell" />
                </tr>
              ))}
            </tbody>
          </table>

          <p className="totals">
            Total Distance: {totals.totalDistance.toFixed(1)} NM · Total Time: {totals.totalTime.toFixed(1)} min · Planned Fuel: {totals.totalFuel.toFixed(2)} gal
          </p>

          <div className="print-notes-grid">
            <div className="write-block">
              <strong>Preflight / Departure Notes</strong>
            </div>
            <div className="write-block">
              <strong>Enroute Notes</strong>
            </div>
            <div className="write-block">
              <strong>Arrival Notes</strong>
            </div>
          </div>

          <h3>Departure and Arrival Airport Charts</h3>
          {printChartsLoading && <p>Loading printable chart images...</p>}
          {!printChartsLoading && printableCharts.length === 0 && (
            <p>Printable charts unavailable for this route.</p>
          )}

          <div className="print-charts-grid">
            {printableCharts.map((chart) => (
              <article key={`${chart.role}-${chart.airportIcao}-${chart.chartName}`} className="print-chart-item">
                <h4>{chart.role} Chart - {chart.airportIcao}</h4>
                <p>{chart.chartName} ({chart.effectiveDate})</p>
                <img src={chart.imageUrl} alt={`${chart.role} chart for ${chart.airportIcao}`} />
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

export default App
