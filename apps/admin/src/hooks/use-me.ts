'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export type MeUser = { id: number; username: string; role: string; reseller_id: number | null };

export function useMe() {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ success: boolean; user?: MeUser }>('/api/auth/me')
      .then((m) => {
        if (!m.user) {
          router.replace('/');
          return;
        }
        setUser(m.user);
      })
      .catch(() => router.replace('/'))
      .finally(() => setLoading(false));
  }, [router]);

  return { user, loading };
}