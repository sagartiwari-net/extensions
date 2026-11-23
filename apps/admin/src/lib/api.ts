const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:4000';

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    // Only set JSON content-type when a body is present (DELETE/GET otherwise 400).
    if (init?.body != null && !headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json';
    }
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network error';
    throw new Error(
      `Cannot reach API (${API_BASE}). Is the API running? ${reason}`,
    );
  }

  let data: T & { message?: string };
  try {
    data = (await res.json()) as T & { message?: string };
  } catch {
    throw new Error(`API returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

/** Download binary (zip) with session cookie; returns suggested filename. */
export async function apiDownload(
  path: string,
  init?: RequestInit & { fallbackName?: string },
): Promise<{ blob: Blob; filename: string }> {
  const { fallbackName, ...fetchInit } = init || {};
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      credentials: 'include',
      headers: fetchInit.headers,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network error';
    throw new Error(`Cannot reach API (${API_BASE}). Is the API running? ${reason}`);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      /* */
    }
    throw new Error(message);
  }
  const cd = res.headers.get('content-disposition') || '';
  const match =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/i.exec(cd);
  const rawName = decodeURIComponent(
    (match?.[1] || match?.[2] || match?.[3] || '').trim(),
  );
  const version = res.headers.get('x-extension-version') || '';
  let filename = rawName || fallbackName || 'extension.zip';
  if (!/\.zip$/i.test(filename)) {
    filename = filename.replace(/\.(bin|octet-stream)$/i, '') || 'extension';
    filename = `${filename}${version ? `-v${version}` : ''}.zip`;
  }
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: 'application/zip' });
  return { blob, filename };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { API_BASE };