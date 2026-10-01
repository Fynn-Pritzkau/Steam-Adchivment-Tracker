export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const pad = (n: number) => String(n).padStart(2, '0');

export const SYNC_START = '<!-- steam-sync:start -->';
export const SYNC_END = '<!-- steam-sync:end -->';
export const SYNC_RE = /<!-- steam-sync:start -->[\s\S]*?<!-- steam-sync:end -->/;
export const STATS_START = '<!-- steam-stats:start -->';
export const STATS_END = '<!-- steam-stats:end -->';
export const STATS_RE = /<!-- steam-stats:start -->[\s\S]*?<!-- steam-stats:end -->/;
export const BACKLOG_START = '<!-- steam-backlog:start -->';
export const BACKLOG_END = '<!-- steam-backlog:end -->';
export const BACKLOG_RE = /<!-- steam-backlog:start -->[\s\S]*?<!-- steam-backlog:end -->/;

export function fmtDate(unix: number): string | null {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
}

export function oneLine(text: string | undefined | null): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export function tagSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

export function replaceOrAppend(content: string, regex: RegExp, block: string): string {
  if (regex.test(content)) return content.replace(regex, () => block);
  return content.replace(/\s*$/, '') + '\n\n' + block + '\n';
}

export function coverUrl(appid: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}
