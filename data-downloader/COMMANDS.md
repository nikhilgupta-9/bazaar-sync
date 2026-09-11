# Data pipelines — which command fetches what

Two homes for historical-data fetching:

| | `data-downloader/` (this folder) | `server/` |
| --- | --- | --- |
| Source | ICICI Breeze (1-minute) + NSE/BSE bhavcopy (discovery), or Upstox for the recent window | Angel One SmartAPI |
| Reaches back | Breeze ≈ 3 years; Upstox ≈ last 6-11 months only (confirmed live) | weeks (current contracts' lifetime only) |
| Auth | Breeze: `BREEZE_API_SESSION` pasted daily by hand. Upstox: long-lived (~1yr) token, no daily login | automatic (TOTP) |
| Run | by hand, occasionally | nightly cron + on-demand scripts |
| Use it for | the deep 2023→now backfill | keeping data current going forward |

All pipelines write to the **same MySQL database** the app reads. All are
**resumable** and use `ON DUPLICATE KEY UPDATE` — re-running never duplicates
rows, only refreshes them.

---

## `data-downloader/` — deep history (ICICI Breeze)

Run everything from inside `data-downloader/`. First: `npm install`, then put
DB + Breeze creds in `.env` (see `.env.example`). `BREEZE_API_SESSION`
expires **daily** — get a fresh one before each session (login URL in
`.env.example`).

### Option chain (CE/PE, every strike, + Greeks) → `option_chain_history`

```bash
node test/testBreeze.js NIFTY                    # sanity check (1 contract) — do this first
npm run option-chain -- 2024                     # whole year 2024, month by month
npm run option-chain -- 2024 --symbols=NIFTY     # just one symbol (testing)
npm run option-chain -- 2024 --from-month=6      # resume/start at June
npm run option-chain -- 2024 --skip-enrich       # discovery + verify only, no Breeze calls
npm run option-chain -- 2025                     # next year (run each year separately)
```

Per month: **discovery** (NSE+BSE bhavcopy → every contract that traded) →
**enrich** (Breeze 1-minute CE/PE + Greeks) → **verify** (per-symbol
coverage report → `data/breeze-pipeline-reports/<ym>.json`).
Enrich burns Breeze's 5,000-calls/day budget fast — it stops mid-month and
tells you to re-run tomorrow. Repeat daily until the year is done.

### Option chain, recent window (Upstox, no daily login) → `option_chain_history`

```bash
node test/testUpstox.js NIFTY                    # sanity check — do this first
npm run option-chain:upstox -- 2025              # whole year (Upstox's own window applies)
npm run option-chain:upstox -- 2025 --symbols=NIFTY
```

Writes the same table as the Breeze pipeline above — no conflict, ever
(`ON DUPLICATE KEY UPDATE`). No daily session paste (`UPSTOX_ACCESS_TOKEN` is
long-lived). Upstox's real depth is only ~6-11 months back (confirmed live,
2026-09-11) — use this for the recent window, Breeze/bhavcopy for anything
older. For full-chain (every liquid strike, not just ATM±10) coverage, run
`npm run option-chain -- <YEAR> --skip-enrich` for the same months first so
bhavcopy's OI data is there to select strikes from.

### Futures / "future chain" (index + stock futures) → `futures_history`

```bash
node test/testFutures.js NIFTY                   # sanity check — do this first
npm run futures -- 2024                          # whole year 2024, month by month
npm run futures -- 2024 --symbols=NIFTY,RELIANCE # subset (testing)
npm run futures -- 2024 --skip-enrich            # discovery + verify only
npm run futures -- 2025
```

Same discovery→enrich→verify structure as the option chain, but one OHLC+OI
series per `(underlying, expiry)` — no strikes, no Greeks. Far fewer Breeze
calls than options, so a full year usually finishes in far fewer daily runs.
Reports → `data/futures-pipeline-reports/<ym>.json`.

### India VIX (1-minute OHLC) → `ohlcv_data` (symbol `INDIAVIX`)

```bash
node test/testVix.js                             # sanity check — do this first
npm run vix -- 2024                              # whole year (cheap, ~15 calls/month)
npm run vix -- 2024 --from-month=6
```

Per month: **download** (Breeze 1-minute India VIX) → **verify** (trading-day
coverage, ~375 candles/day, gap detection → `data/vix-pipeline-reports/<ym>.json`).
The Breeze VIX code (`INDIAVIX`/`NSE`/`cash`) is unverified — if `testVix.js`
returns 0 candles, set `BREEZE_VIX_STOCKCODE` / `BREEZE_VIX_EXCHANGE` /
`BREEZE_VIX_PRODUCT` in `.env`.

### One-off, single symbol / arbitrary date range (no year loop)

```bash
node breeze/enrich.js NIFTY 2024-01-01 2024-03-31    # options, one symbol, explicit range
node futures/enrich.js NIFTY 2024-01-01 2024-03-31   # futures, one symbol, explicit range
```
(These only enrich contracts already discovered — run the matching
`--skip-enrich` year pass first, or a bhavcopy discovery for the range.)

---

## `server/` — keep data current (Angel One)

Run from inside `server/`. No daily login (TOTP is automatic).

### Automatic — nightly cron (already scheduled)

`services/cron.js` runs 23:00 IST Mon–Fri and pulls, for NIFTY / BANKNIFTY /
FINNIFTY:
- index 1-minute candles → `ohlcv_data`
- nearest-expiry option chain → `option_chain_history`
- **nearest index future → `futures_history`** (added with the futures work)

Force a run now (e.g. after a downtime):
```bash
node scripts/runCronNow.js
```

### On-demand recent backfill

```bash
node scripts/backfillHistory.js NIFTY 10        # options + index candles, last 10 trading days
node scripts/backfillFutures.js ALL 30          # futures (FUTIDX + FUTSTK), last 30 trading days
node scripts/backfillFutures.js NIFTY 10        # just one underlying
```
`backfillFutures.js` reads the Angel One scrip master, so it only sees
currently-live contracts — it reaches back weeks, not years. For older
futures history use `data-downloader/`'s `npm run futures`.

---

## Where each thing lands

| Data | Table | Key columns |
| --- | --- | --- |
| Option chain (historical) | `option_chain_history` | symbol, expiry, strike, trade_date, trade_time |
| Futures (historical) | `futures_history` | symbol, expiry, trade_date, trade_time |
| Index / stock candles | `ohlcv_data` | symbol, trade_date, trade_time |
| India VIX | `ohlcv_data` (symbol `INDIAVIX`) | symbol, trade_date, trade_time |

---

## Typical full-history bootstrap (one-time)

```bash
# in data-downloader/ — repeat for each year 2023, 2024, 2025, 2026:
npm run option-chain -- 2023              # re-run daily until it stops saying "budget exhausted"
npm run futures      -- 2023              # then this
npm run vix          -- 2023              # then this (fast)
# ...next year

# once you're within Upstox's real window (~last 6-11 months), this is
# faster and needs no daily login — either use it instead of the Breeze
# option-chain command above for those months, or run it after as a
# quick top-up:
npm run option-chain:upstox -- 2025

# in server/ — from then on, the nightly cron keeps everything current.
# after any gap, catch up with:
node scripts/backfillHistory.js NIFTY 15
node scripts/backfillFutures.js ALL 15
```
