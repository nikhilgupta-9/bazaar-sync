-- Bazaar Sync Complete Database Schema
-- Exported: 2026-10-04T11:42:55.929Z

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `backtest_results` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `strategy_id` bigint(20) unsigned DEFAULT NULL,
  `underlying` varchar(20) NOT NULL,
  `expiry_type` enum('weekly','monthly') NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `params` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`params`)),
  `net_pnl` decimal(14,2) DEFAULT NULL,
  `win_rate` decimal(5,2) DEFAULT NULL,
  `total_trades` int(11) DEFAULT NULL,
  `max_drawdown` decimal(14,2) DEFAULT NULL,
  `sharpe_ratio` decimal(6,3) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `strategy_id` (`strategy_id`),
  CONSTRAINT `backtest_results_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `backtest_results_ibfk_2` FOREIGN KEY (`strategy_id`) REFERENCES `strategies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `backtest_trades` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `backtest_result_id` bigint(20) unsigned NOT NULL,
  `leg_index` int(11) DEFAULT NULL,
  `entry_time` datetime NOT NULL,
  `exit_time` datetime DEFAULT NULL,
  `entry_price` decimal(10,2) DEFAULT NULL,
  `exit_price` decimal(10,2) DEFAULT NULL,
  `quantity` int(11) DEFAULT NULL,
  `pnl` decimal(12,2) DEFAULT NULL,
  `exit_reason` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_backtest` (`backtest_result_id`),
  CONSTRAINT `backtest_trades_ibfk_1` FOREIGN KEY (`backtest_result_id`) REFERENCES `backtest_results` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `coupon_redemptions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `coupon_id` bigint(20) unsigned NOT NULL,
  `user_id` bigint(20) unsigned NOT NULL,
  `razorpay_payment_id` varchar(64) NOT NULL,
  `discount_paise` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `razorpay_payment_id` (`razorpay_payment_id`),
  KEY `coupon_id` (`coupon_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `coupon_redemptions_ibfk_1` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `coupon_redemptions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `coupons` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `discount_type` enum('percent','flat') NOT NULL,
  `discount_value` decimal(10,2) NOT NULL,
  `max_redemptions` int(11) DEFAULT NULL,
  `redemption_count` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `expires_at` datetime DEFAULT NULL,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `coupons_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `data_extraction_jobs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `source` varchar(32) NOT NULL,
  `data_type` varchar(32) NOT NULL,
  `year` int(11) DEFAULT NULL,
  `from_month` tinyint(4) DEFAULT NULL,
  `to_month` tinyint(4) DEFAULT NULL,
  `symbols` varchar(1000) DEFAULT NULL,
  `extra_args` varchar(255) DEFAULT NULL,
  `command` text DEFAULT NULL,
  `status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  `pid` int(11) DEFAULT NULL,
  `exit_code` int(11) DEFAULT NULL,
  `log_path` varchar(500) DEFAULT NULL,
  `summary` text DEFAULT NULL,
  `requested_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `requested_by` (`requested_by`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `data_extraction_jobs_ibfk_1` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `event_date` date NOT NULL,
  `event_time` time DEFAULT NULL,
  `link` varchar(500) DEFAULT NULL,
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_published_date` (`is_published`,`event_date`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `futures_coverage_summary` (
  `symbol` varchar(50) NOT NULL,
  `trade_date` date NOT NULL,
  `row_count` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`symbol`,`trade_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `futures_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `expiry` date NOT NULL,
  `trade_date` date NOT NULL,
  `trade_time` time NOT NULL,
  `open` decimal(12,2) DEFAULT NULL,
  `high` decimal(12,2) DEFAULT NULL,
  `low` decimal(12,2) DEFAULT NULL,
  `close` decimal(12,2) DEFAULT NULL,
  `volume` bigint(20) DEFAULT NULL,
  `oi` bigint(20) DEFAULT NULL,
  `oi_change` bigint(20) DEFAULT NULL,
  `underlying_price` decimal(12,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_fut_snapshot` (`symbol`,`expiry`,`trade_date`,`trade_time`),
  KEY `idx_fut_backtest_range` (`symbol`,`expiry`,`trade_date`,`trade_time`),
  KEY `idx_fut_symbol_date_time` (`symbol`,`trade_date`,`trade_time`)
) ENGINE=InnoDB AUTO_INCREMENT=96726956 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `futures_year_coverage` (
  `symbol` varchar(50) NOT NULL,
  `year` int(11) NOT NULL,
  `count` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`symbol`,`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `gdrive_archive_records` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `symbol` varchar(32) NOT NULL,
  `year` int(11) NOT NULL,
  `month` int(11) DEFAULT NULL,
  `data_type` varchar(32) NOT NULL DEFAULT 'option_chain',
  `record_count` bigint(20) DEFAULT 0,
  `file_name` varchar(255) NOT NULL,
  `file_size_bytes` bigint(20) DEFAULT 0,
  `gdrive_file_id` varchar(128) DEFAULT NULL,
  `gdrive_web_link` text DEFAULT NULL,
  `gdrive_folder_id` varchar(128) DEFAULT NULL,
  `status` enum('pending','uploading','archived','pruned','error') DEFAULT 'pending',
  `checksum_sha256` varchar(64) DEFAULT NULL,
  `extracted_at` datetime DEFAULT current_timestamp(),
  `uploaded_at` datetime DEFAULT NULL,
  `pruned_at` datetime DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sym_yr_type_mo` (`symbol`,`year`,`data_type`,`month`)
) ENGINE=InnoDB AUTO_INCREMENT=965 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `gdrive_sync_settings` (
  `setting_key` varchar(64) NOT NULL,
  `setting_value` text NOT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `institute_ip_allowlist` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ip_or_cidr` varchar(45) NOT NULL,
  `label` varchar(150) DEFAULT NULL,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ip_or_cidr` (`ip_or_cidr`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `institute_ip_allowlist_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `live_greeks_snapshots` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `underlying` varchar(20) NOT NULL,
  `expiry` date NOT NULL,
  `strike` decimal(10,2) NOT NULL,
  `opt_right` enum('CE','PE') NOT NULL,
  `snap_date` date NOT NULL,
  `snap_time` time NOT NULL,
  `ltp` decimal(10,2) DEFAULT NULL,
  `spot` decimal(10,2) DEFAULT NULL,
  `iv` decimal(6,2) DEFAULT NULL,
  `delta` decimal(6,4) DEFAULT NULL,
  `gamma` decimal(8,6) DEFAULT NULL,
  `theta` decimal(8,4) DEFAULT NULL,
  `vega` decimal(8,4) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_contract_time` (`underlying`,`expiry`,`strike`,`opt_right`,`snap_date`,`snap_time`),
  KEY `idx_underlying_time` (`underlying`,`snap_date`,`snap_time`)
) ENGINE=InnoDB AUTO_INCREMENT=5573954 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `live_index_ticks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `tick_date` date NOT NULL,
  `tick_time` time NOT NULL,
  `ltp` decimal(10,2) NOT NULL,
  `open` decimal(10,2) DEFAULT NULL,
  `high` decimal(10,2) DEFAULT NULL,
  `low` decimal(10,2) DEFAULT NULL,
  `close` decimal(10,2) DEFAULT NULL,
  `volume` bigint(20) DEFAULT NULL,
  `exchange_ts` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_symbol_time` (`symbol`,`tick_date`,`tick_time`)
) ENGINE=InnoDB AUTO_INCREMENT=11570 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `live_option_ticks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `underlying` varchar(20) NOT NULL,
  `expiry` date NOT NULL,
  `strike` decimal(10,2) NOT NULL,
  `opt_right` enum('CE','PE') NOT NULL,
  `tick_date` date NOT NULL,
  `tick_time` time NOT NULL,
  `ltp` decimal(10,2) NOT NULL,
  `volume` bigint(20) DEFAULT NULL,
  `oi` bigint(20) DEFAULT NULL,
  `oi_change_percent` decimal(8,4) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_contract_time` (`underlying`,`expiry`,`strike`,`opt_right`,`tick_date`,`tick_time`),
  KEY `idx_underlying_time` (`underlying`,`tick_date`,`tick_time`)
) ENGINE=InnoDB AUTO_INCREMENT=596648 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `lot_size_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `lot_size` int(11) NOT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_symbol_effective` (`symbol`,`effective_from`)
) ENGINE=InnoDB AUTO_INCREMENT=260 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ohlcv_coverage_summary` (
  `symbol` varchar(20) NOT NULL,
  `trade_date` date NOT NULL,
  `row_count` int(10) unsigned NOT NULL DEFAULT 0,
  `minute_rows` int(10) unsigned NOT NULL DEFAULT 0,
  `first_time` time DEFAULT NULL,
  `last_time` time DEFAULT NULL,
  `last_updated` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`symbol`,`trade_date`),
  KEY `idx_trade_date` (`trade_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ohlcv_data` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `trade_date` date NOT NULL,
  `trade_time` time NOT NULL,
  `open` decimal(10,2) DEFAULT NULL,
  `high` decimal(10,2) DEFAULT NULL,
  `low` decimal(10,2) DEFAULT NULL,
  `close` decimal(10,2) DEFAULT NULL,
  `volume` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_candle` (`symbol`,`trade_date`,`trade_time`),
  KEY `idx_symbol_date` (`symbol`,`trade_date`)
) ENGINE=InnoDB AUTO_INCREMENT=4757954 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `oi_summary_snapshots` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `expiry` date NOT NULL,
  `strike` decimal(10,2) NOT NULL,
  `snap_date` date NOT NULL,
  `snap_time` time NOT NULL,
  `ce_oi` bigint(20) DEFAULT NULL,
  `pe_oi` bigint(20) DEFAULT NULL,
  `ce_ltp` decimal(10,2) DEFAULT NULL,
  `pe_ltp` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_symbol_time` (`symbol`,`snap_date`,`snap_time`),
  KEY `idx_symbol_strike` (`symbol`,`expiry`,`strike`,`snap_date`)
) ENGINE=InnoDB AUTO_INCREMENT=689165 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `option_chain_cache` (
  `cache_key` varchar(100) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `expires_at` datetime NOT NULL,
  `cached_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`cache_key`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `option_chain_coverage_summary` (
  `symbol` varchar(20) NOT NULL,
  `expiry_date` date NOT NULL,
  `trade_date` date NOT NULL,
  `row_count` int(10) unsigned NOT NULL DEFAULT 0,
  `minute_rows` int(10) unsigned NOT NULL DEFAULT 0,
  `last_updated` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`symbol`,`expiry_date`,`trade_date`),
  KEY `idx_symbol_trade_date` (`symbol`,`trade_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `option_chain_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `trade_date` date NOT NULL,
  `trade_time` time NOT NULL,
  `expiry` date NOT NULL,
  `strike` decimal(10,2) NOT NULL,
  `underlying_price` decimal(10,2) DEFAULT NULL,
  `ce_ltp` decimal(10,2) DEFAULT NULL,
  `ce_oi` bigint(20) DEFAULT NULL,
  `ce_oi_change` bigint(20) DEFAULT NULL,
  `ce_iv` decimal(6,2) DEFAULT NULL,
  `ce_volume` bigint(20) DEFAULT NULL,
  `ce_delta` decimal(6,4) DEFAULT NULL,
  `ce_gamma` decimal(8,6) DEFAULT NULL,
  `ce_theta` decimal(8,4) DEFAULT NULL,
  `ce_vega` decimal(8,4) DEFAULT NULL,
  `pe_ltp` decimal(10,2) DEFAULT NULL,
  `pe_oi` bigint(20) DEFAULT NULL,
  `pe_oi_change` bigint(20) DEFAULT NULL,
  `pe_iv` decimal(6,2) DEFAULT NULL,
  `pe_volume` bigint(20) DEFAULT NULL,
  `pe_delta` decimal(6,4) DEFAULT NULL,
  `pe_gamma` decimal(8,6) DEFAULT NULL,
  `pe_theta` decimal(8,4) DEFAULT NULL,
  `pe_vega` decimal(8,4) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_snapshot` (`symbol`,`expiry`,`strike`,`trade_date`,`trade_time`),
  KEY `idx_backtest_range` (`symbol`,`expiry`,`trade_date`,`trade_time`),
  KEY `idx_symbol_date_time` (`symbol`,`trade_date`,`trade_time`),
  KEY `idx_sym_date_expiry` (`symbol`,`trade_date`,`expiry`)
) ENGINE=InnoDB AUTO_INCREMENT=39280752 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `option_chain_snapshots` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `snapshot_time` datetime NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  PRIMARY KEY (`id`),
  KEY `idx_symbol_time` (`symbol`,`snapshot_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `paper_positions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `expiry` date NOT NULL,
  `strike` decimal(10,2) NOT NULL,
  `opt_right` enum('CE','PE') NOT NULL,
  `side` enum('long','short') NOT NULL DEFAULT 'long',
  `lots` int(11) NOT NULL,
  `lot_size` int(11) NOT NULL,
  `entry_price` decimal(10,2) NOT NULL,
  `margin_blocked` decimal(14,2) DEFAULT NULL,
  `strategy_name` varchar(100) DEFAULT NULL,
  `entry_time` datetime NOT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `exit_price` decimal(10,2) DEFAULT NULL,
  `exit_time` datetime DEFAULT NULL,
  `realized_pnl` decimal(14,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  CONSTRAINT `paper_positions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `paper_wallet_ledger` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `type` enum('trial_grant','pro_purchase_grant','refill_purchase','trade_debit','trade_credit') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `balance_after` decimal(14,2) NOT NULL,
  `razorpay_order_id` varchar(64) DEFAULT NULL,
  `razorpay_payment_id` varchar(64) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `razorpay_payment_id` (`razorpay_payment_id`),
  KEY `idx_user_time` (`user_id`,`created_at`),
  CONSTRAINT `paper_wallet_ledger_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `paper_wallets` (
  `user_id` bigint(20) unsigned NOT NULL,
  `balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `trial_started_at` datetime DEFAULT NULL,
  `trial_expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `paper_wallets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `password_reset_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `pcr_snapshots` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `symbol` varchar(20) NOT NULL,
  `snap_date` date NOT NULL,
  `snap_time` time NOT NULL,
  `pcr` decimal(8,4) DEFAULT NULL,
  `total_ce_oi` bigint(20) DEFAULT NULL,
  `total_pe_oi` bigint(20) DEFAULT NULL,
  `spot` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_symbol_time` (`symbol`,`snap_date`,`snap_time`)
) ENGINE=InnoDB AUTO_INCREMENT=22284 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `pro_plans` (
  `id` varchar(20) NOT NULL,
  `name` varchar(50) NOT NULL,
  `duration_label` varchar(30) NOT NULL,
  `days` int(10) unsigned NOT NULL,
  `price_in_paise` int(10) unsigned NOT NULL,
  `badge` varchar(30) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `seo_meta` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `path` varchar(255) NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `description` varchar(500) DEFAULT NULL,
  `og_image` varchar(500) DEFAULT NULL,
  `updated_by` bigint(20) unsigned DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `path` (`path`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `seo_meta_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `site_content` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(50) NOT NULL,
  `title` varchar(150) DEFAULT NULL,
  `content` longtext DEFAULT NULL,
  `updated_by` bigint(20) unsigned DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `site_content_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `strategies` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `underlying` varchar(20) NOT NULL,
  `legs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`legs`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `strategies_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `google_id` varchar(100) DEFAULT NULL,
  `tier` enum('free','pro') NOT NULL DEFAULT 'free',
  `pro_expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `current_session_id` varchar(64) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `last_login_ip` varchar(45) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `pincode` varchar(20) DEFAULT NULL,
  `country` varchar(100) DEFAULT 'India',
  `trading_style` varchar(50) DEFAULT 'Options Buyer',
  `preferred_indices` varchar(255) DEFAULT 'NIFTY, BANKNIFTY',
  `trading_experience` varchar(50) DEFAULT '1-3 Years',
  `capital_range` varchar(50) DEFAULT '₹1L - ₹5L',
  `default_risk_pct` decimal(5,2) DEFAULT 2.00,
  `default_stoploss_pct` decimal(5,2) DEFAULT 10.00,
  `default_target_pct` decimal(5,2) DEFAULT 20.00,
  `primary_broker` varchar(50) DEFAULT 'Angel One',
  `default_timeframe` varchar(20) DEFAULT '5m',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `google_id` (`google_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
