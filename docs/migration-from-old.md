# Migration notes — `old/` → v2

v1 does **not** require a full dump import to go live. Prefer clean resellers + tools, then optionally pull a subset.

## What exists today

| Script | Purpose |
|--------|---------|
| `npm run db:seed` | Master admin only |
| `npm run db:seed:old` | Maps a **subset** of `old/extensionsystem.sql` into v2 |

`seed:old` imports (approx):

- Tenants → `resellers`
- Tools (metadata, **not** full cookie blobs)
- Rule groups / redirects / blocks / some CSS
- Proxy / UA samples
- Extension registrations
- Sample launch events

It **skips** huge `access_logs` and does not copy live encrypted cookies from old vault format unless you paste them manually in Admin.

## Recommended cutover

1. Deploy v2 empty (Phase 6 playbook).
2. Create resellers that match production names/slugs.
3. Either:
   - **Fresh:** recreate tools + paste current cookies in Admin, or
   - **Assist:** run `db:seed:old` against a copy of `old/extensionsystem.sql`, then re-save cookies tool-by-tool.
4. Build friend extensions per reseller (`build:extension:prod --client <slug>`).
5. Point aMember / access buttons at `POST /api/session/initiate` with `{ reseller_slug, tool_key, member_secret }` (`member_secret` = reseller row secret from create/seed).
6. Keep `old` running in parallel until Access + pools + rules are verified.

## Do not

- Point production at the old DigitaVision-style automation stack for v1.
- Expect one-way “Use from account” semantics — v2 uses **bi-directional pools**.
- Live-link CSS between resellers — use **Copy rules** only.

## Full cookie migration (later)

If you need bulk cookie import:

1. Export plaintext JSON from old admin (or decrypt with old key offline).
2. `PATCH /api/tools/:id` with `cookie_plain` (AES CryptoJS-compatible on save).
3. For shared products, create a cookie pool and link tools after one seed save.

## Schema reference

Canonical DDL: [`schema-v1.sql`](./schema-v1.sql).  
Old dump path (local): `../old/extensionsystem.sql`.
