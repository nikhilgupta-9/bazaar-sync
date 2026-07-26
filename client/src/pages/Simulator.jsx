import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  fetchSimulatorDates,
  fetchSimulatorChain,
  runSimulatorReplay,
} from "../services/simulatorApi";
import { fetchSymbolList } from "../services/optionChainApi";
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
} from "../utils/payoff";
import { yearsToExpiry } from "../utils/blackScholes";
import OiBar from "../components/OiBar";
import PayoffChart from "../components/PayoffChart";
import PresetStrategies from "../components/PresetStrategies";
import { SlCalender } from "react-icons/sl";

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

// Wall-clock playback speed presets. `stepPerTick` is how many stored per-
// minute samples advance every `tickMs` of real time — labelled the way the
// stockmojo reference does ("1 min/1 sec" = 1 simulated minute per second).
const SPEED_OPTIONS = [
  { key: "slow", label: "1 min/2 sec", stepPerTick: 1, tickMs: 2000 },
  { key: "normal", label: "1 min/1 sec", stepPerTick: 1, tickMs: 1000 },
  { key: "fast", label: "1 min/0.25 sec", stepPerTick: 1, tickMs: 250 },
  { key: "fastest", label: "5 min/1 sec", stepPerTick: 5, tickMs: 1000 },
];

const CHART_TABS = [
  ["payoff", "Payoff"],
  ["strategy", "Strategy Chart"],
  ["nifty", "NIFTY Chart"],
  ["combined", "Strategy Chart + NIFTY Chart"],
];

let legIdCounter = 0;

function formatTime(t) {
  return t ? String(t).slice(0, 5) : "-";
}

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

function legFromRow(row, right, action, expiry) {
  const side = right === "CE" ? row.ce : row.pe;
  return {
    id: ++legIdCounter,
    action,
    type: right,
    strike: row.strike,
    premium: side.ltp,
    qty: 1,
    iv: side.iv,
    delta: side.delta,
    gamma: side.gamma,
    theta: side.theta,
    vega: side.vega,
    expiry, // which expiry this leg's premium/greeks came from — see payoff.js
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
  const [symbol, setSymbol] = useState("NIFTY");
  const [dates, setDates] = useState([]); // DESC (most recent first), per /dates
  const [selectedDate, setSelectedDate] = useState("");
  const [chainData, setChainData] = useState(null); // metadata holder: expiries/times/selectedExpiry
  const [liveChain, setLiveChain] = useState(null); // chain rows at whichever instant is being viewed
  const [chainError, setChainError] = useState(null);
  const [legs, setLegs] = useState([]);
  const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'
  const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'nifty' | 'combined'

  const [replayData, setReplayData] = useState(null);
  const [replayError, setReplayError] = useState(null);
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedKey, setSpeedKey] = useState("normal");

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarYm, setCalendarYm] = useState(null); // { y, m } (m: 1-12), which month the popover shows
  const [pendingDate, setPendingDate] = useState(null); // day picked in the popover, not applied until OK
  const [pendingTime, setPendingTime] = useState(null);
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

  // Reset everything when the symbol changes.
  useEffect(() => {
    setDates([]);
    setSelectedDate("");
    setChainData(null);
    setLiveChain(null);
    setLegs([]);
    setReplayData(null);
    setChartTab("payoff");
    setCalendarYm(null);
    fetchSimulatorDates(symbol)
      .then((res) => {
        setDates(res.dates);
        if (res.dates.length) {
          const [y, m] = res.dates[0].split("-").map(Number);
          setCalendarYm({ y, m });
        }
      })
      .catch((err) => setChainError(err.message));
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

  // Time picker for whichever day is currently pending in the popover — only
  // the hours/minutes that actually have a stored snapshot are selectable,
  // never a generic 00-59 range (there's no data at arbitrary minutes).
  const pendingHours = useMemo(() => {
    const set = new Set(pendingTimes.map((t) => String(t).slice(0, 2)));
    return [...set].sort();
  }, [pendingTimes]);

  const selectedHour = pendingTime ? String(pendingTime).slice(0, 2) : (pendingHours[0] || null);

  const pendingMinutes = useMemo(() => {
    if (!selectedHour) return [];
    return pendingTimes.filter((t) => String(t).slice(0, 2) === selectedHour).map((t) => String(t).slice(3, 5));
  }, [pendingTimes, selectedHour]);

  function fetchPendingTimes(date) {
    fetchSimulatorChain(symbol, { date, expiry: chainData?.selectedExpiry })
      .then((res) => {
        setPendingTimes(res.times || []);
        setPendingTime((res.times && res.times[0]) || null);
      })
      .catch(() => setPendingTimes([]));
  }

  function openCalendar() {
    const initDate = selectedDate || dates[0] || null;
    setPendingDate(initDate);
    setPendingTime(currentTime || null);
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
    const match = pendingTimes.find((t) => String(t).slice(0, 2) === hour);
    if (match) setPendingTime(match);
  }

  function pickMinute(minute) {
    const match = pendingTimes.find((t) => String(t).slice(0, 2) === selectedHour && String(t).slice(3, 5) === minute);
    if (match) setPendingTime(match);
  }

  function confirmCalendarSelection() {
    if (pendingDate) selectDate(pendingDate, pendingTime);
    setCalendarOpen(false);
  }

  function loadChain(date, expiry, time) {
    setChainError(null);
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
    fetchSimulatorChain(symbol, {
      date: selectedDate,
      expiry: chainData.selectedExpiry,
      time,
    })
      .then((res) => setLiveChain(res))
      .catch(() => {
        /* non-fatal — keep showing the last good chain */
      });
  }

  function jumpTimeBy(deltaSeconds) {
    const times = chainData?.times || [];
    if (!times.length || !currentTime) return;
    scrubToTime(nearestTime(times, timeToSeconds(currentTime) + deltaSeconds));
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
    setLegs((prev) =>
      prev.length >= 6 ? prev : [...prev, legFromRow(row, right, action, chainData?.selectedExpiry)],
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

  function resetWorkspace() {
    setLegs([]);
    setReplayData(null);
    setChartTab("payoff");
  }

  function applyPreset(presetLegs) {
    setLegs(presetLegs.map((l) => ({ ...l, id: ++legIdCounter })));
  }

  async function runSimulation() {
    setRunning(true);
    setReplayError(null);
    setPlaying(false);
    try {
      const res = await runSimulatorReplay(symbol, {
        date: selectedDate,
        expiry: chainData.selectedExpiry,
        legs: legs.map(({ strike, type, action, qty }) => ({
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

  // Playback loop (Autoplay).
  useEffect(() => {
    if (!playing || !replayData) return;
    const opt =
      SPEED_OPTIONS.find((o) => o.key === speedKey) || SPEED_OPTIONS[1];
    const timer = setInterval(() => {
      setCursor((c) => {
        const next = c + opt.stepPerTick;
        if (next >= replayData.series.length - 1) {
          setPlaying(false);
          return replayData.series.length - 1;
        }
        return next;
      });
    }, opt.tickMs);
    return () => clearInterval(timer);
  }, [playing, speedKey, replayData]);

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
  const maxCeOi = Math.max(0, ...displayRows.map((r) => r.ce?.oi || 0));
  const maxPeOi = Math.max(0, ...displayRows.map((r) => r.pe?.oi || 0));
  const currentPoint = replayData?.series?.[cursor];

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
    if (!legs.length || !displaySpot || !chainData?.selectedExpiry)
      return empty;
    try {
      const spread = displaySpot * 0.08;
      let curveData =
        computePayoffCurve(legs, {
          minPrice: displaySpot - spread,
          maxPrice: displaySpot + spread,
        }) || [];
      const breakEvs = computeBreakevens(curveData) || [];
      const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(
        legs,
        curveData,
      );
      const netGrks = computeNetGreeks(legs);

      const asOfMs = istWallClockToUtcMs(selectedDate, currentTime);
      // For a single-expiry strategy this is just chainData.selectedExpiry;
      // for a calendar spread it's the near leg's expiry — the meaningful
      // horizon for "at expiry" (see payoff.js's evaluationExpiryOf).
      const evaluationExpiry = evaluationExpiryOf(legs) || chainData.selectedExpiry;
      const yearsRemaining = yearsToExpiry(evaluationExpiry, asOfMs);
      const atmRow = displayRows.find(
        (r) => r.strike === (liveChain?.atmStrike ?? chainData.atmStrike),
      );
      const atmIv = atmRow?.ce?.iv ?? atmRow?.pe?.iv ?? null;

      curveData = atmIv
        ? addMarkToMarketCurve(curveData, legs, yearsRemaining, asOfMs)
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
    legs,
    displaySpot,
    displayRows,
    chainData,
    selectedDate,
    currentTime,
    liveChain,
  ]);

  return (
    <div className="bg-gray-50/40">
      <div className="mx-auto max-w-[1600px] px-5 pt-5">
        <div className="w-full shrink-0 flex flex-col">
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-bold text-gray-900 outline-none focus:border-blue-500"
                  aria-label="Symbol"
                >
                  <optgroup label="Indices">
                    {symbolList.indices.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                  {symbolList.stocks.length > 0 && (
                    <optgroup label="Stocks">
                      {symbolList.stocks.map((s) => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  disabled={!replayData}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    playing
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {playing ? "❚❚ Pause" : "▶ Autoplay"}
                </button>
                <select
                  value={speedKey}
                  onChange={(e) => setSpeedKey(e.target.value)}
                  disabled={!replayData}
                  className="rounded-md border border-gray-200 px-1.5 py-1 text-[11px] font-medium bg-gray-50 text-gray-700 outline-none disabled:opacity-40"
                >
                  {SPEED_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -1h
              </button>
              <button
                onClick={() => jumpTimeBy(-900)}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -15m
              </button>
              <button
                onClick={() => jumpTimeBy(-300)}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                -5m
              </button>
              <button
                onClick={() => jumpTimeBy(-60)}
                disabled={!chainData}
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
                            const isHoliday = cell.inMonth && !available && isWeekdayDate(cell.y, cell.m, cell.day);
                            const isPending = dateStr === pendingDate;
                            return (
                              <button
                                key={i}
                                disabled={!available}
                                onClick={() => pickCalendarDay(dateStr)}
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
                        </div>
                      </div>

                      {/* Hour / minute picker for whichever day is pending */}
                      <div className="flex w-[130px] shrink-0 flex-col">
                        <div className="flex flex-1 divide-x divide-gray-100 overflow-hidden">
                          <div className="flex-1 overflow-y-auto py-1 text-center">
                            {pendingHours.length === 0 && <div className="px-1 py-4 text-[10px] text-gray-300">—</div>}
                            {pendingHours.map((h) => (
                              <button
                                key={h}
                                onClick={() => pickHour(h)}
                                className={`w-full py-1.5 text-[12px] font-semibold ${
                                  h === selectedHour ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
                                }`}
                              >
                                {h}
                              </button>
                            ))}
                          </div>
                          <div className="flex-1 overflow-y-auto py-1 text-center">
                            {pendingMinutes.map((min) => (
                              <button
                                key={min}
                                onClick={() => pickMinute(min)}
                                className={`w-full py-1.5 text-[12px] font-semibold ${
                                  pendingTime && String(pendingTime).slice(3, 5) === min ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
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
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +1m
              </button>
              <button
                onClick={() => jumpTimeBy(300)}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +5m
              </button>
              <button
                onClick={() => jumpTimeBy(900)}
                disabled={!chainData}
                className="flex-1 min-w-[44px] rounded-md bg-gray-100 px-2 py-1.5 text-center font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                +15m
              </button>
              <button
                onClick={() => jumpTimeBy(3600)}
                disabled={!chainData}
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

            {!dates.length && (
              <div className="mt-2 text-[11px] text-gray-400">
                Loading available dates…
              </div>
            )}

            {chainData && chainData.expiries.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                {chainData.expiries.map((exp) => (
                  <button
                    key={exp}
                    onClick={() => selectExpiry(exp)}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                      exp === chainData.selectedExpiry
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {formatExpiryShort(exp)} ({daysBetween(selectedDate, exp)}d)
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1600px] gap-5 px-5 py-5 min-h-screen">
        {/* Left Column: Option Chain Window */}
        <div className="w-[560px] shrink-0 flex flex-col">
          {chainData && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs shadow-sm">
              <div>
                <span className="text-gray-400">SPOT: </span>
                <span className="font-bold tabular-nums text-gray-900">
                  {formatPrice(displaySpot)}
                </span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div title="VIX isn't persisted for historical dates — only live snapshots are stored (see CLAUDE.md Gotcha #13). Not fabricated here.">
                <span className="text-gray-400">VIX: </span>
                <span className="font-bold tabular-nums text-gray-400">—</span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div title="Futures prices aren't persisted for historical dates either — cache/IPC-only in the live path. Not fabricated here.">
                <span className="text-gray-400">FUT: </span>
                <span className="font-bold tabular-nums text-gray-400">—</span>
              </div>
            </div>
          )}

          {chainError && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {chainError}
            </div>
          )}

          {displayRows.length > 0 && (
            <div className="max-h-[68vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm custom-scrollbar">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr>
                    <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[13%]">
                      Call Δ
                    </th>
                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[15%]">
                      LTP
                    </th>
                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[18%]">
                      OI
                    </th>
                    <th className="py-2 text-center font-bold text-gray-700 bg-gray-100/80 w-[16%] border-x border-gray-200">
                      Strike
                    </th>
                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">
                      OI
                    </th>
                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">
                      LTP
                    </th>
                    <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">
                      Put Δ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const isAtm =
                      row.strike ===
                      (liveChain?.atmStrike ?? chainData?.atmStrike);
                    return (
                      <tr
                        key={row.strike}
                        className={`border-b border-gray-100/70 ${isAtm ? "bg-blue-50/60 font-semibold" : "hover:bg-gray-50/80"}`}
                      >
                        <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">
                          {formatDelta(row.ce?.delta)}
                        </td>
                        <td className="group px-1.5 py-1.5 text-right tabular-nums relative">
                          <span className="text-gray-700 group-hover:invisible">
                            {formatPrice(row.ce?.ltp)}
                          </span>
                          {!replayData && (
                            <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                              <button
                                onClick={() => addLeg(row, "CE", "buy")}
                                className="rounded bg-emerald-500 hover:bg-emerald-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                              >
                                B
                              </button>
                              <button
                                onClick={() => addLeg(row, "CE", "sell")}
                                className="rounded bg-rose-500 hover:bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                              >
                                S
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-0 tabular-nums">
                          <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                        </td>
                        <td className="py-1.5 text-center font-bold text-gray-900 bg-gray-50/40 border-x border-gray-100 text-xs tabular-nums">
                          {row.strike}
                        </td>
                        <td className="p-0 tabular-nums">
                          <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                        </td>
                        <td className="group px-1.5 py-1.5 text-left tabular-nums relative">
                          <span className="text-gray-700 group-hover:invisible">
                            {formatPrice(row.pe?.ltp)}
                          </span>
                          {!replayData && (
                            <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                              <button
                                onClick={() => addLeg(row, "PE", "buy")}
                                className="rounded bg-emerald-500 hover:bg-emerald-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                              >
                                B
                              </button>
                              <button
                                onClick={() => addLeg(row, "PE", "sell")}
                                className="rounded bg-rose-500 hover:bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                              >
                                S
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">
                          {formatDelta(row.pe?.delta)}
                        </td>
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

        {/* Right Column: Ready-made strategies, or Analytics/Chart/Positions once legs exist */}
        <div className="flex-1 flex flex-col">
          {legs.length === 0 ? (
            <div className="flex-1 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <PresetStrategies
                data={liveChain || chainData}
                onApply={applyPreset}
                fetchExpiryRows={fetchExpiryRows}
              />
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-end gap-2">
                {!replayData && (
                  <button
                    onClick={runSimulation}
                    disabled={running}
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
                <button
                  onClick={resetWorkspace}
                  className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition"
                >
                  Reset Workspace
                </button>
              </div>

              {replayError && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {replayError}
                </div>
              )}

              <div className="mb-4 flex gap-4 items-stretch">
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
                    value={`${legs.length} of 6 active legs`}
                  />
                </div>

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
                  <div className="flex-1 p-4 flex flex-col justify-center">
                    {chartTab === "payoff" && (
                      <PayoffChart
                        curve={curve}
                        spotPrice={displaySpot}
                        breakevens={breakevens}
                        expectedMove={expectedMove}
                      />
                    )}

                    {chartTab !== "payoff" && !replayData && (
                      <div className="py-16 text-center text-xs text-gray-400">
                        Click "Run Simulation" to see the real minute-by-minute
                        replay for this chart.
                      </div>
                    )}

                    {chartTab === "strategy" && replayData && (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={replayData.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f0f0f0"
                          />
                          <XAxis
                            dataKey="time"
                            tickFormatter={formatTime}
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis tick={{ fontSize: 11 }} width={60} />
                          <Tooltip
                            formatter={(v) => formatPrice(v)}
                            labelFormatter={formatTime}
                          />
                          <ReferenceLine y={0} stroke="#9ca3af" />
                          {currentPoint && (
                            <ReferenceLine
                              x={currentPoint.time}
                              stroke="#2563eb"
                              strokeDasharray="4 4"
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="pnl"
                            name="Strategy P&L"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}

                    {chartTab === "nifty" && replayData && (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={replayData.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f0f0f0"
                          />
                          <XAxis
                            dataKey="time"
                            tickFormatter={formatTime}
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            width={60}
                            domain={["dataMin", "dataMax"]}
                          />
                          <Tooltip
                            formatter={(v) => formatPrice(v)}
                            labelFormatter={formatTime}
                          />
                          {currentPoint && (
                            <ReferenceLine
                              x={currentPoint.time}
                              stroke="#2563eb"
                              strokeDasharray="4 4"
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="spot"
                            name={`${symbol} spot`}
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}

                    {chartTab === "combined" && replayData && (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={replayData.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f0f0f0"
                          />
                          <XAxis
                            dataKey="time"
                            tickFormatter={formatTime}
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            yAxisId="pnl"
                            tick={{ fontSize: 11 }}
                            width={60}
                          />
                          <YAxis
                            yAxisId="spot"
                            orientation="right"
                            tick={{ fontSize: 11 }}
                            width={60}
                            domain={["dataMin", "dataMax"]}
                          />
                          <Tooltip
                            formatter={(v) => formatPrice(v)}
                            labelFormatter={formatTime}
                          />
                          <ReferenceLine yAxisId="pnl" y={0} stroke="#9ca3af" />
                          {currentPoint && (
                            <ReferenceLine
                              yAxisId="pnl"
                              x={currentPoint.time}
                              stroke="#2563eb"
                              strokeDasharray="4 4"
                            />
                          )}
                          <Line
                            yAxisId="pnl"
                            type="monotone"
                            dataKey="pnl"
                            name="Strategy P&L"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                          <Line
                            yAxisId="spot"
                            type="monotone"
                            dataKey="spot"
                            name={`${symbol} spot`}
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}

                    {replayData && (
                      <div className="mt-2 text-[11px] text-gray-400 text-center">
                        Real stored prices from {replayData.date} — a gap means
                        no recorded price for that minute, never guessed. Use
                        the scrubber above or Autoplay to move through the day.
                      </div>
                    )}
                  </div>
                </div>
              </div>

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
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left font-medium">
                          Action
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium">
                          Type
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
                          Qty
                        </th>
                        <th className="px-4 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {legs.map((leg) => {
                        const row = displayRows.find(
                          (r) => r.strike === leg.strike,
                        );
                        const currentLtp = row
                          ? leg.type === "CE"
                            ? row.ce?.ltp
                            : row.pe?.ltp
                          : null;
                        const livePnl = legLivePnl(leg);
                        return (
                          <tr
                            key={leg.id}
                            className="hover:bg-gray-50/40 transition-colors"
                          >
                            <td className="px-4 py-2.5">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[10px] font-bold text-white shadow-sm ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}
                              >
                                {leg.action === "buy" ? "BUY" : "SELL"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-medium text-gray-700">
                              {leg.type}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold tabular-nums text-gray-900">
                              {leg.strike}
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
                              <input
                                type="number"
                                min={1}
                                value={leg.qty}
                                disabled={!!replayData}
                                onChange={(e) =>
                                  updateQty(leg.id, Number(e.target.value))
                                }
                                className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-right font-medium text-gray-800 focus:border-blue-500 outline-none disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                onClick={() => removeLeg(leg.id)}
                                disabled={!!replayData}
                                className="text-gray-400 hover:text-rose-600 font-bold transition disabled:opacity-30"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
