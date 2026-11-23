'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';

export function UsernameLink({
  username,
  className,
}: {
  username: string | null | undefined;
  className?: string;
}) {
  const u = String(username || '').trim();
  if (!u || u === 'not available') {
    return <span className={cn('text-muted-foreground', className)}>{u || '—'}</span>;
  }
  return (
    <Link
      href={`/security/users/${encodeURIComponent(u)}`}
      className={cn('font-medium text-foreground underline-offset-4 hover:underline', className)}
    >
      {u}
    </Link>
  );
}

export function IpLink({
  ip,
  className,
}: {
  ip: string | null | undefined;
  className?: string;
}) {
  const v = String(ip || '').trim();
  if (!v) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <Link
      href={`/security/ips/${encodeURIComponent(v)}`}
      className={cn('font-mono text-xs underline-offset-4 hover:underline', className)}
    >
      {v}
    </Link>
  );
}
