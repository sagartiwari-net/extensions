'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, RefreshCwIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { UsernameLink } from '@/components/identity-link';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type ToolRow = { tool_name: string; count: number };
type UserRow = { username: string };
type LaunchRow = {
  id?: number;
  username: string | null;
  tool_name: string;
  success?: number;
  created_at: string;
};
type IncidentRow = {
  id?: number;
  username: string | null;
  detection_type: string;
  page_url: string | null;
  created_at: string;
};

type Profile = {
  ip: string;
  intel: {
    country: string | null;
    region: string | null;
    city: string | null;
    isp: string | null;
    org: string | null;
    as_name: string | null;
    is_proxy: boolean;
    is_hosting: boolean;
    is_mobile: boolean;
    proxy_type: string;
    network_hint: string;
  } | null;
  summary: {
    launch_count: number;
    access_count: number;
    incident_count: number;
    unique_usernames: number;
    mostly_used_tool: string | null;
  };
  usernames: string[];
  tools_used: ToolRow[];
  launches: LaunchRow[];
  incidents: IncidentRow[];
};

export default function IpSecurityProfilePage() {
  const { user, loading } = useMe();
  const params = useParams<{ ip: string }>();
  const ip = decodeURIComponent(params.ip || '');
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');

  function load() {
    setError('');
    api<Profile>(`/api/security/ips/${encodeURIComponent(ip)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }

  useEffect(() => {
    if (user && ip) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, ip]);

  useEffect(() => {
    setQuery('');
  }, [tab]);

  const userRows: UserRow[] = useMemo(
    () => (data?.usernames || []).map((username) => ({ username })),
    [data?.usernames],
  );

  const userCols: DataColumn<UserRow>[] = useMemo(
    () => [
      {
        id: 'user',
        header: 'Username',
        cell: (r) => <UsernameLink username={r.username} />,
        sortValue: (r) => r.username,
      },
    ],
    [],
  );

  const toolCols: DataColumn<ToolRow>[] = useMemo(
    () => [
      {
        id: 'tool',
        header: 'Tool',
        cell: (r) => <span className="font-medium">{r.tool_name}</span>,
        sortValue: (r) => r.tool_name,
      },
      { id: 'count', header: 'Uses', cell: (r) => r.count, sortValue: (r) => r.count },
    ],
    [],
  );

  const launchCols: DataColumn<LaunchRow>[] = useMemo(
    () => [
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
        sortValue: (r) => r.username || '',
      },
      { id: 'tool', header: 'Tool', cell: (r) => r.tool_name, sortValue: (r) => r.tool_name },
      {
        id: 'ok',
        header: 'Result',
        cell: (r) =>
          typeof r.success === 'number' ? (
            <StatusBadge status={r.success ? 'ok' : 'fail'} />
          ) : (
            '—'
          ),
        sortValue: (r) => r.success ?? -1,
      },
    ],
    [],
  );

  const incidentCols: DataColumn<IncidentRow>[] = useMemo(
    () => [
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
        sortValue: (r) => r.username || '',
      },
      {
        id: 'type',
        header: 'Action',
        cell: (r) => r.detection_type,
        sortValue: (r) => r.detection_type,
      },
      {
        id: 'url',
        header: 'Page URL',
        cell: (r) =>
          r.page_url ? (
            <span className="max-w-[280px] truncate text-xs" title={r.page_url}>
              {r.page_url}
            </span>
          ) : (
            '—'
          ),
        sortValue: (r) => r.page_url || '',
      },
    ],
    [],
  );

  if (loading || !user) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  const intel = data?.intel;
  const typeLabel = intel
    ? [
        intel.proxy_type,
        intel.is_hosting ? 'VPS/datacenter' : null,
        intel.is_proxy ? 'proxy/VPN' : null,
        intel.is_mobile ? 'mobile' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '—';

  return (
    <Shell user={user}>
      <PageHeader
        title={`IP · ${ip}`}
        description="Network intelligence and activity from this address."
        action={
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/security" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              Security
            </Button>
            <Button variant="outline" onClick={load}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Network intelligence</CardTitle>
              <CardDescription>{intel?.network_hint || 'Lookup pending / unavailable'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="font-medium">
                  {[intel?.city, intel?.region, intel?.country].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-medium">{typeLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ISP</p>
                <p className="font-medium">{intel?.isp || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Org / ASN</p>
                <p className="font-medium">
                  {[intel?.org, intel?.as_name].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Users</CardDescription>
                <CardTitle className="text-base">{data.summary.unique_usernames}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Launches</CardDescription>
                <CardTitle className="text-base">{data.summary.launch_count}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Incidents</CardDescription>
                <CardTitle className="text-base">{data.summary.incident_count}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Top tool</CardDescription>
                <CardTitle className="truncate text-base">
                  {data.summary.mostly_used_tool || '—'}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="users">Users ({data.usernames.length})</TabsTrigger>
              <TabsTrigger value="tools">Tools ({data.tools_used.length})</TabsTrigger>
              <TabsTrigger value="launches">Launches</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p>
                This IP looks like <strong className="text-foreground">{intel?.proxy_type || 'unknown'}</strong>
                {intel?.is_hosting ? ' (likely VPS / datacenter / RDP host)' : ''}.
                {intel?.proxy_type === 'residential' ? ' Typical home/mobile ISP usage.' : ''}
              </p>
              <p>Use tabs for searchable, paginated history as traffic grows.</p>
            </TabsContent>

            <TabsContent value="users" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="ip-users"
                placeholder="Filter username…"
              />
              <DataTable
                rows={userRows}
                columns={userCols}
                rowKey={(r) => r.username}
                globalFilter={query}
                emptyTitle="No users"
                emptyDescription="No usernames linked to this IP yet."
              />
            </TabsContent>

            <TabsContent value="tools" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="ip-tools"
                placeholder="Filter tools…"
              />
              <DataTable
                rows={data.tools_used}
                columns={toolCols}
                rowKey={(r) => r.tool_name}
                globalFilter={query}
                emptyTitle="No tools"
                emptyDescription="No tool usage from this IP."
              />
            </TabsContent>

            <TabsContent value="launches" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="ip-launches"
                placeholder="Filter user, tool…"
              />
              <DataTable
                rows={data.launches}
                columns={launchCols}
                rowKey={(r) => r.id ?? `${r.created_at}-${r.username}-${r.tool_name}`}
                globalFilter={query}
                emptyTitle="No launches"
                emptyDescription="No launches recorded from this IP."
              />
            </TabsContent>

            <TabsContent value="incidents" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="ip-incidents"
                placeholder="Filter user, action, URL…"
              />
              <DataTable
                rows={data.incidents}
                columns={incidentCols}
                rowKey={(r) => r.id ?? `${r.created_at}-${r.username}-${r.detection_type}`}
                globalFilter={query}
                emptyTitle="No incidents"
                emptyDescription="No security events from this IP."
              />
            </TabsContent>
          </Tabs>
        </>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      ) : null}
    </Shell>
  );
}
