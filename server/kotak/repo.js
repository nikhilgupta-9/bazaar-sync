// kotak/repo.js — persist Kotak Neo snapshots into the EXISTING tables.
//
// No new tables (CLAUDE.md convention + explicit instruction):
//   - option chain   -> option_chain_history  (same columns / upsert shape
//                        as services/cron.js's storeOptionChainMinutes)
//   - spot index     -> ohlcv_data  symbol = "NIFTY" / "BANKNIFTY" / ...
//   - India VIX      -> ohlcv_data  symbol = "INDIAVIX"     (cfg.vixOhlcvSymbol)
//   - nearest future -> ohlcv_data  symbol = "NIFTYFUT" / ... (cfg.futureOhlcvSymbol)
//
// trade_time is snapped to the current minute (HH:MM:00). At a few-seconds
// poll cadence every poll within a minute UPSERTs the SAME row (last write
// wins) instead of spraying dozens of rows/minute — matching the live
// worker's "one row per minute" philosophy and keeping the table clean for
// the Simulator / backtest engine that read it.

const { pool } = require("../config/db");
const cfg = require("../config/kotak");

// IST wall-clock parts, minute-snapped. Explicit UTC arithmetic — no
// local-timezone Date methods (CLAUDE.md Gotcha #12).
function istMinuteParts(d = new Date()) {
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const date = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
    const time = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}:00`;
    return { date, time };
}

function firstFinite(...vals) {
    for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
}

// ---------------------------------------------------------------------------
// option_chain_history
// ---------------------------------------------------------------------------

async function saveChainSnapshot(chain) {
    const { date, time } = istMinuteParts(chain.snapshotAt);
    const values = chain.rows.map((r) => {
        const ce = r.ce || {};
        const pe = r.pe || {};
        return [
            chain.underlying, date, time, chain.expiry, r.strike, chain.spot,
            firstFinite(ce.ltp), firstFinite(ce.oi), firstFinite(ce.volume),
            firstFinite(ce.iv), firstFinite(ce.delta), firstFinite(ce.gamma), firstFinite(ce.theta), firstFinite(ce.vega),
            firstFinite(pe.ltp), firstFinite(pe.oi), firstFinite(pe.volume),
            firstFinite(pe.iv), firstFinite(pe.delta), firstFinite(pe.gamma), firstFinite(pe.theta), firstFinite(pe.vega),
        ];
    });
    if (!values.length) return 0;

    await pool.query(
        `INSERT INTO option_chain_history (
           symbol, trade_date, trade_time, expiry, strike, underlying_price,
           ce_ltp, ce_oi, ce_volume, ce_iv, ce_delta, ce_gamma, ce_theta, ce_vega,
           pe_ltp, pe_oi, pe_volume, pe_iv, pe_delta, pe_gamma, pe_theta, pe_vega
         ) VALUES ?
         ON DUPLICATE KEY UPDATE
           underlying_price=VALUES(underlying_price),
           ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_volume=VALUES(ce_volume),
           ce_iv=VALUES(ce_iv), ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
           pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_volume=VALUES(pe_volume),
           pe_iv=VALUES(pe_iv), pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)`,
        [values]
    );
    return values.length;
}

// ---------------------------------------------------------------------------
// ohlcv_data  (spot / VIX / futures — one row per minute per symbol)
// ---------------------------------------------------------------------------

async function saveOhlcvPoint(symbol, quote, at = new Date()) {
    if (!quote || !(quote.ltp > 0)) return;
    const { date, time } = istMinuteParts(at);
    const ltp = quote.ltp;
    await pool.query(
        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           open=COALESCE(open, VALUES(open)),
           high=GREATEST(COALESCE(high, VALUES(high)), VALUES(high)),
           low=LEAST(COALESCE(low, VALUES(low)), VALUES(low)),
           close=VALUES(close),
           volume=VALUES(volume)`,
        [
            symbol, date, time,
            firstFinite(quote.open, ltp),
            firstFinite(quote.high, ltp),
            firstFinite(quote.low, ltp),
            ltp,
            firstFinite(quote.volume),
        ]
    );
}

const saveSpot = (underlying, quote, at) => saveOhlcvPoint(underlying.toUpperCase(), quote, at);
const saveVix = (quote, at) => saveOhlcvPoint(cfg.vixOhlcvSymbol, quote, at);
const saveFuture = (underlying, quote, at) =>
    saveOhlcvPoint(cfg.futureOhlcvSymbol(underlying.toUpperCase()), quote, at);

module.exports = { saveChainSnapshot, saveSpot, saveVix, saveFuture, istMinuteParts };
