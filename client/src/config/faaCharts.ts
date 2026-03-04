export type FaaChartLayer = {
  id: string
  name: string
  type: 'xyz' | 'wmts'
  tileUrl: string
  minZoom: number
  minNativeZoom: number
  maxZoom: number
  attribution: string
}

const faaAttribution = 'FAA AeroNav Charts'

export const faaCharts: FaaChartLayer[] = [
  {
    id: 'vfr-sectional',
    name: 'VFR Sectional',
    type: 'xyz',
    tileUrl: import.meta.env.VITE_FAA_VFR_TILE_URL || 'REPLACE_WITH_FAA_VFR_TILE_ENDPOINT',
    minZoom: 4,
    minNativeZoom: 10,
    maxZoom: 13,
    attribution: faaAttribution
  },
  {
    id: 'vfr-tac',
    name: 'Terminal Area Chart (TAC)',
    type: 'xyz',
    tileUrl: import.meta.env.VITE_FAA_TAC_TILE_URL || 'REPLACE_WITH_FAA_TAC_TILE_ENDPOINT',
    minZoom: 4,
    minNativeZoom: 10,
    maxZoom: 14,
    attribution: faaAttribution
  },
  {
    id: 'ifr-low',
    name: 'IFR Low Enroute',
    type: 'xyz',
    tileUrl: import.meta.env.VITE_FAA_IFRLOW_TILE_URL || 'REPLACE_WITH_FAA_IFRLOW_TILE_ENDPOINT',
    minZoom: 4,
    minNativeZoom: 9,
    maxZoom: 12,
    attribution: faaAttribution
  }
]

export const defaultFaaChartLayerId = faaCharts[0].id