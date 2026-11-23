'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';

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
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Pool = {
  id: number;
  name: string;
  member_count: number;
  has_cookie: number;
  updated_at: string | null;
};

type Tool = { id: number; name: string; reseller_slug: string; pool_id: number | null };

export default function PoolsPage() {
  const { user, loading } = useMe();
  const router = useRouter();
  const [items, setItems] = useState<Pool[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [seedToolId, setSeedToolId] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editPool, setEditPool] = useState<Pool | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<{ items: Pool[] }>('/api/cookie-pools'),
      api<{ items: Tool[] }>('/api/tools?limit=200'),
    ])
      .then(([p, t]) => {
        setItems(p.items);
        setTools(t.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (user && user.role !== 'master') {
      router.replace('/dashboard');
      return;
    }
    if (user) load();
  }, [user, load, router]);

  const freeTools = useMemo(() => tools.filter((t) => !t.pool_id), [tools]);

  function toggleMember(id: number) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openEdit(pool: Pool) {
    setEditPool(pool);
    setEditName(pool.name);
    setError('');
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ids = [...new Set([...(seedToolId ? [Number(seedToolId)] : []), ...memberIds])];
      const res = await api<{ item: { id: number } }>('/api/cookie-pools', {
        method: 'POST',
        body: JSON.stringify({
          name,
          seed_tool_id: seedToolId ? Number(seedToolId) : undefined,
          member_tool_ids: ids,
        }),
      });
      setName('');
      setSeedToolId('');
      setMemberIds([]);
      setShowCreate(false);
      load();
      if (res.item?.id) {
        window.location.href = `/pools/${res.item.id}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editPool) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${editPool.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim() }),
      });
      setEditPool(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(pool: Pool) {
    if (
      !window.confirm(
        `Delete group “${pool.name}”? Tools leave the group but keep their last cookie.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/cookie-pools/${pool.id}`, { method: 'DELETE' });
      if (editPool?.id === pool.id) setEditPool(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<Pool>[] = [
    {
      id: 'name',
      header: 'Group name',
      cell: (row) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/pools/${row.id}`}>
          {row.name}
        </Link>
      ),
      sortValue: (row) => row.name,
    },
    {
      id: 'members',
      header: 'Tools in group',
      cell: (row) => row.member_count,
      sortValue: (row) => row.member_count,
    },
    {
      id: 'cookie',
      header: 'Shared cookie',
      cell: (row) => <StatusBadge status={row.has_cookie ? 'active' : 'empty'} />,
      sortValue: (row) => row.has_cookie,
    },
    {
      id: 'updated',
      header: 'Updated',
      cell: (row) =>
        row.updated_at ? (
          <span className="text-muted-foreground">{new Date(row.updated_at).toLocaleString()}</span>
        ) : (
          '—'
        ),
      sortValue: (row) => row.updated_at || '',
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              openEdit(row);
            }}
          >
            <PencilIcon data-icon="inline-start" className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void deleteOne(row);
            }}
          >
            <Trash2Icon data-icon="inline-start" className="size-3.5" />
            Del
          </Button>
        </div>
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
        title="Tool groups"
        description="Same account cookie for many tools (e.g. Azad’s 10 tools). Update once → all members get it."
        action={
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            New group
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How it works (simple)</CardTitle>
          <CardDescription>
            1) Create a group · 2) Tick the tools that share one login · 3) Paste cookie once on the
            group · 4) Later, edit cookie on any linked tool — sab sync ho jate hain.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Tools list / Edit tool pe bhi <strong className="text-foreground">Pool / group</strong>{' '}
          dropdown se link kar sakte ho.
        </CardContent>
      </Card>

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="pools-search"
        placeholder="Search group name"
      />

      {error && !showCreate && !editPool ? <p className="text-sm text-destructive">{error}</p> : null}

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(r) => r.id}
        globalFilter={query}
        emptyTitle="No groups yet"
        emptyDescription="Create a group and select tools that should share one cookie."
      />

      <FormOverlay
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) {
            setMemberIds([]);
            setSeedToolId('');
          }
        }}
        title="New tool group"
        description="Pick tools now (or add later). Seed tool = jiski cookie pehle se hai."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={onCreate}>
          <div className="flex flex-col gap-2">
            <Label>Group name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Azad — shared account"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Seed cookie from tool (optional)</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={seedToolId}
              onChange={(e) => setSeedToolId(e.target.value)}
            >
              <option value="">None — paste cookie later</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id} disabled={Boolean(t.pool_id)}>
                  {t.reseller_slug} / {t.name}
                  {t.pool_id ? ' (already in a group)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Add tools to this group</Label>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-input p-2">
              {freeTools.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  No free tools — sab already kisi group me hain, ya pehle tools banao.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {freeTools.map((t) => (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60">
                        <input
                          type="checkbox"
                          className="size-4 accent-foreground"
                          checked={memberIds.includes(t.id) || String(t.id) === seedToolId}
                          disabled={String(t.id) === seedToolId}
                          onChange={() => toggleMember(t.id)}
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
            <p className="text-xs text-muted-foreground">
              Selected: {new Set([...(seedToolId ? [Number(seedToolId)] : []), ...memberIds]).size}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={Boolean(editPool)}
        onOpenChange={(open) => {
          if (!open) setEditPool(null);
        }}
        title={editPool ? `Edit · ${editPool.name}` : 'Edit group'}
        description="Rename this tool group. Members and cookie stay the same."
      >
        <form className="flex flex-col gap-4" onSubmit={onSaveEdit}>
          <div className="flex flex-col gap-2">
            <Label>Group name</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {editPool ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void deleteOne(editPool)}
              >
                <Trash2Icon data-icon="inline-start" className="size-3.5" />
                Delete group
              </Button>
            ) : null}
          </div>
        </form>
      </FormOverlay>
    </Shell>
  );
}
