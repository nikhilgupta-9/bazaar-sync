# breeze-historical/ — ICICI Breeze, historical backfill ONLY

## Why this folder exists

Phase 6 (2026-07-18) deliberately and fully removed ICICI Direct Breeze
Connect from this project in favor of Angel One SmartAPI — see the root
`CLAUDE.md`. That decision **stands** for everything live: real-time ticks,
the market worker, the option chain dashboard, Greeks — all of that stays on
Angel One, unchanged, forever.

Reintroduced 2026-07-19, but scoped on purpose: Breeze is used **only** to
backfill historical minute-level option-chain data for the window neither of
the other two historical sources fully covers —

| Source                              | Depth              | Granularity     |
| ------------------------------------ | ------------------- | ---------------- |
| Angel One (live)                     | today                | tick-level        |
| Upstox Expired Instruments (Plus)    | ~6 months back        | 1-minute          |
| **ICICI Breeze (this folder)**       | ~3 years back (claimed by ICICI, unverified here) | 1-minute |
| NSE Bhavcopy (`services/nseBhavcopy.js`) | unlimited years back | daily/EOD only |

Nothing in this folder is called from any Express route, the market worker,
or anything under `server/workers/`. It's invoked only by
`node breeze-historical/backfillBreeze.js`, a one-off/occasional script — the
same relationship Upstox's `scripts/backfillUpstox.js` has to the live path.
If this folder were deleted entirely, nothing else in the app would break.

## Real limitation of ICICI's own auth model (why this can't be a cron job)

Unlike Angel One's TOTP (`workers/login.js`, fully automatic), Breeze
requires a **daily manual browser login**:

1. Visit `https://api.icicidirect.com/apiuser/login?api_key=<url-encoded BREEZE_API_KEY>`
2. Log in with your ICICI Direct credentials
3. You'll be redirected to a URL containing `apisession=<value>` — that value
   is today's session token
4. Paste it into `server/.env` as `BREEZE_API_SESSION` (yourself — same rule
   as every other credential in this project)
5. Only then run `backfillBreeze.js` — the session is valid for that day only

This is exactly the pain Phase 6 escaped for the *live* path. It's tolerable
here because this only runs occasionally for bulk historical backfill, not
every day automatically.

## Rate limits (confirmed against ICICI's own FAQ pages, 2026-07-19)

- 100 calls/minute
- 5,000 calls/day
- 1,000 candles max per historical-data call

`rateLimiter.js` enforces both, with a persistent per-day counter
(`server/data/breeze-call-count.json`, gitignored) so a run that gets
interrupted and resumed later doesn't blow the daily cap.

## What's UNVERIFIED here

Everything Angel One/Upstox in this repo was checked against a real account
or live docs before being trusted. This folder is built from the official
`breezeconnect` npm package's documented method signature
(`getHistoricalDatav2`) and ICICI's public rate-limit FAQ — but the actual
response body shape (exact field names for OHLCV/OI) and the specific
"F&O data limited to 3 years" claim were **not** independently confirmed.
`historicalService.js` parses responses defensively (matches known field-name
variants, throws with the real keys on a miss) for the same reason
`services/nseBhavcopy.js` does. Run `testBreeze.js` for one contract before
trusting a multi-year run.

## Usage

```bash
cd server
node breeze-historical/testBreeze.js NIFTY          # one contract, sanity check
node breeze-historical/backfillBreeze.js NIFTY       # full backfill for one symbol, date-range args
```

`backfillBreeze.js` does NOT discover its own strikes/expiries via Breeze —
it reads the (expiry, strike) combinations that `scripts/backfillBhavcopy.js`
already found and stored in `option_chain_history`, then asks Breeze for
1-minute detail on exactly those contracts. Run the Bhavcopy backfill for the
target date range first.

## `pipelineYear.js` — year in, month-by-month option-chain data out

```bash
cd server
node breeze-historical/pipelineYear.js 2024                       # whole year, every completed month
node breeze-historical/pipelineYear.js 2024 --symbols=NIFTY,BANKNIFTY   # testing subset
node breeze-historical/pipelineYear.js 2024 --skip-enrich         # discovery + verify only (no Breeze calls)
node breeze-historical/pipelineYear.js 2024 --from-month=3        # start at March
```

One command, one year. For each calendar month, in order:

1. **discovery** — walks every trading day, pulls NSE + BSE bhavcopy
   (`services/nseBhavcopy.js`, `services/bseBhavcopy.js`), upserts one EOD row
   per `(symbol, expiry, strike)` that traded. This is the contract/expiry
   universe — Breeze itself can't list historical contracts, so this pass has
   to establish "what existed". Free, no call budget, reaches years back.
2. **enrich** — for every symbol found, asks ICICI Breeze for 1-minute CE/PE
   candles on each discovered contract + computes Greeks, upserting minute
   rows over the EOD ones (`backfillBreeze.js`'s `backfillSymbol`).
3. **verify** — checks every discovered contract actually got minute data,
   every expiry looks sane (no weekend expiries, no rows dated past their own
   expiry). Writes `server/data/breeze-pipeline-reports/<year>-<month>.json`
   and prints a summary. Then advances to the next month.

**Resumable.** Progress (`year` / `month` / `phase`) persists to
`server/data/breeze-pipeline-progress.json`. Breeze's 5,000-calls/day limit
is far below one month of the full ~215-symbol / every-strike / 1-minute
universe, so the enrich phase routinely spends the day's budget mid-month,
saves progress, and exits 0 telling you to re-run tomorrow — where it picks
up exactly where it stopped (already-enriched contracts skip instantly). A
full year is many real days of daily re-runs. That's ICICI's rate limit, not
a bug.

Depth: Breeze's historical F&O window is ~3 years (ICICI's claim, still not
independently confirmed here) — years older than that get EOD-only rows from
the discovery pass and nothing from enrich.

The 7 indices: NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / NIFTYNXT50 (NSE,
exchangeCode `NFO`) + SENSEX / BANKEX (BSE, exchangeCode `BFO`). The BSE two
and MIDCPNIFTY / NIFTYNXT50 use **unverified** Breeze stock codes
(`symbolMap.js` `INDEX_OVERRIDES`, all env-overridable) — if a run stores 0
minute rows for one of them while discovery found its contracts, that stock
code is the first thing to fix.
