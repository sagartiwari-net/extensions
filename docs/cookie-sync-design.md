`# Cookie sync — bi-directional pools

## Problem with update-panel “Use from account”

```
Source account ──writes──► Follower account(s)
Follower write ──✕──► Source   (does not propagate)
```

Screenshot behavior: “Later saves there replace this cookie until you stop.”  
One direction only.

## v2 requirement

If tools T1, T2, T3 are linked:

- Save on T1 → T2 & T3 update  
- Save on T2 → T1 & T3 update  
- Save on T3 → T1 & T2 update  
- Unlinked T4 unchanged  

## Model

```
┌──────────────── cookie_sync_pools ────────────────┐
│  id, name, cookie_payload (encrypted), password   │
│  updated_at, updated_by_tool_id, updated_by_user  │
└───────────────┬───────────────────────────────────┘
                │ members
     ┌──────────┼──────────┐
     ▼          ▼          ▼
   Tool A     Tool B     Tool C   (each has pool_id)
```

### Operations

| Op | Effect |
|----|--------|
| Create pool | Empty or seed from current tool cookie; add creator tool as member |
| Link tool | Set `tools.pool_id`; optionally overwrite tool cookie from pool |
| Save cookie on member | Update **pool** payload; all members launch from pool |
| Leave pool | Copy pool payload onto tool; set `pool_id = NULL` |
| Delete pool | Members leave with last snapshot; or block if members remain |

### API sketch

- `POST /api/cookie-pools` `{ name, seed_tool_id? }`  
- `POST /api/cookie-pools/:id/members` `{ tool_id }`  
- `DELETE /api/cookie-pools/:id/members/:toolId`  
- `PUT /api/tools/:id/cookie` → if tool has `pool_id`, writes pool (and returns `synced_member_count`)  
- `GET /api/cookie-pools/:id` → members + last update meta (no cookie in list; detail with permission)

### UI copy (avoid “Use from account” wording)

- “Cookie sync pool”  
- “Linked tools (any update syncs all)”  
- “Leave pool — keep current cookie only on this tool”  

### Audit

Every pool write → `audit_logs` with actor, tool_id, pool_id, byte length / hash of payload (not plaintext).