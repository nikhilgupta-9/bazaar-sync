// Per-page header, AdminLTE's "app-content-header" pattern: page title on
// the left, a Home / {title} breadcrumb on the right, descriptive subtitle
// underneath. The persistent user menu lives in AppHeader now, not here —
// this keeps the exact same {title, subtitle} prop shape every page already
// calls it with, so no page file needed to change for the reskin.
export default function TopBar({ title, subtitle }) {
    return (
        <div className="border-b border-white/10 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-lg font-bold text-white">{title}</h1>
                <nav aria-label="breadcrumb" className="text-xs text-gray-500">
                    <span className="text-gray-600">Home</span>
                    <span className="mx-1.5 text-gray-700">/</span>
                    <span className="text-gray-400">{title}</span>
                </nav>
            </div>
            {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
        </div>
    );
}
