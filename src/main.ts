import { FuzzySuggestModal, moment, normalizePath, Notice, Plugin, TFile, type App, type CachedMetadata } from 'obsidian';
import { DataCache } from './data/cache';
import { GameStore } from './data/store';
import { STRINGS, type Strings } from './i18n';
import { DEFAULT_SETTINGS, DEFAULT_UI, SteamTrackerSettingTab } from './settings';
import { SteamApi } from './steam/api';
import { Syncer } from './sync/sync';
import type { PluginState, Settings, UnplayedGame } from './types';
import { TrackerView, VIEW_TYPE, type Route } from './ui/view';
import { pad } from './util';
import { moveGameFile } from './vault/notes';
import { updateDashboard, updateFocusPage } from './vault/pages';

export default class SteamTrackerPlugin extends Plugin {
  settings: Settings;
  state: PluginState;
  syncing = false;
  steam: SteamApi;
  syncer: Syncer;
  cache: DataCache;
  store: GameStore;

  private intervalId: number | null = null;
  private moveTimers: Record<string, number> = {};
  private focusTimer: number | null = null;
  private saveTimer: number | null = null;
  private statusBar: HTMLElement;

  async onload() {
    await this.loadSettings();
    this.steam = new SteamApi(this);
    this.syncer = new Syncer(this);
    this.cache = new DataCache(this);
    this.store = new GameStore(this);

    this.statusBar = this.addStatusBarItem();
    this.updateStatusBar();

    this.registerView(VIEW_TYPE, (leaf) => new TrackerView(leaf, this));

    const t = this.t;
    this.addRibbonIcon('gamepad-2', t.cmdOpenView, () => this.activateView());
    this.addRibbonIcon('refresh-cw', t.ribbonSync, () => this.syncer.syncAll(false));
    this.addRibbonIcon('list-todo', t.ribbonFocus, () => this.openFocusPage());

    this.addCommand({ id: 'open-view', name: t.cmdOpenView, callback: () => this.activateView() });
    this.addCommand({
      id: 'open-game-in-view',
      name: t.cmdOpenGameInView,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const appid = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
        if (!appid) return false;
        if (!checking) this.activateView({ name: 'detail', appid: Number(appid) });
        return true;
      },
    });

    this.addCommand({ id: 'sync-now', name: t.cmdSync, callback: () => this.syncer.syncAll(false) });
    this.addCommand({ id: 'sync-full', name: t.cmdSyncFull, callback: () => this.syncer.syncAll(true) });
    this.addCommand({
      id: 'sync-current',
      name: t.cmdSyncCurrent,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const appid = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
        if (!appid) return false;
        if (!checking) this.syncer.syncSingle(file, Number(appid));
        return true;
      },
    });
    this.addCommand({ id: 'open-focus', name: t.cmdOpenFocus, callback: () => this.openFocusPage() });
    this.addCommand({
      id: 'plan-backlog',
      name: t.cmdPlanBacklog,
      callback: () => new BacklogModal(this.app, this).open(),
    });
    this.addCommand({
      id: 'reset-dashboard',
      name: t.cmdResetDashboard,
      callback: async () => {
        await updateDashboard(this, this.state.unplayed || [], true);
        await this.saveAll();
        new Notice(this.t.noticeDashboardReset);
      },
    });

    // Status changed by hand → move the note into the matching folder
    this.registerEvent(
      this.app.metadataCache.on('changed', (file, _data, cache) => this.onMetadataChanged(file, cache))
    );
    // File moved/renamed → keep the path in the state up to date
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        for (const g of Object.values(this.state.games)) {
          if (g.file === oldPath) {
            g.file = file.path;
            this.store.notify();
          }
        }
      })
    );

    this.addSettingTab(new SteamTrackerSettingTab(this.app, this));
    this.setupInterval();

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup && this.isConfigured()) {
        // give the metadata cache a moment to build
        window.setTimeout(() => this.syncer.syncAll(false), 3000);
      }
    });
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    Object.values(this.moveTimers).forEach((timer) => window.clearTimeout(timer));
    if (this.focusTimer) window.clearTimeout(this.focusTimer);
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveAll();
    }
  }

  /** Opens (or focuses) the Steam Tracker view, optionally on a given page. */
  async activateView(route?: Route) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (route && leaf.view instanceof TrackerView) leaf.view.navigate(route);
  }

  /** Changes a game's status via its note's frontmatter; the note is then moved by onMetadataChanged. */
  async setGameStatus(appid: number, status: string) {
    const g = this.state.games[appid];
    const file = g && this.store.findNote(appid);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = status;
    });
    g.status = status;
    this.store.notify(0);
    this.requestSave();
  }

  /** Debounced save for frequent UI changes (filters, sorting). */
  requestSave() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveAll();
    }, 1000);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    const saved = data.settings || null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings.ui = Object.assign({}, DEFAULT_UI, saved?.ui);
    // Installs from before the translation were German-only – keep them German.
    if (saved && saved.uiLanguage === undefined) this.settings.uiLanguage = 'de';
    this.state = Object.assign(
      {
        games: {},
        unplayed: [],
        lastSync: null,
        resolvedSteamId: null,
        dashboardVersion: 1,
        dashboardLang: 'de',
      } as PluginState,
      data.state
    );
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, state: this.state });
  }

  get lang(): 'de' | 'en' {
    const ui = this.settings.uiLanguage;
    if (ui === 'de' || ui === 'en') return ui;
    const locale = (moment.locale() || 'en').toLowerCase();
    return locale.startsWith('de') ? 'de' : 'en';
  }

  get t(): Strings {
    return STRINGS[this.lang];
  }

  get steamLanguage(): string {
    return this.settings.language || this.t.steamLanguage;
  }

  get baseFolder(): string {
    return normalizePath(this.settings.folder);
  }

  get focusPath(): string {
    return normalizePath(`${this.baseFolder}/${this.t.focusFile}`);
  }

  fmtPercent(p: number): string {
    return Number(p).toFixed(1).replace('.', this.t.decimal);
  }

  isConfigured(): boolean {
    return Boolean(this.settings.apiKey && this.settings.steamId);
  }

  setSyncing(value: boolean) {
    this.syncing = value;
    this.updateStatusBar();
    this.store?.trigger('sync-state', value);
    if (!value) this.store?.notify(0);
  }

  setupInterval() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    this.intervalId = null;
    const minutes = Number(this.settings.intervalMinutes);
    if (minutes > 0) {
      this.intervalId = window.setInterval(
        () => {
          if (this.isConfigured()) this.syncer.syncAll(false, true);
        },
        minutes * 60 * 1000
      );
      this.registerInterval(this.intervalId);
    }
  }

  updateStatusBar() {
    if (!this.statusBar) return;
    if (this.syncing) {
      this.statusBar.setText(this.t.statusSyncing);
    } else if (this.state.lastSync) {
      const d = new Date(this.state.lastSync);
      this.statusBar.setText(this.t.statusLast(`${pad(d.getHours())}:${pad(d.getMinutes())}`));
    } else {
      this.statusBar.setText('');
    }
  }

  async openFocusPage() {
    if (!this.app.vault.getAbstractFileByPath(this.focusPath)) await updateFocusPage(this);
    await this.app.workspace.openLinkText(this.focusPath, '', false);
  }

  private onMetadataChanged(file: TFile, cache: CachedMetadata) {
    if (this.syncing) return;
    if (!file.path.startsWith(this.baseFolder + '/')) return;
    const fm = cache?.frontmatter;
    if (!fm?.appid) return;
    this.store.notify();
    window.clearTimeout(this.moveTimers[file.path]);
    this.moveTimers[file.path] = window.setTimeout(async () => {
      delete this.moveTimers[file.path];
      if (this.syncing) return;
      const fresh = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fresh?.appid) return;
      const appid = Number(fresh.appid);
      try {
        await moveGameFile(this, file, appid, fresh.status, fresh.achievements_total);
      } catch (e) {
        console.error('[steam-tracker] move', e);
      }
      const g = this.state.games[appid];
      if (g && (g.status !== fresh.status || g.file !== file.path)) {
        g.status = fresh.status;
        g.file = file.path;
        this.scheduleFocusRefresh();
      }
    }, 1500);
  }

  private scheduleFocusRefresh() {
    if (this.focusTimer) window.clearTimeout(this.focusTimer);
    this.focusTimer = window.setTimeout(async () => {
      this.focusTimer = null;
      await updateFocusPage(this);
      await this.saveAll();
    }, 2000);
  }
}

class BacklogModal extends FuzzySuggestModal<UnplayedGame> {
  constructor(
    app: App,
    private plugin: SteamTrackerPlugin
  ) {
    super(app);
    this.setPlaceholder(plugin.t.modalPlaceholder);
  }

  getItems(): UnplayedGame[] {
    const items = this.plugin.state.unplayed || [];
    if (!items.length) new Notice(this.plugin.t.noticeNoUnplayed);
    return items;
  }

  getItemText(item: UnplayedGame): string {
    return item.name;
  }

  onChooseItem(item: UnplayedGame): void {
    this.plugin.syncer.planBacklogGame(item).catch((e) => {
      console.error('[steam-tracker]', e);
      new Notice(this.plugin.t.noticeError(e.message));
    });
  }
}
