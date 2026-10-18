-- Zero-Data-Loss MySQL Range Partitioning & Index Optimization for option_chain_history
-- Partition key: YEAR(trade_date)
-- Note: In MySQL, all UNIQUE and PRIMARY keys must include the partitioning column (`trade_date`).

-- 1. Add composite index for ultra-fast multi-strike, expiry and time scrubber lookups
ALTER TABLE `option_chain_history`
    ADD INDEX `idx_sym_exp_date_strike_time` (`symbol`, `expiry`, `trade_date`, `trade_time`, `strike`);

-- 2. Modify PRIMARY KEY to include `trade_date` (required for MySQL partitioning)
ALTER TABLE `option_chain_history`
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`id`, `trade_date`);

-- 3. Apply Range Partitioning by YEAR(trade_date)
ALTER TABLE `option_chain_history`
PARTITION BY RANGE (YEAR(`trade_date`)) (
    PARTITION p2020 VALUES LESS THAN (2021),
    PARTITION p2021 VALUES LESS THAN (2022),
    PARTITION p2022 VALUES LESS THAN (2023),
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p2027 VALUES LESS THAN (2028),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
