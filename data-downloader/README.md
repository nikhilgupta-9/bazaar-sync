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

## Dhan pipeline (2023+ minute option chain, index/VIX/equity spot, daily futures)

```bash
node test/testDhan.js                          # raw API probe — auth, instrument master, one call of each type
node test/testDhanPipeline.js NIFTY 2023 1     # real small-scale end-to-end run + DB verify (reduced rank/offset scope)

node dhan/run.js NIFTY 2023                    # one symbol, one full year, all 4 phases
npm run dhan:universe                          # THE driver: 2023..current year, 7 indices + INDIAVIX + every F&O stock, one symbol fully at a time
npm run dhan:universe -- 2023 2024 --symbols=NIFTY,BANKNIFTY
npm run dhan:universe -- --reset               # ignore saved progress, start the universe over from symbol #1
```

`DHAN_ACCESS_TOKEN` must be a **personal long-lived** token (Dhan app:
Profile → DhanHQ Trading APIs → Generate Token) — a partner/consent-flow
token expires in 24h (confirmed for real: a token's own JWT `exp` claim was
exactly `iat + 24h`), which is far too short for a job that runs across real
days. `dhan/runUniverse.js` detects repeated `DH-901` auth failures and stops
cleanly with a "regenerate the token, re-run this same command" message
rather than burning through the whole symbol list failing.

**What Dhan can and can't actually do, confirmed empirically (2026-09-14) —
none of this came from docs alone, every claim below was checked against a
real response:**

- **Index spot + India VIX**: `/charts/intraday`, real minute candles back to
  at least Jan 2023 (probably further, not pushed harder). Security IDs are
  hardcoded in `dhan/instrumentMaster.js` (NIFTY=13, BANKNIFTY=25,
  FINNIFTY=27, MIDCPNIFTY=442, NIFTYNXT50=38, SENSEX=51, BANKEX=69,
  INDIAVIX=21) — confirmed against real Jan-2023 numbers landing in each
  index's actual historical range, not guessed.
- **Equity (stock) spot**: same endpoint, `NSE_EQ`/`EQUITY`, securityId
  looked up per-symbol from Dhan's own published scrip-master CSV. Also
  confirmed minute-level back to Jan 2023.
- **Options**: **only** `/charts/rollingoption` reaches 2023 — Dhan's normal
  `/charts/intraday` needs a securityId, and Dhan's own instrument master
  only lists TODAY's currently-tradable contracts (confirmed: earliest
  listed NIFTY OPTIDX expiry was next week, nothing from 2023 or even most
  of 2026). `rollingoption` sidesteps that by addressing strikes as
  **ATM-relative offsets** (`"ATM"`, `"ATM+N"`/`"ATM-N"`, capped at ±10 for
  index / ±3 for stock per Dhan's docs) and rolling continuously across real
  expiries by an `(expiryFlag, expiryCode)` rank — there is no absolute-
  strike, no explicit-expiry way to ask for "give me every strike that
  traded." `dhan/expiryResolver.js` derives which REAL calendar expiry each
  rank corresponds to on a given date using this repo's own bhavcopy
  discovery (free, already happening) — Dhan's response carries no expiry
  field at all. Confirmed working for both `OPTIDX` (index) and `OPTSTK`
  (stock — tested via TCS, clean at every date tried).
  - **Known caveat, found empirically, not a bug here**: a stock with a
    split/bonus in its history (RELIANCE, 2024) had degraded/partial
    rollingoption coverage for dates before that corporate action — Dhan's
    own historical continuity breaks there. Shows up as an unusually low row
    count for that stock/month, not a silent gap.
  - Coverage is intentionally bounded: `DHAN_WEEKLY_RANKS` (default 6) /
    `DHAN_MONTHLY_RANKS` (default 3) ranks out, `DHAN_INDEX_STRIKE_OFFSETS`
    (default 10) / `DHAN_STOCK_STRIKE_OFFSETS` (default 3) either side of
    ATM. Deep OTM/ITM strikes and expiries far in the future are simply not
    obtainable from Dhan at all — same "this is the real limit, not an
    oversight" convention as the live worker's own ±15-strike window.
  - Dhan's own `iv` field came back empty in every real rollingoption test —
    IV/Greeks are computed here via `lib/blackScholes.js` from Dhan's own
    resolved strike/spot/close, same as every other source in this repo.
- **Futures**: `/charts/historical` with `FUTIDX`/`FUTSTK` — but this is a
  **continuous rolling series**, confirmed by asking a contract that didn't
  exist yet in Jan 2023 for Jan 2023 data and getting back real NIFTY-range
  numbers anyway (any current live contract's securityId works, arbitrarily
  far back — checked to 2015). Real OI when `oi:true` is passed. **Daily
  only** — minute-level intraday for an old/expired future came back
  completely empty in every real test, so there is no path to minute-level
  historical futures via Dhan at all. Real expiry per row is derived the
  same way as options, reusing the MONTH-classified expiry list options
  discovery already produced (monthly options and monthly futures share the
  same NSE expiry day).

`dhan/runUniverse.js` is genuinely a multi-day-to-multi-week job across the
full universe (7 indices + INDIAVIX + ~200 F&O stocks × every year from 2023
× the rank/offset scope above) — expect to run it, get interrupted, and
re-run the same command many times; it's fully resumable
(`data/dhan-universe-progress.json`) and never leaves duplicate rows (every
write is `ON DUPLICATE KEY UPDATE`).

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
