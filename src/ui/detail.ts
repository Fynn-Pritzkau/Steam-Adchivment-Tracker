import { MarkdownRenderer, setIcon } from 'obsidian';
import type { Game } from '../data/store';
import { STATUSES, type Achievement } from '../types';
import { fmtDate } from '../util';
import { coverImage, emptyState, progressBar, statusBadge } from './components';
import type { ViewContext } from './view';

export interface DetailState {
  tab: 'open' | 'done' | 'all';
  search: string;
  sort: 'rarity' | 'date' | 'name';
  revealed: Set<string>;
}

const NOTES_HEADING = /^##\s+(Meine Notizen|My notes)\s*$/;

/** Returns the markdown below the "My notes" heading up to the next level-2 heading. */
function extractNotes(content: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => NOTES_HEADING.test(l));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) || lines[i].includes('<!-- steam-sync:start -->')) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

export function renderDetail(container: HTMLElement, ctx: ViewContext, appid: number) {
  const { plugin, view } = ctx;
  const t = plugin.t;
  const game = plugin.store.getGame(appid);

  const top = container.createDiv({ cls: 'st-detail-top' });
  const backBtn = top.createEl('button', { cls: 'st-back-btn' });
  setIcon(backBtn.createSpan(), 'arrow-left');
  backBtn.createSpan({ text: t.detailBack });
  backBtn.addEventListener('click', () => ctx.back());

  if (!game) {
    emptyState(container, t.detailNotFound, 'search-x');
    return;
  }

  let state = view.detailState.get(appid);
  if (!state) {
    state = { tab: game.perfect ? 'done' : 'open', search: '', sort: 'rarity', revealed: new Set() };
    view.detailState.set(appid, state);
  }

  // ---- Hero ----
  const hero = container.createDiv({ cls: 'st-hero' });
  coverImage(hero, game, 'st-hero-cover');
  const info = hero.createDiv({ cls: 'st-hero-info' });
  const titleRow = info.createDiv({ cls: 'st-hero-title-row' });
  titleRow.createEl('h2', { cls: 'st-hero-title', text: game.name });
  statusBadge(titleRow, game.status, t);

  const metaParts = [game.developer, game.releaseYear ? String(game.releaseYear) : null].filter(Boolean);
  const meta = info.createDiv({ cls: 'st-hero-meta' });
  if (metaParts.length) meta.createSpan({ text: metaParts.join(' · ') });
  if (game.metacritic) meta.createSpan({ cls: 'st-metacritic', text: String(game.metacritic) });
  if (game.genres.length) {
    const genres = info.createDiv({ cls: 'st-genres' });
    for (const g of game.genres) genres.createSpan({ cls: 'st-genre', text: g });
  }

  const facts = info.createDiv({ cls: 'st-facts' });
  const fact = (label: string, value: string) => {
    const el = facts.createDiv({ cls: 'st-fact' });
    el.createDiv({ cls: 'st-fact-value', text: value });
    el.createDiv({ cls: 'st-fact-label', text: label });
  };
  fact(t.detailPlaytime, t.hours(game.hours));
  fact(t.detailLastPlayed, fmtDate(game.lastPlayed) || '–');
  if (game.total > 0) fact(t.detailAchievements, `${game.unlocked}/${game.total}`);

  if (game.total > 0) {
    const progressRow = info.createDiv({ cls: 'st-hero-progress' });
    progressBar(progressRow, game.completion, 'is-large');
    progressRow.createSpan({ cls: 'st-hero-pct', text: `${game.completion} %` });
  }

  const actions = info.createDiv({ cls: 'st-actions' });
  const statusSelect = actions.createEl('select', { cls: 'dropdown st-select', attr: { 'aria-label': t.detailStatus } });
  for (const s of STATUSES) statusSelect.createEl('option', { value: s, text: t.statusNames[s] });
  statusSelect.value = game.status;
  statusSelect.addEventListener('change', () => plugin.setGameStatus(appid, statusSelect.value));

  const button = (label: string, icon: string, onClick: () => void, cta = false) => {
    const b = actions.createEl('button', { cls: cta ? 'mod-cta' : '' });
    setIcon(b.createSpan({ cls: 'st-btn-icon' }), icon);
    b.createSpan({ text: label });
    b.addEventListener('click', onClick);
    return b;
  };
  if (game.note) {
    button(t.detailOpenNote, 'file-text', () => plugin.app.workspace.getLeaf('tab').openFile(game.note), true);
    const syncBtn = button(t.detailSync, 'refresh-cw', () => plugin.syncer.syncSingle(game.note, appid));
    syncBtn.disabled = plugin.syncing;
  }
  button(t.detailStore, 'external-link', () => window.open(`https://store.steampowered.com/app/${appid}`));

  // ---- Main: achievements + notes ----
  const main = container.createDiv({ cls: 'st-detail-main' });
  const achCol = main.createDiv({ cls: 'st-detail-ach' });
  const side = main.createDiv({ cls: 'st-detail-side' });

  renderNotes(side, ctx, game);

  if (game.total === 0) {
    emptyState(achCol, t.detailNoAchievements, 'trophy');
    return;
  }
  const loading = achCol.createDiv({ cls: 'st-loading' });
  plugin.cache.loadAchievements(appid).then((list) => {
    loading.remove();
    if (!list) {
      const el = emptyState(achCol, t.detailNoCache, 'download');
      if (game.note) {
        const b = el.createEl('button', { cls: 'mod-cta', text: t.detailSync });
        b.addEventListener('click', () => plugin.syncer.syncSingle(game.note, appid));
      }
      return;
    }
    renderAchievements(achCol, ctx, list, state);
  });
}

function renderAchievements(container: HTMLElement, ctx: ViewContext, list: Achievement[], state: DetailState) {
  const { plugin } = ctx;
  const t = plugin.t;
  const open = list.filter((a) => !a.achieved);
  const done = list.filter((a) => a.achieved);

  const bar = container.createDiv({ cls: 'st-ach-toolbar' });
  const tabs = bar.createDiv({ cls: 'st-seg' });
  const tabDefs: [DetailState['tab'], string][] = [
    ['open', t.detailTabOpen(open.length)],
    ['done', t.detailTabDone(done.length)],
    ['all', t.detailTabAll(list.length)],
  ];
  const tabEls = new Map<string, HTMLElement>();
  for (const [key, label] of tabDefs) {
    const el = tabs.createEl('button', { cls: 'st-seg-btn', text: label });
    tabEls.set(key, el);
    el.addEventListener('click', () => {
      state.tab = key;
      update();
    });
  }

  const search = bar.createEl('input', {
    cls: 'st-search',
    attr: { type: 'search', placeholder: t.detailSearch, 'data-focus-key': 'detail-search' },
  });
  search.value = state.search;

  const sortSelect = bar.createEl('select', { cls: 'dropdown st-select' });
  const sorts: [DetailState['sort'], string][] = [
    ['rarity', t.sortRarity],
    ['date', t.sortDate],
    ['name', t.sortName],
  ];
  for (const [value, label] of sorts) sortSelect.createEl('option', { value, text: label });
  sortSelect.value = state.sort;

  const listEl = container.createDiv({ cls: 'st-ach-list' });

  const update = () => {
    for (const [key, el] of tabEls) el.toggleClass('is-active', key === state.tab);
    let items = state.tab === 'open' ? open : state.tab === 'done' ? done : list.slice();
    const q = state.search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          ((!a.hidden || a.achieved || state.revealed.has(a.apiname)) && a.description.toLowerCase().includes(q))
      );
    }
    items = items.slice().sort((a, b) => {
      if (state.sort === 'name') return a.name.localeCompare(b.name);
      if (state.sort === 'date') return b.unlocktime - a.unlocktime || (b.percent ?? -1) - (a.percent ?? -1);
      return (b.percent ?? -1) - (a.percent ?? -1);
    });

    listEl.empty();
    if (!items.length) {
      emptyState(listEl, t.detailNoMatches, 'search-x');
      return;
    }
    for (const a of items) renderAchievement(listEl, ctx, a, state);
  };

  let timer: number | null = null;
  search.addEventListener('input', () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      state.search = search.value;
      update();
    }, 120);
  });
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value as DetailState['sort'];
    update();
  });

  update();
}

function renderAchievement(parent: HTMLElement, ctx: ViewContext, a: Achievement, state: DetailState) {
  const { plugin } = ctx;
  const t = plugin.t;
  const row = parent.createDiv({ cls: 'st-ach' + (a.achieved ? ' is-done' : '') });
  const icon = a.achieved ? a.icon : a.icongray || a.icon;
  if (icon) row.createEl('img', { cls: 'st-ach-icon', attr: { src: icon, alt: '', loading: 'lazy' } });
  else row.createDiv({ cls: 'st-ach-icon' });

  const body = row.createDiv({ cls: 'st-ach-body' });
  const head = body.createDiv({ cls: 'st-ach-head' });
  head.createSpan({ cls: 'st-ach-name', text: a.name });
  if (a.achieved) {
    const date = fmtDate(a.unlocktime);
    if (date) head.createSpan({ cls: 'st-ach-date', text: t.detailUnlockedOn(date) });
  }

  const spoiler =
    a.hidden && !a.achieved && !plugin.settings.showHiddenDescriptions && !state.revealed.has(a.apiname);
  if (spoiler) {
    const desc = body.createDiv({ cls: 'st-ach-desc is-spoiler', text: t.detailHiddenReveal });
    desc.setAttr('role', 'button');
    desc.setAttr('tabindex', '0');
    const reveal = () => {
      state.revealed.add(a.apiname);
      desc.removeClass('is-spoiler');
      desc.setText(a.description || t.noteHidden.replace(/\*/g, ''));
    };
    desc.addEventListener('click', reveal);
    desc.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') reveal();
    });
  } else if (a.description) {
    body.createDiv({ cls: 'st-ach-desc', text: a.description });
  }

  if (a.percent != null) {
    const rarity = row.createDiv({ cls: 'st-ach-rarity' });
    progressBar(rarity, a.percent, a.percent < 10 ? 'is-rare' : '');
    rarity.createDiv({ cls: 'st-ach-pct', text: t.detailPlayers(plugin.fmtPercent(a.percent)) });
  }
}

function renderNotes(parent: HTMLElement, ctx: ViewContext, game: Game) {
  const { plugin, view } = ctx;
  const t = plugin.t;
  const box = parent.createDiv({ cls: 'st-notes' });
  const head = box.createDiv({ cls: 'st-notes-head' });
  head.createEl('h3', { text: t.detailNotes });
  if (!game.note) return;
  const edit = head.createEl('button', { cls: 'st-link-btn', text: t.detailEdit });
  edit.addEventListener('click', () => plugin.app.workspace.getLeaf('tab').openFile(game.note));

  const content = box.createDiv({ cls: 'st-notes-content markdown-rendered' });
  plugin.app.vault.cachedRead(game.note).then((text) => {
    const notes = extractNotes(text);
    if (!notes) {
      content.createDiv({ cls: 'st-muted', text: t.detailNotesEmpty });
      return;
    }
    MarkdownRenderer.render(plugin.app, notes, content, game.note.path, view);
  });
}
