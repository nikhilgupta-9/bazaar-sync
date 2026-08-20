// components/Footer.jsx — extracted from Home.jsx's inline footer so it can
// render on every page (like TopNav.jsx already does), not just the
// homepage. Reuses the same TOOLS catalog Home.jsx's tool grid uses (see
// data/tools.js) so the two never drift apart.
//
// No WhatsApp/Telegram/social links here — same call Home.jsx's original
// footer made: no real links exist for this app yet, so none are invented.
import { Link } from "react-router-dom";
import { TOOLS } from "../data/tools";

export default function Footer() {
    return (
        <footer className="border-t border-gray-200 bg-white px-6 py-8 text-sm text-gray-500">
            <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-8 sm:grid-cols-3">
                <div>
                    <div className="flex items-center gap-1 text-base font-bold">
                        <span className="text-blue-600">Bazaar</span>
                        <span className="text-gray-900">Sync</span>
                    </div>
                    <div className="mt-2">Made in India</div>
                    <div className="mt-1">
                        Built by{" "}
                        <a href="https://nikhilworks.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            NikhilWorks
                        </a>
                    </div>
                </div>
                <div>
                    <div className="mb-2 font-semibold text-gray-900">Tools</div>
                    <ul className="space-y-1.5">
                        {TOOLS.map((t) => (
                            <li key={t.to}>
                                <Link to={t.to} className="hover:text-blue-600">{t.title}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <div className="mb-2 font-semibold text-gray-900">More</div>
                    <ul className="space-y-1.5">
                        <li><Link to="/pricing" className="hover:text-blue-600">Pricing</Link></li>
                        <li><Link to="/events" className="hover:text-blue-600">Events</Link></li>
                        <li><Link to="/terms" className="hover:text-blue-600">Terms & Conditions</Link></li>
                        <li><Link to="/login" className="hover:text-blue-600">Log in / Sign up</Link></li>
                    </ul>
                </div>
            </div>
            <div className="mx-auto mt-8 max-w-[1400px] border-t border-gray-100 pt-4 text-xs text-gray-400">
                © {new Date().getFullYear()} Bazaar Sync. All rights reserved.
            </div>
        </footer>
    );
}
