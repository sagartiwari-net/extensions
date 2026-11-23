/** Cloudflare tokens are IP/browser-bound — injecting stale ones causes challenge loops. */
function isCloudflareBindingCookie(name) {
  if (!name) return false;
  if (name === 'cf_clearance' || name === '__cf_bm') return true;
  return String(name).startsWith('__cf_chl');
}

export function cookiesForInject(cookies = []) {
  if (!Array.isArray(cookies)) return [];
  return cookies.filter((c) => c?.name && !isCloudflareBindingCookie(c.name));
}

function isHostPrefixedCookie(name) {
  return String(name || '').startsWith('__Host-');
}

function isSecurePrefixedCookie(name) {
  return String(name || '').startsWith('__Secure-');
}

function forceHttpOnly(name) {
  const n = String(name || '');
  if (
    n === 'PHPSESSID' ||
    n === 'sell_the_trend_session' ||
    n === 'laravel_session' ||
    n === 'next-auth.session-token' ||
    n === '__Secure-next-auth.session-token' ||
    n.startsWith('__Secure-next-auth.session-token.') ||
    n.startsWith('next-auth.session-token.') ||
    n === 'grauth' ||
    n === 'amember_login' ||
    n === 'amember_pass' ||
    n === 'amember_ru' ||
    n === 'amember_auth'
  ) {
    return true;
  }
  return false;
}

function forceSecure(name) {
  const n = String(name || '');
  return (
    forceHttpOnly(n) ||
    n === 'XSRF-TOKEN' ||
    n === '__Host-next-auth.csrf-token' ||
    isSecurePrefixedCookie(n) ||
    isHostPrefixedCookie(n)
  );
}

function normalizeSameSite(val) {
  if (!val || val === 'no_restriction' || val === 'none') return 'no_restriction';
  if (val === 'lax' || val === 'strict') return val;
  return 'lax';
}

function urlForCookie(cookie, fallbackUrl) {
  const path = cookie.path || '/';
  const raw = String(cookie.domain || '').trim();
  if (!raw) {
    try {
      const u = new URL(fallbackUrl);
      return `${u.origin}${path}`;
    } catch {
      return fallbackUrl;
    }
  }
  const host = raw.startsWith('.') ? raw.slice(1) : raw;
  const secure = cookie.secure !== false;
  const scheme = secure ? 'https' : 'http';
  return `${scheme}://${host}${path}`;
}

function buildDomainList(domain, hostname) {
  const list = [];
  if (domain) {
    list.push(domain);
    if (domain.startsWith('.')) list.push(domain.slice(1));
    else list.push('.' + domain);
  }
  list.push(hostname);
  list.push('.' + hostname.replace(/^www\./, ''));
  if (hostname.split('.').length > 2) {
    list.push('.' + hostname.split('.').slice(-2).join('.'));
  }
  return [...new Set(list.filter(Boolean))];
}

function buildCookieUrl(url, domain) {
  const host = domain ? domain.replace(/^\./, '') : url.hostname;
  const scheme = url.protocol === 'http:' ? 'http:' : 'https:';
  return `${scheme}//${host}${url.pathname || '/'}`;
}

function hostMatches(cookieDomain, hostname) {
  const root = hostname.replace(/^www\./, '').toLowerCase();
  const d = (cookieDomain || '').replace(/^\./, '').toLowerCase();
  return d === root || d.endsWith('.' + root) || root.endsWith('.' + d);
}

async function removeOneCookie(c) {
  const name = c.name;
  const host = (c.domain || '').replace(/^\./, '');
  const path = c.path || '/';
  const hostOnly = !!c.hostOnly || String(name).startsWith('__Host-');
  const hosts = hostOnly
    ? [host]
    : [...new Set([host, `www.${host}`, host.replace(/^www\./, '')].filter(Boolean))];
  const paths = [...new Set([path, '/'])];
  const jobs = [];

  for (const h of hosts) {
    if (!h) continue;
    for (const p of paths) {
      const url = `https://${h}${p.startsWith('/') ? p : `/${p}`}`;
      jobs.push(chrome.cookies.remove({ url, name }).catch(() => null));
      // Partitioned / CHIPS cookies (ChatGPT and similar)
      jobs.push(
        chrome.cookies
          .remove({ url, name, partitionKey: { topLevelSite: `https://${h.replace(/^www\./, '')}` } })
          .catch(() => null),
      );
      if (!c.secure && !String(name).startsWith('__Host-') && !String(name).startsWith('__Secure-')) {
        jobs.push(chrome.cookies.remove({ url: `http://${h}${p}`, name }).catch(() => null));
      }
    }
  }
  if (c.partitionKey) {
    const url = `https://${host}${path}`;
    jobs.push(chrome.cookies.remove({ url, name, partitionKey: c.partitionKey }).catch(() => null));
  }
  await Promise.all(jobs);
}

/** Remove every browser cookie for a hostname (incl. subdomains + parent). */
export async function clearCookiesForHost(hostname) {
  const root = hostname.replace(/^www\./, '').toLowerCase();
  const apex = root.includes('.') ? root.split('.').slice(-2).join('.') : root;
  const batches = await Promise.all([
    chrome.cookies.getAll({ domain: root }).catch(() => []),
    chrome.cookies.getAll({ domain: `.${root}` }).catch(() => []),
    chrome.cookies.getAll({ domain: apex }).catch(() => []),
    chrome.cookies.getAll({ domain: `.${apex}` }).catch(() => []),
  ]);
  const seen = new Set();
  const toRemove = [];
  for (const batch of batches) {
    for (const c of batch || []) {
      if (!hostMatches(c.domain, root) && !hostMatches(c.domain, apex)) continue;
      const key = `${c.name}\0${c.domain}\0${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toRemove.push(c);
    }
  }
  await Promise.all(toRemove.map((c) => removeOneCookie(c)));
}

export async function clearCookiesForUrl(url) {
  try {
    const { hostname } = new URL(url);
    await clearCookiesForHost(hostname);
  } catch {
    /* */
  }
}

/** Wipe every browser-jar cookie for an apex domain and all subdomains (e.g. grammarly.com). */
export async function clearCookiesForApexDomain(apex) {
  const root = String(apex || '')
    .replace(/^www\./, '')
    .toLowerCase();
  if (!root) return;

  const seen = new Set();
  const toRemove = [];
  const topLevelSite = `https://${root}`;

  // Domain-scoped only — never chrome.cookies.getAll({}) (scans entire profile, freezes UI).
  const batches = await Promise.all([
    chrome.cookies.getAll({ domain: root }).catch(() => []),
    chrome.cookies.getAll({ domain: `.${root}` }).catch(() => []),
    chrome.cookies.getAll({ partitionKey: { topLevelSite } }).catch(() => []),
    chrome.cookies.getAll({ partitionKey: { topLevelSite: `https://www.${root}` } }).catch(() => []),
  ]);

  for (const batch of batches) {
    for (const c of batch || []) {
      const d = (c.domain || '').replace(/^\./, '').toLowerCase();
      if (d !== root && !d.endsWith(`.${root}`) && d !== `www.${root}`) continue;
      const key = `${c.name}\0${c.domain}\0${c.path}\0${JSON.stringify(c.partitionKey || null)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toRemove.push(c);
    }
  }

  await Promise.all(toRemove.map((c) => removeOneCookie(c)));
}

function cookieDomainMatches(snapDomain, cookieDomain) {
  const snap = (snapDomain || '').replace(/^\./, '').toLowerCase();
  const cd = (cookieDomain || '').replace(/^\./, '').toLowerCase();
  if (!snap) return true;
  return cd === snap || cd.endsWith('.' + snap) || snap.endsWith('.' + cd);
}

/** Remove injected cookies by name+domain snapshot (domain-scoped — no full-profile scan). */
export async function clearCookiesBySnapshot(snapshot = []) {
  if (!snapshot.length) return;
  const domains = new Set();
  for (const snap of snapshot) {
    const d = String(snap.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (d) {
      domains.add(d);
      const parts = d.split('.');
      if (parts.length >= 2) domains.add(parts.slice(-2).join('.'));
    }
  }
  const batches = await Promise.all(
    [...domains].flatMap((d) => [
      chrome.cookies.getAll({ domain: d }).catch(() => []),
      chrome.cookies.getAll({ domain: `.${d}` }).catch(() => []),
    ]),
  );
  const all = batches.flat();
  const toRemove = all.filter((c) =>
    snapshot.some((snap) => c.name === snap.name && cookieDomainMatches(snap.domain, c.domain)),
  );
  await Promise.all(toRemove.map((c) => removeOneCookie(c)));
}

/**
 * chrome.cookies.set often returns null instead of throwing — must check result.
 * @param {{ maxAgeSeconds?: number }} [opts] — short lease so disable cannot leave forever-cookies
 */
export async function setCookieFlexible(cookie, targetUrl, opts = {}) {
  const resolvedUrl = urlForCookie(cookie, targetUrl);
  const url = new URL(resolvedUrl);
  const hostPrefixed = isHostPrefixedCookie(cookie.name);
  const onHttps = resolvedUrl.startsWith('https') || targetUrl.startsWith('https');
  const base = {
    name: cookie.name,
    value: String(cookie.value ?? ''),
    path: hostPrefixed ? '/' : cookie.path || '/',
    secure: forceSecure(cookie.name) || cookie.secure === true || onHttps,
    httpOnly: forceHttpOnly(cookie.name) || !!cookie.httpOnly,
    sameSite: normalizeSameSite(cookie.sameSite),
  };

  if (opts.maxAgeSeconds && opts.maxAgeSeconds > 0) {
    base.expirationDate = Math.floor(Date.now() / 1000) + Math.floor(opts.maxAgeSeconds);
  } else if (!(cookie.session || !cookie.expirationDate) && cookie.expirationDate) {
    base.expirationDate = Math.floor(Number(cookie.expirationDate));
  }

  if (hostPrefixed) {
    const host = new URL(targetUrl).hostname;
    const scheme = 'https';
    try {
      const details = {
        ...base,
        url: `${scheme}://${host}/`,
        path: '/',
        secure: true,
      };
      const res = await chrome.cookies.set(details);
      if (res) return true;
    } catch (err) {
      console.warn('[cookies] __Host- set failed', cookie.name, err?.message || err);
    }
    return false;
  }

  const domains = buildDomainList(cookie.domain, url.hostname);
  for (const domain of domains) {
    try {
      const details = {
        ...base,
        url: buildCookieUrl(url, domain),
        domain,
      };
      const res = await chrome.cookies.set(details);
      if (res) return true;
    } catch {
      /* try next domain */
    }
  }

  // Last resort: host-only cookie on tool URL (no Domain attribute)
  try {
    const details = {
      ...base,
      url: targetUrl.startsWith('http') ? targetUrl : `https://${url.hostname}/`,
    };
    const res = await chrome.cookies.set(details);
    if (res) return true;
  } catch (err) {
    console.warn('[cookies] set failed', cookie.name, err?.message || err);
  }
  return false;
}

/**
 * Clear host jar first, then write vault cookies.
 * Returns { attempted, set } so launch reports show real write success.
 */
export async function injectCookies(session, tabUrl) {
  await clearCookiesForUrl(tabUrl);
  const list = cookiesForInject(session.cookies || session.Cookies || []);
  let set = 0;
  for (const c of list) {
    const ok = await setCookieFlexible(c, tabUrl);
    if (ok) set += 1;
    else console.warn('[cookies] could not set', c.name, c.domain);
  }
  return { attempted: list.length, set };
}
