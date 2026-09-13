// components/PageShell.jsx — the standard width/padding for simple,
// single-column content pages (Terms, Events, the Equity Data placeholders,
// and the still-to-build About Us / Contact Us / Plans pages — see
// CLAUDE.md's "5 new static pages" note under Phase 8). Before this, Terms/
// Events/EquityData each hardcoded their own identical `mx-auto max-w-3xl
// px-6 py-12` wrapper — 768px, which reads narrow/cramped on a large
// monitor once you compare it to the option-chain/strategy-builder-style
// tool pages elsewhere in the app (those legitimately need 1400-1600px for
// dense tables and are left alone here; this component is only for prose/
// simple-content pages). One shared component means any future content
// page gets the same width for free instead of picking its own.
export default function PageShell({ children, className = "" }) {
    return (
        <div className={`mx-auto w-full max-w-5xl px-6 py-12 sm:py-16 ${className}`}>
            {children}
        </div>
    );
}
