# data-downloader/ — standalone historical-data downloader

A separate Node app (own `package.json`, own `node_modules`, own `.env`)
that pulls historical NSE F&O data into the same MySQL database the main
Bazaar Sync app reads from. **Nothing here is imported by the Express
server, the market worker, or anything on the live path** — it's run by
hand, occasionally, from the command line. If this whole folder were
deleted, the running app would not break.

It was split out of the parent repo's `server/breeze-historical/` (moved
here 2026-09-10) so the download tooling can run on its own — a different
machine, a long-running box — without dragging the whole server in.

## What it downloads

| Pipeline | Command | Source | Granularity | Depth |
| --- | --- | --- | --- | --- |
| Option chain (7 indices + ~210 F&O stocks) | `npm run option-chain -- <YEAR>` | NSE+BSE bhavcopy (contract discovery) + ICICI Breeze (minute data) | 1-minute CE/PE + Greeks | Breeze ≈ 3 years back |
| India VIX | `npm run vix -- <YEAR>` | ICICI Breeze | 1-minute OHLC | Breeze ≈ 3 years back |

Both write year-by-year, month-by-month, with a verification pass after
every month. Both are resumable.

## Setup

```bash
cd data-downloader
npm install
cp .env.example .env          # then fill in DB + Breeze creds by hand
```

`BREEZE_API_SESSION` expires **daily** — Breeze has no automatic login. Get a
fresh value each day via the login URL in `.env.example` before running
anything that hits Breeze.

## Option-chain pipeline

```bash
npm run option-chain -- 2024                        # whole year, every completed month
npm run option-chain -- 2024 --symbols=NIFTY,BANKNIFTY   # testing subset
npm run option-chain -- 2024 --skip-enrich          # discovery + verify only (no Breeze calls)
npm run option-chain -- 2024 --from-month=3         # start at March
```

Per month, in order:

1. **discovery** (`optionchain/monthDiscovery.js`) — walks every trading day,
   pulls NSE + BSE bhavcopy, upserts one EOD row per `(symbol, expiry,
   strike)` that traded into `option_chain_history`. Breeze can't list
   historical contracts, so this establishes "what existed". Free, no call
   budget, reaches years back.
2. **enrich** (`breeze/enrich.js`) — for every symbol found, asks Breeze for
   1-minute CE/PE candles on each discovered contract + computes Greeks,
   upserting minute rows over the EOD ones.
3. **verify** (`optionchain/verifyMonth.js`) — per-symbol report: discovered
   vs minute-enriched contract counts, weekend-expiry check, rows-past-expiry
   check. Written to `data/breeze-pipeline-reports/<year>-<month>.json` with a
   printed summary.

**Resumable.** Progress persists to `data/breeze-pipeline-progress.json`.
Breeze's 5,000-calls/day cap is far below one month of the full ~215-symbol /
every-strike / 1-minute universe, so the enrich phase routinely spends the
day's budget mid-month, saves progress, and exits 0 telling you to re-run
tomorrow — where it picks up exactly where it stopped. A full year is many
real days of daily re-runs. That's ICICI's rate limit, not a bug.

Flags: `--from-month=N` `--to-month=N` `--symbols=A,B` `--skip-discovery`
`--skip-enrich` `--skip-verify` `--stop-on-verify-fail` `--reset`.

The 7 indices: NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / NIFTYNXT50 (NSE,
`NFO`) + SENSEX / BANKEX (BSE, `BFO`). The BSE two and MIDCPNIFTY /
NIFTYNXT50 use **unverified** Breeze stock codes (`breeze/symbolMap.js`
`INDEX_OVERRIDES`, all env-overridable) — if a run stores 0 minute rows for
one of them while discovery found its contracts, that stock code is the
first thing to fix.

## India VIX pipeline

```bash
node test/testVix.js                # sanity check — confirm Breeze returns real VIX candles
npm run vix -- 2024                 # whole year
npm run vix -- 2024 --from-month=6
```

Per month: **download** (`vix/vixHistorical.js` — Breeze 1-minute India VIX
candles → `ohlcv_data` with `symbol = 'INDIAVIX'`) → **verify**
(`vix/run.js`'s `verifyVixMonth` — every expected trading day present? ~375
candles per day? no multi-day gaps? → `data/vix-pipeline-reports/<ym>.json`).
The verify step's trading calendar comes from `option_chain_history` NIFTY
days if the option-chain pipeline has run for that month, else "every
weekday".

VIX is cheap on Breeze's budget (~15 calls/month) so a full year runs in one
sitting. Still resumable via `data/vix-pipeline-progress.json`.

The Breeze stock code for India VIX (`INDIAVIX` / `NSE` / `cash`) is **not
independently confirmed** — override via `BREEZE_VIX_STOCKCODE` /
`BREEZE_VIX_EXCHANGE` / `BREEZE_VIX_PRODUCT` in `.env` if `testVix.js`
returns 0 candles.

## Vendored code

`lib/nseBhavcopy.js`, `lib/bseBhavcopy.js`, `lib/blackScholes.js`,
`lib/logger.js` are **copies** of the parent repo's `server/services/…` /
`server/utils/…` / `server/config/…` files (as of the 2026-09-10 split).
Deliberate — this folder is standalone. If a bug is fixed in one of the
parent's originals, port it here by hand (and vice versa).

## Where the data lands

- Option chain → `option_chain_history` (same table the backtest engine
  reads; `ON DUPLICATE KEY UPDATE` on `(symbol, expiry, strike, trade_date,
  trade_time)` — re-runs never duplicate).
- India VIX → `ohlcv_data` (`symbol = 'INDIAVIX'`; unique on `(symbol,
  trade_date, trade_time)`).
