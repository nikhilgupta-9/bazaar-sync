// Total intrinsic-value payout to option holders if the underlying settles
// at `candidate` — same definition used server-side in
// optionChainController.js's computeMaxPain. Computed client-side here since
// the option-chain response already carries per-strike OI for every strike;
// no extra backend call needed.
export function computePayoutCurve(rows) {
    return rows.map(({ strike: candidate }) => {
        let payout = 0;
        for (const r of rows) {
            payout += (r.ce.oi || 0) * Math.max(0, candidate - r.strike);
            payout += (r.pe.oi || 0) * Math.max(0, r.strike - candidate);
        }
        return { strike: candidate, payout };
    });
}
