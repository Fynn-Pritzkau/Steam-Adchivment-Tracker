import { Menu } from 'obsidian';
import type { Game } from '../data/store';
import { STATUSES } from '../types';
import { gameCard } from './components';
import type { ViewContext } from './view';

const DRAG_TYPE = 'text/x-steam-appid';
const COMPLETED_LIMIT = 20;

export function statusMenu(ctx: ViewContext, game: Game, evt: MouseEvent) {
  const { plugin } = ctx;
  const t = plugin.t;
  const menu = new Menu();
  for (const status of STATUSES) {
    menu.addItem((item) =>
      item
        .setTitle(t.statusNames[status])
        .setChecked(game.status === status)
        .onClick(() => {
          if (game.status !== status) plugin.setGameStatus(game.appid, status);
        })
    );
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t.boardOpenDetails)
      .setIcon('info')
      .onClick(() => ctx.navigate({ name: 'detail', appid: game.appid }))
  );
  if (game.note) {
    menu.addItem((item) =>
      item
        .setTitle(t.detailOpenNote)
        .setIcon('file-text')
        .onClick(() => plugin.app.workspace.getLeaf('tab').openFile(game.note))
    );
  }
  menu.showAtMouseEvent(evt);
}

export function renderBoard(container: HTMLElement, ctx: ViewContext) {
  const { plugin, view } = ctx;
  const t = plugin.t;
  const games = plugin.store.getGames().filter((g) => g.total > 0);

  const board = container.createDiv({ cls: 'st-board' });

  for (const status of STATUSES) {
    const items = games
      .filter((g) => g.status === status)
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));

    const col = board.createDiv({ cls: `st-col st-status-${status}` });
    col.dataset.status = status;
    const head = col.createDiv({ cls: 'st-col-head' });
    head.createSpan({ cls: 'st-col-dot' });
    head.createSpan({ cls: 'st-col-title', text: t.statusNames[status] });
    head.createSpan({ cls: 'st-col-count', text: String(items.length) });

    const list = col.createDiv({ cls: 'st-col-list' });
    const expanded = view.boardExpanded.has(status);
    const limited = status === 'completed' && !expanded ? items.slice(0, COMPLETED_LIMIT) : items;

    if (!items.length) list.createDiv({ cls: 'st-col-empty', text: t.boardDropHere });

    for (const game of limited) {
      const card = gameCard(list, game, t, {
        compact: true,
        draggable: true,
        onClick: (g) => ctx.navigate({ name: 'detail', appid: g.appid }),
        onMenu: (g, evt) => statusMenu(ctx, g, evt),
      });
      card.addEventListener('dragstart', (evt) => {
        evt.dataTransfer?.setData(DRAG_TYPE, String(game.appid));
        evt.dataTransfer?.setData('text/plain', game.name);
        if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'move';
        card.addClass('is-dragging');
        board.addClass('is-dragging');
      });
      card.addEventListener('dragend', () => {
        card.removeClass('is-dragging');
        board.removeClass('is-dragging');
        board.querySelectorAll('.st-col.is-over').forEach((el) => el.removeClass('is-over'));
      });
    }

    if (status === 'completed' && items.length > COMPLETED_LIMIT) {
      const more = col.createEl('button', {
        cls: 'st-link-btn st-col-more',
        text: expanded ? t.boardShowLess : t.boardShowMore(items.length - COMPLETED_LIMIT),
      });
      more.addEventListener('click', () => {
        if (expanded) view.boardExpanded.delete(status);
        else view.boardExpanded.add(status);
        view.render();
      });
    }

    // ---- Drop target ----
    col.addEventListener('dragover', (evt) => {
      if (!evt.dataTransfer?.types.includes(DRAG_TYPE)) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      col.addClass('is-over');
    });
    col.addEventListener('dragleave', (evt) => {
      if (!col.contains(evt.relatedTarget as Node)) col.removeClass('is-over');
    });
    col.addEventListener('drop', (evt) => {
      evt.preventDefault();
      col.removeClass('is-over');
      const appid = Number(evt.dataTransfer?.getData(DRAG_TYPE));
      const game = games.find((g) => g.appid === appid);
      if (!game || game.status === status) return;
      // move the card right away; the store refresh re-renders with the real state
      const card = board.querySelector(`.st-card[data-appid="${appid}"]`);
      if (card) {
        list.querySelector('.st-col-empty')?.remove();
        list.prepend(card);
      }
      plugin.setGameStatus(appid, status);
    });
  }
}
