# Kotak Neo — second live market-data source

Added 2026-09-10. Kotak Neo runs **alongside** Angel One SmartAPI — it does
**not** replace it (explicit user decision). Angel One still owns the live
worker / `marketCache` / socket.io pipeline, completely untouched.

## Scope

- **All 7 F&O indices**: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50
  (NSE) + SENSEX, BANKEX (BSE).
- **The full ~210 F&O stock universe** — auto-discovered from Kotak's scrip
  master (every `OPTSTK` underlying), or a subset via `KOTAK_STOCKS`.
- **India VIX** and each underlying's **nearest future**.

## Live vs. historical

| | Kotak Neo | Where it comes from instead |
| --- | --- | --- |
| **Current / live** data | ✅ REST Quotes (LTP, OI, volume, bid/ask) | — |
| **Historical / candle** data | ❌ **Not available.** Kotak's support page: *"Historical data is unavailable … not allowed for this platform."* `/charts/v1/scrip/history` returns 503. | Phase 7 sources — Upstox (~6mo), NSE/BSE Bhavcopy (EOD, multi-year), ICICI Breeze (~6mo–3yr) |

**The poller is the forward historian.** Every day it runs it appends real
minute snapshots to `option_chain_history` / `ohlcv_data`, so a self-recorded
history accumulates from the day it's first switched on — 5 years of NIFTY
history won't appear overnight, but a live Kotak feed running daily builds
real depth over time at full 7-index + 210-stock breadth that the Phase 7
back-history sources don't all cover.

## Where data lands — no new tables

| Data | Written to |
| --- | --- |
| Option chain (CE/PE LTP, OI, volume, bid/ask + IV/Greeks) | `option_chain_history` (the **existing** table — same columns + `ON DUPLICATE KEY UPDATE` as `services/cron.js`) |
| Spot (index or stock) | `ohlcv_data`, `symbol = NIFTY` / `RELIANCE` / `SENSEX` / … |
| India VIX | `ohlcv_data`, `symbol = INDIAVIX` |
| Nearest future | `ohlcv_data`, `symbol = NIFTYFUT` / `RELIANCEFUT` / … |

`trade_time` is snapped to the current minute, so repeated polls within a
minute refresh one row instead of spraying dozens (same "one row per minute"
rule as the Angel One worker). VIX/future symbols are namespaced so they can
never collide with the real index/stock symbols the backtest engine queries.

## Polling tiers (`config/kotak.js` → `tiers`)

- **INDEX tier** — all 7 index chains + VIX, every `KOTAK_INDEX_INTERVAL_MS`
  (15 s). Cheap: ~7 chains.
- **STOCK tier** — ~210 chains as a **rolling sweep**: each step polls
  `KOTAK_STOCK_PER_STEP` (6) chains, the whole universe comes around every
  `KOTAK_STOCK_SWEEP_MS` (5 min). A fast full sweep would be thousands of
  REST calls per pass and blow the rate limit; the rolling sweep keeps total
  volume to a few req/s.

Run both in one process (`KOTAK_MODE=all`, default) or split them:

```bash
KOTAK_MODE=index npm run kotak    # process 1 — fast index chains
KOTAK_MODE=stock npm run kotak    # process 2 — slow stock sweep
```

## Files

```
config/kotak.js          all hosts / paths / the 7-index table / tier config — the ONE place to fix
kotak/auth.js            OAuth token -> TOTP login -> MPIN validate (fully automatic)
kotak/instruments.js     4 scrip-master CSVs -> spot / VIX / future / option tokens (indices + stocks, NSE + BSE)
kotak/quotes.js          REST Quotes, chunked, auto re-login on 401
kotak/marketData.js      assemble a chain snapshot + Greeks (utils/blackScholes.js)
kotak/repo.js            upserts into option_chain_history + ohlcv_data
kotak/poller.js          the two tiers + market-hours guard
scripts/kotakPollOnce.js  one snapshot for any symbol, then exit — the verification tool
```

Nothing here requires Express or touches `req`/`res`. Outbound surfaces:
Kotak's REST API and the shared `config/db.js` MySQL pool only.

## Setup

1. Kotak Neo web/app → Invest → Trade API → API Dashboard → **Create
   Application** → note Consumer Key + Secret.
2. Register **TOTP**:
   `kotakneo.com/platform/kotak-neo-trade-api/totp-registration/` — save the
   base32 seed (behind the QR), not a 6-digit code.
3. Set an **MPIN** for the API.
4. Fill the `KOTAK_*` block in `server/.env` (see `.env.example`).
5. Verify (market hours):
   `TZ=Asia/Kolkata npm run kotak:once`            (NIFTY)
   `TZ=Asia/Kolkata node scripts/kotakPollOnce.js SENSEX`
   `TZ=Asia/Kolkata node scripts/kotakPollOnce.js RELIANCE`
   `TZ=Asia/Kolkata node scripts/kotakPollOnce.js --list`   (show the resolved universe)
6. Run continuously: `TZ=Asia/Kolkata npm run kotak`
   or `pm2 start kotak/poller.js --name kotak-poller --time`

## ⚠ Not yet verified against a live credentialed run

Endpoint hosts, some header names and the scrip-master CSV column names come
from Kotak's official `neo_api_client` (v2) Python SDK source + its `docs/`,
**not** from a real login. All files syntax-check and require-load clean, and
the CSV parser + token/expiry/window logic were unit-tested against synthetic
fixtures. On the first real run, check:

- `oauth2/token`, `totp/login`, `totp/validate` hosts + response shapes
  → fix in `config/kotak.js`.
- Scrip-master CSV headers (`dStrikePrice` vs `dStrikePrice;`, `pInstType`
  values `OPTIDX`/`OPTSTK`/`FUTIDX`/`FUTSTK`, the fno expiry epoch offset,
  BSE segment file names) → fix the `COL` map + `epochToSql` in
  `kotak/instruments.js`.
- The Quotes response shape and that index LTP arrives under `iv`
  → fix `normalize()` in `kotak/quotes.js`.
- The 7 index `indexName` values against Kotak's real `nse_cm`/`bse_cm` rows
  (esp. `NIFTY MID SELECT`, `SENSEX`, `BANKEX`) → `config/kotak.js` `indices`.

## Not built

- **Binary WebSocket streamer** (`wss://mlhsm.kotaksecurities.com`) —
  proprietary binary frame format needing a ~1000-line decoder. REST polling
  is enough for "chains + VIX into MySQL". Port from
  `neo_api_client/HSWebSocketLib.py` if sub-second ticks are ever needed.
- **Feeding `marketCache` / socket.io.** That stays Angel One's job.
- Stock **futures** are skipped by the stock tier (`withFuture: false`) to
  save REST calls — index futures are still recorded. Flip in `poller.js` if
  wanted.
