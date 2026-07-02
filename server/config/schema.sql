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
  KEY idx_backtest_range (symbol, expiry, trade_date, trade_time)
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

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255),          -- null when the account only uses Google OAuth
  google_id VARCHAR(100) UNIQUE,
  tier ENUM('free','pro') NOT NULL DEFAULT 'free',
  pro_expires_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
