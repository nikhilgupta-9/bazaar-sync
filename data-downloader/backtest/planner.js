// backtest/planner.js — decides WHICH contracts to download for one
// (symbol, month), before a single Breeze call is made.
//
// Why a planner at all: the full chain is not downloadable. NIFTY alone had
// ~850 listed option contracts on 2023-01-02 (1,714 bhavcopy CE/PE rows);
// at 2 Breeze calls per contract per 2 trading days against a 5,000/day cap,
// the full 2023→now chain would take years of daily runs. A backtest only
// ever touches strikes near the money on near expiries, so that's what is
// fetched — bounded, env-tunable:
//
//   BT_NEAR_EXPIRIES          nearest N listed expiries each day (default 2)
//   BT_INCLUDE_MONTHLY        also the current monthly if not already in (default 1)
//   BT_INDEX_STRIKES_EACH_SIDE strikes below the day's low / above the day's high (default 10)
//   BT_STOCK_STRIKES_EACH_SIDE same for stocks (default 5)
//   BT_FUTURE_EXPIRIES        nearest N futures (near + next, for rollover) (default 2)
//
// The strike window per day is [ATM(day low) − N, ATM(day high) + N] over
// that expiry's actually-listed strikes, so intraday moves stay covered.
// Day low/high come from Breeze minute spot; if spot is missing, ATM is the
// strike with the smallest |CE − PE| close on the nearest expiry (put-call
// parity, from the in-memory bhavcopy) — no Breeze call needed.

const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"]);

const cfg = () => ({
    nearExpiries: Number(process.env.BT_NEAR_EXPIRIES || 2),
    includeMonthly: process.env.BT_INCLUDE_MONTHLY !== "0",
    indexStrikes: Number(process.env.BT_INDEX_STRIKES_EACH_SIDE || 10),
    stockStrikes: Number(process.env.BT_STOCK_STRIKES_EACH_SIDE || 5),
    futureExpiries: Number(process.env.BT_FUTURE_EXPIRIES || 2),
});

/** Split a sorted list of trading days into windows of ≤ size trading days: [[from, to], ...]. */
function chunkTradingDays(days, size = 2) {
    const out = [];
    for (let i = 0; i < days.length; i += size) {
        const slice = days.slice(i, i + size);
        out.push([slice[0], slice[slice.length - 1]]);
    }
    return out;
}

/** Group a contract's selected days into runs of consecutive trading days. */
function toRuns(selectedDays, dayIndex) {
    const sorted = [...selectedDays].sort();
    const runs = [];
    let cur = null;
    for (const d of sorted) {
        const idx = dayIndex.get(d);
        if (cur && idx === cur.lastIdx + 1) {
            cur.days.push(d);
            cur.lastIdx = idx;
        } else {
            cur = { days: [d], lastIdx: idx };
            runs.push(cur);
        }
    }
    return runs.map((r) => r.days);
}

function parityAtm(rows, expiry) {
    const ce = new Map(), pe = new Map();
    for (const r of rows) {
        if (r.expiry !== expiry || !(r.close > 0)) continue;
        (r.right === "CE" ? ce : pe).set(r.strike, r.close);
    }
    let best = null, bestDiff = Infinity;
    for (const [k, c] of ce) {
        const p = pe.get(k);
        if (p == null) continue;
        const diff = Math.abs(c - p);
        if (diff < bestDiff) { bestDiff = diff; best = k; }
    }
    return best;
}

function nearestIdx(sortedStrikes, price) {
    let best = 0;
    for (let i = 1; i < sortedStrikes.length; i++) {
        if (Math.abs(sortedStrikes[i] - price) < Math.abs(sortedStrikes[best] - price)) best = i;
    }
    return best;
}

/** Expiries to fetch on one day: nearest N + (optionally) the current monthly. */
function pickExpiries(listed, n, includeMonthly) {
    const picked = listed.slice(0, n);
    if (includeMonthly && listed.length) {
        // Monthly = last listed expiry in the nearest expiry's calendar month.
        const ym = listed[0].slice(0, 7);
        const monthly = listed.filter((e) => e.slice(0, 7) === ym).pop();
        if (monthly && !picked.includes(monthly)) picked.push(monthly);
    }
    return picked;
}

/**
 * @param symbol
 * @param tradingDays sorted 'YYYY-MM-DD' days of the month that have a bhavcopy
 * @param dayData Map<date, {options: Map, futures: Map}> from bhavcopyDay.loadDay
 * @param spotByDate Map<date, {low, high, close}> (may be empty)
 * @returns {{ optionRuns, futureRuns, estCalls, atmSource }}
 */
function planMonth(symbol, tradingDays, dayData, spotByDate) {
    const c = cfg();
    const strikesEachSide = INDEX_SYMBOLS.has(symbol) ? c.indexStrikes : c.stockStrikes;
    const dayIndex = new Map(tradingDays.map((d, i) => [d, i]));

    const optionDays = new Map(); // 'expiry|strike' -> Set<date>
    const futureDays = new Map(); // expiry -> Set<date>
    const atmSource = { spot: 0, parity: 0, none: 0 };

    for (const d of tradingDays) {
        const day = dayData.get(d);
        if (!day) continue;

        const rows = (day.options.get(symbol) || []).filter((r) => r.expiry >= d);
        if (rows.length) {
            const listed = [...new Set(rows.map((r) => r.expiry))].sort();
            const expiries = pickExpiries(listed, c.nearExpiries, c.includeMonthly);

            let lo, hi;
            const spot = spotByDate.get(d);
            if (spot && Number.isFinite(spot.low) && Number.isFinite(spot.high)) {
                lo = spot.low; hi = spot.high; atmSource.spot += 1;
            } else {
                const atm = parityAtm(rows, listed[0]);
                if (atm != null) { lo = hi = atm; atmSource.parity += 1; } else { atmSource.none += 1; }
            }

            if (lo != null) {
                for (const expiry of expiries) {
                    const strikes = [...new Set(rows.filter((r) => r.expiry === expiry).map((r) => r.strike))].sort((a, b) => a - b);
                    if (!strikes.length) continue;
                    const from = Math.max(0, nearestIdx(strikes, lo) - strikesEachSide);
                    const to = Math.min(strikes.length - 1, nearestIdx(strikes, hi) + strikesEachSide);
                    for (let i = from; i <= to; i++) {
                        const key = `${expiry}|${strikes[i]}`;
                        if (!optionDays.has(key)) optionDays.set(key, new Set());
                        optionDays.get(key).add(d);
                    }
                }
            }
        }

        const futs = (day.futures.get(symbol) || []).filter((r) => r.expiry >= d);
        const futExpiries = [...new Set(futs.map((r) => r.expiry))].sort().slice(0, c.futureExpiries);
        for (const e of futExpiries) {
            if (!futureDays.has(e)) futureDays.set(e, new Set());
            futureDays.get(e).add(d);
        }
    }

    const optionRuns = [];
    for (const [key, days] of optionDays) {
        const [expiry, strike] = key.split("|");
        for (const runDays of toRuns(days, dayIndex)) {
            optionRuns.push({ expiry, strike: Number(strike), days: runDays, chunks: chunkTradingDays(runDays) });
        }
    }
    optionRuns.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.days[0].localeCompare(b.days[0]));

    const futureRuns = [];
    for (const [expiry, days] of futureDays) {
        for (const runDays of toRuns(days, dayIndex)) {
            futureRuns.push({ expiry, days: runDays, chunks: chunkTradingDays(runDays) });
        }
    }
    futureRuns.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.days[0].localeCompare(b.days[0]));

    const estCalls = {
        spot: chunkTradingDays(tradingDays).length,
        options: optionRuns.reduce((s, r) => s + 2 * r.chunks.length, 0), // CE + PE
        futures: futureRuns.reduce((s, r) => s + r.chunks.length, 0),
    };
    return { optionRuns, futureRuns, estCalls, atmSource };
}

module.exports = { planMonth, chunkTradingDays, INDEX_SYMBOLS };
