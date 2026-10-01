import { setIcon } from 'obsidian';
import type { Game } from '../data/store';
import type { Strings } from '../i18n';

/** Circular progress indicator with the percentage in the middle. */
export function progressRing(parent: Element, pct: number, size = 44, stroke = 4): SVGSVGElement {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const svg = parent.createSvg('svg', {
    cls: 'st-ring',
    attr: { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${pct} %` },
  });
  svg.createSvg('circle', {
    cls: 'st-ring-bg',
    attr: { cx: mid, cy: mid, r, fill: 'none', 'stroke-width': stroke },
  });
  svg.createSvg('circle', {
    cls: 'st-ring-fg' + (pct >= 100 ? ' is-perfect' : ''),
    attr: {
      cx: mid,
      cy: mid,
      r,
      fill: 'none',
      'stroke-width': stroke,
      'stroke-linecap': 'round',
      'stroke-dasharray': `${c} ${c}`,
      'stroke-dashoffset': c * (1 - Math.min(100, Math.max(0, pct)) / 100),
      transform: `rotate(-90 ${mid} ${mid})`,
    },
  });
  const text = svg.createSvg('text', {
    cls: 'st-ring-text',
    attr: { x: '50%', y: '50%', 'dominant-baseline': 'central', 'text-anchor': 'middle' },
  });
  text.textContent = pct >= 100 ? '🏆' : `${pct}%`;
  return svg;
}

/** Horizontal progress bar. */
export function progressBar(parent: HTMLElement, pct: number, cls = ''): HTMLElement {
  const bar = parent.createDiv({ cls: `st-bar ${cls}`.trim() });
  bar.createDiv({ cls: 'st-bar-fill' + (pct >= 100 ? ' is-perfect' : '') }).style.width = `${Math.min(100, pct)}%`;
  return bar;
}

export function statusBadge(parent: HTMLElement, status: string, t: Strings): HTMLElement {
  return parent.createSpan({ cls: `st-badge st-status-${status}`, text: t.statusNames[status] || status });
}

/** Cover image with a text fallback when Steam has no header image. */
export function coverImage(parent: HTMLElement, game: Game, cls = 'st-cover'): HTMLElement {
  const wrap = parent.createDiv({ cls });
  const img = wrap.createEl('img', { attr: { src: game.cover, alt: game.name, loading: 'lazy', draggable: 'false' } });
  img.addEventListener('error', () => {
    img.remove();
    wrap.addClass('is-missing');
    wrap.createDiv({ cls: 'st-cover-fallback', text: game.name });
  });
  return wrap;
}

export interface CardOptions {
  onClick?: (game: Game) => void;
  onMenu?: (game: Game, evt: MouseEvent) => void;
  compact?: boolean;
  draggable?: boolean;
}

export function gameCard(parent: HTMLElement, game: Game, t: Strings, opts: CardOptions = {}): HTMLElement {
  const card = parent.createDiv({ cls: 'st-card' + (opts.compact ? ' is-compact' : '') });
  card.dataset.appid = String(game.appid);
  card.setAttr('tabindex', '0');
  card.setAttr('role', 'button');
  card.setAttr('aria-label', game.name);

  coverImage(card, game, 'st-card-cover');

  const body = card.createDiv({ cls: 'st-card-body' });
  const text = body.createDiv({ cls: 'st-card-text' });
  text.createDiv({ cls: 'st-card-title', text: game.name });
  const meta = text.createDiv({ cls: 'st-card-meta' });
  if (!opts.compact) statusBadge(meta, game.status, t);
  meta.createSpan({ cls: 'st-card-hours', text: t.hours(game.hours) });
  if (game.total > 0) {
    meta.createSpan({ cls: 'st-card-ach', text: `${game.unlocked}/${game.total}` });
    progressRing(body, game.completion, opts.compact ? 34 : 42, opts.compact ? 3 : 4);
  } else {
    meta.createSpan({ cls: 'st-card-noach', text: t.noAchShort });
  }

  if (opts.onMenu) {
    const menuBtn = card.createEl('button', { cls: 'st-card-menu clickable-icon', attr: { 'aria-label': t.boardChangeStatus } });
    setIcon(menuBtn, 'more-horizontal');
    menuBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      opts.onMenu(game, evt);
    });
    card.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      opts.onMenu(game, evt);
    });
  }

  if (opts.onClick) {
    card.addEventListener('click', () => opts.onClick(game));
    card.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        opts.onClick(game);
      }
    });
  }
  if (opts.draggable) card.setAttr('draggable', 'true');
  return card;
}

export function emptyState(parent: HTMLElement, text: string, icon = 'gamepad-2'): HTMLElement {
  const el = parent.createDiv({ cls: 'st-empty' });
  setIcon(el.createDiv({ cls: 'st-empty-icon' }), icon);
  el.createDiv({ text });
  return el;
}
