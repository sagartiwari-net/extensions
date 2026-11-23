# Gap report — Extension allowlist, Access UI, usage logs (IP / user / tool)

**Date:** 2026-11-20  
**Why:** Local test showed Cookie-Editor still enabled; Access / Test felt “basic”; need panel-style username / product id / original IP logging.  
**Sources:** Your screenshots · `REVERSE.md` · `old/Extension/src/core/enforcement.js` · `old/PLAN.md` §4.8 · update-panel `access/page.tsx` · current `new-system` code.

---

## 1. Short answer — why nothing was disabled

| What you saw | Why |
|--------------|-----|
| “Extension disabled by **Seo Group Buy**” | That text comes from the **Seo Group Buy** extension (another product on the machine), **not** from `1Clk Dev`. |
| Cookie-Editor still ON | Our v2 allowlist only runs when API policy `allow_mode === 'whitelist'`. For client slug `dev` that policy is still **`off`** (default). |
| “Koi extension detect nahi hua” | v2 does **not** show a live inventory UI yet, and does **not** listen to `management.onInstalled` / `onEnabled` (old system did). |

So this is **not** “Chrome broke security” — **whitelist is off + enforcement is incomplete vs old**.

---

## 2. What REVERSE.md / old already said (no new REA needed for this gap)

Already documented / implemented in **old**:

| Feature | Where |
|---------|--------|
| Disable cookie/DNR/proxy/debugger-capable extensions unless whitelisted | `REVERSE.md` § security · `old/.../enforcement.js` · `old/PLAN.md` §4.8 |
| Triggers: startup, `onInstalled`, `onEnabled`, alarm scan | `old/PLAN.md` §4.8 |
| Soft vs hard security tiers | `REVERSE.md` redesign brief |

Already in **panel.upays.in / update-panel**:

| Feature | Where |
|---------|--------|
| Access form: Tool + Username + Product id + Open | `update-panel/src/app/(panel)/access/page.tsx` |
| Browser **public IP** via icanhazip / ifconfig.me / ipify, sent as `client_ip` | same file `browserPublicIP()` |
| Rejects log with IP | Access rejects page (`client_ip` column) |

**REA re-scan of DigitaVision is not required** to explain this gap — DigitaVision only shows `management` *inventory* literals; your **old** codebase already has the full allowlist design. Re-REA would burn time without changing the action list below.

---

## 3. Current v2 behavior (code truth)

### 3.1 Extension allowlist

**API:** `GET /api/extensions/policy?client_slug=dev`  
→ if no whitelist policy row: `{ allow_mode: 'off', allowed: [] }`

**Extension** (`apps/extension/src/background.js`):

```text
refreshPolicy() on install/startup only
  if allow_mode === 'whitelist' → softEnforceAllowlist(allowed)
```

Gaps vs old:

1. Default **`off`** — nothing disables until admin sets whitelist for that reseller.
2. No `chrome.management.onInstalled` / `onEnabled` → new install / re-enable not blocked in realtime.
3. No periodic alarm scan.
4. No admin “live inventory” (installed list + disabled-by-us).
5. Chrome’s “disabled by X” string is only shown when **X** called `setEnabled(false)` — Seo Group Buy did that for JS/SellerAmp/ToolzBuy; our extension never did for Cookie-Editor.

### 3.2 Access / Test UI

v2 hub today: pick tool → Test Access (admin session).  
Panel: Tool + **Username** + **Product id** + Open + public IP check (aMember stand-in).

### 3.3 Usage / IP logging

| Data | Panel / old | v2 now |
|------|-------------|--------|
| Member username | Yes (Access + logs) | No on Access test |
| Product / tool id | Yes | Tool id only in launch token |
| Client / original IP | Yes (`client_ip` from browser public IP APIs) | **Not stored** on access/launch |
| Launch success | Yes | `launch_events` (tool, strategy, ms) — no user, no IP |

`launch_events` schema today: reseller, tool, success, reason, strategy, duration, extension_id — **no username, no product_id, no client_ip**.

---

## 4. Target design (what we should build)

### 4.1 Extension enforcement (parity with old + Seo Group Buy UX)

**Policy (per reseller)**

- `mode`: `off` \| `whitelist` (default for production friend builds: **`whitelist`**)
- `allowed_ids[]` — admin-approved extension IDs (plus our own id always)
- optional `blocked_ids[]` — always disable even if somehow allowed

**Risky / session-steal detection** (copy old `SESSION_STEAL_PERMS`):

- `cookies`, `webRequest*`, `declarativeNetRequest*`, `browsingData`, `debugger`, `proxy`
- or host permission `<all_urls>` / broad `*://*/*`

**Triggers**

| Event | Action |
|-------|--------|
| Install / startup | Full scan + enforce |
| `management.onInstalled` | Immediate enforce |
| `management.onEnabled` | Immediate enforce |
| Alarm ~1–15 min | Safety net |
| Admin saves allowlist | Bump config version → extension re-fetches policy |

**Admin UX (Security / Extensions)**

- Toggle: Allowlist **On** for reseller
- Table of allowed IDs (+ paste from Chrome ID)
- “Scan this browser” report (extension posts installed list → show cookies-capable + enabled)
- Clear copy: Cookie-Editor must be disabled when whitelist ON unless ID is allowed

**Note:** “Disabled by 1Clk Dev” only appears after *our* extension successfully calls `setEnabled(false)`. Seo Group Buy should be turned **off** while testing ours, or both will fight.

### 4.2 Access test UI (panel shape)

Mirror update-panel Access card:

```
Tool          [ searchable select — name — domain/url ]
Username      [ aMember-style member login ]
Product id    [ product / mapping id ]
[ Open ]
```

Flow:

1. Browser resolves **public IP** (same multi-endpoint pattern as panel).
2. `POST /api/session/initiate` (or admin Access) with  
   `{ reseller_slug, tool_key, username, product_id, client_ip }`.
3. Server validates tool ownership (+ later aMember entitlement).
4. Persist **access_attempt / access_log** row.
5. Return launch URL / token → open bridge.

Admin Access remains a **stand-in** for the aMember button — same fields members hit.

### 4.3 Database — detailed usage

Add (or extend) logging, e.g. `access_logs`:

| Column | Purpose |
|--------|---------|
| `username` | Member username typed / from aMember |
| `product_id` | Product / mapping id |
| `reseller_id`, `tool_id` | Isolation |
| `client_ip` | Public IP from browser (panel style) |
| `request_ip` | Optional: edge / `X-Forwarded-For` from API |
| `user_agent` | Browser UA |
| `extension_id` | Chrome id if known |
| `success`, `deny_reason` | Allowed / rejected |
| `created_at` | When |

Also enrich `launch_events` with `username`, `client_ip` when present.

**Reports UI:** filters by username, tool, IP, date — like panel Analytics / Access rejects.

### 4.4 Why “original IP” is browser public IP (panel method)

Proxy/VPN on the tool path ≠ what panel stores.  
Panel deliberately asks the **browser** for its public IPv4 (icanhazip / ifconfig.me / ipify) and stores that as `client_ip`.  
Server `X-Forwarded-For` alone can be the VPS or CDN. **Do both:** store `client_ip` (browser) + `request_ip` (API view).

---

## 5. Implementation order (recommended)

| Priority | Work | Outcome |
|----------|------|---------|
| **P0** | Default friend/reseller policy to whitelist; admin one-click “Enable allowlist”; wire `onInstalled` / `onEnabled` + alarm | Cookie-Editor disables when whitelist ON |
| **P0** | Security page: show policy state + “last enforce result” | You can *see* detection |
| **P1** | Access UI = Tool + Username + Product id + Open + public IP | Matches your SS / panel |
| **P1** | `access_logs` table + write on Access / initiate | DB has user + tool + IP |
| **P2** | Reports: Access log table (search username / IP / tool) | Ops visibility |
| **P2** | Extension inventory report to admin | Detect without guessing |
| **P3** | aMember HMAC verify on product_id | Real member gate |

---

## 6. How to test allowlist **today** (before P0 code)

1. Turn **off** Seo Group Buy while testing 1Clk Dev (avoid two enforcers).
2. Admin → **Extensions** → Edit allowlist for the reseller linked to slug `dev`.
3. Set mode **`whitelist`**, leave allowed list empty (or only add IDs you want).
4. Save → reload `1Clk Dev` (or reopen Chrome) so `refreshPolicy` runs.
5. Cookie-Editor should disable if it has `cookies` permission.

If still on: check service worker console for `[1clk-v2] soft-disabled` / policy fetch errors (API must be reachable at `http://127.0.0.1:4000`).

---

## 7. Out of scope reminder (v1)

- Automation / GoAuto logout loops (Phase 7+)
- DevTools kill (keep soft; avoid false security noise — REVERSE.md)
- Pixel-clone DigitaVision obfuscation for enforcement (use **old** enforcement as source of truth)

---

## 8. Implemented (2026-11-20)

| Item | Status |
|------|--------|
| P0 `apps/extension/src/lib/enforcement.js` + `onInstalled` / `onEnabled` / 1‑min alarm | Done |
| P0 DB allowlist mode set to **whitelist** for all resellers | Done |
| P0 `POST /api/extensions/scan` inventory | Done |
| P1 Access UI: Tool + Username + Product id + Open + public IP | Done |
| P1 `access_logs` + write on Access | Done |
| P2 Reports → Access logs tab (user / tool / original IP) | Done |

### How to verify now

1. Chrome → remove/reload unpacked `apps/extension/dist` (must rebuild already done).
2. Temporarily disable **Seo Group Buy** so it doesn’t fight our enforcer.
3. Confirm Admin → Extensions allowlist = **whitelist**.
4. Cookie-Editor should show **disabled by 1Clk Dev** within ~0–2s (or after reload).
5. Access → fill username + product id → Open → Reports → Access logs shows original IP.
