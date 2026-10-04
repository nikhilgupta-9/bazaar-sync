import React, { useEffect, useState } from "react";
// pages/Terms.jsx — Public Terms & Conditions page for Bazaar Sync.
// Fully responsive with native Dark/Light mode typography, SEBI Disclosures & Admin integration.

import { fetchContent } from "../services/contentApi";
import { renderMarkdown } from "../utils/markdown";
import { formatDateTime } from "../utils/format";
import PageShell from "../components/PageShell";
import { FiBookOpen, FiClock, FiAlertTriangle, FiCheckCircle, FiShield } from "react-icons/fi";

export default function Terms() {
    const [contentData, setContentData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetchContent("terms")
            .then((res) => {
                if (isMounted) setContentData(res);
            })
            .catch((err) => {
                if (isMounted) setError(err.message);
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const title = contentData?.title || "Terms & Conditions";
    const markdownBody = contentData?.content;
    const updatedAt = contentData?.updated_at;

    return (
        <PageShell>
            {/* Header Area */}
            <div className="border-b border-gray-200 pb-8 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <FiShield size={13} /> Legal Agreement
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <FiAlertTriangle size={13} /> SEBI Compliance
                    </span>
                    {updatedAt && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ml-auto">
                            <FiClock size={13} /> Last updated: {formatDateTime(updatedAt)}
                        </span>
                    )}
                </div>

                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
                    {title}
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
                    Please read these terms and conditions carefully before using the Bazaar Sync options analytics, backtesting engine, and paper trading workstation.
                </p>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-600 dark:text-rose-300">
                    Failed to load terms from server: {error}
                </div>
            )}

            {/* Loading State */}
            {loading && !contentData && (
                <div className="mt-12 text-center text-sm text-gray-400 animate-pulse">
                    Loading terms and conditions documentation…
                </div>
            )}

            {/* Empty State */}
            {contentData && !markdownBody && (
                <div className="mt-10 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                    <FiBookOpen size={28} className="mx-auto mb-2 text-gray-400" />
                    Terms & Conditions document has not been published yet.
                </div>
            )}

            {/* Rendered Markdown Body with Full Dark & Light Mode Typography */}
            {markdownBody && (
                <div className="mt-8">
                    <style>{`
                        .terms-md h1, .terms-md h2, .terms-md h3, .terms-md h4 { 
                            font-weight: 800; 
                            color: inherit; 
                            letter-spacing: -0.02em; 
                        }
                        .terms-md h1 { 
                            font-size: 1.5rem; 
                            margin: 1.6em 0 0.6em; 
                        }
                        .terms-md h2 { 
                            font-size: 1.25rem; 
                            margin: 1.5em 0 0.5em; 
                            padding-bottom: 0.3em;
                            border-bottom: 1px solid rgba(156, 163, 175, 0.2);
                        }
                        .terms-md h3 { 
                            font-size: 1.05rem; 
                            margin: 1.2em 0 0.4em; 
                        }
                        .terms-md p { 
                            margin: 0.85em 0; 
                            line-height: 1.75; 
                        }
                        .terms-md ul, .terms-md ol { 
                            margin: 0.8em 0; 
                            padding-left: 1.5em; 
                        }
                        .terms-md li { 
                            margin: 0.35em 0; 
                            line-height: 1.65; 
                        }
                        .terms-md a { 
                            color: #10b981; 
                            text-decoration: underline; 
                            text-underline-offset: 3px; 
                            font-weight: 600; 
                        }
                        .terms-md a:hover { 
                            color: #059669; 
                        }
                        .terms-md strong { 
                            font-weight: 700; 
                            color: inherit;
                        }
                        .terms-md hr { 
                            margin: 2em 0; 
                            border-color: rgba(156, 163, 175, 0.2); 
                        }
                        .terms-md blockquote { 
                            border-left: 3px solid #10b981; 
                            padding-left: 1em; 
                            color: #6b7280; 
                            margin: 1em 0; 
                            font-style: italic; 
                        }
                        .terms-md code { 
                            background: rgba(156, 163, 175, 0.15); 
                            padding: 0.15em 0.4em; 
                            border-radius: 4px; 
                            font-size: 0.85em; 
                        }
                    `}</style>
                    <div
                        className="terms-md text-sm text-gray-700 dark:text-gray-300 leading-relaxed max-w-4xl"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdownBody) }}
                    />
                </div>
            )}

            {/* SEBI Compliance Card */}
            <div className="mt-12 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 dark:bg-amber-950/20">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-bold">
                        <FiAlertTriangle size={20} />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-amber-200">
                            Regulatory Risk Warning on F&O Trading
                        </div>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            Derivatives trading is subject to severe market volatility and risk of capital loss. Bazaar Sync is strictly an analytics, algorithmic simulation, and paper trading tool and does not provide financial advice, stock tips, or guaranteed profit mechanisms.
                        </p>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
