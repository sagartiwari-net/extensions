'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PlusIcon, RefreshCwIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { FormOverlay } from '@/components/form-overlay';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Reseller = { id: number; slug: string; name: string };

type ExtRow = {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  client_slug: string;
  extension_id: string;
  integrity_mode: string;
  is_active: number;
  allow_mode: string | null;
  updated_at: string;
};

type ScanExt = {
  id: string;
  name?: string;
  install_type?: string;
  enabled?: boolean;
  uses_cookies?: boolean;
};

type ScanRow = {
  id: number;
  reseller_id: number | null;
  client_slug: string;
  reporter_id: string;
  extensions_json: ScanExt[];
  risky_count: number;
  enabled_risky_count: number;
  created_at: string;
};

export default function ExtensionsPage() {
  const { user, loading } = useMe();
  const [items, setItems] = useState<ExtRow[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [allowedIds, setAllowedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAllow, setShowAllow] = useState(false);
  const [tab, setTab] = useState('blocked');

  const [resellerId, setResellerId] = useState('');
  const [clientSlug, setClientSlug] = useState('dev');
  const [extensionId, setExtensionId] = useState('');
  const [integrityMode, setIntegrityMode] = useState<'off' | 'warn' | 'block'>('warn');
  const [hashesText, setHashesText] = useState('{}');

  const [allowMode, setAllowMode] = useState<'off' | 'whitelist'>('whitelist');
  const [allowText, setAllowText] = useState('');

  const inventoryResellerId = useMemo(() => {
    if (resellerId) return Number(resellerId);
    const fromScan = scans[0]?.reseller_id;
    if (fromScan) return fromScan;
    return items[0]?.reseller_id ?? null;
  }, [resellerId, scans, items]);

  const load = useCallback(async () => {
    try {
      const [e, r, s] = await Promise.all([
        api<{ items: ExtRow[] }>('/api/extensions'),
        api<{ items: Reseller[] }>('/api/resellers'),
        api<{ items: ScanRow[] }>('/api/extensions/scans?limit=20'),
      ]);
      setItems(e.items);
      setResellers(r.items);
      setScans(s.items);
      setResellerId((cur) => {
        if (cur) return cur;
        if (s.items[0]?.reseller_id) return String(s.items[0].reseller_id);
        if (e.items[0]?.reseller_id) return String(e.items[0].reseller_id);
        return r.items[0] ? String(r.items[0].id) : '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }, []);

  useEffect(() => {
    if (!resellerId) return;
    api<{ policy: { mode: 'off' | 'whitelist'; entries: { extension_id: string }[] } }>(
      `/api/resellers/${resellerId}/allowlist`,
    )
      .then((pol) => {
        setAllowedIds(new Set(pol.policy.entries.map((x) => x.extension_id)));
        setAllowMode(pol.policy.mode);
        setAllowText(pol.policy.entries.map((x) => x.extension_id).join('\n'));
      })
      .catch(() => {
        /* */
      });
  }, [resellerId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const latestScan = scans[0] || null;

  const inventory = useMemo(() => {
    const list = latestScan?.extensions_json || [];
    const q = query.trim().toLowerCase();
    return list
      .filter((x) => x.uses_cookies)
      .filter((x) => {
        if (!q) return true;
        return (
          (x.name || '').toLowerCase().includes(q) ||
          (x.id || '').toLowerCase().includes(q)
        );
      })
      .map((x) => ({
        ...x,
        allowed: allowedIds.has(x.id),
        status: allowedIds.has(x.id)
          ? 'allowed'
          : x.enabled
            ? 'risky-on'
            : 'blocked',
      }));
  }, [latestScan, allowedIds, query]);

  const blocked = inventory.filter((x) => x.status === 'blocked' || x.status === 'risky-on');
  const allowedRows = inventory.filter((x) => x.status === 'allowed');

  async function register(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let file_hashes: Record<string, string> = {};
      try {
        file_hashes = JSON.parse(hashesText || '{}');
      } catch {
        throw new Error('file_hashes must be valid JSON');
      }
      await api('/api/extensions', {
        method: 'POST',
        body: JSON.stringify({
          reseller_id: Number(resellerId),
          client_slug: clientSlug,
          extension_id: extensionId || 'unpacked-dev',
          file_hashes,
          integrity_mode: integrityMode,
        }),
      });
      setMessage('Extension registered / updated');
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function openAllowlist(row: ExtRow) {
    setResellerId(String(row.reseller_id));
    setClientSlug(row.client_slug);
    setExtensionId(row.extension_id);
    setIntegrityMode(row.integrity_mode as 'off' | 'warn' | 'block');
    setShowAllow(true);
    try {
      const res = await api<{
        policy: { mode: 'off' | 'whitelist'; entries: { extension_id: string }[] };
      }>(`/api/resellers/${row.reseller_id}/allowlist`);
      setAllowMode(res.policy.mode);
      setAllowText(res.policy.entries.map((e) => e.extension_id).join('\n'));
      setAllowedIds(new Set(res.policy.entries.map((e) => e.extension_id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allowlist load failed');
    }
  }

  async function saveAllowlist(e: FormEvent) {
    e.preventDefault();
    if (!resellerId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const entries = allowText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((extension_id) => ({ extension_id }));
      await api(`/api/resellers/${resellerId}/allowlist`, {
        method: 'PUT',
        body: JSON.stringify({ mode: allowMode, entries }),
      });
      setMessage('Allowlist saved');
      setShowAllow(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function allowOne(extId: string, name?: string) {
    if (!inventoryResellerId) {
      setError('No reseller selected for allowlist');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/resellers/${inventoryResellerId}/allowlist/entries`, {
        method: 'POST',
        body: JSON.stringify({ extension_id: extId, note: name || undefined }),
      });
      setMessage(`Allowed ${name || extId}. User can re-enable it in chrome://extensions.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allow failed');
    } finally {
      setBusy(false);
    }
  }

  async function revokeOne(extId: string) {
    if (!inventoryResellerId) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/resellers/${inventoryResellerId}/allowlist/entries/${encodeURIComponent(extId)}`,
        { method: 'DELETE' },
      );
      setMessage(`Revoked ${extId}. Extension will be disabled again on next scan / re-enable.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  const regColumns: DataColumn<ExtRow>[] = [
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (r) => r.reseller_slug,
      sortValue: (r) => r.reseller_slug,
    },
    {
      id: 'slug',
      header: 'Client slug',
      cell: (r) => r.client_slug,
      sortValue: (r) => r.client_slug,
    },
    {
      id: 'ext',
      header: 'Extension ID',
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.extension_id}</span>,
      sortValue: (r) => r.extension_id,
    },
    {
      id: 'integrity',
      header: 'Integrity',
      cell: (r) => <StatusBadge status={r.integrity_mode} />,
      sortValue: (r) => r.integrity_mode,
    },
    {
      id: 'allow',
      header: 'Allowlist',
      cell: (r) => r.allow_mode || 'off',
      sortValue: (r) => r.allow_mode || '',
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (r) => (
        <Button variant="outline" size="sm" onClick={() => void openAllowlist(r)}>
          Edit / allowlist
        </Button>
      ),
    },
  ];

  type InvRow = (typeof inventory)[number];
  const invColumns: DataColumn<InvRow>[] = [
    {
      id: 'name',
      header: 'Extension',
      cell: (r) => r.name || '—',
      sortValue: (r) => r.name || '',
    },
    {
      id: 'id',
      header: 'Chrome ID',
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.id}</span>,
      sortValue: (r) => r.id,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => {
        if (r.status === 'allowed') return <StatusBadge status="ok" />;
        if (r.status === 'risky-on') return <StatusBadge status="warn" />;
        return <StatusBadge status="fail" />;
      },
      sortValue: (r) => r.status,
    },
    {
      id: 'detail',
      header: 'Detail',
      cell: (r) =>
        r.status === 'allowed'
          ? 'On allowlist'
          : r.enabled
            ? 'Cookie-capable · still enabled'
            : 'Disabled by 1Clk Dev',
      sortValue: (r) => r.status,
    },
    {
      id: 'actions',
      header: '',
      cell: (r) =>
        r.allowed ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void revokeOne(r.id)}>
            Revoke
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void allowOne(r.id, r.name)}>
            Allow
          </Button>
        ),
    },
  ];

  if (loading || !user) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <Shell user={user}>
      <PageHeader
        title="Extensions"
        description="Blocked cookie tools from browser scans — Allow / Revoke here. Registrations + full allowlist below."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon data-icon="inline-start" />
              Register
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Last browser scan</CardDescription>
            <CardTitle className="text-base">
              {latestScan ? new Date(latestScan.created_at).toLocaleString() : 'Waiting…'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Cookie-capable seen</CardDescription>
            <CardTitle className="text-base">{latestScan?.risky_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Where to manage</CardDescription>
            <CardTitle className="text-base font-normal text-sm text-muted-foreground">
              This page → Blocked / Allowed tabs. After Allow, toggle the extension ON in Chrome.
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="ext-search"
        placeholder="Filter by name or Chrome ID"
      >
        <div className="flex flex-col gap-2 md:w-56">
          <Label htmlFor="inv-reseller">Allowlist reseller</Label>
          <select
            id="inv-reseller"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={resellerId}
            onChange={(e) => {
              setResellerId(e.target.value);
            }}
          >
            {resellers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </ListFilters>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error && !showCreate && !showAllow ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="blocked">Blocked / risky ({blocked.length})</TabsTrigger>
          <TabsTrigger value="allowed">Allowed ({allowedRows.length})</TabsTrigger>
          <TabsTrigger value="regs">Registrations</TabsTrigger>
        </TabsList>

        <TabsContent value="blocked" className="mt-4">
          {!latestScan ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No scan yet. Keep <strong>1Clk Dev</strong> loaded — it reports inventory every ~1 minute.
                Reload the extension if this stays empty.
              </CardContent>
            </Card>
          ) : (
            <DataTable
              rows={blocked}
              columns={invColumns}
              rowKey={(r) => r.id}
              emptyTitle="Nothing blocked"
              emptyDescription="No cookie-capable extensions outside the allowlist right now."
            />
          )}
        </TabsContent>

        <TabsContent value="allowed" className="mt-4">
          <DataTable
            rows={allowedRows}
            columns={invColumns}
            rowKey={(r) => r.id}
            emptyTitle="Allowlist empty"
            emptyDescription="Click Allow on a blocked row, or Edit allowlist on a registration."
          />
        </TabsContent>

        <TabsContent value="regs" className="mt-4">
          <DataTable
            rows={items}
            columns={regColumns}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No extensions registered"
            emptyDescription="Register after loading unpacked, or seed from old registered_extensions."
          />
        </TabsContent>
      </Tabs>

      <FormOverlay
        open={showCreate}
        onOpenChange={setShowCreate}
        title="Register extension"
        description="Upsert Chrome ID and file hashes for a reseller client."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={register}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Reseller</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={resellerId}
                onChange={(e) => setResellerId(e.target.value)}
                required
              >
                {resellers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.slug})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Client slug</Label>
              <Input value={clientSlug} onChange={(e) => setClientSlug(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Chrome extension ID</Label>
              <Input
                value={extensionId}
                onChange={(e) => setExtensionId(e.target.value)}
                placeholder="mllhbeeandemcibmjihehefihjdhomieh"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Integrity mode</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={integrityMode}
                onChange={(e) => setIntegrityMode(e.target.value as 'off' | 'warn' | 'block')}
              >
                <option value="off">off</option>
                <option value="warn">warn</option>
                <option value="block">block</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>File hashes JSON</Label>
            <Textarea
              value={hashesText}
              onChange={(e) => setHashesText(e.target.value)}
              className="min-h-28 font-mono text-xs"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save registration
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={showAllow}
        onOpenChange={setShowAllow}
        title={`Allowlist · reseller #${resellerId}`}
        description="Whitelist ON disables cookie/DNR/proxy/debugger extensions unless listed."
      >
        <form className="flex flex-col gap-4" onSubmit={saveAllowlist}>
          <div className="flex flex-col gap-2">
            <Label>Mode</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={allowMode}
              onChange={(e) => setAllowMode(e.target.value as 'off' | 'whitelist')}
            >
              <option value="whitelist">whitelist (enforce)</option>
              <option value="off">off (no disable)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Allowed extension IDs (one per line)</Label>
            <Textarea
              value={allowText}
              onChange={(e) => setAllowText(e.target.value)}
              placeholder="Paste Chrome IDs to allow"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save allowlist
          </Button>
        </form>
      </FormOverlay>
    </Shell>
  );
}
