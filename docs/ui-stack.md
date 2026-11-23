# Admin UI stack (locked from panel.upays.in / update-panel)

**Live reference:** https://panel.upays.in/  
**Local source:** `~/Desktop/oneclickgo/NewGoCloudSetup/panel/update-panel`

## Decision

v2 admin must match that panel’s **structure and polish**, not a custom dark/raw CSS scaffold.

| Layer | Tech |
|-------|------|
| Framework | Next.js App Router + React 19 |
| Styling | Tailwind CSS v4 + `tw-animate-css` + `shadcn/tailwind.css` |
| Components | shadcn (base-nova) + `@base-ui/react` |
| Tables | `@tanstack/react-table` via shared `DataTable` |
| Filters | Search + category selects (`ListFilters`) |
| Icons | `lucide-react` |
| Fonts | Geist / Geist Mono |
| Theme | **Light by default** (same tokens as update-panel `:root`) |

## Layout patterns we copy

1. **Grouped sidebar** — Operations / Rules & security / Catalog (icons + active pill).
2. **PageHeader** — title + one-line description + primary action (New …).
3. **ListFilters** — Search + optional category dropdowns.
4. **DataTable card** — bordered table, sort headers, empty state, page size 10/20/50, Previous/Next.
5. **Status badges** — compact pills (`active`, etc.).
6. **Create forms** — collapse behind “New …” (not always-visible walls of inputs).

## Product IA (ours, not a clone of every upays menu)

- Overview, Tools, Cookie pools, Access  
- Rules, Extensions, Launch reports  
- Resellers, Proxy / UA  

Upays automation/telegram menus stay out of v1.

## Status

- [x] Inspected live panel.upays.in (Overview, Mapped Accounts, Proxy Manager)
- [x] Tailwind 4 + shadcn primitives installed in `apps/admin`
- [x] Shell + DataTable + filters on Tools / Resellers / Pools / Overview
- [ ] Bring remaining pages (rules, extensions, profiles, reports, tool detail) onto the same primitives
- [ ] Optional: full shadcn Sidebar + FormOverlay parity
