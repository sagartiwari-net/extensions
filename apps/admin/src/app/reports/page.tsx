'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { IpLink, UsernameLink } from '@/components/identity-link';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type LaunchEvent = {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  tool_name: string;
  success: number;
  reason: string | null;
  inject_strategy: string | null;
  duration_ms: number | null;
  extension_id: string | null;
  username: string | null;
  client_ip: string | null;
  product_id: string | null;
  created_at: string;
  ip_type?: string;
  ip_label?: string;
  ip_risky?: boolean;
};

type Reseller = { id: number; name: string; slug: string };

function NetworkType({
  label,
  type,
  risky,
}: {
  label?: string;
  type?: string;
  risky?: boolean;
}) {
  const text = label || type || 'Unknown';
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs',
        risky ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}
      title={risky ? 'Looks like VPS / datacenter / proxy — click IP for detail' : 'Looks like normal ISP'}
    >
      {text}
    </span>
  );
}

export default function ReportsPage() {
  const { user, loading } = useMe();
  const isMaster = user?.role === 'master';
  const [launches, setLaunches] = useState<LaunchEvent[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [resellerFilter, setResellerFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [networkFilter, setNetworkFilter] = useState('all');

  const loadResellers = useCallback(() => {
    if (!user || user.role !== 'master') return;
    api<{ items: Reseller[] }>('/api/resellers')
      .then((r) => setResellers(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [user]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (resellerFilter !== 'all') params.set('reseller_id', resellerFilter);
    setError('');
    api<{ items: LaunchEvent[] }>(`/api/launch-events?${params}`)
      .then((l) => setLaunches(l.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [resellerFilter]);

  useEffect(() => {
    if (user) loadResellers();
  }, [user, loadResellers]);

  useEffect(() => {
    setToolFilter('all');
  }, [resellerFilter]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const toolOptions = useMemo(() => {
    const names = [...new Set(launches.map((e) => e.tool_name).filter(Boolean))];
    return names.sort((a, b) => a.localeCompare(b));
  }, [launches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return launches.filter((e) => {
      if (resultFilter === 'ok' && !e.success) return false;
      if (resultFilter === 'fail' && e.success) return false;
      if (toolFilter !== 'all' && e.tool_name !== toolFilter) return false;
      if (networkFilter === 'risky' && !e.ip_risky) return false;
      if (networkFilter === 'safe' && e.ip_risky) return false;
      if (networkFilter !== 'all' && networkFilter !== 'risky' && networkFilter !== 'safe') {
        const type = (e.ip_type || '').toLowerCase();
        if (type !== networkFilter) return false;
      }
      if (!q) return true;
      const hay = [
        e.username,
        e.client_ip,
        e.product_id,
        e.tool_name,
        e.reseller_slug,
        e.ip_label,
        e.ip_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [launches, query, resultFilter, toolFilter, networkFilter]);

  const stats = useMemo(() => {
    const ok = launches.filter((e) => e.success).length;
    const risky = launches.filter((e) => e.ip_risky).length;
    return { total: launches.length, ok, fail: launches.length - ok, risky };
  }, [launches]);

  const columns: DataColumn<LaunchEvent>[] = useMemo(() => {
    const cols: DataColumn<LaunchEvent>[] = [
      {
        id: 'when',
        header: 'When',
        cell: (e) => (
          <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
        ),
        sortValue: (e) => e.created_at,
      },
    ];
    if (isMaster) {
      cols.push({
        id: 'reseller',
        header: 'Reseller',
        cell: (e) => e.reseller_slug,
        sortValue: (e) => e.reseller_slug,
      });
    }
    cols.push(
      {
        id: 'user',
        header: 'User',
        cell: (e) => <UsernameLink username={e.username} />,
        sortValue: (e) => e.username || '',
      },
      {
        id: 'product',
        header: 'Product',
        cell: (e) => e.product_id || '—',
        sortValue: (e) => e.product_id || '',
      },
      { id: 'tool', header: 'Tool', cell: (e) => e.tool_name, sortValue: (e) => e.tool_name },
      {
        id: 'ip',
        header: 'Client IP',
        cell: (e) => <IpLink ip={e.client_ip} />,
        sortValue: (e) => e.client_ip || '',
      },
      {
        id: 'net',
        header: 'Network',
        cell: (e) => <NetworkType label={e.ip_label} type={e.ip_type} risky={e.ip_risky} />,
        sortValue: (e) => e.ip_type || '',
      },
      {
        id: 'ok',
        header: 'Result',
        cell: (e) => <StatusBadge status={e.success ? 'ok' : 'fail'} />,
        sortValue: (e) => e.success,
      },
    );
    return cols;
  }, [isMaster]);

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
        title="Launch reports"
        description={
          isMaster
            ? 'Filter by reseller to audit one account. Reseller logins only see their own launches.'
            : 'Your reseller launches after cookie inject. Network shows VPS/proxy risk — click IP for detail.'
        }
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
            <CardDescription>Launches</CardDescription>
            <CardTitle className="text-base">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>OK</CardDescription>
            <CardTitle className="text-base">{stats.ok}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Failed</CardDescription>
            <CardTitle className="text-base">{stats.fail}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Risky networks</CardDescription>
            <CardTitle className="text-base">{stats.risky}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="reports-search"
        placeholder="Username, IP, product, tool, or reseller"
      >
        {isMaster ? (
          <div className="flex flex-col gap-2 md:w-48">
            <Label htmlFor="reports-reseller">Reseller</Label>
            <select
              id="reports-reseller"
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={resellerFilter}
              onChange={(e) => setResellerFilter(e.target.value)}
            >
              <option value="all">All resellers</option>
              {resellers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 md:w-36">
          <Label htmlFor="reports-result">Result</Label>
          <select
            id="reports-result"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="ok">Success</option>
            <option value="fail">Failed</option>
          </select>
        </div>
        <div className="flex flex-col gap-2 md:w-44">
          <Label htmlFor="reports-tool">Tool</Label>
          <select
            id="reports-tool"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
          >
            <option value="all">All tools</option>
            {toolOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 md:w-44">
          <Label htmlFor="reports-network">Network</Label>
          <select
            id="reports-network"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
          >
            <option value="all">All networks</option>
            <option value="safe">Normal / residential</option>
            <option value="risky">Risky (VPS / DC / proxy)</option>
            <option value="residential">Residential</option>
            <option value="datacenter">Datacenter / VPS</option>
            <option value="proxy_vpn">Proxy / VPN</option>
            <option value="mobile">Mobile</option>
          </select>
        </div>
      </ListFilters>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {launches.length} launch{launches.length === 1 ? '' : 'es'}
      </p>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        emptyTitle="No launches yet"
        emptyDescription="Extension reports after a successful cookie inject."
      />
    </Shell>
  );
}
