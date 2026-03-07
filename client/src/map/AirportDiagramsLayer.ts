import L, { type DivIcon, type LayerGroup, type Map as LeafletMap } from 'leaflet'

type DiagramMode = 'in-view' | 'selected'

type DiagramAirport = {
  ident: string
  name: string
  lat: number
  lon: number
  longestRunwayFt: number
}

type FeatureCollection = {
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

type DiagramData = {
  airport: {
    ident: string
    name: string
    arp: [number, number]
  }
  runways: FeatureCollection
  runwayLabels: FeatureCollection
  overlays: FeatureCollection
  schematic: {
    apron: FeatureCollection
    taxi: FeatureCollection
  }
}

type CachedDiagram = {
  loadedAt: number
  data: DiagramData
}

type DiagramLayerOptions = {
  enabled: boolean
  schematicEnabled: boolean
  mode?: DiagramMode
  selectedAirportIdent?: string | null
  maxAirports?: number
  minZoom?: number
}

const cacheTtlMs = 5 * 60 * 1000
const moveDebounceMs = 220
const diagramFetchConcurrency = 8

function normalizeSurface(surface: string) {
  return surface.trim().toUpperCase()
}

function runwayStyle(surface: string, closed: boolean, emphasized: boolean): L.PathOptions {
  const baseWeightBoost = emphasized ? 0.8 : 0
  const normalized = normalizeSurface(surface)

  if (normalized.includes('WATER')) {
    return {
      color: '#5c7ca0',
      weight: 1.2 + baseWeightBoost,
      fillOpacity: 0,
      opacity: closed ? 0.5 : 0.75
    }
  }

  if (normalized.includes('GRAVEL') || normalized.includes('TURF') || normalized.includes('DIRT') || normalized.includes('GRASS')) {
    return {
      color: '#896b4f',
      weight: 1.3 + baseWeightBoost,
      dashArray: '6 4',
      fillColor: '#c4b090',
      fillOpacity: closed ? 0.2 : (emphasized ? 0.38 : 0.28),
      opacity: closed ? 0.45 : 0.8
    }
  }

  return {
    color: '#3d4a5b',
    weight: 1.5 + baseWeightBoost,
    fillColor: '#6f7e8d',
    fillOpacity: closed ? 0.2 : (emphasized ? 0.62 : 0.48),
    opacity: closed ? 0.45 : 0.95
  }
}

function resolveZoomThresholds(minZoom: number, mapMaxZoom: number) {
  const labelThreshold = Math.min(13, Math.max(minZoom + 1, mapMaxZoom - 1))
  const detailThreshold = Math.min(15, Math.max(minZoom + 2, mapMaxZoom))

  return {
    labelThreshold,
    detailThreshold
  }
}

export class AirportDiagramsLayer {
  private readonly map: LeafletMap
  private readonly rootGroup: LayerGroup
  private readonly runwayGroup: LayerGroup
  private readonly labelGroup: LayerGroup
  private readonly overlayGroup: LayerGroup
  private readonly schematicGroup: LayerGroup
  private readonly cache = new Map<string, CachedDiagram>()
  private readonly maxAirports: number
  private readonly minZoom: number
  private enabled: boolean
  private schematicEnabled: boolean
  private mode: DiagramMode
  private selectedAirportIdent: string | null
  private pendingRefreshTimer: number | null = null
  private activeController: AbortController | null = null
  private lastRenderKey: string | null = null

  constructor(map: LeafletMap, options: DiagramLayerOptions) {
    this.map = map
    this.rootGroup = L.layerGroup()
    this.runwayGroup = L.layerGroup()
    this.labelGroup = L.layerGroup()
    this.overlayGroup = L.layerGroup()
    this.schematicGroup = L.layerGroup()

    this.enabled = options.enabled
    this.schematicEnabled = options.schematicEnabled
    this.mode = options.mode ?? 'in-view'
    this.selectedAirportIdent = options.selectedAirportIdent ?? null
    this.maxAirports = options.maxAirports ?? 30
    this.minZoom = options.minZoom ?? 11

    this.rootGroup.addLayer(this.runwayGroup)
    this.rootGroup.addLayer(this.overlayGroup)
    this.rootGroup.addLayer(this.schematicGroup)
    this.rootGroup.addLayer(this.labelGroup)

    this.rootGroup.addTo(this.map)
    this.map.on('moveend zoomend', this.onMapMove)

    this.scheduleRefresh(0)
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      return
    }

    this.enabled = enabled
    this.scheduleRefresh(0)
  }

  setSchematicEnabled(enabled: boolean) {
    if (this.schematicEnabled === enabled) {
      return
    }

    this.schematicEnabled = enabled
    this.scheduleRefresh(0)
  }

  setMode(mode: DiagramMode) {
    if (this.mode === mode) {
      return
    }

    this.mode = mode
    this.scheduleRefresh(0)
  }

  setSelectedAirportIdent(ident: string | null) {
    const normalized = ident?.trim().toUpperCase() || null
    if (this.selectedAirportIdent === normalized) {
      return
    }

    this.selectedAirportIdent = normalized
    this.scheduleRefresh(0)
  }

  refreshNow() {
    this.scheduleRefresh(0)
  }

  destroy() {
    if (this.pendingRefreshTimer != null) {
      window.clearTimeout(this.pendingRefreshTimer)
    }

    if (this.activeController) {
      this.activeController.abort()
      this.activeController = null
    }

    this.map.off('moveend zoomend', this.onMapMove)
    this.rootGroup.remove()
  }

  private readonly onMapMove = () => {
    this.scheduleRefresh(moveDebounceMs)
  }

  private scheduleRefresh(delayMs: number) {
    if (this.pendingRefreshTimer != null) {
      window.clearTimeout(this.pendingRefreshTimer)
    }

    this.pendingRefreshTimer = window.setTimeout(() => {
      this.pendingRefreshTimer = null
      void this.refresh()
    }, delayMs)
  }

  private clearRender() {
    this.runwayGroup.clearLayers()
    this.labelGroup.clearLayers()
    this.overlayGroup.clearLayers()
    this.schematicGroup.clearLayers()
    this.lastRenderKey = null
  }

  private async refresh() {
    if (!this.enabled) {
      this.clearRender()
      return
    }

    const zoom = this.map.getZoom()
    if (zoom < this.minZoom) {
      this.clearRender()
      return
    }

    if (this.activeController) {
      this.activeController.abort()
    }

    const controller = new AbortController()
    this.activeController = controller

    const airports = await this.resolveAirports(controller.signal)
    if (controller.signal.aborted) {
      return
    }

    const diagrams = await this.loadDiagrams(airports, controller.signal)
    if (controller.signal.aborted) {
      return
    }

    this.render(diagrams)
  }

  private async resolveAirports(signal: AbortSignal): Promise<DiagramAirport[]> {
    if (this.mode === 'selected' && this.selectedAirportIdent) {
      return [{ ident: this.selectedAirportIdent, name: this.selectedAirportIdent, lat: 0, lon: 0, longestRunwayFt: 0 }]
    }

    const bounds = this.map.getBounds()
    const params = new URLSearchParams({
      minLat: String(bounds.getSouth()),
      maxLat: String(bounds.getNorth()),
      minLon: String(bounds.getWest()),
      maxLon: String(bounds.getEast()),
      limit: String(this.maxAirports)
    })

    const response = await fetch(`/api/airports/in-bounds?${params.toString()}`, { signal })
    if (!response.ok) {
      return []
    }

    const payload = await response.json() as { airports?: DiagramAirport[] }
    return (payload.airports ?? []).slice(0, this.maxAirports)
  }

  private async loadDiagrams(airports: DiagramAirport[], signal: AbortSignal) {
    if (!airports.length) {
      return []
    }

    const results: DiagramData[] = []
    for (let index = 0; index < airports.length; index += diagramFetchConcurrency) {
      const batch = airports.slice(index, index + diagramFetchConcurrency)
      const loaded = await Promise.all(batch.map(async (airport) => this.fetchDiagram(airport.ident, signal)))
      if (signal.aborted) {
        return []
      }

      for (const diagram of loaded) {
        if (diagram) {
          results.push(diagram)
        }
      }
    }

    return results
  }

  private async fetchDiagram(ident: string, signal: AbortSignal): Promise<DiagramData | null> {
    const normalizedIdent = ident.trim().toUpperCase()
    const cacheKey = `${normalizedIdent}:${this.schematicEnabled ? '1' : '0'}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.loadedAt < cacheTtlMs) {
      return cached.data
    }

    const response = await fetch(
      `/api/airports/${encodeURIComponent(normalizedIdent)}/diagram?schematic=${this.schematicEnabled ? '1' : '0'}`,
      { signal }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json() as DiagramData
    this.cache.set(cacheKey, {
      loadedAt: Date.now(),
      data
    })

    return data
  }

  private render(diagrams: DiagramData[]) {
    const zoom = this.map.getZoom()
    const { labelThreshold, detailThreshold } = resolveZoomThresholds(this.minZoom, this.map.getMaxZoom())
    const showLabels = zoom >= labelThreshold
    const showDetailOverlays = zoom >= detailThreshold
    const emphasizeRunways = showLabels

    const renderKey = diagrams
      .map((diagram) => [
        diagram.airport.ident,
        diagram.runways.features.length,
        diagram.overlays.features.length,
        diagram.runwayLabels.features.length,
        diagram.schematic.apron.features.length,
        diagram.schematic.taxi.features.length
      ].join(':'))
      .join(',') + `|${showLabels ? 'L1' : 'L0'}|${showDetailOverlays ? 'D1' : 'D0'}|${this.schematicEnabled ? 'S1' : 'S0'}`

    if (renderKey === this.lastRenderKey) {
      return
    }

    this.clearRender()

    for (const diagram of diagrams) {
      const runwaysLayer = L.geoJSON(diagram.runways as never, {
        style(feature) {
          const properties = feature?.properties ?? {}
          return runwayStyle(String(properties.surface ?? ''), Boolean(properties.closed), emphasizeRunways)
        }
      })

      this.runwayGroup.addLayer(runwaysLayer)

      const overlaysLayer = L.geoJSON(diagram.overlays as never, {
        filter(feature) {
          const kind = String(feature?.properties?.kind ?? '')
          if (kind === 'displaced-threshold') {
            return showDetailOverlays
          }

          return true
        },
        style(feature) {
          const kind = String(feature?.properties?.kind ?? '')
          if (kind === 'closed-x') {
            return {
              color: '#b32020',
              weight: 2,
              opacity: 0.8
            }
          }

          return {
            color: '#c9d1dc',
            weight: 1.5,
            dashArray: '6 5',
            opacity: 0.85
          }
        }
      })

      this.overlayGroup.addLayer(overlaysLayer)

      if (showLabels) {
        for (const labelFeature of diagram.runwayLabels.features) {
          if (labelFeature.geometry.type !== 'Point') {
            continue
          }

          const [lon, lat] = labelFeature.geometry.coordinates as [number, number]
          const text = String(labelFeature.properties.text ?? '')
          const rotationDeg = Number(labelFeature.properties.rotationDeg ?? 0)
          const labelIcon: DivIcon = L.divIcon({
            className: 'airport-diagram-label-icon',
            html: `<span class="airport-diagram-label" style="transform: rotate(${rotationDeg}deg)">${text}</span>`,
            iconSize: [36, 18],
            iconAnchor: [18, 9]
          })

          this.labelGroup.addLayer(L.marker([lat, lon], {
            icon: labelIcon,
            interactive: false,
            keyboard: false
          }))
        }
      }

      if (this.schematicEnabled && showDetailOverlays) {
        const apronLayer = L.geoJSON(diagram.schematic.apron as never, {
          style: {
            color: '#8aa7c0',
            weight: 1,
            fillColor: '#8aa7c0',
            fillOpacity: 0.12,
            dashArray: '4 4'
          }
        })

        const taxiLayer = L.geoJSON(diagram.schematic.taxi as never, {
          style: {
            color: '#8aa7c0',
            weight: 1,
            opacity: 0.55,
            dashArray: '4 4'
          }
        })

        this.schematicGroup.addLayer(apronLayer)
        this.schematicGroup.addLayer(taxiLayer)
      }
    }

    this.lastRenderKey = renderKey
  }
}
