'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type VaultPreview = {
  usable: boolean;
  cookies: number;
  localStorage: number;
  sessionStorage: number;
  indexedDB: number;
  formats: string[];
  referer: boolean;
  error?: string;
};

type Tool = {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  tool_key: string;
  name: string;
  web_url: string;
  status: string;
  inject_strategy: string;
  cookie_jar_mode?: string;
  security_tier: number;
  has_cookie: boolean;
  vault_preview?: VaultPreview | null;
  pool_id: number | null;
  proxy_enabled?: number;
  proxy_profile_id?: number | null;
  user_agent_profile_id?: number | null;
};

type Pool = { id: number; name: string; member_count: number };
type Proxy = { id: number; name: string; host: string; port: number };
type Ua = { id: number; name: string };

export default function ToolDetailPage() {
  const { user, loading } = useMe();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tool, setTool] = useState<Tool | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [uas, setUas] = useState<Ua[]>([]);
  const [pickPool, setPickPool] = useState('');
  const [pickProxy, setPickProxy] = useState('');
  const [pickUa, setPickUa] = useState('');
  const [cookiePlain, setCookiePlain] = useState('');
  const [referer, setReferer] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');

  const load = useCallback(() => {
    Promise.all([
      api<{ item: Tool }>(`/api/tools/${id}`),
      api<{ items: Pool[] }>('/api/cookie-pools'),
      api<{ items: Proxy[] }>('/api/proxy-profiles'),
      api<{ items: Ua[] }>('/api/ua-profiles'),
    ])
      .then(([t, p, px, ua]) => {
        setTool(t.item);
        setPools(p.items);
        setProxies(px.items);
        setUas(ua.items);
        setPickProxy(t.item.proxy_profile_id ? String(t.item.proxy_profile_id) : '');
        setPickUa(t.item.user_agent_profile_id ? String(t.item.user_agent_profile_id) : '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function saveCookie(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ synced_via_pool?: number }>(`/api/tools/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          cookie_plain: cookiePlain,
          ...(referer.trim() ? { referer: referer.trim() } : {}),
        }),
      });
      setMessage(
        res.synced_via_pool
          ? `Cookie saved — synced to pool #${res.synced_via_pool}`
          : 'Cookie / storage vault saved (encrypted)',
      );
      setCookiePlain('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function access() {
    if (!tool) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const clientIp = '127.0.0.1';
      const res = await api<{
        launch_url: string;
        expires_in: number;
        token: string;
        username?: string;
        site?: string;
        host?: string | null;
        client?: string | null;
        tool_name?: string;
        tool_key?: string;
      }>(`/api/tools/${id}/access`, {
        method: 'POST',
        body: JSON.stringify({
          username: user?.username || 'admin-test',
          product_id: 'test',
          tool_key: tool.tool_key,
          client_ip: clientIp,
        }),
      });
      try {
        localStorage.setItem(
          `1clk_launch_meta:${res.token}`,
          JSON.stringify({
            user: res.username || user?.username || 'admin-test',
            site: res.site || tool.reseller_slug,
            host: res.host || '',
            client: res.client || tool.reseller_slug,
            tool: res.tool_name || tool.name,
            tool_key: res.tool_key || tool.tool_key,
          }),
        );
      } catch {
        /* */
      }
      setMessage(`Token ready (${res.expires_in}s). Opening launch bridge…`);
      window.open(res.launch_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }
  if (!tool) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        {error || 'Loading…'}
      </main>
    );
  }

  return (
    <Shell user={user}>
      <PageHeader
        title={tool.name}
        description={`${tool.reseller_slug}/${tool.tool_key} · ${tool.web_url}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/tools" />}>
              ← Tools
            </Button>
            <Button onClick={() => void access()} disabled={busy || !tool.has_cookie}>
              Access / Test
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-base">
              <StatusBadge status={tool.status} />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Strategy</CardDescription>
            <CardTitle className="text-base">{tool.inject_strategy}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Vault</CardDescription>
            <CardTitle className="text-base">
              {!tool.has_cookie
                ? 'Missing'
                : tool.vault_preview?.usable
                  ? 'Ready'
                  : tool.vault_preview?.error
                    ? 'Decrypt fail'
                    : 'Empty / not usable'}
            </CardTitle>
            {tool.vault_preview ? (
              <CardDescription className="pt-1 text-[11px] leading-snug">
                c:{tool.vault_preview.cookies} ls:{tool.vault_preview.localStorage} ss:
                {tool.vault_preview.sessionStorage} idb:{tool.vault_preview.indexedDB}
                {tool.vault_preview.formats?.length
                  ? ` · ${tool.vault_preview.formats.join('+')}`
                  : ''}
              </CardDescription>
            ) : null}
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Pool</CardDescription>
            <CardTitle className="text-base">
              {tool.pool_id ? `#${tool.pool_id}` : 'Not linked'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cookie">Cookie</TabsTrigger>
          <TabsTrigger value="sync">Cookie sync</TabsTrigger>
          <TabsTrigger value="network">Proxy / UA</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
              <CardDescription>Edit name, URL, key, strategy, or status — or delete the tool.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setBusy(true);
                  setError('');
                  setMessage('');
                  api(`/api/tools/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      name: String(fd.get('name') || ''),
                      tool_key: String(fd.get('tool_key') || ''),
                      web_url: String(fd.get('web_url') || ''),
                      inject_strategy: String(fd.get('inject_strategy') || 'cookies'),
                      cookie_jar_mode: String(fd.get('cookie_jar_mode') || 'auto'),
                      status: String(fd.get('status') || 'active'),
                    }),
                  })
                    .then(() => {
                      setMessage('Tool updated');
                      load();
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : 'Update failed'))
                    .finally(() => setBusy(false));
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="tool-name">Name</Label>
                    <input
                      id="tool-name"
                      name="name"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.name}
                      key={`name-${tool.name}`}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="tool-key">Tool key</Label>
                    <input
                      id="tool-key"
                      name="tool_key"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.tool_key}
                      key={`key-${tool.tool_key}`}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="tool-url">Web URL</Label>
                    <input
                      id="tool-url"
                      name="web_url"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.web_url}
                      key={`url-${tool.web_url}`}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Strategy</Label>
                    <select
                      name="inject_strategy"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.inject_strategy}
                      key={`strat-${tool.inject_strategy}`}
                    >
                      <option value="cookies">cookies</option>
                      <option value="storage_reload">storage_reload (LS/SS)</option>
                      <option value="idb">idb (IndexedDB / Jasper)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Save cookies in browser</Label>
                    <select
                      name="cookie_jar_mode"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.cookie_jar_mode || 'auto'}
                      key={`jar-${tool.cookie_jar_mode || 'auto'}`}
                    >
                      <option value="auto">Auto</option>
                      <option value="browser">Yes — browser jar</option>
                      <option value="extension_only">No — extension only</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Status</Label>
                    <select
                      name="status"
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      defaultValue={tool.status}
                      key={`status-${tool.status}`}
                    >
                      <option value="active">active</option>
                      <option value="updating">updating</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Security tier: {tool.security_tier}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Saving…' : 'Save basics'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete “${tool.name}”? This cannot be undone.`)) return;
                      setBusy(true);
                      api(`/api/tools/${id}`, { method: 'DELETE' })
                        .then(() => {
                          window.location.href = '/tools';
                        })
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : 'Delete failed');
                          setBusy(false);
                        });
                    }}
                  >
                    Delete tool
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cookie" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Cookie / storage vault</CardTitle>
              <CardDescription>
                Paste any of: bare Cookie-Editor array <code>[{'{'}…{'}'}]</code>, object with{' '}
                <code>cookies</code> + optional <code>referer</code>, or{' '}
                <code>localStorage</code> / <code>sessionStorage</code> / <code>indexedDB</code>{' '}
                (Jasper-style). Server normalizes and encrypts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={saveCookie}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vault-referer">Referer (optional)</Label>
                  <input
                    id="vault-referer"
                    type="url"
                    value={referer}
                    onChange={(e) => setReferer(e.target.value)}
                    placeholder="https://www.semrush.com/home/"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    If the paste already has <code>referer</code>, leave this empty. Use this when
                    pasting a bare cookie array but the tool checks Referer.
                  </p>
                </div>
                <Textarea
                  value={cookiePlain}
                  onChange={(e) => setCookiePlain(e.target.value)}
                  placeholder='[{...}]  or  {"cookies":[...],"referer":"https://..."}  or  {"indexedDB":{...}}'
                  className="h-48 max-h-72 min-h-40 overflow-auto font-mono text-xs leading-relaxed"
                  required
                />
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save vault'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Cookie sync pool</CardTitle>
              <CardDescription>
                Bi-directional — any linked tool update refreshes all members.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tool.pool_id ? (
                <p className="text-sm text-muted-foreground">
                  Linked to pool #{tool.pool_id}.{' '}
                  <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`/pools/${tool.pool_id}`}>
                    Open pool
                  </Link>
                </p>
              ) : (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!pickPool) return;
                    setBusy(true);
                    api(`/api/cookie-pools/${pickPool}/members`, {
                      method: 'POST',
                      body: JSON.stringify({ tool_id: Number(id) }),
                    })
                      .then(() => {
                        setMessage('Linked to pool');
                        load();
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Link failed'))
                      .finally(() => setBusy(false));
                  }}
                >
                  <div className="flex min-w-56 flex-col gap-2">
                    <Label>Join pool</Label>
                    <select
                      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                      value={pickPool}
                      onChange={(e) => setPickPool(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {pools.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.member_count})
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" disabled={busy || !pickPool}>
                    Link
                  </Button>
                  <Link className="text-sm underline-offset-4 hover:underline" href="/pools">
                    Manage pools
                  </Link>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Proxy / UA</CardTitle>
              <CardDescription>Attach library profiles for launches.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  api(`/api/tools/${id}/profiles`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      proxy_profile_id: pickProxy ? Number(pickProxy) : null,
                      user_agent_profile_id: pickUa ? Number(pickUa) : null,
                      proxy_enabled: Boolean(pickProxy),
                    }),
                  })
                    .then(() => {
                      setMessage('Profiles attached');
                      load();
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : 'Failed'))
                    .finally(() => setBusy(false));
                }}
              >
                <div className="flex min-w-48 flex-col gap-2">
                  <Label>Proxy</Label>
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                    value={pickProxy}
                    onChange={(e) => setPickProxy(e.target.value)}
                  >
                    <option value="">No proxy</option>
                    {proxies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.host}:{p.port})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-40 flex-col gap-2">
                  <Label>User-Agent</Label>
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                    value={pickUa}
                    onChange={(e) => setPickUa(e.target.value)}
                  >
                    <option value="">Default UA</option>
                    {uas.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
                <Link className="text-sm underline-offset-4 hover:underline" href="/profiles">
                  Manage
                </Link>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Security tier</CardTitle>
              <CardDescription>
                0 off · 1 warn · 2 apply block URL rules harder · 3 hard (opt-in). Global integrity /
                allowlist live on the Security page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const security_tier = Number(fd.get('security_tier'));
                  setBusy(true);
                  setError('');
                  api(`/api/tools/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ security_tier }),
                  })
                    .then(() => {
                      setMessage(`Security tier → ${security_tier}`);
                      load();
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : 'Failed'))
                    .finally(() => setBusy(false));
                }}
              >
                <div className="flex min-w-48 flex-col gap-2">
                  <Label>Tier</Label>
                  <select
                    name="security_tier"
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                    defaultValue={tool.security_tier}
                    key={tool.security_tier}
                  >
                    <option value={0}>0 · Off</option>
                    <option value={1}>1 · Warn</option>
                    <option value={2}>2 · Block billing URLs</option>
                    <option value={3}>3 · Hard</option>
                  </select>
                </div>
                <Button type="submit" disabled={busy}>
                  Save tier
                </Button>
                <Link className="text-sm underline-offset-4 hover:underline" href="/security">
                  Security hub
                </Link>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Access / Test</CardTitle>
              <CardDescription>
                Creates a one-time token and opens the launch bridge. Load unpacked extension (
                <code>apps/extension/dist</code>) first. Prefer the sidebar <strong>Access / Test</strong>{' '}
                hub to pick any tool.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void access()} disabled={busy || !tool.has_cookie}>
                  Test Access
                </Button>
                <Button variant="outline" nativeButton={false} render={<Link href="/access" />}>
                  Open Access hub
                </Button>
                <Button variant="outline" nativeButton={false} render={<Link href="/reports" />}>
                  Launch reports
                </Button>
              </div>
              {!tool.has_cookie ? (
                <p className="text-sm text-destructive">Save a cookie on the Cookie tab first.</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </Shell>
  );
}
