import type { Game } from '../data/store';
import { STATUSES, type LibrarySort } from '../types';
import { emptyState, gameCard } from './components';
import type { ViewContext } from './view';

function sortGames(games: Game[], sort: LibrarySort): Game[] {
  const list = games.slice();
  switch (sort) {
    case 'progress':
      return list.sort((a, b) => b.completion - a.completion || b.unlocked - a.unlocked);
    case 'playtime':
      return list.sort((a, b) => b.playtime - a.playtime);
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'almost': {
      // fewest missing achievements first; finished and achievement-less games last
      const left = (g: Game) => (g.total === 0 || g.perfect ? Number.MAX_SAFE_INTEGER : g.total - g.unlocked);
      return list.sort((a, b) => left(a) - left(b) || b.completion - a.completion);
    }
    case 'recent':
    default:
      return list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }
}

export function renderLibrary(container: HTMLElement, ctx: ViewContext) {
  const { plugin } = ctx;
  const t = plugin.t;
  const prefs = plugin.settings.ui;
  const games = plugin.store.getGames();

  if (!games.length) {
    emptyState(container, t.libNoData);
    return;
  }

  // ---- Toolbar ----
  const toolbar = container.createDiv({ cls: 'st-toolbar' });

  const search = toolbar.createEl('input', {
    cls: 'st-search',
    attr: { type: 'search', placeholder: t.libSearch, 'data-focus-key': 'library-search' },
  });
  search.value = prefs.search;

  const genres = Array.from(new Set(games.flatMap((g) => g.genres))).sort((a, b) => a.localeCompare(b));
  const genreSelect = toolbar.createEl('select', { cls: 'dropdown st-select' });
  genreSelect.createEl('option', { value: '', text: t.libAllGenres });
  for (const genre of genres) genreSelect.createEl('option', { value: genre, text: genre });
  genreSelect.value = genres.includes(prefs.genre) ? prefs.genre : '';

  const sortSelect = toolbar.createEl('select', { cls: 'dropdown st-select', attr: { 'aria-label': t.libSort } });
  const sorts: [LibrarySort, string][] = [
    ['recent', t.sortRecent],
    ['progress', t.sortProgress],
    ['almost', t.sortAlmost],
    ['playtime', t.sortPlaytime],
    ['name', t.sortName],
  ];
  for (const [value, label] of sorts) sortSelect.createEl('option', { value, text: label });
  sortSelect.value = prefs.sort;

  const chips = container.createDiv({ cls: 'st-chips' });
  const chipEls = new Map<string, HTMLElement>();
  for (const status of STATUSES) {
    const chip = chips.createEl('button', { cls: `st-chip st-status-${status}`, text: t.statusNames[status] });
    chipEls.set(status, chip);
    chip.addEventListener('click', () => {
      const set = new Set(prefs.statuses);
      if (set.has(status)) set.delete(status);
      else set.add(status);
      prefs.statuses = Array.from(set);
      update();
    });
  }
  const noAchChip = chips.createEl('button', { cls: 'st-chip st-chip-noach', text: t.libShowNoAch });
  noAchChip.addEventListener('click', () => {
    prefs.showNoAch = !prefs.showNoAch;
    update();
  });

  const summary = container.createDiv({ cls: 'st-summary' });
  const countEl = summary.createSpan();
  const resetBtn = summary.createEl('button', { cls: 'st-link-btn', text: t.libClearFilters });
  resetBtn.addEventListener('click', () => {
    prefs.statuses = [];
    prefs.genre = '';
    prefs.search = '';
    search.value = '';
    genreSelect.value = '';
    update();
  });

  const grid = container.createDiv({ cls: 'st-grid' });

  const update = () => {
    plugin.requestSave();
    for (const [status, chip] of chipEls) chip.toggleClass('is-active', prefs.statuses.includes(status));
    noAchChip.toggleClass('is-active', prefs.showNoAch);

    const q = prefs.search.trim().toLowerCase();
    const filtered = games.filter((g) => {
      if (!prefs.showNoAch && g.total === 0) return false;
      if (prefs.statuses.length && !prefs.statuses.includes(g.status)) return false;
      if (prefs.genre && !g.genres.includes(prefs.genre)) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const filtersActive = Boolean(prefs.statuses.length || prefs.genre || q);
    countEl.setText(t.libCount(filtered.length, games.length));
    resetBtn.toggle(filtersActive);

    grid.empty();
    if (!filtered.length) {
      emptyState(grid, t.libEmpty, 'search-x');
      return;
    }
    for (const game of sortGames(filtered, prefs.sort)) {
      gameCard(grid, game, t, { onClick: (g) => ctx.navigate({ name: 'detail', appid: g.appid }) });
    }
  };

  let searchTimer: number | null = null;
  search.addEventListener('input', () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      prefs.search = search.value;
      update();
    }, 120);
  });
  genreSelect.addEventListener('change', () => {
    prefs.genre = genreSelect.value;
    update();
  });
  sortSelect.addEventListener('change', () => {
    prefs.sort = sortSelect.value as LibrarySort;
    update();
  });

  update();
}
