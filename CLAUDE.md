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
- Auth: JWT + bcrypt built and working (email/password). Google OAuth still planned — needs a Google Cloud project + OAuth client credentials from the user, not started.
- Payments: Razorpay, Free vs Pro ₹499/mo (planned)
- Market data: ICICI Direct Breeze Connect API, via the `breezeconnect` npm package (see Gotchas below — it has real bugs)

## Hard Rules — always follow

- Never change the tech stack without explicit discussion
- Backtesting engine always reads from MySQL — never the live Breeze API
- Breeze API credentials always loaded from `.env` — never hardcoded, never committed (check `.env.example` too — see Gotchas)
- Frontend must NEVER hold Breeze credentials. Vite bundles every `VITE_`-prefixed env var into the public browser JS — a `VITE_BREEZE_API_KEY` briefly existed in `client/.env` and was removed. The frontend only ever talks to our own backend (`VITE_API_URL`).
- Historical data ingestion is a background cron job — never blocking
- All Indian number formatting (₹, lakh/crore) in the UI (see `client/src/utils/format.js`)
- Mobile responsive is mandatory — native app is out of scope
- Free tier users cannot access Strategy Builder save, Backtesting, or full history

## Phases

1. **Weeks 1-2 (done):** repo/infra setup, Breeze API integration, MySQL schema, nightly cron for historical pull
2. **Weeks 3-4 (done):** Live Options Dashboard — option chain, OI heatmap, PCR, Max Pain, IV chart, straddle chart all built and verified against real Breeze data (2026-07-06)
3. **Week 5 (done):** Strategy Builder — multi-leg builder, payoff diagram, net Greeks, 7 preset strategies, all verified against real Breeze data (2026-07-06)
4. **Weeks 6-7 (done):** Backtesting Engine — simulation engine + API + frontend done, fully verified end-to-end against real multi-day Breeze data (2026-07-07)
5. **Week 8 (in progress):** JWT auth + Free/Pro tier gating done (2026-07-07). Still needed: Google OAuth, Razorpay, QA, deploy to Hostinger VPS, handover.

## What's Already Done

**Phase 1 (2026-07-02):**
- `server/config/schema.sql` — full MySQL schema: `option_chain_history`, `ohlcv_data`, `users`, `strategies`, `backtest_results`, `backtest_trades` (the last three replace what was originally planned as MongoDB collections)
- `server/config/db.js` — pooled MySQL connection (`mysql2`)
- `server/services/breeze.js` — Breeze Connect wrapper: session auth, live option chain (merged CE/PE), per-contract historical data, live WebSocket feed stub
- `server/services/cron.js` — nightly 23:00 IST (Mon-Fri) job that pulls OHLCV + loops per-contract historical option data into MySQL with upserts
- `/health` endpoint confirms DB connectivity
- Server runs on **port 5001** (not 5000 — macOS AirPlay Receiver squats on 5000)

**Phase 2, Live Options Dashboard (2026-07-06) — all 6 Module 1 tools done:**
- `server/utils/blackScholes.js` — IV solver (bisection) + delta/gamma/theta/vega, since Breeze provides neither
- `server/controllers/optionChainController.js` + `server/routes/optionChain.js` — the one backend endpoint powering every page below: `GET /api/option-chain/:symbol` (nifty/banknifty/finnifty), `?expiry=` optional. Discovers live expiries, computes ATM strike/max pain/PCR/IV/delta/buildup classification server-side. Has request coalescing + short TTL cache (Gotcha #9) and retry/backoff (Gotcha #8).
- `client/src/hooks/useOptionChain.js` — shared fetch hook (request-id race guard) used by every dashboard page.
- `client/src/pages/OptionChain.jsx` — full option chain table (buildup badges, OI bars, ITM/ATM highlighting, Max Pain tag), styled after stockmojo.in.
- `client/src/pages/MaxPain.jsx` — per-strike option-writer payout curve (recharts bar chart), max pain strike highlighted. Computed entirely client-side from data already in the option-chain response.
- `client/src/pages/PutCallRatio.jsx` — dual-axis PCR-vs-spot + Call/Put OI trend charts. Polls every 15s and accumulates a **session-length** trend (we don't store intraday snapshots yet, so this isn't full trading-day history — stated honestly in the UI).
- `client/src/pages/IvChart.jsx` — IV smile (IV vs strike, real snapshot) + ATM IV trend (session-polled like PCR). **IV Percentile Rank is intentionally not shown** — needs a historical IV time series we don't persist (cron.js stores OHLC/OI, not computed Greeks).
- `client/src/pages/StraddleChart.jsx` — ATM straddle cost (CE LTP + PE LTP) vs spot, session-polled.
- `client/src/pages/OiHeatmap.jsx` — Call vs Put OI bar chart by strike.
- `client/src/components/{TopNav,BuildupBadge,OiBar,SettingsSidebar}.jsx` + `utils/format.js` (Cr/L/K Indian formatting) + `services/optionChainApi.js` + `utils/maxPain.js` — shared building blocks across all pages.
- All pages verified visually via Chrome screenshots against real Breeze data, and cross-checked against the stockmojo.in reference (see design reference in memory).
- End-to-end verified against a real Breeze account for **all three symbols** (NIFTY, BANKNIFTY, FINNIFTY) — see Gotcha #10, this wasn't true before today.
- `client/.claude/launch.json` configured for `preview_start`/`preview_screenshot` tools (client dev server, port 5173).

**Phase 3, Strategy Builder (2026-07-06):**
- `client/src/utils/payoff.js` — pure P&L/Greeks math: per-leg payoff at expiry, payoff curve across a price range, breakevens (linear-interpolated zero crossings), max profit/loss with "Unlimited" detection (checks whether the curve is still trending away from zero at the sampled range's edges), net Greeks (signed sum across legs). No backend needed — legs carry their own entry LTP + Greeks snapshot from the option-chain response.
- `client/src/components/PayoffChart.jsx` — recharts Area chart with a gradient split exactly at pnl=0 (green above/red below), spot + breakeven reference lines.
- `client/src/components/PresetStrategies.jsx` — 7 templates (Long/Short Straddle, Long Strangle, Short Iron Condor, Bull Call Spread, Bear Put Spread, Long Call Butterfly), built from live strikes/premiums offset from ATM by the visible strike gap.
- `client/src/pages/StrategyBuilder.jsx` — compact option chain (left, inline hover Buy/Sell buttons, up to 6 legs) + payoff chart/stats/Positions+Greeks tabs (right).
- Verified against real data: Short Iron Condor produced the correct plateau payoff shape with bounded profit/loss and near-zero net delta / positive theta / negative vega (all directionally correct for a premium-selling neutral strategy); a naked long call produced the correct hockey-stick shape with "Unlimited" max profit.
- **"Save strategy" is now implemented** (2026-07-07, see Phase 5 below) — was blocked on auth at the time this was written, since resolved.
- Optional per-controller change: `optionChainController.js` now also returns `ce.iv`/`pe.iv` (previously only `delta` was returned per side; `gamma`/`theta`/`vega` are new fields too) — needed for the Greeks table.

**Phase 3 fidelity pass vs. stockmojo.in reference (2026-07-07):** the user compared our Strategy Builder directly against `stockmojo.in/strategy-builder` and it fell short structurally, not just cosmetically. Fixed:
- Stats panel restructured from horizontal cards into a vertical sidebar (P&L, Est. Margin, POP, Max Profit, Max Loss, Breakevens, Legs) to the left of the chart, matching the reference. `Est. Margin` is intentionally shown as "—" with a tooltip explaining it's not computed (needs broker SPAN margin data) rather than fabricated.
- Added a real **POP (Probability of Profit)** calculation — `computePOP` in `payoff.js`, using a normal-distribution approximation around spot (sigma = spot × ATM IV × √t), explicitly commented as an approximation, not precise pricing.
- Added a **"Today P&L" curve** alongside the existing "Expiry P&L" curve — `client/src/utils/blackScholes.js` (client-side port of the pricing formula, not the IV solver) + `addMarkToMarketCurve` in `payoff.js`, reprices each leg via Black-Scholes at today's time-to-expiry using its entry IV as a stand-in for current IV.
- Added **±1SD/±2SD expected-move reference lines** (`computeExpectedMove` — the standard options-desk approximation, spot × IV × √t).
- Added **live LTP + live P&L per leg** in the Positions table (previously only showed static entry price) — looked up from the currently-loaded chain by strike.
- Expiry dropdown now shows day count, e.g. "21-Jul-2026 (14d)" (`daysUntilExpiry` in `blackScholes.js`).
- **Found and fixed a real recharts bug while verifying this**: `PayoffChart`'s `XAxis` didn't declare `type="number"`, so recharts defaulted to a **category axis** — `ReferenceLine`'s `x` prop then only works if it exactly matches one of the chart's sampled data points. Breakeven and SD reference lines (computed values, never landing exactly on a sampled point) silently failed to render with no error; the Spot line happened to work only because it coincidentally matched a sampled point once. Fixed by adding `type="number" domain={["dataMin","dataMax"]}` to the XAxis. **Any future chart using `ReferenceLine` with a computed (not-necessarily-sampled) x-value needs this too.**
- Two client/server timezone-parsing near-misses were caught and avoided while building this: `blackScholes.js`'s `yearsToExpiry`/`daysUntilExpiry` both manually parse the `"07-Jul-2026"` display format (never `new Date(nonISOString)`) per Gotcha #12.

**Phase 4, Backtesting Engine (2026-07-07) — built and fully verified:**
- `server/services/backtestEngine.js` — reads only `option_chain_history` + `ohlcv_data` from MySQL, never Breeze. Legs are defined relative to that day's ATM strike (offset in strike-gap multiples) since the actual ATM moves across a date range. Simulates minute-by-minute from `entryTime`, exits on stop-loss%/target%/EOD/expiry, whichever first. Computes equity curve, win rate, max drawdown, and a **Sharpe ratio that's explicitly labelled as an approximation** (mean/stdev of per-trade P&L — not a proper annualized Sharpe on capital, which would need a margin/capital-base assumption we don't have).
- Weekly vs monthly expiry classification is inferred from the data itself (last expiry in a calendar month = monthly, others = weekly) — with only one expiry currently stored, it gets classified as "monthly" by definition; will resolve correctly once more expiries are backfilled.
- `server/controllers/backtestController.js` + `server/routes/backtest.js` — `POST /api/backtest`.
- `client/src/pages/Backtest.jsx` + `utils/csv.js` — parameter form (symbol/expiry-type/date range/entry time/DTE/SL%/target%), relative-strike leg builder, equity curve chart, summary stats, trade log table, CSV export.
- `server/scripts/backfillHistory.js` — resumable backfill (reuses cron.js's per-day pull functions), `node scripts/backfillHistory.js SYMBOL DAYS`. **Real limitation:** can only backfill expiries still live-listed right now (strike discovery needs the live snapshot endpoint — Breeze has no historical option-chain-listing API), so this is scoped to days/weeks of real history, not years. A true multi-year backfill needs the NSE securities master file for historical strike discovery — separate, heavier work, not started.
- **Fully verified against real multi-day data (2026-07-07):** ran `backfillHistory.js NIFTY 10`, which pulled 7 real trading days (2026-06-29 through 2026-07-07, ~22k option-chain rows/day) into MySQL. A 7-day backtest then correctly found all 7 trades, and every stat was manually cross-checked against the trade log by hand: Net P&L (-51.50) = exact sum of the 7 trade P&Ls; Win Rate (57.14%) = exactly 4/7; Max Drawdown (-90.00) = the exact lowest point of cumulative P&L. The expiry-day trade (2026-07-07) correctly showed exit reason "expiry" while all others showed "eod". Re-ran with a 10% stop-loss: 5 of 7 trades correctly exited early at realistic threshold-crossing prices (small overshoot expected from per-minute, not continuous, checking), while the 2 already-profitable trades were untouched and matched their no-SL P&L exactly.
- **"Save backtest" is now implemented** (2026-07-07, see Phase 5 below) — was blocked on auth at the time this was written, since resolved. **At the time of writing this, backtesting itself was NOT gated to Pro users** (only saving was) — this under-gated the feature relative to the hard rule "Free tier is live dashboard only (no backtest...)"; fixed in Phase 5, see below.
- Found and fixed a second instance of the timezone-parsing bug class (see Gotcha #12): `backtestEngine.js` and `backfillHistory.js` both originally used local-`Date`-object arithmetic; rewritten to do all date math on plain `'YYYY-MM-DD'` strings instead (see Gotcha #12). Caught before ever running, by checking that `config/db.js` uses `dateStrings: true`.
- `breeze.js`'s `connect()` memoizes the session promise but never retries after a failure — if the very first call fails (e.g. stale session), every subsequent call in that same process reuses the same rejected promise forever, even after `.env` is updated. The server process must be restarted after refreshing `BREEZE_API_SESSION`, not just re-triggered. Minor hardening opportunity, not fixed yet.

**Phase 5, Auth + tier gating (2026-07-07) — email/password done, Google OAuth/Razorpay not started:**
- `server/middleware/auth.js` (`requireAuth`, JWT verify) + `server/middleware/requirePro.js` (`requirePro`, **re-checks the live DB tier on every call rather than trusting the JWT payload** — a Pro subscription lapsing via `pro_expires_at` shouldn't have to wait up to 7 days for the token itself to expire).
- `server/controllers/authController.js` + `server/routes/auth.js` — `POST /api/auth/register`, `POST /api/auth/login` (bcrypt, 12 salt rounds, generic "invalid email or password" error either way — doesn't leak which field was wrong), `GET /api/auth/me`.
- `server/controllers/strategiesController.js` + `server/routes/strategies.js` — `POST /` (create, requires Pro) / `GET /` (list) / `DELETE /:id` (list and delete only require login, not Pro, so a lapsed Pro subscriber can still see/remove what they already saved — they just can't create new ones).
- `server/controllers/backtestController.js` gained `saveBacktest` + `listBacktests` — `POST /api/backtest/save` and `GET /api/backtest/saved`, both `requireAuth + requirePro`. Saves the report the client already fetched from `POST /api/backtest` rather than re-running the simulation. Note: `backtest_trades.leg_index` was designed for a per-leg trade log, but the engine tracks combined multi-leg P&L per day, not a separable per-leg exit price — reused as a trade sequence number instead (`exit_price` left null); revisit if a real per-leg breakdown is needed.
- **`POST /api/backtest` (running a backtest, not just saving) is now gated `requireAuth + requirePro` too** — this was a real gap caught mid-build: the hard rules say Free tier is "live dashboard only (no backtest...)", but the initial save-gating pass only protected the save endpoint, leaving the run endpoint open to anyone including logged-out users. Fixed and reverified (anonymous → 401, free tier → 403, Pro → 200) before moving on.
- `client/src/context/AuthContext.jsx` — token in `localStorage`, fetches `/me` on load, exposes `user`/`isPro`/`login`/`register`/`logout`.
- `client/src/pages/Auth.jsx` (combined login/register toggle) + `client/src/components/SaveButton.jsx` (shared 3-state Save button: logged-out → "Log in to save", free → disabled "Save (Pro only)", Pro → name prompt then save) — used in both Strategy Builder and Backtest.
- `client/src/pages/Backtest.jsx`'s Run button mirrors the same 3-state pattern (logged-out → "Log in to run a backtest", free → disabled "Run Backtest (Pro only)", Pro → normal).
- **Fully verified end-to-end**, both via curl (register/login/me, free-tier 403 on save and on run, Pro 201/200, wrong-password 401) and via the actual UI (screenshots): a Pro user's saved strategy and saved backtest result both landed correctly in MySQL (`strategies`, `backtest_results`, `backtest_trades` tables all checked directly), and a free-tier user correctly sees disabled "Pro only" buttons for both Save and Run rather than a failed API call.
- **Not started:** Google OAuth (needs the user to create a Google Cloud project and provide OAuth client ID/secret — same kind of external-credential dependency as Breeze, ask when picking this up), Razorpay integration, tier upgrade flow (currently only testable by manually setting `tier='pro'` in MySQL).

## Gotchas — read before touching Breeze integration

1. **`breezeconnect` v1.0.31's `getOptionChainQuotes()` is broken** — its exchange-code validation (`x!=="nfo" || x!=="bfo"`) is always true, rejecting every call. Don't call it directly. Use `breeze.getOptionChainSide()` / `breeze.getFullOptionChain()` in `services/breeze.js`, which bypass it via the package's own `generateHeaders`/`makeRequest` internals.
2. **`breezeconnect` disables TLS certificate verification globally on import** (`NODE_TLS_REJECT_UNAUTHORIZED='0'`). `services/breeze.js` resets it to `'1'` immediately after requiring the package — do not remove that line.
3. **`breezeconnect` is missing `adm-zip` as a declared dependency** — it's installed explicitly in `server/package.json`. Also pinned `axios` to a patched version via `overrides` (the declared `^0.27.2` has known SSRF/auth-bypass CVEs).
4. **Breeze provides no IV or Greeks anywhere** (live or historical) — computed ourselves via `server/utils/blackScholes.js`.
5. **The live `optionchain` endpoint is a snapshot only** — no historical params. Historical option data (including open interest) comes from `getHistoricalDatav2`, called per contract (stockCode+expiryDate+right+strikePrice). Building a full multi-year backfill means looping every strike/expiry/day — that's separate, heavier work from the nightly incremental cron.
6. **`BREEZE_API_SESSION`** expires daily and must be regenerated by hand (2FA blocks pure API login): visit `https://api.icicidirect.com/apiuser/login?api_key=<url-encoded key>`, log in, copy the `API_Session` value from the redirect URL — just the raw value, not `apisession=...`.
7. **Check both `.env` and `.env.example` after any credential update** — real secrets have landed in `.env.example` (not gitignored!) more than once by accident.
8. **`makeRequest()`'s own error handler is buggy** — it references a `let url` from the `try` block inside the `catch` block, where it's out of scope, throwing `ReferenceError: url is not defined` that masks whatever the real error was. If you see that exact message from a breeze.* call, the real cause is something else (rate-limiting, or a bad stock code — see #9). Mitigated with retry/backoff in `breeze.js`.
9. **BankNifty and FinNifty use different internal Breeze stock codes than their common names** — totally undocumented. `NIFTY` works as-is, but literal `"BANKNIFTY"`/`"FINNIFTY"` fail on every endpoint with the generic "Error while calling service, Please contact admin". Real codes (found by brute-force probing): **BankNifty = `CNXBAN`**, **FinNifty = `NIFFIN`**. Centralized in `breeze.SYMBOL_CODES` — any code working with display symbols (cron.js, optionChainController.js) must resolve through this map before calling breeze.*, then map back to the display name for storage/responses.
10. **cron.js had been silently only ingesting NIFTY data** because of Gotcha #9 (its per-symbol try/catch just logged BankNifty/FinNifty failures and moved on) — fixed 2026-07-06, not verified again yet against a real nightly run (only via direct function calls).
11. **Concurrent/rapid identical requests get rate-limited** — retry/backoff alone wasn't sufficient (verified: 6 concurrent requests still produced failures with retry-only). `optionChainController.js` adds request coalescing + a 3s TTL cache on top, which fixed it. Apply the same pattern to any other endpoint that fans out into multiple breeze.* calls.
12. **Don't do date arithmetic with `new Date(nonISOString)` or local-timezone `Date` methods (`.getDate()`, `.setDate()`, `.toISOString().slice(0,10)`) anywhere in this codebase** — this has caused a real, silent off-by-one-day bug twice now (once in `expiryDisplayToApi`, once in the first draft of `backtestEngine.js`/`backfillHistory.js`). The pool is also configured with `dateStrings: true` (`config/db.js`), so MySQL DATE columns come back as plain `'YYYY-MM-DD'` strings, not `Date` objects — code that assumes otherwise (e.g. calling `.getFullYear()` on a query result) will throw. Always do date math on plain date strings using explicit `Date.UTC(...)` (see `backtestEngine.js`'s `addDays`/`daysBetween` helpers), never ambient local-timezone `Date` parsing.

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

- All of Phases 1-4 plus JWT auth/tier-gating (Phase 5) are built and verified against real Breeze/MySQL data as of 2026-07-07. **Remaining for Phase 5: Google OAuth, Razorpay integration, QA, deploy to Hostinger VPS, handover.**
- Google OAuth needs the user to create a Google Cloud project and provide OAuth client ID/secret before it can be wired up — ask for these when picking this phase up, same as Breeze credentials were needed upfront.
- Razorpay integration needs the user's Razorpay account/API keys similarly, plus a decision on the actual upgrade flow (currently `tier='pro'` can only be set by hand in MySQL for testing).
- `BREEZE_API_SESSION` needs a fresh daily refresh (Gotcha #6) each time work resumes — and remember to restart the server process after updating it, not just re-trigger a request (see the `connect()` memoization note above).
- When adding new Pro-gated features, check both the write path AND the "use" path need gating (see the backtest-run gap above) — don't assume gating the save/write endpoint alone satisfies a rule like "Free tier cannot access X" when X itself (not just saving X) is meant to be restricted.
- Consider persisting IV/Greeks in the nightly cron so IV Percentile Rank becomes buildable later (currently skipped — no historical IV stored).
- Socket.io wiring for real live push — the dashboard pages currently client-side poll every 15s (PCR/IV/Straddle) or fetch-once (Option Chain/Max Pain/OI Heatmap), not true push.
- True multi-year historical backfill needs the NSE securities master file for historical strike discovery (see Phase 4 notes above) — `backfillHistory.js` as written only reaches back as far as the current nearest expiry's lifetime allows (days/weeks). This is separate, heavier work, not started.
- Re-verify a real nightly cron run end-to-end now that the BankNifty/FinNifty stock-code bug (Gotcha #9) is fixed
- Symbol selector currently skips the lot-size badge stockmojo shows (e.g. "50 NIFTY") since Breeze doesn't return lot size in our current calls — revisit if that's needed
- Local dev note: the backend node process (and separately, the Vite preview dev server) has died silently more than once during a session (no crash logged) — fine for local dev, but Phase 5 deployment needs a process manager (PM2 or similar) to auto-restart it in production.
