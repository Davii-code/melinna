export function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const encoded = normalized
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/%3A/gi, ':'))
    .join('/');
  return normalized.startsWith('//')
    ? `file:${encoded}`
    : `file://${normalized.startsWith('/') ? '' : '/'}${encoded}`;
}
export function uriPath(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password)
    throw new Error('URI de arquivo inválida.');
  let path = decodeURIComponent(url.pathname);
  if (url.hostname) return `\\\\${url.hostname}${path.replace(/\//g, '\\')}`;
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1).replace(/\//g, '\\');
  return path;
}
