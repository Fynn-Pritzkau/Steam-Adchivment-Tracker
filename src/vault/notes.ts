import { normalizePath, TFile, TFolder } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import { STRINGS } from '../i18n';
import type { Achievement, OwnedGame, UnplayedGame } from '../types';
import { fmtDate, sanitizeFileName, SYNC_END, SYNC_START } from '../util';

export async function ensureFolder(plugin: SteamTrackerPlugin, folder: string): Promise<void> {
  const path = normalizePath(folder);
  if (!plugin.app.vault.getAbstractFileByPath(path)) await plugin.app.vault.createFolder(path);
}

/** Maps appid → note for every game note below the base folder. */
export function buildFileMap(plugin: SteamTrackerPlugin): Map<number, TFile> {
  const folder = plugin.baseFolder;
  const map = new Map<number, TFile>();
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(folder + '/')) continue;
    const appid = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
    if (appid) map.set(Number(appid), file);
  }
  return map;
}

export function hiddenAwareDescription(plugin: SteamTrackerPlugin, a: Achievement): string {
  const t = plugin.t;
  if (a.hidden && !plugin.settings.showHiddenDescriptions) return t.noteHidden;
  if (!a.description) return a.hidden ? t.noteHidden : '';
  return a.description;
}

export async function createNote(
  plugin: SteamTrackerPlugin,
  game: OwnedGame | UnplayedGame,
  cover: string,
  section: string
): Promise<TFile> {
  const t = plugin.t;
  const folder = plugin.baseFolder;
  const base = sanitizeFileName(game.name);
  let path = normalizePath(`${folder}/${base}.md`);
  if (plugin.app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${folder}/${base} (${game.appid}).md`);
  }
  const body = [
    `![cover|460](${cover})`,
    '',
    `[${t.noteStoreLink}](https://store.steampowered.com/app/${game.appid}) · ` +
      `[${t.noteAchievementsLink}](https://steamcommunity.com/stats/${game.appid}/achievements)`,
    '',
    t.noteMyNotes,
    '',
    '',
    '',
    t.noteAchievements,
    '',
    section,
    '',
  ].join('\n');
  return plugin.app.vault.create(path, body);
}

export function buildSection(plugin: SteamTrackerPlugin, achievements: Achievement[], unlocked: number, total: number) {
  const t = plugin.t;
  const lines = [SYNC_START];
  if (total === 0) {
    lines.push(t.noteNoAchievements);
    lines.push(SYNC_END);
    return lines.join('\n');
  }
  const completion = Math.floor((unlocked / total) * 100);
  lines.push(
    `**${t.noteProgress}:** <progress value="${unlocked}" max="${total}"></progress> ${unlocked}/${total} (${completion} %)`
  );
  lines.push('');

  const open = achievements.filter((a) => !a.achieved).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  const done = achievements.filter((a) => a.achieved).sort((a, b) => b.unlocktime - a.unlocktime);

  lines.push(t.noteOpen(open.length));
  if (open.length === 0) lines.push(t.noteAllDone);
  for (const a of open) {
    const desc = hiddenAwareDescription(plugin, a);
    const rarity = a.percent != null ? ' ' + t.noteRarity(plugin.fmtPercent(a.percent)) : '';
    const icon = a.icongray ? `![icon|32](${a.icongray}) ` : '';
    lines.push(`- [ ] ${icon}**${a.name}**${desc ? ': ' + desc : ''}${rarity}`);
  }

  lines.push('');
  lines.push(t.noteDone(done.length));
  for (const a of done) {
    const date = fmtDate(a.unlocktime);
    const parts: string[] = [];
    if (date) parts.push(t.noteUnlocked(date));
    if (a.percent != null) parts.push(`${plugin.fmtPercent(a.percent)} %`);
    const meta = parts.length ? ` *(${parts.join(', ')})*` : '';
    const icon = a.icon ? `![icon|32](${a.icon}) ` : '';
    lines.push(`- [x] ${icon}**${a.name}**${a.description ? ': ' + a.description : ''}${meta}`);
  }

  lines.push(SYNC_END);
  return lines.join('\n');
}

export async function moveGameFile(
  plugin: SteamTrackerPlugin,
  file: TFile,
  appid: number,
  status: string,
  total: number
): Promise<TFile> {
  const folders = plugin.t.folders;
  const sub = total === 0 ? folders.noach : folders[status as keyof typeof folders];
  if (!sub) return file;
  const dir = normalizePath(`${plugin.baseFolder}/${sub}`);
  if (file.parent?.path === dir) return file;
  await ensureFolder(plugin, dir);
  let target = normalizePath(`${dir}/${file.name}`);
  if (plugin.app.vault.getAbstractFileByPath(target)) {
    target = normalizePath(`${dir}/${file.basename} (${appid}).md`);
    if (plugin.app.vault.getAbstractFileByPath(target)) return file;
  }
  await plugin.app.fileManager.renameFile(file, target);
  return file;
}

/** After a language switch: remove the other language's empty status folders and stale focus page. */
export async function cleanUpOtherLanguages(plugin: SteamTrackerPlugin): Promise<void> {
  const current = plugin.t;
  for (const [code, strings] of Object.entries(STRINGS)) {
    if (code === plugin.lang) continue;
    for (const sub of Object.values(strings.folders)) {
      if (Object.values(current.folders).includes(sub)) continue;
      const folder = plugin.app.vault.getAbstractFileByPath(normalizePath(`${plugin.baseFolder}/${sub}`));
      if (folder instanceof TFolder && folder.children.length === 0) {
        await plugin.app.vault.delete(folder);
      }
    }
    if (strings.focusFile !== current.focusFile) {
      const oldFocus = plugin.app.vault.getAbstractFileByPath(normalizePath(`${plugin.baseFolder}/${strings.focusFile}`));
      if (oldFocus instanceof TFile) await plugin.app.vault.trash(oldFocus, true);
    }
  }
}
