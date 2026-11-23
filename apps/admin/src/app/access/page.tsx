'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Tool = {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  tool_key: string;
  name: string;
  web_url: string;
  status: string;
  inject_strategy: string;
  has_cookie: number;
};

/** Same approach as panel.upays.in Access — browser public IPv4. */
async function browserPublicIP(): Promise<string> {
  const checks = [
    async () => (await (await fetch('https://ipv4.icanhazip.com', { cache: 'no-store' })).text()).trim(),
    async () => (await (await fetch('https://ifconfig.me/ip', { cache: 'no-store' })).text()).trim(),
    async () => {
      const body = (await (await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })).json()) as {
        ip?: string;
      };
      return (body.ip ?? '').trim();
    },
  ];
  for (const check of checks) {
    try {
      const ip = await check();
      if (
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
        !ip.startsWith('127.') &&
        !ip.startsWith('10.') &&
        !ip.startsWith('192.168.') &&
        !/^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      ) {
        return ip;
      }
    } catch {
      continue;
    }
  }
  return '';
}

export default function AccessTestPage() {
  const { user, loading } = useMe();
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolId, setToolId] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [username, setUsername] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastLaunchUrl, setLastLaunchUrl] = useState('');
  const [lastClientIp, setLastClientIp] = useState('');

  const load = useCallback(() => {
    api<{ items: Tool[] }>('/api/tools?limit=200')
      .then((t) => {
        setTools(t.items);
        setToolId((cur) => {
          if (cur) return cur;
          const withCookie = t.items.find((x) => x.has_cookie);
          return withCookie ? String(withCookie.id) : t.items[0] ? String(t.items[0].id) : '';
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const filtered = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.tool_key.toLowerCase().includes(q) ||
        t.reseller_slug.toLowerCase().includes(q) ||
        t.web_url.toLowerCase().includes(q),
    );
  }, [tools, toolSearch]);

  const selected = tools.find((t) => String(t.id) === toolId) || null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    setLastLaunchUrl('');
    setLastClientIp('');
    try {
      const clientIp = await browserPublicIP();
      if (!clientIp) {
        setError("This browser's IP could not be read. Check the connection and try again.");
        return;
      }
      setLastClientIp(clientIp);
      const res = await api<{
        launch_url: string;
        expires_in: number;
        token: string;
        client_ip?: string;
        client?: string | null;
        username?: string;
        site?: string;
        host?: string | null;
        tool_name?: string;
        tool_key?: string;
      }>(`/api/tools/${selected.id}/access`, {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          product_id: productId.trim(),
          tool_key: selected.tool_key,
          client_ip: clientIp,
        }),
      });
      // Bridge UI meta off the URL — launch URL is token-only
      try {
        localStorage.setItem(
          `1clk_launch_meta:${res.token}`,
          JSON.stringify({
            user: res.username || username.trim(),
            site: res.site || selected.reseller_slug,
            host: res.host || '',
            client: res.client || selected.reseller_slug,
            tool: res.tool_name || selected.name,
            tool_key: res.tool_key || selected.tool_key,
          }),
        );
      } catch {
        /* private mode */
      }
      setLastLaunchUrl(res.launch_url);
      setMessage(`Access granted. Token ~${res.expires_in}s. Logged IP ${clientIp}. Opening bridge…`);
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

  return (
    <Shell user={user}>
      <PageHeader
        title="Access"
        description="This button stands in for the aMember access button. It checks the username and product id, then returns you to the tool."
        action={
          <Button variant="outline" onClick={load}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh tools
          </Button>
        }
      />

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Open tool</CardTitle>
          <CardDescription>
            Same fields as panel Access — username, product id, and browser public IP are stored in access_logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="access-tool-search">Search tools</Label>
              <Input
                id="access-tool-search"
                placeholder="Filter by name or domain"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="access-tool">Tool</Label>
              <select
                id="access-tool"
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                value={toolId}
                onChange={(e) => setToolId(e.target.value)}
                required
              >
                <option value="">Choose a tool</option>
                {filtered.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {(() => {
                      try {
                        return new URL(t.web_url).hostname;
                      } catch {
                        return t.tool_key;
                      }
                    })()}
                    {t.has_cookie ? '' : ' (no cookie)'}
                  </option>
                ))}
              </select>
            </div>

            {selected ? (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  Status: <StatusBadge status={selected.status} />
                </span>
                <span>Cookie: {selected.has_cookie ? 'on file' : 'missing'}</span>
                <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`/tools/${selected.id}`}>
                  Tool detail
                </Link>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="access-username">Username</Label>
              <Input
                id="access-username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="access-product">Product id</Label>
              <Input
                id="access-product"
                inputMode="numeric"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
              />
            </div>

            <Button type="submit" disabled={busy || !selected || !selected.has_cookie || !username.trim() || !productId.trim()}>
              {busy ? 'Opening…' : 'Open'}
            </Button>

            <div className="flex flex-wrap gap-2">
              {lastLaunchUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.open(lastLaunchUrl, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  Re-open bridge
                </Button>
              ) : null}
              <Button type="button" variant="outline" nativeButton={false} render={<Link href="/reports" />}>
                Access / launch reports
              </Button>
            </div>

            {!selected?.has_cookie && selected ? (
              <p className="text-sm text-destructive">Save a cookie on the tool detail Cookie tab before testing.</p>
            ) : null}
            {lastClientIp ? (
              <p className="text-xs text-muted-foreground">Last client IP recorded: {lastClientIp}</p>
            ) : null}
            {message ? <p className="text-sm text-green-700">{message}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
