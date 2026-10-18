# Bazaar Sync UI Rules

One rule set for every page in `client/` (React + Tailwind v4). The tokens it
refers to are defined in `client/src/index.css`. The values were chosen from
what the app already used most (2026-10 audit), so following them mostly
means converging on the existing look, not redesigning it.

Out of scope: `admin/` (separate dark/violet app, Phase 10) and the landing
page's own scoped theme (`components/landing/theme.css`, `.landing-page`).

---

## 1. Font size

Use only these sizes. **Nothing below 10px.** No other `text-[Npx]` values.

| Role | Class | px |
|---|---|---|
| Micro label (uppercase captions, table group headers, tiny badges) | `text-micro` | 10 |
| Secondary label (sub-captions, hints, badge text, helper copy) | `text-label` | 11 |
| **Default UI text** — buttons, tabs, pills, inputs, table cells, card copy | `text-xs` | 12 |
| Body / description paragraphs on desktop, primary table cells on wide pages | `text-sm` | 14 |
| Card / section heading | `text-sm sm:text-base` | 14 → 16 |
| KPI / stat value | `text-base sm:text-lg` | 16 → 18 |
| Page title (`<h1>`/`<h2>` at top of a page) | `text-xl sm:text-2xl` | 20 → 24 |
| Hero numbers / marketing headings (landing, pricing only) | `text-3xl`+ | 30+ |

Mapping for existing off-scale values when you touch a file:

| Found | Replace with |
|---|---|
| `text-[8px]`, `text-[9px]`, `text-[9.5px]`, `text-[10px]` | `text-micro` |
| `text-[10.5px]`, `text-[11px]`, `text-[11.5px]` | `text-label` |
| `text-[12px]`, `text-[12.5px]` | `text-xs` |
| `text-[13px]` | `text-xs` (dense) or `text-sm` (readable copy) |

Descriptions under a page title: `text-xs sm:text-sm`.

## 2. Font family & weight

- **Sans (everything):** inherited from `body` (`--sans`, Inter stack). Don't add
  `font-sans` unless resetting inside a `font-mono` block.
- **Mono:** `font-mono tabular-nums` — *only* for numbers that must line up
  (prices, LTP, OI, volume, P&L, strikes in tables). Always pair the two.
  Plain numbers in prose/cards don't need mono, but should keep `tabular-nums`
  if they update live.
- **Weights:**
  - `font-normal` / `font-medium` — body copy, secondary text
  - `font-semibold` — buttons, tabs, pills, inputs, table headers
  - `font-bold` — headings, KPI values, primary numbers, active states
  - `font-extrabold` — page title only (optional)
  - `font-black` — landing/hero only. In app pages use `font-bold`.
- Uppercase micro labels: `text-micro font-bold uppercase tracking-wider text-fg-subtle`.

> Known gap: `--sans` names Inter but Inter isn't loaded (index.html only loads
> Lato/Nunito/Poppins for the landing page), so app pages render in the OS
> system font. Loading Inter is a one-line change in `index.html` — needs a
> product decision because it changes the look site-wide.

## 3. Colour

### Neutrals — `gray` only (never `slate`, `zinc`, `neutral`, `stone`)

Prefer the semantic tokens — each one already switches for dark mode, so no
`dark:` twin is needed:

| Token class | Light | Dark | Use |
|---|---|---|---|
| `bg-page` | `#f8f9fb` | `#0b1420` | page background (already on `<html>`) |
| `bg-surface` | white | `#0b1420` | cards, panels, tables |
| `bg-surface-muted` | gray-50 | `#070e17` | table headers, inset areas, footers of cards |
| `bg-surface-raised` | gray-100 | `#121c2b` | pills, inputs, segmented controls, chips |
| `bg-surface-hover` / `hover:bg-surface-hover` | gray-100 | `#18263a` | row / item hover |
| `border-line` (`divide-line`) | gray-200 | white/10 | every border & divider |
| `text-fg` | gray-900 | gray-100 | primary text, values |
| `text-fg-muted` | gray-500 | gray-400 | descriptions, secondary text |
| `text-fg-subtle` | gray-400 | gray-500 | captions, placeholders, disabled |

Never hard-code these hexes (`bg-[#0b1420]`, `dark:bg-[#121c2b]` …) in new or
edited code — use the token. Existing hex classes get swapped when a file is
brought under the rules (see §7).

### Brand & meaning

| Meaning | Light | Dark | Notes |
|---|---|---|---|
| Brand / primary action / active tab | `bg-emerald-600 text-white hover:bg-emerald-700` | same | the one primary colour |
| Brand tint (badges, selected rows) | `bg-emerald-50 text-emerald-700` | `dark:bg-emerald-950/60 dark:text-emerald-400` | |
| **Gain / up / positive P&L** | `text-up` | (auto) | = emerald-600 / emerald-400 |
| **Loss / down / negative P&L** | `text-down` | (auto) | = rose-600 / rose-400 |
| Warning, ATM, highlights, Pro | `amber-500/600`, tint `amber-50` | `dark:amber-400`, tint `amber-950/40` | |
| Info / neutral accent | `blue-600`, tint `blue-50` | `dark:blue-400` | |
| Crypto market accent | `amber-500` (active crypto pill/tab) | same | matches Option Chain / Paper Trade |
| Danger buttons (exit, delete) | `rose-600` / tint `rose-50` | `dark:rose-400` / `rose-950/40` | |
| Calls (CE) / Puts (PE) | `emerald` / `rose` | | Option Chain convention; Paper Trade still uses blue/purple — converge when touched |

Never use raw `red-*` / `green-*` for market meaning — use `text-up`/`text-down`
(or `rose`/`emerald`).

## 4. Theme (light / dark)

- Only real Tailwind shades exist: 50, 100–900 in steps of 100, and 950.
  `gray-850`, `gray-750` … compile to nothing — the element silently keeps its
  light colour in dark mode (that was the Simulator's grey tab bar). The audit
  flags these as `bad-shade`.

- Theme = `dark` class on `<html>`, toggled by `context/ThemeContext.jsx`
  (applied before first paint by the inline script in `index.html`).
  Tailwind's `dark:` variant is wired to it (`@custom-variant dark` in index.css).
- **Every coloured surface/text must work in both themes.** With tokens this is
  automatic. If you must use a palette class (`bg-white`, `text-gray-900`,
  `bg-emerald-50` …) it needs a `dark:` partner in the same `className`.
- Charts / canvas libs that can't read CSS classes: get colours from
  `useTheme().isDark` (see `PayoffChart.jsx`, `CandlestickChart.jsx`).
- Check both themes before calling a page done.

## 5. Responsive

Mobile-first; Tailwind default breakpoints (`sm` 640, `md` 768, `lg` 1024,
`xl` 1280, `2xl` 1536). Test at **390, 820, 1280, 1536** px.

1. **No horizontal page scroll — ever.** Wide content (tables with
   `min-w-[…]`) lives inside its own `overflow-x-auto` box.
2. **Page container:** `mx-auto w-full max-w-[1440px] px-3 sm:px-6 py-4 sm:py-6`
   (dense trading pages may use `max-w-[1720px]`). The `w-full` is required:
   pages sit in a flex column (`App.jsx`), and `mx-auto` without `w-full`
   shrink-wraps to the widest child — that's what made Most Active 726px wide
   on a 390px phone.
3. **Pill / tab rows:** one swipeable line on phones, wrapping from `sm`:
   row `-mx-3 flex gap-1.5 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0`,
   items `shrink-0 whitespace-nowrap`.
4. **Tables:** headers `whitespace-nowrap`; on phones prefer a card/list view
   (Most Active defaults to grid below `sm`).
5. **KPI grids:** `grid grid-cols-2 gap-3 lg:grid-cols-4` — let wide cards
   `col-span-2 sm:col-span-1` instead of cramming them into half width.
6. **Text that can be long** (symbols, names) in tight cells: `min-w-0` on the
   flex child + `truncate`.
7. **Touch targets:** interactive elements ≥ 28px tall; primary actions ≥ 36px.
8. Fixed widths (`w-[560px]`) only from `lg:` up; below that, `w-full`.

## 6. Spacing, radius, elevation

| Thing | Class |
|---|---|
| Gap between page sections | `space-y-5` (20px) |
| Card padding | `p-4` (dense tables/panels may use `p-3`) |
| Gap inside cards / between controls | `gap-2` (controls) · `gap-3` (cards in a grid) |
| Label → value inside a card | `mt-2` |
| Card radius | `rounded-xl`; large page panels `rounded-2xl`; pills/buttons `rounded-lg`/`rounded-xl` |
| Card border + shadow | `border border-line shadow-xs` |
| Table cell padding | `px-4 py-3` (dense: `px-2 py-1.5`) |

Keep the same value for the same role across a page — uneven gaps are almost
always two different spacing classes doing the same job.

## 7. Bringing an existing page under the rules

1. Run the audit: `node .claude/skills/bazaar-ui/scripts/audit-ui.mjs client/src/pages/X.jsx`.
2. Fix in this order: horizontal overflow → dark-mode gaps → off-scale font
   sizes → colour family/hex → weights → spacing.
3. Swap hex/`dark:` pairs for tokens only where it's a 1:1 match (table in §3).
   Don't restyle things that already look right.
4. Build (`cd client && npx vite build`) and lint the touched files.
5. Screenshot at 390 / 820 / 1536 in light **and** dark.
6. Re-run the audit; remaining findings must each have a reason.
