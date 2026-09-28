import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchSimulatorDates,
  fetchSimulatorChain,
  runSimulatorReplay,
} from "../services/simulatorApi";
import { fetchSymbolList } from "../services/optionChainApi";
import { saveStrategy } from "../services/strategiesApi";
import SaveButton from "../components/SaveButton";
import SavedStrategiesModal from "../components/SavedStrategiesModal";
import ContractChartModal from "../components/ContractChartModal";
import { SymbolLogo, getSymbolMeta } from "../utils/symbolIcons";
import { formatPrice } from "../utils/format";
import {
  computePayoffCurve,
  computeBreakevens,
  computeMaxProfitLoss,
  computeRiskRewardRatio,
  computeNetGreeks,
  addMarkToMarketCurve,
  computeExpectedMove,
  computePOP,
  computeEstMargin,
  computeMarginDetails,
  evaluationExpiryOf,
  legMultiplier,
  otherAction,
} from "../utils/payoff";
import { yearsToExpiry } from "../utils/blackScholes";
import OiBar from "../components/OiBar";
import StaleBadge from "../components/strategy/StaleBadge";
import SlTgModal from "../components/strategy/SlTgModal";
import SquareOffAlertBanner from "../components/strategy/SquareOffAlertBanner";
import PortfolioGreeksTable from "../components/strategy/PortfolioGreeksTable";
import PayoffChart from "../components/PayoffChart";
import PresetStrategies from "../components/PresetStrategies";
import CandlestickChart from "../components/CandlestickChart";
import StrategyChart from "../components/StrategyChart";
import { SlCalender } from "react-icons/sl";
import { FiSettings, FiTrash2, FiRefreshCw, FiArchive, FiChevronLeft, FiChevronRight, FiChevronsLeft, FiChevronsRight } from "react-icons/fi";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Wall-clock playback speed, split into two independent controls like the
// stockmojo reference: "Move" (how many stored per-minute samples advance
// per tick) and "Every" (real-world interval between ticks). "1 day" isn't
// offered as a Move step — the replay series is scoped to ONE historical
// day (see simulatorController.js's replay endpoint), so there's nowhere
// for a day-sized step to land; offering it would either silently do
// nothing or require reinterpreting it as something else, neither of which
// is honest about what Autoplay actually does here.
const MOVE_OPTIONS = [
  { key: "1m", label: "1 min", stepPerTick: 1 },
  { key: "5m", label: "5 min", stepPerTick: 5 },
  { key: "15m", label: "15 min", stepPerTick: 15 },
  { key: "1h", label: "1 hr", stepPerTick: 60 },
];
const EVERY_OPTIONS = [
  { key: "1s", label: "1 sec", tickMs: 1000 },
  { key: "3s", label: "3 sec", tickMs: 3000 },
  { key: "5s", label: "5 sec", tickMs: 5000 },
];

const CHART_TABS = [
  ["payoff", "Payoff"],
  ["strategy", "Strategy Chart"],
  ["nifty", "NIFTY Chart"],
  ["combined", "Strategy Chart + NIFTY Chart"],
];

let legIdCounter = 0;

const DEFAULT_FAVORITES = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const FAVORITES_KEY = "bazaarSync.simulator.favoriteSymbols";

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_FAVORITES;
  } catch {
    return DEFAULT_FAVORITES;
  }
}

// Positions the user has placed (buy/sell legs) survive expiry/time/DATE
// navigation within Simulator AND leaving the page entirely (switching to
// another route, or reloading) — persisted per symbol so switching symbols
// still starts fresh for that symbol, matching favoriteSymbols' localStorage
// convention above. A position stays OPEN as you move between dates (same
// model Strategy Builder uses for symbol/expiry navigation — reprice
// against whatever's loaded, never auto-clear); see selectDate's 2026-09-13
// comment for why this replaced an earlier "archive + clear on date change"
// design. "Reset Workspace" (explicit) discards outright; "Archive" (also
// explicit, see archiveCurrentPosition) snapshots into Upcoming Positions
// and clears — nothing happens to `legs` on navigation by itself anymore.
const SIM_LEGS_KEY_PREFIX = "bazaarSync.simulator.legs.";

function loadSavedLegs(sym) {
  try {
    const raw = localStorage.getItem(SIM_LEGS_KEY_PREFIX + sym);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    // Keep legIdCounter past any restored id so newly-added legs never
    // collide with a restored one.
    const maxId = parsed.reduce((m, l) => Math.max(m, l.id || 0), 0);
    if (maxId >= legIdCounter) legIdCounter = maxId + 1;
    return parsed;
  } catch {
    return [];
  }
}

function saveLegs(sym, legsToSave) {
  try {
    if (legsToSave.length) {
      localStorage.setItem(SIM_LEGS_KEY_PREFIX + sym, JSON.stringify(legsToSave));
    } else {
      localStorage.removeItem(SIM_LEGS_KEY_PREFIX + sym);
    }
  } catch {
    // localStorage unavailable — positions just won't survive navigation this session
  }
}

// "Upcoming Positions" — a read-only journal of legs the user explicitly
// archived (via archiveCurrentPosition, the "Archive" button) rather than a
// live position. Was previously populated automatically on every date
// change (see selectDate's 2026-09-13 comment for why that changed — a
// position now stays open across date navigation instead). Each entry is a
// snapshot, not a live position: nothing here is re-priced or editable,
// it's just a record of "this is what was built, for this date" — same
// "gap, not a guess" honesty convention the rest of this app uses, rather
// than pretending a snapshot from one day is still tradeable state on
// another. Persisted per symbol, same pattern as legs above.
const SIM_UPCOMING_KEY_PREFIX = "bazaarSync.simulator.upcoming.";
let upcomingIdCounter = 0;

function loadUpcomingPositions(sym) {
  try {
    const raw = localStorage.getItem(SIM_UPCOMING_KEY_PREFIX + sym);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    const maxId = parsed.reduce((m, e) => Math.max(m, e.id || 0), 0);
    if (maxId >= upcomingIdCounter) upcomingIdCounter = maxId + 1;
    return parsed;
  } catch {
    return [];
  }
}

function saveUpcomingPositions(sym, entries) {
  try {
    if (entries.length) {
      localStorage.setItem(SIM_UPCOMING_KEY_PREFIX + sym, JSON.stringify(entries));
    } else {
      localStorage.removeItem(SIM_UPCOMING_KEY_PREFIX + sym);
    }
  } catch {
    // localStorage unavailable — the journal just won't survive navigation this session
  }
}

// Same searchable-dropdown row as Strategy Builder's symbol picker (star
// toggles favorites, which the pill's chevrons cycle through) — kept as its
// own local copy rather than a shared import since each page owns its own
// symbol-picker state independently (see StrategyBuilder.jsx for the sibling).
function SymbolOption({ sym, active, isFav, onPick, onToggleFav }) {
  const meta = getSymbolMeta(sym);
  return (
    <div
      onClick={() => onPick(sym)}
      className={`flex items-center justify-between px-3 py-2 cursor-pointer transition rounded-lg mx-1 my-0.5 ${
        active
          ? "bg-emerald-50/80 text-emerald-900 font-bold dark:bg-emerald-950/50 dark:text-emerald-300"
          : "hover:bg-gray-50 text-gray-800 dark:text-gray-200 dark:hover:bg-gray-800/60"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <SymbolLogo symbol={sym} size="sm" />
        <div className="truncate">
          <div className="text-xs font-bold leading-tight">{sym}</div>
          <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{meta.name || sym}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(sym);
        }}
        className={`px-1.5 py-0.5 text-xs transition ${
          isFav ? "text-amber-500 hover:text-amber-600 scale-110" : "text-gray-300 hover:text-gray-400 dark:text-gray-600"
        }`}
        title={isFav ? "Remove from favorites" : "Add to favorites"}
      >
        ★
      </button>
    </div>
  );
}

// Option-chain column toggles — same idea as StrategyBuilder.jsx's
// DEFAULT_COLUMNS. Defaults match the table's original fixed layout (Call/Put
// Delta + LTP + OI each side); Greeks/IV start hidden. All fields are already
// returned per-strike by simulatorController.js's /chain endpoint.
const DEFAULT_COLUMNS = {
  oi: true, callDelta: true, putDelta: true, iv: false,
  theta: false, vega: false, gamma: false,
};

function formatDelta(value) {
  return value == null || Number.isNaN(value) ? "-" : Number(value).toFixed(2);
}

// --- Historical carry-forward -------------------------------------------
// option_chain_history stores one row per (strike, minute) only when that
// contract actually printed that minute. Scrubbing to a minute where a
// strike (or one of its fields) has no stored row previously showed a blank
// "-" gap. Instead we now carry the last value seen earlier in this
// session forward and flag it with an amber ⚠ (StaleBadge) — "this contract
// stopped printing, here's its last known price", the same cue the live
// Strategy Builder uses for a strike that stopped ticking.
const CARRY_FIELDS = ["ltp", "oi", "oiChange", "iv", "volume", "delta", "gamma", "theta", "vega"];

// Fold a fresh snapshot's real (non-null) values into the running
// last-good map (strike -> { ce:{field:value}, pe:{...} }). Mutates `lastGood`.
function absorbLastGood(lastGood, rows) {
  for (const r of rows || []) {
    let entry = lastGood.get(r.strike);
    if (!entry) {
      entry = { ce: {}, pe: {} };
      lastGood.set(r.strike, entry);
    }
    for (const side of ["ce", "pe"]) {
      const s = r[side];
      if (!s) continue;
      for (const f of CARRY_FIELDS) {
        if (s[f] != null) entry[side][f] = s[f];
      }
    }
  }
}

// Build display rows for the scrubbed minute: real value where the snapshot
// has one, else the last-good value marked stale (`ce._<field>Stale` +
// `ce._stale`), else null. Strikes only present in history (not this
// snapshot) are still shown, fully carried-forward.
function carryForwardRows(newRows, lastGood) {
  const byStrike = new Map((newRows || []).map((r) => [r.strike, r]));
  const strikes = [...new Set([...byStrike.keys(), ...lastGood.keys()])].sort((a, b) => a - b);
  return strikes.map((strike) => {
    const fresh = byStrike.get(strike);
    const prev = lastGood.get(strike);
    const out = { strike, ce: {}, pe: {}, _anyStale: false };
    for (const side of ["ce", "pe"]) {
      const f = fresh?.[side] || {};
      const p = prev?.[side] || {};
      const o = out[side];
      let staleAny = false;
      for (const field of CARRY_FIELDS) {
        if (f[field] != null) {
          o[field] = f[field];
        } else if (p[field] != null) {
          o[field] = p[field];
          o[`_${field}Stale`] = true;
          staleAny = true;
        } else {
          o[field] = null;
        }
      }
      o._stale = staleAny;
      if (staleAny) out._anyStale = true;
    }
    return out;
  });
}

// All date math below follows CLAUDE.md Gotcha #12: plain 'YYYY-MM-DD'
// string parsing via explicit Date.UTC, never `new Date(nonISOString)` or
// local-timezone Date methods.
function daysBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return null;
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) /
      (24 * 60 * 60 * 1000),
  );
}

function formatExpiryShort(sqlDate) {
  if (!sqlDate) return "";
  const [, m, d] = sqlDate.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function formatDateTimeLabel(dateStr, timeStr) {
  if (!dateStr) return "Pick a date";
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = timeStr ? String(timeStr).slice(0, 5) : "";
  return `${weekday}, ${d} ${MONTHS_SHORT[m - 1]}, ${y}${time ? " " + time : ""}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdToStr(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Cosmetic-only "today" (IST) for the calendar's Holiday-dot check below —
// a future day with no stored data yet isn't a holiday, it just hasn't
// happened. Plain string comparison, not a data-integrity date parse, so
// this doesn't fall under Gotcha #12's "no new Date(nonISOString)" rule.
function todayIstDateStr() {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return ymdToStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function timeToSeconds(t) {
  const [h, m, s] = String(t).split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function nearestTime(times, targetSeconds) {
  if (!times || !times.length) return null;
  let best = times[0];
  let bestDiff = Infinity;
  for (const t of times) {
    const diff = Math.abs(timeToSeconds(t) - targetSeconds);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best;
}

function isWeekdayDate(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// Wall-clock (IST) instant → UTC ms, for pricing "as of" a historical replay
// moment instead of the real clock (see yearsToExpiry's optional `fromMs`).
function istWallClockToUtcMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm, ss] = (timeStr || "09:15:00").split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss || 0) - 5.5 * 60 * 60 * 1000;
}

function legFromRow(row, right, action, expiry, lotSize, time) {
  const side = right === "CE" ? row.ce : row.pe;
  return {
    id: ++legIdCounter,
    action,
    type: right,
    strike: row.strike,
    premium: side.ltp,
    qty: 1,
    lotSize,
    iv: side.iv,
    delta: side.delta,
    gamma: side.gamma,
    theta: side.theta,
    vega: side.vega,
    expiry, // which expiry this leg's premium/greeks came from — see payoff.js
    time, // the historical trade_time this leg's LTP/Greeks snapshot came from — shown in Upcoming Positions
    active: true, // unchecked in the Positions table = kept but excluded from payoff/metrics
  };
}

function isLegUpcoming(leg, currTime) {
  if (!leg || !leg.time || !currTime) return false;
  return currTime < leg.time;
}

// `embeddedSymbol` / `hideChrome` are set only when Simulator is rendered
// *inside* Strategy Builder's "Historical" mode (see StrategyBuilder.jsx) —
// the symbol then follows Strategy Builder's picker and Simulator's own
// symbol pill + page chrome are hidden. With no props it's the standalone
// /simulator page, unchanged.
export default function Simulator({ embeddedSymbol, hideChrome = false } = {}) {
  // Deep-linked from Option Chain's "Historical"/"Previous day" controls:
  // ?symbol=BANKNIFTY opens on that symbol instead of always NIFTY, and
  // ?jump=prev selects the previous trading day (dates[1]) instead of the
  // latest one on first load. Consumed once — a later manual symbol switch
  // via the picker shouldn't keep re-applying "prev".
  const [searchParams, setSearchParams] = useSearchParams();
  const initialJumpRef = useRef(embeddedSymbol ? null : searchParams.get("jump"));
  const atmRowRef = useRef(null);
  const chainScrollRef = useRef(null);
  // Running last-good value per (strike, side, field) for the currently
  // viewed symbol/date/expiry — powers historical carry-forward while
  // scrubbing (see carryForwardRows). Reset whenever the underlying series
  // changes (loadChain).
  const lastGoodChainRef = useRef(new Map());
  // When embedded, the symbol is Strategy Builder's — it passes a matching
  // `key` so this component remounts (and re-initialises here) on a symbol
  // change, rather than needing a sync effect.
  const initialSymbol = embeddedSymbol || searchParams.get("symbol")?.toUpperCase() || "NIFTY";
  const [symbol, setSymbol] = useState(initialSymbol);
  const [dates, setDates] = useState([]); // DESC (most recent first), per /dates
  const [datesLoaded, setDatesLoaded] = useState(false); // distinguishes "still fetching" from "fetched, genuinely empty"
  const [sparseDates, setSparseDates] = useState([]); // dates with only 1 stored snapshot (EOD-only, no scrubbing)
  const [dateStatus, setDateStatus] = useState({}); // minute option/OHLCV availability per date
  const [selectedDate, setSelectedDate] = useState("");
  const [chainData, setChainData] = useState(null); // metadata holder: expiries/times/selectedExpiry
  const [liveChain, setLiveChain] = useState(null); // chain rows at whichever instant is being viewed
  const [chainError, setChainError] = useState(null);
  const [scrubError, setScrubError] = useState(null); // -1m/+5m/etc failures — previously swallowed silently
  const [legs, setLegs] = useState(() => loadSavedLegs(initialSymbol));
  useEffect(() => {
    saveLegs(symbol, legs);
  }, [symbol, legs]);
  const [upcomingPositions, setUpcomingPositions] = useState(() =>
    loadUpcomingPositions(initialSymbol)
  );
  useEffect(() => {
    saveUpcomingPositions(symbol, upcomingPositions);
  }, [symbol, upcomingPositions]);
  const [tab, setTab] = useState("positions"); // 'positions' | 'greeks' | 'upcoming'
  const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'nifty' | 'combined'
  // Underlying lightweight-charts instances, exposed via forwardRef, so the
  // "combined" tab can sync crosshair + pan/zoom between the two separate
  // chart instances (StrategyChart's candles aren't a pane inside
  // CandlestickChart or vice versa — they're two independent charts that
  // need to be told to move together, see the sync effect below).
  const strategyChartRef = useRef(null);
  const niftyChartRef = useRef(null);

  const [savedOpen, setSavedOpen] = useState(false);
  const [hideChain, setHideChain] = useState(false);
  const [legsTopFirst, setLegsTopFirst] = useState(true);
  const [slTgEditId, setSlTgEditId] = useState(null);
  const [slTgDraft, setSlTgDraft] = useState({ sl: "", tg: "" });

  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false);

  function toggleColumn(key) {
    setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function resetChainSettings() {
    setColumns(DEFAULT_COLUMNS);
  }

  const [replayData, setReplayData] = useState(null);
  const [replayError, setReplayError] = useState(null);
  // Auto-preview of the strategy's real per-minute P&L for the selected day,
  // shown on the "Strategy Chart" / combined tabs the moment legs exist —
  // so the chart always reflects the strategy you've built WITHOUT first
  // clicking "Run Simulation" (that button still gates scrub/autoplay and
  // locking the legs). Same replay endpoint, just fetched automatically and
  // never used as the "legs are locked" signal — that stays `replayData`.
  const [previewReplay, setPreviewReplay] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [squareOffAlert, setSquareOffAlert] = useState(null); // { reason, leg, time } | null — SL/TG hit during playback
  const alertedExitsRef = useRef(new Set()); // leg keys already alerted this replay run, so scrubbing back/forth doesn't re-fire

  // Syncs crosshair + visible time range between StrategyChart and
  // CandlestickChart's underlying lightweight-charts instances when the
  // "combined" tab shows both — they're two independent chart instances
  // (not panes within one chart), so nothing links them by default. Both
  // charts mount fresh whenever this tab becomes active; a short retry loop
  // handles the brief window before both instances exist, rather than
  // threading extra "chart ready" state through two separate children.
  useEffect(() => {
    if (chartTab !== "combined") return;
    let cancelled = false;
    let retryTimer = null;
    let unsubscribers = [];

    function trySubscribe() {
      if (cancelled) return;
      const chartA = strategyChartRef.current?.getChart();
      const chartB = niftyChartRef.current?.getChart();
      const seriesA = strategyChartRef.current?.getSeries();
      const seriesB = niftyChartRef.current?.getSeries();
      if (!chartA || !chartB || !seriesA || !seriesB) {
        retryTimer = setTimeout(trySubscribe, 150);
        return;
      }

      let syncingCrosshair = false;
      function linkCrosshair(sourceChart, targetChart, targetSeries) {
        const handler = (param) => {
          if (syncingCrosshair) return;
          syncingCrosshair = true;
          if (param.time == null) {
            targetChart.clearCrosshairPosition();
          } else {
            const price = param.seriesData?.get(param.seriesData.keys().next().value)?.close
              ?? param.seriesData?.get(param.seriesData.keys().next().value)?.value;
            if (price != null) targetChart.setCrosshairPosition(price, param.time, targetSeries);
          }
          syncingCrosshair = false;
        };
        sourceChart.subscribeCrosshairMove(handler);
        return () => sourceChart.unsubscribeCrosshairMove(handler);
      }

      let syncingRange = false;
      function linkTimeRange(sourceChart, targetChart) {
        const handler = (range) => {
          if (syncingRange || !range) return;
          syncingRange = true;
          targetChart.timeScale().setVisibleLogicalRange(range);
          syncingRange = false;
        };
        sourceChart.timeScale().subscribeVisibleLogicalRangeChange(handler);
        return () => sourceChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      }

      unsubscribers = [
        linkCrosshair(chartA, chartB, seriesB),
        linkCrosshair(chartB, chartA, seriesA),
        linkTimeRange(chartA, chartB),
        linkTimeRange(chartB, chartA),
      ];
    }

    trySubscribe();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [chartTab, replayData, previewReplay, selectedDate]);

  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [moveKey, setMoveKey] = useState("1m");
  const [everyKey, setEveryKey] = useState("1s");
  const [speedOpen, setSpeedOpen] = useState(false);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarYm, setCalendarYm] = useState(null); // { y, m } (m: 1-12), which month the popover shows
  const [pendingDate, setPendingDate] = useState(null); // day picked in the popover, not applied until OK
  const [pendingTime, setPendingTime] = useState(null); // nearest REAL stored time to whatever hour/minute is picked
  const [pendingHour, setPendingHour] = useState(null); // "HH" the user clicked — purely visual selection
  const [pendingMinute, setPendingMinute] = useState(null); // "MM" the user clicked — purely visual selection
  const [pendingTimes, setPendingTimes] = useState([]); // real stored snapshot times for pendingDate
  // Hour/minute picker auto-centering — 60 minutes in a small scrollable
  // column previously always opened scrolled to the top, forcing the user to
  // hunt down the currently-selected hour/minute by hand every time. These
  // refs let centerActiveTimeButtons() (below) scroll each column to its own
  // active item, scoped to the column's own scroll container only (same
  // "don't use scrollIntoView" reasoning as scrollToAtm elsewhere in this
  // file — the native version walks up every scrollable ancestor including
  // the page itself).
  const hourListRef = useRef(null);
  const minuteListRef = useRef(null);
  const activeHourBtnRef = useRef(null);
  const activeMinuteBtnRef = useRef(null);

  // Every symbol with real data (indices + the ~280 F&O stocks Bhavcopy/
  // Breeze backfilled) — same endpoint the live Option Chain's Select Asset
  // dropdown uses. Falls back to the original 3 indices if this fails, so
  // symbol switching still works even if the list endpoint is down.
  const [symbolList, setSymbolList] = useState({ indices: SYMBOLS, stocks: [] });
  useEffect(() => {
    fetchSymbolList()
      .then((res) => setSymbolList({ indices: res.indices?.length ? res.indices : SYMBOLS, stocks: res.stocks || [] }))
      .catch(() => { /* keep the fallback list */ });
  }, []);

  // Symbol pill + searchable dropdown — same pattern as StrategyBuilder.jsx.
  const [favorites, setFavorites] = useState(loadFavorites);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  // Mini contract-chart popup, opened from the small chart icon on hover.
  const [chartModal, setChartModal] = useState(null); // { strike, right } | null

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      /* localStorage unavailable (private mode, etc) — favorites just won't persist */
    }
  }, [favorites]);

  const filteredIndices = useMemo(
    () => symbolList.indices.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
    [symbolList, pickerQuery],
  );
  const filteredStocks = useMemo(
    () => symbolList.stocks.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
    [symbolList, pickerQuery],
  );

  // Chevrons cycle through favorites only; the pill opens the full
  // searchable dropdown to jump anywhere. The symbol-reset useEffect above
  // already clears legs/dates/chain state on any setSymbol call.
  function cycleSymbol(dir) {
    if (favorites.length < 2) return;
    const idx = favorites.indexOf(symbol);
    const base = idx >= 0 ? idx : 0;
    const next = favorites[(base + dir + favorites.length) % favorites.length];
    setSymbol(next);
  }

  function pickSymbol(sym) {
    setSymbol(sym);
    setPickerOpen(false);
    setPickerQuery("");
  }

  function toggleFavorite(sym) {
    setFavorites((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  }

  // Reset everything when the symbol changes.
  useEffect(() => {
    setDates([]);
    setDatesLoaded(false);
    setSparseDates([]);
    setDateStatus({});
    setSelectedDate("");
    setChainData(null);
    setLiveChain(null);
    setChainError(null);
    setScrubError(null);
    setLegs(loadSavedLegs(symbol));
    setUpcomingPositions(loadUpcomingPositions(symbol));
    setReplayData(null);
    setReplayError(null);
    setChartTab("payoff");
    setCalendarYm(null);
    setChartModal(null);
    lastGoodChainRef.current = new Map();
    fetchSimulatorDates(symbol)
      .then((res) => {
        setDates(res.dates);
        setSparseDates(res.sparseDates || []);
        setDateStatus(res.dateStatus || {});
        if (res.dates.length) {
          // Auto-select the most recent day with stored data so the left
          // chain box isn't blank on first load — previously it stayed
          // empty until the user manually opened the calendar and picked
          // a day, even though we already know the latest available date.
          // Fetches directly (not via selectDate/loadChain) to avoid
          // closing over this render's stale `chainData` from the
          // previous symbol when switching symbols.
          // ?jump=prev (from Option Chain's "Previous day" control) picks
          // the day before that instead — consumed once, then stripped from
          // the URL so a later manual symbol switch doesn't reapply it.
          const wantsPrevDay = initialJumpRef.current === "prev";
          const targetDate = wantsPrevDay && res.dates[1] ? res.dates[1] : res.dates[0];
          if (wantsPrevDay) {
            initialJumpRef.current = null;
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete("jump");
              return next;
            }, { replace: true });
          }
          const [y, m] = targetDate.split("-").map(Number);
          setCalendarYm({ y, m });
          setSelectedDate(targetDate);
          fetchSimulatorChain(symbol, { date: targetDate })
            .then((chainRes) => {
              setChainData(chainRes);
              setLiveChain(chainRes);
            })
            .catch((err) => setChainError(err.message));
        }
      })
      .catch((err) => setChainError(err.message))
      .finally(() => setDatesLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  function shiftCalendarMonth(dir) {
    setCalendarYm((prev) => {
      if (!prev) return prev;
      let { y, m } = prev;
      m += dir;
      if (m > 12) { m = 1; y += 1; }
      if (m < 1) { m = 12; y -= 1; }
      return { y, m };
    });
  }

  function shiftCalendarYear(dir) {
    setCalendarYm((prev) => (prev ? { y: prev.y + dir, m: prev.m } : prev));
  }

  const availableDateSet = useMemo(() => new Set(dates), [dates]);
  const sparseDateSet = useMemo(() => new Set(sparseDates), [sparseDates]);
  const TODAY_IST = useMemo(() => todayIstDateStr(), []);
  const dayExpirySet = useMemo(() => new Set(chainData?.expiries || []), [chainData]);

  // Full 6x7 grid including muted/disabled leading & trailing days from the
  // adjacent months, so the calendar always looks like a real month grid.
  const calendarDays = useMemo(() => {
    if (!calendarYm) return [];
    const { y, m } = calendarYm;
    const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const prevDaysInMonth = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
    const cells = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      cells.push({ day: prevDaysInMonth - i, inMonth: false, y: m === 1 ? y - 1 : y, m: m === 1 ? 12 : m - 1 });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, inMonth: true, y, m });
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ day: nextDay, inMonth: false, y: m === 12 ? y + 1 : y, m: m === 12 ? 1 : m + 1 });
      nextDay++;
    }
    return cells;
  }, [calendarYm]);

  // Time picker for whichever day is currently pending in the popover — ALL
  // hours across the NSE trading day (09:15-15:30) and all minutes 00-59 are
  // always shown, regardless of how sparse that particular day's stored data
  // actually is (a day with only two recorded snapshots, e.g. 15:15/15:30,
  // must not collapse the picker down to a single hour). Whatever the user
  // clicks resolves to the NEAREST real stored snapshot, same "nearest wins"
  // rule the -1m/+5m/etc scrubber buttons already use, so every clickable
  // time shows real data even when most of the day has no stored row.
  const MARKET_HOURS = useMemo(() => ["09", "10", "11", "12", "13", "14", "15"], []);
  const ALL_MINUTES = useMemo(() => Array.from({ length: 60 }, (_, i) => pad2(i)), []);
  const pendingHours = MARKET_HOURS;

  function resolvePendingTime(hour, minute) {
    if (!pendingTimes.length || !hour || minute == null) return;
    const target = timeToSeconds(`${hour}:${minute}:00`);
    const match = nearestTime(pendingTimes, target);
    if (match) setPendingTime(match);
  }

  function fetchPendingTimes(date) {
    fetchSimulatorChain(symbol, { date, expiry: chainData?.selectedExpiry })
      .then((res) => {
        const times = res.times || [];
        const initial = times[0] || null;
        setPendingTimes(times);
        setPendingTime(initial);
        setPendingHour(initial ? String(initial).slice(0, 2) : null);
        setPendingMinute(initial ? String(initial).slice(3, 5) : null);
      })
      .catch(() => {
        setPendingTimes([]);
        setPendingHour(null);
        setPendingMinute(null);
      });
  }

  function openCalendar() {
    const initDate = selectedDate || dates[0] || null;
    setPendingDate(initDate);
    const initTime = currentTime || null;
    setPendingTime(initTime);
    setPendingHour(initTime ? String(initTime).slice(0, 2) : null);
    setPendingMinute(initTime ? String(initTime).slice(3, 5) : null);
    if (initDate && initDate === selectedDate && chainData?.times?.length) {
      setPendingTimes(chainData.times);
    } else if (initDate) {
      fetchPendingTimes(initDate);
    } else {
      setPendingTimes([]);
    }
    if (initDate) {
      const [y, m] = initDate.split("-").map(Number);
      setCalendarYm({ y, m });
    }
    setCalendarOpen(true);
  }

  function pickCalendarDay(dateStr) {
    setPendingDate(dateStr);
    fetchPendingTimes(dateStr);
  }

  function pickHour(hour) {
    setPendingHour(hour);
    resolvePendingTime(hour, pendingMinute || "00");
  }

  function pickMinute(minute) {
    setPendingMinute(minute);
    resolvePendingTime(pendingHour || pendingHours[0], minute);
  }

  function confirmCalendarSelection() {
    if (pendingDate) selectDate(pendingDate, pendingTime);
    setCalendarOpen(false);
  }

  // Scrolls the hour/minute columns so the currently pending selection sits
  // centered instead of wherever the browser's default scroll position
  // happens to land — same "scroll the container, not the page" technique as
  // scrollToAtm (see its comment above for why not scrollIntoView). Re-runs
  // whenever the popover is open and the pending hour/minute changes — on
  // first open (populated once fetchPendingTimes resolves) AND on every
  // manual hour/minute click, so the active item never drifts out of view.
  useEffect(() => {
    if (!calendarOpen) return;
    const raf = requestAnimationFrame(() => {
      const hourContainer = hourListRef.current;
      const hourBtn = activeHourBtnRef.current;
      if (hourContainer && hourBtn) {
        hourContainer.scrollTo({ top: Math.max(0, hourBtn.offsetTop - hourContainer.clientHeight / 2 + hourBtn.clientHeight / 2), behavior: "instant" });
      }
      const minuteContainer = minuteListRef.current;
      const minuteBtn = activeMinuteBtnRef.current;
      if (minuteContainer && minuteBtn) {
        minuteContainer.scrollTo({ top: Math.max(0, minuteBtn.offsetTop - minuteContainer.clientHeight / 2 + minuteBtn.clientHeight / 2), behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [calendarOpen, pendingHour, pendingMinute]);

  function loadChain(date, expiry, time) {
    setChainError(null);
    setScrubError(null); // a fresh full chain load supersedes any earlier scrub failure
    // New series (different day/expiry) — start carry-forward from scratch.
    lastGoodChainRef.current = new Map();
    fetchSimulatorChain(symbol, { date, expiry, time })
      .then((res) => {
        absorbLastGood(lastGoodChainRef.current, res.rows);
        setChainData(res);
        setLiveChain(res);
      })
      .catch((err) => {
        setChainError(err.message);
        setChainData(null);
        setLiveChain(null);
      });
  }

  function selectDate(date, time) {
    // Changed 2026-09-13, per explicit user decision: a position built for
    // one date now stays OPEN across date navigation (same "just keep the
    // legs, reprice against whatever's loaded" model Strategy Builder uses
    // for symbol/expiry navigation — no per-date archiving). Previously this
    // auto-archived whatever was in `legs` into the read-only "Upcoming
    // Positions" journal and cleared it the moment the date changed, which
    // made a placed position vanish the instant you moved forward/back a
    // day instead of showing that day's P&L — the actual behavior wanted.
    // `legs` is intentionally left untouched here; loadChain() below re-seeds
    // chainData for the new date, and the existing live-lookup-by-strike
    // logic (displayRows/legLivePnl) reprices each leg against it exactly
    // the way it already does for expiry navigation (see selectExpiry).
    // archiveCurrentPosition() below is now the only way anything reaches
    // the Upcoming Positions journal — explicit, not automatic.
    setSelectedDate(date);
    setReplayData(null);
    setChartTab("payoff");
    if (date) {
      loadChain(date, chainData?.selectedExpiry, time);
      const [y, m] = date.split("-").map(Number);
      setCalendarYm({ y, m }); // keep the popover's month in sync with whatever got selected
    }
  }

  function jumpDate(dir) {
    // dates is DESC (index 0 = most recent); "+1d" moves toward more
    // recent (lower index), "-1d" moves toward older (higher index).
    const idx = dates.indexOf(selectedDate);
    if (idx < 0) return;
    const nextIdx = idx - dir;
    if (nextIdx < 0 || nextIdx >= dates.length) return;
    selectDate(dates[nextIdx]);
  }

  function selectExpiry(expiry) {
    // Positions the user already built are kept — see selectDate above.
    setReplayData(null);
    setChartTab("payoff");
    loadChain(selectedDate, expiry);
  }

  // The instant currently on screen, whichever mode we're in.
  const currentTime = replayData
    ? replayData.series[cursor]?.time
    : liveChain?.selectedTime || chainData?.selectedTime;

  // Legs partitioned by the current simulated minute:
  // - enteredLegs: legs entered at or before currentTime (in-market)
  // - upcomingLegs: legs scheduled for a time after currentTime (upcoming)
  const enteredLegs = useMemo(
    () => legs.filter((l) => !isLegUpcoming(l, currentTime)),
    [legs, currentTime],
  );
  const upcomingLegs = useMemo(
    () => legs.filter((l) => isLegUpcoming(l, currentTime)),
    [legs, currentTime],
  );

  // Legs the Positions table checkbox has left checked — the payoff curve,
  // Greeks, POP, and max-profit/loss below are recalculated from only these.
  const activeLegs = useMemo(() => enteredLegs.filter((l) => l.active !== false), [enteredLegs]);

  function scrubToTime(time) {
    if (!time || !chainData) return;
    if (replayData) {
      const idx = replayData.series.findIndex((p) => p.time === time);
      if (idx >= 0) {
        setPlaying(false);
        setCursor(idx);
      }
      return;
    }
    setScrubError(null);
    fetchSimulatorChain(symbol, {
      date: selectedDate,
      expiry: chainData.selectedExpiry,
      time,
    })
      .then((res) => {
        absorbLastGood(lastGoodChainRef.current, res.rows);
        setLiveChain({ ...res, rows: carryForwardRows(res.rows, lastGoodChainRef.current) });
      })
      .catch((err) => {
        // Previously swallowed silently — a scrub click that failed (bad
        // symbol, network hiccup, backend error) looked identical to one
        // that succeeded but landed on the same already-loaded minute,
        // which made real failures indistinguishable from "nothing to step
        // to". Surface it so the two cases are never confused again.
        console.error("[Simulator] scrubToTime failed", err);
        setScrubError(err.message || "Failed to load that time");
      });
  }

  function jumpTimeBy(deltaSeconds) {
    const times = chainData?.times || [];
    if (!times.length || !currentTime) return;
    const target = nearestTime(times, timeToSeconds(currentTime) + deltaSeconds);
    if (target === currentTime) {
      // Nothing to move to in that direction — most likely this day only
      // has a handful of stored snapshots. Make that explicit instead of
      // silently doing nothing (see onlySnapshotForDay note below the chain).
      console.debug("[Simulator] jumpTimeBy: nearest time is unchanged", { currentTime, deltaSeconds, times });
      return;
    }
    scrubToTime(target);
  }

  function jumpToStart() {
    const times = chainData?.times || [];
    if (times.length) scrubToTime(times[0]);
  }

  function jumpToEnd() {
    const times = chainData?.times || [];
    if (times.length) scrubToTime(times[times.length - 1]);
  }

  function addLeg(row, right, action) {
    if (replayData) return; // legs lock once a replay has been run
    const lotSize = chainData?.lotSize ?? liveChain?.lotSize;
    setLegs((prev) =>
      prev.length >= 6
        ? prev
        : [...prev, legFromRow(row, right, action, chainData?.selectedExpiry, lotSize, currentTime)],
    );
  }

  // Fetches a DIFFERENT expiry's chain for the SAME already-selected
  // historical day — needed for calendar-spread presets, whose far leg comes
  // from a later expiry. Doesn't touch chainData/liveChain; returns rows only.
  function fetchExpiryRows(expiry) {
    return fetchSimulatorChain(symbol, { date: selectedDate, expiry }).then((res) => res.rows || []);
  }

  function removeLeg(id) {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }

  function updateQty(id, qty) {
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l)),
    );
  }

  // Positions table checkbox — doesn't delete the leg, just excludes it from
  // the payoff curve / Greeks / POP / max-profit-loss calculation below (see
  // the activeLegs filter in the payoff useMemo), same as a real what-if
  // toggle: the row and its live LTP/P&L stay visible either way.
  function toggleLegActive(id) {
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, active: !l.active } : l)),
    );
  }

  // Flips a leg's side in place (Buy <-> Sell) without deleting/re-adding it
  // — same convention as StrategyBuilder.jsx's identical function. Locked
  // once a replay has run, same as every other leg edit in this page (see
  // the `replayData` guards on updateQty/rollLegStrike/etc above).
  function toggleLegSide(id) {
    if (replayData) return;
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, action: otherAction(l.action) } : l)),
    );
  }

  // Expiry dropdown in the Positions table — re-fetches that expiry's real
  // chain for the same historical day and carries the leg over to the
  // closest available strike (same strike if it still exists), pulling a
  // fresh entry premium/Greeks for the new contract rather than keeping the
  // old expiry's stale numbers.
  async function updateLegExpiry(id, newExpiry) {
    if (replayData) return;
    const leg = legs.find((l) => l.id === id);
    if (!leg || leg.expiry === newExpiry) return;
    try {
      const rows = await fetchExpiryRows(newExpiry);
      if (!rows.length) return;
      const match =
        rows.find((r) => r.strike === leg.strike) ||
        rows.reduce((best, r) =>
          !best || Math.abs(r.strike - leg.strike) < Math.abs(best.strike - leg.strike) ? r : best,
        rows[0]);
      const side = leg.type === "CE" ? match.ce : match.pe;
      setLegs((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, expiry: newExpiry, strike: match.strike, premium: side?.ltp, iv: side?.iv, delta: side?.delta, gamma: side?.gamma, theta: side?.theta, vega: side?.vega }
            : l,
        ),
      );
    } catch (err) {
      console.error("[Simulator] updateLegExpiry failed", err);
    }
  }

  function updateLeg(id, patch) {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  // Roll strike up/down by one row — only offered while the leg's expiry
  // matches the currently displayed chain (so the adjacent-strike lookup
  // comes from data already in memory, no extra fetch); a leg parked on a
  // different expiry (e.g. a calendar-spread preset's far leg) shows its
  // strike as plain text instead of guessing. Same pattern as
  // StrategyBuilder.jsx's rollLegStrike.
  function rollLegStrike(id, direction) {
    if (replayData) return;
    const leg = legs.find((l) => l.id === id);
    if (!leg || leg.expiry !== chainData?.selectedExpiry) return;
    const sorted = [...displayRows].sort((a, b) => a.strike - b.strike);
    const idx = sorted.findIndex((r) => r.strike === leg.strike);
    const nextRow = sorted[idx + direction];
    const side = nextRow && (leg.type === "CE" ? nextRow.ce : nextRow.pe);
    if (!side || side.ltp == null) return; // no adjacent strike in that direction
    updateLeg(id, { strike: nextRow.strike, premium: side.ltp, iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega });
  }

  // Re-bases the entry price to the current LTP (zeroes out this leg's live
  // P&L going forward) — same as StrategyBuilder.jsx's Exit column refresh icon.
  function resetLegEntryToLtp(id) {
    if (replayData) return;
    const leg = legs.find((l) => l.id === id);
    const row = leg && displayRows.find((r) => r.strike === leg.strike);
    const currentLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
    if (currentLtp == null) return;
    updateLeg(id, { premium: currentLtp });
  }

  // SL/TG stored on the leg are actually applied by the backend during Run
  // Simulation (see server/controllers/simulatorController.js's replay) —
  // once a leg's own running P&L crosses ±this %, that leg's P&L freezes at
  // the triggering minute. Set via the modal below (openSlTgModal/
  // closeSlTgModal), not inline, so there's room to show the real ₹ amount
  // each % resolves to before committing.
  function setLegSlTg(id, slPercent, tgPercent) {
    updateLeg(id, {
      slPercent: slPercent === "" ? null : Number(slPercent),
      tgPercent: tgPercent === "" ? null : Number(tgPercent),
    });
  }

  function openSlTgModal(leg) {
    setSlTgDraft({ sl: leg.slPercent ?? "", tg: leg.tgPercent ?? "" });
    setSlTgEditId(leg.id);
  }

  function closeSlTgModal() {
    setSlTgEditId(null);
  }

  function saveSlTgModal(legId) {
    setLegSlTg(legId, slTgDraft.sl, slTgDraft.tg);
    setSlTgEditId(null);
  }

  // Scales EVERY leg's lot count by the same delta at once (min 1) — same as
  // StrategyBuilder.jsx's bulkAdjustLots.
  function bulkAdjustLots(delta) {
    if (replayData) return;
    setLegs((prev) => prev.map((l) => ({ ...l, qty: Math.max(1, l.qty + delta) })));
  }

  // "Select All" toggles every leg's payoff-inclusion checkbox at once —
  // Simulator's per-leg checkbox already means something (included in
  // payoff/replay), unlike StrategyBuilder's purely cosmetic selection, so
  // this reuses that same `active` flag rather than adding a second,
  // meaningless checkbox column.
  const allLegsActive = enteredLegs.length > 0 && enteredLegs.every((l) => l.active !== false);
  function toggleSelectAllLegs() {
    if (replayData || !enteredLegs.length) return;
    const shouldInclude = !allLegsActive;
    const enteredIds = new Set(enteredLegs.map((l) => l.id));
    setLegs((prev) => prev.map((l) => (enteredIds.has(l.id) ? { ...l, active: shouldInclude } : l)));
  }

  function enterLegNow(id) {
    if (!currentTime) return;
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, time: currentTime } : l)));
  }

  function enterAllUpcomingNow() {
    if (!currentTime) return;
    setLegs((prev) => prev.map((l) => (isLegUpcoming(l, currentTime) ? { ...l, time: currentTime } : l)));
  }

  // Chain-row inline position display, same pattern as StrategyBuilder.jsx —
  // which leg(s) match this exact strike/right in the currently displayed
  // expiry, plus signed net lots (buy=+qty, sell=-qty) shown as a badge.
  function legsAt(strike, right) {
    return enteredLegs.filter((l) => l.strike === strike && l.type === right && l.expiry === chainData?.selectedExpiry);
  }
  function netPositionAt(strike, right) {
    const matches = legsAt(strike, right);
    if (!matches.length) return 0;
    return matches.reduce((sum, l) => sum + (l.action === "buy" ? l.qty : -l.qty), 0);
  }

  // Reset Workspace is the one deliberate discard-without-archiving action
  // (see the SIM_LEGS_KEY_PREFIX comment above) — it now also clears this
  // symbol's Upcoming Positions journal, not just the currently-open legs,
  // since a user reaching for "reset everything" would otherwise still find
  // old archived entries sitting there afterward. Confirmed first since,
  // unlike a date switch, nothing here gets archived — it's genuinely gone.
  function resetWorkspace() {
    if (
      (legs.length > 0 || upcomingPositions.length > 0) &&
      !window.confirm("Reset workspace? This clears the current legs and the Upcoming Positions journal for this symbol — permanently, nothing is archived.")
    ) {
      return;
    }
    setLegs([]);
    setReplayData(null);
    setChartTab("payoff");
    setUpcomingPositions([]);
  }

  // The only way anything reaches the Upcoming Positions journal now (see
  // selectDate's 2026-09-13 comment) — snapshots the currently-open legs as
  // a dated read-only entry and clears them, same shape the old automatic
  // per-date-change archiving used, just explicit instead of automatic.
  function archiveCurrentPosition() {
    if (!legs.length) return;
    const archived = ++upcomingIdCounter;
    setUpcomingPositions((prev) => [
      { id: archived, date: selectedDate, legs, archivedAt: Date.now() },
      ...prev,
    ]);
    setLegs([]);
    setReplayData(null);
    setTab("upcoming");
  }

  // Removes ONE archived Upcoming Positions entry — previously the only way
  // to clear anything here was resetWorkspace() (everything, all at once);
  // this lets a specific old entry be discarded without touching the rest.
  function removeUpcomingPosition(id) {
    setUpcomingPositions((prev) => prev.filter((e) => e.id !== id));
  }

  // Drops ONE leg from an archived entry — if that was its last leg, the
  // now-empty entry is dropped too rather than leaving a blank journal row.
  function removeUpcomingLeg(entryId, legId) {
    setUpcomingPositions((prev) =>
      prev
        .map((e) => (e.id === entryId ? { ...e, legs: e.legs.filter((l) => l.id !== legId) } : e))
        .filter((e) => e.legs.length > 0),
    );
  }

  function applyPreset(presetLegs) {
    setLegs(presetLegs.map((l) => ({ active: true, time: currentTime, ...l, id: ++legIdCounter })));
  }

  async function runSimulation() {
    setRunning(true);
    setReplayError(null);
    setPlaying(false);
    try {
      const res = await runSimulatorReplay(symbol, {
        date: selectedDate,
        expiry: chainData.selectedExpiry,
        // Unchecked (excluded) legs stay in the workspace but don't join the
        // replay, same as they're excluded from the theoretical payoff curve.
        legs: legs.filter((l) => l.active !== false).map(({ strike, type, action, qty, slPercent, tgPercent }) => ({
          strike,
          type,
          action,
          qty,
          slPercent,
          tgPercent,
        })),
        // The instant currently on screen is where every leg's `premium`
        // field actually came from (see addLeg/rollLegStrike) — telling the
        // backend to price entry at that same instant, instead of always the
        // day's opening snapshot, is what makes P&L read exactly 0 right at
        // entry and only fluctuate as playback moves forward from there.
        entryTime: currentTime,
      });
      setReplayData(res);
      alertedExitsRef.current = new Set();
      setSquareOffAlert(null);
      // Start the scrubber at the real entry instant (P&L reads 0 there),
      // not always the day's first snapshot.
      const entryIdx = res.series.findIndex((p) => p.time === res.entryTime);
      setCursor(entryIdx >= 0 ? entryIdx : 0);
      setChartTab("strategy");
    } catch (err) {
      setReplayError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // Starting playback from (at or past) the last sample would otherwise
  // immediately self-stop on the interval's first tick (see the clamp
  // below) with zero visible movement — looks exactly like a broken button
  // when a user replays to the end, or jumps to EOD, then clicks Autoplay
  // again expecting it to restart from the top.
  function toggleAutoplay() {
    if (!replayData) return;
    setPlaying((wasPlaying) => {
      const startingPlayback = !wasPlaying;
      if (startingPlayback && cursor >= replayData.series.length - 1) {
        const entryIdx = replayData.series.findIndex((p) => p.time === replayData.entryTime);
        setCursor(entryIdx >= 0 ? entryIdx : 0);
      }
      return startingPlayback;
    });
  }

  // Playback loop (Autoplay) — Move (step size) and Every (interval) vary independently.
  useEffect(() => {
    if (!playing || !replayData) return;
    const move = MOVE_OPTIONS.find((o) => o.key === moveKey) || MOVE_OPTIONS[0];
    const every = EVERY_OPTIONS.find((o) => o.key === everyKey) || EVERY_OPTIONS[0];
    const timer = setInterval(() => {
      setCursor((c) => {
        const next = c + move.stepPerTick;
        if (next >= replayData.series.length - 1) {
          setPlaying(false);
          return replayData.series.length - 1;
        }
        return next;
      });
    }, every.tickMs);
    return () => clearInterval(timer);
  }, [playing, moveKey, everyKey, replayData]);

  // Editing legs again (Reset Workspace, "Edit legs", switching symbol/date,
  // etc. — every one of the several places that clear replayData) also
  // clears any leftover square-off alert/tracking from the run that just
  // ended, rather than a stale "SL hit" banner surviving into a fresh edit.
  // Trips react-hooks/set-state-in-effect (same already-tolerated pattern as
  // the symbol-change reset effect above and elsewhere in this codebase —
  // see CLAUDE.md's Phase 8.2 note on this).
  useEffect(() => {
    if (!replayData) {
      setSquareOffAlert(null);
      alertedExitsRef.current = new Set();
    }
  }, [replayData]);

  // Square-off alert — the moment playback (autoplay OR manual scrubbing)
  // reaches a leg's real SL/TG exit instant (computed server-side, see
  // simulatorController.js's replay), pause and surface it rather than
  // letting the leg's frozen P&L just quietly sit there in the table.
  // alertedExitsRef stops this from re-firing every tick once past the
  // exit, or again if the user scrubs back and forward across it. Also
  // trips react-hooks/set-state-in-effect — same tolerated pattern noted above.
  useEffect(() => {
    if (!replayData) return;
    const point = replayData.series[cursor];
    if (!point?.time) return;
    for (const leg of replayData.legs) {
      if (!leg.exitReason || !leg.exitTime) continue;
      const key = `${leg.strike}-${leg.type}-${leg.action}`;
      if (alertedExitsRef.current.has(key)) continue;
      if (point.time >= leg.exitTime) {
        alertedExitsRef.current.add(key);
        setPlaying(false);
        setSquareOffAlert({
          reason: leg.exitReason,
          strike: leg.strike,
          type: leg.type,
          action: leg.action,
          time: leg.exitTime,
        });
      }
    }
  }, [cursor, replayData]);

  // Keep the option-chain table in sync with the scrubbed replay cursor.
  useEffect(() => {
    if (!replayData) return;
    const point = replayData.series[cursor];
    if (!point) return;
    let cancelled = false;
    fetchSimulatorChain(symbol, {
      date: replayData.date,
      expiry: replayData.expiry,
      time: point.time,
    })
      .then((res) => {
        if (cancelled) return;
        absorbLastGood(lastGoodChainRef.current, res.rows);
        setLiveChain({ ...res, rows: carryForwardRows(res.rows, lastGoodChainRef.current) });
      })
      .catch(() => {
        /* non-fatal — the chart is the primary view */
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, replayData, symbol]);

  const displayRows = useMemo(
    () => liveChain?.rows || chainData?.rows || [],
    [liveChain, chainData],
  );
  const displaySpot = liveChain?.spotPrice ?? chainData?.spotPrice;
  const displaySpotStored = liveChain?.spotStored ?? chainData?.spotStored;
  const displaySpotChange = liveChain?.spotChange ?? chainData?.spotChange;
  const displaySpotChangePct = liveChain?.spotChangePct ?? chainData?.spotChangePct;
  const displayFutPrice = liveChain?.futPrice ?? chainData?.futPrice;
  const displayFutExpiry = liveChain?.futExpiry ?? chainData?.futExpiry;
  const displayFutBasis = liveChain?.futBasis ?? chainData?.futBasis;
  const displayFutBasisPct = liveChain?.futBasisPct ?? chainData?.futBasisPct;
  const displayFutSource = liveChain?.futSource ?? chainData?.futSource;
  const displayVix = liveChain?.vix ?? chainData?.vix;
  const displayVixSource = liveChain?.vixSource ?? chainData?.vixSource;
  const displayVixChange = liveChain?.vixChange ?? chainData?.vixChange;
  const displayVixChangePct = liveChain?.vixChangePct ?? chainData?.vixChangePct;

  // Scrolls only the chain table's own container, never the page — native
  // scrollIntoView({block:"center"}) walks up every scrollable ancestor
  // including the window, so on a tall page it was also yanking the whole
  // page down (hiding the top navbar) whenever the ATM row wasn't already
  // within the window's viewport, not just within the table.
  function scrollToAtm(behavior = "smooth") {
    const row = atmRowRef.current;
    const container = chainScrollRef.current;
    if (!row || !container) return;
    const target = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior });
  }

  // Auto-center the chain on the SPOT/ATM row as soon as a chain loads for a
  // fresh symbol/date/expiry (page open, symbol switch, date-picker pick, or
  // expiry-tab switch) — same pattern StrategyBuilder.jsx/OptionChain.jsx
  // already use. Keyed off chainData.date (not liveChain, which also updates
  // on every scrub-time tick during playback) so scrubbing/autoplay never
  // yanks the user's scroll position mid-session.
  useEffect(() => {
    if (!chainData?.rows?.length) return;
    const raf = requestAnimationFrame(() => scrollToAtm("instant"));
    return () => cancelAnimationFrame(raf);
  }, [chainData?.date, chainData?.selectedExpiry, symbol, chainData?.rows?.length]);
  const maxCeOi = Math.max(0, ...displayRows.map((r) => r.ce?.oi || 0));
  const maxPeOi = Math.max(0, ...displayRows.map((r) => r.pe?.oi || 0));

  // Real visible-column counts for the chain table's CALL/PUT grouping row
  // colSpan, so that row stays aligned with whichever columns are actually
  // toggled on below it (same pattern as OptionChain.jsx).
  const chainCeColCount =
    1 /* LTP */ + (columns.gamma ? 1 : 0) + (columns.vega ? 1 : 0) + (columns.theta ? 1 : 0) +
    (columns.iv ? 1 : 0) + (columns.callDelta ? 1 : 0) + (columns.oi ? 1 : 0);
  const chainPeColCount =
    1 /* LTP */ + (columns.oi ? 1 : 0) + (columns.callDelta ? 1 : 0) + (columns.iv ? 1 : 0) +
    (columns.theta ? 1 : 0) + (columns.vega ? 1 : 0) + (columns.gamma ? 1 : 0);

  // Boundary check for the -1h/-15m/-5m/-1m/+1m/+5m/+15m/+1h scrubber
  // buttons: a step is only meaningful if there's a stored snapshot further
  // in that direction than the one currently showing. Some days only have a
  // handful of stored snapshots (e.g. an EOD-only Bhavcopy row, see CLAUDE.md
  // Phase 7) — without this check those buttons look "broken" (click does
  // nothing) instead of correctly greying out at the real data boundary.
  const chainTimes = chainData?.times || [];
  const canStepEarlier = !!(chainTimes.length && currentTime && currentTime > chainTimes[0]);
  const canStepLater = !!(chainTimes.length && currentTime && currentTime < chainTimes[chainTimes.length - 1]);
  const onlySnapshotForDay = chainData && chainTimes.length <= 1;

  // Was `diff * leg.qty` — missing the lot-size multiplier entirely, so
  // every Live P&L number in the Positions table (and totalLivePnl below,
  // which sums this) came out qty-scaled instead of real-share-count-scaled
  // — off by a factor of the real lot size (e.g. 75x too small for NIFTY).
  // legMultiplier (qty * lotSize) is the same multiplier the theoretical
  // payoff curve and computeEstMargin already use — this brings Live P&L
  // in line with those instead of silently disagreeing with them.
  // leg.ltpOverride (manually typed into the Positions table's LTP input)
  // takes priority over the chain-derived value, same convention as
  // StrategyBuilder.jsx's legLivePnl — every P&L number re-derives from
  // whatever's actually shown in the LTP column.
  const legLivePnl = useCallback((leg) => {
    const row = displayRows.find((r) => r.strike === leg.strike);
    const liveLtp = row
      ? leg.type === "CE"
        ? row.ce?.ltp
        : row.pe?.ltp
      : null;
    const currentLtp = leg.ltpOverride ?? liveLtp;
    if (currentLtp == null) return null;
    const diff =
      leg.action === "buy"
        ? currentLtp - leg.premium
        : leg.premium - currentLtp;
    return diff * legMultiplier(leg);
  }, [displayRows]);


  // The exact leg shape the replay endpoint wants (same mapping runSimulation
  // does), memoised so the auto-preview effect below only re-fires when the
  // strategy actually changes — not on every unrelated render.
  const previewLegPayload = useMemo(
    () =>
      activeLegs.map(({ strike, type, action, qty, slPercent, tgPercent }) => ({
        strike,
        type,
        action,
        qty,
        slPercent: slPercent ?? null,
        tgPercent: tgPercent ?? null,
      })),
    [activeLegs],
  );
  const previewLegKey = JSON.stringify(previewLegPayload);

  // Auto-build the Strategy Chart from the real stored per-minute prices as
  // soon as a strategy exists and one of the strategy-chart tabs is open —
  // no "Run Simulation" click needed just to SEE the chart. Debounced so
  // rapid leg edits / scrubbing don't spam the endpoint. Skipped entirely
  // once a real replay has been run (replayData drives the chart then).
  useEffect(() => {
    const wantsChart = chartTab === "strategy" || chartTab === "combined";
    const expiry = chainData?.selectedExpiry;
    if (replayData || !wantsChart || !previewLegPayload.length || !selectedDate || !expiry) {
      setPreviewReplay(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      runSimulatorReplay(symbol, {
        date: selectedDate,
        expiry,
        legs: previewLegPayload,
        entryTime: currentTime,
      })
        .then((res) => {
          if (!cancelled) setPreviewReplay(res);
        })
        .catch(() => {
          if (!cancelled) setPreviewReplay(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // previewLegKey stands in for previewLegPayload (new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayData, chartTab, previewLegKey, selectedDate, chainData?.selectedExpiry, symbol, currentTime]);

  // Positions toolbar:
  const orderedLegs = useMemo(() => (legsTopFirst ? enteredLegs : [...enteredLegs].reverse()), [enteredLegs, legsTopFirst]);
  const commonLots = enteredLegs.length && enteredLegs.every((l) => l.qty === enteredLegs[0].qty) ? enteredLegs[0].qty : null;
  const totalLots = enteredLegs.reduce((sum, l) => sum + l.qty, 0);
  const totalLivePnl = useMemo(() => {
    if (!enteredLegs.length) return 0;
    let sum = 0;
    for (const leg of enteredLegs) {
      if (leg.active === false) continue;
      const v = legLivePnl(leg);
      if (v == null) return null;
      sum += v;
    }
    return sum;
  }, [enteredLegs, legLivePnl]);

  // Theoretical payoff at expiry — same math/pattern as Strategy Builder,
  // just priced "as of" the historical instant being viewed instead of now.
  const {
    curve,
    breakevens,
    maxProfit,
    maxLoss,
    riskRewardRatio,
    netGreeks,
    pop,
    expectedMove,
    estMargin,
    marginDetails,
    atmIv,
    yearsRemaining,
  } = useMemo(() => {
    const empty = {
      curve: [],
      breakevens: [],
      maxProfit: null,
      maxLoss: null,
      riskRewardRatio: null,
      netGreeks: null,
      pop: null,
      expectedMove: null,
      estMargin: null,
      marginDetails: null,
      atmIv: null,
      yearsRemaining: null,
    };
    if (!activeLegs.length || !displaySpot || !chainData?.selectedExpiry)
      return empty;
    try {
      const allStrikes = activeLegs.map((l) => l.strike).filter(Boolean);
      const minStrike = allStrikes.length ? Math.min(...allStrikes) : displaySpot;
      const maxStrike = allStrikes.length ? Math.max(...allStrikes) : displaySpot;
      const minPrice = Math.min(displaySpot * 0.90, minStrike * 0.95);
      const maxPrice = Math.max(displaySpot * 1.10, maxStrike * 1.05);

      let curveData =
        computePayoffCurve(activeLegs, {
          minPrice,
          maxPrice,
          steps: 150,
        }) || [];
      const breakEvs = computeBreakevens(curveData) || [];
      const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(
        activeLegs,
        curveData,
      );
      const rrRatio = computeRiskRewardRatio(mxProf, mxLoss);
      const netGrks = computeNetGreeks(activeLegs);

      const asOfMs = istWallClockToUtcMs(selectedDate, currentTime);
      const evaluationExpiry = evaluationExpiryOf(activeLegs) || chainData.selectedExpiry;
      const yearsRemaining = yearsToExpiry(evaluationExpiry, asOfMs);
      const atmRow = displayRows.find(
        (r) => r.strike === (liveChain?.atmStrike ?? chainData.atmStrike),
      );
      const atmIv = atmRow?.ce?.iv ?? atmRow?.pe?.iv ?? null;

      curveData = atmIv
        ? addMarkToMarketCurve(curveData, activeLegs, yearsRemaining, asOfMs)
        : curveData;
      const expMv = atmIv
        ? computeExpectedMove(displaySpot, atmIv, yearsRemaining)
        : null;
      const popVal = atmIv
        ? computePOP(curveData, displaySpot, atmIv, yearsRemaining)
        : null;
      const marginDet = computeMarginDetails(activeLegs, displaySpot, symbol);
      const marginVal = marginDet.fundsRequired || marginDet.estMargin || 0;

      return {
        curve: curveData,
        breakevens: breakEvs,
        maxProfit: mxProf,
        maxLoss: mxLoss,
        riskRewardRatio: rrRatio,
        netGreeks: netGrks,
        pop: popVal,
        expectedMove: expMv,
        estMargin: marginVal,
        marginDetails: marginDet,
        atmIv,
        yearsRemaining,
      };
    } catch (err) {
      console.error(err);
      return empty;
    }
  }, [
    activeLegs,
    displaySpot,
    displayRows,
    chainData,
    selectedDate,
    currentTime,
    liveChain,
    symbol,
  ]);

  // "Strategy P&L" must always track the position's real P&L — never the
  // Black-Scholes mark-to-market curve estimate. Once a replay has been run,
  // the backend's replay series already carries the exact real total P&L
  // (SL/TG-aware, from actual stored option prices) for the scrubbed minute.
  // Before any replay exists (still editing legs), fall back to totalLivePnl
  // — the same real LTP-diff-based P&L the Positions table's "Total P&L"
  // shows — not the theoretical curve.
  const strategyPnl = replayData
    ? (replayData.series[cursor]?.pnl ?? null)
    : totalLivePnl;



  // Shared between the standalone "Strategy Chart" tab and the top half of
  // "Strategy Chart + NIFTY Chart" — gates on "no positions yet" here (a
  // page-level concept); StrategyChart itself handles "not replayed yet" /
  // "no data" once positions do exist.
  function renderStrategyChart(height = 280) {
    if (!legs.length) {
      return (
        <div className="py-16 text-center text-xs text-gray-400">
          <div className="mb-2 text-3xl">📈</div>
          Add positions to view the strategy chart.
        </div>
      );
    }
    // Once a real replay has run it drives the chart (scrubbable); until then
    // the auto-preview does, so the chart reflects the strategy immediately.
    const chartData = replayData || previewReplay;
    if (!chartData) {
      return (
        <div className="py-16 text-center text-xs text-gray-400">
          <div className="mb-2 text-3xl">📈</div>
          {previewLoading
            ? "Building the strategy chart from real prices…"
            : "Preparing the strategy chart…"}
        </div>
      );
    }
    return (
      <StrategyChart
        ref={strategyChartRef}
        replayData={chartData}
        date={chartData.date || selectedDate}
        currentTime={currentTime}
        height={height}
        preview={!replayData}
      />
    );
  }

  return (
    <div
      className={hideChrome ? "w-full" : "bg-gray-50/60 dark:bg-gray-950 w-full min-h-screen text-gray-900 dark:text-gray-100 transition-colors duration-200"}
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      <div className={hideChrome ? "w-full" : "w-full px-2 sm:px-5 pt-3"}>
        <div className="w-full shrink-0 flex flex-col relative z-40">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 p-3 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {hideChrome ? (
                <div className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Historical replay · <span className="font-bold text-gray-900 dark:text-white">{symbol}</span>
                </div>
              ) : (
              <div className="flex items-center gap-1.5 relative">
                <button
                  onClick={() => cycleSymbol(-1)}
                  disabled={favorites.length < 2}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition"
                  aria-label="Previous favorite symbol"
                >
                  ‹
                </button>
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex items-center gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 px-3.5 py-1.5 text-xs font-bold text-gray-900 dark:text-white shadow-xs hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition"
                >
                  <SymbolLogo symbol={symbol} size="xs" />
                  <span className="tracking-wide">{symbol}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-400">▾</span>
                </button>
                <button
                  onClick={() => cycleSymbol(1)}
                  disabled={favorites.length < 2}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition"
                  aria-label="Next favorite symbol"
                >
                  ›
                </button>

                {pickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                    <div className="absolute left-0 top-full z-50 mt-1.5 w-64 max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl text-xs">
                      <div className="sticky top-0 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5">
                        <input
                          autoFocus
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder="Search symbol…"
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                        />
                      </div>
                      {filteredIndices.length > 0 && (
                        <div>
                          <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Index</div>
                          {filteredIndices.map((s) => (
                            <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                          ))}
                        </div>
                      )}
                      {filteredStocks.length > 0 && (
                        <div>
                          <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-400">Stocks</div>
                          {filteredStocks.map((s) => (
                            <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                          ))}
                        </div>
                      )}
                      {!filteredIndices.length && !filteredStocks.length && (
                        <div className="px-3 py-6 text-center text-gray-400">No matches</div>
                      )}
                    </div>
                  </>
                )}
              </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAutoplay}
                  disabled={!replayData}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                    playing
                      ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-md shadow-emerald-600/20 scale-[1.02]"
                      : "border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {playing ? "❚❚ Pause" : "▶ Autoplay"}
                </button>

                <div className="relative">
                  <button
                    onClick={() => setSpeedOpen((v) => !v)}
                    disabled={!replayData}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold bg-gray-50/80 dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 outline-none disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                  >
                    {MOVE_OPTIONS.find((o) => o.key === moveKey)?.label} / {EVERY_OPTIONS.find((o) => o.key === everyKey)?.label}
                  </button>

                  {speedOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setSpeedOpen(false)} />
                      <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3.5 shadow-2xl text-xs">
                        <div className="mb-3">
                          <div className="mb-1.5 font-bold text-gray-700 dark:text-gray-300">Move Step</div>
                          <div className="flex flex-col gap-1.5">
                            {MOVE_OPTIONS.map((o) => (
                              <label key={o.key} className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer hover:text-emerald-600">
                                <input type="radio" name="move" checked={moveKey === o.key} onChange={() => setMoveKey(o.key)} className="text-emerald-600" />
                                {o.label}
                              </label>
                            ))}
                            <label className="flex items-center gap-2 text-gray-400 dark:text-gray-400 cursor-not-allowed" title="Replay is scoped to one historical day — a 1-day step has nowhere to land">
                              <input type="radio" disabled />
                              1 day
                            </label>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1.5 font-bold text-gray-700 dark:text-gray-300">Tick Interval</div>
                          <div className="flex flex-col gap-1.5">
                            {EVERY_OPTIONS.map((o) => (
                              <label key={o.key} className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer hover:text-emerald-600">
                                <input type="radio" name="every" checked={everyKey === o.key} onChange={() => setEveryKey(o.key)} className="text-emerald-600" />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Date/time scrubber */}
            <div className="mt-2.5 flex w-full flex-wrap items-center gap-1.5 text-[11px]">
              <button
                onClick={() => jumpDate(-1)}
                disabled={!dates.length}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                -1d
              </button>
              <button
                onClick={jumpToStart}
                disabled={!chainData}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                SOD
              </button>
              <button
                onClick={() => jumpTimeBy(-3600)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                -1h
              </button>
              <button
                onClick={() => jumpTimeBy(-900)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                -15m
              </button>
              <button
                onClick={() => jumpTimeBy(-300)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                -5m
              </button>
              <button
                onClick={() => jumpTimeBy(-60)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                -1m
              </button>

              <div className="relative flex-[3] min-w-[170px]">
                <button
                  onClick={() => (calendarOpen ? setCalendarOpen(false) : openCalendar())}
                  disabled={!dates.length}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/90 dark:bg-gray-800/90 px-3 py-1.5 font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition shadow-xs"
                >
                  <SlCalender className="text-emerald-600 dark:text-emerald-400" />
                  <span>{formatDateTimeLabel(selectedDate, currentTime)}</span>
                  {selectedDate && dayExpirySet.has(selectedDate) && (
                    <span
                      className="rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] font-extrabold text-white"
                      title="This is an expiry day"
                    >
                      EXPIRY
                    </span>
                  )}
                </button>

                {calendarOpen && calendarYm && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setCalendarOpen(false)} />
                    <div className="absolute left-0 z-50 mt-1.5 flex w-[calc(100vw-2rem)] max-w-[440px] flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl sm:w-[440px] sm:flex-row">
                      {/* Month calendar */}
                      <div className="flex-1 border-b border-gray-100 dark:border-gray-800 p-3.5 sm:border-b-0 sm:border-r">
                        <div className="mb-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button onClick={() => shiftCalendarYear(-1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Previous year"><FiChevronsLeft size={14} /></button>
                            <button onClick={() => shiftCalendarMonth(-1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Previous month"><FiChevronLeft size={14} /></button>
                          </div>
                          <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{MONTHS_SHORT[calendarYm.m - 1]} {calendarYm.y}</div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => shiftCalendarMonth(1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Next month"><FiChevronRight size={14} /></button>
                            <button onClick={() => shiftCalendarYear(1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Next year"><FiChevronsRight size={14} /></button>
                          </div>
                        </div>
                        <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-400 dark:text-gray-400">
                          {WEEKDAYS.map((w) => <div key={w}>{w[0]}{w[1]}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {calendarDays.map((cell, i) => {
                            const dateStr = ymdToStr(cell.y, cell.m, cell.day);
                            const available = cell.inMonth && availableDateSet.has(dateStr);
                            const status = dateStatus[dateStr];
                            const optionOnly = status?.hasOptions && !status?.hasOhlcv;
                            const missingOhlcv = optionOnly;
                            const ohlcvOnly = !available && status?.hasOhlcv && !status?.hasOptions;
                            const isExpiry = available && dayExpirySet.has(dateStr);
                            const isHoliday =
                              cell.inMonth && !available && dateStr <= TODAY_IST && isWeekdayDate(cell.y, cell.m, cell.day);
                            const isSparse = available && sparseDateSet.has(dateStr);
                            const isPending = dateStr === pendingDate;
                            return (
                              <button
                                key={i}
                                disabled={!available}
                                onClick={() => pickCalendarDay(dateStr)}
                                title={isSparse ? "Only one stored option snapshot — no minute-level scrubbing on this day" : ohlcvOnly ? "OHLCV minute data exists, but option-chain minute data is missing" : missingOhlcv ? "Option-chain minute data exists, but OHLCV minute data is missing" : undefined}
                                className={`relative rounded-lg py-1.5 text-[12px] font-bold transition ${
                                  !cell.inMonth
                                    ? "text-gray-300 dark:text-gray-700 cursor-default"
                                    : isPending
                                      ? `bg-emerald-600 text-white ${isExpiry ? "ring-2 ring-emerald-400 ring-offset-1" : ""}`
                                      : isExpiry
                                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                        : available
                                          ? missingOhlcv
                                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200"
                                            : "text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                          : optionOnly
                                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 cursor-not-allowed"
                                            : ohlcvOnly
                                              ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 cursor-not-allowed"
                                              : "text-gray-300 dark:text-gray-700 cursor-not-allowed"
                                }`}
                              >
                                {cell.day}
                                {isSparse && !isPending && (
                                  <span className="absolute top-0 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                )}
                                {missingOhlcv && !isPending && <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-orange-500" />}
                                {ohlcvOnly && <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-sky-500" />}
                                {isHoliday && (
                                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gray-400" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Expiry</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" /> Holiday</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> EOD</span>
                        </div>
                      </div>

                      {/* Hour / minute picker */}
                      <div className="flex w-full shrink-0 flex-col sm:w-[130px]">
                        <div className="flex h-56 divide-x divide-gray-100 dark:divide-gray-800 overflow-hidden sm:h-72">
                          <div ref={hourListRef} className="flex-1 overflow-y-auto py-1 text-center">
                            {pendingHours.map((h) => (
                              <button
                                key={h}
                                ref={(el) => { if (h === pendingHour) activeHourBtnRef.current = el; }}
                                onClick={() => pickHour(h)}
                                className={`w-full py-1.5 text-[12px] font-bold ${
                                  h === pendingHour ? "bg-emerald-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                }`}
                              >
                                {h}
                              </button>
                            ))}
                          </div>
                          <div ref={minuteListRef} className="flex-1 overflow-y-auto py-1 text-center">
                            {ALL_MINUTES.map((min) => (
                              <button
                                key={min}
                                ref={(el) => { if (min === pendingMinute) activeMinuteBtnRef.current = el; }}
                                onClick={() => pickMinute(min)}
                                className={`w-full py-1.5 text-[12px] font-bold ${
                                  min === pendingMinute ? "bg-emerald-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                }`}
                              >
                                {min}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="border-t border-gray-100 dark:border-gray-800 p-2.5">
                          <button
                            onClick={confirmCalendarSelection}
                            disabled={!pendingDate}
                            className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 py-2 text-xs font-bold text-white hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-40 shadow-sm transition"
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => jumpTimeBy(60)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                +1m
              </button>
              <button
                onClick={() => jumpTimeBy(300)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                +5m
              </button>
              <button
                onClick={() => jumpTimeBy(900)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                +15m
              </button>
              <button
                onClick={() => jumpTimeBy(3600)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                +1h
              </button>
              <button
                onClick={jumpToEnd}
                disabled={!chainData}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                EOD
              </button>
              <button
                onClick={() => jumpDate(1)}
                disabled={!dates.length}
                className="flex-1 min-w-[42px] rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-800/80 px-2 py-1.5 text-center font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition"
              >
                +1d
              </button>
            </div>

            {!dates.length && !datesLoaded && (
              <div className="mt-2.5 text-[11px] font-medium text-gray-400">
                Loading available dates…
              </div>
            )}
            {!dates.length && datesLoaded && !chainError && (
              <div className="mt-2.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                No stored option data for {symbol} yet — try a different symbol or date.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="w-full flex flex-col gap-3 px-2 sm:px-5 pt-3 min-h-screen lg:flex-row">
        {/* Left Column: Option Chain Window */}
        {!hideChain && (
        <div className="w-full shrink-0 flex flex-col lg:w-[600px]">
          {chainData && (
            <div className="mb-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 p-3 shadow-xs backdrop-blur-md">
              {/* Row 1: StockMojo Market Indicators */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* SPOT */}
                  <div
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-50/80 dark:bg-emerald-950/40 dark:border-emerald-800/50 px-2.5 py-1 shadow-2xs"
                    title={`Spot underlying price (Change from day open: ${displaySpotChange != null ? (displaySpotChange >= 0 ? "+" : "") + displaySpotChange.toFixed(2) : "0"})`}
                  >
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">SPOT</span>
                    <span className="font-mono text-xs font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatPrice(displaySpot ?? displaySpotStored)}
                    </span>
                    {displaySpotChangePct != null && (
                      <span
                        className={`font-mono text-[10px] tabular-nums font-bold ${
                          displaySpotChangePct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                        title={`Spot % change from day open (${displaySpotChange >= 0 ? "+" : ""}${displaySpotChange.toFixed(2)})`}
                      >
                        ({displaySpotChangePct >= 0 ? "+" : ""}{displaySpotChangePct.toFixed(2)}%)
                      </span>
                    )}
                  </div>

                  {/* FUT & BASIS */}
                  <div
                    className="flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-50/80 dark:bg-blue-950/40 dark:border-blue-800/50 px-2.5 py-1 shadow-2xs"
                    title={displayFutExpiry ? `Front-month future, expiry ${formatExpiryShort(displayFutExpiry)} (${displayFutSource === "parity" ? "Synthetic Parity Forward" : "Historical Database"})` : "No futures data"}
                  >
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-400">FUT</span>
                    <span className={`font-mono text-xs font-bold tabular-nums ${displayFutPrice != null ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>
                      {displayFutPrice != null ? formatPrice(displayFutPrice) : "—"}
                    </span>
                    {displayFutBasis != null && (
                      <span className={`text-[10px] tabular-nums font-bold ${displayFutBasis >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} title="Futures Basis (Premium / Discount vs Spot)">
                        ({displayFutBasis >= 0 ? "+" : ""}{displayFutBasis.toFixed(1)}{displayFutBasisPct != null ? ` / ${displayFutBasisPct >= 0 ? "+" : ""}${displayFutBasisPct}%` : ""})
                      </span>
                    )}
                  </div>

                  {/* INDIA VIX */}
                  <div
                    className="flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-50/80 dark:bg-purple-950/40 dark:border-purple-800/50 px-2.5 py-1 shadow-2xs"
                    title={displayVix != null ? `India VIX (${displayVixSource === "implied" ? "ATM Implied Volatility" : "Real Historical Close"}${displayVixChange != null ? ` | Change from open: ${displayVixChange >= 0 ? "+" : ""}${displayVixChange.toFixed(2)}` : ""})` : "No stored India VIX"}
                  >
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-400">VIX</span>
                    <span className={`font-mono text-xs font-bold tabular-nums ${displayVix != null ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>
                      {displayVix != null ? formatPrice(displayVix) : "—"}
                    </span>
                    {displayVixChangePct != null && displayVix != null && (
                      <span
                        className={`font-mono text-[10px] tabular-nums font-bold ${
                          displayVixChangePct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                        title={`VIX % change from day open (${displayVixChange >= 0 ? "+" : ""}${displayVixChange.toFixed(2)})`}
                      >
                        ({displayVixChangePct >= 0 ? "+" : ""}{displayVixChangePct.toFixed(2)}%)
                      </span>
                    )}
                    {displayVixSource === "implied" && (
                      <span className="rounded bg-amber-200/80 dark:bg-amber-900/60 px-1 py-0.2 text-[8px] font-bold text-amber-900 dark:text-amber-200" title="Computed from ATM option chain Implied Volatility">IV</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHideChain(true)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="Hide Chain — give the right panel full width"
                  >
                    Hide Chain ⇥
                  </button>
                </div>
              </div>

              <hr className="my-2 border-gray-100 dark:border-gray-800" />

              {/* Row 2: Expiry Tabs & Settings */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 overflow-x-auto">
                  {chainData && chainData.expiries.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Nearest expiry tabs */}
                      {chainData.expiries.slice(0, 3).map((exp) => {
                        const isSelected = chainData.selectedExpiry === exp;
                        const dte = daysBetween(selectedDate, exp);
                        return (
                          <button
                            key={exp}
                            onClick={() => selectExpiry(exp)}
                            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 ${
                              isSelected
                                ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-md shadow-emerald-600/20 scale-[1.02]"
                                : "border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }`}
                          >
                            {formatExpiryShort(exp)} <span className={`text-[10px] font-normal ${isSelected ? "text-emerald-100" : "text-gray-400"}`}>({dte}d)</span>
                          </button>
                        );
                      })}

                      {chainData.expiries.length > 3 && (
                        <div className="relative">
                          <button
                            onClick={() => setExpiryDropdownOpen((v) => !v)}
                            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 ${
                              !chainData.expiries.slice(0, 3).includes(chainData.selectedExpiry)
                                ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-md shadow-emerald-600/20"
                                : "border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }`}
                          >
                            {!chainData.expiries.slice(0, 3).includes(chainData.selectedExpiry)
                              ? `${formatExpiryShort(chainData.selectedExpiry)} (${daysBetween(selectedDate, chainData.selectedExpiry)}d)`
                              : `More Expiries (${chainData.expiries.length - 3}) ▾`}
                          </button>
                          
                          {expiryDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setExpiryDropdownOpen(false)} />
                              <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[170px] max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 shadow-2xl text-xs animate-in fade-in slide-in-from-top-1 duration-200">
                                {chainData.expiries.slice(3).map((exp) => (
                                  <button
                                    key={exp}
                                    onClick={() => { selectExpiry(exp); setExpiryDropdownOpen(false); }}
                                    className={`block w-full px-4 py-2 text-left font-semibold transition-colors ${
                                      exp === chainData.selectedExpiry 
                                        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300" 
                                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                                    }`}
                                  >
                                    {formatExpiryShort(exp)} ({daysBetween(selectedDate, exp)}d)
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0 flex items-center gap-1">
                  <div className="relative">
                    <button
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="rounded-xl border border-gray-200 dark:border-gray-700 p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                      aria-label="Option chain settings"
                      title="Column settings"
                    >
                      <FiSettings size={16} />
                    </button>
                    
                    {settingsOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                        <div className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-2xl text-xs animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="font-bold text-gray-800 dark:text-gray-100">Chain Settings</span>
                            <button 
                              onClick={resetChainSettings} 
                              className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 transition-colors hover:underline"
                            >
                              Reset
                            </button>
                          </div>
                          
                          <div className="space-y-2">
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.oi} 
                                onChange={() => toggleColumn("oi")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">Open Interest</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.callDelta} 
                                onChange={() => toggleColumn("callDelta")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">Call/Put Delta</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.iv} 
                                onChange={() => toggleColumn("iv")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">IV</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.theta} 
                                onChange={() => toggleColumn("theta")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">Theta</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.vega} 
                                onChange={() => toggleColumn("vega")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">Vega</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                              <input 
                                type="checkbox" 
                                checked={columns.gamma} 
                                onChange={() => toggleColumn("gamma")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              /> 
                              <span className="select-none font-medium text-gray-700 dark:text-gray-200">Gamma</span>
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {chainError && (
            <div className="mb-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300 font-medium">
              {chainError}
            </div>
          )}

          {scrubError && (
            <div className="mb-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300 font-medium">
              Couldn't load that time: {scrubError}
            </div>
          )}

          {displayRows.length > 0 && (
            <div ref={chainScrollRef} className="max-h-[82vh] overflow-x-auto overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs custom-scrollbar">
              <table className="w-full min-w-[540px] border-collapse text-[11px] sm:text-[12.5px]">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-850 border-b border-gray-200 dark:border-gray-800 z-10 shadow-2xs">
                  <tr className="text-center font-extrabold text-xs">
                    <th colSpan={chainCeColCount} className="bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-b border-gray-200 dark:border-gray-800 py-2 tracking-wide">
                      CALLS (CE)
                    </th>
                    <th className="bg-gray-100/90 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800"></th>
                    <th colSpan={chainPeColCount} className="bg-rose-50/80 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-b border-gray-200 dark:border-gray-800 py-2 tracking-wide">
                      PUTS (PE)
                    </th>
                  </tr>
                  <tr className="text-[11px] text-gray-500 dark:text-gray-400">
                    {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold bg-emerald-50/30 dark:bg-emerald-950/20">Γ</th>}
                    {columns.vega && <th className="px-1.5 py-2 text-center font-semibold bg-emerald-50/30 dark:bg-emerald-950/20">Vega</th>}
                    {columns.theta && <th className="px-1.5 py-2 text-center font-semibold bg-emerald-50/30 dark:bg-emerald-950/20">Theta</th>}
                    {columns.iv && <th className="px-1.5 py-2 text-center font-semibold bg-emerald-50/30 dark:bg-emerald-950/20">IV</th>}
                    {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold bg-emerald-50/30 dark:bg-emerald-950/20 w-[13%]">CallΔ</th>}
                    <th className="px-2 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/30 w-[16%]">
                      LTP
                    </th>
                    {columns.oi && <th className="px-1.5 py-2 text-right font-semibold bg-emerald-50/30 dark:bg-emerald-950/20 w-[17%]">OI</th>}
                    <th className="py-2 text-center font-extrabold text-gray-800 dark:text-gray-100 bg-gray-100/90 dark:bg-gray-800 w-[16%] border-x border-gray-200 dark:border-gray-800">
                      Strike
                    </th>
                    {columns.oi && <th className="px-1.5 py-2 text-left font-semibold bg-rose-50/30 dark:bg-rose-950/20 w-[17%]">OI</th>}
                    <th className="px-2 py-2 text-left font-bold text-rose-700 dark:text-rose-400 bg-rose-50/40 dark:bg-rose-950/30 w-[16%]">
                      LTP
                    </th>
                    {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold bg-rose-50/30 dark:bg-rose-950/20 w-[10%]">PutΔ</th>}
                    {columns.iv && <th className="px-1.5 py-2 text-center font-semibold bg-rose-50/30 dark:bg-rose-950/20">IV</th>}
                    {columns.theta && <th className="px-1.5 py-2 text-center font-semibold bg-rose-50/30 dark:bg-rose-950/20">Theta</th>}
                    {columns.vega && <th className="px-1.5 py-2 text-center font-semibold bg-rose-50/30 dark:bg-rose-950/20">Vega</th>}
                    {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold bg-rose-50/30 dark:bg-rose-950/20">Γ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80 font-medium">
                  {displayRows.map((row) => {
                    const isAtm =
                      row.strike ===
                      (liveChain?.atmStrike ?? chainData?.atmStrike);
                    const ceItm = displaySpot != null && row.strike < displaySpot;
                    const peItm = displaySpot != null && row.strike > displaySpot;
                    const ceLeg = legsAt(row.strike, "CE")[0] || null;
                    const peLeg = legsAt(row.strike, "PE")[0] || null;
                    const ceNet = netPositionAt(row.strike, "CE");
                    const peNet = netPositionAt(row.strike, "PE");
                    return (
                      <tr
                        key={row.strike}
                        ref={isAtm ? atmRowRef : null}
                        className={`transition-colors ${
                          isAtm 
                            ? "bg-emerald-50/80 dark:bg-emerald-950/50 font-bold border-l-4 border-l-emerald-500 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-800/60" 
                            : row._anyStale 
                            ? "bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70" 
                            : "hover:bg-gray-50/80 dark:hover:bg-gray-800/60"
                        }`}
                      >
                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.gamma)}<StaleBadge stale={row.ce?._gammaStale} /></td>}
                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.vega)}<StaleBadge stale={row.ce?._vegaStale} /></td>}
                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.theta)}<StaleBadge stale={row.ce?._thetaStale} /></td>}
                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.iv != null ? `${row.ce.iv.toFixed(1)}%` : "-"}<StaleBadge stale={row.ce?._ivStale} /></td>}
                        {columns.callDelta && (
                          <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                            {formatDelta(row.ce?.delta)}
                            <StaleBadge stale={row.ce?._deltaStale} />
                          </td>
                        )}
                        <td className={`group px-2 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                          {ceNet !== 0 && (
                            <span className={`absolute -top-0.5 right-0.5 z-[1] rounded-full border bg-white dark:bg-gray-900 px-1 text-[8px] font-black leading-tight ${ceNet > 0 ? "border-emerald-500 text-emerald-600" : "border-rose-500 text-rose-600"}`}>
                              {ceNet > 0 ? `+${ceNet}` : ceNet}
                            </span>
                          )}
                          <span
                            className={`group-hover:invisible ${
                              isAtm
                                ? "inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-1.5 py-0.5 text-white shadow-xs font-bold"
                                : "text-gray-900 dark:text-gray-100 font-bold font-mono"
                            }`}
                          >
                            {formatPrice(row.ce?.ltp)}
                            <StaleBadge stale={row.ce?._ltpStale} label="no stored price at this minute — showing the last recorded value" />
                            {isAtm && <span className="text-[8px] font-extrabold tracking-wide">ATM</span>}
                          </span>
                          <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xs">
                            {!replayData && (ceLeg ? (
                              <>
                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty - 1)} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">−</button>
                                <span className="w-5 text-center text-[11px] font-bold tabular-nums text-gray-800 dark:text-gray-200">{ceLeg.qty}</span>
                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty + 1)} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => addLeg(row, "CE", "buy")}
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 text-[11px] font-black shadow-xs transition"
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => addLeg(row, "CE", "sell")}
                                  className="rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2 py-0.5 text-[11px] font-black shadow-xs transition"
                                >
                                  S
                                </button>
                              </>
                            ))}
                            <button onClick={() => setChartModal({ strike: row.strike, right: "CE" })} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[12px] leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title="View contract chart">📈</button>
                          </div>
                        </td>
                        {columns.oi && (
                          <td className={`relative p-0 tabular-nums ${ceItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                            <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                            {row.ce?._oiStale && <span className="absolute right-0.5 top-0.5"><StaleBadge stale label="no stored OI at this minute — last recorded value" /></span>}
                          </td>
                        )}
                        <td className="py-1.5 text-center bg-gray-50/60 dark:bg-gray-800/60 border-x border-gray-200 dark:border-gray-800">
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold tabular-nums font-mono ${
                              isAtm
                                ? "border-emerald-600 bg-emerald-600 text-white shadow-xs font-black"
                                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-2xs"
                            }`}
                          >
                            {row.strike}
                            {isAtm && (
                              <span className="rounded-sm bg-white/20 px-1 text-[8px] font-extrabold tracking-wide">
                                ATM
                              </span>
                            )}
                          </span>
                        </td>
                        {columns.oi && (
                          <td className={`relative p-0 tabular-nums ${peItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                            <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                            {row.pe?._oiStale && <span className="absolute left-0.5 top-0.5"><StaleBadge stale label="no stored OI at this minute — last recorded value" /></span>}
                          </td>
                        )}
                        <td className={`group px-2 py-1.5 text-left tabular-nums relative ${peItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                          {peNet !== 0 && (
                            <span className={`absolute -top-0.5 left-0.5 z-[1] rounded-full border bg-white dark:bg-gray-900 px-1 text-[8px] font-black leading-tight ${peNet > 0 ? "border-emerald-500 text-emerald-600" : "border-rose-500 text-rose-600"}`}>
                              {peNet > 0 ? `+${peNet}` : peNet}
                            </span>
                          )}
                          <span
                            className={`group-hover:invisible ${
                              isAtm
                                ? "inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-1.5 py-0.5 text-white shadow-xs font-bold"
                                : "text-gray-900 dark:text-gray-100 font-bold font-mono"
                            }`}
                          >
                            {formatPrice(row.pe?.ltp)}
                            <StaleBadge stale={row.pe?._ltpStale} label="no stored price at this minute — showing the last recorded value" />
                            {isAtm && <span className="text-[8px] font-extrabold tracking-wide">ATM</span>}
                          </span>
                          <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xs">
                            {!replayData && (peLeg ? (
                              <>
                                <button onClick={() => updateQty(peLeg.id, peLeg.qty - 1)} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">−</button>
                                <span className="w-5 text-center text-[11px] font-bold tabular-nums text-gray-800 dark:text-gray-200">{peLeg.qty}</span>
                                <button onClick={() => updateQty(peLeg.id, peLeg.qty + 1)} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => addLeg(row, "PE", "buy")}
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 text-[11px] font-black shadow-xs transition"
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => addLeg(row, "PE", "sell")}
                                  className="rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2 py-0.5 text-[11px] font-black shadow-xs transition"
                                >
                                  S
                                </button>
                              </>
                            ))}
                            <button onClick={() => setChartModal({ strike: row.strike, right: "PE" })} className="rounded-lg border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[12px] leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title="View contract chart">📈</button>
                          </div>
                        </td>
                        {columns.callDelta && (
                          <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
                            {formatDelta(row.pe?.delta)}
                            <StaleBadge stale={row.pe?._deltaStale} />
                          </td>
                        )}
                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.iv != null ? `${row.pe.iv.toFixed(1)}%` : "-"}<StaleBadge stale={row.pe?._ivStale} /></td>}
                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.theta)}<StaleBadge stale={row.pe?._thetaStale} /></td>}
                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.vega)}<StaleBadge stale={row.pe?._vegaStale} /></td>}
                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.gamma)}<StaleBadge stale={row.pe?._gammaStale} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!selectedDate && !chainError && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-xs text-gray-400 shadow-xs">
              Pick a symbol and a historical trading day above. The chain is
              real data stored from that day — build legs the same way as
              Strategy Builder, then replay the whole day minute by minute from
              real recorded prices.
            </div>
          )}
        </div>
        )}

        {hideChain && (
          <button
            onClick={() => setHideChain(false)}
            className="fixed left-3 top-20 z-30 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 shadow-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Show Option Chain ⇥
          </button>
        )}

        {/* Right Column: chart tabs & strategy dock */}
        <div className="flex-1 flex flex-col">
          {legs.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              {!replayData && (
                <button
                  onClick={runSimulation}
                  disabled={running || !activeLegs.length}
                  title={!activeLegs.length ? "Check at least one position in the Positions table first" : undefined}
                  className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2 text-xs font-bold text-white hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-50 shadow-md shadow-emerald-600/20 transition"
                >
                  {running
                    ? "Loading real prices…"
                    : `▶ Run Simulation (${selectedDate})`}
                </button>
              )}
              {replayData && (
                <button
                  onClick={() => {
                    setReplayData(null);
                    setChartTab("payoff");
                  }}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-xs transition"
                >
                  ← Edit legs
                </button>
              )}
              <SaveButton
                itemLabel="strategy"
                onSave={(token, name) => saveStrategy(token, { name, underlying: symbol, legs })}
              />
              <button
                onClick={() => setSavedOpen(true)}
                className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-xs transition"
              >
                Saved
              </button>
            </div>
          )}

          {savedOpen && (
            <SavedStrategiesModal
              onClose={() => setSavedOpen(false)}
              onLoad={(loadedLegs, underlying) => {
                if (underlying !== symbol) setSymbol(underlying);
                setReplayData(null);
                setChartTab("payoff");
                setLegs(loadedLegs.map((l) => ({ active: true, ...l, id: ++legIdCounter })));
                setSavedOpen(false);
              }}
            />
          )}

          {replayError && (
            <div className="mb-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300 font-medium">
              {replayError}
            </div>
          )}

          <SquareOffAlertBanner
            alert={squareOffAlert}
            onDismiss={() => setSquareOffAlert(null)}
            context="replay"
          />

          <div className="mb-4 flex flex-col gap-4 items-stretch md:flex-row">
            {legs.length > 0 && (
              <div className="w-full shrink-0 flex flex-col justify-between rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 p-4 shadow-xs space-y-3 md:w-64 backdrop-blur-md">
                {/* P&L Card with StockMojo Badge */}
                <div className="border-b border-gray-100 dark:border-gray-800/80 pb-3">
                  <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    P&L
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono tabular-nums ${
                        (strategyPnl ?? 0) >= 0
                          ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40"
                          : "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40"
                      }`}
                    >
                      {(strategyPnl ?? 0) >= 0 ? "+" : ""}{formatPrice(strategyPnl ?? 0)} ({((marginDetails?.fundsRequired || estMargin) ? (((strategyPnl ?? 0) / (marginDetails?.fundsRequired || estMargin)) * 100).toFixed(2) : "0.00")}%)
                    </span>
                  </div>
                </div>

                {/* Est Margin */}
                <div title="Estimated margin required by exchange/broker" className="border-b border-gray-100 dark:border-gray-800/80 pb-2.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400 dark:text-gray-400">
                    <span>Est. Margin</span>
                    {marginDetails?.isHedged && (
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">Hedged</span>
                    )}
                  </div>
                  <div className="text-sm font-bold font-mono tabular-nums text-gray-900 dark:text-gray-100 mt-0.5">
                    {marginDetails?.fundsRequired ? formatPrice(marginDetails.fundsRequired) : (estMargin ? formatPrice(estMargin) : "₹0.00")}
                  </div>
                  {marginDetails?.isHedged && marginDetails?.marginBenefit > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      <span>✓ Saved</span>
                      <span className="font-bold">{formatPrice(marginDetails.marginBenefit)}</span>
                    </div>
                  )}
                </div>

                {/* POP & Reward : Risk */}
                <div className="grid grid-cols-2 gap-2 border-b border-gray-100 dark:border-gray-800/80 pb-2.5">
                  <div>
                    <div className="text-[11px] font-semibold text-gray-400">POP</div>
                    <div className="mt-0.5 text-xs font-bold font-mono tabular-nums text-gray-800 dark:text-gray-200">
                      {pop != null ? `${pop.toFixed(0)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-gray-400">Reward : Risk</div>
                    <div className="mt-0.5 text-xs font-bold font-mono tabular-nums text-gray-800 dark:text-gray-200">
                      {riskRewardRatio && riskRewardRatio.startsWith("1 : ")
                        ? riskRewardRatio.replace("1 : ", "")
                        : (riskRewardRatio || "—")}
                    </div>
                  </div>
                </div>

                {/* Max Profit & Max Loss */}
                <div className="space-y-2 border-b border-gray-100 dark:border-gray-800/80 pb-2.5 text-xs font-mono">
                  <div>
                    <div className="text-[11px] font-semibold text-gray-400 font-sans">Max Profit</div>
                    <div className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {activeLegs.length === 0
                        ? "—"
                        : typeof maxProfit === "number"
                        ? `+${formatPrice(maxProfit)} (${((marginDetails?.fundsRequired || estMargin) ? ((maxProfit / (marginDetails?.fundsRequired || estMargin)) * 100).toFixed(2) : "0.00")}%)`
                        : (maxProfit || "Unlimited")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-gray-400 font-sans">Max Loss</div>
                    <div className="text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
                      {activeLegs.length === 0
                        ? "—"
                        : typeof maxLoss === "number"
                        ? `${formatPrice(maxLoss)} (${((marginDetails?.fundsRequired || estMargin) ? ((maxLoss / (marginDetails?.fundsRequired || estMargin)) * 100).toFixed(2) : "0.00")}%)`
                        : (maxLoss || "Unlimited")}
                    </div>
                  </div>
                </div>

                {/* Breakevens */}
                <div className="border-b border-gray-100 dark:border-gray-800/80 pb-2.5">
                  <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-400 mb-1">
                    Breakevens
                  </div>
                  {breakevens && breakevens.length ? (
                    <div className="space-y-1 font-mono text-xs">
                      {breakevens.map((be, i) => {
                        const pctFromSpot = displaySpot ? ((be - displaySpot) / displaySpot) * 100 : null;
                        return (
                          <div key={i} className="flex items-center justify-between font-bold tabular-nums text-gray-800 dark:text-gray-200">
                            <span>{Math.round(be)}</span>
                            {pctFromSpot != null && (
                              <span
                                className={`text-[10px] font-semibold ${
                                  pctFromSpot >= 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                ({pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(2)}%)
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 font-medium">None</div>
                  )}
                </div>

                {/* Greeks Grid */}
                {netGreeks && (
                  <div className="grid grid-cols-3 gap-1 pt-0.5 text-[10px]">
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-850 p-1.5 text-center border border-gray-100 dark:border-gray-800">
                      <div className="text-gray-400 font-bold">Delta (Δ)</div>
                      <div className={`font-black tabular-nums text-xs mt-0.5 ${netGreeks.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : netGreeks.delta < 0 ? "text-rose-600 dark:text-rose-400" : "text-gray-700 dark:text-gray-300"}`}>
                        {netGreeks.delta?.toFixed(2) ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-850 p-1.5 text-center border border-gray-100 dark:border-gray-800">
                      <div className="text-gray-400 font-bold">Theta (Θ)</div>
                      <div className={`font-black tabular-nums text-xs mt-0.5 ${netGreeks.theta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-700 dark:text-gray-300"}`}>
                        {netGreeks.theta?.toFixed(0) ?? 0}/d
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-850 p-1.5 text-center border border-gray-100 dark:border-gray-800">
                      <div className="text-gray-400 font-bold">Vega (ν)</div>
                      <div className="font-black tabular-nums text-xs mt-0.5 text-gray-700 dark:text-gray-300">
                        {netGreeks.vega?.toFixed(0) ?? 0}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 shadow-xs overflow-hidden flex flex-col backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-850 px-3 pt-2.5 overflow-x-auto">
                <div className="flex gap-1">
                  {CHART_TABS.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setChartTab(key)}
                      className={`shrink-0 rounded-t-xl px-3.5 py-2 text-xs font-bold transition-all ${
                        chartTab === key
                          ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 border border-b-0 border-gray-200 dark:border-gray-800 shadow-2xs"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 p-4">
                {chartTab === "payoff" && (
                  <div className="space-y-4">
                    {legs.length > 0 && curve.length > 0 ? (
                      <PayoffChart
                        curve={curve}
                        spotPrice={displaySpot}
                        breakevens={breakevens}
                        expectedMove={expectedMove}
                        atmIv={atmIv}
                        yearsRemaining={yearsRemaining}
                      />
                    ) : upcomingLegs.length > 0 ? (
                      <div className="py-16 text-center text-xs text-gray-500 dark:text-gray-400">
                        <div className="mb-2 text-3xl">⏳</div>
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                          Positions Scheduled for {upcomingLegs[0]?.time ? String(upcomingLegs[0].time).slice(0, 5) : "Later"}
                        </p>
                        <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                          Current simulated time is {currentTime}. Step forward to {upcomingLegs[0]?.time ? String(upcomingLegs[0].time).slice(0, 5) : "entry time"} or enter now to view the payoff chart.
                        </p>
                        <div className="mt-4 flex items-center justify-center gap-2">
                          {upcomingLegs[0]?.time && (
                            <button
                              onClick={() => scrubToTime(upcomingLegs[0].time)}
                              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition shadow-xs"
                            >
                              ▶ Step to {String(upcomingLegs[0].time).slice(0, 5)}
                            </button>
                          )}
                          <button
                            onClick={enterAllUpcomingNow}
                            className="rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                          >
                            Enter All Now @ {currentTime?.slice(0, 5)}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <PresetStrategies
                        data={liveChain || chainData}
                        onApply={applyPreset}
                        fetchExpiryRows={fetchExpiryRows}
                      />
                    )}
                  </div>
                )}

                {chartTab === "strategy" && renderStrategyChart(280)}

                {chartTab === "nifty" && (
                  <CandlestickChart ref={niftyChartRef} symbol={symbol} date={selectedDate} />
                )}

                {chartTab === "combined" && (
                  <div className="space-y-4">
                    <div>{renderStrategyChart(220)}</div>
                    <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                      <CandlestickChart ref={niftyChartRef} symbol={symbol} date={selectedDate} compact />
                    </div>
                    {legs.length > 0 && (
                      <div className="text-[11px] text-gray-400 dark:text-gray-400 text-center">
                        Crosshair is synced between the two charts above — move it on either one.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(legs.length > 0 || upcomingPositions.length > 0) && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 shadow-xs overflow-hidden backdrop-blur-md">
              <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-800 text-xs font-bold bg-gray-50/50 dark:bg-gray-850">
                <button
                  onClick={() => setTab("positions")}
                  className={`shrink-0 px-4 sm:px-6 py-3 transition-colors ${tab === "positions" ? "border-b-2 border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-gray-900" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
                >
                  Positions{enteredLegs.length > 0 ? ` (${enteredLegs.length})` : ""}
                </button>
                <button
                  onClick={() => setTab("greeks")}
                  className={`shrink-0 px-4 sm:px-6 py-3 transition-colors ${tab === "greeks" ? "border-b-2 border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-gray-900" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
                >
                  Portfolio Greeks
                </button>
                <button
                  onClick={() => setTab("upcoming")}
                  className={`shrink-0 px-4 sm:px-6 py-3 transition-colors ${tab === "upcoming" ? "border-b-2 border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-gray-900" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
                >
                  Upcoming Positions{(upcomingLegs.length + upcomingPositions.length) > 0 ? ` (${upcomingLegs.length + upcomingPositions.length})` : ""}
                </button>
              </div>

              {tab === "positions" ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/40 px-4 py-2.5 text-[11px]">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allLegsActive}
                          disabled={!!replayData}
                          onChange={toggleSelectAllLegs}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                        />
                      </label>
                      <button
                        onClick={() => setLegsTopFirst((v) => !v)}
                        className="rounded-full bg-blue-600 px-3 py-0.5 text-[11px] font-bold text-white shadow-2xs hover:bg-blue-700 transition"
                      >
                        {legsTopFirst ? "Top" : "Bottom"}
                      </button>
                      <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-0.5">
                        <span className="text-gray-500 dark:text-gray-400 font-medium">Multiplier:</span>
                        <button
                          onClick={() => bulkAdjustLots(-1)}
                          disabled={!!replayData}
                          className="px-1 text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-5 text-center font-bold tabular-nums text-gray-800 dark:text-gray-200">{commonLots ?? "1"}</span>
                        <button
                          onClick={() => bulkAdjustLots(1)}
                          disabled={!!replayData}
                          className="px-1 text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30"
                        >
                          +
                        </button>
                        <span className="ml-1 text-gray-400 dark:text-gray-500">|</span>
                        <span className="ml-1 text-gray-500 dark:text-gray-400 font-medium">Qty:</span>
                        <span className="font-bold tabular-nums text-gray-800 dark:text-gray-200">
                          {(commonLots ?? 1) * (legs[0]?.lotSize || 65)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 font-mono text-xs">
                        <span className="text-gray-500 dark:text-gray-400 font-sans font-medium text-[11px]">Total P&L:</span>
                        <span className={`font-bold tabular-nums ${totalLivePnl != null && totalLivePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          {totalLivePnl != null ? `${totalLivePnl >= 0 ? "+" : ""}${formatPrice(totalLivePnl)}` : "+0"}
                          <span className="ml-1 text-[10px] font-medium">
                            ({((marginDetails?.fundsRequired || estMargin) ? (((totalLivePnl ?? 0) / (marginDetails?.fundsRequired || estMargin)) * 100).toFixed(2) : "0.00")}%)
                          </span>
                        </span>
                      </div>
                      <button
                        onClick={archiveCurrentPosition}
                        disabled={!legs.length}
                        title="Snapshot the current legs into Upcoming Positions and clear them"
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1 font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition text-[11px]"
                      >
                        <FiArchive className="h-3.5 w-3.5" /> Archive
                      </button>
                      <button
                        onClick={resetWorkspace}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1 font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-[11px]"
                      >
                        Reset/New
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse text-xs">
                    <thead>
                      <tr className="text-gray-400 dark:text-gray-400 bg-gray-50/40 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800">
                        <th className="px-3 py-2 w-8" title="Include in payoff calculation"></th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px] w-12">
                          Side
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px] w-14">
                          Lots
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-[11px]">
                          Expiry
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px]">
                          Strike
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px]">
                          Type
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-[11px]">
                          Entry
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-[11px]">
                          LTP/Exit
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-[11px]">
                          P&L
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px]">
                          SL/TG
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-[11px] w-20">
                          Exit
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800 font-medium">
                      {orderedLegs.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
                            {upcomingLegs.length > 0 ? (
                              <div className="flex flex-col items-center justify-center gap-2.5">
                                <p className="font-semibold text-gray-700 dark:text-gray-300">
                                  No active positions at {currentTime}.
                                  <span className="ml-1 text-gray-500 font-normal">
                                    {upcomingLegs.length} position{upcomingLegs.length > 1 ? "s are" : " is"} scheduled to enter at {upcomingLegs[0]?.time ? String(upcomingLegs[0].time).slice(0, 5) : "a later time"}.
                                  </span>
                                </p>
                                <div className="flex flex-wrap items-center justify-center gap-2">
                                  {upcomingLegs[0]?.time && (
                                    <button
                                      onClick={() => scrubToTime(upcomingLegs[0].time)}
                                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 transition shadow-2xs"
                                    >
                                      ▶ Step to {String(upcomingLegs[0].time).slice(0, 5)}
                                    </button>
                                  )}
                                  <button
                                    onClick={enterAllUpcomingNow}
                                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                  >
                                    Enter All Now @ {currentTime?.slice(0, 5)}
                                  </button>
                                  <button
                                    onClick={() => setTab("upcoming")}
                                    className="rounded-lg px-2 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline transition"
                                  >
                                    View Upcoming Positions →
                                  </button>
                                </div>
                              </div>
                            ) : (
                              "No positions added yet. Click Buy (B) or Sell (S) in the Option Chain above."
                            )}
                          </td>
                        </tr>
                      ) : (
                        orderedLegs.map((leg) => {
                        const row = displayRows.find(
                          (r) => r.strike === leg.strike,
                        );
                        const liveLtp = row
                          ? leg.type === "CE"
                            ? row.ce?.ltp
                            : row.pe?.ltp
                          : null;
                        const currentLtp = leg.ltpOverride ?? liveLtp;
                        const livePnl = legLivePnl(leg);
                        const included = leg.active !== false;
                        const canPickStrike = leg.expiry === chainData?.selectedExpiry;
                        const replayOutcome = replayData?.legs?.find(
                          (l) => l.strike === leg.strike && l.type === leg.type && l.action === leg.action,
                        );
                        return (
                          <tr
                            key={leg.id}
                            className={`hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors ${included ? "" : "opacity-50"}`}
                          >
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={included}
                                disabled={!!replayData}
                                onChange={() => toggleLegActive(leg.id)}
                                title={included ? "Included in payoff calculation — uncheck to exclude" : "Excluded from payoff calculation — check to include"}
                                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => toggleLegSide(leg.id)}
                                disabled={!!replayData}
                                title="Click to flip Buy/Sell"
                                className={`w-7 h-6 inline-flex items-center justify-center rounded-md text-xs font-black transition border ${
                                  leg.action === "buy"
                                    ? "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100"
                                    : "border-rose-500 text-rose-600 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100"
                                } disabled:opacity-70 disabled:cursor-not-allowed`}
                              >
                                {leg.action === "buy" ? "B" : "S"}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="font-bold tabular-nums text-gray-800 dark:text-gray-200">
                                {leg.qty}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-left">
                              <select
                                value={leg.expiry || ""}
                                disabled={!!replayData || !chainData?.expiries?.length}
                                onChange={(e) => updateLegExpiry(leg.id, e.target.value)}
                                className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200 outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer"
                              >
                                {(chainData?.expiries?.includes(leg.expiry) ? chainData.expiries : [leg.expiry, ...(chainData?.expiries || [])]).map((exp) => (
                                  <option key={exp} value={exp}>{formatExpiryShort(exp)}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-center font-bold tabular-nums text-gray-900 dark:text-gray-100 font-mono">
                              {canPickStrike ? (
                                <div className="inline-flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => rollLegStrike(leg.id, -1)}
                                    disabled={!!replayData}
                                    className="h-5 w-5 inline-flex items-center justify-center rounded border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                                    title="Roll to lower strike"
                                  >
                                    −
                                  </button>
                                  <span className="tabular-nums px-1">{leg.strike}</span>
                                  <button
                                    onClick={() => rollLegStrike(leg.id, 1)}
                                    disabled={!!replayData}
                                    className="h-5 w-5 inline-flex items-center justify-center rounded border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                                    title="Roll to higher strike"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <span title="Switch this leg's expiry to the currently displayed one to change its strike">
                                  {leg.strike}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                  leg.type === "CE"
                                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60"
                                    : "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60"
                                }`}
                              >
                                {leg.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.05"
                                value={leg.premium}
                                disabled={!!replayData}
                                onChange={(e) => updateLeg(leg.id, { premium: Number(e.target.value) })}
                                title="Entry price — editable"
                                className="w-16 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-900 dark:text-gray-100 focus:border-blue-500 outline-none disabled:opacity-50 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.05"
                                value={currentLtp ?? ""}
                                disabled={!!replayData}
                                onChange={(e) => updateLeg(leg.id, { ltpOverride: e.target.value === "" ? null : Number(e.target.value) })}
                                title="LTP — editable"
                                className={`w-16 rounded border px-1.5 py-0.5 text-right font-mono tabular-nums outline-none focus:border-blue-500 disabled:opacity-50 text-xs ${leg.ltpOverride != null ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-gray-900 dark:text-gray-100" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"}`}
                              />
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-bold font-mono tabular-nums ${livePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                            >
                              {livePnl != null ? `${livePnl >= 0 ? "+" : ""}${formatPrice(livePnl)}` : "+0"}
                            </td>
                            <td className="px-3 py-2 text-center relative">
                              <button
                                onClick={() => openSlTgModal(leg)}
                                disabled={!!replayData}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 transition disabled:opacity-30"
                                title={leg.slPercent != null || leg.tgPercent != null ? `SL ${leg.slPercent ?? "—"}% / TG ${leg.tgPercent ?? "—"}%` : "Set SL/TG"}
                              >
                                <span className="font-bold text-xs">@</span>
                              </button>
                              {(leg.slPercent != null || leg.tgPercent != null) && (
                                <div className="text-[9px] font-semibold text-gray-400">SL {leg.slPercent ?? "—"}% / TG {leg.tgPercent ?? "—"}%</div>
                              )}
                              {replayOutcome?.exitReason && (
                                <div className={`mt-0.5 text-[9px] font-bold ${replayOutcome.exitReason === "target" ? "text-emerald-600" : "text-rose-600"}`}>
                                  {replayOutcome.exitReason === "target" ? "Target hit" : "SL hit"} @ {replayOutcome.exitTime?.slice(0, 5)}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => resetLegEntryToLtp(leg.id)}
                                  disabled={!!replayData}
                                  className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition disabled:opacity-30 p-1"
                                  title="Reset entry to current LTP"
                                >
                                  <FiRefreshCw size={12} />
                                </button>
                                <button
                                  onClick={() => removeLeg(leg.id)}
                                  disabled={!!replayData}
                                  className="text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition disabled:opacity-30 p-1"
                                  title="Remove leg"
                                >
                                  <FiTrash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }))}
                    </tbody>
                  </table>
                  </div>
                </>
                ) : tab === "greeks" ? (
                  <PortfolioGreeksTable legs={legs} netGreeks={netGreeks} />
                ) : (
                  <div>
                    {/* Scheduled Active Legs (time > currentTime) */}
                    {upcomingLegs.length > 0 && (
                      <div className="border-b border-gray-100 dark:border-gray-800">
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-2.5 text-[11px] border-b border-blue-100/60 dark:border-blue-900/40">
                          <div>
                            <span className="font-bold text-blue-900 dark:text-blue-200">
                              Scheduled Positions ({upcomingLegs.length})
                            </span>
                            <span className="ml-2 text-gray-500 dark:text-gray-400">
                              (Will activate at scheduled time. Simulated time: {currentTime})
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={enterAllUpcomingNow}
                              className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 transition shadow-2xs"
                            >
                              Enter All Now @ {currentTime?.slice(0, 5)}
                            </button>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {upcomingLegs.map((leg) => (
                            <div key={leg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[11px] hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition">
                              <span
                                className={`w-11 shrink-0 rounded-md px-2 py-0.5 text-center text-[10px] font-black text-white shadow-xs ${
                                  leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"
                                }`}
                              >
                                {leg.action === "buy" ? "BUY" : "SELL"}
                              </span>
                              <span
                                className={`w-8 shrink-0 rounded-md px-2 py-0.5 text-center text-[10px] font-extrabold ${
                                  leg.type === "CE" ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300" : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                                }`}
                              >
                                {leg.type}
                              </span>
                              <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100 font-mono">{leg.strike}</span>
                              <span className="text-gray-400 dark:text-gray-400 font-medium">×{leg.qty} lot{leg.qty > 1 ? "s" : ""}</span>
                              <span className="text-gray-500 dark:text-gray-400 font-mono">
                                Entry: {formatPrice(leg.premium)}
                              </span>
                              <span className="rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-bold font-mono">
                                ⏳ Scheduled @ {leg.time ? String(leg.time).slice(0, 5) : "—"}
                              </span>
                              <div className="ml-auto flex items-center gap-2">
                                {leg.time && (
                                  <button
                                    onClick={() => scrubToTime(leg.time)}
                                    title={`Step time forward to ${leg.time}`}
                                    className="rounded border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                                  >
                                    ▶ Step to {String(leg.time).slice(0, 5)}
                                  </button>
                                )}
                                <button
                                  onClick={() => enterLegNow(leg.id)}
                                  title={`Activate position right now at ${currentTime}`}
                                  className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-blue-700 transition"
                                >
                                  Enter Now
                                </button>
                                <button
                                  onClick={() => removeLeg(leg.id)}
                                  title="Remove leg"
                                  className="rounded p-1 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                                >
                                  <FiTrash2 size={13} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Archived Strategy Snapshots */}
                    {upcomingPositions.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/40 px-4 py-2 text-[11px]">
                          <span className="font-bold text-gray-700 dark:text-gray-300">
                            Archived Strategy Snapshots ({upcomingPositions.length})
                          </span>
                          <button
                            onClick={resetWorkspace}
                            className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-0.5 font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-[10px]"
                          >
                            Reset Workspace
                          </button>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {upcomingPositions.map((entry) => {
                            const netCost = entry.legs.reduce(
                              (sum, leg) => sum + (leg.action === "buy" ? -1 : 1) * leg.premium * legMultiplier(leg),
                              0
                            );
                            const orderedEntryLegs = [
                              ...entry.legs.filter((leg) => leg.action === "buy"),
                              ...entry.legs.filter((leg) => leg.action === "sell"),
                            ];
                            return (
                              <div key={entry.id}>
                                <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50/60 dark:bg-gray-800/60 px-4 py-2 text-[11px]">
                                  <div className="font-bold text-gray-800 dark:text-gray-200">
                                    {entry.date}
                                    <span className="ml-2 font-normal text-gray-400 dark:text-gray-400">
                                      {entry.legs.length} leg{entry.legs.length > 1 ? "s" : ""}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div>
                                      <span className="text-gray-400 dark:text-gray-400 font-medium">Net {netCost >= 0 ? "Credit" : "Debit"}: </span>
                                      <span className={`font-black tabular-nums ${netCost >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {formatPrice(Math.abs(netCost))}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => removeUpcomingPosition(entry.id)}
                                      title="Remove this entry"
                                      className="rounded-lg p-1 text-gray-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 transition"
                                    >
                                      <FiTrash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                                <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                                  {orderedEntryLegs.map((leg) => (
                                    <div key={leg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[11px]">
                                      <span
                                        className={`w-11 shrink-0 rounded-md px-2 py-0.5 text-center text-[10px] font-black text-white shadow-xs ${
                                          leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"
                                        }`}
                                      >
                                        {leg.action === "buy" ? "BUY" : "SELL"}
                                      </span>
                                      <span
                                        className={`w-8 shrink-0 rounded-md px-2 py-0.5 text-center text-[10px] font-extrabold ${
                                          leg.type === "CE" ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300" : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                                        }`}
                                      >
                                        {leg.type}
                                      </span>
                                      <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100 font-mono">{leg.strike}</span>
                                      <span className="text-gray-400 dark:text-gray-400 font-medium">×{leg.qty} lot{leg.qty > 1 ? "s" : ""}</span>
                                      <span className="ml-auto tabular-nums text-gray-700 dark:text-gray-300 font-mono">
                                        LTP {formatPrice(leg.premium)}
                                      </span>
                                      <span className="tabular-nums text-gray-400 dark:text-gray-400">
                                        @ {leg.time ? String(leg.time).slice(0, 5) : "—"}
                                      </span>
                                      <button
                                        onClick={() => removeUpcomingLeg(entry.id, leg.id)}
                                        title="Remove this leg"
                                        className="rounded p-1 text-gray-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 transition"
                                      >
                                        <FiTrash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {upcomingLegs.length === 0 && upcomingPositions.length === 0 && (
                      <div className="px-4 py-10 text-center text-xs text-gray-400 dark:text-gray-400">
                        No upcoming or archived positions. Positions scheduled for later in the day will appear here.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>

      {chartModal && (
        <ContractChartModal
          symbol={symbol}
          strike={chartModal.strike}
          right={chartModal.right}
          expiry={chainData?.selectedExpiry}
          onClose={() => setChartModal(null)}
          onAddLeg={(action) => {
            const rows = liveChain?.rows || chainData?.rows || [];
            const row = rows.find((r) => r.strike === chartModal.strike) || {
              strike: chartModal.strike,
              ce: {},
              pe: {},
            };
            addLeg(row, chartModal.right, action);
          }}
        />
      )}

      {slTgEditId != null && (
        <SlTgModal
          leg={legs.find((l) => l.id === slTgEditId)}
          symbol={symbol}
          draft={slTgDraft}
          onDraftChange={setSlTgDraft}
          onClose={closeSlTgModal}
          onSave={() => saveSlTgModal(slTgEditId)}
          footer="replay"
        />
      )}
    </div>
  );
}

