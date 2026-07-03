# Bazaar Sync — Project Context

This file is read automatically by Claude Code whenever it opens this repo, on any machine. It exists so a fresh session — on a different computer — has full context without needing this conversation's history.

## Goal

Building "Bazaar Sync" — a StockMojo-style NSE Options Analytics & Backtesting Platform for a confidential client. Traders view live options data, build multi-leg strategies, and backtest them on years of historical NSE data (Nifty/BankNifty/FinNifty/F&O). Market data comes from the client's own ICICI Direct Breeze Connect API.

## Business Terms

- Developer: Nikhil Gupta — NikhilWorks (nikhilworks.com)
- Deal value: ₹1,15,000 total. Advance ₹15,000 received. Remaining ₹1,00,000 (₹50k on Phase 1+2 done, ₹50k on final delivery)
- Timeline: 8 weeks
- Repo: https://github.com/nikhilgupta-9/bazaar-sync (private)

## Tech Stack (current — updated 2026-07-02)

- Frontend: React (Vite) + Tailwind CSS — `client/`
- Backend: Express.js (Express 5, Node) — `server/`
- Database: **MySQL/MariaDB only.** MongoDB and Redis were both dropped from the original plan — everything (option_chain_history, ohlcv_data, users, strategies, backtest_results, backtest_trades) lives in MySQL. No live-data cache layer decided yet — revisit when building the live dashboard.
- Real-time: Socket.io (planned, not yet built)
- Auth: JWT + bcrypt + Google OAuth (planned)
- Payments: Razorpay, Free vs Pro ₹499/mo (planned)
- Market data: ICICI Direct Breeze Connect API, via the `breezeconnect` npm package (see Gotchas below — it has real bugs)

## Hard Rules — always follow

- Never change the tech stack without explicit discussion
- Backtesting engine always reads from MySQL — never the live Breeze API
- Breeze API credentials always loaded from `.env` — never hardcoded, never committed (check `.env.example` too — see Gotchas)
- Historical data ingestion is a background cron job — never blocking
- All Indian number formatting (₹, lakh/crore) in the UI
- Mobile responsive is mandatory — native app is out of scope
- Free tier users cannot access Strategy Builder save, Backtesting, or full history

## Phases

1. **Weeks 1-2 (current):** repo/infra setup, Breeze API integration, MySQL schema, nightly cron for historical pull
2. **Weeks 3-4:** Live Options Dashboard (option chain, OI heatmap, PCR, Max Pain, IV/IVP, straddle chart)
3. **Week 5:** Strategy Builder (multi-leg, payoff diagram, Greeks, presets)
4. **Weeks 6-7:** Backtesting Engine (core/most complex feature) + report UI + CSV export
5. **Week 8:** Auth, Razorpay, QA, deploy to Hostinger VPS, handover

## What's Already Done (Phase 1, as of 2026-07-02)

- `server/config/schema.sql` — full MySQL schema: `option_chain_history`, `ohlcv_data`, `users`, `strategies`, `backtest_results`, `backtest_trades` (the last three replace what was originally planned as MongoDB collections)
- `server/config/db.js` — pooled MySQL connection (`mysql2`)
- `server/services/breeze.js` — Breeze Connect wrapper: session auth, live option chain (merged CE/PE), per-contract historical data, live WebSocket feed stub
- `server/services/cron.js` — nightly 23:00 IST (Mon-Fri) job that pulls OHLCV + loops per-contract historical option data into MySQL with upserts
- `/health` endpoint confirms DB connectivity
- Server runs on **port 5001** (not 5000 — macOS AirPlay Receiver squats on 5000)
- End-to-end verified against a real Breeze account: 12,956 option chain rows + 222 OHLCV rows successfully ingested for NIFTY

## Gotchas — read before touching Breeze integration

Full details in commit history / prior session, summarized here:

1. **`breezeconnect` v1.0.31's `getOptionChainQuotes()` is broken** — its exchange-code validation (`x!=="nfo" || x!=="bfo"`) is always true, rejecting every call. Don't call it directly. Use `breeze.getOptionChainSide()` / `breeze.getFullOptionChain()` in `services/breeze.js`, which bypass it via the package's own `generateHeaders`/`makeRequest` internals.
2. **`breezeconnect` disables TLS certificate verification globally on import** (`NODE_TLS_REJECT_UNAUTHORIZED='0'`). `services/breeze.js` resets it to `'1'` immediately after requiring the package — do not remove that line.
3. **`breezeconnect` is missing `adm-zip` as a declared dependency** — it's installed explicitly in `server/package.json`. Also pinned `axios` to a patched version via `overrides` (the declared `^0.27.2` has known SSRF/auth-bypass CVEs).
4. **Breeze provides no IV or Greeks anywhere** (live or historical) — must be computed ourselves later (Black-Scholes), not fetched from the API.
5. **The live `optionchain` endpoint is a snapshot only** — no historical params. Historical option data (including open interest) comes from `getHistoricalDatav2`, called per contract (stockCode+expiryDate+right+strikePrice). Building a full multi-year backfill means looping every strike/expiry/day — that's separate, heavier work from the nightly incremental cron.
6. **`BREEZE_API_SESSION`** expires daily and must be regenerated by hand (2FA blocks pure API login): visit `https://api.icicidirect.com/apiuser/login?api_key=<url-encoded key>`, log in, copy the `API_Session` value from the redirect URL — just the raw value, not `apisession=...`.
7. **Check both `.env` and `.env.example` after any credential update** — real secrets have landed in `.env.example` (not gitignored!) more than once by accident.

## Local Dev Setup (any machine)

```bash
git clone https://github.com/nikhilgupta-9/bazaar-sync.git
cd bazaar-sync/server && npm install
cd ../client && npm install

# DB — needs MySQL/MariaDB running locally (XAMPP or standalone, doesn't matter which)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS bazaar_sync CHARACTER SET utf8mb4;"
mysql -u root bazaar_sync < server/config/schema.sql

# server/.env — copy from .env.example, fill in real values by hand (never via git)
cd server && cp .env.example .env
# then set BREEZE_API_KEY, BREEZE_API_SECRET, DB_USER/PASSWORD, and generate
# BREEZE_API_SESSION for today (see Gotcha #6 above)

npm run dev        # server, port 5001
cd ../client && npm run dev   # separate terminal, Vite dev server
```

Verify: `curl http://localhost:5001/health` should return `{"status":"ok","database":"connected"}`.

## Next Steps (pick up here)

- Black-Scholes Greeks/IV calculator (`server/utils/`) — needed before the live dashboard or strategy builder can show Delta/Gamma/Theta/Vega/IV
- Full multi-year historical backfill script (distinct from the nightly incremental cron) — rate-limited, resumable, loops every strike/expiry/day
- Live Options Dashboard (Phase 2): option chain UI, OI heatmap, PCR, Max Pain, IV chart, straddle chart, Socket.io wiring
