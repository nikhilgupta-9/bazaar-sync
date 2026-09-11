# TradingView Charting Library — drop it here

This folder is where the **TradingView Charting Library** goes. It is **not**
committed to this repo — it's licensed software you obtain directly from
TradingView, and it is **not on npm**.

Until the library files are here, `/historical-chart` automatically falls
back to Bazaar Sync's built-in lightweight-charts chart (drawing tools +
indicators still work, just fewer of them). Nothing breaks.

## 1. Get access (one-time, done by the client)

1. Go to <https://www.tradingview.com/charting-library-docs/> → **"Get the library"**.
2. Fill in the form (name, company, use-case). Approval is usually 1–3
   business days and grants access to the private GitHub repo
   `github.com/tradingview/charting_library`.
3. You also get access to `github.com/tradingview/charting-library-examples`
   (reference integrations — not needed here, we have our own datafeed).

## 2. Install the files

From the private `charting_library` repo, copy the **contents** of its
`charting_library/` folder into **this** folder, so you end up with:

```
client/public/charting_library/
├── charting_library.standalone.js   ← the loader this app looks for
├── charting_library.esm.js
├── bundles/                         ← the rest of the library
├── datafeeds/                       ← (optional — we use our own, lib/tvDatafeed.js)
└── README.md                        ← this file
```

The only hard requirement is `charting_library.standalone.js` plus the
`bundles/` directory it loads. `components/TradingViewChart.jsx` points
`library_path` at `/charting_library/` and loads
`/charting_library/charting_library.standalone.js`.

## 3. That's it

Reload `/historical-chart`. The amber "not installed" banner disappears and
the full TradingView chart takes over — every native drawing tool, the whole
indicator library, chart types, templates, fullscreen, the lot.

Data comes from **our** `ohlcv_data` through `server/routes/tvDatafeed.js`
(the `/api/tv/*` UDF endpoints) → `client/src/lib/tvDatafeed.js`. No
TradingView data feed is used, so everything shows the backfilled NSE
history this project collects (Phase 7), not TradingView's own prices.

## Version note

Built against Charting Library v27+ (the `charting_library.standalone.js` /
`container` element API). If you get a newer major version and the widget
constructor signature has changed, the only file to touch is
`components/TradingViewChart.jsx`.

## Do NOT commit the library

Add-to-`.gitignore` is already handled for `client/public/charting_library/*`
except this README — the license does not permit redistributing the library
in a public/shared repo.
