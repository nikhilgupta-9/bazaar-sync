export default function Card({ title, action, children, className = "", bodyClassName = "p-5" }) {
    return (
        <div className={`rounded-xl border border-white/10 bg-[#101015] shadow-sm ${className}`}>
            {(title || action) && (
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                    {title && <h2 className="text-sm font-bold text-white">{title}</h2>}
                    {action}
                </div>
            )}
            <div className={bodyClassName}>{children}</div>
        </div>
    );
}
