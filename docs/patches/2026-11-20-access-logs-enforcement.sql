-- Access logs + extension inventory scans + launch_events enrichment
-- Safe to re-run (IF NOT EXISTS / ignore duplicate columns via procedure-free ALTERs)

CREATE TABLE IF NOT EXISTS `access_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `tool_id` INT UNSIGNED NOT NULL,
  `username` VARCHAR(255) NULL,
  `product_id` VARCHAR(64) NULL,
  `client_ip` VARCHAR(64) NULL COMMENT 'Browser public IP (panel-style)',
  `request_ip` VARCHAR(64) NULL COMMENT 'API / edge view of client',
  `user_agent` VARCHAR(512) NULL,
  `extension_id` VARCHAR(128) NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `deny_reason` VARCHAR(255) NULL,
  `source` ENUM('amember', 'admin_access', 'other') NOT NULL DEFAULT 'admin_access',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_access_reseller_created` (`reseller_id`, `created_at`),
  KEY `idx_access_tool_created` (`tool_id`, `created_at`),
  KEY `idx_access_username` (`username`),
  KEY `idx_access_client_ip` (`client_ip`),
  CONSTRAINT `fk_access_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_access_tool` FOREIGN KEY (`tool_id`) REFERENCES `tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `extension_scans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NULL,
  `client_slug` VARCHAR(64) NOT NULL,
  `reporter_id` VARCHAR(128) NOT NULL,
  `extensions_json` JSON NOT NULL,
  `risky_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `enabled_risky_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scan_slug_created` (`client_slug`, `created_at`),
  KEY `idx_scan_reseller_created` (`reseller_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enrich launch_events (ignore errors if columns already exist when run manually)
ALTER TABLE `launch_events`
  ADD COLUMN `username` VARCHAR(255) NULL AFTER `extension_id`,
  ADD COLUMN `client_ip` VARCHAR(64) NULL AFTER `username`,
  ADD COLUMN `product_id` VARCHAR(64) NULL AFTER `client_ip`;
