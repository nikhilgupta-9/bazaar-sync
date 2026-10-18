---
name: bazaar-ui
description: Bazaar Sync's UI design system — font size scale, font family/weights, colour tokens, light/dark theme and responsive rules for every page in client/. Use whenever building a new page or component in client/, restyling or "fixing the UI/spacing/fonts/colours" of an existing page, making a page mobile responsive or dark-mode correct, or auditing a page for design consistency. Not for admin/ (separate app) or the landing page's scoped theme.
---

# Bazaar Sync UI system

The rules are in [rules.md](rules.md). The tokens they use (`bg-surface`,
`text-fg-muted`, `border-line`, `text-up`/`text-down`, `text-micro`,
`text-label` …) are defined in `client/src/index.css` and switch with the
theme automatically.

## When building something new

1. Read [rules.md](rules.md) §1–6 before writing classes.
2. Use tokens for neutrals/surfaces/borders/up-down; palette classes only for
   brand and meaning colours, each with a `dark:` partner.
3. Only the type scale in §1 — no `text-[Npx]`.
4. Lay out mobile-first and follow §5 (page container with `w-full`,
   swipeable pill rows, tables in their own `overflow-x-auto`).

## When bringing an existing page under the rules

1. **Audit** — from the repo root:
   ```bash
   node .claude/skills/bazaar-ui/scripts/audit-ui.mjs client/src/pages/<Page>.jsx
   # whole app overview:
   node .claude/skills/bazaar-ui/scripts/audit-ui.mjs --summary client/src
   ```
2. **Screenshot first** at 390 / 820 / 1536 px (light + dark) so you can see
   what's actually wrong — overflow and uneven gaps don't show up in the audit.
   In this repo, headless Chrome + CDP works (`/Applications/Google Chrome.app`);
   a phone emulation needs `mobile: true` in `Emulation.setDeviceMetricsOverride`.
   Measure `document.documentElement.scrollWidth` — it must equal the viewport.
3. **Fix in the order of rules.md §7**: horizontal overflow → dark-mode gaps →
   font sizes → colours → weights → spacing. Keep changes 1:1 (same look,
   on-scale class); don't redesign parts that already follow the rules.
4. **Verify**: `cd client && npx vite build`, `npx eslint <touched files>`,
   re-screenshot, re-run the audit. Report what's left and why.

## Guardrails

- One page per pass; pages here are 1–3k lines. Shared components
  (`components/`) affect many pages — screenshot a couple of their users.
- Keep behaviour untouched: this skill changes classes, not logic.
- If a rule doesn't fit a real case, don't force it — note it and propose a
  rules.md change instead of inventing a one-off value.
- `admin/` and `components/landing/` + `pages/Home.jsx` are exempt (the audit
  skips them).
