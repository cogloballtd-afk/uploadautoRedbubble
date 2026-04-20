# GPM Profile Dashboard

Phase 1 implementation for:

- syncing profiles from the local GPM API,
- selecting which profiles are active,
- mapping each profile to one local folder,
- validating the standard Excel file inside that folder,
- opening enabled profiles through a concurrency-limited run queue,
- storing opened sessions for the next browser automation phase.

## Runtime

- Node.js 24+
- SQLite via built-in `node:sqlite`
- Express for the dashboard and internal API

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Environment variables

- `PORT`: dashboard port. Default `3000`
- `GPM_API_BASE_URL`: default `http://127.0.0.1:19995`
- `EXCEL_FILENAME_STANDARD`: default `input.xlsx`
- `DATA_DIR`: default `./data`
- `LOG_DIR`: default `./logs`
- `ARTIFACTS_DIR`: default `./artifacts`

## Notes

- Phase 1 intentionally keeps GPM profiles open after a successful run item. Cleanup policy is deferred to the next phase.
- Folder validation is non-blocking at save time. Invalid rows are marked in the dashboard and skipped during a run.
- The standard Excel file name is currently assumed to be `input.xlsx`.

