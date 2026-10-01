import type { Game } from '../data/store';
import type { Achievement } from '../types';
import { fmtDate, pad } from '../util';
import { barList, columnChart, donut, type Datum } from './charts';
import { emptyState } from './components';
import type { ViewContext } from './view';

function card(parent: HTMLElement, title: string, hint?: string): HTMLElement {
  const el = parent.createDiv({ cls: 'st-panel' });
  const head = el.createDiv({ cls: 'st-panel-head' });
  head.createEl('h3', { text: title });
  if (hint) head.createSpan({ cls: 'st-muted', text: hint });
  return el.createDiv({ cls: 'st-panel-body' });
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function renderStats(container: HTMLElement, ctx: ViewContext) {
  const { plugin } = ctx;
  const t = plugin.t;
  const games = plugin.store.getGames();
  if (!games.length) {
    emptyState(container, t.libNoData);
    return;
  }
  const withAch = games.filter((g) => g.total > 0);
  const num = (n: number) => n.toLocaleString(t.locale);

  // ---- Tiles ----
  const tiles = container.createDiv({ cls: 'st-tiles' });
  const tile = (label: string, value: string, icon: string) => {
    const el = tiles.createDiv({ cls: 'st-tile' });
    el.createDiv({ cls: 'st-tile-icon', text: icon });
    el.createDiv({ cls: 'st-tile-value', text: value });
    el.createDiv({ cls: 'st-tile-label', text: label });
  };
  const unlocked = withAch.reduce((s, g) => s + g.unlocked, 0);
  const total = withAch.reduce((s, g) => s + g.total, 0);
  const avg = withAch.length ? Math.round(withAch.reduce((s, g) => s + g.completion, 0) / withAch.length) : 0;
  const hours = Math.round(games.reduce((s, g) => s + g.playtime, 0) / 60);
  tile(t.statTotalAch, `${num(unlocked)} / ${num(total)}`, '🏆');
  tile(t.statPerfect, num(withAch.filter((g) => g.perfect).length), '⭐');
  tile(t.statAvgCompletion, `${avg} %`, '📈');
  tile(t.statHours, num(hours), '⏱️');
  tile(t.statGames, num(games.length), '🎮');

  const grid = container.createDiv({ cls: 'st-panels' });

  // ---- Achievements per month (needs the achievement cache) ----
  const monthBody = card(grid, t.chartPerMonth, t.chartPerMonthHint);
  monthBody.parentElement.addClass('is-wide');
  monthBody.createDiv({ cls: 'st-loading' });

  // ---- Hours per day (from history snapshots) ----
  const dailyBody = card(grid, t.chartDaily, t.chartDailyHint);
  dailyBody.parentElement.addClass('is-wide');
  renderDaily(dailyBody, ctx);

  // ---- Top playtime ----
  const topBody = card(grid, t.chartTopPlaytime);
  const top = games
    .slice()
    .sort((a, b) => b.playtime - a.playtime)
    .slice(0, 10);
  barList(
    topBody,
    top.map((g) => ({
      label: g.name,
      value: g.playtime,
      display: t.hours(Math.round(g.playtime / 60)),
      onClick: () => ctx.navigate({ name: 'detail', appid: g.appid }),
    }))
  );

  // ---- Genres by playtime (a game's playtime is split across its genres) ----
  const genreBody = card(grid, t.chartGenres);
  const byGenre = new Map<string, number>();
  for (const g of games) {
    if (!g.genres.length) continue;
    const share = g.playtime / g.genres.length;
    for (const genre of g.genres) byGenre.set(genre, (byGenre.get(genre) || 0) + share);
  }
  const sorted = Array.from(byGenre.entries()).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    genreBody.createDiv({ cls: 'st-muted', text: t.chartNoData });
  } else {
    const slices: Datum[] = sorted.slice(0, 7).map(([label, value]) => ({ label, value }));
    const rest = sorted.slice(7).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) slices.push({ label: t.chartOther, value: rest });
    donut(genreBody, slices, t.hours(hours));
  }

  // ---- Rarest unlocked (needs the achievement cache) ----
  const rareBody = card(grid, t.chartRarest);
  rareBody.createDiv({ cls: 'st-loading' });

  loadAllAchievements(ctx, withAch).then(({ lists, missing }) => {
    renderMonths(monthBody, ctx, lists);
    renderRarest(rareBody, ctx, lists);
    if (missing > 0) {
      container.createDiv({ cls: 'st-muted st-stats-note', text: t.chartMissingCache(missing) });
    }
  });
}

async function loadAllAchievements(ctx: ViewContext, games: Game[]) {
  const lists: { game: Game; list: Achievement[] }[] = [];
  let missing = 0;
  await Promise.all(
    games.map(async (game) => {
      const list = await ctx.plugin.cache.loadAchievements(game.appid);
      if (list) lists.push({ game, list });
      else missing++;
    })
  );
  return { lists, missing };
}

function renderMonths(body: HTMLElement, ctx: ViewContext, lists: { game: Game; list: Achievement[] }[]) {
  const t = ctx.plugin.t;
  body.empty();
  const now = new Date();
  const months: { key: string; date: Date }[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), date: d });
  }
  const counts = new Map<string, number>(months.map((m) => [m.key, 0]));
  for (const { list } of lists) {
    for (const a of list) {
      if (!a.achieved || !a.unlocktime) continue;
      const key = monthKey(new Date(a.unlocktime * 1000));
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
  }
  const data: Datum[] = months.map((m) => ({
    label: m.date.toLocaleString(t.locale, { month: 'long', year: 'numeric' }),
    value: counts.get(m.key),
  }));
  if (data.every((d) => d.value === 0)) {
    body.createDiv({ cls: 'st-muted', text: t.chartNoData });
    return;
  }
  columnChart(body, data, (_d, i) => {
    const date = months[i].date;
    const label = date.toLocaleString(t.locale, { month: 'short' });
    return date.getMonth() === 0 || i === 0 ? `${label} ${String(date.getFullYear()).slice(2)}` : label;
  });
}

function renderRarest(body: HTMLElement, ctx: ViewContext, lists: { game: Game; list: Achievement[] }[]) {
  const { plugin } = ctx;
  const t = plugin.t;
  body.empty();
  const all = lists.flatMap(({ game, list }) =>
    list.filter((a) => a.achieved && a.percent != null).map((a) => ({ game, a }))
  );
  all.sort((x, y) => x.a.percent - y.a.percent);
  const rare = all.slice(0, 10);
  if (!rare.length) {
    body.createDiv({ cls: 'st-muted', text: t.chartNoData });
    return;
  }
  const list = body.createDiv({ cls: 'st-rare-list' });
  for (const { game, a } of rare) {
    const row = list.createDiv({ cls: 'st-rare is-clickable' });
    if (a.icon) row.createEl('img', { cls: 'st-rare-icon', attr: { src: a.icon, alt: '', loading: 'lazy' } });
    const text = row.createDiv({ cls: 'st-rare-text' });
    text.createDiv({ cls: 'st-rare-name', text: a.name });
    text.createDiv({ cls: 'st-muted', text: `${game.name} · ${fmtDate(a.unlocktime) || ''}` });
    row.createDiv({ cls: 'st-rare-pct', text: `${plugin.fmtPercent(a.percent)} %` });
    row.addEventListener('click', () => ctx.navigate({ name: 'detail', appid: game.appid }));
  }
}

async function renderDaily(body: HTMLElement, ctx: ViewContext) {
  const t = ctx.plugin.t;
  const history = await ctx.plugin.cache.loadHistory();
  const days = Object.keys(history.days).sort();
  if (days.length < 2) {
    body.createDiv({ cls: 'st-muted', text: t.chartCollecting });
    return;
  }
  // Replay snapshots: the first day is the baseline, every later day contributes its playtime increase.
  const running = new Map<string, number>();
  const played = new Map<string, number>();
  days.forEach((day, i) => {
    let minutes = 0;
    for (const [appid, [playtime]] of Object.entries(history.days[day])) {
      const before = running.get(appid);
      if (i > 0) minutes += Math.max(0, playtime - (before ?? 0));
      running.set(appid, playtime);
    }
    if (i > 0) played.set(day, minutes);
  });

  const data: Datum[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const minutes = played.get(key) || 0;
    const h = Math.round((minutes / 60) * 10) / 10;
    data.push({ label: d.toLocaleDateString(t.locale), value: minutes, display: h ? t.hours(h) : '' });
  }
  columnChart(body, data, (_d, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - i));
    return i % 5 === 4 || i === 29 ? d.toLocaleDateString(t.locale, { day: 'numeric', month: 'numeric' }) : null;
  });
}
