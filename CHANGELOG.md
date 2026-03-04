# Changelog

## 2026-03-04

### NASR migration and hardening

- `c86794e` Migrate core datasets to FAA NASR and expand airport comm parsing
  - Switched airport, navaid, runway, and frequency ingestion to FAA NASR cycle ZIP sources.
  - Added comm parsing from APT/RMK plus supplemental FAA comm datasets.
  - Added NASR cycle metadata API and UI display support.

- `64d7d8b` Harden TWR7 satellite mapping and add NASR coverage inventory
  - Replaced token-based tower matching with explicit TWR7 satellite-service mapping.
  - Added NASR inventory/usage mapping doc in `docs/NASR_DATA_COVERAGE.md`.

- `20f79e8` Invalidate NASR dataset caches on cycle change
  - Made NASR-derived caches cycle-aware using effective date keys.
  - Ensures dataset refresh on cycle rollover without waiting for stale cache windows.
