# Bazaar Sync

NSE Options Analytics & Backtesting Platform — live option chain, OI heatmap, PCR, Max Pain, IV charts, straddle chart, multi-leg Strategy Builder with payoff/Greeks, and a MySQL-backed backtesting engine. Free/Pro tiers with JWT auth.

- Frontend: React (Vite) + Tailwind CSS — `client/`
- Backend: Express 5 + Socket.io — `server/`
- Database: MySQL/MariaDB only
- Market data: **Angel One SmartAPI** (REST login + WebSocket 2.0 feed + historical candle API)

See `CLAUDE.md` for full project context and architecture history.

## Architecture (live data path)

```
Angel One SmartAPI WS  ──►  workers/marketWorker.js   (separate OS process)
                             │  validate → buffer (100 rows / 2s) → bulk INSERT
                             │  tiers: live_index_ticks (every tick),
                             │         live_option_ticks (2s), live_greeks_snapshots (5s),
                             │         pcr_snapshots + oi_summary_snapshots (1min)
                             │
                             └─ IPC (latest-tick summaries only, no tokens)
                                       │
server.js (Express + socket.io) ◄──────┘
   ├─ services/marketCache.js   in-memory Map, fed only by worker IPC
   ├─ services/socketBroadcast  io.emit("latestTicks") every ~1s from the cache
   └─ GET /api/option-chain/:symbol  live → cache; closed/worker-down → MySQL history

React  ◄── socket.io only (never the broker, never MySQL)
```

Worker lifecycle: `cron/marketStart.js` forks the worker at **08:45 IST Mon-Fri**, `cron/marketStop.js` gracefully stops it at **15:35 IST** (IPC shutdown → WS close → buffer flush → pool close → exit 0). If the worker dies mid-day it is reforked with backoff and loud logging. The nightly historical pull (`services/cron.js`, 23:00 IST Mon-Fri) fills `option_chain_history`/`ohlcv_data` via Angel One's historical candle + OI APIs — the backtesting engine reads only those MySQL tables, never a broker.

## Local development

```bash
git clone https://github.com/nikhilgupta-9/bazaar-sync.git
cd bazaar-sync/server && npm install
cd ../client && npm install

# DB — needs MySQL/MariaDB running locally (XAMPP or standalone)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS bazaar_sync CHARACTER SET utf8mb4;"
mysql -u root bazaar_sync < server/config/schema.sql

# server/.env — copy from .env.example, fill in real values by hand (never via git)
cd server && cp .env.example .env
```

Required env vars (see `server/.env.example` for the full list):

| Var | What |
| --- | --- |
| `ANGEL_API_KEY` | SmartAPI app key (smartapi.angelbroking.com → My Apps) |
| `ANGEL_CLIENT_ID` | Angel One client code |
| `ANGEL_PASSWORD` | SmartAPI login PIN |
| `ANGEL_TOTP_SECRET` | Base32 TOTP secret from smartapi.angelbroking.com/enable-totp (the QR secret, **not** a 6-digit code) |
| `JWT_SECRET`, `DB_*` | Auth + MySQL |

Login is fully automatic — the TOTP is generated locally via `otplib`; there is no daily manual session step. Tokens live only in the worker process's memory and are never logged or written to disk.

```bash
cd server && npm run dev      # API on port 5001
cd client && npm run dev      # Vite dev server on 5173
```

Verify: `curl http://localhost:5001/health` → `{"status":"ok","database":"connected",...}`.

### Admin app (separate from `client/`)

`admin/` is a genuinely separate React (Vite) app — its own deployment/subdomain in production, not a route inside `client/` (see CLAUDE.md Phase 10). It talks to the same `server/` API (`/api/admin/*`, gated by `requireAuth + requireAdmin` — role must be `'admin'` in the `users` table, set by hand in MySQL: `UPDATE users SET role='admin' WHERE email='...';`, no self-service admin signup).

```bash
cd admin && npm install
cp .env.example .env   # only VITE_API_URL, same default as client/
npm run dev             # Vite dev server on 5174 (fixed port, see vite.config.js)
```

To run the market worker manually outside the cron window: `cd server && npm run worker`.
To backfill history: `cd server && node scripts/backfillHistory.js NIFTY 7`.

## Deployment (Hostinger VPS)

1. **Provision**: Ubuntu VPS with Node 20+, MySQL/MariaDB, nginx. Create the DB and load `server/config/schema.sql` as above.
2. **Code + deps**:
   ```bash
   git clone <repo> /opt/bazaar-sync
   cd /opt/bazaar-sync/server && npm ci --omit=dev
   cd ../client && npm ci && npm run build   # outputs client/dist
   cd ../admin && npm ci && npm run build    # outputs admin/dist — separate admin app, see below
   ```
3. **Env**: create `/opt/bazaar-sync/server/.env` by hand from `.env.example` (never commit it). Set `CORS_ORIGINS` to the real site origin(s) **plus the admin subdomain** (e.g. `https://bazaarsync.com,https://admin.bazaarsync.com`).
4. **PM2** (process manager — required; the node processes must auto-restart):
   ```bash
   npm i -g pm2
   cd /opt/bazaar-sync/server
   pm2 start ecosystem.config.js          # starts bazaar-sync-api
   pm2 save && pm2 startup                # survive reboots
   ```
   Normal operation runs **only `bazaar-sync-api`** — it schedules the 08:45/15:35 IST worker lifecycle itself and reforks the worker on crashes (that keeps the IPC channel feeding the live socket.io cache). The `bazaar-sync-worker` PM2 app exists for standalone/ingestion-only deployments (`pm2 start ecosystem.config.js --only bazaar-sync-worker`); don't run both modes at once.
5. **nginx**: serve `client/dist` as static files on the main site's server block; proxy `/api` and `/socket.io` (with `Upgrade`/`Connection` headers for WebSocket) to `http://127.0.0.1:5001`. **The admin app (`admin/dist`) needs its OWN server block on its own subdomain** (e.g. `admin.bazaarsync.com`) — it's a genuinely separate deployment from `client/`, not a route inside it (see CLAUDE.md Phase 10). That block also proxies `/api` to the same `http://127.0.0.1:5001` backend (both apps share the one Express server) but serves `admin/dist` as its static root instead of `client/dist`; no `/socket.io` proxy is needed there since the admin app doesn't use live sockets.
6. **Logs**: `server/logs/` — `login.log`, `worker.log`, `socket.log`, `database.log`, `error.log` (Winston, secrets redacted), plus PM2's own out/error files.
7. **Daily rhythm** (all automatic, IST): 08:45 worker forks and logs in via TOTP → market hours live feed + tiered MySQL snapshots → 15:35 graceful worker stop with final buffer flush → 23:00 nightly historical pull into `option_chain_history`/`ohlcv_data`.

## Notes

- The frontend must never hold broker credentials — Vite bundles every `VITE_`-prefixed env var into public JS. The only client-side env var is `VITE_API_URL`.
- Two legacy tables (`option_chain_cache`, `option_chain_snapshots`) may exist in older DBs; nothing references them anymore and they can be dropped.
