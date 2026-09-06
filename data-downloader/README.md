# Bazaar Sync — Data Downloader

A **standalone**, self-contained package that does one job: pull NSE options
market data into MySQL. No Express, no frontend, no auth, no Razorpay — just
the data pipeline. Meant to run on its own machine (a cheap always-on box, a
VPS, a spare laptop) so the main app's server doesn't have to carry the live
WebSocket feed or long-running historical backfills.

It writes to the **same MySQL tables** the main app reads
(`option_chain_history`, `ohlcv_data`, and the `live_*` tiers) — point it at
the main database over the network and the app picks the data up with no
extra step.

Everything here is copied from the main repo's `server/` (same code, same
behaviour) with the Express/API layer stripped out. The only local change is
a small `utils/dateStrings.js` (an `addDays` helper lifted out of the main
app's backtest engine so the scripts don't need to import it).

---

## What's included

| Capability | Entry point | Source | Depth / granularity |
| --- | --- | --- | --- |
| **Live tick feed** (Angel One SmartAPI WebSocket) | `npm run worker` | Angel One | today, ~minute-resolution rows + 5s greeks |
| **Historical backfill — Upstox** | `npm run backfill:upstox` | Upstox Expired Instruments (Plus plan) | last ~6 months, 1-minute |
| **Historical backfill — ICICI Breeze** | `npm run backfill:breeze` | ICICI Breeze | ~6mo–3yr back, 1-minute |
| **Historical backfill — NSE + BSE Bhavcopy** | `npm run backfill:bhavcopy-all` | NSE / BSE free EOD archives | unlimited years, **daily/EOD only** |

### Why Bhavcopy is bundled even though it wasn't asked for

`backfillBreeze.js` **does not discover its own contracts** — it reads the
`(expiry, strike)` rows already in `option_chain_history` (put there by the
Bhavcopy backfill) and asks Breeze for 1-minute detail on exactly those. Run
Breeze without Bhavcopy first and it stores nothing, silently. `backfillUpstox.js`
also uses Bhavcopy's stored open-interest to pick which strikes are worth
pulling (it falls back to a fixed ±N window if none is found). So NSE + BSE
Bhavcopy come along as a hard prerequisite, not a bonus. They're free and
need no credentials.

---

## Setup

```bash
cd data-downloader
npm install

cp .env.example .env
#   -> fill in DB_* (required for everything)
#   -> fill in ANGEL_* if you want the live worker
#   -> fill in UPSTOX_* / BREEZE_* if you want those backfills

# Only if this machine has its OWN dedicated database.
# If DB_* points at the main app's DB, its schema already has these tables —
# skip this.
mysql -u root bazaar_sync < config/schema.sql
```

Node 18+ (uses the built-in global `fetch`). `unzip` must be on `PATH` for
the NSE Bhavcopy path (default on macOS/Linux).

---

## Live tick feed

```bash
npm run worker
```

Logs in to Angel One (automatic TOTP), connects the WebSocket 2.0 feed,
subscribes the three indices + India VIX + nearest futures + ~15 strikes
either side of ATM per symbol for the nearest expiry, and bulk-inserts:

- `live_index_ticks` — one row/minute per index
- `live_option_ticks` — one row/minute per option contract
- `live_greeks_snapshots` — every 5s (IV + delta/gamma/theta/vega computed locally via Black-Scholes)
- `pcr_snapshots` — every 60s per symbol
- `oi_summary_snapshots` — every 60s per symbol+strike

It only produces data during NSE market hours (~09:15–15:30 IST). Outside
that window it stays connected but idle. Run it under a process manager
(pm2, systemd, `nohup`) and start it before the open — there is **no built-in
scheduler here** (that lived in the main app's cron). A simple cron line:

```
45 8 * * 1-5   cd /path/to/data-downloader && npm run worker
35 15 * * 1-5  pkill -f workers/marketWorker.js
```

Graceful shutdown (SIGTERM/SIGINT) flushes the buffer and closes the pool
before exiting.

> **Only the nearest expiry per symbol is truly live** — Angel One's
> ~1000-token-per-connection budget doesn't stretch further. Older expiries
> are covered by the historical backfills below.

---

## Historical backfills

All backfills are **resumable** — every write is `ON DUPLICATE KEY UPDATE`,
so re-running after an interruption just re-upserts. Run them in this order:

### 1. Bhavcopy first (free, discovers which contracts existed)

```bash
npm run backfill:bhavcopy-all -- 2            # NSE, ~2 years back, all symbols
npm run backfill:bse-bhavcopy-all -- 2        # BSE (SENSEX/BANKEX), same
# or one symbol / short range:
npm run backfill:bhavcopy -- NIFTY 1
node scripts/testBhavcopy.js                  # sanity-check one day first
```

### 2. Upstox (last ~6 months, minute-level, needs Plus)

```bash
node scripts/testUpstoxInstrumentMaster.js    # confirm symbol->key mapping
npm run backfill:upstox -- NIFTY 10                     # one symbol, ±10 strikes
npm run backfill:upstox -- ALL 10 2026-03-01 2026-09-01 # all symbols, expiry window
```

#### Year orchestrator — `backfill:year`

The self-driving version of the Upstox backfill: **you give it a year**, it
walks the whole universe (7 indices, then ~210 F&O stocks) **month by month**,
and after each month it queries `option_chain_history` to check the data
actually landed — re-fetching any month that came back short before moving on.
Fully resumable via `data/upstox-year-progress.json` (completed months are
skipped on a re-run).

```bash
# see the plan without touching the API/DB
npm run backfill:year -- 2026 --dry-run

# the real run — one year, whole universe
npm run backfill:year -- 2026

# narrower slices
npm run backfill:year -- 2026 --indices-only
npm run backfill:year -- 2026 --only=NIFTY,BANKNIFTY --from-month=3
npm run backfill:year -- 2026 --start-symbol=RELIANCE     # resume mid-universe

# coverage report (read-only, queries the DB)
npm run verify:year -- 2026
```

Per-month status is one of: `complete` (minute data verified), `partial`
(some data, re-run to fill the rest), `no-data` (Upstox has no expiries for
that month — **expected for anything older than ~6 months**), `error`
(transient — retried next run).

> **The ~6-month wall applies here too.** Upstox's expired-instruments API
> does not serve data older than roughly 6 months. `backfill:year -- 2023`
> will run, but every month Upstox can't serve is marked `no-data` and
> skipped — it is not an error, and re-running won't change it. For 2023
> minute data use Breeze (step 3); for 2023 EOD data use Bhavcopy (step 1).
> If your Upstox account has a special extended-history arrangement, the
> orchestrator picks it up automatically — it just asks `getExpiries` and
> backfills whatever comes back.

Options: `--from-month=N` `--to-month=N` `--only=SYM,SYM` `--start-symbol=SYM`
`--indices-only` `--stocks-only` `--strikes=N` `--attempts=N`
`--min-minute-rows=N` `--force` `--dry-run`. The 7-index list and the
`UNIVERSE_FILE` override are documented in `.env.example`.

### 3. Breeze (~6mo–3yr back, minute-level)

**Breeze needs a fresh session token pasted into `.env` every day** — see
[`breeze-historical/README.md`](breeze-historical/README.md) for the exact
login-URL steps. Then:

```bash
node breeze-historical/testBreeze.js NIFTY    # one contract, verify auth + shape
npm run backfill:breeze -- NIFTY              # one symbol
npm run backfill:breeze-all                   # every symbol Bhavcopy found
```

Breeze's hard limit is 5,000 API calls/day. `backfill:breeze-all` stops
cleanly when the daily budget is spent and tells you to re-run tomorrow;
across ~200 symbols a full multi-year enrichment takes many days of daily
runs. This is ICICI's limit, not a bug.

---

## Relationship to the main app

- **Same DB, same tables.** Nothing here defines a table the main app doesn't
  already have. `config/schema.sql` is a copy of the relevant slice of
  `server/config/schema.sql`.
- **No shared runtime.** This package never imports from `../server`. If the
  main app changes one of these table shapes, update `config/schema.sql` here
  and the corresponding `INSERT` in the copied script by hand.
- **Safe to run alongside the main app's own worker — but don't.** Two live
  workers on the same DB means double WebSocket subscriptions and double
  writes. Pick one: either the main app runs its worker, or this machine
  does, not both.

---

## Verification status

Every file here is a copy of code the main repo already exercises. In *this*
package specifically, verified: `node --check` passes on all files, and the
require graph resolves with `npm install`. **Not verified here:** a real
Angel One WebSocket run, a real Upstox/Breeze backfill against live
credentials, or writes against a real MySQL — do a one-symbol test run
(`testBhavcopy.js`, `testBreeze.js`, `testUpstoxInstrumentMaster.js`) on the
target machine before trusting a full backfill, exactly as the main repo's
CLAUDE.md advises.
