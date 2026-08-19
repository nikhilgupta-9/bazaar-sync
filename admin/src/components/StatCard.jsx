import { ResponsiveContainer, LineChart, Line } from "recharts";

// AdminLTE "small-box" style: a solid tone-colored block with a big number,
// a large faded icon in the corner, and (if given) a sparkline trend row —
// visually distinct from the neutral Card, matching the reference template's
// dashboard stat widgets.
const TONE_STYLES = {
    violet: { bg: "bg-violet-600", line: "#ede9fe" },
    emerald: { bg: "bg-emerald-600", line: "#d1fae5" },
    amber: { bg: "bg-amber-600", line: "#fef3c7" },
    rose: { bg: "bg-rose-600", line: "#ffe4e6" },
};

export default function StatCard({ label, value, icon: Icon, tone = "violet", trend }) {
    const t = TONE_STYLES[tone] || TONE_STYLES.violet;
    return (
        <div className={`relative overflow-hidden rounded-xl ${t.bg} p-5 text-white shadow-sm`}>
            {Icon && (
                <Icon
                    className="pointer-events-none absolute -bottom-3 -right-3 h-24 w-24 text-white/15"
                    aria-hidden="true"
                />
            )}
            <div className="relative">
                <div className="text-2xl font-bold tabular-nums">{value}</div>
                <div className="mt-1 text-xs font-medium text-white/80">{label}</div>
                {trend && trend.length > 1 && (
                    <div className="mt-3 h-10">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trend}>
                                <Line type="monotone" dataKey="count" stroke={t.line} strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
