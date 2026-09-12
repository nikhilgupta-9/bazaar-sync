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
| Option chain, recent window | `npm run option-chain:upstox -- <YEAR>` | Upstox Expired Instruments (self-discovering, no bhavcopy needed) | 1-minute CE/PE + Greeks | Upstox ≈ last 6-11 months only |
| Futures / "future chain" (index + stock futures) | `npm run futures -- <YEAR>` | NSE+BSE bhavcopy + ICICI Breeze | 1-minute OHLC + OI | Breeze ≈ 3 years back |
| Futures, recent window | `npm run futures:upstox -- <YEAR>` | Upstox Expired Instruments (self-discovering, no bhavcopy needed) | 1-minute OHLC + OI | Upstox back to 2024-10 (confirmed live 2026-09-12 — covers all of 2025+2026) |
| India VIX | `npm run vix -- <YEAR>` | ICICI Breeze | 1-minute OHLC | Breeze ≈ 3 years back |

Both option-chain pipelines write to the **same** `option_chain_history` table,
and both futures pipelines write to the **same** `futures_history` table
(`ON DUPLICATE KEY UPDATE` — never a conflict, a later/more-granular source
legitimately upgrades an earlier row for the same contract/minute). Use
Upstox for the recent window it actually covers (no daily login needed,
faster) and Breeze for everything older — see
[COMMANDS.md](COMMANDS.md#typical-full-history-bootstrap-one-time) for the
recommended order.

All write year-by-year, month-by-month, with a verification pass after every
month. All are resumable.

**See [COMMANDS.md](COMMANDS.md) for the full command reference** — every
command, what it fetches, which table it lands in, and the typical
full-history bootstrap order (including the `server/` Angel One scripts that
keep data current going forward).

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

## Option chain — Upstox (recent window, no daily login)

```bash
node test/testUpstox.js NIFTY               # sanity check — confirms the token works + prints Upstox's real oldest-available expiry
npm run option-chain:upstox -- 2025          # whole year (months outside Upstox's window just skip, logged)
npm run option-chain:upstox -- 2025 --symbols=NIFTY,RELIANCE
npm run option-chain:upstox -- 2025 --strikes-per-side=15
```

`UPSTOX_ACCESS_TOKEN` is long-lived (~1yr "extended" token, not a daily
session) — this can run start to finish in one sitting, no re-login. Upstox
discovers its own contracts (no bhavcopy discovery phase needed), but for
**every liquid strike** (not just an ATM ± N window) it needs bhavcopy OI
data already in `option_chain_history` for that month — run (or have
already run) `npm run option-chain -- <YEAR> --skip-enrich` for the same
range first. Without it, `upstox/enrich.js` falls back to a fixed
`--strikes-per-side` window (default 10) and says so loudly.

**Upstox's real retention is short** — confirmed both from Upstox's own docs
("up to six months of historical expiries") and a live check (oldest
available NIFTY expiry was 2024-10-03 as of 2026-09-11, ~11 months back).
Months older than that report "0 expiries in range" and skip — expected, not
a bug. For 2022 onward, use the Breeze pipeline above instead.

## Futures pipeline

```bash
node test/testFutures.js NIFTY     # sanity check (bhavcopy futures rows + one Breeze contract)
npm run futures -- 2024
npm run futures -- 2024 --symbols=NIFTY,RELIANCE
```

Per month: **discovery** (`futures/monthDiscovery.js` — NSE+BSE bhavcopy
IDF/STF rows → one EOD row per `(underlying, expiry)` in `futures_history`)
→ **enrich** (`futures/enrich.js` — Breeze 1-minute futures candles per
contract, `productType: "futures"`, no strike/right/Greeks) → **verify**
(`futures/verifyMonth.js` → `data/futures-pipeline-reports/<ym>.json`). Same
flags and resumability as the option-chain pipeline. Far fewer contracts than
options (one series per `(underlying, expiry)`), so a year finishes in fewer
daily runs.

## Futures pipeline — Upstox (recent window, no daily login)

```bash
node test/testUpstoxFutures.js NIFTY               # sanity check — do this first
npm run futures:upstox -- 2025                     # whole year
npm run futures:upstox -- 2025 --symbols=NIFTY,BANKNIFTY,FINNIFTY,MIDCPNIFTY,NIFTYNXT50,SENSEX,BANKEX
npm run futures:upstox -- 2026
```

Futures counterpart of the option-chain Upstox pipeline. No discovery phase
needed — `upstox/enrichFutures.js` uses `upstox.getExpiries()` +
`getExpiredFutureContracts()` to find the one MONTHLY futures series per
expiry itself (a weekly options-only expiry correctly returns 0 contracts
and is skipped — confirmed live 2026-09-12, not an error). Writes the same
`futures_history` table the Breeze pipeline above uses (`ON DUPLICATE KEY
UPDATE`). **Upstox's real retention for futures is deeper than for options**
— confirmed live 2026-09-12: `getExpiries()` reaches back to 2024-10 for all
7 indices, so this alone covers all of 2025 and 2026 with no Breeze needed.
Works for individual stock futures too via `--symbols=`, resolved through
the same downloaded Upstox instrument master as the options pipeline.

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
