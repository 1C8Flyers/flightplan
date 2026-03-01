# NavLog - VFR Navigation Log Web App

A full-stack web app for pilots to build a VFR nav log using live aviation data.

## Features

- Create a leg-by-leg VFR nav log from departure to arrival
- Optional custom waypoint support (`IDENT,lat,lon`)
- Live airport metadata (AviationWeather station data)
- Live weather (METAR + TAF)
- Live FAA NAS delay feed integration
- Suggested enroute waypoint airports auto-generated along route corridor
- FAA sectional chart selector + route overlay map
- Printable in-flight nav log packet with write-in fields (ATD/ATA/actual GS/fuel/notes), formatted for kneeboard size
- Printable packet includes departure/arrival frequencies and decoded METAR summary
- Printable full-page landscape flight plan data sheet with route navaids and morse patterns
- Printable departure and arrival airport diagrams (APD)
- Airport diagrams print two per page side-by-side
- Automatic ETE and fuel estimates by leg and totals

## Data Sources

- Airport + weather: `https://aviationweather.gov/api/data/*`
- FAA delays: `https://nasstatus.faa.gov/api/airport-status-information`
- FAA sectionals: `https://aeronav.faa.gov/visual/*/PDFs/*.pdf`
- Airport suggestions dataset: `https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv`

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Monorepo with npm workspaces (`client`, `server`)

## Run Locally

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

### FAA Charts Map Route

- Open `http://localhost:5173/charts` for seamless FAA chart tile browsing.
- Layer selector includes:
	- VFR Sectional
	- Terminal Area Chart (TAC)
	- IFR Low Enroute
- Selected layer is persisted in local storage.

### Environment Variables Required

Create `client/.env.local`:

```bash
VITE_FAA_VFR_TILE_URL=REPLACE_WITH_FAA_VFR_TILE_ENDPOINT
VITE_FAA_TAC_TILE_URL=REPLACE_WITH_FAA_TAC_TILE_ENDPOINT
VITE_FAA_IFRLOW_TILE_URL=REPLACE_WITH_FAA_IFRLOW_TILE_ENDPOINT
```

Example placeholder values:

```bash
VITE_FAA_VFR_TILE_URL=REPLACE_WITH_FAA_VFR_TILE_ENDPOINT
VITE_FAA_TAC_TILE_URL=REPLACE_WITH_FAA_TAC_TILE_ENDPOINT
VITE_FAA_IFRLOW_TILE_URL=REPLACE_WITH_FAA_IFRLOW_TILE_ENDPOINT
```

After updating env vars, restart the frontend dev server.

## Build

```bash
npm run build
```

## Notes

- Wind inputs are interpreted as **true wind direction FROM** and speed in knots.
- Heading and groundspeed calculations are planning estimates and should be validated in standard preflight workflow.
- Dragging intermediate waypoints renames to nearby FAA airport/navaid when available; otherwise fallback is `WP#`.
