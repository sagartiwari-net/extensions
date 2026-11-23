-- 1Clk Access v2 — schema
-- Charset: utf8mb4
-- Automation tables intentionally omitted (Phase 7+)

CREATE DATABASE IF NOT EXISTS `oneclk_v2` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `oneclk_v2`;

-- ---------------------------------------------------------------------------
-- Tenancy & admin
-- ---------------------------------------------------------------------------

CREATE TABLE `resellers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `key_prefix` VARCHAR(8) NOT NULL COMMENT 'forced tool_key prefix e.g. tm, tw, sg',
  `member_secret` VARCHAR(255) NULL COMMENT 'aMember / access button HMAC',
  `settings` JSON NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resellers_slug` (`slug`),
  UNIQUE KEY `uq_resellers_prefix` (`key_prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('master', 'reseller') NOT NULL DEFAULT 'reseller',
  `reseller_id` INT UNSIGNED NULL COMMENT 'NULL for master',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_username` (`username`),
  KEY `idx_admin_reseller` (`reseller_id`),
  CONSTRAINT `fk_admin_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Proxy / UA libraries (owner NULL = global/master library)
-- ---------------------------------------------------------------------------

CREATE TABLE `proxy_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_reseller_id` INT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `port` INT UNSIGNED NOT NULL,
  `scheme` ENUM('http', 'https', 'socks5') NOT NULL DEFAULT 'http',
  `username` VARCHAR(255) NULL,
  `password` VARCHAR(255) NULL,
  `bypass_list` JSON NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proxy_owner` (`owner_reseller_id`),
  CONSTRAINT `fk_proxy_owner` FOREIGN KEY (`owner_reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_agent_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_reseller_id` INT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `user_agent` VARCHAR(512) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ua_owner` (`owner_reseller_id`),
  CONSTRAINT `fk_ua_owner` FOREIGN KEY (`owner_reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Cookie sync pools (bi-directional)
-- ---------------------------------------------------------------------------

CREATE TABLE `cookie_sync_pools` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `created_by_reseller_id` INT UNSIGNED NULL,
  `cookie_payload` LONGTEXT NULL COMMENT 'AES ciphertext (CryptoJS-compatible)',
  `cookie_password` VARCHAR(255) NULL,
  `payload_sha256` CHAR(64) NULL COMMENT 'hash of ciphertext for audit',
  `updated_by_tool_id` INT UNSIGNED NULL,
  `updated_by_admin_id` INT UNSIGNED NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pool_creator` (`created_by_reseller_id`),
  CONSTRAINT `fk_pool_creator` FOREIGN KEY (`created_by_reseller_id`) REFERENCES `resellers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tools
-- ---------------------------------------------------------------------------

CREATE TABLE `tools` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `tool_key` VARCHAR(64) NOT NULL COMMENT 'stable public key for access button',
  `name` VARCHAR(255) NOT NULL,
  `web_url` VARCHAR(500) NOT NULL,
  `status` ENUM('active', 'updating', 'disabled') NOT NULL DEFAULT 'active',
  `updating_message` TEXT NULL,
  `inject_strategy` ENUM('cookies', 'storage_reload', 'idb', 'dnr_headers', 'custom') NOT NULL DEFAULT 'cookies',
  `inject_custom_id` VARCHAR(64) NULL,
  `cookie_formats` JSON NULL COMMENT '["cookies","localStorage","sessionStorage","indexedDB"]',
  `cookie_payload` LONGTEXT NULL COMMENT 'used when pool_id IS NULL',
  `cookie_password` VARCHAR(255) NULL,
  `pool_id` INT UNSIGNED NULL,
  `proxy_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `proxy_profile_id` INT UNSIGNED NULL,
  `user_agent_profile_id` INT UNSIGNED NULL,
  `custom_user_agent` VARCHAR(512) NULL,
  `security_tier` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '0 off, 1 warn, 2 block URLs, 3 hard',
  `config_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tool_reseller_key` (`reseller_id`, `tool_key`),
  KEY `idx_tools_reseller` (`reseller_id`),
  KEY `idx_tools_pool` (`pool_id`),
  CONSTRAINT `fk_tools_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tools_pool` FOREIGN KEY (`pool_id`) REFERENCES `cookie_sync_pools` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tools_proxy` FOREIGN KEY (`proxy_profile_id`) REFERENCES `proxy_profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tools_ua` FOREIGN KEY (`user_agent_profile_id`) REFERENCES `user_agent_profiles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cookie_sync_members` (
  `pool_id` INT UNSIGNED NOT NULL,
  `tool_id` INT UNSIGNED NOT NULL,
  `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pool_id`, `tool_id`),
  UNIQUE KEY `uq_member_tool` (`tool_id`),
  CONSTRAINT `fk_csm_pool` FOREIGN KEY (`pool_id`) REFERENCES `cookie_sync_pools` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_csm_tool` FOREIGN KEY (`tool_id`) REFERENCES `tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- deferred FK for pool.updated_by_tool_id (tools created after pools)
ALTER TABLE `cookie_sync_pools`
  ADD CONSTRAINT `fk_pool_updated_tool` FOREIGN KEY (`updated_by_tool_id`) REFERENCES `tools` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_pool_updated_admin` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Rules (personal per reseller)
-- ---------------------------------------------------------------------------

CREATE TABLE `rule_groups` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `url_pattern` VARCHAR(500) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rg_reseller` (`reseller_id`),
  CONSTRAINT `fk_rg_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `css_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NOT NULL,
  `selector` VARCHAR(500) NOT NULL,
  `action` ENUM('hide', 'replace', 'custom') NOT NULL DEFAULT 'hide',
  `value` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_css_reseller` (`reseller_id`),
  CONSTRAINT `fk_css_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_css_group` FOREIGN KEY (`group_id`) REFERENCES `rule_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `redirect_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NULL,
  `source_url` VARCHAR(500) NOT NULL,
  `destination_url` VARCHAR(500) NOT NULL,
  `description` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_redir_reseller` (`reseller_id`),
  CONSTRAINT `fk_redir_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_redir_group` FOREIGN KEY (`group_id`) REFERENCES `rule_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `block_url_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NULL,
  `url_pattern` VARCHAR(500) NOT NULL,
  `action` ENUM('blank', 'redirect') NOT NULL DEFAULT 'blank',
  `redirect_url` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_block_reseller` (`reseller_id`),
  CONSTRAINT `fk_block_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_block_group` FOREIGN KEY (`group_id`) REFERENCES `rule_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `overlay_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NULL,
  `trigger_text` VARCHAR(500) NOT NULL,
  `html_content` MEDIUMTEXT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_overlay_reseller` (`reseller_id`),
  CONSTRAINT `fk_overlay_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_overlay_group` FOREIGN KEY (`group_id`) REFERENCES `rule_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `text_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NULL,
  `find_text` VARCHAR(500) NOT NULL,
  `replace_text` VARCHAR(500) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_text_reseller` (`reseller_id`),
  CONSTRAINT `fk_text_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_text_group` FOREIGN KEY (`group_id`) REFERENCES `rule_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Extension registry & allowlist
-- ---------------------------------------------------------------------------

CREATE TABLE `extension_registrations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `client_slug` VARCHAR(64) NOT NULL,
  `extension_id` VARCHAR(128) NOT NULL,
  `file_hashes` JSON NOT NULL COMMENT 'path -> sha256',
  `secret` VARCHAR(255) NOT NULL,
  `integrity_mode` ENUM('off', 'warn', 'block') NOT NULL DEFAULT 'warn',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ext_reseller` (`reseller_id`),
  UNIQUE KEY `uq_ext_slug` (`client_slug`),
  CONSTRAINT `fk_ext_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `extension_allow_policies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `mode` ENUM('off', 'whitelist') NOT NULL DEFAULT 'whitelist',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_eap_reseller` (`reseller_id`),
  CONSTRAINT `fk_eap_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `extension_allow_entries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `policy_id` INT UNSIGNED NOT NULL,
  `extension_id` VARCHAR(128) NOT NULL,
  `note` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_allow_entry` (`policy_id`, `extension_id`),
  CONSTRAINT `fk_allow_policy` FOREIGN KEY (`policy_id`) REFERENCES `extension_allow_policies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Launch tokens & events
-- ---------------------------------------------------------------------------

CREATE TABLE `session_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` CHAR(64) NOT NULL,
  `reseller_id` INT UNSIGNED NOT NULL,
  `tool_id` INT UNSIGNED NOT NULL,
  `source` ENUM('amember', 'admin_access', 'other') NOT NULL DEFAULT 'amember',
  `payload` JSON NULL COMMENT 'slim meta only — no full cookie',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_token_expiry` (`expires_at`),
  KEY `idx_token_reseller_tool` (`reseller_id`, `tool_id`),
  CONSTRAINT `fk_token_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_token_tool` FOREIGN KEY (`tool_id`) REFERENCES `tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `launch_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NOT NULL,
  `tool_id` INT UNSIGNED NOT NULL,
  `success` TINYINT(1) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `inject_strategy` VARCHAR(64) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `extension_id` VARCHAR(128) NULL,
  `username` VARCHAR(255) NULL,
  `client_ip` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_launch_reseller_created` (`reseller_id`, `created_at`),
  KEY `idx_launch_tool_created` (`tool_id`, `created_at`),
  CONSTRAINT `fk_launch_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_launch_tool` FOREIGN KEY (`tool_id`) REFERENCES `tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `access_logs` (
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

CREATE TABLE `extension_scans` (
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

CREATE TABLE `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_admin_id` INT UNSIGNED NULL,
  `reseller_id` INT UNSIGNED NULL,
  `action` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(64) NULL,
  `entity_id` VARCHAR(64) NULL,
  `meta` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_action` (`action`),
  CONSTRAINT `fk_audit_admin` FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_audit_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Security incidents (DevTools / inspect lockouts)
-- ---------------------------------------------------------------------------

CREATE TABLE `security_incidents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reseller_id` INT UNSIGNED NULL,
  `client_slug` VARCHAR(64) NOT NULL,
  `detection_type` VARCHAR(64) NOT NULL,
  `page_url` VARCHAR(1024) NULL,
  `website_url` VARCHAR(1024) NULL,
  `tool_id` INT UNSIGNED NULL,
  `tool_name` VARCHAR(255) NULL,
  `username` VARCHAR(255) NOT NULL DEFAULT 'not available',
  `client_ip` VARCHAR(64) NULL COMMENT 'Member IP from launch / access',
  `request_ip` VARCHAR(64) NULL COMMENT 'API-seen IP of reporter',
  `extension_id` VARCHAR(128) NULL,
  `username_source` ENUM('launch', 'stored', 'ip_lookup', 'missing') NOT NULL DEFAULT 'missing',
  `meta` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sec_inc_created` (`created_at`),
  KEY `idx_sec_inc_reseller` (`reseller_id`, `created_at`),
  KEY `idx_sec_inc_username` (`username`),
  KEY `idx_sec_inc_ip` (`client_ip`),
  KEY `idx_sec_inc_type` (`detection_type`),
  CONSTRAINT `fk_sec_inc_reseller` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sec_inc_tool` FOREIGN KEY (`tool_id`) REFERENCES `tools` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ip_lookups` (
  `ip` VARCHAR(64) NOT NULL,
  `country` VARCHAR(128) NULL,
  `region` VARCHAR(128) NULL,
  `city` VARCHAR(128) NULL,
  `isp` VARCHAR(255) NULL,
  `org` VARCHAR(255) NULL,
  `as_name` VARCHAR(255) NULL,
  `is_proxy` TINYINT(1) NOT NULL DEFAULT 0,
  `is_hosting` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'VPS / datacenter',
  `is_mobile` TINYINT(1) NOT NULL DEFAULT 0,
  `proxy_type` VARCHAR(64) NULL COMMENT 'residential|datacenter|proxy_vpn|mobile|private',
  `network_hint` VARCHAR(255) NULL,
  `raw` JSON NULL,
  `looked_up_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: master user password set by seed script (placeholder hash = "changeme")
-- Default bcrypt for "admin123" — replace on first boot via seed.
-- ---------------------------------------------------------------------------
