# 1Clk Access — New System (v2)

Scratch rebuild. **Local first** — server only after tests pass. Phase 6 adds production Docker + obfuscated friend extensions.

| Path | Role |
|------|------|
| `PLAN.md` | Master plan |
| `docs/schema-v1.sql` | MySQL schema |
| `docs/deploy.md` | **Phase 6** server playbook |
| `docs/migration-from-old.md` | Optional import from `old/` |
| `apps/api` | Fastify API (`:4000`) |
| `apps/admin` | Next.js admin (`:3000`) |
| `apps/extension` | Chrome MV3 (`dist/` load unpacked) |
| `packages/shared` | Zod schemas / constants |
| `packages/crypto` | AES CryptoJS helpers |

## Prerequisites

- Node ≥ 20  
- Docker (MySQL + Redis; Compose for prod stack)

## First run (local)

```bash
cd "/Volumes/Samsung 1TB/Extension/new-system"
cp .env.example .env

npm run db:up
npm install
npm run build -w @oneclk/shared
npm run build -w @oneclk/crypto
npm run db:migrate
npm run db:seed

# Terminals:
npm run dev:api
npm run dev:admin
npm run build:extension
```

- Admin: http://127.0.0.1:3000 — `admin` / `admin123`  
- Health: http://127.0.0.1:4000/health  
- Extension: Chrome → Load unpacked → `apps/extension/dist`

### Demo data from old dump (temporary)

```bash
npm run db:seed:old
npm run db:import-cookies   # copy vault cookies from old/extensionsystem.sql
```

**Blocked extensions UI:** Admin → **Extensions** → tabs *Blocked / risky* and *Allowed* (Allow / Revoke).  
See [docs/migration-from-old.md](docs/migration-from-old.md).

## Production (Phase 6)

```bash
cp .env.production.example .env   # fill CHANGE_ME_* secrets
npm run prod:up                  # docker compose.prod — mysql/redis/api/admin
# migrate + seed per docs/deploy.md
```

Friend / reseller extension (minified + obfuscated):

```bash
# Edit apps/extension/clients/<slug>.config.js first
npm run build:extension:prod -- --client toolsmandi --version 1.0.0
# → apps/extension/dist-prod/toolsmandi/  (hashes stored on server at generate, not in ZIP)
```

Full playbook: [docs/deploy.md](docs/deploy.md).

## Admin UI stack

**Live reference:** https://panel.upays.in/  
Stack: Next.js + Tailwind 4 + shadcn + DataTable. Light theme. See `docs/ui-stack.md`.

## Status

- [x] Phase 0 scaffold  
- [x] Phase 1 tenancy + tools + launch + Access button  
- [x] Phase 2 cookie sync pools (bi-directional)  
- [x] Phase 3 rules + one-shot clone (+ extension CSS/DNR on launch)  
- [x] Phase 4 extension integrity + soft allowlist  
- [x] Phase 5 proxy / UA + launch reports + tools pagination  
- [x] Phase 6 harden + deploy (compose.prod, Dockerfiles, obfuscated extension builds, playbooks)  
- Automation: Phase 7+ when asked — see `PLAN.md`
