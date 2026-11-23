'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, RefreshCwIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { IpLink } from '@/components/identity-link';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type ToolRow = { tool_name: string; count: number };
type IpRow = {
  ip: string;
  country: string | null;
  city: string | null;
  isp: string | null;
  proxy_type: string;
  network_hint: string;
  is_hosting: boolean;
  is_proxy: boolean;
};
type LaunchRow = {
  id?: number;
  tool_name: string;
  client_ip: string | null;
  success: number;
  product_id?: string | null;
  created_at: string;
};
type AccessRow = {
  id?: number;
  tool_name: string;
  client_ip: string | null;
  request_ip?: string | null;
  success?: number;
  source?: string;
  created_at: string;
};
type IncidentRow = {
  id?: number;
  detection_type: string;
  page_url: string | null;
  client_ip: string | null;
  created_at: string;
};

type Profile = {
  username: string;
  summary: {
    launch_count: number;
    access_count: number;
    incident_count: number;
    unique_ips: number;
    mostly_used_tool: string | null;
    mostly_used_count: number;
  };
  tools_used: ToolRow[];
  ip_details: IpRow[];
  launches: LaunchRow[];
  access: AccessRow[];
  incidents: IncidentRow[];
};

export default function UserSecurityProfilePage() {
  const { user, loading } = useMe();
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username || '');
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');

  function load() {
    setError('');
    api<Profile>(`/api/security/users/${encodeURIComponent(username)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }

  useEffect(() => {
    if (user && username) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, username]);

  useEffect(() => {
    setQuery('');
  }, [tab]);

  const toolCols: DataColumn<ToolRow>[] = useMemo(
    () => [
      {
        id: 'tool',
        header: 'Tool',
        cell: (r) => <span className="font-medium">{r.tool_name}</span>,
        sortValue: (r) => r.tool_name,
      },
      {
        id: 'count',
        header: 'Uses',
        cell: (r) => r.count,
        sortValue: (r) => r.count,
      },
    ],
    [],
  );

  const ipCols: DataColumn<IpRow>[] = useMemo(
    () => [
      {
        id: 'ip',
        header: 'IP',
        cell: (r) => <IpLink ip={r.ip} />,
        sortValue: (r) => r.ip,
      },
      {
        id: 'type',
        header: 'Type',
        cell: (r) => (
          <StatusBadge
            status={r.is_hosting ? 'datacenter' : r.is_proxy ? 'proxy' : r.proxy_type || 'unknown'}
          />
        ),
        sortValue: (r) => r.proxy_type,
      },
      {
        id: 'loc',
        header: 'Location',
        cell: (r) => [r.city, r.country].filter(Boolean).join(', ') || '—',
        sortValue: (r) => `${r.city || ''}${r.country || ''}`,
      },
      {
        id: 'isp',
        header: 'Network / ISP',
        cell: (r) => (
          <span className="max-w-[260px] truncate text-sm" title={r.network_hint || r.isp || ''}>
            {r.isp || '—'}
          </span>
        ),
        sortValue: (r) => r.isp || '',
      },
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
      { id: 'tool', header: 'Tool', cell: (r) => r.tool_name, sortValue: (r) => r.tool_name },
      { id: 'ip', header: 'IP', cell: (r) => <IpLink ip={r.client_ip} />, sortValue: (r) => r.client_ip || '' },
      {
        id: 'ok',
        header: 'Result',
        cell: (r) => <StatusBadge status={r.success ? 'ok' : 'fail'} />,
        sortValue: (r) => r.success,
      },
    ],
    [],
  );

  const accessCols: DataColumn<AccessRow>[] = useMemo(
    () => [
      {
        id: 'when',
        header: 'When',
        cell: (r) => (
          <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
        ),
        sortValue: (r) => r.created_at,
      },
      { id: 'tool', header: 'Tool', cell: (r) => r.tool_name, sortValue: (r) => r.tool_name },
      {
        id: 'ip',
        header: 'Client IP',
        cell: (r) => <IpLink ip={r.client_ip || r.request_ip} />,
        sortValue: (r) => r.client_ip || r.request_ip || '',
      },
      {
        id: 'source',
        header: 'Source',
        cell: (r) => r.source || '—',
        sortValue: (r) => r.source || '',
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
        id: 'type',
        header: 'Action',
        cell: (r) => r.detection_type,
        sortValue: (r) => r.detection_type,
      },
      { id: 'ip', header: 'IP', cell: (r) => <IpLink ip={r.client_ip} />, sortValue: (r) => r.client_ip || '' },
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

  return (
    <Shell user={user}>
      <PageHeader
        title={`User · ${username}`}
        description="Member activity dossier — tools, networks, launches, and security events."
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
          <div className="grid gap-3 sm:grid-cols-4">
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Launches</CardDescription>
                <CardTitle className="text-base">{data.summary.launch_count}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription>Access logs</CardDescription>
                <CardTitle className="text-base">{data.summary.access_count}</CardTitle>
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
                <CardDescription>Most used tool</CardDescription>
                <CardTitle className="truncate text-base">
                  {data.summary.mostly_used_tool || '—'}
                  {data.summary.mostly_used_count ? ` (${data.summary.mostly_used_count})` : ''}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tools">Tools ({data.tools_used.length})</TabsTrigger>
              <TabsTrigger value="ips">IPs ({data.summary.unique_ips})</TabsTrigger>
              <TabsTrigger value="launches">Launches</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p>
                This member used <strong className="text-foreground">{data.summary.unique_ips}</strong> IP
                address(es). Top tool:{' '}
                <strong className="text-foreground">{data.summary.mostly_used_tool || 'none'}</strong>.
              </p>
              <p>Open each tab below to search, sort, and page through full history as data grows.</p>
            </TabsContent>

            <TabsContent value="tools" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="user-tools"
                placeholder="Filter tools…"
              />
              <DataTable
                rows={data.tools_used}
                columns={toolCols}
                rowKey={(r) => r.tool_name}
                globalFilter={query}
                emptyTitle="No tools"
                emptyDescription="No launch/access history for this user yet."
              />
            </TabsContent>

            <TabsContent value="ips" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="user-ips"
                placeholder="Filter IP, city, ISP…"
              />
              <DataTable
                rows={data.ip_details}
                columns={ipCols}
                rowKey={(r) => r.ip}
                globalFilter={query}
                emptyTitle="No IPs"
                emptyDescription="No client IPs recorded for this user."
              />
            </TabsContent>

            <TabsContent value="launches" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="user-launches"
                placeholder="Filter tool, IP…"
              />
              <DataTable
                rows={data.launches}
                columns={launchCols}
                rowKey={(r) => r.id ?? `${r.created_at}-${r.tool_name}-${r.client_ip}`}
                globalFilter={query}
                emptyTitle="No launches"
                emptyDescription="No extension launches logged for this user."
              />
            </TabsContent>

            <TabsContent value="access" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="user-access"
                placeholder="Filter tool, IP, source…"
              />
              <DataTable
                rows={data.access}
                columns={accessCols}
                rowKey={(r) => r.id ?? `${r.created_at}-${r.tool_name}-${r.client_ip}`}
                globalFilter={query}
                emptyTitle="No access logs"
                emptyDescription="No access panel / membership opens for this user."
              />
            </TabsContent>

            <TabsContent value="incidents" className="mt-4 space-y-3">
              <ListFilters
                query={query}
                onQuery={setQuery}
                searchId="user-incidents"
                placeholder="Filter detection, URL, IP…"
              />
              <DataTable
                rows={data.incidents}
                columns={incidentCols}
                rowKey={(r) => r.id ?? `${r.created_at}-${r.detection_type}-${r.page_url}`}
                globalFilter={query}
                emptyTitle="No incidents"
                emptyDescription="No inspect / tamper events for this user."
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
