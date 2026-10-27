#!/usr/bin/env python3
"""
importHuggingFaceToDrive.py — Seamlessly imports multi-year Indian F&O (Options + Spot)
from Hugging Face into Bazaar-Sync and Google Drive with ATM ±30 filtering,
Black-Scholes Greek calculation, smart cloud merge, and auto-pruning.
"""

import os
import sys
import math
import json
import time
import ssl
import subprocess
import urllib.request
from datetime import datetime, timezone, timedelta
import pandas as pd
import pymysql

# ----------------- CONFIG & CONSTANTS -----------------
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE_DIR = os.path.join(BASE_DIR, "tmp", "huggingface_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

RISK_FREE_RATE = 0.065
INSERT_BATCH_SIZE = 3000
MAX_ATM_OFFSET = 30

DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("DB_PORT", 3306))
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASSWORD", "")
DB_NAME = os.environ.get("DB_NAME", "bazaar_sync")

ssl_ctx = ssl._create_unverified_context()

def get_db():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        charset="utf8mb4",
        autocommit=True
    )

# ----------------- BLACK-SCHOLES GREEKS & IV -----------------
def erf_approx(x):
    sign = -1 if x < 0 else 1
    x = abs(x)
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return sign * y

def norm_cdf(x):
    return 0.5 * (1.0 + erf_approx(x / math.sqrt(2.0)))

def norm_pdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

def years_to_expiry(expiry_str, date_str, time_str):
    try:
        ey, em, ed = map(int, expiry_str.split("-"))
        dy, dm, dd = map(int, date_str.split("-"))
        hh, mm, ss = map(int, time_str.split(":"))
        t_exp = datetime(ey, em, ed, 15, 30, 0, tzinfo=timezone.utc)
        t_now = datetime(dy, dm, dd, hh, mm, ss, tzinfo=timezone.utc)
        diff_sec = (t_exp - t_now).total_seconds()
        # Floor at 15 minutes (1 / (365 * 24 * 4))
        return max(diff_sec / (365.0 * 24.0 * 3600.0), 1.0 / (365.0 * 24.0 * 4.0))
    except Exception:
        return 1.0 / (365.0 * 24.0 * 4.0)

def bs_price(spot, strike, t, vol, right, r=RISK_FREE_RATE):
    if vol <= 0 or t <= 0:
        return max(0.0, spot - strike if right == "call" else strike - spot)
    sqrt_t = math.sqrt(t)
    d1 = (math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    if right == "call":
        return spot * norm_cdf(d1) - strike * math.exp(-r * t) * norm_cdf(d2)
    else:
        return strike * math.exp(-r * t) * norm_cdf(-d2) - spot * norm_cdf(-d1)

def bs_iv(market_price, spot, strike, t, right, r=RISK_FREE_RATE):
    if not market_price or market_price <= 0 or t <= 0 or spot <= 0 or strike <= 0:
        return None
    lo, hi = 0.001, 5.0
    for _ in range(50):
        mid = (lo + hi) / 2.0
        p = bs_price(spot, strike, t, mid, right, r)
        if abs(p - market_price) < 0.01:
            return mid
        if p > market_price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0 if (lo + hi) / 2.0 <= 4.9 else None

def clamp_finite(v, cap):
    if not math.isfinite(v):
        return 0.0
    if v > cap:
        return cap
    if v < -cap:
        return -cap
    return v

def bs_greeks(spot, strike, t, vol, right, r=RISK_FREE_RATE):
    if not vol or vol <= 0 or t <= 0:
        delta = 1.0 if right == "call" and spot > strike else (0.0 if right == "call" else (-1.0 if spot < strike else 0.0))
        return {"delta": delta, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    sqrt_t = math.sqrt(t)
    d1 = (math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    pdf = norm_pdf(d1)
    delta = norm_cdf(d1) if right == "call" else norm_cdf(d1) - 1.0
    gamma = pdf / (spot * vol * sqrt_t)
    vega = (spot * pdf * sqrt_t) / 100.0
    if right == "call":
        theta = (-(spot * pdf * vol) / (2.0 * sqrt_t) - r * strike * math.exp(-r * t) * norm_cdf(d2)) / 365.0
    else:
        theta = (-(spot * pdf * vol) / (2.0 * sqrt_t) + r * strike * math.exp(-r * t) * norm_cdf(-d2)) / 365.0
    return {
        "delta": round(clamp_finite(delta, 1.0), 4),
        "gamma": round(clamp_finite(gamma, 50.0), 6),
        "theta": round(clamp_finite(theta, 5000.0), 4),
        "vega": round(clamp_finite(vega, 5000.0), 4),
    }

# ----------------- HUGGING FACE DOWNLOAD HELPERS -----------------
def download_file(url, local_path):
    if os.path.exists(local_path) and os.path.getsize(local_path) > 1000:
        return local_path
    tmp_path = local_path + ".tmp"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(10):
        try:
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as resp, open(tmp_path, "wb") as f:
                f.write(resp.read())
            os.rename(tmp_path, local_path)
            return local_path
        except Exception as e:
            if attempt < 9:
                time.sleep(2 + attempt * 2)
                continue
            raise

def get_huggingface_tree():
    url = "https://huggingface.co/api/datasets/thetrademarkk/india-index-options-1m"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(10):
        try:
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                return [s.get("rfilename") for s in data.get("siblings", [])]
        except Exception as e:
            if attempt < 9:
                time.sleep(2 + attempt * 2)
                continue
            raise

# ----------------- MAIN PROCESSING -----------------
def process_symbol_year(symbol="NIFTY", year="2024", max_atm_offset=MAX_ATM_OFFSET, limit=None, do_upload=True, from_month=None, to_month=None):
    print("=" * 80)
    print(f" 🚀 HUGGING FACE ➔ GOOGLE DRIVE PIPELINE: {symbol} - Year {year}")
    print(f" Mode: Full Option Chains (ATM ±{max_atm_offset} strikes) + 1-Min Spot OHLCV")
    if from_month or to_month:
        print(f" Month Filter: {from_month or 'start'} to {to_month or 'end'}")
    if limit:
        print(f" Limit: {limit} expiries only")
    print("=" * 80)

    # 1. Fetch & Store Spot OHLCV
    print(f"\n[1/3] Downloading & Syncing 1-Minute Spot OHLCV for {symbol} ({year})...")
    spot_url = f"https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/index/{symbol}.parquet"
    spot_local = os.path.join(CACHE_DIR, f"{symbol}_spot.parquet")
    download_file(spot_url, spot_local)

    df_spot = pd.read_parquet(spot_local)
    # Filter for target year
    df_spot["year"] = df_spot["timestamp"].dt.year.astype(str)
    spot_year = df_spot[df_spot["year"] == str(year)].copy()
    print(f"[{symbol}] Spot candles in {year}: {len(spot_year):,} rows")

    spot_year["trade_date"] = spot_year["timestamp"].dt.strftime("%Y-%m-%d")
    spot_year["trade_time"] = spot_year["timestamp"].dt.strftime("%H:%M:%S")

    # In-memory fast spot lookup
    spot_map = dict(zip(spot_year["trade_date"] + "|" + spot_year["trade_time"], spot_year["close"]))
    # Day close fallback lookup
    day_close_map = spot_year.groupby("trade_date")["close"].last().to_dict()

    def get_spot(date_str, time_str):
        k = f"{date_str}|{time_str}"
        if k in spot_map:
            return spot_map[k]
        return day_close_map.get(date_str, None)

    # Insert spot into local MySQL ohlcv_data
    conn = get_db()
    with conn.cursor() as cur:
        spot_rows = [
            (symbol, r["trade_date"], r["trade_time"], float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), int(r["volume"]))
            for _, r in spot_year.iterrows()
        ]
        print(f"[{symbol}] Inserting {len(spot_rows):,} spot candles into local MySQL ohlcv_data...")
        for i in range(0, len(spot_rows), INSERT_BATCH_SIZE):
            batch = spot_rows[i:i + INSERT_BATCH_SIZE]
            cur.executemany("""
                INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)
            """, batch)
    conn.close()
    print(f"[{symbol}] ✅ Spot candles inserted.")

    # 2. Fetch & Process Option Expiries
    print(f"\n[2/3] Querying Hugging Face for {symbol} {year} Option Expiries...")
    tree = get_huggingface_tree()
    prefix = f"options/{symbol}/{year}-"
    expiries_files = [f for f in tree if f.startswith(prefix) and f.endswith(".parquet")]
    expiries_files.sort()

    def get_month(f):
        try:
            # f is options/SYMBOL/YYYY-MM-DD.parquet
            return int(os.path.basename(f).split("-")[1])
        except Exception:
            return 0

    if from_month:
        expiries_files = [f for f in expiries_files if get_month(f) >= int(from_month)]
    if to_month:
        expiries_files = [f for f in expiries_files if get_month(f) <= int(to_month)]

    if limit:
        expiries_files = expiries_files[:limit]
    print(f"[{symbol}] Processing {len(expiries_files)} expiries for {year}:")
    for f in expiries_files[:5]:
        print(f"  - {f}")
    if len(expiries_files) > 5:
        print(f"  ... and {len(expiries_files) - 5} more expiries")

    total_option_rows = 0
    start_time = time.time()

    conn = get_db()
    for idx, f_path in enumerate(expiries_files, 1):
        expiry_date = os.path.basename(f_path).replace(".parquet", "")
        f_url = f"https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/{f_path}"
        local_f = os.path.join(CACHE_DIR, f"{symbol}_{expiry_date}.parquet")
        
        t0 = time.time()
        download_file(f_url, local_f)
        df_opt = pd.read_parquet(local_f)

        # Filter strictly for target year trade dates
        df_opt["year"] = df_opt["timestamp"].dt.year.astype(str)
        df_opt = df_opt[df_opt["year"] == str(year)].copy()
        if len(df_opt) == 0:
            continue

        df_opt["trade_date"] = df_opt["timestamp"].dt.strftime("%Y-%m-%d")
        df_opt["trade_time"] = df_opt["timestamp"].dt.strftime("%H:%M:%S")

        # Separate CE and PE
        ce_df = df_opt[df_opt["option_type"] == "CE"].copy()
        pe_df = df_opt[df_opt["option_type"] == "PE"].copy()

        # Merge CE and PE on (trade_date, trade_time, strike)
        merged = pd.merge(
            ce_df[["trade_date", "trade_time", "strike", "close", "open_interest", "volume"]],
            pe_df[["trade_date", "trade_time", "strike", "close", "open_interest", "volume"]],
            on=["trade_date", "trade_time", "strike"],
            how="outer",
            suffixes=("_ce", "_pe")
        )

        # ATM ± 30 filtering per minute snapshot
        rows_to_insert = []
        for (d, t), grp in merged.groupby(["trade_date", "trade_time"]):
            spot = get_spot(d, t)
            if not spot or spot <= 0:
                continue

            strikes = sorted(grp["strike"].unique())
            if not strikes:
                continue

            # Find nearest strike to spot
            atm_idx = min(range(len(strikes)), key=lambda i: abs(strikes[i] - spot))
            min_idx = max(0, atm_idx - max_atm_offset)
            max_idx = min(len(strikes) - 1, atm_idx + max_atm_offset)
            allowed_strikes = set(strikes[min_idx:max_idx + 1])

            t_years = years_to_expiry(expiry_date, d, t)

            grp_filtered = grp[grp["strike"].isin(allowed_strikes)]
            for _, r in grp_filtered.iterrows():
                strike = float(r["strike"])
                ce_ltp = float(r["close_ce"]) if pd.notnull(r["close_ce"]) else None
                ce_oi = int(r["open_interest_ce"]) if pd.notnull(r["open_interest_ce"]) else None
                ce_vol = int(r["volume_ce"]) if pd.notnull(r["volume_ce"]) else None

                pe_ltp = float(r["close_pe"]) if pd.notnull(r["close_pe"]) else None
                pe_oi = int(r["open_interest_pe"]) if pd.notnull(r["open_interest_pe"]) else None
                pe_vol = int(r["volume_pe"]) if pd.notnull(r["volume_pe"]) else None

                # Compute Greeks
                ce_iv = bs_iv(ce_ltp, spot, strike, t_years, "call") if ce_ltp else None
                pe_iv = bs_iv(pe_ltp, spot, strike, t_years, "put") if pe_ltp else None

                cg = bs_greeks(spot, strike, t_years, ce_iv or 0.15, "call") if ce_ltp else {}
                pg = bs_greeks(spot, strike, t_years, pe_iv or 0.15, "put") if pe_ltp else {}

                rows_to_insert.append((
                    symbol, d, t, expiry_date, strike, spot,
                    ce_ltp, ce_oi, None, round(ce_iv * 100.0, 2) if ce_iv else None, ce_vol,
                    cg.get("delta"), cg.get("gamma"), cg.get("theta"), cg.get("vega"),
                    pe_ltp, pe_oi, None, round(pe_iv * 100.0, 2) if pe_iv else None, pe_vol,
                    pg.get("delta"), pg.get("gamma"), pg.get("theta"), pg.get("vega")
                ))

        # Batch insert into local MySQL option_chain_history
        with conn.cursor() as cur:
            for i in range(0, len(rows_to_insert), INSERT_BATCH_SIZE):
                batch = rows_to_insert[i:i + INSERT_BATCH_SIZE]
                for attempt in range(5):
                    try:
                        cur.executemany("""
                            INSERT INTO option_chain_history (
                                symbol, trade_date, trade_time, expiry, strike, underlying_price,
                                ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                                pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                underlying_price=VALUES(underlying_price),
                                ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_iv=VALUES(ce_iv), ce_volume=VALUES(ce_volume),
                                ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
                                pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_iv=VALUES(pe_iv), pe_volume=VALUES(pe_volume),
                                pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)
                        """, batch)
                        break
                    except pymysql.err.OperationalError as e:
                        if e.args[0] in (1213, 1205) and attempt < 4:
                            time.sleep(1 + attempt * 2)
                            conn.rollback()
                            continue
                        raise

        total_option_rows += len(rows_to_insert)
        dt = time.time() - t0
        print(f"[{idx}/{len(expiries_files)}] {expiry_date}: {len(rows_to_insert):,} rows inserted in {dt:.1f}s (running total: {total_option_rows:,})")

    conn.close()
    elapsed = (time.time() - start_time) / 60.0
    print(f"\n[{symbol}] {len(expiries_files)} expiries for {year} loaded: {total_option_rows:,} rows in {elapsed:.1f} min.")

    # Sync coverage summary table so simulator immediately registers all dates
    if total_option_rows > 0:
        print(f"\n[{symbol}] Syncing option_chain_coverage_summary for {year}...")
        try:
            conn = get_db()
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO option_chain_coverage_summary (symbol, expiry_date, trade_date, row_count, minute_rows)
                    SELECT symbol, expiry, trade_date, COUNT(*), COUNT(DISTINCT trade_time)
                    FROM option_chain_history
                    WHERE symbol = %s AND trade_date >= %s AND trade_date <= %s
                    GROUP BY symbol, expiry, trade_date
                    ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), minute_rows = VALUES(minute_rows)
                """, (symbol, f"{year}-01-01", f"{year}-12-31"))
            conn.close()
            print(f"[{symbol}] ✅ Coverage summary table synced.")

            # Invalidate simulator dates cache
            cache_inval = os.path.join(BASE_DIR, "server", "data", "simulator-dates-cache.invalidated")
            with open(cache_inval, "w") as f:
                f.write(str(int(time.time())))
            print(f"[{symbol}] ✅ Simulator dates cache invalidated.")
        except Exception as e:
            print(f"[{symbol}] ⚠️ Coverage summary sync notice: {e}")

    # 3. Trigger Archival Pipeline to Stream-Merge with Google Drive & Auto-Prune
    if do_upload:
        print("\n[3/3] Triggering Smart Cloud Archival & Google Drive Stream-Merge...")
        script_path = os.path.join(BASE_DIR, "server", "services", "archivalPipelineService.js")

        # Upload OHLCV first
        print(f"[{symbol}] Archiving Spot OHLCV ({year}) to Google Drive...")
        subprocess.run(["node", script_path, "ohlcv", symbol, str(year), "true"], check=True)

        # Upload Option Chain second
        print(f"[{symbol}] Archiving Option Chain ({year}) to Google Drive (with smart merge & auto-prune)...")
        subprocess.run(["node", script_path, "option_chain", symbol, str(year), "true"], check=True)

        print("\n" + "=" * 80)
        print(f" 🎉 SUCCESS! {symbol} {year} FULL ARCHIVAL COMPLETE ON GOOGLE DRIVE!")
        print("=" * 80)
    else:
        print("\n[3/3] Upload skipped (--no-upload set). Data retained in local MySQL.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Import Hugging Face Indian F&O data to Drive")
    parser.add_argument("--symbol", default="NIFTY", help="Symbol (NIFTY, BANKNIFTY, SENSEX)")
    parser.add_argument("--year", default="2024", help="Year (e.g. 2024, 2023)")
    parser.add_argument("--from-month", type=int, default=None, help="Start month (1-12)")
    parser.add_argument("--to-month", type=int, default=None, help="End month (1-12)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of expiries to process")
    parser.add_argument("--max-atm-offset", type=int, default=30, help="ATM ± strike window (default: 30)")
    parser.add_argument("--no-upload", action="store_true", help="Skip Google Drive upload")
    args = parser.parse_args()

    process_symbol_year(
        symbol=args.symbol,
        year=args.year,
        from_month=args.from_month,
        to_month=args.to_month,
        max_atm_offset=args.max_atm_offset,
        limit=args.limit,
        do_upload=not args.no_upload
    )
