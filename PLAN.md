# 1Clk Access v2 — Master Plan

**Folder:** `Extension/new-system/`  
**References:** `../REVERSE.md`, `../old/`, Desktop `oneclickgo/NewGoCloudSetup/panel/update-panel`  
**Order:** Design → Local build/test → Server deploy (not before)

---

## 1. Problem we are solving

| Current (`old`) pain | v2 answer |
|----------------------|-----------|
| Slow extension / false security / tools don’t login | Simple inject strategies + soft security tiers (`REVERSE.md` §7–11) |
| Slow admin / late data | Slim APIs, pagination, Redis cache |
| Shared tool cookies only one-way (update-panel style) | **Bi-directional cookie sync pools** |
| Reseller bleed risk | Hard tenant isolation on every API + launch button |
| Want personal CSS/rules but also reuse setups | **Clone (copy once)** ≠ **Link (live sync)** — only cookies get live link |

**Automation:** out of scope for v1. Schema may leave nullable placeholders; no UI/jobs yet.

---

## 2. Product model (Reseller-first)

```
Master Admin
  └── creates Resellers (tenants)
        └── each Reseller has:
              - own Extension registration (id + integrity hashes)
              - own Tools (name, URL, cookie, strategy, proxy, UA, security)
              - own Rules (CSS, redirect, block URL, overlays, text replace)
              - own Extension-allow policy
              - optional Cookie Sync Pools (link tools across resellers for SAME logical product)
```

### 2.1 Isolation (must never break)

- Every tool row has `reseller_id` (NOT NULL).
- Launch token is bound to `reseller_id` + `tool_id` + extension identity.
- aMember / access button embeds **reseller slug + tool public key** (or opaque `access_code`) — not a global tool name alone.
- API middleware: reseller JWT/session can only read/write own rows (master can do all).
- Extension only receives tools for **its** registered `client_slug` / `reseller_id`.

### 2.2 Access button (from update-panel idea)

Admin tool detail page has **Open / Access** that:

1. Creates a short-lived launch token (server-side).
2. Opens tool URL with token handshake the extension understands.
3. Lets admin verify login without going through aMember.

Same token machinery members use — one path, fewer bugs.

---

## 3. Cookie sharing — bi-directional pools (replaces one-way “Use from account”)

### 3.1 What update-panel does today (reference)

UI: “Use from account” → follower copies source cookie; **later saves on source replace follower**.  
Follower saving does **not** update source. Source that is already used by others cannot become a follower.

**Your requirement:** if 2, 3, or N tools/accounts are linked, **any** of them updating cookie → **all** linked members get that cookie. Unlinked stay alone.

### 3.2 Design: Cookie Sync Pool (mesh / shared blob)

```
cookie_sync_pools
  id, name, created_by_reseller_id, created_at

cookie_sync_members
  pool_id, tool_id (unique tool → at most one pool)
  joined_at

tools.cookie_data  →  still the working copy for launch
  OR tools point at pool canonical blob (preferred)
```

**Preferred model (canonical blob):**

- Pool holds the **single** encrypted `cookie_payload` + `password` + `updated_at` + `updated_by_tool_id`.
- Member tools store only `pool_id` (nullable). If `pool_id` set, launch reads pool payload.
- On save from **any** member tool (or admin paste on any member):
  1. Write pool payload once.
  2. Bump `pool.updated_at`.
  3. Optionally mirror denormalized `tools.cookie_data` for all members (for offline admin list) OR leave tools pointing only at pool (cleaner).

**UI (admin tool editor):**

```
Cookie sync
  [ Not linked ]
  [ Link to pool… ]  → pick existing pool OR “Create pool & link selected tools”
  Linked: Pool “Ahrefs shared” · 3 tools (ResellerA / ResellerB / …)
  [ Leave pool ]     → keep last cookie copy on this tool only; stop receiving updates
```

Unlike update-panel:

- No “source vs follower” roles.
- Any member save = pool update = all members.
- Leaving pool = snapshot last cookie onto tool, unlink.

**Who can link?**

- Master: any tools across resellers.
- Reseller: only own tools into pools they created **or** pools master invited them into (v1: master-managed cross-reseller links is enough; reseller self-link within own tools OK).

**Safety:**

- Confirm dialog: “Updating this cookie updates N linked tools.”
- Audit log: who wrote the pool, when, from which tool.
- Cannot link tools with incompatible `inject_strategy` without warning (optional soft check).

---

## 4. Personal rules vs copy (CSS / redirect / block / extension-allow)

You do **not** want live share for rules (one change would hit everyone). You **do** want less clicking when two resellers need the same starting setup.

### 4.1 Two verbs only

| Action | Behavior |
|--------|----------|
| **Clone / Copy from…** | One-shot: copy CSS, redirects, blocks, overlays, text rules, allowlist into target reseller/tool **as independent rows**. Later edits do not sync. |
| **Link (live)** | **Only for cookies** via Cookie Sync Pool. Not for CSS/rules. |

### 4.2 What can be cloned

- Rule packs scoped by URL pattern / tool  
- Extension allow/block lists  
- Optional: proxy/UA profile **templates** (profiles are shared library; assignment stays personal)

### 4.3 UX

On reseller or tool settings:

- “Copy rules from reseller…” → multi-select rule types → preview count → Confirm.  
- Never label this “Share” — say **Copy** so operators don’t expect live sync.

---

## 5. Tools & inject (from REVERSE.md)

Each tool fields (v1):

| Field | Notes |
|-------|--------|
| `reseller_id` | Isolation |
| `name`, `web_url`, `status` | active / updating / disabled |
| `cookie_payload` or `pool_id` | Encrypted AES (keep CryptoJS-compatible if old captures reused) |
| `inject_strategy` | `cookies` \| `storage_reload` \| `idb` \| `dnr_headers` \| `custom:<id>` |
| `cookie_type` / formats | cookies, LS, SS, IDB |
| `proxy_enabled` + proxy profile | optional |
| `custom_user_agent` / UA profile | optional |
| `security_tier` | 0 off · 1 warn · 2 block billing URLs · 3 hard (opt-in) |
| `block_urls`, `redirects` attach | via rule groups owned by reseller |
| **No** automation fields active | ignore GoAuto for v1 |

Extension launch path (simple default):

1. Clear relevant storage for apex  
2. Set cookies (strip CF binding cookies)  
3. Write LS/SS/IDB if present  
4. Apply DNR header rules if strategy needs  
5. Navigate / one reload  
6. Verify expected cookie/LS key → report success/fail  

Custom strategies (Designrr / Boolv-style) as plugins later — structure ready from day one.

---

## 6. Extension security

### 6.1 Registration & integrity

```
registered_extensions
  reseller_id
  extension_id          -- Chrome ID
  client_slug
  file_hashes JSON      -- path → sha256 of shipped files
  secret                -- for vault / HMAC
  is_active
  updated_at
```

- On install/update: extension reports hashes → server compares.
- Mismatch → soft fail or hard fail (reseller setting).
- **Admin UI: “Update integrity hashes”** — paste new build hashes or upload zip; when reseller changes extension ID after a custom build, master/reseller updates `extension_id` + hashes together.

### 6.2 Extension allowlist

Per reseller policy:

- mode: `whitelist` | `off`  
- `allowed_extension_ids[]`  
- Only disable extensions that have session-steal capabilities (cookies / DNR / proxy / broad hosts) — not every extension (reduces false positives).

### 6.3 Session / browser leak

- Encrypted vault in extension storage (keep AES approach from `old`).  
- No plain cookie blobs in `chrome.storage.local`.  
- Launch token TTL short (e.g. 60s).  
- Cleanup on tab close / kill switch.  
- Content scripts: **member-only** + **launch-tab inject** (not dozen always-on scripts).  
- Soft security default; hard DevTools kill optional per tool.

---

## 7. Backend architecture

### 7.1 Stack (local-first)

| Piece | Choice | Why |
|-------|--------|-----|
| API | Fastify + TypeScript + Zod | Familiar from `old`, fast validation |
| Admin | Next.js (App Router) | update-panel UX patterns; RSC tables |
| DB | MySQL 8 | Keep ops familiar |
| Cache | Redis (optional local Docker) | List/dashboard speed |
| Auth | Session cookie + role (master / reseller) | Simple for admin panel |
| Monorepo | `apps/api`, `apps/admin`, `apps/extension`, `packages/shared`, `packages/crypto` | Clean boundaries |

**Local:** Docker Compose (MySQL + Redis) + `pnpm`/`npm` workspaces.  
**Server:** only after local checklist green.

### 7.2 Roles

- **Master** — all resellers, pools across tenants, global UA/proxy libraries, extension registry override.  
- **Reseller** — own tools, rules, proxies assignment, own extension hashes, access-button test.  
- **No member login in admin** — members hit aMember + extension only.

### 7.3 Core API groups (v1)

1. Auth / me  
2. Resellers (master)  
3. Tools CRUD + Access-token create  
4. Cookie sync pools (create / join / leave / save)  
5. Rule packs + Clone endpoint  
6. Proxy & UA profiles  
7. Extension registry + integrity update  
8. Extension allow policy  
9. Launch: `POST /session/initiate`, `GET /session/data` (extension)  
10. Launch events / basic reports  
11. Config pull for extension (rules slim DTO)

**Not in v1:** automation jobs, GoAuto webhooks, Telegram, etc.

---

## 8. Database sketch (v1)

High level (full DDL later in `docs/schema-v1.sql`):

- `admin_users` (role, reseller_id nullable for master)  
- `resellers` (slug, name, amember hints, settings JSON)  
- `tools` (reseller_id, …, pool_id NULL, inject_strategy, proxy/UA FKs, security_tier)  
- `cookie_sync_pools` + `cookie_sync_members`  
- `proxy_profiles`, `user_agent_profiles` (owner_reseller_id NULL = global library)  
- `rule_groups`, `css_rules`, `redirect_rules`, `block_url_rules`, `overlay_rules`, `text_rules` — all `reseller_id`  
- `extension_registrations` (hashes, secret, extension_id)  
- `extension_allow_policies` + `extension_allow_entries`  
- `session_tokens`  
- `launch_events` (tool_id, success, reason, ms, strategy)  
- `audit_logs` (pool writes, clone actions, hash updates)

Indexes: `(reseller_id, id)`, pool member lookups, token TTL cleanup.

---

## 9. Admin UI outline (update-panel inspired)

Fast, sparse pages — no giant cookie strings in tables.

| Page | Notes |
|------|--------|
| Dashboard | Counts from cache; launch success % |
| Resellers | Master only |
| Tools | Slim list; detail drawer/page with Cookie + Sync + Access button |
| Cookie pools | Who’s linked; last update by whom |
| Rules | CSS / Redirect / Block tabs; **Copy from…** |
| Proxies / User-Agents | Library + assign |
| Extensions | ID, hashes, “Update hashes”, allowlist |
| Security | Per-reseller defaults + per-tool tier |
| Reports | Launch events (v1 basic) |
| Settings | Secrets, TTL, feature flags |

Tool detail sections (like your screenshot):

1. Basics (name, URL, status, strategy)  
2. **Cookie** + **Cookie sync** (bi-directional pool UI)  
3. Proxy / UA  
4. Security / blocks  
5. **Access** (test launch)  

---

## 10. Extension outline (v2)

Manifest MV3 — permissions close to need:

- cookies, storage, unlimitedStorage, tabs, scripting, declarativeNetRequest(+Feedback), proxy, webNavigation, webRequestAuthProvider, management  
- **No debugger by default**  
- content_scripts: member site only  
- everything else via `chrome.scripting` on launch tabs  

Modules: `launcher`, `strategies/*`, `vault`, `integrity`, `enforcement`, `rules-apply`, `cleanup`.

Build: esbuild; **prod obfuscation optional** for friend zips (`REVERSE.md`).

---

## 11. aMember / access button isolation

- Each reseller has `slug` + secret.  
- Access HTML/button includes `reseller_slug` + `tool_key` (or server-side product id mapping).  
- `POST /session/initiate` validates member entitlement **and** that tool belongs to that reseller.  
- Wrong reseller tool id → 403 (this is the “button fix” so one reseller cannot open another’s tools).

---

## 12. Phased delivery

### Phase 0 — Scaffold (local)

- Monorepo, Docker MySQL/Redis, empty Fastify + Next admin login, empty extension load unpacked.  
- Health checks.

### Phase 1 — Tenancy + Tools + Launch

- Resellers, tools CRUD, encrypted cookie save, initiate/data launch, Access button.  
- Extension: cookie + storage_reload strategies only.  
- Local test checklist.

### Phase 2 — Cookie sync pools (bi-directional)

- Pool CRUD, link/leave, any-member update fan-out.  
- Audit log.  
- UI equivalent of your screenshot but multi-way.

### Phase 3 — Rules + Clone

- CSS, redirect, block; apply in extension on launch tabs.  
- “Copy rules from reseller” one-shot.

### Phase 4 — Extension integrity + allowlist

- Hash register / update UI.  
- Soft enforcement allowlist.  
- Security tiers.

### Phase 5 — Proxy / UA + reports

- Profiles, per-tool attach.  
- `launch_events` dashboard.  
- Perf: Redis on list endpoints.

### Phase 6 — Harden + deploy

- Prod build, obfuscated friend extensions, server deploy playbook.  
- Migration notes from `old` (optional import later — not required for v1).

**Automation:** Phase 7+ when you ask.

---

## 13. Local test checklist (before any server push)

- [ ] Master creates 2 resellers, each with own tool — A cannot launch B’s tool  
- [ ] Access button logs into a cookie-only tool  
- [ ] LS/IDB strategy tool boots logged-in  
- [ ] Link 3 tools in a pool; update from tool #2 → #1 and #3 see new cookie  
- [ ] Leave pool → further updates stop  
- [ ] Copy rules A→B; edit A → B unchanged  
- [ ] Integrity fail blocks or warns as configured  
- [ ] Allowlist does not kill unrelated extensions  
- [ ] Admin tool list stays fast with 500+ tools (pagination)  
- [ ] No automation endpoints reachable  

---

## 14. Decisions locked in this plan

| Topic | Decision |
|-------|----------|
| Cookie share | Bi-directional **pool** (not one-way source/follower) |
| CSS/rules reuse | **Clone only**, never live link |
| Automation | **Excluded** from v1 |
| Debugger | Off by default |
| Tenancy | Hard `reseller_id` on tools + launch |
| Crypto | Keep AES vault approach |
| Deploy | Local complete first |

## 15. Open items (ask only if needed later)

1. Cross-reseller pool: master-only to create, or reseller invite codes? *(Default: master creates cross-reseller pools; reseller can pool within own tools.)*  
2. Keep CryptoJS payload format for importing old cookies? *(Default: yes, compatible decrypt.)*  
3. Admin UI visual: clone update-panel look vs new brand? *(Default: clean modern panel inspired by update-panel structure, not pixel-clone.)*

---

## 16. Immediate next step after you approve

1. Write `docs/schema-v1.sql`  
2. Scaffold monorepo (Phase 0)  
3. Implement Phase 1 locally  

Reply **approve** (or change any §14/§15 default) and we start scaffolding in `new-system/`.