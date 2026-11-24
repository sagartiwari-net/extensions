# Deploy — panel.1clkaccess.store

| Item | Value |
|------|--------|
| Panel URL | `https://panel.1clkaccess.store` |
| Server path | `/www/wwwroot/1clkaccess.store/panel` |
| Git | `https://github.com/sagartiwari-net/extensions` |
| MySQL DB | `extensionsystem` (aaPanel) |

Also create (recommended) API vhost:

| Item | Value |
|------|--------|
| API URL | `https://panel.1clkaccess.store` (same host `/api` + `/health`; `api.` subdomain not required) |
| Proxy | `http://127.0.0.1:4000` |

Panel nginx → `http://127.0.0.1:3000`.

## 0. Mac — push (already done once)

```bash
cd new-system
# .env is gitignored — never push secrets
git push -u origin main
```

## 1. Server — first clone

```bash
cd /www/wwwroot/1clkaccess.store/panel
# aaPanel default files wipe (careful):
find . -mindepth 1 -delete
git clone https://github.com/sagartiwari-net/extensions.git .
```

## 2. Node + env

```bash
# Node 20+
node -v
npm ci
cp .env.production.example .env
nano .env   # fill SESSION_SECRET, DATABASE_URL, passwords, API URLs
```

`DATABASE_URL` example (aaPanel MySQL on localhost):

```env
DATABASE_URL=mysql://ExtensionSystem:YOUR_PASSWORD@127.0.0.1:3306/extensionsystem
ADMIN_ORIGIN=https://panel.1clkaccess.store
CORS_ORIGINS=https://panel.1clkaccess.store
NEXT_PUBLIC_API_BASE=https://panel.1clkaccess.store
EXTENSION_API_BASE=https://panel.1clkaccess.store/api
# Do NOT use api.1clkaccess.store unless that DNS A-record exists (currently NXDOMAIN)
COOKIE_SECURE=true
COOKIE_SAMESITE=none
TRUST_PROXY=true
```

## 3. Schema + data

**Empty DB (fresh):**

```bash
npm run build -w @oneclk/shared
npm run build -w @oneclk/crypto
npm run build -w @oneclk/api
npm run db:migrate
npm run db:seed   # once — change admin password after login
```

**Or import dump from Mac** (see Mac dump section below), then skip seed if dump already has admins.

## 4. Build admin + run (PM2)

```bash
npm run build -w @oneclk/admin

# Redis must be running (aaPanel redis or: docker run -d --name redis -p 6379:6379 redis:7-alpine)

pm2 delete oneclk-api oneclk-admin 2>/dev/null || true
pm2 start apps/api/dist/index.js --name oneclk-api
pm2 start npm --name oneclk-admin -- -w @oneclk/admin start
# Or: cd apps/admin && pm2 start npm --name oneclk-admin -- start
pm2 save
```

Admin listens **3000**, API **4000**.

## 5. aaPanel nginx

**panel.1clkaccess.store** → reverse proxy `127.0.0.1:3000`  
**api.1clkaccess.store** → reverse proxy `127.0.0.1:4000`  

Both need HTTPS + headers:

```
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 6. Health

```bash
curl -s https://api.1clkaccess.store/health
# open https://panel.1clkaccess.store — login
```

## 7. Updates

```bash
cd /www/wwwroot/1clkaccess.store/panel
git pull origin main
npm ci
npm run build -w @oneclk/shared && npm run build -w @oneclk/crypto && npm run build -w @oneclk/api && npm run build -w @oneclk/admin
pm2 restart oneclk-api oneclk-admin
```

## Mac — dump local DB for import

```bash
# Local docker MySQL (port 3307)
mysqldump -h127.0.0.1 -P3307 -uoneclk -poneclk_pass oneclk_v2 \
  --single-transaction --routines --triggers \
  | gzip > /tmp/extensionsystem-local.sql.gz

# Upload to server, then:
# gunzip < extensionsystem-local.sql.gz | mysql -uExtensionSystem -p extensionsystem
```

**Note:** After import, update reseller `member_secret` / admin passwords if needed. Extension `EXTENSION_API_BASE` must be production URL — regenerate friend ZIPs after go-live.
