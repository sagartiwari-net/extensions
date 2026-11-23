# Phase 6 — Deploy playbook

Local checklist (PLAN §13) must be green before any public server. This guide deploys **API + Admin + MySQL + Redis** with Docker Compose, then builds **per-reseller friend extensions**.

## Architecture

```
Internet
  ├─ https://admin.example.com  → nginx → admin:3000
  └─ https://api.example.com    → nginx → api:4000
                                        ├─ mysql:3306
                                        └─ redis:6379
Extension (friend zip) ──HTTPS──► api.example.com/api
```

## 1. Server prerequisites

- Docker + Docker Compose plugin
- Domain DNS A records for admin + API
- TLS (aaPanel / Caddy / certbot nginx)

Suggested paths (aaPanel style):

| Role | Example |
|------|---------|
| Project | `/www/wwwroot/oneclk-v2` |
| Admin vhost | `admin.1clkaccess.store` → `127.0.0.1:3000` |
| API vhost | `api.1clkaccess.store` → `127.0.0.1:4000` |

## 2. Secrets

```bash
cd /www/wwwroot/oneclk-v2
cp .env.production.example .env
# Edit every CHANGE_ME_* value
# SESSION_SECRET ≥ 32 chars, unique
# MYSQL_PASSWORD / COOKIE_CRYPTO_FALLBACK_KEY unique
```

Required public vars:

```env
ADMIN_ORIGIN=https://admin.1clkaccess.store
CORS_ORIGINS=https://admin.1clkaccess.store
NEXT_PUBLIC_API_BASE=https://api.1clkaccess.store
COOKIE_SECURE=true
TRUST_PROXY=true
NODE_ENV=production
```

## 3. First bring-up

```bash
docker compose -f docker-compose.prod.yml up -d --build

# Wait for MySQL healthy, then migrate schema inside the API container:
docker compose -f docker-compose.prod.yml exec api node dist/scripts/migrate.js
```

Seed master admin once (prefer SSH tunnel to MySQL, or temporary publish of 3306):

```bash
# From monorepo with DATABASE_URL pointing at server:
npm run db:seed   # once — then change admin password immediately
```

**Immediately** change `SEED_MASTER_PASSWORD` login after first seed.

## 4. Nginx (aaPanel reverse proxy)

API:

```
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Admin: same pattern → `127.0.0.1:3000`.

Enable HTTPS. Session cookies require `COOKIE_SECURE=true` + HTTPS.

## 5. Health checks

```bash
curl -s https://api.example.com/health
# open https://admin.example.com — login
```

## 6. Friend extension builds (obfuscated)

On a build machine (Mac/CI), not necessarily the VPS:

```bash
# Edit clients/<slug>.config.js — API_BASE + MEMBER_MATCHES
npm run build:extension:prod -- --client toolsmandi --version 1.0.0

# Output: apps/extension/dist-prod/toolsmandi/
# Zip that folder for the reseller
```

Then in Admin → **Extensions**:

1. Register `client_slug` = config `SLUG`
2. Paste `integrity.json` hashes
3. Set Chrome extension ID after they load unpacked / install CRX
4. Integrity mode `warn` → later `block`

## 7. Updates

```bash
cd /www/wwwroot/oneclk-v2
git pull   # or rsync release
docker compose -f docker-compose.prod.yml up -d --build
```

Rebuild friend zips when extension code changes; re-upload integrity hashes.

## 8. Hardening checklist

- [ ] No default `admin123` / `change-me` secrets in `.env`
- [ ] MySQL **not** published on public `0.0.0.0` (compose.prod keeps it on internal network; only publish API/Admin ports)
- [ ] CORS limited to admin origin(s)
- [ ] HTTPS only; HSTS on API
- [ ] Backups: MySQL volume + Redis AOF
- [ ] Extension prod builds use `--obfuscate` / `build:extension:prod`
- [ ] Automation endpoints absent (v1)

## 9. Rollback

```bash
docker compose -f docker-compose.prod.yml down
# restore mysql volume from backup
docker compose -f docker-compose.prod.yml up -d
```
