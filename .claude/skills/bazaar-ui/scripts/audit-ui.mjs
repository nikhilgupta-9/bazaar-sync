#!/usr/bin/env node
// Bazaar Sync UI audit — flags code that breaks .claude/skills/bazaar-ui/rules.md.
//
//   node .claude/skills/bazaar-ui/scripts/audit-ui.mjs <file|dir> [...]   per-line findings
//   node .claude/skills/bazaar-ui/scripts/audit-ui.mjs --summary <dir>   counts per file
//
// It is a heuristic linter over className strings, not a parser: treat each
// finding as "look here", and leave a reason when a finding is intentional.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const args = process.argv.slice(2);
const summary = args.includes("--summary");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) {
    console.error("usage: audit-ui.mjs [--summary] <file|dir> [...]");
    process.exit(1);
}

// Files that legitimately use their own scale/palette (rules.md "Out of scope").
const EXEMPT = [/components\/landing\//, /pages\/Home\.jsx$/, /\.test\.jsx?$/];

const SIZE_MAP = {
    "8px": "text-micro", "9px": "text-micro", "9.5px": "text-micro", "10px": "text-micro",
    "10.5px": "text-label", "11px": "text-label", "11.5px": "text-label",
    "12px": "text-xs", "12.5px": "text-xs", "13px": "text-xs or text-sm",
};
const TOKEN_HEX = {
    "#0b1420": "bg-surface / bg-page (dark)", "#070e17": "bg-surface-muted (dark)",
    "#121c2b": "bg-surface-raised (dark)", "#18263a": "bg-surface-hover (dark)",
    "#f8f9fb": "bg-page",
};

const RULES = [
    {
        id: "font-size",
        test: (cls) => [...cls.matchAll(/(?:^|[\s:])text-\[(\d+(?:\.\d+)?px)\]/g)].map((m) => {
            const px = m[1];
            const below = parseFloat(px) < 10;
            return `text-[${px}]${below ? " is below the 10px floor" : " is off-scale"} → ${SIZE_MAP[px] || "use the type scale (§1)"}`;
        }),
    },
    {
        id: "gray-family",
        test: (cls) => [...cls.matchAll(/\b(?:text|bg|border|divide|ring|from|to|via)-(slate|zinc|neutral|stone)-\d+/g)]
            .map((m) => `${m[0]} → use gray / a token (§3)`),
    },
    {
        id: "raw-red-green",
        test: (cls) => [...cls.matchAll(/\b(?:text|bg|border)-(red|green)-\d+/g)]
            .map((m) => `${m[0]} → text-up / text-down or emerald / rose (§3)`),
    },
    {
        id: "hex-colour",
        test: (cls) => [...cls.matchAll(/\b(?:bg|text|border|from|to|via|ring)-\[(#[0-9a-fA-F]{3,8})\]/g)].map((m) => {
            const hint = TOKEN_HEX[m[1].toLowerCase()];
            return `${m[0]} → ${hint || "use a token or palette class (§3)"}`;
        }),
    },
    {
        // e.g. dark:bg-gray-850 — Tailwind has no such shade, so the class silently does nothing
        id: "bad-shade",
        test: (cls) => [...cls.matchAll(/\b(?:[a-z]+:)*(?:bg|text|border|divide|ring|from|to|via|fill|stroke)-[a-z]+-(\d{2,3})\b/g)]
            .filter((m) => !["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].includes(m[1]))
            .map((m) => `${m[0]} is not a Tailwind colour shade — it renders nothing (§3/§4)`),
    },
    {
        id: "weight",
        test: (cls) => (/\bfont-black\b/.test(cls) ? ["font-black → font-bold in app pages (§2)"] : []),
    },
    {
        id: "mono-tabular",
        test: (cls) => (/\bfont-mono\b/.test(cls) && !/\btabular-nums\b/.test(cls) ? ["font-mono without tabular-nums (§2)"] : []),
    },
    {
        id: "dark-missing",
        test: (cls) => {
            const out = [];
            const pairs = [
                [/(?:^|\s)bg-white(?:\/\d+)?(?=\s|$)/, /\bdark:bg-/, "bg-white"],
                [/(?:^|\s)text-gray-(?:800|900)(?=\s|$)/, /\bdark:text-/, "text-gray-900"],
                [/(?:^|\s)border-gray-(?:100|200|300)(?=\s|$)/, /\bdark:border-/, "border-gray-200"],
            ];
            for (const [has, needs, label] of pairs) {
                if (has.test(cls) && !needs.test(cls)) out.push(`${label} with no dark: partner → token or add dark: (§4)`);
            }
            return out;
        },
    },
    {
        id: "fixed-width",
        test: (cls) => [...cls.matchAll(/(?:^|\s)(?<!:)w-\[(\d+)px\]/g)]
            .filter((m) => Number(m[1]) > 400)
            .map((m) => `${m[0].trim()} applies on phones → prefix with lg: and use w-full below (§5)`),
    },
];

// className="..." / className={`...`} / class strings inside clsx-ish calls
const CLASS_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g;

function walk(p, out) {
    const st = statSync(p);
    if (st.isDirectory()) {
        for (const f of readdirSync(p)) {
            if (f === "node_modules" || f.startsWith(".")) continue;
            walk(join(p, f), out);
        }
    } else if ([".jsx", ".tsx"].includes(extname(p))) {
        out.push(p);
    }
}

const files = [];
for (const t of targets) walk(t, files);

const totals = {};
let grand = 0;
for (const file of files) {
    const rel = relative(process.cwd(), file);
    if (EXEMPT.some((re) => re.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const findings = [];
    lines.forEach((line, i) => {
        for (const m of line.matchAll(CLASS_RE)) {
            const cls = m[1] ?? m[2] ?? m[3] ?? "";
            for (const rule of RULES) {
                for (const msg of rule.test(cls)) findings.push({ line: i + 1, id: rule.id, msg });
            }
        }
    });
    if (!findings.length) continue;
    grand += findings.length;
    if (summary) {
        const byRule = {};
        for (const f of findings) byRule[f.id] = (byRule[f.id] || 0) + 1;
        totals[rel] = byRule;
    } else {
        console.log(`\n${rel}  (${findings.length})`);
        for (const f of findings) console.log(`  ${rel}:${f.line}  [${f.id}]  ${f.msg}`);
    }
}

if (summary) {
    const ids = RULES.map((r) => r.id);
    const rows = Object.entries(totals).sort((a, b) => sum(b[1]) - sum(a[1]));
    console.log(["file", ...ids, "total"].join("\t"));
    for (const [f, byRule] of rows) console.log([f, ...ids.map((id) => byRule[id] || 0), sum(byRule)].join("\t"));
}
console.log(`\n${grand} finding(s) in ${files.length} file(s) scanned.`);

function sum(o) {
    return Object.values(o).reduce((a, b) => a + b, 0);
}
