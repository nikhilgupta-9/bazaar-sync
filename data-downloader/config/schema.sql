-- Bazaar Sync — data-downloader schema subset
-- ---------------------------------------------------------------------------
-- These are the ONLY tables this standalone downloader reads or writes. They
-- are byte-for-byte the same definitions as the main app's
-- server/config/schema.sql — kept in sync by hand. If you point this
-- downloader at the SAME MySQL database the main app uses, you do NOT need to
-- run this file at all (the app's schema.sql already created these). Run it
-- only when the downloader has its own dedicated database.
--
-- Run: mysql -u root bazaar_sync < config/schema.sql
--
--   option_chain_history   <- Upstox / Breeze / NSE+BSE Bhavcopy backfill
--   ohlcv_data             <- underlying daily/intraday candles (same sources)
--   live_index_ticks       <- market worker, one row/minute per index
--   live_option_ticks      <- market worker, one row/minute per option contract
--   live_greeks_snapshots  <- market worker, every 5s (IV/greeks computed locally)
--   pcr_snapshots          <- market worker, every 60s per symbol
--   oi_summary_snapshots   <- market worker, every 60s per symbol+strike
-- ---------------------------------------------------------------------------

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
  KEY idx_symbol_date_time (symbol, trade_date, trade_time),
  KEY idx_sym_date_expiry (symbol, trade_date, expiry)
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

-- ---------------------------------------------------------------------------
-- Live market-data tiers — written ONLY by workers/databaseWriter.js's bulk
-- inserts (the market worker process). Same shape as the main app.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS live_index_ticks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  tick_date DATE NOT NULL,
  tick_time TIME NOT NULL,
  ltp DECIMAL(10,2) NOT NULL,
  open DECIMAL(10,2), high DECIMAL(10,2), low DECIMAL(10,2), close DECIMAL(10,2),
  volume BIGINT,
  exchange_ts BIGINT,
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
  iv DECIMAL(6,2),
  delta DECIMAL(6,4), gamma DECIMAL(8,6), theta DECIMAL(8,4), vega DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contract_time (underlying, expiry, strike, opt_right, snap_date, snap_time),
  KEY idx_underlying_time (underlying, snap_date, snap_time)
) ENGINE=InnoDB;

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

-- ---------------------------------------------------------------------------
-- Retrofit for older databases (the main app's schema.sql grew these indexes
-- over time and CREATE TABLE IF NOT EXISTS does not add them to a table that
-- already exists). Safe to run once; ignore "Duplicate key name" errors.
-- ---------------------------------------------------------------------------
-- ALTER TABLE option_chain_history ADD INDEX idx_symbol_date_time (symbol, trade_date, trade_time);
-- ALTER TABLE option_chain_history ADD INDEX idx_sym_date_expiry (symbol, trade_date, expiry);
