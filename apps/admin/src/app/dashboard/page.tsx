'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/hooks/use-me';
import { API_BASE, api } from '@/lib/api';

type Health = { ok: boolean; db: boolean; redis: boolean };

export default function DashboardPage() {
  const { user, loading } = useMe();
  const [health, setHealth] = useState<Health | null>(null);
  const [counts, setCounts] = useState({ tools: 0, resellers: 0, pools: 0 });

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api<{ items: unknown[] }>('/api/tools'),
      api<{ items: unknown[] }>('/api/resellers'),
      api<{ items: unknown[] }>('/api/cookie-pools'),
    ])
      .then(([t, r, p]) =>
        setCounts({ tools: t.items.length, resellers: r.items.length, pools: p.items.length }),
      )
      .catch(() => {});
  }, [user]);

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
        title="Overview"
        description="Live health and shortcuts — same layout language as panel.upays.in."
        action={
          <Link href="/tools">
            <Button>Open tools</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tools</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{counts.tools}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resellers</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{counts.resellers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cookie pools</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{counts.pools}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">API</CardTitle>
            <CardDescription>{health?.ok ? 'Responding' : 'Unreachable'}</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{health?.ok ? 'Up' : 'Down'}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MySQL</CardTitle>
            <CardDescription>Primary datastore</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{health?.db ? 'OK' : 'No'}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redis</CardTitle>
            <CardDescription>Cache / sessions</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{health?.redis ? 'OK' : 'No'}</CardContent>
        </Card>
      </div>
    </Shell>
  );
}
