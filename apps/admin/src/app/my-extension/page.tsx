'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DownloadIcon, RefreshCwIcon, SaveIcon } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { API_BASE, api, apiDownload, saveBlob } from '@/lib/api';

type Reseller = { id: number; slug: string; name: string };

type Brand = {
  reseller_id: number;
  slug: string;
  name: string;
  description: string;
  member_domain: string;
  membership_home: string;
  version: string;
  last_generated_at: string | null;
  has_icon: boolean;
  has_zip: boolean;
  zip_name: string | null;
};

export default function MyExtensionPage() {
  const { user, loading } = useMe();
  const isMaster = user?.role === 'master';
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [resellerId, setResellerId] = useState('');
  const [brand, setBrand] = useState<Brand | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberDomain, setMemberDomain] = useState('');
  const [membershipHome, setMembershipHome] = useState('');
  const [iconData, setIconData] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadResellers = useCallback(() => {
    if (!user) return;
    api<{ items: Reseller[] }>('/api/resellers')
      .then((r) => {
        setResellers(r.items);
        setResellerId((cur) => {
          if (cur) return cur;
          if (user.role === 'reseller' && user.reseller_id) return String(user.reseller_id);
          return r.items[0] ? String(r.items[0].id) : '';
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [user]);

  const loadBrand = useCallback(() => {
    if (!resellerId) return;
    setError('');
    api<{ item: Brand }>(`/api/resellers/${resellerId}/extension-branding`)
      .then(async (r) => {
        setBrand(r.item);
        setName(r.item.name);
        setDescription(r.item.description);
        setMemberDomain(r.item.member_domain || '');
        setMembershipHome(r.item.membership_home || '');
        setIconData(null);
        setIconPreview((prev) => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
          return null;
        });
        if (!r.item.has_icon) return;
        // Credentials fetch — bare <img src> drops cookies on cross-origin API
        try {
          const res = await fetch(
            `${API_BASE}/api/resellers/${resellerId}/extension-branding/icon?t=${Date.now()}`,
            { credentials: 'include' },
          );
          if (!res.ok) return;
          const blob = await res.blob();
          setIconPreview(URL.createObjectURL(blob));
        } catch {
          /* preview optional */
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [resellerId]);

  useEffect(() => {
    if (user) loadResellers();
  }, [user, loadResellers]);

  useEffect(() => {
    if (resellerId) loadBrand();
  }, [resellerId, loadBrand]);

  function onIconFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Icon must be an image (PNG/JPG/WEBP)');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Icon must be under 3MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      setIconData(data);
      setIconPreview(data);
    };
    reader.readAsDataURL(file);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!resellerId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/resellers/${resellerId}/extension-branding`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          description,
          member_domain: memberDomain,
          membership_home: membershipHome,
          icon_base64: iconData || undefined,
        }),
      });
      setMessage('Branding saved. Generate ZIP to apply name/icon/hashes.');
      setIconData(null);
      loadBrand();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    if (!resellerId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Persist latest form first
      await api(`/api/resellers/${resellerId}/extension-branding`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          description,
          member_domain: memberDomain,
          membership_home: membershipHome,
          icon_base64: iconData || undefined,
        }),
      });
      const { blob, filename } = await apiDownload(
        `/api/resellers/${resellerId}/generate-extension`,
        {
          method: 'POST',
          fallbackName: brand?.slug
            ? `${brand.slug}-extension.zip`
            : 'extension.zip',
        },
      );
      saveBlob(blob, filename);
      setMessage(
        `Downloaded ${filename}. Live file hashes saved on server (not in ZIP) — remove old install, then Load unpacked.`,
      );
      setIconData(null);
      loadBrand();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRedownload() {
    if (!resellerId) return;
    setBusy(true);
    setError('');
    try {
      const { blob, filename } = await apiDownload(
        `/api/resellers/${resellerId}/generate-extension`,
        {
          fallbackName: brand?.slug
            ? `${brand.slug}-extension.zip`
            : 'extension.zip',
        },
      );
      saveBlob(blob, filename);
      setMessage(`Re-downloaded ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
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
        title="My extension"
        description="Set name, icon, member site, and description — then download a branded ZIP. API / panel connection is fixed by the server."
        action={
          <Button variant="outline" onClick={loadBrand} disabled={!resellerId || busy}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      {isMaster ? (
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="ext-reseller">Reseller</Label>
          <select
            id="ext-reseller"
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
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
          <CardDescription>
            {brand
              ? `Slug ${brand.slug} · v${brand.version}${
                  brand.last_generated_at
                    ? ` · last build ${new Date(brand.last_generated_at).toLocaleString()}`
                    : ''
                }`
              : 'Load a reseller to edit branding'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void onSave(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ext-name">Extension name</Label>
                <Input
                  id="ext-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={75}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ext-desc">Description</Label>
                <Textarea
                  id="ext-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={132}
                  rows={2}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ext-member">Member domain (aMember)</Label>
                <Input
                  id="ext-member"
                  placeholder="members.example.com"
                  value={memberDomain}
                  onChange={(e) => setMemberDomain(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ext-home">Membership home URL</Label>
                <Input
                  id="ext-home"
                  placeholder="https://members.example.com/"
                  value={membershipHome}
                  onChange={(e) => setMembershipHome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ext-icon">Icon (PNG/JPG/WEBP)</Label>
                <div className="flex items-center gap-3">
                  {iconPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={iconPreview}
                      alt="Extension icon preview"
                      className="size-14 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                      No icon
                    </div>
                  )}
                  <Input
                    id="ext-icon"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => onIconFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={busy || !resellerId}>
                <SaveIcon data-icon="inline-start" />
                Save branding
              </Button>
              <Button type="button" disabled={busy || !resellerId} onClick={() => void onGenerate()}>
                <DownloadIcon data-icon="inline-start" />
                Save & download ZIP
              </Button>
              {brand?.has_zip ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void onRedownload()}
                >
                  Re-download last ZIP
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
