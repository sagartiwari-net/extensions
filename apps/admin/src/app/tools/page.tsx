'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Reseller = { id: number; slug: string; name: string; key_prefix?: string };

function siteKeyFromFull(full: string, prefix?: string) {
  let key = String(full || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = String(prefix || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (p && key.startsWith(p)) key = key.slice(p.length);
  return key;
}
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
  cookie_formats?: string[];
  has_cookie: number;
  pool_id: number | null;
};

type PoolOpt = { id: number; name: string; member_count: number };

type ToolForm = {
  reseller_id: string;
  tool_key: string;
  name: string;
  web_url: string;
  inject_strategy: string;
  cookie_jar_mode: string;
  status: string;
  pool_id: string;
  cookie_plain: string;
};

const sampleCookie = JSON.stringify(
  {
    cookies: [
      {
        name: 'demo_session',
        value: 'phase1-test',
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'lax',
      },
    ],
    localStorage: {},
    sessionStorage: {},
  },
  null,
  2,
);

const emptyForm = (resellerId = ''): ToolForm => ({
  reseller_id: resellerId,
  tool_key: '',
  name: '',
  web_url: 'https://example.com/',
  inject_strategy: 'cookies',
  cookie_jar_mode: 'auto',
  status: 'active',
  pool_id: '',
  cookie_plain: sampleCookie,
});

export default function ToolsPage() {
  const { user, loading } = useMe();
  const [items, setItems] = useState<Tool[]>([]);
  const [total, setTotal] = useState(0);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [pools, setPools] = useState<PoolOpt[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [resellerFilter, setResellerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Array<string | number>>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editTool, setEditTool] = useState<Tool | null>(null);
  const [form, setForm] = useState<ToolForm>(emptyForm());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedQuery, resellerFilter, statusFilter]);

  const loadResellers = useCallback(() => {
    if (!user) return;
    const tasks: Promise<unknown>[] = [api<{ items: Reseller[] }>('/api/resellers')];
    if (user.role === 'master') {
      tasks.push(api<{ items: PoolOpt[] }>('/api/cookie-pools'));
    }
    Promise.all(tasks)
      .then((results) => {
        const r = results[0] as { items: Reseller[] };
        setResellers(r.items);
        if (user.role === 'master' && results[1]) {
          setPools((results[1] as { items: PoolOpt[] }).items);
        } else {
          setPools([]);
        }
        const preferred =
          r.items.find((x) => x.slug === 'toolsmandi') || r.items[0];
        setForm((f) => ({
          ...f,
          reseller_id: f.reseller_id || (preferred ? String(preferred.id) : ''),
        }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [user]);

  const loadTools = useCallback(() => {
    setListLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String(pageIndex * pageSize));
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (resellerFilter !== 'all') params.set('reseller_id', resellerFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    api<{ items: Tool[]; total: number }>(`/api/tools?${params}`)
      .then((t) => {
        setItems(t.items);
        setTotal(t.total ?? t.items.length);
        setSelectedKeys([]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setListLoading(false));
  }, [pageIndex, pageSize, debouncedQuery, resellerFilter, statusFilter]);

  useEffect(() => {
    if (user) loadResellers();
  }, [user, loadResellers]);

  useEffect(() => {
    if (user) loadTools();
  }, [user, loadTools]);

  const selectedIds = useMemo(
    () => selectedKeys.map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0),
    [selectedKeys],
  );

  function openCreate() {
    setError('');
    setMessage('');
    const preferred =
      resellers.find((x) => x.slug === 'toolsmandi') || resellers[0];
    setForm(emptyForm(preferred ? String(preferred.id) : ''));
    setShowCreate(true);
  }

  function openEdit(tool: Tool) {
    setError('');
    setMessage('');
    setEditTool(tool);
    const rs = resellers.find((r) => r.id === tool.reseller_id);
    setForm({
      reseller_id: String(tool.reseller_id),
      tool_key: siteKeyFromFull(tool.tool_key, rs?.key_prefix),
      name: tool.name,
      web_url: tool.web_url,
      inject_strategy: tool.inject_strategy || 'cookies',
      cookie_jar_mode:
        tool.cookie_jar_mode === 'browser' || tool.cookie_jar_mode === 'extension_only'
          ? tool.cookie_jar_mode
          : 'auto',
      status: tool.status || 'active',
      pool_id: tool.pool_id ? String(tool.pool_id) : '',
      cookie_plain: '',
    });
  }

  const formReseller = useMemo(
    () => resellers.find((r) => String(r.id) === form.reseller_id),
    [resellers, form.reseller_id],
  );
  const keyPrefix = formReseller?.key_prefix || '';

  async function syncToolPool(toolId: number, prevPoolId: number | null, nextPoolId: string) {
    if (user?.role !== 'master') return;
    const next = nextPoolId ? Number(nextPoolId) : null;
    const prev = prevPoolId || null;
    if (next === prev) return;
    if (prev && prev !== next) {
      await api(`/api/cookie-pools/${prev}/members/${toolId}`, { method: 'DELETE' });
    }
    if (next) {
      await api(`/api/cookie-pools/${next}/members`, {
        method: 'POST',
        body: JSON.stringify({ tool_id: toolId }),
      });
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/api/tools', {
        method: 'POST',
        body: JSON.stringify({
          reseller_id: Number(form.reseller_id),
          tool_key: form.tool_key,
          name: form.name,
          web_url: form.web_url,
          cookie_jar_mode: form.cookie_jar_mode || 'auto',
          status: form.status,
          cookie_plain: form.cookie_plain?.trim() || undefined,
        }),
      });
      setShowCreate(false);
      setMessage('Tool created');
      loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editTool) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        tool_key: form.tool_key,
        name: form.name,
        web_url: form.web_url,
        cookie_jar_mode: form.cookie_jar_mode || 'auto',
        status: form.status,
      };
      if (form.cookie_plain.trim()) {
        body.cookie_plain = form.cookie_plain.trim();
      }
      await api(`/api/tools/${editTool.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await syncToolPool(editTool.id, editTool.pool_id, form.pool_id);
      setEditTool(null);
      setMessage(form.cookie_plain.trim() ? 'Tool + cookie + group updated' : 'Tool updated');
      loadResellers();
      loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(tool: Tool) {
    if (!window.confirm(`Delete “${tool.name}”? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/tools/${tool.id}`, { method: 'DELETE' });
      setMessage(`Deleted ${tool.name}`);
      if (editTool?.id === tool.id) setEditTool(null);
      loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function bulkAction(action: 'delete' | 'set_status', status?: string) {
    if (!selectedIds.length) return;
    if (action === 'delete') {
      if (
        !window.confirm(
          `Delete ${selectedIds.length} selected tool${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
        )
      ) {
        return;
      }
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ done: number }>('/api/tools/bulk', {
        method: 'POST',
        body: JSON.stringify({
          ids: selectedIds,
          action,
          status: action === 'set_status' ? status : undefined,
        }),
      });
      setMessage(
        action === 'delete'
          ? `Deleted ${res.done} tool${res.done === 1 ? '' : 's'}`
          : `Updated status on ${res.done} tool${res.done === 1 ? '' : 's'}`,
      );
      setSelectedKeys([]);
      loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<Tool>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/tools/${row.id}`}>
          {row.name}
        </Link>
      ),
      sortValue: (row) => row.name,
    },
    {
      id: 'reseller',
      header: 'Reseller',
      cell: (row) => row.reseller_slug,
      sortValue: (row) => row.reseller_slug,
    },
    {
      id: 'key',
      header: 'Key',
      cell: (row) => <span className="text-muted-foreground">{row.tool_key}</span>,
      sortValue: (row) => row.tool_key,
    },
    {
      id: 'formats',
      header: 'Vault',
      cell: (row) =>
        Array.isArray(row.cookie_formats) && row.cookie_formats.length
          ? row.cookie_formats.join('+')
          : row.inject_strategy || '—',
      sortValue: (row) =>
        Array.isArray(row.cookie_formats) ? row.cookie_formats.join('+') : row.inject_strategy,
    },
    {
      id: 'jar',
      header: 'Browser jar',
      cell: (row) => row.cookie_jar_mode || 'auto',
      sortValue: (row) => row.cookie_jar_mode || 'auto',
    },
    {
      id: 'cookie',
      header: 'Cookie',
      cell: (row) => (row.has_cookie ? 'yes' : 'no'),
      sortValue: (row) => (row.has_cookie ? 1 : 0),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
      sortValue: (row) => row.status,
    },
    {
      id: 'pool',
      header: 'Group',
      cell: (row) =>
        row.pool_id ? (
          <Link
            className="text-sm underline-offset-4 hover:underline"
            href={`/pools/${row.pool_id}`}
          >
            #{row.pool_id}
            {pools.find((p) => p.id === row.pool_id)
              ? ` · ${pools.find((p) => p.id === row.pool_id)!.name}`
              : ''}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      sortValue: (row) => row.pool_id || 0,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-40',
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
            onClick={(e) => {
              e.preventDefault();
              void deleteOne(row);
            }}
            disabled={busy}
          >
            <Trash2Icon data-icon="inline-start" className="size-3.5" />
            Del
          </Button>
        </div>
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function toolFields(mode: 'create' | 'edit') {
    const isMaster = user?.role === 'master';
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'create' ? (
            <div className="flex flex-col gap-2">
              <Label>Reseller</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={form.reseller_id}
                onChange={(e) => setForm({ ...form, reseller_id: e.target.value })}
                required
                disabled={!isMaster}
              >
                <option value="">Select…</option>
                {resellers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.slug}) · {r.key_prefix}
                  </option>
                ))}
              </select>
              {isMaster ? (
                <p className="text-xs text-muted-foreground">
                  Default: ToolsMandi. Master later copy/assign to others.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Reseller</Label>
              <Input value={editTool?.reseller_slug || ''} disabled />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label>Tool key (site code)</Label>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-8 shrink-0 items-center rounded-lg border border-input bg-muted px-2.5 font-mono text-xs">
                {keyPrefix || '??'}
              </span>
              <Input
                value={form.tool_key}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tool_key: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''),
                  })
                }
                placeholder="spyfu"
                required
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saved as <code>{keyPrefix || '?'}{form.tool_key || '…'}</code>
              {' '}(duplicate → auto 1, 2, 3).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Semrush"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Save cookies in browser</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={
                form.cookie_jar_mode === 'browser' || form.cookie_jar_mode === 'extension_only'
                  ? form.cookie_jar_mode
                  : 'auto'
              }
              onChange={(e) => setForm({ ...form, cookie_jar_mode: e.target.value })}
            >
              <option value="auto">Auto — detect (Grammarly/Canva → jar, ChatGPT → extension)</option>
              <option value="browser">Yes — browser jar (clear when extension off)</option>
              <option value="extension_only">No — extension only (DNR header; no jar leak)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Vault paste auto-detects cookies / localStorage / sessionStorage / IndexedDB and
              injects whatever is present (can be multiple). This toggle only controls where HTTP
              cookies live (Chrome jar vs extension DNR).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Status</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">active</option>
              <option value="updating">updating</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          {isMaster ? (
            <div className="flex flex-col gap-2">
              <Label>Pool / group (master only)</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={form.pool_id}
                onChange={(e) => setForm({ ...form, pool_id: e.target.value })}
                disabled={mode === 'create'}
              >
                <option value="">None — standalone cookie</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} · {p.name} ({p.member_count})
                  </option>
                ))}
              </select>
              {mode === 'create' ? (
                <p className="text-xs text-muted-foreground">
                  Save first, then Edit — or{' '}
                  <Link className="underline" href="/pools">
                    Tool groups
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Shared cookie across linked tools.
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label>Web URL</Label>
          <Input
            value={form.web_url}
            onChange={(e) => setForm({ ...form, web_url: e.target.value })}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>
            Login cookie vault{' '}
            {mode === 'edit' ? '(optional — paste to replace)' : '(optional)'}
          </Label>
          <Textarea
            value={form.cookie_plain}
            onChange={(e) => setForm({ ...form, cookie_plain: e.target.value })}
            className="h-40 max-h-52 min-h-40 overflow-auto font-mono text-xs leading-relaxed"
            placeholder={
              mode === 'edit'
                ? 'Leave empty to keep existing cookie. Paste Cookie-Editor JSON to update.'
                : 'Paste Cookie-Editor / export JSON'
            }
          />
          <p className="text-xs text-muted-foreground">
            Account login cookies stored encrypted. Needed so the extension can open the tool
            logged-in.
          </p>
          {mode === 'edit' && editTool ? (
            <p className="text-xs text-muted-foreground">
              Current vault: {editTool.has_cookie ? 'on file' : 'missing'}.
            </p>
          ) : null}
        </div>
      </>
    );
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
        title="Tools"
        description="Add, edit, delete, and bulk-manage tools — including cookie vault updates."
        action={
          <Button onClick={openCreate}>
            <PlusIcon data-icon="inline-start" />
            New tool
          </Button>
        }
      />

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="tools-search"
        placeholder="Name, key, or reseller"
      >
        <div className="flex flex-col gap-2 md:w-48">
          <Label htmlFor="tools-reseller">Reseller</Label>
          <select
            id="tools-reseller"
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
        <div className="flex flex-col gap-2 md:w-40">
          <Label htmlFor="tools-status">Status</Label>
          <select
            id="tools-status"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">active</option>
            <option value="updating">updating</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
      </ListFilters>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} tool{total === 1 ? '' : 's'}
        </p>
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void bulkAction('set_status', 'active')}
            >
              Set active
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void bulkAction('set_status', 'updating')}
            >
              Set updating
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void bulkAction('set_status', 'disabled')}
            >
              Set disabled
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void bulkAction('delete')}
            >
              <Trash2Icon data-icon="inline-start" className="size-3.5" />
              Delete selected
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedKeys([])}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      <FormOverlay
        open={showCreate}
        onOpenChange={setShowCreate}
        title="New tool"
        description="Create a tool and optionally paste cookie JSON into the vault."
        className="sm:max-w-2xl"
      >
        <form className="flex flex-col gap-4" onSubmit={onCreate}>
          {toolFields('create')}
          {error && showCreate ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || !resellers.length}>
            {busy ? 'Saving…' : 'Save tool'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={Boolean(editTool)}
        onOpenChange={(open) => {
          if (!open) setEditTool(null);
        }}
        title={editTool ? `Edit · ${editTool.name}` : 'Edit tool'}
        description="Update basics or paste new cookie JSON to replace the vault (pool sync applies if linked)."
        className="sm:max-w-2xl"
      >
        <form className="flex flex-col gap-4" onSubmit={onSaveEdit}>
          {toolFields('edit')}
          {error && editTool ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {editTool ? (
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/tools/${editTool.id}`} />}
              >
                Open detail
              </Button>
            ) : null}
            {editTool ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void deleteOne(editTool)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </form>
      </FormOverlay>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error && !showCreate && !editTool ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={listLoading}
        emptyTitle="No tools yet"
        emptyDescription="Create a reseller first, then add a tool."
        pageSizeOptions={[10, 20, 50]}
        selectable
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        manualPagination={{
          pageIndex,
          pageSize,
          pageCount,
          onPageIndexChange: setPageIndex,
          onPageSizeChange: setPageSize,
        }}
      />
    </Shell>
  );
}
