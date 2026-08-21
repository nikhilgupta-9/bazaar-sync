// components/Footer.jsx — extracted from Home.jsx's inline footer so it can
// render on every page (like TopNav.jsx already does), not just the
// homepage. Reuses the same TOOLS catalog Home.jsx's tool grid uses (see
// data/tools.js) so the two never drift apart.
//
// Layout restructured (2026-08-21) to match a stockmojo.in-style 4-column
// reference the user shared: Brand / Products / Company / Join our
// Communities, plus a bottom bar with social icons. The "Join our
// Communities" buttons and the social icon row are rendered but deliberately
// NON-LINKS (muted, "Coming soon") rather than fake WhatsApp/Telegram/social
// URLs — no real community links or social handles exist for this project
// yet (confirmed with the user 2026-08-21: build the layout now, real links
// later). Swap ComingSoonLink's disabled state for a real `href` the moment
// those links exist — nothing else about this file needs to change.
import { Link } from "react-router-dom";
import { FaWhatsapp, FaTelegram, FaXTwitter, FaYoutube, FaInstagram, FaFacebook } from "react-icons/fa6";
import { TOOLS } from "../data/tools";
import Logo from "./Logo";

const SOCIALS = [
    { key: "x", label: "X (Twitter)", Icon: FaXTwitter },
    { key: "youtube", label: "YouTube", Icon: FaYoutube },
    { key: "instagram", label: "Instagram", Icon: FaInstagram },
    { key: "telegram", label: "Telegram", Icon: FaTelegram },
    { key: "whatsapp", label: "WhatsApp", Icon: FaWhatsapp },
    { key: "facebook", label: "Facebook", Icon: FaFacebook },
];

// A community/social button with no real destination yet — rendered
// visually in place (so the footer's layout matches the reference design)
// but disabled and labeled, instead of linking to a fabricated URL.
function ComingSoonButton({ icon: Icon, label, className = "" }) {
    return (
        <span
            title={`${label} — coming soon`}
            aria-disabled="true"
            className={`inline-flex cursor-not-allowed items-center justify-center gap-2 opacity-50 ${className}`}
        >
            <Icon />
            {label}
        </span>
    );
}

// Icon-only variant for the bottom social row — same disabled/"coming soon"
// treatment, no visible label text (the icon + title tooltip is enough).
function ComingSoonIcon({ icon: Icon, label }) {
    return (
        <span title={`${label} — coming soon`} aria-disabled="true" className="cursor-not-allowed opacity-50">
            <Icon />
        </span>
    );
}

export default function Footer() {
    return (
        <footer className="border-t border-gray-200 bg-white px-6 py-8 text-sm text-gray-500">
            <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <Logo showTagline />
                    <p className="mt-3 max-w-[240px] text-gray-500">
                        Live NSE option chain analytics, a multi-leg strategy builder, and a minute-by-minute
                        historical simulator — built for Nifty, Bank Nifty, and Fin Nifty traders.
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 text-gray-400">
                        <span>🇮🇳</span>
                        <span>Made in India</span>
                    </div>
                    <div className="mt-1">
                        Built by{" "}
                        <a href="https://nikhilworks.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            NikhilWorks
                        </a>
                    </div>
                </div>
                <div>
                    <div className="mb-2 font-semibold text-gray-900">Products</div>
                    <ul className="space-y-1.5">
                        {TOOLS.map((t) => (
                            <li key={t.to}>
                                <Link to={t.to} className="hover:text-blue-600">{t.title}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <div className="mb-2 font-semibold text-gray-900">Company</div>
                    <ul className="space-y-1.5">
                        <li><Link to="/pricing" className="hover:text-blue-600">Pricing</Link></li>
                        <li><Link to="/events" className="hover:text-blue-600">Events</Link></li>
                        <li><Link to="/terms" className="hover:text-blue-600">Terms & Conditions</Link></li>
                        <li><Link to="/login" className="hover:text-blue-600">Log in / Sign up</Link></li>
                    </ul>
                </div>
                <div>
                    <div className="mb-2 font-semibold text-gray-900">Join our Communities</div>
                    <div className="flex flex-col gap-2">
                        <ComingSoonButton
                            icon={FaWhatsapp}
                            label="Join WhatsApp Community"
                            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white"
                        />
                        <ComingSoonButton
                            icon={FaTelegram}
                            label="Join Telegram Community"
                            className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white"
                        />
                    </div>
                </div>
            </div>
            <div className="mx-auto mt-8 flex max-w-[1400px] flex-col items-center gap-4 border-t border-gray-100 pt-4 text-xs text-gray-400 sm:flex-row sm:justify-between">
                <div>© {new Date().getFullYear()} Bazaar Sync. All rights reserved.</div>
                <div className="flex items-center gap-3 text-base text-gray-400">
                    {SOCIALS.map(({ key, label, Icon }) => (
                        <ComingSoonIcon key={key} icon={Icon} label={label} />
                    ))}
                </div>
            </div>
        </footer>
    );
}
