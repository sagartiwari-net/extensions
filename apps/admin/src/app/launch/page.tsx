'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircleIcon, CheckIcon, LoaderCircleIcon } from 'lucide-react';

import { API_BASE } from '@/lib/api';

type Phase = 'sending' | 'ok' | 'error';

type LaunchMeta = {
  user?: string;
  site?: string;
  host?: string;
  client?: string;
  tool?: string;
  tool_key?: string;
};

function readLaunchMeta(token: string): LaunchMeta {
  try {
    const raw = localStorage.getItem(`1clk_launch_meta:${token}`);
    if (!raw) return {};
    return JSON.parse(raw) as LaunchMeta;
  } catch {
    return {};
  }
}

/** Map technical extension errors → short English for members */
function friendlyError(raw: string): string {
  const msg = (raw || '').toLowerCase();
  if (!msg) {
    return 'We could not open your tools right now. Please try again.';
  }
  if (
    msg.includes('waiting for the extension') ||
    msg.includes('load the matching') ||
    msg.includes('service worker') ||
    msg.includes('could not establish') ||
    msg.includes('receiving end does not exist') ||
    msg.includes('extension context') ||
    msg.includes('did not respond')
  ) {
    return 'Extension not detected. Please download it again, install it, and try once more.';
  }
  if (
    msg.includes('wrong extension') ||
    msg.includes('this pack is for') ||
    msg.includes('belongs to') ||
    msg.includes('matching reseller') ||
    msg.includes('missing client')
  ) {
    return 'This is not the correct extension for this site. Install the official extension from your member area.';
  }
  if (
    msg.includes('unauthorized') ||
    msg.includes('unauthorised') ||
    msg.includes('forbidden') ||
    msg.includes('invalid member') ||
    msg.includes('invalid token') ||
    (msg.includes('token') &&
      (msg.includes('expired') || msg.includes('used') || msg.includes('not found')))
  ) {
    return 'You are not authorized for this access. Please sign in again from your member account.';
  }
  if (msg.includes('integrity')) {
    return 'This extension was changed or is outdated. Please download a fresh copy and install it again.';
  }
  if (
    msg.includes('no cookies') ||
    msg.includes('session has no') ||
    msg.includes('session vault empty') ||
    msg.includes('no cookie data') ||
    msg.includes('vault empty')
  ) {
    return 'Access is not ready for this tool yet. Please contact support.';
  }
  if (msg.includes('missing launch token') || msg.includes('missing token')) {
    return 'This link is incomplete. Please open your tool again from the access page.';
  }
  const cleaned = raw.replace(/^extension error:\s*/i, '').trim();
  if (cleaned.length > 160) {
    return 'Something went wrong while opening your tools. Please try again.';
  }
  return cleaned || 'Something went wrong while opening your tools. Please try again.';
}

async function fetchTokenMeta(token: string): Promise<LaunchMeta> {
  try {
    const res = await fetch(`${API_BASE}/api/session/peek?token=${encodeURIComponent(token)}`, {
      credentials: 'omit',
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      username?: string | null;
      site?: string | null;
      client?: string | null;
      tool_name?: string | null;
      tool_key?: string | null;
    };
    return {
      user: data.username || undefined,
      site: data.site || undefined,
      client: data.client || undefined,
      tool: data.tool_name || undefined,
      tool_key: data.tool_key || undefined,
    };
  } catch {
    return {};
  }
}

function LaunchInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [phase, setPhase] = useState<Phase>('sending');
  const [errorText, setErrorText] = useState('');
  const [displayUser, setDisplayUser] = useState('…');
  const [displaySiteName, setDisplaySiteName] = useState('…');
  const settledRef = useRef(false);
  const requestIdRef = useRef('');

  useEffect(() => {
    if (!token) {
      setPhase('error');
      setErrorText(friendlyError('Missing launch token'));
      setDisplayUser('there');
      setDisplaySiteName('your');
      return;
    }

    let cancelled = false;
    settledRef.current = false;
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function onResult(ev: Event) {
      const e = ev as CustomEvent;
      if (e.detail?.requestId && e.detail.requestId !== requestIdRef.current) return;
      if (settledRef.current) return;

      const res = e.detail?.res;
      const err = e.detail?.lastError as string | undefined;

      if (err) {
        settledRef.current = true;
        setPhase('error');
        setErrorText(friendlyError(err));
        return;
      }
      if (res?.success) {
        settledRef.current = true;
        if (res.username) setDisplayUser(String(res.username));
        if (res.client || res.site) setDisplaySiteName(String(res.site || res.client));
        setPhase('ok');
        setErrorText('');
        try {
          localStorage.removeItem(`1clk_launch_meta:${token}`);
        } catch {
          /* */
        }
        // Same-tab aMember: brief success → history.back() to member/tools page.
        // New-tab bridge (Access hub window.open): usually length===1 → close tab.
        setTimeout(() => {
          try {
            if (window.history.length > 1 && document.referrer) {
              window.history.back();
              return;
            }
          } catch {
            /* */
          }
          try {
            window.close();
          } catch {
            /* non-script tabs cannot close themselves */
          }
        }, 350);
        return;
      }
      // Ignore "already used" after a success race; otherwise show error once
      const msg = String(res?.message || 'Launch failed');
      if (/already used|expired/i.test(msg) && settledRef.current) return;
      settledRef.current = true;
      setPhase('error');
      setErrorText(friendlyError(msg));
    }

    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.source !== 'oneclk-extension' || data.type !== '1clk-launch-result') return;
      onResult(
        new CustomEvent('1clk-launch-result', {
          detail: {
            requestId: data.requestId,
            res: data.res,
            lastError: data.lastError,
          },
        }),
      );
    }

    // document = shared with content script (window CustomEvent is isolated-world blind)
    document.addEventListener('1clk-launch-result', onResult);
    window.addEventListener('message', onMessage);

    void (async () => {
      const cached = readLaunchMeta(token);
      if (cached.user) setDisplayUser(cached.user);
      if (cached.host || cached.site || cached.client) {
        setDisplaySiteName(cached.host || cached.site || cached.client || 'your');
      }

      function fireLaunch(client: string) {
        const detail = { token, client, requestId };
        document.dispatchEvent(new CustomEvent('1clk-launch', { detail }));
        window.postMessage({ source: 'oneclk-page', type: '1clk-launch', ...detail }, '*');
      }

      // Fast path: cached client from Access hub — don't wait on peek round-trip
      if (cached.client) {
        setPhase('sending');
        setErrorText('');
        fireLaunch(cached.client);
        timeoutId = setTimeout(() => {
          if (cancelled || settledRef.current) return;
          fireLaunch(cached.client!);
        }, 900);
      }

      const peeked = await fetchTokenMeta(token);
      if (cancelled) return;

      const user = peeked.user || cached.user;
      const site = peeked.site || cached.host || cached.site || peeked.client || cached.client;
      const client = peeked.client || cached.client || null;

      setDisplayUser(user || 'there');
      setDisplaySiteName(site || 'your');

      if (!client) {
        if (!settledRef.current) {
          settledRef.current = true;
          setPhase('error');
          setErrorText(
            friendlyError(
              'Could not verify which site this access belongs to. Open the tool again from your member account.',
            ),
          );
        }
        return;
      }

      if (!cached.client) {
        setPhase('sending');
        setErrorText('');
        fireLaunch(client);
        timeoutId = setTimeout(() => {
          if (cancelled || settledRef.current) return;
          fireLaunch(client);
        }, 900);
      }

      setTimeout(() => {
        if (cancelled || settledRef.current) return;
        settledRef.current = true;
        const hasIndicator = !!document.querySelector('[id^="oneclk-v2-"]');
        setPhase('error');
        setErrorText(
          friendlyError(
            hasIndicator
              ? 'Extension is installed but did not respond. Open chrome://extensions, click Reload on ToolsMandi, then try again.'
              : 'Extension not detected. Download the toolsmandi ZIP again, unzip it, Load unpacked in Chrome, enable it, then try once more.',
          ),
        );
      }, 8000);
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener('1clk-launch-result', onResult);
      window.removeEventListener('message', onMessage);
    };
  }, [token]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-zinc-50 px-4 py-10">
      <section className="w-full max-w-sm">
        <div className="rounded-2xl border border-zinc-200 bg-white px-8 py-10 text-center shadow-sm">
          <div className="mx-auto mb-6 grid size-16 place-items-center">
            <span className="relative grid size-16 place-items-center">
              {phase === 'sending' ? (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full bg-zinc-300/50" />
                  <span className="absolute inset-1 rounded-full border border-zinc-200" />
                  <span className="relative grid size-12 place-items-center rounded-full bg-zinc-900 text-white">
                    <LoaderCircleIcon className="size-6 animate-spin" />
                  </span>
                </>
              ) : null}
              {phase === 'ok' ? (
                <span className="relative grid size-12 place-items-center rounded-full bg-emerald-600 text-white">
                  <CheckIcon className="size-6" strokeWidth={2.5} />
                </span>
              ) : null}
              {phase === 'error' ? (
                <span className="relative grid size-12 place-items-center rounded-full bg-red-600 text-white">
                  <AlertCircleIcon className="size-6" />
                </span>
              ) : null}
            </span>
          </div>

          <p className="text-lg font-semibold tracking-tight text-zinc-900">Hi, {displayUser}</p>

          {phase === 'sending' ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              You are accessing <span className="font-medium text-zinc-900">{displaySiteName}</span> tools
            </p>
          ) : null}

          {phase === 'ok' ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              You are in — <span className="font-medium text-zinc-900">{displaySiteName}</span> tools are
              opening. Returning…
            </p>
          ) : null}

          {phase === 'error' ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">You are facing an issue</p>
          ) : null}

          {phase === 'error' && errorText ? (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800">
              {errorText}
            </p>
          ) : null}
        </div>

        {displaySiteName && displaySiteName !== '…' ? (
          <p className="mt-4 text-center text-xs text-zinc-500">{displaySiteName}</p>
        ) : null}
      </section>
    </main>
  );
}

export default function LaunchPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center text-sm text-zinc-500">
          Loading…
        </main>
      }
    >
      <LaunchInner />
    </Suspense>
  );
}
