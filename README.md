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
- Leaflet airport diagram overlay generated from FAA NASR runway geometry (no FAA artwork reuse)
- Optional schematic surface layout (approximate apron/taxi connectors)
- Printable in-flight nav log packet with write-in fields (ATD/ATA/actual GS/fuel/notes), formatted for kneeboard size
- Printable packet includes departure/arrival frequencies and decoded METAR summary
- Printable full-page landscape flight plan data sheet with route navaids and morse patterns
- Printable departure and arrival airport diagrams (APD)
- Airport diagrams print two per page side-by-side
- Automatic ETE and fuel estimates by leg and totals

## Data Sources

- Airport weather: `https://aviationweather.gov/api/data/*`
- MOS guidance (MAV/MEX/MET text): `https://www.weather.gov/source/mdl/MOS/*`
- FAA delays: `https://nasstatus.faa.gov/api/airport-status-information`
- FAA sectionals: `https://aeronav.faa.gov/visual/*/PDFs/*.pdf`
- FAA NASR 28-Day Subscription (airport, frequency, runway, navaid datasets): `https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription`

### FAA NASR Cycle Metadata

- API endpoint: `GET /api/data-cycle`
- Response includes the detected NASR effective date and ZIP URL currently in use by the server.
- Detailed NASR availability and current usage map: `docs/NASR_DATA_COVERAGE.md`

### Airport Diagram GeoJSON API

- API endpoint: `GET /api/airports/:ident/diagram?schematic=0|1`
- Response includes airport metadata, runway polygons, runway-end labels, overlays (closed `X`, displaced thresholds), and optional schematic apron/taxi geometry.
- Runway feature properties include `source: "NASR"` and `fidelity: "measured" | "estimated"`.
- Client map controls include:
	- Planner map Layers menu: `Airport Diagrams`
	- Planner map Layers menu: `Schematic Surface Layout (Approx.)` (enabled only when diagrams are on)

### AI Service API

- `POST /api/ai/airport/brief`
	- Request body: `{ "airportData": { ... } }`
	- Response: `{ "summary": "...", "notes": "..." }`
- `POST /api/ai/airspace/explain`
	- Request body: `{ "airspaceData": { ... } }`
	- Response: `{ "summary": "...", "notes": "..." }`

Notes:
- METAR decoding is handled locally in the client (no AI request).
- TAF decoding is handled locally in the client (no AI request).
- MOS brief summaries are generated locally from server-fetched NWS MDL MOS text (MAV/MEX/MET).
- AI calls are server-side only; API keys are never exposed to the frontend.
- Responses are JSON-validated and include fallback output on upstream AI failures.

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

Create `server/.env`:

```bash
OPENAI_API_KEY=REPLACE_WITH_OPENAI_API_KEY
```

## Build

```bash
npm run build
```

Server validation commands:

```bash
npm run test --workspace server
npm run smoke:diagram --workspace server -- MSP
```

## Deploy with Docker (NAS)

This repo includes a production Docker deployment using:

- `server` container (Node/Express API)
- `web` container (Nginx serving the built React app and proxying `/api/*` to `server`)

### 1) Configure environment

```bash
cp .env.docker.example .env
```

Edit `.env` and set:

```bash
VITE_FAA_VFR_TILE_URL=REPLACE_WITH_FAA_VFR_TILE_ENDPOINT
VITE_FAA_TAC_TILE_URL=REPLACE_WITH_FAA_TAC_TILE_ENDPOINT
VITE_FAA_IFRLOW_TILE_URL=REPLACE_WITH_FAA_IFRLOW_TILE_ENDPOINT
```

### 2) Build and run

```bash
docker compose up -d --build
```

Open `http://YOUR_NAS_IP:8080`.

### 3) Recommended NAS reverse proxy

Put your NAS reverse proxy in front of port `8080` for TLS (443) and a friendly hostname, for example:

- `https://navlog.yourdomain.com` → `http://NAS_IP:8080`

### 4) Update workflow

```bash
docker compose pull
docker compose up -d --build
```

### 5) Logs / health checks

```bash
docker compose logs -f web
docker compose logs -f server
```

Quick API check:

```bash
curl http://YOUR_NAS_IP:8080/api/data-cycle
```

## Notes

- Wind inputs are interpreted as **true wind direction FROM** and speed in knots.
- Heading and groundspeed calculations are planning estimates and should be validated in standard preflight workflow.
- Dragging intermediate waypoints renames to nearby FAA airport/navaid when available; otherwise fallback is `WP#`.
