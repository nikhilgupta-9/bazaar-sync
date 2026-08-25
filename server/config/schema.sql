-- Bazaar Sync — MySQL schema
-- MySQL is the only database (MongoDB/Redis dropped, 2026-07-02).
-- Run: mysql -u root bazaar_sync < server/config/schema.sql

CREATE TABLE IF NOT EXISTS option_chain_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,          -- NIFTY, BANKNIFTY, FINNIFTY, or F&O stock symbol
  trade_date DATE NOT NULL,
  trade_time TIME NOT NULL,
  expiry DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  underlying_price DECIMAL(10,2),
  ce_ltp DECIMAL(10,2), ce_oi BIGINT, ce_oi_change BIGINT, ce_iv DECIMAL(6,2), ce_volume BIGINT,
  ce_delta DECIMAL(6,4), ce_gamma DECIMAL(8,6), ce_theta DECIMAL(8,4), ce_vega DECIMAL(8,4),
  pe_ltp DECIMAL(10,2), pe_oi BIGINT, pe_oi_change BIGINT, pe_iv DECIMAL(6,2), pe_volume BIGINT,
  pe_delta DECIMAL(6,4), pe_gamma DECIMAL(8,6), pe_theta DECIMAL(8,4), pe_vega DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_snapshot (symbol, expiry, strike, trade_date, trade_time),
  KEY idx_backtest_range (symbol, expiry, trade_date, trade_time),
  -- Added Phase 7.1 (2026-08-06): simulatorController.js's listDates
  -- (GROUP BY trade_date, COUNT(DISTINCT trade_time) over every row for a
  -- symbol) and getChainAtTime's expiry-discovery query (WHERE symbol=? AND
  -- trade_date=?, no expiry known yet) both filter/group by trade_date
  -- BEFORE expiry is known — idx_backtest_range can't help since expiry
  -- sits between symbol and trade_date there, forcing a full scan of every
  -- row for the symbol (NIFTY alone is 5M+ rows after Phase 7's
  -- Bhavcopy/Breeze backfills: 6.8s measured for listDates, 1.2s for the
  -- expiry lookup — most of the Simulator page's ~15s load). Verified live
  -- against the real dev DB (2026-08-06): this index alone (no wider
  -- variant needed — a (symbol, trade_date, expiry, trade_time) index was
  -- tried first and was slower, since MySQL couldn't avoid a filesort with
  -- expiry sitting in the middle) took listDates to ~1.5s and the expiry
  -- lookup to ~0.04s. Existing databases need
  -- `ALTER TABLE option_chain_history ADD INDEX idx_symbol_date_time
  -- (symbol, trade_date, trade_time);` run by hand — schema.sql's
  -- CREATE TABLE IF NOT EXISTS does not retrofit already-created tables.
  KEY idx_symbol_date_time (symbol, trade_date, trade_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ohlcv_data (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  trade_date DATE NOT NULL,
  trade_time TIME NOT NULL,
  open DECIMAL(10,2), high DECIMAL(10,2), low DECIMAL(10,2), close DECIMAL(10,2),
  volume BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_candle (symbol, trade_date, trade_time),
  KEY idx_symbol_date (symbol, trade_date)
) ENGINE=InnoDB;

-- role powers the admin panel (Phase 9): 'admin' unlocks GET /api/admin/*
-- (requireAdmin.js). No self-service admin signup — the first admin is
-- always set by hand: UPDATE users SET role='admin' WHERE email='...';
-- Existing DBs created before the admin panel need:
--   ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user';
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255),          -- null when the account only uses Google OAuth
  google_id VARCHAR(100) UNIQUE,
  tier ENUM('free','pro') NOT NULL DEFAULT 'free',
  pro_expires_at DATETIME,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Forgot-password flow (Phase 12). Only the SHA-256 hash of the reset token
-- is stored, never the raw token — the raw token only ever exists in the
-- emailed link and briefly in the request body of the reset call, same
-- "never store the secret itself" instinct as password_hash above. A token
-- is single-use (used_at) and short-lived (expires_at, set by
-- authController.js — 1 hour). One user can have multiple outstanding
-- tokens (e.g. they requested twice); all of them are invalidated the
-- moment any one of them is successfully used, see resetPassword.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex digest of the raw token
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS strategies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  underlying VARCHAR(20) NOT NULL,
  legs JSON NOT NULL,                  -- [{action, type, strike, expiry, lots}, ...] up to 6 legs
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS backtest_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  strategy_id BIGINT UNSIGNED,
  underlying VARCHAR(20) NOT NULL,
  expiry_type ENUM('weekly','monthly') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  params JSON NOT NULL,                -- entry_time, dte, stop_loss_pct, target_pct, expiry_exit
  net_pnl DECIMAL(14,2),
  win_rate DECIMAL(5,2),
  total_trades INT,
  max_drawdown DECIMAL(14,2),
  sharpe_ratio DECIMAL(6,3),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Phase 6: live market-data tiers (written ONLY by the market worker's bulk
-- inserts — workers/databaseWriter.js). option_chain_history above stays the
-- backtest source, fed by the nightly historical cron; these tables are the
-- intraday live record at graduated resolutions:
--   live_index_ticks       every index tick
--   live_option_ticks      per option contract, at most every 2 seconds
--   live_greeks_snapshots  per option contract, every 5 seconds
--   pcr_snapshots          per symbol, every minute
--   oi_summary_snapshots   per symbol+strike, every minute
-- Indexed for the dashboard's two query patterns: latest-by-symbol and
-- range-by-time.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS live_index_ticks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  tick_date DATE NOT NULL,
  tick_time TIME NOT NULL,
  ltp DECIMAL(10,2) NOT NULL,
  open DECIMAL(10,2), high DECIMAL(10,2), low DECIMAL(10,2), close DECIMAL(10,2),
  volume BIGINT,
  exchange_ts BIGINT,                   -- raw exchange timestamp (epoch ms)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_symbol_time (symbol, tick_date, tick_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_option_ticks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  underlying VARCHAR(20) NOT NULL,
  expiry DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  opt_right ENUM('CE','PE') NOT NULL,
  tick_date DATE NOT NULL,
  tick_time TIME NOT NULL,
  ltp DECIMAL(10,2) NOT NULL,
  volume BIGINT,
  oi BIGINT,
  oi_change_percent DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contract_time (underlying, expiry, strike, opt_right, tick_date, tick_time),
  KEY idx_underlying_time (underlying, tick_date, tick_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_greeks_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  underlying VARCHAR(20) NOT NULL,
  expiry DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  opt_right ENUM('CE','PE') NOT NULL,
  snap_date DATE NOT NULL,
  snap_time TIME NOT NULL,
  ltp DECIMAL(10,2),
  spot DECIMAL(10,2),
  iv DECIMAL(6,2),                      -- percent, e.g. 14.25
  delta DECIMAL(6,4), gamma DECIMAL(8,6), theta DECIMAL(8,4), vega DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contract_time (underlying, expiry, strike, opt_right, snap_date, snap_time),
  KEY idx_underlying_time (underlying, snap_date, snap_time)
) ENGINE=InnoDB;

-- Also unlocks the previously-skipped IV Percentile Rank feature: this is the
-- persisted historical IV time series CLAUDE.md said we didn't have.
CREATE TABLE IF NOT EXISTS pcr_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  snap_date DATE NOT NULL,
  snap_time TIME NOT NULL,
  pcr DECIMAL(8,4),
  total_ce_oi BIGINT,
  total_pe_oi BIGINT,
  spot DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_symbol_time (symbol, snap_date, snap_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS oi_summary_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  expiry DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  snap_date DATE NOT NULL,
  snap_time TIME NOT NULL,
  ce_oi BIGINT, pe_oi BIGINT,
  ce_ltp DECIMAL(10,2), pe_ltp DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_symbol_time (symbol, snap_date, snap_time),
  KEY idx_symbol_strike (symbol, expiry, strike, snap_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS backtest_trades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  backtest_result_id BIGINT UNSIGNED NOT NULL,
  leg_index INT,
  entry_time DATETIME NOT NULL,
  exit_time DATETIME,
  entry_price DECIMAL(10,2),
  exit_price DECIMAL(10,2),
  quantity INT,
  pnl DECIMAL(12,2),
  exit_reason VARCHAR(30),             -- stop_loss, target, expiry
  FOREIGN KEY (backtest_result_id) REFERENCES backtest_results(id) ON DELETE CASCADE,
  KEY idx_backtest (backtest_result_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Phase 8.2: Paper Trade wallet. Pro-ness itself still lives on users.tier/
-- pro_expires_at (unchanged) — buying/renewing Pro also grants paper capital
-- here, it's the same ₹499/mo subscription, not a second product. These two
-- tables only track the trial window and the running paper balance.
-- Phase 8.3 added the trade_debit/trade_credit ledger types below plus
-- paper_positions (the actual order-placement engine) — see CLAUDE.md.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS paper_wallets (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  trial_started_at DATETIME,
  trial_expires_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- amount is a SIGNED balance delta (positive = credit, negative = debit).
-- trial_grant/pro_purchase_grant/refill_purchase are always positive;
-- trade_debit (opening a position) is negative, trade_credit (closing one)
-- is positive. Existing DBs created before Phase 8.3 need:
--   ALTER TABLE paper_wallet_ledger MODIFY type ENUM('trial_grant',
--   'pro_purchase_grant','refill_purchase','trade_debit','trade_credit') NOT NULL;
-- (schema.sql's CREATE TABLE IF NOT EXISTS does not retrofit existing tables —
-- same caveat as idx_symbol_date_time on option_chain_history above.)
CREATE TABLE IF NOT EXISTS paper_wallet_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('trial_grant','pro_purchase_grant','refill_purchase','trade_debit','trade_credit') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  razorpay_order_id VARCHAR(64),
  razorpay_payment_id VARCHAR(64) UNIQUE,   -- NULL-safe unique; blocks double-credit on retry
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_user_time (user_id, created_at)
) ENGINE=InnoDB;

-- Phase 8.3: the actual paper-trading positions (BUY/long only at first).
-- Phase 8.4 added `side`/`margin_blocked` for SELL/short (writing) —
-- margin is a flat-percentage-of-notional approximation
-- (MARGIN_PERCENT_OF_NOTIONAL in paperTradeConfig.js), not real SPAN, and
-- there is NO intraday margin monitoring/auto square-off (deliberate v1
-- limitation — see CLAUDE.md Phase 8.4). Each Buy/Sell creates its own row
-- (no averaging into an existing position at the same contract); close is
-- all-or-nothing (no partial close) — both deliberate v1 choices.
-- Existing DBs (created before Phase 8.4) need:
--   ALTER TABLE paper_positions
--     ADD COLUMN side ENUM('long','short') NOT NULL DEFAULT 'long' AFTER opt_right,
--     ADD COLUMN margin_blocked DECIMAL(14,2) NULL AFTER entry_price;
-- ---------------------------------------------------------------------------
-- Phase 11: remaining admin-panel sections (Institute Access, Plans &
-- Coupons, Events, T&C, SEO Tool) — see CLAUDE.md. All management is
-- requireAuth+requireAdmin; only events/site_content/seo_meta have a public
-- read side (published content, current T&C text, per-page meta tags).
-- ---------------------------------------------------------------------------

-- Institute free access: an allowlisted IP or CIDR range (e.g.
-- '203.0.113.0/24') grants a logged-in user Pro-equivalent access for
-- requests from that network — see services/instituteAccessService.js. Not
-- MAC-based (browsers don't expose device MAC addresses to a website).
CREATE TABLE IF NOT EXISTS institute_ip_allowlist (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_or_cidr VARCHAR(45) NOT NULL UNIQUE,   -- IPv4 exact ('203.0.113.5') or CIDR ('203.0.113.0/24'); IPv6 exact-match only
  label VARCHAR(150),                       -- e.g. institute/college name, admin-facing only
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Coupon codes against the existing PRO_PLANS catalog (paperTradeConfig.js)
-- — NOT a second pricing-plan system, per the user's explicit scope choice
-- (2026-08-20): plans stay exactly as they are, coupons just discount the
-- Razorpay order amount at checkout. See services/couponService.js.
CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  discount_type ENUM('percent','flat') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,    -- percent: 0-100; flat: rupees
  max_redemptions INT,                      -- NULL = unlimited
  redemption_count INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME,
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- One row per successful redemption. razorpay_payment_id is UNIQUE — same
-- idempotency guard convention as paper_wallet_ledger, so a retried verify
-- call can never double-count a redemption against max_redemptions.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  coupon_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  razorpay_payment_id VARCHAR(64) NOT NULL UNIQUE,
  discount_paise INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Simple announcement/webinar listing, admin-managed, shown on the public
-- /events page — no registration/ticketing.
CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TIME,
  link VARCHAR(500),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_published_date (is_published, event_date)
) ENGINE=InnoDB;

-- Generic slug->content store. Only 'terms' is used today (T&C editor); the
-- shape generalizes to other legal/static pages later without a new table.
CREATE TABLE IF NOT EXISTS site_content (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(150),
  content LONGTEXT,
  updated_by BIGINT UNSIGNED,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Per-page meta tags (SEO Tool). `path` is a client route like '/', '/pricing',
-- '/events' — client/src/hooks/usePageSeo.js fetches by current path and sets
-- document.title + <meta description>/<meta og:image> on route change. This
-- is a client-side-only SPA, no server-side rendering — so these tags help
-- JS-executing crawlers (Googlebot) but not simpler ones; stated honestly,
-- not oversold as full SSR-grade SEO.
CREATE TABLE IF NOT EXISTS seo_meta (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  path VARCHAR(255) NOT NULL UNIQUE,
  title VARCHAR(200),
  description VARCHAR(500),
  og_image VARCHAR(500),
  updated_by BIGINT UNSIGNED,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Real historical lot sizes, effective-dated — NSE revises F&O lot sizes
-- periodically (SEBI-driven review, roughly every 6 months), so a multi-
-- year Simulator replay or Backtest run must use the lot size that was
-- actually in effect on the historical trade date, not today's. Neither
-- Bhavcopy/Breeze/Upstox (services/nseBhavcopy.js etc.) nor Angel One's
-- scrip master carry historical lot-size-by-date — only today's value —
-- so this is admin-seeded from NSE's own published lot-size-revision
-- circulars (admin/src/pages/LotSizeHistory.jsx), deliberately NOT
-- auto-populated or guessed (see services/lotSizeHistoryService.js's own
-- header comment). effective_to NULL = still in effect.
CREATE TABLE IF NOT EXISTS lot_size_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  lot_size INT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_symbol_effective (symbol, effective_from)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS paper_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  expiry DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  opt_right ENUM('CE','PE') NOT NULL,
  side ENUM('long','short') NOT NULL DEFAULT 'long',
  lots INT NOT NULL,
  lot_size INT NOT NULL,               -- snapshot at entry
  entry_price DECIMAL(10,2) NOT NULL,
  margin_blocked DECIMAL(14,2),        -- short positions only; blocked at entry, never recalculated
  entry_time DATETIME NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  exit_price DECIMAL(10,2),
  exit_time DATETIME,
  realized_pnl DECIMAL(14,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB;
