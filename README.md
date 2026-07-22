# BTPingApi
Server to process our formatted ping files and make the data available

## Running locally

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and adjust if needed (`APIPORT` is the API server's port, used in both dev and production; `DEVPORT` is the Vite dev server's port, only used by `npm run dev`; default `DATA_DIR` is `./Examples`, where `result_*.csv` ping files are scanned from; `DB_PATH` is where the local PGlite database is stored).
3. Start the dev server (API + client with hot reload):
   ```
   npm run dev
   ```
   - UI: http://localhost:5173
   - API docs (Swagger UI): http://localhost:3001/api/docs

On start, the server scans `DATA_DIR` for `result_<date>-<id>.csv` files and ingests any it hasn't seen before (tracked by filename). Re-scan on demand via `POST /api/ingest/scan` or the "Run scan" button in the UI. It also re-scans automatically every `SCAN_INTERVAL_HOURS`.

## Production build

```
npm run build
npm start
```

This compiles the server to `dist/` and builds the client to `client/dist/`; `npm start` serves both from a single process on `APIPORT` (default 3001).
