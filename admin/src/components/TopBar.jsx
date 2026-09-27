// Per-page header, AdminLTE's "app-content-header" pattern: page title on
// the left, a Home / {title} breadcrumb on the right, descriptive subtitle
// underneath. The persistent user menu lives in AppHeader now, not here —
// this keeps the exact same {title, subtitle} prop shape every page already
// calls it with, so no page file needed to change for the reskin.
export default function TopBar({ title, subtitle }) {
    return (
        <div className="border-b border-white/10 px-3.5 sm:px-6 py-3.5 sm:py-4 bg-[#0d0d14]/80 backdrop-blur-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                <h1 className="text-base sm:text-lg font-bold text-white truncate">{title}</h1>
                <nav aria-label="breadcrumb" className="text-xs text-gray-500">
                    <span className="text-gray-600">Admin</span>
                    <span className="mx-1.5 text-gray-700">/</span>
                    <span className="text-violet-400 font-medium">{title}</span>
                </nav>
            </div>
            {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
        </div>
    );
}
