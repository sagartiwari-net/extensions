'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PlusIcon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { FormOverlay } from '@/components/form-overlay';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Proxy = {
  id: number;
  name: string;
  host: string;
  port: number;
  scheme: string;
  owner_reseller_id: number | null;
  has_password: number;
};

type Ua = {
  id: number;
  name: string;
  user_agent: string;
  owner_reseller_id: number | null;
};

export default function ProfilesPage() {
  const { user, loading } = useMe();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [uas, setUas] = useState<Ua[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('proxies');
  const [showProxy, setShowProxy] = useState(false);
  const [showUa, setShowUa] = useState(false);

  const [pName, setPName] = useState('');
  const [pHost, setPHost] = useState('');
  const [pPort, setPPort] = useState('8080');
  const [pScheme, setPScheme] = useState('http');
  const [pUser, setPUser] = useState('');
  const [pPass, setPPass] = useState('');
  const [uName, setUName] = useState('');
  const [uAgent, setUAgent] = useState(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );

  const load = useCallback(() => {
    Promise.all([
      api<{ items: Proxy[] }>('/api/proxy-profiles'),
      api<{ items: Ua[] }>('/api/ua-profiles'),
    ])
      .then(([p, u]) => {
        setProxies(p.items);
        setUas(u.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function addProxy(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/proxy-profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: pName,
          host: pHost,
          port: Number(pPort),
          scheme: pScheme,
          username: pUser || null,
          password: pPass || null,
          owner_reseller_id: null,
        }),
      });
      setPName('');
      setPHost('');
      setShowProxy(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function addUa(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/ua-profiles', {
        method: 'POST',
        body: JSON.stringify({ name: uName, user_agent: uAgent, owner_reseller_id: null }),
      });
      setUName('');
      setShowUa(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const proxyColumns: DataColumn<Proxy>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
    {
      id: 'type',
      header: 'Type',
      cell: (r) => r.scheme.toUpperCase(),
      sortValue: (r) => r.scheme,
    },
    {
      id: 'endpoint',
      header: 'Endpoint',
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.host}:{r.port}
        </span>
      ),
      sortValue: (r) => `${r.host}:${r.port}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: () => <StatusBadge status="active" />,
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (r) => (r.owner_reseller_id == null ? 'global' : `#${r.owner_reseller_id}`),
      sortValue: (r) => r.owner_reseller_id ?? 0,
    },
  ];

  const uaColumns: DataColumn<Ua>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
    {
      id: 'ua',
      header: 'User-Agent',
      cell: (r) => <span className="line-clamp-2 text-xs text-muted-foreground">{r.user_agent}</span>,
      sortValue: (r) => r.user_agent,
      className: 'max-w-md',
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
        title="Proxy / UA"
        description="Library profiles. Attach them on a tool — same idea as panel.upays.in Proxy Manager."
        action={
          <Button
            onClick={() => (tab === 'uas' ? setShowUa(true) : setShowProxy(true))}
          >
            <PlusIcon data-icon="inline-start" />
            {tab === 'uas' ? 'New UA' : 'New proxy'}
          </Button>
        }
      />

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="profiles-search"
        placeholder={tab === 'uas' ? 'Name or UA string' : 'Name or endpoint'}
      />

      {error && !showProxy && !showUa ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="proxies">Proxies</TabsTrigger>
          <TabsTrigger value="uas">User agents</TabsTrigger>
        </TabsList>

        <TabsContent value="proxies" className="mt-4">
          <DataTable
            rows={proxies}
            columns={proxyColumns}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No proxies"
            emptyDescription="Add a proxy from the old dump seed or create one here."
          />
        </TabsContent>

        <TabsContent value="uas" className="mt-4">
          <DataTable
            rows={uas}
            columns={uaColumns}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No user-agents"
            emptyDescription="Seed from old DB or add one."
          />
        </TabsContent>
      </Tabs>

      <FormOverlay
        open={showProxy}
        onOpenChange={setShowProxy}
        title="Add proxy"
        description="Saved proxy profiles attach to tools on the detail page."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={addProxy}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Name</Label>
              <Input value={pName} onChange={(e) => setPName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Scheme</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={pScheme}
                onChange={(e) => setPScheme(e.target.value)}
              >
                <option value="http">http</option>
                <option value="https">https</option>
                <option value="socks5">socks5</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Host</Label>
              <Input value={pHost} onChange={(e) => setPHost(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Port</Label>
              <Input value={pPort} onChange={(e) => setPPort(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Username</Label>
              <Input value={pUser} onChange={(e) => setPUser(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Password</Label>
              <Input type="password" value={pPass} onChange={(e) => setPPass(e.target.value)} />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save proxy
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={showUa}
        onOpenChange={setShowUa}
        title="Add user-agent"
        description="Reusable browser identity string."
      >
        <form className="flex flex-col gap-4" onSubmit={addUa}>
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input value={uName} onChange={(e) => setUName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>User-Agent string</Label>
            <Textarea value={uAgent} onChange={(e) => setUAgent(e.target.value)} required />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save UA
          </Button>
        </form>
      </FormOverlay>
    </Shell>
  );
}
