# NASR Data Coverage (NavLog)

This document tracks what is available in FAA NASR and what NavLog currently uses.

Current reference cycle used for this inventory: **2026-02-19** (FAA 28-day subscription ZIP).

## 1) NASR top-level text files available in current cycle

- AFF.txt
- APT.txt
- ARB.txt
- ATS.txt
- AWOS.txt
- AWY.txt
- CDR.txt
- COM.txt
- FIX.txt
- FSS.txt
- HPF.txt
- ILS.txt
- LID.txt
- MAA.txt
- MTR.txt
- NAV.txt
- PFR.txt
- PJA.txt
- README.txt
- STARDP.txt
- TWR.txt
- WXL.txt

Total: 22 files.

## 2) What NavLog currently uses

### Core datasets in active use

| NASR file | Used by NavLog | Usage status | Notes |
|---|---|---|---|
| APT.txt | Yes | Active | Airports (ident/name/lat/lon/state), CTAF/UNICOM, runway records, airport remarks-based comm extraction |
| NAV.txt | Yes | Active | Navaids for route navaid selection |
| TWR.txt | Yes | Active | Tower terminal communications, including **explicit TWR7 satellite-service mapping** |
| COM.txt | Yes | Active (supplemental) | Additional communication frequencies where airport ident + valid frequency are detectable |
| FSS.txt | Yes | Active (supplemental) | Additional FSS-related frequencies where airport ident + valid frequency are detectable |
| AWOS.txt | Yes | Active (supplemental) | Additional AWOS/ASOS-style frequencies where airport ident + valid frequency are detectable |
| WXL.txt | Yes | Active (supplemental) | Additional weather-station frequency hints where airport ident + valid frequency are detectable |

### NASR files currently not used

| NASR file | Used by NavLog | Potential future use |
|---|---|---|
| AFF.txt | No | FAA facility linkage enhancements |
| ARB.txt | No | ARTCC boundary/airspace visualization |
| ATS.txt | No | ATS route support |
| AWY.txt | No | Enroute airway route construction |
| CDR.txt | No | Coded departure routes |
| FIX.txt | No | Named fixes/intersections for waypoint expansion |
| HPF.txt | No | Holding pattern procedures |
| ILS.txt | No | Instrument landing system details |
| LID.txt | No | Location identifier normalization/fallback |
| MAA.txt | No | Military operating area / special data support |
| MTR.txt | No | Military training routes |
| PFR.txt | No | Preferred IFR route suggestions |
| PJA.txt | No | Parachute jump area overlays |
| README.txt | No | Metadata only |
| STARDP.txt | No | STAR/DP procedure integration |

## 3) API mapping (current implementation)

| API endpoint | Primary NASR source(s) | Notes |
|---|---|---|
| `/api/data-cycle` | FAA NASR subscription page + ZIP URL | Detects active cycle date and URL |
| `/api/airport/:icao` | APT.txt | Airport identity/position metadata |
| `/api/airports/in-bounds` | APT.txt | Viewport airport selection for map features |
| `/api/airports/search` | APT.txt | Airport lookup/search dataset |
| `/api/frequencies/:icao` | APT.txt + TWR.txt + COM.txt + FSS.txt + AWOS.txt + WXL.txt | Includes APT CTAF/UNICOM, APT RMK comm frequencies, explicit TWR7 satellite records, supplemental comm files |
| `/api/runways/:icao` | APT.txt (RWY records) | Runway dimensions/surface/lighting flags |
| `/api/airports/:ident/diagram` | APT.txt (airport + RWY records) | Server-generated geometry for map runway/overlay/schematic rendering |
| `/api/navaids/route` | NAV.txt | Route-adjacent navaid selection |
| `/api/waypoints/resolve` | APT.txt + NAV.txt | Waypoint identifier resolution |

## 4) Not in NASR (by design)

These remain external to NASR and are intentionally sourced elsewhere:

- Live weather observations/forecasts (METAR/TAF): AviationWeather API
- FAA operational delay feed: NAS status feed
- TFR geometry feed: FAA ArcGIS service
- FAA chart images/overlays: Aeronav digital products endpoints
- Airport diagram PDFs: FAA d-TPP Metafile XML + FAA d-TPP PDF hosting (`/api/airport-diagram/by-airport/:icao` and `/api/airport-diagram/pdf`)

## 5) Notes on frequency quality

- Non-towered fields like `1C8` may legitimately only publish CTAF/UNICOM in NASR.
- Towered airports often include richer comm data via TWR records (including TWR7 satellite-service mappings).
- Supplemental COM/FSS/AWOS/WXL parsing is additive and filtered by valid VHF comm frequency patterns.
- Diagram and airport lookups normalize across common identifier forms (ICAO/FAA/IATA/GPS/local) so map and chart requests resolve from mixed user inputs.
