import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db.js';

export type IpIntel = {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  as_name: string | null;
  is_proxy: boolean;
  is_hosting: boolean;
  is_mobile: boolean;
  proxy_type: string;
  network_hint: string;
  looked_up_at: string | null;
};

function classify(row: {
  proxy?: boolean;
  hosting?: boolean;
  mobile?: boolean;
  isp?: string;
  org?: string;
}): { proxy_type: string; network_hint: string } {
  const isp = `${row.isp || ''} ${row.org || ''}`.toLowerCase();
  if (row.hosting) {
    return {
      proxy_type: 'datacenter',
      network_hint: 'Likely VPS / datacenter / cloud hosting (not home ISP)',
    };
  }
  if (row.proxy) {
    return {
      proxy_type: 'proxy_vpn',
      network_hint: 'Flagged as proxy / VPN by IP intel',
    };
  }
  if (row.mobile) {
    return {
      proxy_type: 'mobile',
      network_hint: 'Mobile carrier network',
    };
  }
  if (/vpn|proxy|digitalocean|linode|ovh|hetzner|aws|google cloud|azure|contabo/.test(isp)) {
    return {
      proxy_type: 'datacenter',
      network_hint: 'ISP/org name suggests hosting or VPN',
    };
  }
  return {
    proxy_type: 'residential',
    network_hint: 'Looks like residential / normal ISP',
  };
}

export async function lookupIp(ip: string): Promise<IpIntel | null> {
  const clean = String(ip || '').trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean.startsWith('192.168.')) {
    return {
      ip: clean || 'unknown',
      country: null,
      region: null,
      city: null,
      isp: 'local / private',
      org: null,
      as_name: null,
      is_proxy: false,
      is_hosting: false,
      is_mobile: false,
      proxy_type: 'private',
      network_hint: 'Private or loopback address — no public geo',
      looked_up_at: new Date().toISOString(),
    };
  }

  const [cached] = await pool.query<RowDataPacket[]>(
    `SELECT ip, country, region, city, isp, org, as_name, is_proxy, is_hosting, is_mobile,
            proxy_type, network_hint, looked_up_at
     FROM ip_lookups WHERE ip = ? LIMIT 1`,
    [clean],
  );
  if (cached[0]) {
    const c = cached[0];
    const age = Date.now() - new Date(c.looked_up_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      return {
        ip: c.ip,
        country: c.country,
        region: c.region,
        city: c.city,
        isp: c.isp,
        org: c.org,
        as_name: c.as_name,
        is_proxy: !!c.is_proxy,
        is_hosting: !!c.is_hosting,
        is_mobile: !!c.is_mobile,
        proxy_type: c.proxy_type,
        network_hint: c.network_hint,
        looked_up_at: c.looked_up_at,
      };
    }
  }

  let data: Record<string, unknown> = {};
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,message,country,regionName,city,isp,org,as,proxy,hosting,mobile,query`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return cached[0]
      ? {
          ip: cached[0].ip,
          country: cached[0].country,
          region: cached[0].region,
          city: cached[0].city,
          isp: cached[0].isp,
          org: cached[0].org,
          as_name: cached[0].as_name,
          is_proxy: !!cached[0].is_proxy,
          is_hosting: !!cached[0].is_hosting,
          is_mobile: !!cached[0].is_mobile,
          proxy_type: cached[0].proxy_type,
          network_hint: cached[0].network_hint,
          looked_up_at: cached[0].looked_up_at,
        }
      : null;
  }

  if (data.status !== 'success') {
    return null;
  }

  const cls = classify({
    proxy: !!data.proxy,
    hosting: !!data.hosting,
    mobile: !!data.mobile,
    isp: String(data.isp || ''),
    org: String(data.org || ''),
  });

  const row: IpIntel = {
    ip: clean,
    country: (data.country as string) || null,
    region: (data.regionName as string) || null,
    city: (data.city as string) || null,
    isp: (data.isp as string) || null,
    org: (data.org as string) || null,
    as_name: (data.as as string) || null,
    is_proxy: !!data.proxy,
    is_hosting: !!data.hosting,
    is_mobile: !!data.mobile,
    proxy_type: cls.proxy_type,
    network_hint: cls.network_hint,
    looked_up_at: new Date().toISOString(),
  };

  await pool.query<ResultSetHeader>(
    `INSERT INTO ip_lookups
      (ip, country, region, city, isp, org, as_name, is_proxy, is_hosting, is_mobile, proxy_type, network_hint, raw, looked_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      country=VALUES(country), region=VALUES(region), city=VALUES(city), isp=VALUES(isp),
      org=VALUES(org), as_name=VALUES(as_name), is_proxy=VALUES(is_proxy), is_hosting=VALUES(is_hosting),
      is_mobile=VALUES(is_mobile), proxy_type=VALUES(proxy_type), network_hint=VALUES(network_hint),
      raw=VALUES(raw), looked_up_at=NOW()`,
    [
      row.ip,
      row.country,
      row.region,
      row.city,
      row.isp,
      row.org,
      row.as_name,
      row.is_proxy ? 1 : 0,
      row.is_hosting ? 1 : 0,
      row.is_mobile ? 1 : 0,
      row.proxy_type,
      row.network_hint,
      JSON.stringify(data),
    ],
  );

  return row;
}

/** Batch enrich — cache-first, then lookup missing (capped). Never throws (reports stay up). */
export async function lookupIpsBatch(ips: string[]): Promise<Map<string, IpIntel>> {
  const out = new Map<string, IpIntel>();
  try {
    const unique = [
      ...new Set(
        ips
          .map((ip) => String(ip || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 120);

    if (!unique.length) return out;

    const [cached] = await pool.query<RowDataPacket[]>(
      `SELECT ip, country, region, city, isp, org, as_name, is_proxy, is_hosting, is_mobile,
              proxy_type, network_hint, looked_up_at
       FROM ip_lookups WHERE ip IN (${unique.map(() => '?').join(',')})`,
      unique,
    );
    const now = Date.now();
    const fresh = new Set<string>();
    for (const c of cached) {
      const age = now - new Date(c.looked_up_at).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) {
        fresh.add(String(c.ip));
        out.set(String(c.ip), {
          ip: c.ip,
          country: c.country,
          region: c.region,
          city: c.city,
          isp: c.isp,
          org: c.org,
          as_name: c.as_name,
          is_proxy: !!c.is_proxy,
          is_hosting: !!c.is_hosting,
          is_mobile: !!c.is_mobile,
          proxy_type: c.proxy_type,
          network_hint: c.network_hint,
          looked_up_at: c.looked_up_at,
        });
      }
    }

    const missing = unique.filter((ip) => !fresh.has(ip));
    for (const ip of missing.slice(0, 40)) {
      const row = await lookupIp(ip);
      if (row) out.set(ip, row);
    }
  } catch {
    // Missing table / network — callers still get launch rows without intel
  }
  return out;
}

export function intelSummary(intel: IpIntel | undefined | null): {
  ip_type: string;
  ip_label: string;
  is_risky: boolean;
} {
  if (!intel) return { ip_type: 'unknown', ip_label: 'Unknown', is_risky: false };
  const t = intel.proxy_type || 'unknown';
  const risky = t === 'datacenter' || t === 'proxy_vpn' || intel.is_hosting || intel.is_proxy;
  const labels: Record<string, string> = {
    residential: 'Residential',
    datacenter: 'Datacenter / VPS',
    proxy_vpn: 'Proxy / VPN',
    mobile: 'Mobile',
    private: 'Private / local',
  };
  return {
    ip_type: t,
    ip_label: labels[t] || t,
    is_risky: risky,
  };
}
