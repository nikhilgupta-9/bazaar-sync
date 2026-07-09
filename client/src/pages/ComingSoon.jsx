export default function ComingSoon({ title }) {
    return (
        <div className="mx-auto max-w-[1400px] px-4 py-16 text-center">
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-16">
                <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
                <p className="mt-2 text-sm text-gray-500">This page is on the way — Phase 2 build in progress.</p>
            </div>
        </div>
    );
}
