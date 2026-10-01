import { normalizePath, TFile } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { GameState, UnplayedGame } from '../types';
import { BACKLOG_END, BACKLOG_RE, BACKLOG_START, fmtDate, replaceOrAppend, STATS_END, STATS_RE, STATS_START } from '../util';

const DASHBOARD_VERSION = 2;
const DASHBOARD_FILE = '_Dashboard.md';

function gameLink(g: GameState): string {
  const name = (g.name || '').replace(/[|[\]]/g, '-');
  if (!g.file) return name;
  return `[[${g.file.replace(/\.md$/, '')}|${name}]]`;
}

export async function updateFocusPage(plugin: SteamTrackerPlugin): Promise<void> {
  const t = plugin.t;
  // correct stale note paths before building links
  for (const id of Object.keys(plugin.state.games)) plugin.store.findNote(Number(id));
  const all = Object.values(plugin.state.games).filter((g) => g.file);
  const withAch = all.filter((g) => g.total > 0);
  const progress = (g: GameState) =>
    `<progress value="${g.unlocked}" max="${g.total}"></progress> ${g.unlocked}/${g.total}`;
  const pct = (g: GameState) => (g.total ? Math.floor((g.unlocked / g.total) * 100) : 0);
  const lastSync = plugin.state.lastSync ? new Date(plugin.state.lastSync).toLocaleString(t.locale) : '–';

  const lines = [t.focusTitle, '', t.focusInfoTitle, t.focusInfoText, t.focusLastSync(lastSync), ''];

  // 1. Recently played
  const recent = withAch
    .filter((g) => g.status !== 'dropped' && g.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 5);
  lines.push(t.focusRecent);
  if (!recent.length) lines.push(t.focusRecentEmpty);
  for (const g of recent) {
    const open = g.total - g.unlocked;
    lines.push(
      `- ${gameLink(g)} · ${progress(g)} · ${open ? t.focusOpenCount(open) : t.focusDoneLabel} · ${g.hours} h · ${fmtDate(g.lastPlayed)}`
    );
  }
  lines.push('');

  // 2. Planned
  const planned = withAch.filter((g) => g.status === 'next').sort((a, b) => a.name.localeCompare(b.name));
  lines.push(t.focusPlanned);
  if (!planned.length) lines.push(t.focusPlannedEmpty);
  for (const g of planned) lines.push(`- ${gameLink(g)} · ${t.focusAchCount(g.total)}`);
  lines.push('');

  // 3. Quick wins
  const quick = withAch
    .filter((g) => ['playing', 'paused', 'next'].includes(g.status))
    .flatMap((g) => (g.openTop || []).filter((a) => a.percent != null).map((a) => ({ g, a })))
    .sort((x, y) => y.a.percent - x.a.percent)
    .slice(0, 15);
  lines.push(t.focusQuick);
  lines.push(t.focusQuickHint);
  if (!quick.length) lines.push(t.focusNoneFound);
  for (const { g, a } of quick) {
    lines.push(`- **${a.name}** (${plugin.fmtPercent(a.percent)} %) – ${gameLink(g)}${a.desc ? ': ' + a.desc : ''}`);
  }
  lines.push('');

  // 4. Almost there
  const almost = withAch
    .filter((g) => !g.perfect && g.unlocked > 0 && g.status !== 'dropped')
    .sort((a, b) => a.total - a.unlocked - (b.total - b.unlocked) || pct(b) - pct(a))
    .slice(0, 10);
  lines.push(t.focusAlmost);
  if (!almost.length) lines.push(t.focusNone);
  for (const g of almost) {
    lines.push(`- ${gameLink(g)} – ${t.focusLeft(g.total - g.unlocked)} · ${progress(g)} (${pct(g)} %)`);
  }
  lines.push('');

  // 5. Not touched in a while
  const dusty = withAch
    .filter((g) => g.status === 'paused' && g.unlocked > 0)
    .sort((a, b) => pct(b) - pct(a))
    .slice(0, 5);
  lines.push(t.focusDusty);
  lines.push(t.focusDustyHint);
  if (!dusty.length) lines.push(t.focusNone);
  for (const g of dusty) {
    lines.push(`- ${gameLink(g)} · ${progress(g)} (${pct(g)} %) · ${t.focusLastPlayed(fmtDate(g.lastPlayed) || '–')}`);
  }
  lines.push('');

  const content = lines.join('\n');
  const existing = plugin.app.vault.getAbstractFileByPath(plugin.focusPath);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content);
  else await plugin.app.vault.create(plugin.focusPath, content);
}

export async function updateDashboard(
  plugin: SteamTrackerPlugin,
  unplayed: UnplayedGame[],
  forceReset: boolean
): Promise<void> {
  const t = plugin.t;
  const state = plugin.state;
  const folder = plugin.baseFolder;
  const path = normalizePath(`${folder}/${DASHBOARD_FILE}`);

  const games = Object.values(state.games);
  const withAch = games.filter((g) => g.total > 0);
  const sum = (list: GameState[], fn: (g: GameState) => number) => list.reduce((s, g) => s + (fn(g) || 0), 0);
  const statsBlock = [
    STATS_START,
    [
      t.statsGames(withAch.length),
      t.statsAchievements(
        sum(withAch, (g) => g.unlocked),
        sum(withAch, (g) => g.total)
      ),
      t.statsPerfect(withAch.filter((g) => g.perfect).length),
      t.statsHours(Math.round(sum(games, (g) => g.playtime) / 60)),
      t.statsNoAch(games.length - withAch.length),
      t.statsUnplayed(unplayed.length),
    ].join(' · '),
    STATS_END,
  ].join('\n');

  const backlogBlock = [
    BACKLOG_START,
    ...(unplayed.length
      ? unplayed.map((g) => `- [${g.name}](https://store.steampowered.com/app/${g.appid})`)
      : [t.backlogEmpty]),
    BACKLOG_END,
  ].join('\n');

  let existing = plugin.app.vault.getAbstractFileByPath(path);
  let outdated = (state.dashboardVersion || 1) < DASHBOARD_VERSION || (state.dashboardLang || 'de') !== plugin.lang;
  if (outdated && !forceReset && existing instanceof TFile) {
    // The current template may already be there if an earlier sync stopped before saving its state.
    const content = await plugin.app.vault.cachedRead(existing);
    if (content.includes(t.dashPlaying) && content.includes(t.dashGenres)) {
      state.dashboardVersion = DASHBOARD_VERSION;
      state.dashboardLang = plugin.lang;
      outdated = false;
    }
  }
  if (existing instanceof TFile && (forceReset || outdated)) {
    let backup = normalizePath(`${folder}/${t.dashboardBackup}.md`);
    if (plugin.app.vault.getAbstractFileByPath(backup)) {
      backup = normalizePath(`${folder}/${t.dashboardBackup} ${Date.now()}.md`);
    }
    await plugin.app.fileManager.renameFile(existing, backup);
    existing = null;
  }

  if (existing instanceof TFile) {
    await plugin.app.vault.process(existing, (content) => {
      let c = replaceOrAppend(content, STATS_RE, statsBlock);
      c = replaceOrAppend(c, BACKLOG_RE, backlogBlock);
      return c;
    });
    return;
  }

  const progressCol = `"<progress value='" + achievements_unlocked + "' max='" + achievements_total + "'></progress> " + completion + " %" AS "${t.colProgress}"`;

  const table = (where: string, sort: string) =>
    [
      '```dataview',
      'TABLE WITHOUT ID',
      `  file.link AS "${t.colGame}",`,
      `  ${progressCol},`,
      `  achievements_unlocked + "/" + achievements_total AS "${t.colAchievements}",`,
      `  playtime_hours + " h" AS "${t.colPlaytime}",`,
      `  last_played AS "${t.colLastPlayed}"`,
      `FROM "${folder}"`,
      `WHERE appid AND achievements_total > 0 AND ${where}`,
      `SORT ${sort}`,
      '```',
    ].join('\n');

  const focusName = t.focusFile.replace(/\.md$/, '');
  const content = [
    t.dashTitle,
    '',
    t.dashQuickLink(folder, focusName),
    '',
    statsBlock,
    '',
    t.dashPlaying,
    table('status = "playing"', 'last_played DESC'),
    '',
    t.dashPlanned,
    table('status = "next"', 'file.name ASC'),
    '',
    t.dashAlmost,
    table('!perfect AND completion >= 75 AND status != "dropped"', 'completion DESC'),
    '',
    t.dashPaused,
    table('status = "paused"', 'last_played DESC'),
    '',
    t.dashPerfect,
    table('perfect', 'last_played DESC'),
    '',
    t.dashDropped,
    table('status = "dropped"', 'last_played DESC'),
    '',
    t.dashGenres,
    '```dataview',
    `TABLE WITHOUT ID g AS "${t.colGenre}", length(rows) AS "${t.colGames}", rows.file.link AS "${t.colTitles}"`,
    `FROM "${folder}"`,
    'WHERE appid AND genres',
    'FLATTEN genres AS g',
    'GROUP BY g',
    'SORT length(rows) DESC',
    '```',
    '',
    t.dashBacklog,
    t.dashBacklogHint,
    '',
    backlogBlock,
    '',
    t.dashNoAch,
    '> ```dataview',
    `> TABLE WITHOUT ID file.link AS "${t.colGame}", playtime_hours + " h" AS "${t.colPlaytime}", last_played AS "${t.colLastPlayed}", status AS "${t.colStatus}"`,
    `> FROM "${folder}"`,
    '> WHERE appid AND achievements_total = 0',
    '> SORT playtime_hours DESC',
    '> ```',
    '',
  ].join('\n');

  await plugin.app.vault.create(path, content);
  state.dashboardVersion = DASHBOARD_VERSION;
  state.dashboardLang = plugin.lang;
}
