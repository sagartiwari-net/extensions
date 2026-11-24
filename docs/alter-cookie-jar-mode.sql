-- Run once on production MySQL (panel DB)
ALTER TABLE `tools`
  ADD COLUMN `cookie_jar_mode` ENUM('auto', 'browser', 'extension_only') NOT NULL DEFAULT 'auto'
    COMMENT 'browser=save cookies in browser jar (clear on disable); extension_only=DNR only; auto=detect'
    AFTER `inject_strategy`;
