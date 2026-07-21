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
node breeze-historical/backfillBreeze.js NIFTY       # full backfill for a symbol
```

`backfillBreeze.js` does NOT discover its own strikes/expiries via Breeze —
it reads the (expiry, strike) combinations that `scripts/backfillBhavcopy.js`
already found and stored in `option_chain_history`, then asks Breeze for
1-minute detail on exactly those contracts. Run the Bhavcopy backfill for the
target date range first.
