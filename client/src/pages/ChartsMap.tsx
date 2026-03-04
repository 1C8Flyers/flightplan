import { useEffect, useMemo, useRef, useState } from 'react'
import type { LeafletEvent, Layer, Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../styles/ChartsMap.css'
import { defaultFaaChartLayerId, faaCharts } from '../config/faaCharts'

const storageKey = 'navlog:charts:selected-layer'

function getInitialLayerId() {
  const saved = window.localStorage.getItem(storageKey)
  if (saved && faaCharts.some((layer) => layer.id === saved)) {
    return saved
  }

  return defaultFaaChartLayerId
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

export default function ChartsMap() {
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const activeTileLayerRef = useRef<Layer | null>(null)
  const searchMarkerRef = useRef<Layer | null>(null)

  const [selectedLayerId, setSelectedLayerId] = useState<string>(getInitialLayerId)
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

  const selectedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === selectedLayerId) ?? faaCharts[0],
    [selectedLayerId]
  )
  const appliedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === appliedLayerId) ?? faaCharts[0],
    [appliedLayerId]
  )
  const trimmedSearchQuery = searchQuery.trim()
  const showSearchPanel = searchFocused || Boolean(trimmedSearchQuery)

  useEffect(() => {
    window.localStorage.setItem(storageKey, selectedLayer.id)
  }, [selectedLayer.id])

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
        zoomControl: true,
        attributionControl: true
      })

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

        <label className="charts-layer-select">
          Layer
          <select value={selectedLayer.id} onChange={(event) => setSelectedLayerId(event.target.value)}>
            {faaCharts.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>

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
                            <span className="charts-search-result-ident">{airport.ident}</span>
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
    </main>
  )
}