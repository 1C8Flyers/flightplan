import { useEffect, useMemo, useRef, useState } from 'react'
import type { LeafletEvent, Map as LeafletMap, TileLayer } from 'leaflet'
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

export default function ChartsMap() {
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const activeTileLayerRef = useRef<TileLayer | null>(null)

  const [selectedLayerId, setSelectedLayerId] = useState<string>(getInitialLayerId)
  const [appliedLayerId, setAppliedLayerId] = useState<string>(getInitialLayerId)
  const [layerError, setLayerError] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState<{ lat: number; lon: number } | null>(null)

  const selectedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === selectedLayerId) ?? faaCharts[0],
    [selectedLayerId]
  )
  const appliedLayer = useMemo(
    () => faaCharts.find((layer) => layer.id === appliedLayerId) ?? faaCharts[0],
    [appliedLayerId]
  )

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
    let disposed = false

    async function initMap() {
      const leaflet = await import('leaflet')
      if (disposed || !mapHostRef.current || mapRef.current) {
        return
      }

      const map = leaflet.map(mapHostRef.current, {
        center: [39.5, -98.35],
        zoom: 6,
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
      if (!mapRef.current) {
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

      map.setMinZoom(appliedLayer.minZoom)
      map.setMaxZoom(appliedLayer.maxZoom)

      const currentZoom = map.getZoom()
      if (currentZoom < appliedLayer.minZoom) {
        map.setZoom(appliedLayer.minZoom)
      } else if (currentZoom > appliedLayer.maxZoom) {
        map.setZoom(appliedLayer.maxZoom)
      }

      const tileLayer = leaflet.tileLayer(appliedLayer.tileUrl, {
        minZoom: appliedLayer.minZoom,
        maxZoom: appliedLayer.maxZoom,
        attribution: appliedLayer.attribution,
        crossOrigin: true
      })

      tileLayer.on('tileerror', () => {
        setLayerError('FAA chart tiles unavailable. Check endpoint configuration.')
      })

      tileLayer.addTo(map)
      activeTileLayerRef.current = tileLayer
    }

    applyLayer().catch((error) => {
      setLayerError((error as Error).message || 'FAA chart tiles unavailable. Check endpoint configuration.')
    })

    return () => {
      disposed = true
    }
  }, [appliedLayer])

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
      }

      mapRef.current = null
      activeTileLayerRef.current = null
    }
  }, [])

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
        </p>
      </header>

      {layerError && <p className="charts-error-banner">FAA chart tiles unavailable. Check endpoint configuration.</p>}

      <section className="charts-map-wrapper">
        <div ref={mapHostRef} className="charts-map" />
      </section>
    </main>
  )
}