# Rules: Clone vs Link

## Goal

- Each reseller’s CSS, redirect, block URL, overlays, extension-allow are **personal**.  
- Operators often want Reseller B to start from Reseller A’s setup without retyping.  
- Live share of rules is **unwanted** (one edit would change everyone).

## Rule

| Feature | Live sync? | Copy? |
|---------|------------|-------|
| Cookies (common tools) | **Yes** — cookie sync pools | Also can seed pool |
| CSS / redirect / block / overlay / text | **No** | **Yes** — one-shot clone |
| Extension allowlist | **No** | **Yes** — one-shot clone |
| Proxy / UA profiles | Library can be global; **assignment** personal | Clone assignment optional |

## Clone API

`POST /api/resellers/:targetId/clone-rules`

```json
{
  "from_reseller_id": 3,
  "include": ["css", "redirect", "block", "overlay", "text", "extension_allow"],
  "mode": "merge" | "replace"
}
```

- `merge` — add copies; don’t delete target’s existing rules  
- `replace` — delete target’s selected types then copy (confirm required)

All new rows get **new IDs** and `reseller_id = target`. No FK back to source.

## UI

Button label: **Copy rules from…** (never “Share rules”).  
Preview: “Will create 12 CSS + 4 redirects + 3 blocks.”  
Success: “Copied. Future edits on either side stay separate.”
