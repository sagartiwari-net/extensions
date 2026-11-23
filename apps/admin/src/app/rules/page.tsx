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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';

type Reseller = { id: number; slug: string; name: string };
type Summary = {
  rule_groups: number;
  css: number;
  redirect: number;
  block: number;
  overlay: number;
  text: number;
};
type RuleGroup = {
  id: number;
  name: string;
  url_pattern: string;
  is_active: number;
};
type CssRule = {
  id: number;
  group_id: number;
  group_name: string | null;
  selector: string;
  action: 'hide' | 'replace' | 'custom';
  value: string | null;
  is_active: number;
};
type Block = {
  id: number;
  url_pattern: string;
  action: string;
  redirect_url: string | null;
  is_active: number;
};
type Redirect = {
  id: number;
  source_url: string;
  destination_url: string;
  description: string | null;
  is_active: number;
};

type OverlayKind = 'group' | 'css' | 'block' | 'redirect' | 'clone' | null;

const INCLUDE_OPTS = [
  { key: 'rule_groups', label: 'Rule groups' },
  { key: 'css', label: 'CSS' },
  { key: 'redirect', label: 'Redirects' },
  { key: 'block', label: 'Block URLs' },
  { key: 'overlay', label: 'Overlays' },
  { key: 'text', label: 'Text replace' },
  { key: 'extension_allow', label: 'Extension allowlist' },
] as const;

export default function RulesPage() {
  const { user, loading } = useMe();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [resellerId, setResellerId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  const [cssRules, setCssRules] = useState<CssRule[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('groups');
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [gName, setGName] = useState('');
  const [gPattern, setGPattern] = useState('');
  const [gActive, setGActive] = useState(true);

  const [cGroupId, setCGroupId] = useState('');
  const [cSelector, setCSelector] = useState('');
  const [cAction, setCAction] = useState<'hide' | 'replace' | 'custom'>('hide');
  const [cValue, setCValue] = useState('');
  const [cActive, setCActive] = useState(true);

  const [bPattern, setBPattern] = useState('');
  const [bAction, setBAction] = useState<'blank' | 'redirect'>('blank');
  const [bRedirect, setBRedirect] = useState('');
  const [bActive, setBActive] = useState(true);

  const [rSource, setRSource] = useState('');
  const [rDest, setRDest] = useState('');
  const [rDesc, setRDesc] = useState('');
  const [rActive, setRActive] = useState(true);

  const [fromId, setFromId] = useState('');
  const [include, setInclude] = useState<string[]>(['css', 'redirect', 'block', 'rule_groups']);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  const load = useCallback(() => {
    if (!resellerId) return;
    setError('');
    Promise.all([
      api<{ summary: Summary }>(`/api/resellers/${resellerId}/rules-summary`),
      api<{ items: RuleGroup[] }>(`/api/resellers/${resellerId}/rule-groups`),
      api<{ items: CssRule[] }>(`/api/resellers/${resellerId}/css-rules`),
      api<{ items: Block[] }>(`/api/resellers/${resellerId}/block-urls`),
      api<{ items: Redirect[] }>(`/api/resellers/${resellerId}/redirects`),
    ])
      .then(([s, g, c, b, r]) => {
        setSummary(s.summary);
        setGroups(g.items);
        setCssRules(c.items);
        setBlocks(b.items);
        setRedirects(r.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [resellerId]);

  useEffect(() => {
    if (!user) return;
    api<{ items: Reseller[] }>('/api/resellers')
      .then((r) => {
        setResellers(r.items);
        setResellerId((cur) => cur || (r.items[0] ? String(r.items[0].id) : ''));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [user]);

  useEffect(() => {
    if (user && resellerId) load();
  }, [user, resellerId, load]);

  function closeForm() {
    setOverlay(null);
    setEditingId(null);
  }

  function openAdd(kind: Exclude<OverlayKind, 'clone' | null>) {
    setEditingId(null);
    setError('');
    if (kind === 'group') {
      setGName('');
      setGPattern('');
      setGActive(true);
    } else if (kind === 'css') {
      setCGroupId(groups[0] ? String(groups[0].id) : '');
      setCSelector('');
      setCAction('hide');
      setCValue('');
      setCActive(true);
    } else if (kind === 'block') {
      setBPattern('');
      setBAction('blank');
      setBRedirect('');
      setBActive(true);
    } else if (kind === 'redirect') {
      setRSource('');
      setRDest('');
      setRDesc('');
      setRActive(true);
    }
    setOverlay(kind);
  }

  function openEditGroup(g: RuleGroup) {
    setEditingId(g.id);
    setGName(g.name);
    setGPattern(g.url_pattern);
    setGActive(Boolean(g.is_active));
    setOverlay('group');
  }

  function openEditCss(c: CssRule) {
    setEditingId(c.id);
    setCGroupId(String(c.group_id));
    setCSelector(c.selector);
    setCAction(c.action);
    setCValue(c.value || '');
    setCActive(Boolean(c.is_active));
    setOverlay('css');
  }

  function openEditBlock(b: Block) {
    setEditingId(b.id);
    setBPattern(b.url_pattern);
    setBAction(b.action === 'redirect' ? 'redirect' : 'blank');
    setBRedirect(b.redirect_url || '');
    setBActive(Boolean(b.is_active));
    setOverlay('block');
  }

  function openEditRedirect(r: Redirect) {
    setEditingId(r.id);
    setRSource(r.source_url);
    setRDest(r.destination_url);
    setRDesc(r.description || '');
    setRActive(Boolean(r.is_active));
    setOverlay('redirect');
  }

  async function saveGroup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { name: gName, url_pattern: gPattern, is_active: gActive };
      if (editingId) {
        await api(`/api/resellers/${resellerId}/rule-groups/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage('Rule group updated');
      } else {
        await api(`/api/resellers/${resellerId}/rule-groups`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setMessage('Rule group added');
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveCss(e: FormEvent) {
    e.preventDefault();
    if (!cGroupId) {
      setError('CSS rules need a rule group — create one first');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        group_id: Number(cGroupId),
        selector: cSelector,
        action: cAction,
        value: cValue || null,
        is_active: cActive,
      };
      if (editingId) {
        await api(`/api/resellers/${resellerId}/css-rules/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage('CSS rule updated');
      } else {
        await api(`/api/resellers/${resellerId}/css-rules`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setMessage('CSS rule added');
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveBlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        url_pattern: bPattern,
        action: bAction,
        redirect_url: bAction === 'redirect' ? bRedirect || null : null,
        is_active: bActive,
      };
      if (editingId) {
        await api(`/api/resellers/${resellerId}/block-urls/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage('Block URL updated');
      } else {
        await api(`/api/resellers/${resellerId}/block-urls`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setMessage('Block URL added');
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveRedirect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        source_url: rSource,
        destination_url: rDest,
        description: rDesc || null,
        is_active: rActive,
      };
      if (editingId) {
        await api(`/api/resellers/${resellerId}/redirects/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage('Redirect updated');
      } else {
        await api(`/api/resellers/${resellerId}/redirects`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setMessage('Redirect added');
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(kind: 'group' | 'css' | 'block' | 'redirect', id: number, label: string) {
    if (!window.confirm(`Delete ${label}?`)) return;
    setBusy(true);
    setError('');
    try {
      const path =
        kind === 'group'
          ? `rule-groups/${id}`
          : kind === 'css'
            ? `css-rules/${id}`
            : kind === 'block'
              ? `block-urls/${id}`
              : `redirects/${id}`;
      await api(`/api/resellers/${resellerId}/${path}`, { method: 'DELETE' });
      setMessage('Deleted');
      if (editingId === id) closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function cloneRules(e: FormEvent) {
    e.preventDefault();
    if (!fromId || !resellerId) return;
    if (mode === 'replace' && !window.confirm('Replace selected rule types on target?')) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await api<{ created: Record<string, number> }>(
        `/api/resellers/${resellerId}/clone-rules`,
        {
          method: 'POST',
          body: JSON.stringify({ from_reseller_id: Number(fromId), include, mode }),
        },
      );
      const parts = Object.entries(res.created)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      setMessage(`Copied. Edits stay separate. (${parts || 'nothing'})`);
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed');
    } finally {
      setBusy(false);
    }
  }

  const addLabel =
    tab === 'css'
      ? 'Add CSS'
      : tab === 'blocks'
        ? 'Add block'
        : tab === 'redirects'
          ? 'Add redirect'
          : 'Add group';

  const groupCols: DataColumn<RuleGroup>[] = [
    { id: 'name', header: 'Name', cell: (g) => g.name, sortValue: (g) => g.name },
    {
      id: 'pattern',
      header: 'Pattern',
      cell: (g) => <span className="text-muted-foreground">{g.url_pattern}</span>,
      sortValue: (g) => g.url_pattern,
    },
    {
      id: 'active',
      header: 'Active',
      cell: (g) => <StatusBadge status={g.is_active ? 'active' : 'off'} />,
      sortValue: (g) => g.is_active,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (g) => (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => openEditGroup(g)}>
            <PencilIcon data-icon="inline-start" className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void deleteRow('group', g.id, `group “${g.name}”`)}
          >
            <Trash2Icon data-icon="inline-start" className="size-3.5" />
            Del
          </Button>
        </div>
      ),
    },
  ];

  const cssCols: DataColumn<CssRule>[] = [
    {
      id: 'group',
      header: 'Group',
      cell: (c) => c.group_name || `#${c.group_id}`,
      sortValue: (c) => c.group_name || '',
    },
    {
      id: 'selector',
      header: 'Selector',
      cell: (c) => <span className="font-mono text-xs">{c.selector}</span>,
      sortValue: (c) => c.selector,
    },
    { id: 'action', header: 'Action', cell: (c) => c.action, sortValue: (c) => c.action },
    {
      id: 'value',
      header: 'Value',
      cell: (c) => (
        <span className="line-clamp-1 max-w-[14rem] text-muted-foreground">{c.value || '—'}</span>
      ),
      sortValue: (c) => c.value || '',
    },
    {
      id: 'active',
      header: 'Active',
      cell: (c) => <StatusBadge status={c.is_active ? 'active' : 'off'} />,
      sortValue: (c) => c.is_active,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => openEditCss(c)}>
            <PencilIcon data-icon="inline-start" className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void deleteRow('css', c.id, `CSS “${c.selector}”`)}
          >
            <Trash2Icon data-icon="inline-start" className="size-3.5" />
            Del
          </Button>
        </div>
      ),
    },
  ];

  const blockCols: DataColumn<Block>[] = [
    {
      id: 'pattern',
      header: 'Pattern',
      cell: (b) => b.url_pattern,
      sortValue: (b) => b.url_pattern,
    },
    { id: 'action', header: 'Action', cell: (b) => b.action, sortValue: (b) => b.action },
    {
      id: 'redirect',
      header: 'Redirect to',
      cell: (b) => (
        <span className="text-muted-foreground">{b.redirect_url || '—'}</span>
      ),
      sortValue: (b) => b.redirect_url || '',
    },
    {
      id: 'active',
      header: 'Active',
      cell: (b) => <StatusBadge status={b.is_active ? 'active' : 'off'} />,
      sortValue: (b) => b.is_active,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (b) => (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => openEditBlock(b)}>
            <PencilIcon data-icon="inline-start" className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void deleteRow('block', b.id, `block “${b.url_pattern}”`)}
          >
            <Trash2Icon data-icon="inline-start" className="size-3.5" />
            Del
          </Button>
        </div>
      ),
    },
  ];

  const redirectCols: DataColumn<Redirect>[] = [
    { id: 'from', header: 'From', cell: (r) => r.source_url, sortValue: (r) => r.source_url },
    {
      id: 'to',
      header: 'To',
      cell: (r) => <span className="text-muted-foreground">{r.destination_url}</span>,
      sortValue: (r) => r.destination_url,
    },
    {
      id: 'desc',
      header: 'Note',
      cell: (r) => <span className="text-muted-foreground">{r.description || '—'}</span>,
      sortValue: (r) => r.description || '',
    },
    {
      id: 'active',
      header: 'Active',
      cell: (r) => <StatusBadge status={r.is_active ? 'active' : 'off'} />,
      sortValue: (r) => r.is_active,
    },
    {
      id: 'actions',
      header: 'Actions',
      className: 'w-44',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => openEditRedirect(r)}>
            <PencilIcon data-icon="inline-start" className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void deleteRow('redirect', r.id, `redirect “${r.source_url}”`)}
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
        title="Rules"
        description="Personal CSS / redirect / block per reseller. Copy is one-shot — never live-share."
        action={
          <div className="flex flex-wrap gap-2">
            {user.role === 'master' ? (
              <Button variant="outline" onClick={() => setOverlay('clone')}>
                Copy rules
              </Button>
            ) : null}
            <Button
              onClick={() =>
                openAdd(
                  tab === 'css'
                    ? 'css'
                    : tab === 'blocks'
                      ? 'block'
                      : tab === 'redirects'
                        ? 'redirect'
                        : 'group',
                )
              }
            >
              <PlusIcon data-icon="inline-start" />
              {addLabel}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Groups</CardDescription>
            <CardTitle className="text-base">{summary?.rule_groups ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>CSS</CardDescription>
            <CardTitle className="text-base">{summary?.css ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Blocks</CardDescription>
            <CardTitle className="text-base">{summary?.block ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardDescription>Redirects</CardDescription>
            <CardTitle className="text-base">{summary?.redirect ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <ListFilters
        query={query}
        onQuery={setQuery}
        searchId="rules-search"
        placeholder="Filter current tab"
      >
        <div className="flex flex-col gap-2 md:w-56">
          <Label htmlFor="rules-reseller">Reseller</Label>
          <select
            id="rules-reseller"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={resellerId}
            onChange={(e) => setResellerId(e.target.value)}
          >
            {resellers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.slug})
              </option>
            ))}
          </select>
        </div>
      </ListFilters>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error && !overlay ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="groups">Rule groups</TabsTrigger>
          <TabsTrigger value="css">CSS</TabsTrigger>
          <TabsTrigger value="blocks">Block URLs</TabsTrigger>
          <TabsTrigger value="redirects">Redirects</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="mt-4">
          <DataTable
            rows={groups}
            columns={groupCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No groups"
            emptyDescription="Add a group first — CSS rules attach to a group."
          />
        </TabsContent>

        <TabsContent value="css" className="mt-4">
          <DataTable
            rows={cssRules}
            columns={cssCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No CSS rules"
            emptyDescription="Create a rule group, then add hide/replace/custom CSS."
          />
        </TabsContent>

        <TabsContent value="blocks" className="mt-4">
          <DataTable
            rows={blocks}
            columns={blockCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No blocks"
            emptyDescription="Nothing blocked yet."
          />
        </TabsContent>

        <TabsContent value="redirects" className="mt-4">
          <DataTable
            rows={redirects}
            columns={redirectCols}
            rowKey={(r) => r.id}
            globalFilter={query}
            emptyTitle="No redirects"
            emptyDescription="Nothing redirected yet."
          />
        </TabsContent>
      </Tabs>

      <FormOverlay
        open={overlay === 'group'}
        onOpenChange={(o) => !o && closeForm()}
        title={editingId ? 'Edit rule group' : 'Add rule group'}
        description="URL scope for CSS and related rules."
      >
        <form className="flex flex-col gap-4" onSubmit={saveGroup}>
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input value={gName} onChange={(e) => setGName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>URL pattern</Label>
            <Input
              value={gPattern}
              onChange={(e) => setGPattern(e.target.value)}
              placeholder="*://*.example.com/*"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={gActive}
              onChange={(e) => setGActive(e.target.checked)}
            />
            Active
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Save' : 'Add group'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={overlay === 'css'}
        onOpenChange={(o) => !o && closeForm()}
        title={editingId ? 'Edit CSS rule' : 'Add CSS rule'}
        description="Hide / replace / custom CSS under a rule group."
        className="sm:max-w-xl"
      >
        <form className="flex flex-col gap-4" onSubmit={saveCss}>
          <div className="flex flex-col gap-2">
            <Label>Rule group</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={cGroupId}
              onChange={(e) => setCGroupId(e.target.value)}
              required
            >
              <option value="">Select group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.url_pattern})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Selector</Label>
            <Input
              value={cSelector}
              onChange={(e) => setCSelector(e.target.value)}
              placeholder="#mp-hero-header or .mp-hero__title"
              required
            />
            <p className="text-xs text-muted-foreground">
              Use a real CSS selector (e.g. <code>#id</code> / <code>.class</code>). Pasted HTML
              auto-extracts <code>#id</code>.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Action</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={cAction}
              onChange={(e) => setCAction(e.target.value as 'hide' | 'replace' | 'custom')}
            >
              <option value="hide">hide</option>
              <option value="replace">replace</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Value (optional)</Label>
            <Textarea
              value={cValue}
              onChange={(e) => setCValue(e.target.value)}
              placeholder="CSS or replacement HTML"
              className="min-h-24 font-mono text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={cActive}
              onChange={(e) => setCActive(e.target.checked)}
            />
            Active
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || groups.length === 0}>
            {busy ? 'Saving…' : editingId ? 'Save' : 'Add CSS'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={overlay === 'block'}
        onOpenChange={(o) => !o && closeForm()}
        title={editingId ? 'Edit block URL' : 'Add block URL'}
        description="Soft-block pattern for this reseller."
      >
        <form className="flex flex-col gap-4" onSubmit={saveBlock}>
          <div className="flex flex-col gap-2">
            <Label>Pattern</Label>
            <Input value={bPattern} onChange={(e) => setBPattern(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Action</Label>
            <select
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
              value={bAction}
              onChange={(e) => setBAction(e.target.value as 'blank' | 'redirect')}
            >
              <option value="blank">blank</option>
              <option value="redirect">redirect</option>
            </select>
          </div>
          {bAction === 'redirect' ? (
            <div className="flex flex-col gap-2">
              <Label>Redirect URL</Label>
              <Input value={bRedirect} onChange={(e) => setBRedirect(e.target.value)} required />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={bActive}
              onChange={(e) => setBActive(e.target.checked)}
            />
            Active
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Save' : 'Add block'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={overlay === 'redirect'}
        onOpenChange={(o) => !o && closeForm()}
        title={editingId ? 'Edit redirect' : 'Add redirect'}
        description="Source → destination mapping."
      >
        <form className="flex flex-col gap-4" onSubmit={saveRedirect}>
          <div className="flex flex-col gap-2">
            <Label>Source</Label>
            <Input value={rSource} onChange={(e) => setRSource(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Destination</Label>
            <Input value={rDest} onChange={(e) => setRDest(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Note (optional)</Label>
            <Input value={rDesc} onChange={(e) => setRDesc(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={rActive}
              onChange={(e) => setRActive(e.target.checked)}
            />
            Active
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Save' : 'Add redirect'}
          </Button>
        </form>
      </FormOverlay>

      {user.role === 'master' ? (
        <FormOverlay
          open={overlay === 'clone'}
          onOpenChange={(o) => !o && closeForm()}
          title="Copy rules from…"
          description="One-shot copy into the selected reseller. Edits stay separate."
          className="sm:max-w-xl"
        >
          <form className="flex flex-col gap-4" onSubmit={cloneRules}>
            <div className="flex flex-col gap-2">
              <Label>Source reseller</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {resellers
                  .filter((r) => String(r.id) !== resellerId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.slug})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              {INCLUDE_OPTS.map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={include.includes(o.key)}
                    onChange={() =>
                      setInclude((prev) =>
                        prev.includes(o.key) ? prev.filter((x) => x !== o.key) : [...prev, o.key],
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Mode</Label>
              <select
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
              >
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
              </select>
            </div>
            <Button type="submit" disabled={busy || !fromId || include.length === 0}>
              Copy rules
            </Button>
          </form>
        </FormOverlay>
      ) : null}
    </Shell>
  );
}
