-- Run ONCE on production (aaPanel MySQL). Do NOT use literal "…" — use real user/db from .env.
--
-- From panel folder:
--   set -a && source .env && set +a
--   # If DATABASE_URL=mysql://USER:PASS@127.0.0.1:3306/DBNAME then:
--   mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < docs/alter-cookie-jar-mode.sql
--
-- Or one-liner with DATABASE_URL parsed manually, e.g.:
--   mysql -uExtensionSystem -p'YOUR_PASSWORD' extensionsystem < docs/alter-cookie-jar-mode.sql

ALTER TABLE `tools`
  ADD COLUMN `cookie_jar_mode` ENUM('auto', 'browser', 'extension_only') NOT NULL DEFAULT 'auto'
    COMMENT 'browser=save cookies in browser jar (clear on disable); extension_only=DNR only; auto=detect'
    AFTER `inject_strategy`;
