/**
 * Multi-subdomain jar sync (Grammarly app/coda/auth).
 * DigitaVision-style: set each cookie + replicate to launch/apex.
 * No N×hosts fan-out (that froze CPUs) — .apex domain covers subdomains.
 */
import { setCookieFlexible, cookiesForInject, clearCookiesForApexDomain } from './cookies.js';
import { apexFromHost } from './dnr-cookies.js';

/** Renew must land before this; alarm/port tick ~30–45s. */
export const JAR_LEASE_SECONDS = 120;

const AUTH_COOKIE_NAMES = new Set([
  'grauth',
  'gac',
  'csrf-token',
  'csrf_token',
  'isGrammarlyUser',
  'last_authn_event',
  'tdi',
  'gnar_containerId',
  'redirect_location',
  'PHPSESSID',
  'sell_the_trend_session',
  'laravel_session',
  'XSRF-TOKEN',
  'amember_login',
  'amember_pass',
  'amember_ru',
  'amember_auth',
]);

function isAuthCookieName(name) {
  const n = String(name || '');
  return (
    AUTH_COOKIE_NAMES.has(n) ||
    n.includes('next-auth') ||
    n.startsWith('__Secure-') ||
    n.startsWith('__Host-') ||
    /(?:Refresh|Access)Token$/i.test(n)
  );
}

function cookieAppliesToHost(cookieDomain, host, apex) {
  const h = String(host || '').toLowerCase();
  const cd = String(cookieDomain || '')
    .replace(/^\./, '')
    .toLowerCase();
  const ax = String(apex || '').toLowerCase();
  if (!cd) return true;
  if (h === cd || h.endsWith(`.${cd}`) || cd.endsWith(`.${h}`)) return true;
  if (ax && (cd === ax || cd.endsWith(`.${ax}`) || h.endsWith(`.${ax}`))) return true;
  return false;
}

function leaseOpts(leaseSeconds) {
  return leaseSeconds > 0 ? { maxAgeSeconds: leaseSeconds } : {};
}

/** DigitaVision replicateCookieToLaunchHost — members→tool / host-only → launch. */
async function replicateToLaunchHost(cookie, launchUrl, leaseSeconds = 0) {
  let launchHost;
  try {
    launchHost = new URL(launchUrl).hostname.toLowerCase();
  } catch {
    return;
  }
  const cookieHost = String(cookie.domain || '')
    .replace(/^\./, '')
    .toLowerCase();
  const apex = apexFromHost(launchHost);
  if (!cookieHost || cookieHost === launchHost) return;
  if (cookieAppliesToHost(cookie.domain, launchHost, apex)) return;
  if (apexFromHost(cookieHost) !== apex) return;
  const opts = leaseOpts(leaseSeconds);
  await setCookieFlexible({ ...cookie, domain: launchHost }, launchUrl, opts).catch(() => {});
  await setCookieFlexible({ ...cookie, domain: `.${apex}` }, launchUrl, opts).catch(() => {});
}

async function ensureApexScoped(cookie, apex, leaseSeconds = 0) {
  if (!apex) return;
  const opts = leaseOpts(leaseSeconds);
  // Auth + any cookie already on this apex → ensure `.apex` so app/coda/auth share it
  const cookieHost = String(cookie.domain || '')
    .replace(/^\./, '')
    .toLowerCase();
  if (cookieHost && apexFromHost(cookieHost) !== apex && cookieHost !== apex) return;
  await setCookieFlexible(
    { ...cookie, domain: `.${apex}` },
    `https://${apex}/`,
    opts,
  ).catch(() => {});
}

/**
 * Clear apex jar once, then DigitaVision set + replicate (light).
 * @param {{ leaseSeconds?: number }} [options]
 */
export async function seedJarCookiesMultiHost(session, toolUrl, options = {}) {
  const leaseSeconds = Number(options.leaseSeconds || 0);
  const cookies = cookiesForInject(session.cookies || session.Cookies || []);
  let apex = '';
  try {
    apex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    apex = '';
  }
  if (apex) await clearCookiesForApexDomain(apex).catch(() => {});

  const opts = leaseOpts(leaseSeconds);
  let set = 0;
  const seen = new Set();

  for (const c of cookies) {
    const dedupe = `${c.name}\0${c.domain || ''}\0${c.path || '/'}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    if (await setCookieFlexible(c, toolUrl, opts)) set += 1;
    await replicateToLaunchHost(c, toolUrl, leaseSeconds);
    // Always apex-scope Grammarly-like cookies so coda/auth see grauth
    if (apex && (isAuthCookieName(c.name) || !c.domain || apexFromHost(c.domain) === apex)) {
      await ensureApexScoped(c, apex, leaseSeconds);
    }
  }

  return {
    attempted: cookies.length,
    set,
    hosts: apex ? [apex, `www.${apex}`, `app.${apex}`, `coda.${apex}`, `auth.${apex}`] : [],
    leaseSeconds,
  };
}

/** Re-stamp lease on vault cookies (set + apex only — no host fan-out). */
export async function renewJarCookieLease(session, toolUrl, leaseSeconds = JAR_LEASE_SECONDS) {
  const cookies = cookiesForInject(session.cookies || session.Cookies || []);
  if (!cookies.length || !toolUrl) return 0;
  let apex = '';
  try {
    apex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    return 0;
  }
  const opts = leaseOpts(leaseSeconds);
  let n = 0;
  for (const c of cookies) {
    if (await setCookieFlexible(c, toolUrl, opts)) n += 1;
    if (apex && (isAuthCookieName(c.name) || !c.domain || apexFromHost(c.domain) === apex)) {
      await ensureApexScoped(c, apex, leaseSeconds);
    }
  }
  return n;
}

/**
 * On navigation to sibling subdomain — DigitaVision syncAllCookiesForPageHost (light).
 */
export async function syncJarCookiesForUrl(session, pageUrl, toolUrl, leaseSeconds = 0) {
  if (!pageUrl?.startsWith('http') || !session) return;
  const cookies = cookiesForInject(session.cookies || session.Cookies || []);
  if (!cookies.length) return;

  let pageHost;
  let toolApex;
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
    toolApex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    return;
  }
  if (apexFromHost(pageHost) !== toolApex) return;

  const opts = leaseOpts(leaseSeconds);
  for (const c of cookies) {
    const cookieHost = String(c.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    const sameApex = !cookieHost || apexFromHost(cookieHost) === toolApex;
    if (!sameApex && !cookieAppliesToHost(c.domain, pageHost, toolApex)) continue;
    await setCookieFlexible(c, pageUrl, opts).catch(() => {});
    if (sameApex || isAuthCookieName(c.name)) {
      await ensureApexScoped(c, toolApex, leaseSeconds);
    }
  }
}
