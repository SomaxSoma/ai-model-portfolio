/**
 * Recovers the API path for the Vercel function (see vercel.ts):
 * `/api/models?x=1` or `/api?__pf_path=models&x=1` → `/models?x=1`.
 */
export function apiPath(rawUrl: string): string {
  const url = new URL(rawUrl, 'http://localhost');
  const forwarded = url.searchParams.get('__pf_path');
  url.searchParams.delete('__pf_path');
  const path = forwarded !== null ? `/${forwarded.replace(/^\/+/, '')}` : url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  const query = url.searchParams.toString();
  return query ? `${path}?${query}` : path;
}
