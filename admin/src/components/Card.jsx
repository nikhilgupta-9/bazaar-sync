export default function Card({ title, action, children, className = "" }) {
    return (
        <div className={`rounded-xl border border-white/10 bg-[#101015] p-5 shadow-sm ${className}`}>
            {(title || action) && (
                <div className="mb-4 flex items-center justify-between">
                    {title && <h2 className="text-sm font-bold text-white">{title}</h2>}
                    {action}
                </div>
            )}
            {children}
        </div>
    );
}
