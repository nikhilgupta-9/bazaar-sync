// hooks/usePageSeo.js — applies admin-configured per-page meta tags (see
// admin/src/pages/Seo.jsx, server/controllers/seoController.js) on every
// route change. This is a client-rendered SPA with no SSR, so this sets
// document.title/<meta> tags after mount — helps JS-executing crawlers
// (Googlebot) but isn't full SSR-grade SEO. Silently no-ops (keeps
// whatever's already in index.html) when nothing's configured for a path,
// or the request fails — this is a progressive enhancement, never something
// a page depends on to render.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { fetchSeoMeta } from "../services/seoApi";

function setMetaTag(attr, key, content) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

export function usePageSeo() {
    const { pathname } = useLocation();

    useEffect(() => {
        let cancelled = false;
        fetchSeoMeta(pathname)
            .then((meta) => {
                if (cancelled) return;
                if (meta.title) document.title = meta.title;
                if (meta.description) setMetaTag("name", "description", meta.description);
                if (meta.og_image) setMetaTag("property", "og:image", meta.og_image);
            })
            .catch(() => {
                // No SEO entry for this path, or the request failed — leave
                // whatever's already there (index.html's defaults).
            });
        return () => { cancelled = true; };
    }, [pathname]);
}
