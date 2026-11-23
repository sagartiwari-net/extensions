'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { DataTable, type DataColumn } from '@/components/data-table';
import { FormOverlay } from '@/components/form-overlay';
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

type Member = {
  tool_id: number;
  name: string;
  tool_key: string;
  reseller_id: number;
  reseller_slug: string;
};

type Pool = {
  id: number;
  name: string;
  member_count: number;
  has_cookie: number;
  updated_at: string | null;
};

type Tool = { id: number; name: string; reseller_slug: string; pool_id: number | null };

export default function PoolDetailPage() {
  const { user, loading } = useMe();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [pool, setPool] = useState<Pool | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [linkToolIds, setLinkToolIds] = useState<number[]>([]);
  const [cookiePlain, setCookiePlain] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('members');
  const [showRename, setShowRename] = useState(false);
  const [editName, setEditName] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<{ item: Pool; members: Member[] }>(`/api/cookie-pools/${id}`),
      api<{ items: Tool[] }>('/api/tools?limit=200'),
    ])
      .then(([p, t]) => {
        setPool(p.item);
        setMembers(p.members);
        setTools(t.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [id]);

  useEffect(() => {
    if (user && user.role !== 'master') {
      router.replace('/dashboard');
      return;
    }
    if (user) load();
  }, [user, load, router]);

  async function linkTools(e: FormEvent) {
    e.preventDefault();
    if (!linkToolIds.length) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${id}/members`, {
        method: 'POST',
        body: JSON.stringify({ tool_ids: linkToolIds }),
      });
      setLinkToolIds([]);
      setMessage(`${linkToolIds.length} tool(s) linked — cookie sync dono taraf`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setBusy(false);
    }
  }

  async function leave(toolId: number) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${id}/members/${toolId}`, { method: 'DELETE' });
      setMessage('Left pool — tool kept last cookie snapshot');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Leave failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveCookie(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ synced_member_count: number }>(`/api/cookie-pools/${id}/cookie`, {
        method: 'PUT',
        body: JSON.stringify({ cookie_plain: cookiePlain }),
      });
      setCookiePlain('');
      setMessage(`Cookie synced to ${res.synced_member_count} tool(s)`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim() }),
      });
      setShowRename(false);
      setMessage('Group renamed');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    if (
      !window.confirm(
        `Delete group “${pool?.name}”? Tools leave the group but keep their last cookie.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${id}`, { method: 'DELETE' });
      router.push('/pools');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  const columns: DataColumn<Member>[] = [
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (m) => m.reseller_slug,
      sortValue: (m) => m.reseller_slug,
    },
    {
      id: 'tool',
      header: 'Tool',
      cell: (m) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/tools/${m.tool_id}`}>
          {m.name}
        </Link>
      ),
      sortValue: (m) => m.name,
    },
    {
      id: 'key',
      header: 'Key',
      cell: (m) => <span className="text-muted-foreground">{m.tool_key}</span>,
      sortValue: (m) => m.tool_key,
    },
    {
      id: 'actions',
      header: '',
      cell: (m) => (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void leave(m.tool_id)}>
          Leave
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
  if (!pool) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        {error || 'Loading…'}
      </main>
    );
  }

  const linkable = tools.filter((t) => !t.pool_id);

  return (
    <Shell user={user}>
      <PageHeader
        title={pool.name}
        description={`Tool group · ${pool.member_count} tools · shared cookie ${pool.has_cookie ? 'on file' : 'missing'}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditName(pool.name);
                setShowRename(true);
              }}
            >
              Edit
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void deleteGroup()}>
              Delete
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/pools" />}>
              ← Tool groups
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Members</CardDescription>
            <CardTitle className="text-base">{pool.member_count}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Cookie</CardDescription>
            <CardTitle className="text-base">
              <StatusBadge status={pool.has_cookie ? 'active' : 'empty'} />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Updated</CardDescription>
            <CardTitle className="text-base text-sm font-normal text-muted-foreground">
              {pool.updated_at ? new Date(pool.updated_at).toLocaleString() : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members">Tools in group</TabsTrigger>
          <TabsTrigger value="link">Add tools</TabsTrigger>
          <TabsTrigger value="cookie">Shared cookie</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <DataTable
            rows={members}
            columns={columns}
            rowKey={(m) => m.tool_id}
            emptyTitle="No tools in this group"
            emptyDescription="Add tools from the Add tools tab."
          />
        </TabsContent>

        <TabsContent value="link" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Add tools to this group</CardTitle>
              <CardDescription>
                Tick sab tools jo isi account cookie use karein. Jo pehle se kisi group me hain woh
                yahan nahi dikhenge.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={linkTools}>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-input p-2">
                  {linkable.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">No free tools left.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {linkable.map((t) => (
                        <li key={t.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60">
                            <input
                              type="checkbox"
                              className="size-4 accent-foreground"
                              checked={linkToolIds.includes(t.id)}
                              onChange={() =>
                                setLinkToolIds((prev) =>
                                  prev.includes(t.id)
                                    ? prev.filter((x) => x !== t.id)
                                    : [...prev, t.id],
                                )
                              }
                            />
                            <span>
                              {t.reseller_slug} / {t.name}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button type="submit" disabled={busy || !linkToolIds.length} className="w-fit">
                  {busy ? 'Linking…' : `Add ${linkToolIds.length || ''} tool(s)`}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cookie" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Update cookie</CardTitle>
              <CardDescription>Saves once and syncs to every linked member.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={saveCookie}>
                <Textarea
                  value={cookiePlain}
                  onChange={(e) => setCookiePlain(e.target.value)}
                  placeholder='{"cookies":[...]}'
                  className="h-48 max-h-72 min-h-40 overflow-auto font-mono text-xs leading-relaxed"
                  required
                />
                <Button type="submit" disabled={busy || !members.length} className="w-fit">
                  {busy ? 'Saving…' : 'Save & sync'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FormOverlay
        open={showRename}
        onOpenChange={setShowRename}
        title="Edit group"
        description="Rename this tool group. Members and cookie stay the same."
      >
        <form className="flex flex-col gap-4" onSubmit={saveRename}>
          <div className="flex flex-col gap-2">
            <Label>Group name</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </FormOverlay>
    </Shell>
  );
}
