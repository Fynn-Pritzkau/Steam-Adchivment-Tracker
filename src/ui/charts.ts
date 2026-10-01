/** Small dependency-free charts. Colours come from the theme via CSS classes (st-c0 … st-c7). */

export const PALETTE_SIZE = 8;

export interface Datum {
  label: string;
  value: number;
  /** Text for the tooltip / value label; defaults to the value. */
  display?: string;
  onClick?: () => void;
}

/** Vertical bars, e.g. per month. `axisLabel` decides which bars get a label under them. */
export function columnChart(
  parent: HTMLElement,
  data: Datum[],
  axisLabel: (d: Datum, i: number) => string | null
): HTMLElement {
  const chart = parent.createDiv({ cls: 'st-columns' });
  const max = Math.max(1, ...data.map((d) => d.value));
  data.forEach((d, i) => {
    const col = chart.createDiv({ cls: 'st-column' });
    col.setAttr('aria-label', `${d.label}: ${d.display ?? d.value}`);
    const track = col.createDiv({ cls: 'st-column-track' });
    const bar = track.createDiv({ cls: 'st-column-bar' + (d.value === 0 ? ' is-zero' : '') });
    bar.style.height = `${(d.value / max) * 100}%`;
    if (d.value > 0) bar.createDiv({ cls: 'st-column-value', text: d.display ?? String(d.value) });
    const label = axisLabel(d, i);
    col.createDiv({ cls: 'st-column-label', text: label ?? '' });
  });
  return chart;
}

/** Horizontal bars with the label on the left, e.g. top games. */
export function barList(parent: HTMLElement, data: Datum[]): HTMLElement {
  const list = parent.createDiv({ cls: 'st-barlist' });
  const max = Math.max(1, ...data.map((d) => d.value));
  for (const d of data) {
    const row = list.createDiv({ cls: 'st-barlist-row' + (d.onClick ? ' is-clickable' : '') });
    row.createDiv({ cls: 'st-barlist-label', text: d.label, attr: { title: d.label } });
    const track = row.createDiv({ cls: 'st-barlist-track' });
    track.createDiv({ cls: 'st-barlist-bar' }).style.width = `${(d.value / max) * 100}%`;
    row.createDiv({ cls: 'st-barlist-value', text: d.display ?? String(d.value) });
    if (d.onClick) row.addEventListener('click', d.onClick);
  }
  return list;
}

/** Donut chart with legend. Slices are expected to be sorted already. */
export function donut(parent: HTMLElement, data: Datum[], centerText: string): HTMLElement {
  const wrap = parent.createDiv({ cls: 'st-donut' });
  const size = 160;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const svg = wrap.createSvg('svg', {
    cls: 'st-donut-svg',
    attr: { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img' },
  });
  let offset = 0;
  data.forEach((d, i) => {
    const len = (d.value / total) * c;
    svg.createSvg('circle', {
      cls: `st-donut-slice st-c${i % PALETTE_SIZE}`,
      attr: {
        cx: size / 2,
        cy: size / 2,
        r,
        fill: 'none',
        'stroke-width': stroke,
        'stroke-dasharray': `${Math.max(0, len - 1)} ${c}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      },
    });
    offset += len;
  });
  const text = svg.createSvg('text', {
    cls: 'st-donut-center',
    attr: { x: '50%', y: '50%', 'dominant-baseline': 'central', 'text-anchor': 'middle' },
  });
  text.textContent = centerText;

  const legend = wrap.createDiv({ cls: 'st-legend' });
  data.forEach((d, i) => {
    const item = legend.createDiv({ cls: 'st-legend-item' });
    item.createSpan({ cls: `st-legend-swatch st-c${i % PALETTE_SIZE}` });
    item.createSpan({ cls: 'st-legend-label', text: d.label });
    item.createSpan({ cls: 'st-legend-value', text: `${Math.round((d.value / total) * 100)} %` });
  });
  return wrap;
}
