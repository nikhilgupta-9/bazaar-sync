import { useEffect, useMemo, useRef, useState } from "react";
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
import { formatPrice } from "../utils/format";
import {
  computePayoffCurve,
  computeBreakevens,
  computeMaxProfitLoss,
  computeNetGreeks,
  addMarkToMarketCurve,
  computeExpectedMove,
  computePOP,
  evaluationExpiryOf,
  otherAction,
} from "../utils/payoff";
import { yearsToExpiry } from "../utils/blackScholes";
import OiBar from "../components/OiBar";
import PayoffChart from "../components/PayoffChart";
import PresetStrategies from "../components/PresetStrategies";
import CandlestickChart from "../components/CandlestickChart";
import StrategyChart from "../components/StrategyChart";
import { SlCalender } from "react-icons/sl";
import { FiSettings } from "react-icons/fi";

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

// Same searchable-dropdown row as Strategy Builder's symbol picker (star
// toggles favorites, which the pill's chevrons cycle through) — kept as its
// own local copy rather than a shared import since each page owns its own
// symbol-picker state independently (see StrategyBuilder.jsx for the sibling).
function SymbolOption({ sym, active, isFav, onPick, onToggleFav }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 ${active ? "bg-blue-50" : ""}`}>
      <button onClick={() => onPick(sym)} className="flex-1 text-left font-medium text-gray-700">{sym}</button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFav(sym); }}
        className={`px-1 ${isFav ? "text-amber-500" : "text-gray-300 hover:text-gray-400"}`}
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

function legFromRow(row, right, action, expiry, lotSize) {
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
    active: true, // unchecked in the Positions table = kept but excluded from payoff/metrics
  };
}

function Stat({ label, value, tone, hint }) {
  return (
    <div
      title={hint}
      className="border-b border-gray-100 pb-2 last:border-0 last:pb-0"
    >
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-gray-800"}`}
      >
        {value}
      </div>
    </div>
  );
}

export default function Simulator() {
  // Deep-linked from Option Chain's "Historical"/"Previous day" controls:
  // ?symbol=BANKNIFTY opens on that symbol instead of always NIFTY, and
  // ?jump=prev selects the previous trading day (dates[1]) instead of the
  // latest one on first load. Consumed once — a later manual symbol switch
  // via the picker shouldn't keep re-applying "prev".
  const [searchParams, setSearchParams] = useSearchParams();
  const initialJumpRef = useRef(searchParams.get("jump"));
  const atmRowRef = useRef(null);
  const [symbol, setSymbol] = useState(() => searchParams.get("symbol")?.toUpperCase() || "NIFTY");
  const [dates, setDates] = useState([]); // DESC (most recent first), per /dates
  const [datesLoaded, setDatesLoaded] = useState(false); // distinguishes "still fetching" from "fetched, genuinely empty"
  const [sparseDates, setSparseDates] = useState([]); // dates with only 1 stored snapshot (EOD-only, no scrubbing)
  const [selectedDate, setSelectedDate] = useState("");
  const [chainData, setChainData] = useState(null); // metadata holder: expiries/times/selectedExpiry
  const [liveChain, setLiveChain] = useState(null); // chain rows at whichever instant is being viewed
  const [chainError, setChainError] = useState(null);
  const [scrubError, setScrubError] = useState(null); // -1m/+5m/etc failures — previously swallowed silently
  const [legs, setLegs] = useState([]);
  const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'
  const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'nifty' | 'combined'
  // Underlying lightweight-charts instances, exposed via forwardRef, so the
  // "combined" tab can sync crosshair + pan/zoom between the two separate
  // chart instances (StrategyChart's candles aren't a pane inside
  // CandlestickChart or vice versa — they're two independent charts that
  // need to be told to move together, see the sync effect below).
  const strategyChartRef = useRef(null);
  const niftyChartRef = useRef(null);

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
  }, [chartTab, replayData, selectedDate]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [hideChain, setHideChain] = useState(false);
  const [legsTopFirst, setLegsTopFirst] = useState(true);
  const [slTgEditId, setSlTgEditId] = useState(null);

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
    setSelectedDate("");
    setChainData(null);
    setLiveChain(null);
    setChainError(null);
    setScrubError(null);
    setLegs([]);
    setReplayData(null);
    setReplayError(null);
    setChartTab("payoff");
    setCalendarYm(null);
    setChartModal(null);
    fetchSimulatorDates(symbol)
      .then((res) => {
        setDates(res.dates);
        setSparseDates(res.sparseDates || []);
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

  function loadChain(date, expiry, time) {
    setChainError(null);
    setScrubError(null); // a fresh full chain load supersedes any earlier scrub failure
    fetchSimulatorChain(symbol, { date, expiry, time })
      .then((res) => {
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
    setSelectedDate(date);
    setLegs([]);
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
    setLegs([]);
    setReplayData(null);
    setChartTab("payoff");
    loadChain(selectedDate, expiry);
  }

  // The instant currently on screen, whichever mode we're in.
  const currentTime = replayData
    ? replayData.series[cursor]?.time
    : liveChain?.selectedTime || chainData?.selectedTime;

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
      .then((res) => setLiveChain(res))
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
      prev.length >= 6 ? prev : [...prev, legFromRow(row, right, action, chainData?.selectedExpiry, lotSize)],
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

  // SL/TG here are a planning note stored on the leg, NOT an executed order —
  // same as StrategyBuilder.jsx (this workspace has no live monitoring/
  // auto-exit engine; automatic SL%/target% exits only exist in the separate
  // Backtest engine, which runs against a date range, not a single replayed day).
  function setLegSlTg(id, slPercent, tgPercent) {
    updateLeg(id, {
      slPercent: slPercent === "" ? null : Number(slPercent),
      tgPercent: tgPercent === "" ? null : Number(tgPercent),
    });
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
  const allLegsActive = legs.length > 0 && legs.every((l) => l.active !== false);
  function toggleSelectAllLegs() {
    if (replayData) return;
    const shouldInclude = !allLegsActive;
    setLegs((prev) => prev.map((l) => ({ ...l, active: shouldInclude })));
  }

  // Chain-row inline position display, same pattern as StrategyBuilder.jsx —
  // which leg(s) match this exact strike/right in the currently displayed
  // expiry, plus signed net lots (buy=+qty, sell=-qty) shown as a badge.
  function legsAt(strike, right) {
    return legs.filter((l) => l.strike === strike && l.type === right && l.expiry === chainData?.selectedExpiry);
  }
  function netPositionAt(strike, right) {
    const matches = legsAt(strike, right);
    if (!matches.length) return 0;
    return matches.reduce((sum, l) => sum + (l.action === "buy" ? l.qty : -l.qty), 0);
  }

  // Mini contract-chart popup, opened from the small chart icon on hover.
  const [chartModal, setChartModal] = useState(null); // { strike, right } | null

  function resetWorkspace() {
    setLegs([]);
    setReplayData(null);
    setChartTab("payoff");
  }

  function applyPreset(presetLegs) {
    setLegs(presetLegs.map((l) => ({ active: true, ...l, id: ++legIdCounter })));
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
        legs: legs.filter((l) => l.active !== false).map(({ strike, type, action, qty }) => ({
          strike,
          type,
          action,
          qty,
        })),
      });
      setReplayData(res);
      setCursor(0);
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
        setCursor(0);
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
        if (!cancelled) setLiveChain(res);
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

  function scrollToAtm(behavior = "smooth") {
    atmRowRef.current?.scrollIntoView({ behavior, block: "center" });
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
  }, [chainData?.date, chainData?.selectedExpiry, symbol]);
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

  function legLivePnl(leg) {
    const row = displayRows.find((r) => r.strike === leg.strike);
    const currentLtp = row
      ? leg.type === "CE"
        ? row.ce?.ltp
        : row.pe?.ltp
      : null;
    if (currentLtp == null) return null;
    const diff =
      leg.action === "buy"
        ? currentLtp - leg.premium
        : leg.premium - currentLtp;
    return diff * leg.qty;
  }

  // Legs the Positions table checkbox has left checked — the payoff curve,
  // Greeks, POP, and max-profit/loss below are recalculated from only these,
  // so unchecking a leg removes it from every metric without deleting the
  // row (see toggleLegActive).
  const activeLegs = useMemo(() => legs.filter((l) => l.active !== false), [legs]);

  // Positions toolbar — same pattern as StrategyBuilder.jsx: reorder toggle,
  // a lots stepper that scales every leg at once, and a combined live P&L
  // readout across all legs.
  const orderedLegs = useMemo(() => (legsTopFirst ? legs : [...legs].reverse()), [legs, legsTopFirst]);
  const commonLots = legs.length && legs.every((l) => l.qty === legs[0].qty) ? legs[0].qty : null;
  const totalLots = legs.reduce((sum, l) => sum + l.qty, 0);
  const totalLivePnl = useMemo(() => {
    if (!legs.length) return null;
    let sum = 0;
    for (const leg of legs) {
      const v = legLivePnl(leg);
      if (v == null) return null;
      sum += v;
    }
    return sum;
  }, [legs, displayRows]);

  // Theoretical payoff at expiry — same math/pattern as Strategy Builder,
  // just priced "as of" the historical instant being viewed instead of now.
  const {
    curve,
    breakevens,
    maxProfit,
    maxLoss,
    netGreeks,
    currentPnl,
    pop,
    expectedMove,
  } = useMemo(() => {
    const empty = {
      curve: [],
      breakevens: [],
      maxProfit: null,
      maxLoss: null,
      netGreeks: null,
      currentPnl: null,
      pop: null,
      expectedMove: null,
    };
    if (!activeLegs.length || !displaySpot || !chainData?.selectedExpiry)
      return empty;
    try {
      const spread = displaySpot * 0.08;
      let curveData =
        computePayoffCurve(activeLegs, {
          minPrice: displaySpot - spread,
          maxPrice: displaySpot + spread,
        }) || [];
      const breakEvs = computeBreakevens(curveData) || [];
      const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(
        activeLegs,
        curveData,
      );
      const netGrks = computeNetGreeks(activeLegs);

      const asOfMs = istWallClockToUtcMs(selectedDate, currentTime);
      // For a single-expiry strategy this is just chainData.selectedExpiry;
      // for a calendar spread it's the near leg's expiry — the meaningful
      // horizon for "at expiry" (see payoff.js's evaluationExpiryOf).
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

      const closest = curveData.length
        ? curveData.reduce((a, b) =>
            Math.abs(b.price - displaySpot) < Math.abs(a.price - displaySpot)
              ? b
              : a,
          )
        : { pnl: 0 };

      return {
        curve: curveData,
        breakevens: breakEvs,
        maxProfit: mxProf,
        maxLoss: mxLoss,
        netGreeks: netGrks,
        currentPnl: closest.pnl,
        pop: popVal,
        expectedMove: expMv,
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
  ]);

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
    return (
      <StrategyChart
        ref={strategyChartRef}
        replayData={replayData}
        date={replayData?.date || selectedDate}
        currentTime={currentTime}
        height={height}
      />
    );
  }

  return (
    <div className="bg-gray-50/40">
      <div className="mx-auto max-w-[1600px] px-5 pt-2">
        <div className="w-full shrink-0 flex flex-col">
          <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 relative">
                <button
                  onClick={() => cycleSymbol(-1)}
                  disabled={favorites.length < 2}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  aria-label="Previous favorite symbol"
                >
                  ‹
                </button>
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm font-bold text-gray-900 hover:border-blue-400 hover:bg-blue-50"
                >
                  {symbol}
                </button>
                <button
                  onClick={() => cycleSymbol(1)}
                  disabled={favorites.length < 2}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  aria-label="Next favorite symbol"
                >
                  ›
                </button>

                {pickerOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 w-64 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl text-xs">
                      <div className="sticky top-0 border-b border-gray-100 bg-white p-2">
                        <input
                          autoFocus
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder="Search symbol…"
                          className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                      {filteredIndices.length > 0 && (
                        <div>
                          <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-400">Index</div>
                          {filteredIndices.map((s) => (
                            <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                          ))}
                        </div>
                      )}
                      {filteredStocks.length > 0 && (
                        <div>
                          <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-400">Stocks</div>
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

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAutoplay}
                  disabled={!replayData}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    playing
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {playing ? "❚❚ Pause" : "▶ Autoplay"}
                </button>

                <div className="relative">
                  <button
                    onClick={() => setSpeedOpen((v) => !v)}
                    disabled={!replayData}
                    className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium bg-gray-50 text-gray-700 outline-none disabled:opacity-40 hover:bg-gray-100"
                  >
                    {MOVE_OPTIONS.find((o) => o.key === moveKey)?.label} / {EVERY_OPTIONS.find((o) => o.key === everyKey)?.label}
                  </button>

                  {speedOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSpeedOpen(false)} />
                      <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-xl text-xs">
                        <div className="mb-3">
                          <div className="mb-1.5 font-semibold text-gray-600">Move</div>
                          <div className="flex flex-col gap-1">
                            {MOVE_OPTIONS.map((o) => (
                              <label key={o.key} className="flex items-center gap-1.5 text-gray-700 cursor-pointer">
                                <input type="radio" name="move" checked={moveKey === o.key} onChange={() => setMoveKey(o.key)} />
                                {o.label}
                              </label>
                            ))}
                            <label className="flex items-center gap-1.5 text-gray-300 cursor-not-allowed" title="Replay is scoped to one historical day — a 1-day step has nowhere to land">
                              <input type="radio" disabled />
                              1 day
                            </label>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1.5 font-semibold text-gray-600">Every</div>
                          <div className="flex flex-col gap-1">
                            {EVERY_OPTIONS.map((o) => (
                              <label key={o.key} className="flex items-center gap-1.5 text-gray-700 cursor-pointer">
                                <input type="radio" name="every" checked={everyKey === o.key} onChange={() => setEveryKey(o.key)} />
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
            <div className="mt-2 flex w-full flex-wrap items-center gap-1 text-[11px]">
              <button
                onClick={() => jumpDate(-1)}
                disabled={!dates.length}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -1d
              </button>
              <button
                onClick={jumpToStart}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                SOD
              </button>
              <button
                onClick={() => jumpTimeBy(-3600)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -1h
              </button>
              <button
                onClick={() => jumpTimeBy(-900)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -15m
              </button>
              <button
                onClick={() => jumpTimeBy(-300)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -5m
              </button>
              <button
                onClick={() => jumpTimeBy(-60)}
                disabled={!chainData || !canStepEarlier}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing earlier to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -1m
              </button>

              <div className="relative flex-[3] min-w-[170px]">
                <button
                  onClick={() => (calendarOpen ? setCalendarOpen(false) : openCalendar())}
                  disabled={!dates.length}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 font-bold text-gray-800 hover:bg-gray-100 disabled:opacity-40"
                >
                  <SlCalender /> {formatDateTimeLabel(selectedDate, currentTime)}
                </button>

                {calendarOpen && calendarYm && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setCalendarOpen(false)} />
                    <div className="absolute left-0 z-20 mt-1 flex w-[440px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                      {/* Month calendar */}
                      <div className="flex-1 border-r border-gray-100 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => shiftCalendarYear(-1)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Previous year">«</button>
                            <button onClick={() => shiftCalendarMonth(-1)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Previous month">‹</button>
                          </div>
                          <div className="text-sm font-bold text-gray-800">{MONTHS_SHORT[calendarYm.m - 1]} {calendarYm.y}</div>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => shiftCalendarMonth(1)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Next month">›</button>
                            <button onClick={() => shiftCalendarYear(1)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Next year">»</button>
                          </div>
                        </div>
                        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400">
                          {WEEKDAYS.map((w) => <div key={w}>{w[0]}{w[1]}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {calendarDays.map((cell, i) => {
                            const dateStr = ymdToStr(cell.y, cell.m, cell.day);
                            const available = cell.inMonth && availableDateSet.has(dateStr);
                            const isExpiry = available && dayExpirySet.has(dateStr);
                            const isHoliday =
                              cell.inMonth && !available && dateStr <= TODAY_IST && isWeekdayDate(cell.y, cell.m, cell.day);
                            // EOD-only day (Bhavcopy, one snapshot) — the time-step
                            // scrubber has nothing to move between. Shown up front
                            // now instead of only being discovered after picking
                            // the day and hitting a disabled -1m/+1m button.
                            const isSparse = available && sparseDateSet.has(dateStr);
                            const isPending = dateStr === pendingDate;
                            return (
                              <button
                                key={i}
                                disabled={!available}
                                onClick={() => pickCalendarDay(dateStr)}
                                title={isSparse ? "Only one stored snapshot (EOD-only) — no minute-level scrubbing on this day" : undefined}
                                className={`relative rounded-full py-1.5 text-[12px] font-semibold transition ${
                                  !cell.inMonth
                                    ? "text-gray-300 cursor-default"
                                    : isPending
                                      ? "bg-blue-600 text-white"
                                      : isExpiry
                                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                        : available
                                          ? "text-gray-800 hover:bg-gray-100"
                                          : "text-gray-300 cursor-not-allowed"
                                }`}
                              >
                                {cell.day}
                                {isSparse && !isPending && (
                                  <span className="absolute top-0 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                )}
                                {isHoliday && (
                                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gray-400" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-[10px] text-gray-500">
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Expiry Day</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" /> Holiday</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> EOD-only</span>
                        </div>
                      </div>

                      {/* Hour / minute picker for whichever day is pending — a
                          fixed height + overflow-y-auto so 60 minute options
                          scroll within a compact box instead of stretching
                          the whole popover to cover the page. */}
                      <div className="flex w-[130px] shrink-0 flex-col">
                        <div className="flex h-72 divide-x divide-gray-100 overflow-hidden">
                          <div className="flex-1 overflow-y-auto py-1 text-center">
                            {pendingHours.map((h) => (
                              <button
                                key={h}
                                onClick={() => pickHour(h)}
                                className={`w-full py-1.5 text-[12px] font-semibold ${
                                  h === pendingHour ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
                                }`}
                              >
                                {h}
                              </button>
                            ))}
                          </div>
                          <div className="flex-1 overflow-y-auto py-1 text-center">
                            {ALL_MINUTES.map((min) => (
                              <button
                                key={min}
                                onClick={() => pickMinute(min)}
                                className={`w-full py-1.5 text-[12px] font-semibold ${
                                  min === pendingMinute ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
                                }`}
                              >
                                {min}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="border-t border-gray-100 p-2">
                          <button
                            onClick={confirmCalendarSelection}
                            disabled={!pendingDate}
                            className="w-full rounded-md bg-blue-600 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            OK
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
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +1m
              </button>
              <button
                onClick={() => jumpTimeBy(300)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +5m
              </button>
              <button
                onClick={() => jumpTimeBy(900)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +15m
              </button>
              <button
                onClick={() => jumpTimeBy(3600)}
                disabled={!chainData || !canStepLater}
                title={onlySnapshotForDay ? "Only one stored snapshot for this day — nothing later to step to" : undefined}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +1h
              </button>
              <button
                onClick={jumpToEnd}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                EOD
              </button>
              <button
                onClick={() => jumpDate(1)}
                disabled={!dates.length}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +1d
              </button>
            </div>

            {!dates.length && !datesLoaded && (
              <div className="mt-2 text-[11px] text-gray-400">
                Loading available dates…
              </div>
            )}
            {!dates.length && datesLoaded && !chainError && (
              <div className="mt-2 text-[11px] text-amber-600">
                No stored option data for {symbol} yet — try a different symbol, or run one of the Phase 7 backfill
                scripts (NSE Bhavcopy / Angel One / Breeze) for this symbol first.
              </div>
            )}

            
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1600px] gap-3 px-5 pt-2 min-h-screen">
        {/* Left Column: Option Chain Window */}
        {!hideChain && (
        <div className="w-[560px] shrink-0 flex flex-col">
          {chainData && (
            <div className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-1 shadow-sm transition-all hover:shadow-md">
  
              {/* Row 1 */}
              <div className="flex items-center justify-between">
                <div className="group flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50">
                  <span className="text-xs font-medium text-gray-400">SPOT:</span>
                  <span className="font-bold tabular-nums text-xs text-gray-900 transition-colors group-hover:text-blue-600">
                    {formatPrice(displaySpot)}
                  </span>
                </div>

                <div className="h-5 w-px bg-gray-200" />

                <div className="group flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50">
                  <span className="text-xs font-medium text-gray-400">VIX:</span>
                  <span className="font-bold tabular-nums text-gray-400">—</span>
                </div>

                <div className="h-5 w-px bg-gray-200" />

                <div className="group flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50">
                  <span className="text-xs font-medium text-gray-400">FUT:</span>
                  <span className="font-bold tabular-nums text-gray-400">—</span>
                </div>
              </div>

              <hr className="my-1.5 border-gray-200" />

              {/* Row 2 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  {chainData && chainData.expiries.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Nearest expiry */}
                      <button
                        onClick={() => selectExpiry(chainData.expiries[0])}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 hover:scale-105 ${
                          chainData.selectedExpiry === chainData.expiries[0]
                            ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md hover:shadow-lg"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                        }`}
                      >
                        {formatExpiryShort(chainData.expiries[0])} ({daysBetween(selectedDate, chainData.expiries[0])}d)
                      </button>

                      <button
                        onClick={() => selectExpiry(chainData.expiries[1])}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 hover:scale-105 ${
                          chainData.selectedExpiry === chainData.expiries[1]
                            ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md hover:shadow-lg"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                        }`}
                      >
                        {formatExpiryShort(chainData.expiries[1])} ({daysBetween(selectedDate, chainData.expiries[1])}d)
                      </button>

                      <button
                        onClick={() => selectExpiry(chainData.expiries[2])}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 hover:scale-105 ${
                          chainData.selectedExpiry === chainData.expiries[2]
                            ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md hover:shadow-lg"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                        }`}
                      >
                        {formatExpiryShort(chainData.expiries[2])} ({daysBetween(selectedDate, chainData.expiries[2])}d)
                      </button>

                      {chainData.expiries.length > 1 && (
                        <div className="relative">
                          <button
                            onClick={() => setExpiryDropdownOpen((v) => !v)}
                            className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 hover:scale-105 ${
                              chainData.selectedExpiry !== chainData.expiries[0] && chainData.expiries[1]
                                ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md hover:shadow-lg"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                            }`}
                          >
                            {chainData.selectedExpiry !== chainData.expiries[0] && chainData.expiries[1]
                              ? `${formatExpiryShort(chainData.selectedExpiry)} (${daysBetween(selectedDate, chainData.selectedExpiry)}d)`
                              : `Other expiries (${chainData.expiries.length - 1})`}
                            <span className="ml-1 inline-block transition-transform duration-200 group-hover:rotate-180">▾</span>
                          </button>
                          
                          {expiryDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setExpiryDropdownOpen(false)} />
                              <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[160px] max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl text-[11px] animate-in fade-in slide-in-from-top-1 duration-200">
                                {chainData.expiries.slice(1).map((exp) => (
                                  <button
                                    key={exp}
                                    onClick={() => { selectExpiry(exp); setExpiryDropdownOpen(false); }}
                                    className={`block w-full px-4 py-2 text-left font-semibold transition-colors hover:bg-gray-50 ${
                                      exp === chainData.selectedExpiry 
                                        ? "bg-blue-50 text-blue-700" 
                                        : "text-gray-600 hover:text-gray-900"
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

                <div className="h-5 w-px bg-gray-200 flex-shrink-0" />

                <div className="flex-shrink-0 flex items-center gap-1">
                  <button
                    onClick={() => setHideChain(true)}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100"
                    title="Hide Chain — give the right panel full width"
                  >
                    Hide Chain
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="rounded-lg p-2 text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-700 hover:rotate-90"
                      aria-label="Option chain settings"
                      title="Column settings"
                    >
                      <FiSettings size={20} />
                    </button>
                    
                    {settingsOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                        <div className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-lg border border-gray-200 bg-white p-4 shadow-xl text-xs animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="font-bold text-gray-800">Chain Settings</span>
                            <button 
                              onClick={resetChainSettings} 
                              className="text-[10px] text-blue-600 transition-colors hover:text-blue-800 hover:underline"
                            >
                              Reset
                            </button>
                          </div>
                          
                          <div className="space-y-2">
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.oi} 
                                onChange={() => toggleColumn("oi")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">Open Interest</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.callDelta} 
                                onChange={() => toggleColumn("callDelta")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">Call/Put Delta</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.iv} 
                                onChange={() => toggleColumn("iv")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">IV</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.theta} 
                                onChange={() => toggleColumn("theta")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">Theta</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.vega} 
                                onChange={() => toggleColumn("vega")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">Vega</span>
                            </label>
                            
                            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50">
                              <input 
                                type="checkbox" 
                                checked={columns.gamma} 
                                onChange={() => toggleColumn("gamma")} 
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              /> 
                              <span className="select-none">Gamma</span>
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
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {chainError}
            </div>
          )}

          {scrubError && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Couldn't load that time: {scrubError}
            </div>
          )}

          

          {displayRows.length > 0 && (
            <div className="max-h-[68vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm custom-scrollbar">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr className="text-center font-bold text-xs">
                    <th colSpan={chainCeColCount} className="bg-emerald-50 text-emerald-800 border-b border-gray-200 py-1.5">CALL</th>
                    <th className="bg-gray-100/80 border-b border-gray-200"></th>
                    <th colSpan={chainPeColCount} className="bg-rose-50 text-rose-800 border-b border-gray-200 py-1.5">PUT</th>
                  </tr>
                  <tr>
                    {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Γ</th>}
                    {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Vega</th>}
                    {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Theta</th>}
                    {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">IV</th>}
                    {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[13%]">Delta Δ</th>}
                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[15%]">
                      LTP
                    </th>
                    {columns.oi && <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[18%]">OI</th>}
                    <th className="py-2 text-center font-bold text-gray-700 bg-gray-100/80 w-[16%] border-x border-gray-200">
                      Strike
                    </th>
                    {columns.oi && <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">OI</th>}
                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">
                      LTP
                    </th>
                    {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Delta Δ</th>}
                    {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">IV</th>}
                    {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Theta</th>}
                    {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Vega</th>}
                    {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400">Γ</th>}
                  </tr>
                </thead>
                <tbody>
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
                        className={`border-b border-gray-100/70 ${isAtm ? "bg-blue-50/70 font-semibold border-l-4 border-l-blue-500 ring-1 ring-inset ring-blue-200" : "hover:bg-gray-50/80"}`}
                      >
                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.gamma)}</td>}
                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.vega)}</td>}
                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.ce?.theta)}</td>}
                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.iv != null ? `${row.ce.iv.toFixed(1)}%` : "-"}</td>}
                        {columns.callDelta && (
                          <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-[#FFFEE5]" : ""}`}>
                            {formatDelta(row.ce?.delta)}
                          </td>
                        )}
                        <td className={`group px-1.5 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-[#FFFEE5]" : ""}`}>
                          {ceNet !== 0 && (
                            <span className={`absolute -top-0.5 right-0.5 z-[1] rounded-full border bg-white px-1 text-[8px] font-bold leading-tight ${ceNet > 0 ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                              {ceNet > 0 ? `+${ceNet}` : ceNet}
                            </span>
                          )}
                          <span className="text-gray-700 group-hover:invisible">
                            {formatPrice(row.ce?.ltp)}
                          </span>
                          <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white">
                            {!replayData && (ceLeg ? (
                              <>
                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty - 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">−</button>
                                <span className="w-4 text-center text-[9px] font-bold tabular-nums text-gray-700">{ceLeg.qty}</span>
                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty + 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">+</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => addLeg(row, "CE", "buy")}
                                  className="rounded border border-[#52C41A] text-[#52C41A] hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[9px] font-extrabold transition-colors"
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => addLeg(row, "CE", "sell")}
                                  className="rounded border border-[#FF4D4F] text-[#FF4D4F] hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[9px] font-extrabold transition-colors"
                                >
                                  S
                                </button>
                              </>
                            ))}
                            <button onClick={() => setChartModal({ strike: row.strike, right: "CE" })} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] leading-none text-gray-500 hover:bg-gray-100" title="View contract chart">📈</button>
                          </div>
                        </td>
                        {columns.oi && (
                          <td className={`p-0 tabular-nums ${ceItm ? "bg-[#FFFEE5]" : ""}`}>
                            <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                          </td>
                        )}
                        <td className="py-1.5 text-center font-bold text-gray-900 bg-gray-50/40 border-x border-gray-100 text-xs tabular-nums">
                          {row.strike}
                        </td>
                        {columns.oi && (
                          <td className={`p-0 tabular-nums ${peItm ? "bg-[#FFFEE5]" : ""}`}>
                            <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                          </td>
                        )}
                        <td className={`group px-1.5 py-1.5 text-left tabular-nums relative ${peItm ? "bg-[#FFFEE5]" : ""}`}>
                          {peNet !== 0 && (
                            <span className={`absolute -top-0.5 left-0.5 z-[1] rounded-full border bg-white px-1 text-[8px] font-bold leading-tight ${peNet > 0 ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                              {peNet > 0 ? `+${peNet}` : peNet}
                            </span>
                          )}
                          <span className="text-gray-700 group-hover:invisible">
                            {formatPrice(row.pe?.ltp)}
                          </span>
                          <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white">
                            {!replayData && (peLeg ? (
                              <>
                                <button onClick={() => updateQty(peLeg.id, peLeg.qty - 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">−</button>
                                <span className="w-4 text-center text-[9px] font-bold tabular-nums text-gray-700">{peLeg.qty}</span>
                                <button onClick={() => updateQty(peLeg.id, peLeg.qty + 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">+</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => addLeg(row, "PE", "buy")}
                                  className="rounded border border-[#52C41A] text-[#52C41A] hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[9px] font-extrabold transition-colors"
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => addLeg(row, "PE", "sell")}
                                  className="rounded border border-[#FF4D4F] text-[#FF4D4F] hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[9px] font-extrabold transition-colors"
                                >
                                  S
                                </button>
                              </>
                            ))}
                            <button onClick={() => setChartModal({ strike: row.strike, right: "PE" })} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] leading-none text-gray-500 hover:bg-gray-100" title="View contract chart">📈</button>
                          </div>
                        </td>
                        {columns.callDelta && (
                          <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-[#FFFEE5]" : ""}`}>
                            {formatDelta(row.pe?.delta)}
                          </td>
                        )}
                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.iv != null ? `${row.pe.iv.toFixed(1)}%` : "-"}</td>}
                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.theta)}</td>}
                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.vega)}</td>}
                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{formatDelta(row.pe?.gamma)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!selectedDate && !chainError && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-400 shadow-sm">
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
            className="fixed left-3 top-20 z-30 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 shadow-md hover:bg-gray-50"
          >
            Show Option Chain
          </button>
        )}

        {/* Right Column: chart tabs are always visible now (Ready-Made
            Strategies lives inside the Payoff tab instead of replacing this
            whole column pre-legs) — Positions/Greeks/the run-simulation bar
            still only make sense once at least one leg exists. */}
        <div className="flex-1 flex flex-col">
          {legs.length > 0 && (
            <div className="mb-3 flex items-center justify-end gap-2">
              {!replayData && (
                <button
                  onClick={runSimulation}
                  disabled={running || !activeLegs.length}
                  title={!activeLegs.length ? "Check at least one position in the Positions table first" : undefined}
                  className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm transition"
                >
                  {running
                    ? "Loading real prices…"
                    : `Run Simulation (${selectedDate})`}
                </button>
              )}
              {replayData && (
                <button
                  onClick={() => {
                    setReplayData(null);
                    setChartTab("payoff");
                  }}
                  className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition"
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
                className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition"
              >
                Saved
              </button>
              <button
                onClick={resetWorkspace}
                className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition"
              >
                Reset Workspace
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
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {replayError}
            </div>
          )}

          <div className="mb-4 flex gap-4 items-stretch">
            {legs.length > 0 && (
              <div className="w-48 shrink-0 flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <Stat
                  label="Strategy P&L"
                  value={formatPrice(currentPnl)}
                  tone={currentPnl >= 0 ? "positive" : "negative"}
                />
                <Stat
                  label="Probability of Profit (POP)"
                  value={pop != null ? `${pop.toFixed(0)}%` : "—"}
                  hint="Normal distribution approximation"
                />
                <Stat
                  label="Max Profit Potential"
                  value={
                    typeof maxProfit === "number"
                      ? formatPrice(maxProfit)
                      : maxProfit || "Unlimited"
                  }
                  tone="positive"
                />
                <Stat
                  label="Max Loss Risk"
                  value={
                    typeof maxLoss === "number"
                      ? formatPrice(maxLoss)
                      : maxLoss || "Unlimited"
                  }
                  tone="negative"
                />
                <Stat
                  label="Breakeven Thresholds"
                  value={
                    breakevens && breakevens.length
                      ? breakevens.join(", ")
                      : "None"
                  }
                />
                <Stat
                  label="Workspace Constraints"
                  value={
                    activeLegs.length === legs.length
                      ? `${legs.length} of 6 legs used`
                      : `${legs.length} of 6 legs used (${activeLegs.length} included)`
                  }
                />
              </div>
            )}

            <div className="flex-1 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="flex gap-1 border-b border-gray-100 bg-gray-50/50 px-3 pt-2 overflow-x-auto">
                {CHART_TABS.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setChartTab(key)}
                    className={`shrink-0 rounded-t-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      chartTab === key
                        ? "bg-white text-blue-600 border border-b-0 border-gray-200"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 p-4">
                {chartTab === "payoff" && (
                  <div className="space-y-4">
                    {curve.length ? (
                      <PayoffChart
                        curve={curve}
                        spotPrice={displaySpot}
                        breakevens={breakevens}
                        expectedMove={expectedMove}
                      />
                    ) : (
                      <div className="py-10 text-center text-xs text-gray-400">
                        Add positions to view the payoff diagram.
                      </div>
                    )}
                    {!legs.length && (
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
                    <div className="border-t border-gray-100 pt-4">
                      <CandlestickChart ref={niftyChartRef} symbol={symbol} date={selectedDate} compact />
                    </div>
                    {legs.length > 0 && (
                      <div className="text-[11px] text-gray-400 text-center">
                        Crosshair is synced between the two charts above — move it on either one.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {legs.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex border-b border-gray-100 text-xs font-semibold">
                <button
                  onClick={() => setTab("positions")}
                  className={`px-5 py-3 transition-colors ${tab === "positions" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                >
                  Positions
                </button>
                <button
                  onClick={() => setTab("greeks")}
                  className={`px-5 py-3 transition-colors ${tab === "greeks" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                >
                  Portfolio Greeks
                </button>
              </div>

              {tab === "positions" ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/40 px-4 py-2 text-[11px]">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allLegsActive}
                          disabled={!!replayData}
                          onChange={toggleSelectAllLegs}
                          className="disabled:cursor-not-allowed"
                        />{" "}
                        Select All
                      </label>
                      <button
                        onClick={() => setLegsTopFirst((v) => !v)}
                        className="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-100"
                      >
                        {legsTopFirst ? "Top ↓" : "Bottom ↑"}
                      </button>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">Lots:</span>
                        <button
                          onClick={() => bulkAdjustLots(-1)}
                          disabled={!!replayData}
                          className="rounded border border-gray-200 px-1.5 py-0.5 font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-bold tabular-nums text-gray-800">{commonLots ?? "—"}</span>
                        <button
                          onClick={() => bulkAdjustLots(1)}
                          disabled={!!replayData}
                          className="rounded border border-gray-200 px-1.5 py-0.5 font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                      <div>
                        <span className="text-gray-400">Total Qty: </span>
                        <span className="font-bold tabular-nums text-gray-800">{totalLots}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">Total P&L: </span>
                      <span className={`font-bold tabular-nums ${totalLivePnl != null && totalLivePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {totalLivePnl != null ? formatPrice(totalLivePnl) : "-"}
                      </span>
                    </div>
                  </div>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                        <th className="px-3 py-2.5 w-8" title="Include in payoff calculation"></th>
                        <th className="px-4 py-2.5 text-left font-medium">
                          Action
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium">
                          Type
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium">
                          Expiry
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Strike
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Entry Price
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          LTP
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Live P&L
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Lots
                        </th>
                        <th className="px-4 py-2.5 text-center font-medium">
                          SL/TG
                        </th>
                        <th className="px-4 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {orderedLegs.map((leg) => {
                        const row = displayRows.find(
                          (r) => r.strike === leg.strike,
                        );
                        const currentLtp = row
                          ? leg.type === "CE"
                            ? row.ce?.ltp
                            : row.pe?.ltp
                          : null;
                        const livePnl = legLivePnl(leg);
                        const included = leg.active !== false;
                        const canPickStrike = leg.expiry === chainData?.selectedExpiry;
                        return (
                          <tr
                            key={leg.id}
                            className={`hover:bg-gray-50/40 transition-colors ${included ? "" : "opacity-50"}`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={included}
                                disabled={!!replayData}
                                onChange={() => toggleLegActive(leg.id)}
                                title={included ? "Included in payoff calculation — uncheck to exclude" : "Excluded from payoff calculation — check to include"}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <button
                                onClick={() => toggleLegSide(leg.id)}
                                disabled={!!replayData}
                                title="Click to flip Buy/Sell"
                                className={`rounded-md px-2 py-0.5 text-[10px] font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${!replayData ? "cursor-pointer hover:opacity-80" : ""} ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}
                              >
                                {leg.action === "buy" ? "BUY" : "SELL"}
                              </button>
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${leg.type === "CE" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}
                              >
                                {leg.type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-left">
                              <select
                                value={leg.expiry || ""}
                                disabled={!!replayData || !chainData?.expiries?.length}
                                onChange={(e) => updateLegExpiry(leg.id, e.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] font-medium text-gray-700 outline-none focus:border-blue-500 disabled:opacity-50"
                              >
                                {(chainData?.expiries?.includes(leg.expiry) ? chainData.expiries : [leg.expiry, ...(chainData?.expiries || [])]).map((exp) => (
                                  <option key={exp} value={exp}>{formatExpiryShort(exp)}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold tabular-nums text-gray-900">
                              {canPickStrike ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => rollLegStrike(leg.id, -1)}
                                    disabled={!!replayData}
                                    className="rounded border border-gray-200 px-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                    title="Roll to lower strike"
                                  >
                                    −
                                  </button>
                                  <span className="tabular-nums">{leg.strike}</span>
                                  <button
                                    onClick={() => rollLegStrike(leg.id, 1)}
                                    disabled={!!replayData}
                                    className="rounded border border-gray-200 px-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
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
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                              {formatPrice(leg.premium)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                              {currentLtp != null
                                ? formatPrice(currentLtp)
                                : "-"}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-bold tabular-nums ${livePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                            >
                              {livePnl != null ? formatPrice(livePnl) : "-"}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  onClick={() => updateQty(leg.id, leg.qty - 1)}
                                  disabled={!!replayData || leg.qty <= 1}
                                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                >
                                  −
                                </button>
                                <span className="w-5 text-center tabular-nums font-semibold text-gray-800">
                                  {leg.qty}
                                </span>
                                <button
                                  onClick={() => updateQty(leg.id, leg.qty + 1)}
                                  disabled={!!replayData}
                                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-center relative">
                              <button
                                onClick={() => setSlTgEditId(slTgEditId === leg.id ? null : leg.id)}
                                disabled={!!replayData}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={leg.slPercent != null || leg.tgPercent != null ? `SL ${leg.slPercent ?? "—"}% / TG ${leg.tgPercent ?? "—"}%` : "Set SL/TG"}
                              >
                                ⚙
                              </button>
                              {(leg.slPercent != null || leg.tgPercent != null) && (
                                <div className="text-[9px] text-gray-400">SL {leg.slPercent ?? "—"}% / TG {leg.tgPercent ?? "—"}%</div>
                              )}
                              {slTgEditId === leg.id && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setSlTgEditId(null)} />
                                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-xl">
                                    <div className="mb-2 text-[10px] text-gray-400">
                                      Planning note only — not auto-executed here. Use Backtest for SL%/target%-driven exits.
                                    </div>
                                    <label className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                                      SL %
                                      <input
                                        type="number"
                                        defaultValue={leg.slPercent ?? ""}
                                        onBlur={(e) => setLegSlTg(leg.id, e.target.value, leg.tgPercent ?? "")}
                                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right outline-none focus:border-blue-500"
                                      />
                                    </label>
                                    <label className="flex items-center justify-between gap-2 text-[11px]">
                                      TG %
                                      <input
                                        type="number"
                                        defaultValue={leg.tgPercent ?? ""}
                                        onBlur={(e) => setLegSlTg(leg.id, leg.slPercent ?? "", e.target.value)}
                                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right outline-none focus:border-blue-500"
                                      />
                                    </label>
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => resetLegEntryToLtp(leg.id)}
                                  disabled={!!replayData}
                                  className="text-gray-400 hover:text-blue-600 transition disabled:opacity-30"
                                  title="Reset entry to current LTP"
                                >
                                  ⟳
                                </button>
                                <button
                                  onClick={() => removeLeg(leg.id)}
                                  disabled={!!replayData}
                                  className="text-gray-400 hover:text-rose-600 font-bold transition disabled:opacity-30"
                                  title="Remove leg"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left font-medium">
                          Greek
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Net Value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                          Delta
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                          {netGreeks ? netGreeks.delta.toFixed(3) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                          Gamma
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                          {netGreeks ? netGreeks.gamma.toFixed(4) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                          Theta
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                          {netGreeks ? netGreeks.theta.toFixed(2) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                          Vega
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                          {netGreeks ? netGreeks.vega.toFixed(2) : "-"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
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
        />
      )}
    </div>
  );
}
