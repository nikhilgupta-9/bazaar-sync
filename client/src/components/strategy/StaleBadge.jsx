// components/strategy/StaleBadge.jsx
//
// The amber ⚠ shown right after an option-chain value (LTP / OI / Δ) when the
// value on screen is NOT fresh — it's the last one we received, carried
// forward. Two situations produce this, both routed through here so the cue
// looks identical:
//   - Strategy Builder (live): the socket feed has stopped ticking this
//     specific contract (illiquid strike, or one that drifted outside the
//     worker's ±15-strike window) while the rest of the feed is still live.
//     Staleness decided by hooks/useOptionChain.js's `contractStaleness`.
//   - Simulator (historical): scrubbing to a minute that has no stored row
//     for this strike/field — Simulator carries the last good value forward
//     instead of showing a blank gap.
import { FiAlertTriangle } from "react-icons/fi";

const DEFAULT_LABEL =
    "not updating — showing the last value received (illiquid strike or outside the live window)";

export default function StaleBadge({ stale, ageMs, label = DEFAULT_LABEL }) {
    if (!stale) return null;
    const secs =
        ageMs != null && Number.isFinite(ageMs) && ageMs >= 0
            ? Math.round(ageMs / 1000)
            : null;
    return (
        <FiAlertTriangle
            className="ml-0.5 inline-block shrink-0 align-[-1px] text-amber-500"
            size={11}
            title={secs != null ? `Last update ${secs}s ago — ${label}` : `Stale — ${label}`}
            aria-label="stale data"
        />
    );
}
