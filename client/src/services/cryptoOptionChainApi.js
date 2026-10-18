// services/cryptoOptionChainApi.js
// Crypto (Delta Exchange) option chain for the Option Chain page, normalised to
// the same row shape the Indian chain uses ({ strike, iv, ce: {...}, pe: {...} })
// so the page can render both with one table.
import { computePayoutCurve } from "../utils/maxPain";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

export const CRYPTO_COINS = [
    { symbol: "BTC", name: "Bitcoin", icon: "₿" },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ" },
    { symbol: "SOL", name: "Solana", icon: "◎" },
];

const EMPTY_SIDE = { ltp: null, oi: null, volume: null, iv: null, delta: null, gamma: null, theta: null, vega: null, bid: null, ask: null };

const posOrNull = (v) => (Number(v) > 0 ? Number(v) : null);
const numOrNull = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

// Delta Exchange reports OI/volume in coin units (0.001 BTC = 1 contract) —
// convert to contract counts. Fields it didn't send stay null so the table
// shows "—" instead of a made-up value.
function mapSide(o) {
    if (!o) return { ...EMPTY_SIDE };
    const cv = Number(o.contractValue) || 1;
    const toContracts = (v) => (v == null ? null : Math.round(Number(v) / cv));
    return {
        ltp: posOrNull(o.markPrice) ?? posOrNull(o.askPrice) ?? posOrNull(o.bidPrice),
        oi: toContracts(o.oi),
        volume: toContracts(o.volume),
        iv: posOrNull(o.markIv),
        delta: numOrNull(o.delta),
        gamma: numOrNull(o.gamma),
        theta: numOrNull(o.theta),
        vega: numOrNull(o.vega),
        bid: posOrNull(o.bidPrice),
        ask: posOrNull(o.askPrice),
    };
}

export async function fetchCryptoOptionChain(coin, expiry) {
    const url = new URL(`${API_URL}/api/crypto/option-chain`);
    url.searchParams.set("underlying", coin);
    if (expiry) url.searchParams.set("expiry", expiry);
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Crypto option chain unavailable (HTTP ${res.status})`);
    const raw = await res.json();

    const expiryMeta = {};
    const expiries = (raw.expiries || []).map((e) => {
        const key = typeof e === "string" ? e : e.raw;
        expiryMeta[key] = { label: typeof e === "string" ? e : e.label || key, timeToExpiry: e.timeToExpiry || null };
        return key;
    });

    const rows = (raw.chain || [])
        .map((r) => {
            const ce = mapSide(r.call);
            const pe = mapSide(r.put);
            const ivs = [ce.iv, pe.iv].filter((v) => v != null);
            return {
                strike: Number(r.strike),
                iv: ivs.length ? Number((ivs.reduce((a, b) => a + b, 0) / ivs.length).toFixed(1)) : null,
                ce,
                pe,
            };
        })
        .sort((a, b) => a.strike - b.strike);

    const spot = posOrNull(raw.spotPrice);
    const atmStrike = spot != null && rows.length
        ? rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best)).strike
        : null;

    const totalCeOi = rows.reduce((s, r) => s + (r.ce.oi || 0), 0);
    const totalPeOi = rows.reduce((s, r) => s + (r.pe.oi || 0), 0);
    let maxPainStrike = null;
    if (totalCeOi + totalPeOi > 0) {
        const curve = computePayoutCurve(rows);
        maxPainStrike = curve.reduce((best, p) => (p.payout < best.payout ? p : best)).strike;
    }

    const changePct = numOrNull(raw.spot24hChange);
    const selectedExpiry = raw.activeExpiry?.raw || expiry || expiries[0] || null;
    return {
        market: "crypto",
        symbol: coin,
        spotPrice: spot,
        spotChangePercent: changePct,
        spotChange: spot != null && changePct != null ? (spot * changePct) / (100 + changePct) : null,
        expiries,
        expiryMeta,
        selectedExpiry,
        timeToExpiry: raw.activeExpiry?.timeToExpiry || expiryMeta[selectedExpiry]?.timeToExpiry || null,
        atmStrike,
        rows,
        pcr: totalCeOi > 0 ? Number((totalPeOi / totalCeOi).toFixed(2)) : null,
        maxPainStrike,
        timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
    };
}
