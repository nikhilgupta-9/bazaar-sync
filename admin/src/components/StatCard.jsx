import { ResponsiveContainer, LineChart, Line } from "recharts";

const TONE_STYLES = {
    violet: { bg: "bg-violet-500/15", text: "text-violet-300", line: "#a78bfa" },
    emerald: { bg: "bg-emerald-500/15", text: "text-emerald-300", line: "#34d399" },
    amber: { bg: "bg-amber-500/15", text: "text-amber-300", line: "#fbbf24" },
    rose: { bg: "bg-rose-500/15", text: "text-rose-300", line: "#fb7185" },
};

export default function StatCard({ label, value, icon: Icon, tone = "violet", trend }) {
    const t = TONE_STYLES[tone] || TONE_STYLES.violet;
    return (
        <div className="rounded-xl border border-white/10 bg-[#101015] p-5 shadow-sm">
            <div className="flex items-center justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.bg} ${t.text}`}>
                    {Icon && <Icon className="h-5 w-5" />}
                </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</div>
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
    );
}
