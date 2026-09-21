# Bazaar Sync — Project Status & Audit

_Audit date: 2026-09-04 • Scope: full `client/` + `server/` + `admin/` + `.claude/` scan • No code was modified._

---

## 0. TL;DR (Hinglish)

- **Backend kaafi mature hai.** 11 route groups, ~15 services, ek alag `marketWorker` process, tiered MySQL schema (21 tables), JWT auth + Pro/institute gating, Razorpay integration, paper-trading engine (long + short), admin API — sab bana hua hai aur mostly consistent pattern follow karta hai.
- **Live market data ka poora architecture ready hai** (Angel One SmartAPI WS → worker → in-memory cache → socket.io → React). Lekin **real broker feed ke against kabhi verify nahi hua** — binary tick decode aur index/VIX tokens abhi "likha hai, test nahi hua" state me hain.
- **Backtesting engine complete + pehle verify ho chuka hai** (CLAUDE.md ke mutabik real multi-day data pe). Sirf MySQL padhta hai, kabhi broker nahi.
- **Frontend me 2 clearly-incomplete area hain:** (1) Equity Data ke 6 me se 5 tools sirf "Coming soon" placeholder hain, (2) Sector Rotation page demo/fake data pe chalta hai.
- **Sabse urgent security issue:** `server/.env` me **LIVE Razorpay key** (`rzp_live_…`) hai aur wahi key git history me `.env.example` (commit `3e11bae`) me commit ho chuki thi. **Rotate karo.**
- **Rate limiting / helmet kahin nahi hai.** Auth brute-force aur Simulator ke heavy endpoints (jo millions of rows scan karte hain, bina auth ke) exposed hain.
- **`server/` folder ke andar ek alag nested `.git` repo hai** (branch `backend`) — parent monorepo bhi `server/` ko track karta hai. Confusing, galat repo me commit hone ka risk.
- **CLAUDE.md ~1–2 phases peeche hai**; `README.md` usse bhi zyada stale (nav se hataye gaye pages abhi bhi describe karta hai).
- **`.claude/` me koi subagent ya skill defined nahi hai** — sirf ek macOS-era `settings.local.json` (stale) aur `launch.json`.

---

## 1. Structure Overview

### 1.1 Top level

```
bazaar-sync/
├── CLAUDE.md            # 108 KB project history/context (see §6)
├── README.md            # deployment guide — partly stale
├── .gitignore           # NOTE: ignores package-lock.json (see §5)
├── .claude/             # launch.json + settings.local.json only — NO agents/skills
├── client/              # React 19 + Vite + Tailwind v4 — main user app (port 5173)
├── admin/               # SEPARATE React 19 + Vite app — admin panel (port 5174)
└── server/              # Express 5 + Socket.io + MySQL (port 5001)
    └── .git/            # ⚠️ nested standalone repo, branch "backend" (see §5)
```

### 1.2 `client/src/` (React user app)

```
client/src/
├── main.jsx                 # BrowserRouter > ThemeProvider > AuthProvider > App
├── App.jsx                  # 14 routes, TopNav + Footer shell, usePageSeo()
├── context/
│   ├── AuthContext.jsx      # JWT in localStorage, isPro (tier|institute), refreshUser
│   └── ThemeContext.jsx     # light/dark, localStorage-persisted
├── hooks/
│   ├── useOptionChain.js    # REST fetch + socket.io live-merge + poll fallback (shared)
│   └── usePageSeo.js        # sets <title>/<meta> per route from /api/seo
├── services/                # 12 thin fetch wrappers (authApi, optionChainApi,
│   │                        #   liveSocket, paperTradeApi, subscriptionApi,
│   │                        #   strategiesApi, backtestApi, simulatorApi,
│   │                        #   contentApi, eventsApi, seoApi)
│   └── liveSocket.js        # the ONE live-data path (socket.io-client singleton)
├── pages/ (13)              # Home, OptionChain, StrategyBuilder(1260 LOC),
│   │                        #   Simulator(2461 LOC), PaperTrade(933), Pricing,
│   │                        #   Events, Terms, Auth, HistoricalChart,
│   │                        #   EquityData(stub), SectorRotation(demo data),
│   │                        #   ComingSoon(ORPHAN — not routed)
├── components/ (24 + landing/6)   # heavy on charts: CandlestickChart, StrategyChart,
│   │                        #   IntradayChart, LiveIntradayChart, UnderlyingChart,
│   │                        #   PayoffChart, StrategyValueChart, ContractChartModal
│   └── landing/             # Hero, FeatureCarousel, PinnedWalkthrough, DashboardMockup…
├── data/                    # tools.js (shared tool catalog), homeContentDefaults.js,
│   │                        #   rrgData.js (DEMO sector-rotation dataset)
└── utils/                   # format.js, blackScholes.js (pricing-only port),
                             #   payoff.js (+ payoff.test.js, vitest), maxPain.js, csv.js,
                             #   loadRazorpayCheckout.js
```

### 1.3 `server/` (Express backend)

```
server/
├── server.js               # app wiring, 11 route mounts, socket.io attach,
│                            #   cron start, worker lifecycle on boot
├── config/
│   ├── db.js                # mysql2 pool (dateStrings:true), query/transaction helpers
│   ├── schema.sql           # 21 tables (see §2.2)
│   ├── logger.js            # Winston, per-concern files + secret-redaction formatter
│   └── paperTradeConfig.js  # pricing/trial/margin business constants
├── middleware/              # auth (JWT), requirePro, requireAdmin,
│                            #   requirePaperAccess, upload (multer, local disk)
├── controllers/ (13)        # auth, optionChain, backtest, strategies, simulator,
│                            #   subscription, paperWallet, paperPosition, admin,
│                            #   events, content, seo
├── routes/ (11)             # one per controller group + /health
├── services/ (23)
│   ├── optionChainService   # live-vs-historical decision, MySQL fallback
│   ├── backtestEngine       # simulation — MySQL only, never broker
│   ├── marketCache          # in-memory live tick Map (Express process)
│   ├── workerManager        # forks/supervises marketWorker, receives IPC ticks
│   ├── socketBroadcast      # socket.io push from marketCache (~1s)
│   ├── instrumentMaster     # Angel One scrip master download/parse/token lookup
│   ├── cron                 # nightly 23:00 IST historical pull (Angel One)
│   ├── angelOneHistorical   # paced historical candle/OI REST client
│   ├── paperWalletService / paperPositionService / subscriptionService
│   ├── razorpayService      # plain REST (no SDK), HMAC signature verify
│   ├── couponService / instituteAccessService / lotSizeHistoryService
│   └── nseBhavcopy / bseBhavcopy / upstoxHistorical / upstoxInstrumentMaster
├── workers/                 # marketWorker(481 LOC), login (TOTP), websocket
│                            #   (binary tick decode), buffer, databaseWriter
│                            #   — HARD RULE: no express/req/res here
├── cron/                    # marketStart (08:45 IST fork), marketStop (15:35 IST)
├── breeze-historical/       # ISOLATED ICICI Breeze backfill tools (own README,
│                            #   auth, rateLimiter, historicalService, scripts)
│                            #   — not required by server.js / any request path
├── scripts/ (19)            # backfill* + test* one-off CLI tools
├── data/                    # scrip-master disk cache (gitignored)
├── uploads/                 # admin-uploaded content images (gitignored)
└── logs/                    # Winston output (gitignored)
```

### 1.4 `admin/src/` (separate admin app)

```
admin/src/
├── App.jsx                  # /login + AdminLayout-wrapped routes (13)
├── context/AdminAuthContext.jsx   # own token key "bazaar_sync_admin_token",
│                                  #   client-side role==='admin' check
├── services/
│   ├── authApi.js           # reuses /api/auth/login + /me
│   └── adminApi.js          # 27 fetch wrappers → /api/admin, /api/events/admin,
│                            #   /api/content, /api/seo/admin
├── components/              # AdminLayout, Sidebar (Menu + Management sections),
│                            #   AppHeader, TopBar, Card, StatCard, ImageUploadField
├── pages/ (13)              # Overview, Users(208), Payments, Positions, Strategies,
│                            #   HomePage(196, content editor), InstituteAccess,
│                            #   Plans(177, coupons), Events(144), Terms(83),
│                            #   Seo(121), LotSizeHistory(143)
└── utils/format.js          # DUPLICATE of client's format.js, drifted (see §5)
```

### 1.5 `.claude/`

| File | Contents | Status |
|---|---|---|
| `launch.json` | one `client` dev-server config (port 5173) for preview tools | OK |
| `settings.local.json` | Bash/MCP permission allowlist | **Stale** — full of macOS paths (`/Applications/XAMPP/...`, `/Users/nishantdua/...`), a rule for the deleted `services/breeze.js`, `curl localhost:5000` (wrong port). Written on a Mac; repo is now on Windows. |
| `agents/` | — | **Does not exist.** No subagents defined. |
| `skills/` | — | **Does not exist.** No project skills. |

---

## 2. Server (Backend) Audit

### 2.1 API route inventory

| Group | Endpoint | Auth | Status |
|---|---|---|---|
| **Auth** | `POST /api/auth/register` | public | ✅ bcrypt(12), generic errors. ⚠️ no email-format check, min password 8 |
| | `POST /api/auth/login` | public | ✅ |
| | `GET /api/auth/me` | JWT | ✅ returns `instituteAccess` too |
| **Option chain** | `GET /api/option-chain/:symbol` | public | ✅ live-cache-or-MySQL, computes ATM/maxpain/PCR/IV/greeks server-side |
| | `GET /api/option-chain/?symbol=` | public | ✅ legacy query-param alias |
| | `POST /api/option-chain/refresh` | public | ✅ no-op-ish (returns freshest cache) |
| | `GET /api/option-chain/symbols/list` | public | ✅ DB-driven, 5-min cache |
| | `GET /:symbol/contract-history` | public | ✅ reads `option_chain_history` |
| | `GET /:symbol/underlying-history` | public | ✅ reads `ohlcv_data` |
| | `GET /:symbol/intraday` | public | ✅ `live_index_ticks` → `ohlcv_data` fallback |
| **Backtest** | `POST /api/backtest` | JWT + **Pro** | ✅ engine complete, previously verified |
| | `POST /api/backtest/save` | JWT + **Pro** | ✅ |
| | `GET /api/backtest/saved` | JWT | ✅ |
| **Strategies** | `POST /` | JWT + **Pro** | ✅ |
| | `GET /` , `DELETE /:id` | JWT | ✅ (lapsed-Pro can still view/delete) |
| **Simulator** | `GET /dates/:symbol` | **none** | ✅ works; 10-min TTL cache over a multi-M-row scan |
| | `GET /chain/:symbol` | **none** | ✅ |
| | `GET /candles/:symbol` | **none** | ✅ |
| | `POST /replay/:symbol` | **none** | ✅ server looks up real entry prices; **⚠️ unauthenticated + heavy** |
| **Subscription** | `GET /api/subscription/plans` | public | ✅ |
| | `POST /order` | JWT | ✅ coupon validated here |
| | `POST /verify` | JWT | ✅ HMAC verify → re-fetch order from Razorpay → grant Pro + paper capital + redeem coupon |
| **Paper trade** | `GET /wallet` | JWT | ✅ lazily creates wallet + grants trial |
| | `POST /refill/order`, `/refill/verify` | JWT + **Pro** | ✅ idempotent via unique `razorpay_payment_id` |
| | `GET /positions` | JWT | ✅ best-effort mark-to-market |
| | `POST /positions`, `POST /positions/:id/close` | JWT + **paperAccess** | ✅ long + short, flat-15%-notional margin approximation |
| **Admin** | `GET /overview` `/users` `/users/:id` `/payments` `/positions` `/strategies` | JWT + **admin** | ✅ read-only. "revenue" is an **estimate** (count × current price), no pagination (hard `LIMIT`) |
| | `institute-ips` GET/POST/DELETE | JWT + **admin** | ✅ |
| | `coupons` GET/POST/PATCH/DELETE | JWT + **admin** | ✅ |
| | `lot-size-history` GET/POST/DELETE | JWT + **admin** | ✅ |
| **Events** | `GET /api/events` | public | ✅ |
| | `/admin/all`, `POST/PUT/DELETE /admin[/:id]` | JWT + **admin** | ✅ |
| **Content** | `GET /api/content/:slug` | public | ✅ (`terms`, `home`) |
| | `POST /uploads`, `PUT /:slug` | JWT + **admin** | ✅ multer local disk |
| **SEO** | `GET /api/seo?path=` | public | ✅ |
| | `/admin/all`, `POST /admin`, `DELETE /admin/:id` | JWT + **admin** | ✅ |
| **Health** | `GET /health` | public | ✅ reports DB + worker + live-cache state |

**Incomplete / not built on the backend:**

| Feature | State |
|---|---|
| Google OAuth | `users.google_id` column exists; **no routes, no controller, no passport** |
| Equity Data tools (sector performance, market map, 52W H/L, industry momentum, most active) | **No endpoints** — frontend placeholders only |
| Sector Rotation real data | No sector-index history source; frontend uses `rrgData.js` demo dataset |
| IV Percentile Rank | Data now persisted (`live_greeks_snapshots`) but **no endpoint / no UI** |
| Admin user-management actions (ban, role change, manual tier grant, refund) | **None** — admin API is 100% read-only except institute-ip / coupon / lot-size CRUD |
| Admin list pagination | Not built — every list endpoint hard-`LIMIT`ed 200–500 |
| Live per-contract `buildup` / `changePercent` | `null` in the live path (WS feed carries no previous close) |

### 2.2 Database

- **Engine:** MySQL/MariaDB only (Mongo + Redis dropped). Pool via `mysql2/promise`, `dateStrings: true`, `connectionLimit: 10`. Single `config/db.js`, no ORM — hand-written SQL + a `transaction(cb)` helper.
- **No migration tool.** `schema.sql` is `CREATE TABLE IF NOT EXISTS` only; every additive change ships as a hand-run `ALTER TABLE` documented in a comment above the table. Fragile — see the `users.id` incident below.

**Tables (21):**

| Domain | Tables |
|---|---|
| Historical (backtest source) | `option_chain_history`, `ohlcv_data` |
| Live tiers (worker-written) | `live_index_ticks`, `live_option_ticks`, `live_greeks_snapshots`, `pcr_snapshots`, `oi_summary_snapshots` |
| Users / auth | `users` |
| Strategy Builder / Backtest | `strategies`, `backtest_results`, `backtest_trades` |
| Paper Trade | `paper_wallets`, `paper_wallet_ledger`, `paper_positions` |
| Admin / config | `institute_ip_allowlist`, `coupons`, `coupon_redemptions`, `events`, `site_content`, `seo_meta`, `lot_size_history` |

**Relations:** FKs are *declared* in `schema.sql` (`ON DELETE CASCADE` / `SET NULL` throughout — `strategies.user_id`, `backtest_results.user_id/strategy_id`, `backtest_trades.backtest_result_id`, `paper_*.user_id`, `coupon_redemptions.*`, admin tables' `created_by/updated_by`). Idempotency guards via `UNIQUE` on `paper_wallet_ledger.razorpay_payment_id` and `coupon_redemptions.razorpay_payment_id`. `option_chain_history` has `UNIQUE (symbol, expiry, strike, trade_date, trade_time)` + `ON DUPLICATE KEY UPDATE` so all 4 historical data sources can write it without dup rows.

> ⚠️ **Per CLAUDE.md Phase 11, the declared PK/FK constraints are NOT actually enforced in the real dev DB.** `users.id` was found with no PRIMARY KEY / AUTO_INCREMENT at all (registration was likely broken; fixed by hand for 3 rows). Spot-checks of `strategies` / `paper_wallets` showed the same gap. This is a **systemic DB-state problem, not a schema-file problem** — needs a table-by-table `SHOW CREATE TABLE` audit vs `schema.sql`, and `option_chain_history` (millions of rows) will need a maintenance window for any `ADD PRIMARY KEY`.

### 2.3 Backtesting logic

- **Location:** `server/services/backtestEngine.js` (251 LOC) + `backtestController.js` + `routes/backtest.js`.
- **Completeness:** ✅ Complete and previously verified end-to-end against real multi-day data (per CLAUDE.md 2026-07-07). Reads **only** `option_chain_history` + `ohlcv_data`. Relative-strike legs (offset from that day's ATM), minute-by-minute simulation, SL%/target%/EOD/expiry exits, equity curve, win rate, max drawdown, per-trade Sharpe *proxy* (honestly labelled as an approximation). Historical lot size resolved per trading day via `lotSizeHistoryService`.
- **Known limitation:** assumes minute-resolution rows exist — no daily-granularity mode, so the years of EOD-only NSE/BSE Bhavcopy data can't be backtested meaningfully yet.
- **Related but distinct:** `simulatorController.js` (single-day replay) and paper-trade replay reuse the same query patterns.

### 2.4 Authentication / authorization

- **Implemented:** email/password, JWT (`jsonwebtoken`, 7-day expiry, HS256, `{sub, email, tier}`), bcrypt (12 rounds). `middleware/auth.js` verifies the Bearer token; `requirePro` / `requireAdmin` / `requirePaperAccess` all **re-query the live DB** rather than trusting the token's `tier`/`role` (good — a lapsed subscription / demotion takes effect immediately).
- **Institute access:** `instituteAccessService.isInstituteIp(req.ip)` is OR'd into `requirePro` and `requirePaperAccess`, and surfaced on `/auth/me` + `/paper-trade/wallet`. IPv4 exact + CIDR (hand-rolled bitmask); IPv6 exact-match only. `TRUST_PROXY` env toggle for the nginx case.
- **Gaps:** no Google OAuth (column only), no refresh tokens / token revocation / logout-server-side, no password reset endpoint (admin app links to a client `/reset-password` route that **does not exist** in `App.jsx`), no email verification, **no rate limiting on login/register**, no account lockout.

### 2.5 Environment variables

- ✅ **All credentials come from `.env`** (`dotenv`). Grep found **no hardcoded secrets** in source. `.env` is gitignored (root + `server/.gitignore`) and **not tracked**.
- ✅ Frontend holds **no** broker creds — `client/.env.example` / `admin/.env.example` only carry `VITE_API_URL` / `VITE_WS_URL` / `VITE_CLIENT_URL`.
- ✅ `config/logger.js` has a redaction formatter stripping JWT-shaped strings + `ANGEL_*` / `DB_PASSWORD` / `JWT_SECRET` from every log line.
- ⚠️ **`server/.env` currently contains real values, including `RAZORPAY_KEY_ID=rzp_live_…` (a LIVE key, not test-mode).** See §5 security.
- ⚠️ The same live key was committed to `server/.env.example` in git history (commit `3e11bae`, "admin work start") and later redacted to blank. History was not rewritten.
- ⚠️ `.env.example` is **not** gitignored (by design — CLAUDE.md Gotcha #7) and real secrets have landed there by accident more than once. Check both files after any credential change.

### 2.6 Error handling & logging

- **Pattern:** every controller wraps its body in `try/catch`, logs `console.error("[scope]", err)`, returns `res.status(4xx/500).json({ error: "..." })`. Consistent. Service-layer errors carry an `err.status` that controllers propagate.
- **Global:** `server.js` has a 404 handler + a global error handler (leaks `err.message` to the client — acceptable for an internal tool, tighten for public prod).
- **Request logging:** a `console.log` line per request in `server.js` (not Winston — noisy, no redaction on the URL).
- **Winston:** `config/logger.js` — 5 per-concern log files (`login`, `worker`, `socket`, `database`, `error`) + shared `error.log`, 5 MB rotation ×3. **Used only by workers / cron / socket / DB layers** — the HTTP controllers still use `console.*`. Two logging systems side by side.
- **No** APM / structured request IDs / correlation IDs.

---

## 3. Client (Frontend) Audit

### 3.1 Component / feature structure

- **13 pages, 24 components (+6 landing).** Real, substantial pages: `OptionChain` (934 LOC), `StrategyBuilder` (1260), `Simulator` (2461 — largest file in the repo), `PaperTrade` (933), `Pricing`, `Auth`, `Home`, `HistoricalChart`, `Events`, `Terms`.
- **Placeholder / demo pages:**
  - `EquityData.jsx` — 5 tools (`sector-performance`, `market-map`, `52-week-high-low`, `industry-momentum`, `most-active`) render a title + "Coming soon" badge. No data.
  - `SectorRotation.jsx` (317 LOC) — a **real, polished RRG chart UI** but bound to `utils/rrgData.js`'s **demo dataset**. The "Demo data — not live" badge is deliberately hard-coded visible.
  - `ComingSoon.jsx` — **orphan**, not referenced by `App.jsx` (Footer has its own inline `ComingSoonButton`).
- **Charting:** heavy. Both `lightweight-charts` and `recharts` are used. Overlapping components: `CandlestickChart`, `StrategyChart`, `IntradayChart`, `LiveIntradayChart`, `UnderlyingChart`, `StrategyValueChart`, `ContractChartModal`, `PayoffChart` — candidate for consolidation.

### 3.2 State management

- **React Context only** — no Redux/Zustand/Jotai.
  - `AuthContext` — token in `localStorage` (`bazaar_sync_token`), fetches `/me` on load, exposes `user` / `isPro` / `instituteAccess` / `login` / `register` / `logout` / `refreshUser`.
  - `ThemeContext` — light/dark, `localStorage` (`bazaar_sync_theme`), pre-paint script in `index.html`.
- Per-page/server state is local `useState` + the shared `useOptionChain` hook (REST fetch + socket.io live-merge + polling fallback, with a request-id race guard for StrictMode). No react-query / SWR.

### 3.3 API call pattern

- **Consistent but copy-pasted.** 12 files in `client/src/services/`, each re-declaring `const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001"` and an identical `async function handle(res)`. Plain `fetch`, `Authorization: Bearer` header passed explicitly per call.
- **`axios` is a client dependency but effectively unused for API calls** (only `fetch`). Dead-ish dependency (may be pulled by a chart/GSAP lib — verify before removing).
- **One live-data path** — `services/liveSocket.js` (socket.io-client singleton). The old raw-WebSocket path was removed. Good.
- No central interceptor → no automatic 401→logout, no retry, no request cancellation beyond `useOptionChain`'s manual guard.

### 3.4 UI complete but backend-disconnected (or vice-versa)

| Area | UI | Backend | Verdict |
|---|---|---|---|
| Option Chain / Strategy Builder / Simulator / Paper Trade / Backtest engine | ✅ | ✅ | Wired, functional (pending live-feed verification) |
| Pricing → Razorpay checkout | ✅ (coupon field, plan cards) | ✅ | Wired; **never completed a real checkout** (live keys → real charge risk) |
| Admin Home Page editor | ✅ (`admin/HomePage.jsx`) + ✅ client renders `content('home')` JSON over defaults | ✅ (`/api/content/home` + `/uploads`) | Wired |
| **Equity Data (5 tools)** | placeholder pages | **none** | UI stub, no backend |
| **Sector Rotation** | ✅ full chart UI | **demo data** (`rrgData.js`) | UI ahead of data |
| **IV Percentile Rank** | not built | data persisted, no endpoint | backend ahead of UI |
| Password reset | admin app links to client `/reset-password` | **route missing on client**, no endpoint | broken link |
| Google login button | not present | column only | not started |

---

## 4. Admin Panel Audit

- **Separate app.** `admin/` is its own Vite + React 19 + Tailwind v4 project (own `package.json`, `node_modules`, `dist`, port **5174**, `strictPort`). Deployed to its own subdomain in prod (README). Talks to the **same** Express backend. Own auth context + `localStorage` key. An "admin account" is just a `users` row with `role='admin'` (promoted by hand in MySQL — no self-serve signup).
- **Design:** dark-only, violet accent, AdminLTE-inspired shell (`Sidebar` + `AppHeader` + `TopBar` breadcrumb + `Card`/`StatCard`).

### What it can do today

| Section | Capability | Notes |
|---|---|---|
| Overview | user counts, active-Pro, total paper balance, strategy/position counts, 30-day signup sparkline, **revenue estimate** | read-only; revenue = count × current price (not real charged amounts — no column stores that) |
| Users | list (latest 500) + per-user detail: strategies, wallet balance/trial, ledger, inferred renewal history, open/closed positions | read-only; **no** ban / role-change / tier-grant / refund |
| Payments | all `pro_purchase_grant` + `refill_purchase` ledger rows, joined to name/email | read-only, `LIMIT 200` |
| Paper Trade (`/positions`) | all open (mark-to-market) + recent closed positions across users | read-only |
| Strategies | all saved strategies across users, leg count parsed client-side | read-only |
| Home Page | edit hero/about/tool-card copy + upload images (`site_content` slug `home`) | ✅ full CRUD |
| Institute Access | IP/CIDR allowlist CRUD | ✅ full CRUD |
| Plans & Coupons | coupon code CRUD (percent/flat, max redemptions, expiry, active toggle) | ✅; "Plans" are read-only from `paperTradeConfig.js` `PRO_PLANS` |
| Events | announcement/webinar CRUD (`is_published`) | ✅ full CRUD |
| T&C | plain-text editor (`site_content` slug `terms`) | ✅ |
| SEO Tool | per-path `title`/`description`/`og_image` CRUD | ✅ (client-side only, no SSR) |
| Lot Size History | effective-dated lot-size CRUD (admin-seeded from NSE circulars) | ✅ |

### Incomplete in admin

- **No write/moderation actions on users** (the core "admin controls the whole website" ask): no ban/suspend, no manual role or tier change, no manual paper-capital grant, no payment refund/adjustment, no force-logout.
- **No pagination** anywhere (hard `LIMIT`s).
- **No notification management** (mentioned in CLAUDE.md scope prose but the sidebar never had it — deliberately not built).
- **No dashboards beyond Overview** (no revenue-over-time, cohort, retention, funnel).
- Client-side-only role gate on routes (fine — real enforcement is server-side per route), but no route guard component; a non-admin hitting `admin/` just gets bounced by the auth context.

---

## 5. Cross-cutting Issues

### 5.1 Security red flags

| # | Severity | Issue |
|---|---|---|
| 1 | **HIGH** | **Live Razorpay key (`rzp_live_…`) in `server/.env`** and previously committed to `server/.env.example` git history (commit `3e11bae`). Redacting the file didn't remove it from history. **Rotate the key pair in the Razorpay dashboard**, and decide whether the history exposure warrants a history rewrite. A full checkout against this local server would charge a real card. |
| 2 | **MED** | **No rate limiting anywhere.** `express-rate-limit` / `helmet` are not installed. `POST /api/auth/login` is brute-forceable; `POST /api/auth/register` is spammable. |
| 3 | **MED** | **Simulator endpoints (`/api/simulator/*`) are completely unauthenticated** and run `GROUP BY` / range scans over `option_chain_history` (millions of rows per symbol). `listDates` has a 10-min TTL cache; `replay` / `chain` do not. Cheap DoS vector, and CLAUDE.md still lists "should Simulator be Pro-gated?" as undecided. |
| 4 | **MED** | **`multer` accepts `image/svg+xml`.** Uploaded SVGs are served from `/uploads` on the API origin; an SVG can carry `<script>`. Stored-XSS risk if a victim opens the file URL directly. Strip SVG from `ALLOWED_MIME` or sanitize. |
| 5 | LOW-MED | No security headers (`helmet`): no HSTS, CSP, `X-Content-Type-Options`, frame options. |
| 6 | LOW-MED | Global error handler returns `err.message` to the client verbatim; request-logging `console.log` prints raw URLs (query strings, no redaction). |
| 7 | LOW | JWT: 7-day expiry, no revocation list, no rotation. Mitigated by every gate re-checking the DB, but a stolen token is valid for 7 days for anything only `requireAuth`-gated. |
| 8 | LOW | `isInstituteIp` runs `SELECT ... FROM institute_ip_allowlist` (no cache) on **every** authenticated request (register/login/me/requirePro/requirePaperAccess/getWallet). Tiny table today; add a short in-memory cache before it grows. |
| 9 | LOW | `register` does no email-format validation; password minimum is 8 chars, no complexity/breach check. |
| 10 | INFO | **No SQL injection found.** All queries are parameterized; the two dynamic-column spots (`contract-history` `ce_ltp`/`pe_ltp`, simulator `resolveSymbol`) are whitelisted / regex-validated. ✅ |
| 11 | INFO | Passwords bcrypt(12), generic "invalid email or password", `password_hash` stripped from every user response. ✅ |

### 5.2 Repo / ops hygiene

| Issue | Detail |
|---|---|
| **Nested git repo** | `server/.git/` is a standalone repo on branch `backend` (last commit `db905c6` "server side angle one code"). The parent monorepo **also** tracks all 94 `server/` files. Not a submodule (no `.gitmodules`). A `git` command run from inside `server/` targets the wrong repo — real risk of commits landing in a dead history. **Recommend removing `server/.git`.** |
| **Lockfiles ignored** | root `.gitignore` has `package-lock.json` — **no lockfile is tracked for any of the 3 apps.** Reproducible installs are not guaranteed; `npm ci` won't work in CI/deploy. |
| **No `admin/.gitignore`** | relies on root `.gitignore` (which does cover `node_modules/` + `dist/`) — works, but inconsistent with `client/` and `server/` which have their own. |
| **`server/.gitignore`** | references `server/logs/` — wrong relative path from inside `server/` (should be `logs/`). Harmless (root ignore covers it) but wrong. |
| **`client/index.html` `<title>` is "client"** | never set to a product name. |
| **No CI, no tests to speak of** | only `client/src/utils/payoff.test.js` (vitest). No server tests. `server/package.json` has no `test` script. |
| **No Dockerfile / compose** | deployment is a manual PM2 + nginx guide in README. |

### 5.3 Duplication

| What | Where | Notes |
|---|---|---|
| `API_URL` + `handle(res)` fetch boilerplate | ~12× in `client/src/services/`, ~2× in `admin/src/services/` | extract a shared `apiFetch` |
| `format.js` | `client/src/utils/` **and** `admin/src/utils/` — **already drifted** (different function sets: client has `formatOi`/`formatPercent`/`formatNumber`; admin has `formatPaiseAsRupees`/`formatCompact`) | no shared package; a monorepo `packages/shared` or at least a synced copy |
| `blackScholes.js` | `client/src/utils/` (60 LOC, pricing only) **and** `server/utils/` (93 LOC, + IV solver) | **intentional** per CLAUDE.md (client is a deliberate pricing-only port) — acceptable, document the sync contract |
| Max-pain / ATM / PCR compute | `optionChainService.js`, `simulatorController.js`, `client/src/utils/maxPain.js` | same algorithm in 3 places |
| Option-chain table rendering | inlined separately in `OptionChain.jsx`, `StrategyBuilder.jsx`, `PaperTrade.jsx` | no shared `<OptionChainTable>` component (CLAUDE.md confirms this is deliberate-so-far) |
| Institute/Pro check logic | `requirePro.js`, `requirePaperAccess.js`, `paperWalletService.isProActive`, `AuthContext` `isPro` | 4 hand-kept-in-sync copies of "tier==='pro' && not expired" |

### 5.4 Naming consistency

- **DB `snake_case` ↔ JS `camelCase`** mapping is done by hand in every controller/service (no shared mapper). Mostly consistent; occasional leaks (`spotPrice` vs `underlying_price`, `og_image` returned raw in some admin responses).
- REST paths: mostly RESTful, but `/api/option-chain/:symbol/{contract-history,underlying-history,intraday}` overloads the option-chain router with what are really generic chart/history endpoints.
- Admin endpoints split across `/api/admin/*`, `/api/events/admin/*`, `/api/content/*`, `/api/seo/admin/*` — inconsistent (some admin ops live under their public resource's router, some under `/api/admin`).
- Symbol casing handled defensively everywhere (`toUpperCase()` / `SYMBOL_MAP`) — a bit repetitive but safe.

### 5.5 Live market data — is it planned/wired?

**Yes — fully architected and coded, not yet verified against a real feed.**

```
Angel One SmartAPI WS 2.0
   └─ workers/marketWorker.js  (separate OS process; TOTP auto-login via otplib)
        └─ workers/websocket.js  (binary tick decode — offsets from published docs, UNVERIFIED)
        └─ validate → workers/buffer.js (flush 100 rows / 2s) → workers/databaseWriter.js (bulk INSERT)
        └─ tiers: live_index_ticks / live_option_ticks / live_greeks_snapshots / pcr_snapshots / oi_summary_snapshots
        └─ IPC (process.send) latest-tick summaries ──►
   services/workerManager.js (in Express) ──► services/marketCache.js (in-memory Map)
        └─ services/socketBroadcast.js  (socket.io "latestTicks" every ~1s per symbol room)
             └─ client/src/services/liveSocket.js ──► useOptionChain hook (live-merge)
   Lifecycle: cron/marketStart.js (08:45 IST fork) + cron/marketStop.js (15:35 IST graceful) + boot-if-in-hours
```

**Verified-not status (per CLAUDE.md + code comments):**
- ❌ Real SmartAPI login response, WS handshake, and byte-level binary tick layout (`workers/websocket.js parseBinaryTick`) — never run with real credentials.
- ❌ Index / VIX tokens (`99926000` etc.) — corrected once already after a silent-empty-data bug; not re-confirmed against a live tick.
- ❌ `getNearestFuture` FUTIDX scrip-master field assumption.
- ❌ `getOIData` response field names.
- ✅ Everything that *can* be verified without a feed (module loads, boot, scrip-master parse, synthetic-tick round-trip, socket connect, schema apply, backfill from stored data).
- Only **NIFTY/BANKNIFTY/FINNIFTY nearest expiry** is truly live (Angel One ~1000-token/connection budget). All other symbols/expiries are historical-from-MySQL by design, not a bug.

`server/.env` now *has* Angel One credentials — so the "run the worker during market hours and validate" task is finally unblocked and should be the **next verification priority**.

---

## 6. CLAUDE.md and `.claude/` Review

### 6.1 Does CLAUDE.md match the codebase?

**Mostly yes, up to Phase 11 (dated 2026-08-20). It is ~1–2 phases behind current `main`.**

| CLAUDE.md says | Reality |
|---|---|
| Phases 1–11 architecture, schema, routes, services | ✅ Matches — the doc is unusually accurate and detailed |
| Phase 6: "deleted `breezeconnect`, `adm-zip`" | ⚠️ Both are back in `server/package.json` (Phase 7 reintroduced `breeze-historical/`). The Phase 6 bullet is stale in isolation; Phase 7 explains it. |
| Phase 8.4 (SELL/short + margin) "was never written up" | ✅ Still true — `paper_positions.side`/`margin_blocked`, `MARGIN_PERCENT_OF_NOTIONAL`, `forceDebit` all exist in code, no phase entry. `PaperTrade.jsx` + `paperPositionService.js` headers still say "no margin computation exists anywhere" (**stale/wrong**). |
| — (not mentioned) | **Undocumented since the last CLAUDE.md update**, visible in `git log` and code: <br>• Admin **Home Page content editor** (`admin/src/pages/HomePage.jsx`, `middleware/upload.js`, `contentController` `home` slug, `site_content`, `client/src/data/homeContentDefaults.js`, `ImageUploadField`) <br>• **Lot Size History** feature (`lot_size_history` table, `lotSizeHistoryService.js`, `admin/src/pages/LotSizeHistory.jsx`, admin routes) — now threaded through backtest + simulator <br>• **Sector Rotation** RRG page + `utils/rrgData.js` <br>• `client/src/components/landing/*` (Hero, FeatureCarousel, PinnedWalkthrough, DashboardMockup) + landing redesign <br>• "live 4-tab candlestick chart system + what-if sliders" in Strategy Builder, "real Strategy Chart (candles+volume+OI)" + combined crosshair sync (commits `2660fa0`, `d33c0bf`, `5cc51f6`) <br>• `testUpstoxDateRange.js`, `FROM_DATE/TO_DATE` on `backfillUpstox.js` |
| Next Steps: "URGENT — rotate Razorpay key", "URGENT — audit every table's PK/FK" | ✅ Both still open and still urgent (see §2.2, §5.1). |

**README.md is more stale than CLAUDE.md** — its intro still lists "OI heatmap, PCR, Max Pain, IV charts, straddle chart" as features, all of which were removed from the nav/pages in Phase 8.1.

### 6.2 `.claude/agents/`

**No subagents are defined.** `.claude/` contains only `launch.json` and `settings.local.json`. There is no `agents/` or `skills/` directory.

`settings.local.json` is a permission allowlist authored on macOS by a different developer environment (`/Users/nishantdua/...`, `/Applications/XAMPP/...`, a rule for the long-deleted `services/breeze.js`, `curl localhost:5000`). It is effectively **dead on this Windows checkout** and should be rebuilt (or trimmed) for the current environment.

---

## Recommended priority order

1. **Rotate the live Razorpay key** (and switch local dev to a `rzp_test_…` pair).
2. **Remove `server/.git`** (nested repo) and **stop ignoring lockfiles**; commit `package-lock.json` for all 3 apps.
3. **Verify the live market-data pipeline** against a real Angel One feed during market hours (creds are now in `.env`) — login, WS handshake, `parseBinaryTick` offsets, index/VIX tokens, nightly cron.
4. **DB constraint audit** — `SHOW CREATE TABLE` for every table vs `schema.sql`, repair missing PK/FK/UNIQUE (plan a window for `option_chain_history`).
5. **Add `helmet` + `express-rate-limit`** (login/register + the unauthenticated Simulator endpoints); decide Simulator's Pro-gating.
6. **Drop `image/svg+xml`** from the upload whitelist (or sanitize).
7. Update **CLAUDE.md** (Phase 8.4 writeup + the undocumented Home-editor / Lot-Size / Sector-Rotation / landing work) and **README.md** (nav/feature list).
8. Refactor: shared `apiFetch` wrapper, shared `format`/pricing package, extract an `<OptionChainTable>`, consolidate the chart components.
9. Rebuild `.claude/settings.local.json` for Windows; consider adding project skills/subagents if that workflow is wanted.
