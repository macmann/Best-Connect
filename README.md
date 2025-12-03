# Atenxion Post-Login Sync Integration

This project now triggers Atenxion's background synchronization as part of the existing Brillar HR Portal login flow. After a user authenticates successfully, the browser immediately queues a non-blocking POST request to Atenxion QA so that the portal can stay responsive while downstream systems synchronize.

## How it works

- The login form in [`public/index.html`](public/index.html) submits to the local `/login` endpoint handled by the Node.js server (`server.js`).
- When authentication succeeds, [`public/index.js`](public/index.js) stores the session token and user object in `localStorage`, then calls `queuePostLoginSync(user.employeeId)` without awaiting it. The UI transitions instantly to the main app.
- `queuePostLoginSync` (also in `public/index.js`) sends `{"employeeId":"<employeeId>"}` to `https://api-qa.atenxion.ai/integrations/hr/post-login-sync` with a five-second timeout. Errors are logged to the console only.
- If `fetch` is unavailable or the request times out, the code falls back to `navigator.sendBeacon` with the same JSON payload to keep the sync fire-and-forget.
- Microsoft 365 SSO logins also trigger the same sync immediately after their redirect completes.

## Running the portal locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 to access the HR portal. The built-in credentials and endpoints remain unchanged; the only addition is the background Atenxion sync that fires after a successful login.

## Migrating leave system data

Run the migration script to backfill leave balance metadata for all employees. The migration no longer runs automatically when the server starts, so execute it manually whenever you need to normalize leave balances:

```bash
node scripts/migrateLeaveSystem.js
```

### MongoDB connectivity options

If your hosting environment requires explicit TLS settings, configure the database client with these environment variables:

- `MONGODB_FORCE_TLS=true` to always enable TLS (enabled automatically for `mongodb+srv://` URLs).
- `MONGODB_TLS_MIN_VERSION=TLSv1.2` to pin the minimum TLS version (defaults to `TLSv1.2`).
- `MONGODB_TLS_ALLOW_INVALID_CERTS=true` to allow self-signed certificates when debugging connection issues.
- `MONGODB_SERVER_SELECTION_TIMEOUT_MS` to adjust how long the driver waits for a healthy node (defaults to `30000`).

## Security note

For demo purposes the Atenxion bearer token is embedded directly in the client-side code. In production you should proxy this request through your backend or use another secure relay so the token is not exposed to end users.
