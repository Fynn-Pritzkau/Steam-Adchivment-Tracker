import { ItemView, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import { pad } from '../util';
import { renderDetail, type DetailState } from './detail';
import { renderLibrary } from './library';

export const VIEW_TYPE = 'steam-tracker-view';

export type TabName = 'library';
export type Route = { name: TabName } | { name: 'detail'; appid: number };

/** Passed to every page renderer. */
export interface ViewContext {
  plugin: SteamTrackerPlugin;
  view: TrackerView;
  navigate(route: Route): void;
  back(): void;
}

export class TrackerView extends ItemView {
  route: Route = { name: 'library' };
  private history: Route[] = [];
  private bodyEl: HTMLElement;
  private syncBtn: HTMLButtonElement;
  private syncInfo: HTMLElement;
  /** Per-game UI state of the detail page (tab, search …), kept across re-renders. */
  detailState = new Map<number, DetailState>();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: SteamTrackerPlugin
  ) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.t.viewTitle;
  }

  getIcon() {
    return 'gamepad-2';
  }

  async onOpen() {
    this.registerEvent(this.plugin.store.onChanged(() => this.render()));
    this.registerEvent(this.plugin.store.on('sync-state', () => this.updateSyncInfo()));
    this.render();
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), route: this.route };
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    if (state?.route?.name) this.route = state.route;
    await super.setState(state, result);
    this.render();
  }

  private get ctx(): ViewContext {
    return {
      plugin: this.plugin,
      view: this,
      navigate: (route) => this.navigate(route),
      back: () => this.back(),
    };
  }

  navigate(route: Route) {
    this.history.push(this.route);
    if (this.history.length > 20) this.history.shift();
    this.route = route;
    this.render(false);
    this.app.workspace.requestSaveLayout();
  }

  back() {
    this.route = this.history.pop() || { name: 'library' };
    this.render(false);
    this.app.workspace.requestSaveLayout();
  }

  /** Re-renders the current page; keeps scroll position and search focus when staying on it. */
  render(keepScroll = true) {
    const root = this.contentEl;
    const scrollTop = keepScroll && this.bodyEl ? this.bodyEl.scrollTop : 0;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && root.contains(active) ? active.dataset.focusKey : undefined;

    root.empty();
    root.addClass('st-view');
    this.renderHeader(root);
    this.bodyEl = root.createDiv({ cls: 'st-body' });

    const ctx = this.ctx;
    const route = this.route;
    if (route.name === 'detail') renderDetail(this.bodyEl, ctx, route.appid);
    else renderLibrary(this.bodyEl, ctx);

    this.bodyEl.scrollTop = scrollTop;
    if (focusKey) {
      const el = root.querySelector<HTMLInputElement>(`[data-focus-key="${focusKey}"]`);
      if (el) {
        el.focus();
        if (typeof el.value === 'string') el.setSelectionRange?.(el.value.length, el.value.length);
      }
    }
  }

  private renderHeader(root: HTMLElement) {
    const t = this.plugin.t;
    const header = root.createDiv({ cls: 'st-header' });
    const tabs = header.createDiv({ cls: 'st-tabs', attr: { role: 'tablist' } });
    const current = this.route.name === 'detail' ? null : this.route.name;
    const tabDefs: { name: TabName; label: string; icon: string }[] = [
      { name: 'library', label: t.tabLibrary, icon: 'layout-grid' },
    ];
    for (const def of tabDefs) {
      const tab = tabs.createEl('button', {
        cls: 'st-tab' + (current === def.name ? ' is-active' : ''),
        attr: { role: 'tab', 'aria-selected': String(current === def.name) },
      });
      setIcon(tab.createSpan({ cls: 'st-tab-icon' }), def.icon);
      tab.createSpan({ text: def.label });
      tab.addEventListener('click', () => {
        if (this.route.name !== def.name) this.navigate({ name: def.name });
      });
    }

    const right = header.createDiv({ cls: 'st-header-right' });
    this.syncInfo = right.createSpan({ cls: 'st-sync-info' });
    this.syncBtn = right.createEl('button', { cls: 'st-sync-btn' });
    this.syncBtn.addEventListener('click', () => this.plugin.syncer.syncAll(false));
    this.updateSyncInfo();
  }

  private updateSyncInfo() {
    if (!this.syncBtn) return;
    const t = this.plugin.t;
    const syncing = this.plugin.syncing;
    this.syncBtn.empty();
    setIcon(this.syncBtn.createSpan({ cls: 'st-sync-icon' + (syncing ? ' is-spinning' : '') }), 'refresh-cw');
    this.syncBtn.createSpan({ text: syncing ? t.syncingShort : t.btnSync });
    this.syncBtn.disabled = syncing;
    const last = this.plugin.state.lastSync;
    if (last) {
      const d = new Date(last);
      this.syncInfo.setText(t.lastSyncShort(`${pad(d.getHours())}:${pad(d.getMinutes())}`));
    } else {
      this.syncInfo.setText(t.neverSynced);
    }
  }
}
