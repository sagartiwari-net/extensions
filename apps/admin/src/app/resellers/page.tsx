'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';

import { DataTable, type DataColumn } from '@/components/data-table';
import { FormOverlay } from '@/components/form-overlay';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Reseller = {
  id: number;
  slug: string;
  name: string;
  key_prefix: string;
  is_active: number;
  tool_count: number;
  admin_username: string | null;
  member_domain?: string | null;
};

type FormState = {
  name: string;
  slug: string;
  key_prefix: string;
  member_domain: string;
  username: string;
  password: string;
  is_active: boolean;
};

const emptyForm = (): FormState => ({
  name: '',
  slug: '',
  key_prefix: '',
  member_domain: '',
  username: '',
  password: '',
  is_active: true,
});

export default function ResellersPage() {
  const { user, loading } = useMe();
  const [items, setItems] = useState<Reseller[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editRow, setEditRow] = useState<Reseller | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    api<{ success: boolean; items: Reseller[] }>('/api/resellers')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  function openCreate() {
    setForm(emptyForm());
    setError('');
    setShowCreate(true);
  }

  function openEdit(r: Reseller) {
    setEditRow(r);
    setForm({
      name: r.name,
      slug: r.slug,
      key_prefix: r.key_prefix || '',
      member_domain: r.member_domain || '',
      username: r.admin_username || r.slug,
      password: '',
      is_active: Boolean(r.is_active),
    });
    setError('');
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{
        item: { id: number; slug: string; member_secret?: string };
      }>('/api/resellers', {
        method: 'POST',
        body: JSON.stringify({
          slug: form.slug,
          name: form.name,
          key_prefix: form.key_prefix,
          member_domain: form.member_domain.trim() || undefined,
          password: form.password || undefined,
          username: form.username || form.slug || undefined,
        }),
      });
      setShowCreate(false);
      setForm(emptyForm());
      if (res.item.member_secret) {
        setMessage(
          `Created ${res.item.slug}. member_secret (aMember): ${res.item.member_secret} — copy now / reveal later from row actions.`,
        );
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function revealSecret(r: Reseller) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ item: { member_secret: string | null } }>(
        `/api/resellers/${r.id}/member-secret`,
      );
      if (!res.item.member_secret) {
        setMessage(`${r.slug}: no member_secret set`);
      } else {
        setMessage(`${r.slug} member_secret: ${res.item.member_secret}`);
        try {
          await navigator.clipboard.writeText(res.item.member_secret);
        } catch {
          /* clipboard optional */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reveal failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editRow) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/resellers/${editRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          key_prefix: form.key_prefix,
          member_domain: form.member_domain.trim() || '',
          is_active: form.is_active,
          username: form.username || undefined,
          password: form.password || undefined,
        }),
      });
      setEditRow(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(r: Reseller) {
    if (
      !window.confirm(
        `Delete reseller “${r.name}”? All its tools, rules, and login will be removed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/resellers/${r.id}`, { method: 'DELETE' });
      if (editRow?.id === r.id) setEditRow(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<Reseller>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
    {
      id: 'slug',
      header: 'Slug',
      cell: (r) => <span className="text-muted-foreground">{r.slug}</span>,
      sortValue: (r) => r.slug,
    },
    {
      id: 'prefix',
      header: 'Key prefix',
      cell: (r) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{r.key_prefix}</code>
      ),
      sortValue: (r) => r.key_prefix || '',
    },
    {
      id: 'login',
      header: 'Login',
      cell: (r) => (
        <span className="text-muted-foreground">{r.admin_username || '—'}</span>
      ),
      sortValue: (r) => r.admin_username || '',
    },
    {
      id: 'tools',
      header: 'Tools',
      cell: (r) => r.tool_count,
      sortValue: (r) => r.tool_count,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.is_active ? 'active' : 'disabled'} />,
      sortValue: (r) => r.is_active,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (r) =>
        user?.role === 'master' ? (
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => openEdit(r)}>
              <PencilIcon data-icon="inline-start" className="size-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void revealSecret(r)}
            >
              Secret
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void deleteOne(r)}
            >
              <Trash2Icon data-icon="inline-start" className="size-3.5" />
              Del
            </Button>
          </div>
        ) : null,
    },
  ];

  if (loading || !user) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (user.role !== 'master') {
    return (
      <Shell user={user}>
        <PageHeader title="Resellers" description="Only master admin manages resellers." />
        <p className="text-sm text-muted-foreground">You can only see your own catalog.</p>
      </Shell>
    );
  }

  function resellerFields(mode: 'create' | 'edit') {
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ToolsMandi"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Slug</Label>
            <Input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="toolsmandi"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tool key prefix</Label>
            <Input
              value={form.key_prefix}
              onChange={(e) =>
                setForm({
                  ...form,
                  key_prefix: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8),
                })
              }
              placeholder="tm"
              required
              maxLength={8}
            />
            <p className="text-xs text-muted-foreground">
              Tools get this automatically — e.g. <code>tmspyfu</code>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Login username</Label>
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={form.slug || 'username'}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Member domain (aMember)</Label>
            <Input
              value={form.member_domain}
              onChange={(e) => setForm({ ...form, member_domain: e.target.value })}
              placeholder="members.toolsmandi.com"
            />
            <p className="text-xs text-muted-foreground">
              Extension binds to this domain only — other resellers cannot use this pack. Local Access
              test still works via loopback admin URL.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>
              {mode === 'edit' ? 'New password (leave blank to keep)' : 'Password'}
            </Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="min 6 chars"
              required={mode === 'create'}
              minLength={mode === 'create' ? 6 : undefined}
            />
          </div>
          {mode === 'edit' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
            </label>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <Shell user={user}>
      <PageHeader
        title="Resellers"
        description="Master copies tools/rules to resellers. Prefix sticks to keys: tm + spyfu → tmspyfu."
        action={
          <Button onClick={openCreate}>
            <PlusIcon data-icon="inline-start" />
            New reseller
          </Button>
        }
      />

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="resellers-search"
        placeholder="Name or slug"
      />

      {error && !showCreate && !editRow ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs break-all">{message}</p>
      ) : null}

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(r) => r.id}
        globalFilter={query}
        emptyTitle="No resellers"
        emptyDescription="Create ToolsMandi, SeoGroupBuy, ToolWaly."
      />

      <FormOverlay
        open={showCreate}
        onOpenChange={setShowCreate}
        title="New reseller"
        description="Prefix is forced onto every tool key under this reseller."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={onCreate}>
          {resellerFields('create')}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={Boolean(editRow)}
        onOpenChange={(o) => !o && setEditRow(null)}
        title={editRow ? `Edit · ${editRow.name}` : 'Edit reseller'}
        description="Change name, prefix, login, or password."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={onSaveEdit}>
          {resellerFields('edit')}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {editRow ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void deleteOne(editRow)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </form>
      </FormOverlay>
    </Shell>
  );
}
