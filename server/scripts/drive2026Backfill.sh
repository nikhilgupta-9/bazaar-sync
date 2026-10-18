#!/usr/bin/env bash
# server/scripts/drive2026Backfill.sh — 2026 option chain + 1-min OHLCV for 7 indices + F&O stocks → Google Drive.
#
# Reads the plan made from a real Drive inventory (server/scripts/drive2026Inventory.js →
# data-downloader/data/drive-2026-plan.json) and runs upstoxStockOptionChainArchivalRunner.js
# in three phases, one process at a time (Upstox rate-limits the whole token, so parallel
# runners would only trade speed for 429s):
#   1. spotOnly    — option chain already complete on Drive, only the 1-min OHLCV is missing
#   2. fullIndices — indices needing option chain + OHLCV
#   3. fullStocks  — stocks needing option chain + OHLCV
# Every phase is resumable (progress file) and Drive uploads merge with what's there.
#
#   nohup bash server/scripts/drive2026Backfill.sh [TO_DATE] > data-downloader/logs/drive-2026-backfill.log 2>&1 &
set -u
cd "$(dirname "$0")/../.."
TO="${1:-2026-10-16}"
PLAN="data-downloader/data/drive-2026-plan.json"
RUNNER="server/scripts/upstoxStockOptionChainArchivalRunner.js"
export UPSTOX_REQUEST_GAP_MS="${UPSTOX_REQUEST_GAP_MS:-1000}"   # ~1800 req / 30 min, under Upstox's 2000 cap

list() { node -e "console.log(require('./$PLAN')['$1'].join(','))"; }

for phase in spotOnly fullIndices fullStocks; do
  syms="$(list "$phase")"
  [ -z "$syms" ] && { echo "== $phase: nothing to do"; continue; }
  echo "== $(date '+%F %T') phase $phase: $(echo "$syms" | tr ',' '\n' | wc -l | tr -d ' ') symbols, 2026-01-01..$TO"
  extra=""
  [ "$phase" = "spotOnly" ] && extra="--spot-only"
  node "$RUNNER" --symbols="$syms" --from=2026-01-01 --to="$TO" $extra
  echo "== $(date '+%F %T') phase $phase finished (exit $?)"
done
echo "== $(date '+%F %T') ALL PHASES DONE — re-run server/scripts/drive2026Inventory.js to verify Drive"
