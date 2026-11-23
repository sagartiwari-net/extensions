'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCwIcon, ShieldIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { IpLink, UsernameLink } from '@/components/identity-link';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Tool = {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  tool_key: string;
  name: string;
  security_tier: number;
  status: string;
};

type Incident = {
  id: number;
  reseller_slug: string | null;
  client_slug: string;
  detection_type: string;
  page_url: string | null;
  website_url: string | null;
  tool_name: string | null;
  username: string;
  client_ip: string | null;
  request_ip: string | null;
  username_source: string;
  extension_id: string | null;
  meta?: { mismatches?: string[]; mismatch_count?: number } | null;
  created_at: string;
};

const TIER_LABEL: Record<number, string> = {
  0: '0 · Off',
  1: '1 · Warn',
  2: '2 · Block billing URLs',
  3: '3 · Hard',
};

const DETECTION_LABEL: Record<string, string> = {
  docked_devtools: 'Inspect / DevTools (docked)',
  popup_devtools: 'DevTools window',
  service_worker: 'Extension / service worker inspect',
  keyboard_shortcut: 'Inspect shortcut (F12)',
  console_trap: 'Console inspect',
  page_detect: 'Page inspect',
  integrity_tamper: 'Extension file tampered',
};

export default function SecurityPage() {
  const { user, loading } = useMe();
  const [tools, setTools] = useState<Tool[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [tampers, setTampers] = useState<Incident[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('incidents');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const q = query ? `&q=${encodeURIComponent(query)}` : '';
    Promise.all([
      api<{ items: Tool[] }>('/api/tools?limit=200'),
      api<{ items: Incident[] }>(`/api/security/incidents?limit=200&type=inspect${q}`),
      api<{ items: Incident[] }>(`/api/security/incidents?limit=200&type=tamper${q}`),
    ])
      .then(([t, inc, tam]) => {
        setTools(
          t.items.map((row) => ({
            ...row,
            security_tier: Number((row as Tool).security_tier ?? 1),
          })),
        );
        setIncidents(inc.items || []);
        setTampers(tam.items || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [query]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function setTier(toolId: number, security_tier: number) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/tools/${toolId}`, {
        method: 'PATCH',
        body: JSON.stringify({ security_tier }),
      });
      setMessage(`Updated tool #${toolId} → tier ${security_tier}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const tierCounts = useMemo(() => {
    const c = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const t of tools) {
      const k = (t.security_tier ?? 1) as 0 | 1 | 2 | 3;
      if (k in c) c[k] += 1;
    }
    return c;
  }, [tools]);

  const incidentCols: DataColumn<Incident>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
      ),
      sortValue: (r) => r.created_at,
    },
    {
      id: 'user',
      header: 'Username',
      cell: (r) => (
        <span>
          <UsernameLink username={r.username} />
          {r.username_source && r.username_source !== 'stored' ? (
            <span className="ml-1 text-xs text-muted-foreground">({r.username_source})</span>
          ) : null}
        </span>
      ),
      sortValue: (r) => r.username,
    },
    {
      id: 'ip',
      header: 'IP',
      cell: (r) => <IpLink ip={r.client_ip || r.request_ip} />,
      sortValue: (r) => r.client_ip || r.request_ip || '',
    },
    {
      id: 'action',
      header: 'What they did',
      cell: (r) => DETECTION_LABEL[r.detection_type] || r.detection_type,
      sortValue: (r) => r.detection_type,
    },
    {
      id: 'url',
      header: 'Page URL',
      cell: (r) =>
        r.page_url ? (
          <span className="max-w-[240px] truncate text-xs" title={r.page_url}>
            {r.page_url}
          </span>
        ) : (
          '—'
        ),
      sortValue: (r) => r.page_url || '',
    },
    {
      id: 'tool',
      header: 'Tool',
      cell: (r) => r.tool_name || '—',
      sortValue: (r) => r.tool_name || '',
    },
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (r) => r.reseller_slug || r.client_slug,
      sortValue: (r) => r.reseller_slug || r.client_slug,
    },
  ];

  const tamperCols: DataColumn<Incident>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
      ),
      sortValue: (r) => r.created_at,
    },
    {
      id: 'user',
      header: 'Username',
      cell: (r) => <UsernameLink username={r.username} />,
      sortValue: (r) => r.username,
    },
    {
      id: 'ip',
      header: 'IP',
      cell: (r) => <IpLink ip={r.client_ip || r.request_ip} />,
      sortValue: (r) => r.client_ip || r.request_ip || '',
    },
    {
      id: 'files',
      header: 'Changed files',
      cell: (r) => {
        const list = r.meta?.mismatches || [];
        if (!list.length) return '—';
        return (
          <span className="max-w-[280px] truncate font-mono text-xs" title={list.join(', ')}>
            {list.join(', ')}
          </span>
        );
      },
      sortValue: (r) => (r.meta?.mismatches || []).join(','),
    },
    {
      id: 'ext',
      header: 'Extension ID',
      cell: (r) => <span className="font-mono text-xs">{r.extension_id || '—'}</span>,
      sortValue: (r) => r.extension_id || '',
    },
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (r) => r.reseller_slug || r.client_slug,
      sortValue: (r) => r.reseller_slug || r.client_slug,
    },
  ];

  const toolCols: DataColumn<Tool>[] = [
    {
      id: 'name',
      header: 'Tool',
      cell: (t) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/tools/${t.id}`}>
          {t.name}
        </Link>
      ),
      sortValue: (t) => t.name,
    },
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (t) => t.reseller_slug,
      sortValue: (t) => t.reseller_slug,
    },
    {
      id: 'tier',
      header: 'Security tier',
      cell: (t) => (
        <select
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          value={t.security_tier ?? 1}
          disabled={busy}
          onChange={(e) => void setTier(t.id, Number(e.target.value))}
        >
          <option value={0}>{TIER_LABEL[0]}</option>
          <option value={1}>{TIER_LABEL[1]}</option>
          <option value={2}>{TIER_LABEL[2]}</option>
          <option value={3}>{TIER_LABEL[3]}</option>
        </select>
      ),
      sortValue: (t) => t.security_tier ?? 1,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <StatusBadge status={t.status} />,
      sortValue: (t) => t.status,
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
        title="Security"
        description="Inspect lockouts, tamper logs, and per-tool security tiers. Extension register + allowlist live under Extensions."
        action={
          <Button variant="outline" onClick={load}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Inspect incidents</CardDescription>
            <CardTitle className="text-base">{incidents.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Tampered builds</CardDescription>
            <CardTitle className="text-base">{tampers.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Tier 2 / 3 tools</CardDescription>
            <CardTitle className="text-base">
              {tierCounts[2]} / {tierCounts[3]}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Extension setup</CardDescription>
            <CardTitle className="text-base font-normal">
              <Link className="text-sm underline-offset-4 hover:underline" href="/extensions">
                Registrations & allowlist →
              </Link>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="tampered">Tampered</TabsTrigger>
          <TabsTrigger value="tiers">Tool tiers</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="mt-4">
          <ListFilters
            query={query}
            onQuery={setQuery}
            searchId="sec-incidents"
            placeholder="Filter user, IP, URL, detection…"
          />
          <DataTable
            rows={incidents}
            columns={incidentCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No incidents yet"
            emptyDescription="Inspect / DevTools lockouts appear here. Click username or IP for a full dossier."
          />
        </TabsContent>

        <TabsContent value="tampered" className="mt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Automatic: extension live-hashes its files on boot / every 30 min. If anything differs from
            registered hashes and integrity mode is warn/block, a row is logged here (block also
            self-disables the extension).
          </p>
          <ListFilters
            query={query}
            onQuery={setQuery}
            searchId="sec-tamper"
            placeholder="Filter user, IP, file…"
          />
          <DataTable
            rows={tampers}
            columns={tamperCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No tamper events"
            emptyDescription="When someone edits packaged extension files, mismatches show up here with user/IP."
          />
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldIcon className="size-4" />
                How security works
              </CardTitle>
              <CardDescription>Automatic checks + admin visibility.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>
                1. <strong className="text-foreground">Integrity</strong> runs automatically on extension
                start (and every 30 min). Manual paste check is not needed.
              </p>
              <p>
                2. <strong className="text-foreground">Registration</strong> (our 1Clk build ID + file
                hashes + integrity mode) and <strong className="text-foreground">allowlist</strong>{' '}
                (other Chrome extensions allowed to stay enabled) both live only on{' '}
                <Link className="underline" href="/extensions">
                  Extensions
                </Link>
                — not duplicated here.
              </p>
              <p>
                3. <strong className="text-foreground">Tool tiers</strong> control how aggressive launch
                URL blocks are (0 soft → 3 hard). Separate from Inspect kill.
              </p>
              <p>4. Click any username / IP in Incidents or Tampered for a full activity dossier.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiers" className="mt-4">
          <ListFilters
            query={query}
            onQuery={setQuery}
            searchId="sec-tools"
            placeholder="Filter tools"
          />
          <DataTable
            rows={tools}
            columns={toolCols}
            rowKey={(t) => t.id}
            globalFilter={query}
            emptyTitle="No tools"
            emptyDescription="Create tools first."
          />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
