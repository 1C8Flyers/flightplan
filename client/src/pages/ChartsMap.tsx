import { useEffect, useMemo, useRef, useState } from 'react'
import type { LeafletEvent, Layer, Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../styles/ChartsMap.css'
import { defaultFaaChartLayerId, faaCharts } from '../config/faaCharts'

type BaseMapStyle = 'light' | 'dark'

type BaseMapLayer = {
  id: BaseMapStyle
  name: string
  tileUrl: string
  attribution: string
  maxZoom: number
}

const selectedLayerStorageKey = 'navlog:charts:selected-layer'
const selectedBaseMapStorageKey = 'navlog:charts:selected-basemap'

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

function getInitialLayerId() {
  const saved = window.localStorage.getItem(selectedLayerStorageKey)
  if (saved && faaCharts.some((layer) => layer.id === saved)) {
    return saved
  }

  return defaultFaaChartLayerId
}

function getInitialBaseMapId(): BaseMapStyle {
  const saved = window.localStorage.getItem(selectedBaseMapStorageKey)
  if (saved === 'light' || saved === 'dark') {
    return saved
  }

  return 'light'
}

function navigate(path: string) {
  if (window.location.pathname === path) {
    return
  }

  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
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
}

type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | 'Unknown'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed: ${path}`)
  }

  return response.json() as Promise<T>
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

  return `Wind ${windDirection} @ ${windSpeed} · Vis ${visibility} · Temp/Dew ${temperature}/${dewpoint}`
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

function getFlightCondition(weather: WeatherResponse | null): FlightCategory {
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

export default function ChartsMap() {
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const baseTileLayerRef = useRef<Layer | null>(null)
  const activeTileLayerRef = useRef<Layer | null>(null)
  const searchMarkerRef = useRef<Layer | null>(null)

  const [selectedLayerId, setSelectedLayerId] = useState<string>(getInitialLayerId)
  const [selectedBaseMapId, setSelectedBaseMapId] = useState<BaseMapStyle>(getInitialBaseMapId)
  const [appliedLayerId, setAppliedLayerId] = useState<string>(getInitialLayerId)
  const [mapReady, setMapReady] = useState(false)
  const [layerError, setLayerError] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState<{ lat: number; lon: number } | null>(null)
  const [tileStats, setTileStats] = useState({ loaded: 0, errors: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<AirportSearchResult[]>([])
  const [selectedAirport, setSelectedAirport] = useState<AirportResponse | null>(null)
  const [selectedAirportWeather, setSelectedAirportWeather] = useState<WeatherResponse | null>(null)
  const [selectedAirportError, setSelectedAirportError] = useState<string | null>(null)
  const [searchResultFlightConditions, setSearchResultFlightConditions] = useState<Record<string, FlightCategory>>({})
  const [searchResultFlightConditionsLoading, setSearchResultFlightConditionsLoading] = useState<Record<string, boolean>>({})

  const selectedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === selectedLayerId) ?? faaCharts[0],
    [selectedLayerId]
  )
  const appliedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === appliedLayerId) ?? faaCharts[0],
    [appliedLayerId]
  )
  const selectedBaseMap = useMemo(
    () => baseMapLayers.find((baseMap) => baseMap.id === selectedBaseMapId) ?? baseMapLayers[0],
    [selectedBaseMapId]
  )
  const trimmedSearchQuery = searchQuery.trim()
  const showSearchPanel = searchFocused || Boolean(trimmedSearchQuery)
  const selectedAirportFlightCondition = useMemo(
    () => getFlightCondition(selectedAirportWeather),
    [selectedAirportWeather]
  )

  useEffect(() => {
    window.localStorage.setItem(selectedLayerStorageKey, selectedLayer.id)
  }, [selectedLayer.id])

  useEffect(() => {
    window.localStorage.setItem(selectedBaseMapStorageKey, selectedBaseMap.id)
  }, [selectedBaseMap.id])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAppliedLayerId(selectedLayer.id)
    }, 200)

    return () => window.clearTimeout(timeoutId)
  }, [selectedLayer.id])

  useEffect(() => {
    const query = trimmedSearchQuery
    if (query.length < 2) {
      setSearchResults([])
      setSearchError(null)
      setSearchLoading(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchLoading(true)
        setSearchError(null)
        const response = await fetchJson<{ airports: AirportSearchResult[] }>(
          `/api/airports/search?q=${encodeURIComponent(query)}`
        )

        if (!cancelled) {
          setSearchResults(response.airports)
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([])
          setSearchError((error as Error).message)
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false)
        }
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [trimmedSearchQuery])

  useEffect(() => {
    const airportsToLoad = searchResults
      .slice(0, 8)
      .map((airport) => airport.ident.toUpperCase())
      .filter((ident) => !searchResultFlightConditions[ident] && !searchResultFlightConditionsLoading[ident])

    if (!airportsToLoad.length) {
      return
    }

    let cancelled = false

    setSearchResultFlightConditionsLoading((current) => {
      const next = { ...current }
      for (const ident of airportsToLoad) {
        next[ident] = true
      }
      return next
    })

    async function loadSearchResultFlightConditions() {
      const results = await Promise.allSettled(
        airportsToLoad.map(async (ident) => {
          const weather = await fetchJson<WeatherResponse>(`/api/weather/${encodeURIComponent(ident)}`)
          return [ident, getFlightCondition(weather)] as const
        })
      )

      if (cancelled) {
        return
      }

      setSearchResultFlightConditions((current) => {
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

      setSearchResultFlightConditionsLoading((current) => {
        const next = { ...current }
        for (const ident of airportsToLoad) {
          delete next[ident]
        }
        return next
      })
    }

    void loadSearchResultFlightConditions()

    return () => {
      cancelled = true
    }
  }, [searchResults, searchResultFlightConditions, searchResultFlightConditionsLoading])

  useEffect(() => {
    function handleDocumentPointerDown(event: MouseEvent) {
      if (!searchContainerRef.current) {
        return
      }

      if (event.target instanceof Node && searchContainerRef.current.contains(event.target)) {
        return
      }

      setSearchFocused(false)
    }

    document.addEventListener('mousedown', handleDocumentPointerDown)

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    async function initMap() {
      const leaflet = await import('leaflet')
      if (disposed || !mapHostRef.current || mapRef.current) {
        return
      }

      const map = leaflet.map(mapHostRef.current, {
        center: [39.5, -98.35],
        zoom: appliedLayer.minZoom,
        minZoom: appliedLayer.minZoom,
        maxZoom: appliedLayer.maxZoom,
        zoomControl: false,
        attributionControl: true
      })

      leaflet.control.zoom({ position: 'bottomleft' }).addTo(map)

      map.on('mousemove', (event: LeafletEvent & { latlng: { lat: number; lng: number } }) => {
        setMousePosition({ lat: event.latlng.lat, lon: event.latlng.lng })
      })

      map.on('mouseout', () => setMousePosition(null))

      mapRef.current = map
      setMapReady(true)

      window.setTimeout(() => {
        map.invalidateSize()
      }, 0)
    }

    initMap().catch((error) => {
      setLayerError((error as Error).message || 'FAA chart tiles unavailable. Check endpoint configuration.')
    })

    return () => {
      disposed = true
    }
  }, [appliedLayer.minZoom, appliedLayer.maxZoom])

  useEffect(() => {
    let disposed = false

    async function applyBaseLayer() {
      if (!mapReady || !mapRef.current) {
        return
      }

      const leaflet = await import('leaflet')
      if (disposed || !mapRef.current) {
        return
      }

      const map = mapRef.current
      if (baseTileLayerRef.current) {
        map.removeLayer(baseTileLayerRef.current)
      }

      const baseTileLayer = leaflet.tileLayer(selectedBaseMap.tileUrl, {
        minZoom: appliedLayer.minZoom,
        maxZoom: Math.max(appliedLayer.maxZoom, selectedBaseMap.maxZoom),
        attribution: selectedBaseMap.attribution,
        detectRetina: true
      })

      baseTileLayer.addTo(map)
      baseTileLayer.setZIndex(0)
      baseTileLayerRef.current = baseTileLayer
    }

    applyBaseLayer().catch((error) => {
      setLayerError((error as Error).message || 'Base map tiles unavailable.')
    })

    return () => {
      disposed = true
    }
  }, [mapReady, selectedBaseMap, appliedLayer.minZoom, appliedLayer.maxZoom])

  useEffect(() => {
    let disposed = false

    async function applyLayer() {
      if (!mapReady || !mapRef.current) {
        return
      }

      const leaflet = await import('leaflet')
      if (disposed || !mapRef.current) {
        return
      }

      const map = mapRef.current
      setLayerError(null)

      if (activeTileLayerRef.current) {
        map.removeLayer(activeTileLayerRef.current)
      }

      setTileStats({ loaded: 0, errors: 0 })

      map.setMinZoom(appliedLayer.minZoom)
      map.setMaxZoom(appliedLayer.maxZoom)

      const currentZoom = map.getZoom()
      if (currentZoom < appliedLayer.minZoom) {
        map.setZoom(appliedLayer.minZoom)
      } else if (currentZoom > appliedLayer.maxZoom) {
        map.setZoom(appliedLayer.maxZoom)
      }

      if (!appliedLayer.tileUrl || appliedLayer.tileUrl.startsWith('REPLACE_WITH_')) {
        setLayerError('FAA chart tiles unavailable. Check endpoint configuration.')
        return
      }

      const BlobTileLayer = (leaflet as any).GridLayer.extend({
        createTile(coords: { x: number; y: number; z: number }, done: (error: Error | null, tile: HTMLElement) => void) {
          const tile = document.createElement('img')
          tile.alt = ''
          tile.setAttribute('role', 'presentation')
          tile.decoding = 'async'

          const tileUrl = appliedLayer.tileUrl
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
                setTileStats((current) => ({ ...current, loaded: current.loaded + 1 }))
                done(null, tile)
              }

              tile.onerror = () => {
                URL.revokeObjectURL(objectUrl)
                setTileStats((current) => ({ ...current, errors: current.errors + 1 }))
                done(new Error('Tile image decode failed.'), tile)
              }

              tile.src = objectUrl
            })
            .catch((error) => {
              setTileStats((current) => ({ ...current, errors: current.errors + 1 }))
              done(error as Error, tile)
            })

          return tile
        }
      })

      const blobTileLayer = new BlobTileLayer({
        minZoom: appliedLayer.minZoom,
        maxZoom: appliedLayer.maxZoom,
        minNativeZoom: appliedLayer.minNativeZoom,
        maxNativeZoom: appliedLayer.maxZoom,
        attribution: appliedLayer.attribution
      })

      blobTileLayer.on('tileerror', () => {
        setLayerError('FAA chart tiles unavailable. Check endpoint configuration.')
      })

      blobTileLayer.addTo(map)
      blobTileLayer.setZIndex(10)
      activeTileLayerRef.current = blobTileLayer
    }

    applyLayer().catch((error) => {
      setLayerError((error as Error).message || 'FAA chart tiles unavailable. Check endpoint configuration.')
    })

    return () => {
      disposed = true
    }
  }, [appliedLayer, mapReady])

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
      }

      mapRef.current = null
      baseTileLayerRef.current = null
      activeTileLayerRef.current = null
      searchMarkerRef.current = null
      setMapReady(false)
    }
  }, [])

  async function selectAirport(airport: AirportSearchResult) {
    const map = mapRef.current
    if (!map) {
      return
    }

    setSearchQuery(airport.ident)
    setSearchFocused(false)
    setSelectedAirportError(null)

    map.setView([airport.lat, airport.lon], Math.max(map.getZoom(), 9))

    const leaflet = await import('leaflet')
    if (searchMarkerRef.current) {
      map.removeLayer(searchMarkerRef.current)
    }

    const marker = leaflet.circleMarker([airport.lat, airport.lon], {
      radius: 8,
      color: '#1fb26b',
      weight: 3,
      fillColor: '#122035',
      fillOpacity: 0.9
    })

    marker.addTo(map)
    searchMarkerRef.current = marker

    try {
      const airportResponse = await fetchJson<AirportResponse>(`/api/airport/${airport.ident}`)
      setSelectedAirport(airportResponse)

      try {
        const weatherResponse = await fetchJson<WeatherResponse>(`/api/weather/${airportResponse.airport.icao}`)
        setSelectedAirportWeather(weatherResponse)
      } catch {
        setSelectedAirportWeather(null)
      }
    } catch {
      setSelectedAirport(null)
      setSelectedAirportWeather(null)
      setSelectedAirportError(`No airport information available for ${airport.ident}.`)
    }
  }

  function clearSelectedAirport() {
    setSelectedAirport(null)
    setSelectedAirportWeather(null)
    setSelectedAirportError(null)

    if (mapRef.current && searchMarkerRef.current) {
      mapRef.current.removeLayer(searchMarkerRef.current)
      searchMarkerRef.current = null
    }
  }

  return (
    <main className="charts-page">
      <header className="charts-toolbar">
        <div className="charts-toolbar-group">
          <h1>FAA Charts Map</h1>
          <button type="button" onClick={() => navigate('/')} className="charts-link-button">Back to Planner</button>
        </div>

        <div className="charts-toolbar-selectors">
          <label className="charts-layer-select">
            Chart Layer
            <select value={selectedLayer.id} onChange={(event) => setSelectedLayerId(event.target.value)}>
              {faaCharts.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </label>

          <label className="charts-layer-select">
            Basemap
            <select value={selectedBaseMap.id} onChange={(event) => setSelectedBaseMapId(event.target.value as BaseMapStyle)}>
              {baseMapLayers.map((baseMap) => (
                <option key={baseMap.id} value={baseMap.id}>
                  {baseMap.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="charts-mouse-position">
          {mousePosition ? `${mousePosition.lat.toFixed(4)}, ${mousePosition.lon.toFixed(4)}` : 'Move cursor to view lat/lon'}
          {' · '}Map {mapReady ? 'ready' : 'loading'}
          {' · '}Tiles {tileStats.loaded} loaded / {tileStats.errors} errors
        </p>
      </header>

      {layerError && <p className="charts-error-banner">FAA chart tiles unavailable. Check endpoint configuration.</p>}

      <section className="charts-map-wrapper">
        <div className="charts-search-overlay" ref={searchContainerRef}>
          <label className="charts-search-box" htmlFor="charts-airport-search">
            <span className="charts-search-icon" aria-hidden="true">⌕</span>
            <input
              id="charts-airport-search"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults[0]) {
                  event.preventDefault()
                  void selectAirport(searchResults[0])
                }
              }}
              placeholder="Search"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {showSearchPanel && (
            <div className="charts-search-panel" role="listbox" aria-label="Airport search results">
              {!trimmedSearchQuery && (
                <>
                  <h3>Search for things like…</h3>
                  <ul>
                    <li><strong>KFCM</strong> - Find waypoints by identifier</li>
                    <li><strong>Minneapolis</strong> - Find by city name</li>
                    <li><strong>Flying Cloud</strong> - Find by facility name</li>
                    <li><strong>N1234</strong> - Find aircraft by registration</li>
                  </ul>
                </>
              )}

              {trimmedSearchQuery.length === 1 && <p className="charts-search-status">Type at least 2 characters to search.</p>}
              {searchLoading && <p className="charts-search-status">Searching airports…</p>}
              {searchError && <p className="charts-search-status charts-search-status-error">{searchError}</p>}

              {trimmedSearchQuery.length >= 2 && !searchLoading && !searchError && (
                <>
                  <h3>Airports</h3>
                  {searchResults.length === 0 ? (
                    <p className="charts-search-status">No airport matches found.</p>
                  ) : (
                    <ul className="charts-search-results">
                      {searchResults.map((airport) => (
                        <li key={`${airport.ident}-${airport.lat}-${airport.lon}`}>
                          <button type="button" onClick={() => void selectAirport(airport)}>
                            <span className="charts-search-result-ident-row">
                              <span className="charts-search-result-ident">{airport.ident}</span>
                              {(() => {
                                const ident = airport.ident.toUpperCase()
                                const isLoading = Boolean(searchResultFlightConditionsLoading[ident])
                                const category = searchResultFlightConditions[ident] ?? 'Unknown'
                                return (
                                  <span
                                    className={`charts-search-result-flight-category ${
                                      isLoading
                                        ? 'charts-search-result-flight-category-loading'
                                        : `charts-flight-condition-${category.toLowerCase()}`
                                    }`}
                                    aria-label={isLoading ? 'Flight conditions loading' : `Flight conditions ${category}`}
                                  >
                                    {isLoading ? '...' : category}
                                  </span>
                                )
                              })()}
                            </span>
                            <span className="charts-search-result-name">{airport.name}</span>
                            <span className="charts-search-result-meta">
                              {[airport.city, airport.state, 'USA'].filter(Boolean).join(', ')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {(selectedAirport || selectedAirportError) && (
          <article className="charts-airport-card">
            <div
              className={`charts-flight-condition charts-flight-condition-${selectedAirportFlightCondition.toLowerCase()}`}
              aria-live="polite"
            >
              {selectedAirportFlightCondition}
            </div>
            <header>
              <h3>
                {selectedAirport
                  ? `${selectedAirport.airport.icao} - ${selectedAirport.airport.name}`
                  : 'Airport Info'}
              </h3>
              <button type="button" onClick={clearSelectedAirport} aria-label="Close airport info">×</button>
            </header>

            {selectedAirport && (
              <>
                <p>
                  {selectedAirport.airport.lat.toFixed(4)}, {selectedAirport.airport.lon.toFixed(4)}
                  {selectedAirport.airport.state ? ` · ${selectedAirport.airport.state}` : ''}
                </p>
                <p>
                  FAA Delay: {selectedAirport.faa.hasDelay ? `${selectedAirport.faa.delays.length} active` : 'None reported'}
                </p>
                <p>Weather: {formatDecodedWeather(selectedAirportWeather)}</p>
              </>
            )}

            {selectedAirportError && <p className="charts-airport-card-error">{selectedAirportError}</p>}
          </article>
        )}

        <div ref={mapHostRef} className="charts-map" />
      </section>

      <footer className="charts-copyright">© 1C8 Flyers, LLC</footer>
    </main>
  )
}