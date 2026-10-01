'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  FuzzySuggestModal,
  requestUrl,
  normalizePath,
  moment,
  TFile,
  TFolder,
} = require('obsidian');

const API = 'https://api.steampowered.com';
const STORE_API = 'https://store.steampowered.com/api/appdetails';
const STORE_DELAY_MS = 1500;

const SYNC_START = '<!-- steam-sync:start -->';
const SYNC_END = '<!-- steam-sync:end -->';
const SYNC_RE = /<!-- steam-sync:start -->[\s\S]*?<!-- steam-sync:end -->/;
const STATS_START = '<!-- steam-stats:start -->';
const STATS_END = '<!-- steam-stats:end -->';
const STATS_RE = /<!-- steam-stats:start -->[\s\S]*?<!-- steam-stats:end -->/;
const BACKLOG_START = '<!-- steam-backlog:start -->';
const BACKLOG_END = '<!-- steam-backlog:end -->';
const BACKLOG_RE = /<!-- steam-backlog:start -->[\s\S]*?<!-- steam-backlog:end -->/;

const RECENT_DAYS = 30;
const DASHBOARD_VERSION = 2;
const DASHBOARD_FILE = '_Dashboard.md';

// ---------- Translations ----------

const STRINGS = {
  en: {
    locale: 'en-US',
    decimal: '.',
    steamLanguage: 'english',

    folders: {
      next: '0 Up Next',
      playing: '1 Playing',
      paused: '2 Paused',
      completed: '3 Completed',
      dropped: '4 Dropped',
      noach: '5 No Achievements',
    },
    focusFile: 'Up Next.md',
    dashboardBackup: '_Dashboard (old)',

    ribbonSync: 'Steam: Sync now',
    ribbonFocus: 'Steam: Open Up Next',
    cmdSync: 'Sync now',
    cmdSyncFull: 'Full resync (ignore cache)',
    cmdSyncCurrent: 'Sync this game',
    cmdOpenFocus: 'Open Up Next',
    cmdPlanBacklog: 'Plan a backlog game',
    cmdResetDashboard: 'Reset dashboard',

    statusSyncing: 'Steam: syncing …',
    statusLast: (time) => `Steam: ${time}`,

    noticeDashboardReset: 'Steam: Dashboard regenerated (old one kept as backup).',
    noticeAlreadySyncing: 'Steam sync is already running.',
    noticeConfigure: 'Steam Tracker: Please enter your API key and Steam ID in the settings first.',
    noticeLoadingLibrary: 'Steam: loading library …',
    noticeProgress: (i, n, name) => `Steam: ${i}/${n} – ${name}`,
    noticeSyncDone: (updated, backlog) =>
      `Steam sync finished: ${updated} game(s) updated, ${backlog} in backlog.`,
    noticeStoreLimit: 'Genres: Store rate limit reached, the rest follows on the next sync.',
    noticeErrors: (n, first) => `${n} error(s) – see console.\n${first}`,
    noticeSyncFailed: (msg) => `Steam sync failed: ${msg}`,
    noticeGameUpdated: (name) => `Steam: ${name} updated.`,
    noticePerfect: (name) => `🏆 100 % in ${name}! Congratulations!`,
    noticeWaitForSync: 'Steam sync is running, please wait a moment.',
    noticeNoUnplayed: 'No unplayed games known yet – run a sync first.',
    noticeError: (msg) => `Error: ${msg}`,

    errInvalidKey: 'Invalid Steam API key.',
    errHttp: (status) => `Steam API error (HTTP ${status}).`,
    errNoGames:
      'No games received. Is your profile private? Steam → Edit Profile → Privacy Settings → "Game details: Public".',
    errProfileNotFound: (v) => `Steam profile "${v}" not found. Please enter your SteamID64 or profile URL.`,
    errPrivateAchievements: 'Achievements are private. Steam → Privacy Settings → "Game details: Public".',
    errNotInLibrary: (appid) => `App ${appid} was not found in your library.`,
    privateErrorPattern: /private/i,

    noteStoreLink: 'Steam Store',
    noteAchievementsLink: 'Achievements on Steam',
    noteMyNotes: '## My notes',
    noteAchievements: '## Achievements',
    noteNoAchievements: '*This game has no Steam achievements.*',
    noteProgress: 'Progress',
    noteOpen: (n) => `### Open (${n})`,
    noteDone: (n) => `### Completed (${n})`,
    noteAllDone: '*All done! 🏆*',
    noteHidden: '*(Hidden achievement)*',
    noteRarity: (p) => `*(${p} % of players)*`,
    noteUnlocked: (date) => `unlocked ${date}`,
    notePlaceholder: '*Syncing …*',

    focusTitle: '# 🎯 Up Next',
    focusInfoTitle: '> [!info]- Generated automatically',
    focusInfoText: '> This page is rewritten on every Steam sync – changes made here will be lost.',
    focusLastSync: (time) => `> Last sync: ${time}`,
    focusRecent: '## ▶️ Recently played',
    focusRecentEmpty: '*Nothing played yet.*',
    focusOpenCount: (n) => `${n} open`,
    focusDoneLabel: '🏆 done',
    focusPlanned: '## 📋 Planned next',
    focusPlannedEmpty: '*Nothing planned – use the command "Steam: Plan a backlog game" or set `status: next`.*',
    focusAchCount: (n) => `${n} achievements`,
    focusQuick: '## ⚡ Quick wins',
    focusQuickHint: '*Open achievements that most players have – probably easy ones.*',
    focusNoneFound: '*None found.*',
    focusAlmost: '## 🔥 Almost there',
    focusLeft: (n) => `**${n}** left`,
    focusNone: '*None.*',
    focusDusty: '## 💤 Not touched in a while',
    focusDustyHint: '*Paused games with the most progress.*',
    focusLastPlayed: (date) => `last played ${date}`,

    statsGames: (n) => `🎮 **${n}** games with achievements`,
    statsAchievements: (u, t) => `🏆 **${u}/${t}** achievements`,
    statsPerfect: (n) => `⭐ **${n}** perfect games`,
    statsHours: (n) => `⏱️ **${n}** h played`,
    statsNoAch: (n) => `🚫 **${n}** without achievements`,
    statsUnplayed: (n) => `📦 **${n}** never started`,
    backlogEmpty: '*No unplayed games – nice!*',

    dashTitle: '# 🎮 Gaming Dashboard',
    dashQuickLink: (folder, focusName) => `Quick overview: [[${folder}/${focusName}|🎯 Up Next]]`,
    dashPlaying: '## ▶️ Currently playing',
    dashPlanned: '## 📋 Planned next',
    dashAlmost: '## 🔥 Almost there (≥ 75 %)',
    dashPaused: '## ⏸️ Paused',
    dashPerfect: '## 🏆 100 % completed',
    dashDropped: '## ❌ Dropped',
    dashGenres: '## 🎭 By genre',
    dashBacklog: '## 📦 Backlog – never started',
    dashBacklogHint: '*Use the command "Steam: Plan a backlog game" to move a game to "Up Next".*',
    dashNoAch: '> [!note]- 🚫 No achievements',
    colGame: 'Game',
    colProgress: 'Progress',
    colAchievements: 'Achievements',
    colPlaytime: 'Playtime',
    colLastPlayed: 'Last played',
    colGenre: 'Genre',
    colGames: 'Games',
    colTitles: 'Titles',
    colStatus: 'Status',

    modalPlaceholder: 'Which unplayed game do you want to tackle next?',

    setUiLanguage: 'Plugin language',
    setUiLanguageDesc:
      'Language of notes, folders, dashboard and settings. Changing it moves your notes into the translated folders on the next sync; command names update after reloading Obsidian.',
    setUiAuto: 'Automatic (Obsidian language)',
    setApiKey: 'Steam API key',
    setApiKeyDescPre: 'Free at ',
    setApiKeyDescPost: '. Stored in plain text in the plugin’s data.json.',
    setProfile: 'Steam profile',
    setProfileDesc: 'SteamID64 (17 digits), profile URL or custom profile name (steamcommunity.com/id/<name>).',
    setFolder: 'Folder',
    setFolderDesc: 'Game notes (in status subfolders), the dashboard and "Up Next" are created here.',
    setSteamLanguage: 'Steam language',
    setSteamLanguageDesc:
      'Language for achievement names and genres (Steam language code, e.g. english, german). Leave empty to match the plugin language.',
    setSyncOnStartup: 'Sync on startup',
    setInterval: 'Auto-sync interval (minutes)',
    setIntervalDesc: '0 = off. Only runs while Obsidian is open.',
    setStaleDays: 'Days until automatically paused',
    setStaleDaysDesc: (folder) =>
      `Games with status "playing" that haven't been played for this long move to "${folder}". 0 = off.`,
    setShowHidden: 'Show descriptions of hidden achievements',
    setShowHiddenDesc: 'Off = no spoilers for open hidden achievements.',
    setSync: 'Sync',
    setSyncNow: 'Sync now',
    setSyncFull: 'Full resync',
  },

  de: {
    locale: 'de-DE',
    decimal: ',',
    steamLanguage: 'german',

    folders: {
      next: '0 Als Nächstes',
      playing: '1 Aktiv',
      paused: '2 Pausiert',
      completed: '3 Abgeschlossen',
      dropped: '4 Abgebrochen',
      noach: '5 Ohne Achievements',
    },
    focusFile: 'Als Nächstes.md',
    dashboardBackup: '_Dashboard (alt)',

    ribbonSync: 'Steam: Jetzt synchronisieren',
    ribbonFocus: 'Steam: „Als Nächstes“ öffnen',
    cmdSync: 'Jetzt synchronisieren',
    cmdSyncFull: 'Alles neu synchronisieren (ignoriert Cache)',
    cmdSyncCurrent: 'Dieses Spiel synchronisieren',
    cmdOpenFocus: '„Als Nächstes“ öffnen',
    cmdPlanBacklog: 'Backlog-Spiel einplanen',
    cmdResetDashboard: 'Dashboard zurücksetzen',

    statusSyncing: 'Steam: synchronisiere …',
    statusLast: (time) => `Steam: ${time}`,

    noticeDashboardReset: 'Steam: Dashboard neu erzeugt (altes als Backup gesichert).',
    noticeAlreadySyncing: 'Steam-Sync läuft bereits.',
    noticeConfigure: 'Steam Tracker: Bitte zuerst API-Key und SteamID in den Einstellungen eintragen.',
    noticeLoadingLibrary: 'Steam: lade Bibliothek …',
    noticeProgress: (i, n, name) => `Steam: ${i}/${n} – ${name}`,
    noticeSyncDone: (updated, backlog) =>
      `Steam-Sync fertig: ${updated} Spiel(e) aktualisiert, ${backlog} im Backlog.`,
    noticeStoreLimit: 'Genres: Store-Limit erreicht, der Rest folgt beim nächsten Sync.',
    noticeErrors: (n, first) => `${n} Fehler – siehe Konsole.\n${first}`,
    noticeSyncFailed: (msg) => `Steam-Sync fehlgeschlagen: ${msg}`,
    noticeGameUpdated: (name) => `Steam: ${name} aktualisiert.`,
    noticePerfect: (name) => `🏆 100 % in ${name}! Glückwunsch!`,
    noticeWaitForSync: 'Steam-Sync läuft gerade, bitte kurz warten.',
    noticeNoUnplayed: 'Keine ungespielten Spiele bekannt – erst synchronisieren.',
    noticeError: (msg) => `Fehler: ${msg}`,

    errInvalidKey: 'Steam-API-Key ungültig.',
    errHttp: (status) => `Steam-API-Fehler (HTTP ${status}).`,
    errNoGames:
      'Keine Spiele erhalten. Ist dein Profil privat? Steam → Profil bearbeiten → Privatsphäre → „Spieldetails: Öffentlich“.',
    errProfileNotFound: (v) => `Steam-Profil „${v}“ nicht gefunden. Bitte SteamID64 oder Profil-URL eintragen.`,
    errPrivateAchievements: 'Achievements privat. Steam → Privatsphäre → „Spieldetails: Öffentlich“.',
    errNotInLibrary: (appid) => `App ${appid} nicht in deiner Bibliothek gefunden.`,
    privateErrorPattern: /privat/i,

    noteStoreLink: 'Steam-Store',
    noteAchievementsLink: 'Achievements auf Steam',
    noteMyNotes: '## Meine Notizen',
    noteAchievements: '## Achievements',
    noteNoAchievements: '*Dieses Spiel hat keine Steam-Achievements.*',
    noteProgress: 'Fortschritt',
    noteOpen: (n) => `### Offen (${n})`,
    noteDone: (n) => `### Erledigt (${n})`,
    noteAllDone: '*Alles erledigt! 🏆*',
    noteHidden: '*(Verstecktes Achievement)*',
    noteRarity: (p) => `*(${p} % der Spieler)*`,
    noteUnlocked: (date) => `freigeschaltet ${date}`,
    notePlaceholder: '*Wird synchronisiert …*',

    focusTitle: '# 🎯 Als Nächstes',
    focusInfoTitle: '> [!info]- Automatisch erzeugt',
    focusInfoText: '> Diese Seite wird bei jedem Steam-Sync neu geschrieben – Änderungen hier gehen verloren.',
    focusLastSync: (time) => `> Letzter Sync: ${time}`,
    focusRecent: '## ▶️ Zuletzt gespielt',
    focusRecentEmpty: '*Noch nichts gespielt.*',
    focusOpenCount: (n) => `${n} offen`,
    focusDoneLabel: '🏆 fertig',
    focusPlanned: '## 📋 Als Nächstes geplant',
    focusPlannedEmpty: '*Nichts geplant – Befehl „Steam: Backlog-Spiel einplanen“ oder `status: next` setzen.*',
    focusAchCount: (n) => `${n} Achievements`,
    focusQuick: '## ⚡ Quick Wins',
    focusQuickHint: '*Offene Achievements, die die meisten Spieler haben – also vermutlich leicht.*',
    focusNoneFound: '*Keine gefunden.*',
    focusAlmost: '## 🔥 Fast geschafft',
    focusLeft: (n) => `noch **${n}**`,
    focusNone: '*Keine.*',
    focusDusty: '## 💤 Lange nicht angefasst',
    focusDustyHint: '*Pausierte Spiele mit dem meisten Fortschritt.*',
    focusLastPlayed: (date) => `zuletzt ${date}`,

    statsGames: (n) => `🎮 **${n}** Spiele mit Achievements`,
    statsAchievements: (u, t) => `🏆 **${u}/${t}** Achievements`,
    statsPerfect: (n) => `⭐ **${n}** Perfect Games`,
    statsHours: (n) => `⏱️ **${n}** h gespielt`,
    statsNoAch: (n) => `🚫 **${n}** ohne Achievements`,
    statsUnplayed: (n) => `📦 **${n}** nie gestartet`,
    backlogEmpty: '*Keine ungespielten Spiele – stark!*',

    dashTitle: '# 🎮 Gaming Dashboard',
    dashQuickLink: (folder, focusName) => `Schneller Überblick: [[${folder}/${focusName}|🎯 Als Nächstes]]`,
    dashPlaying: '## ▶️ Aktuell am Spielen',
    dashPlanned: '## 📋 Als Nächstes geplant',
    dashAlmost: '## 🔥 Fast geschafft (≥ 75 %)',
    dashPaused: '## ⏸️ Pausiert',
    dashPerfect: '## 🏆 100 % abgeschlossen',
    dashDropped: '## ❌ Abgebrochen',
    dashGenres: '## 🎭 Nach Genre',
    dashBacklog: '## 📦 Backlog – nie gestartet',
    dashBacklogHint: '*Mit dem Befehl „Steam: Backlog-Spiel einplanen“ holst du ein Spiel nach „Als Nächstes“.*',
    dashNoAch: '> [!note]- 🚫 Ohne Achievements',
    colGame: 'Spiel',
    colProgress: 'Fortschritt',
    colAchievements: 'Achievements',
    colPlaytime: 'Spielzeit',
    colLastPlayed: 'Zuletzt gespielt',
    colGenre: 'Genre',
    colGames: 'Spiele',
    colTitles: 'Titel',
    colStatus: 'Status',

    modalPlaceholder: 'Welches ungespielte Spiel willst du als Nächstes angehen?',

    setUiLanguage: 'Sprache des Plugins',
    setUiLanguageDesc:
      'Sprache von Notes, Ordnern, Dashboard und Einstellungen. Beim Wechsel werden die Notes beim nächsten Sync in die übersetzten Ordner verschoben; Befehlsnamen ändern sich nach einem Neustart von Obsidian.',
    setUiAuto: 'Automatisch (Obsidian-Sprache)',
    setApiKey: 'Steam-API-Key',
    setApiKeyDescPre: 'Kostenlos unter ',
    setApiKeyDescPost: '. Wird im Klartext in der data.json des Plugins gespeichert.',
    setProfile: 'Steam-Profil',
    setProfileDesc: 'SteamID64 (17 Ziffern), Profil-URL oder eigener Profilname (steamcommunity.com/id/<name>).',
    setFolder: 'Ordner',
    setFolderDesc: 'Hier werden die Spiel-Notes (in Status-Unterordnern), das Dashboard und „Als Nächstes“ angelegt.',
    setSteamLanguage: 'Steam-Sprache',
    setSteamLanguageDesc:
      'Sprache für Achievement-Namen und Genres (Steam-Sprachcode, z. B. german, english). Leer lassen = passend zur Plugin-Sprache.',
    setSyncOnStartup: 'Beim Start synchronisieren',
    setInterval: 'Auto-Sync-Intervall (Minuten)',
    setIntervalDesc: '0 = aus. Läuft nur, solange Obsidian geöffnet ist.',
    setStaleDays: 'Tage bis automatisch pausiert',
    setStaleDaysDesc: (folder) =>
      `Spiele mit Status „playing“, die so lange nicht gespielt wurden, wandern nach „${folder}“. 0 = aus.`,
    setShowHidden: 'Beschreibungen versteckter Achievements zeigen',
    setShowHiddenDesc: 'Aus = keine Spoiler bei offenen, versteckten Achievements.',
    setSync: 'Synchronisieren',
    setSyncNow: 'Jetzt synchronisieren',
    setSyncFull: 'Alles neu',
  },
};

const DEFAULT_SETTINGS = {
  uiLanguage: 'auto',
  apiKey: '',
  steamId: '',
  folder: 'Games',
  language: '',
  syncOnStartup: true,
  intervalMinutes: 60,
  staleDays: 30,
  showHiddenDescriptions: false,
};

// ---------- Helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

function fmtDate(unix) {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
}

function oneLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function tagSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

function replaceOrAppend(content, regex, block) {
  if (regex.test(content)) return content.replace(regex, () => block);
  return content.replace(/\s*$/, '') + '\n\n' + block + '\n';
}

// ---------- Plugin ----------

module.exports = class SteamTrackerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.syncing = false;
    this.intervalId = null;
    this.moveTimers = {};
    this.focusTimer = null;

    this.statusBar = this.addStatusBarItem();
    this.updateStatusBar();

    const t = this.t;
    this.addRibbonIcon('gamepad-2', t.ribbonSync, () => this.syncAll(false));
    this.addRibbonIcon('list-todo', t.ribbonFocus, () => this.openFocusPage());

    this.addCommand({ id: 'sync-now', name: t.cmdSync, callback: () => this.syncAll(false) });
    this.addCommand({ id: 'sync-full', name: t.cmdSyncFull, callback: () => this.syncAll(true) });
    this.addCommand({
      id: 'sync-current',
      name: t.cmdSyncCurrent,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const appid = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
        if (!appid) return false;
        if (!checking) this.syncSingle(file, Number(appid));
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
        await this.updateDashboard(this.state.unplayed || [], true);
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
          if (g.file === oldPath) g.file = file.path;
        }
      })
    );

    this.addSettingTab(new SteamTrackerSettingTab(this.app, this));
    this.setupInterval();

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup && this.isConfigured()) {
        // give the metadata cache a moment to build
        setTimeout(() => this.syncAll(false), 3000);
      }
    });
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    Object.values(this.moveTimers).forEach((timer) => clearTimeout(timer));
    if (this.focusTimer) clearTimeout(this.focusTimer);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    const saved = data.settings || null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // Installs from before the translation were German-only – keep them German.
    if (saved && saved.uiLanguage === undefined) this.settings.uiLanguage = 'de';
    this.state = Object.assign(
      { games: {}, unplayed: [], lastSync: null, resolvedSteamId: null, dashboardVersion: 1, dashboardLang: 'de' },
      data.state
    );
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, state: this.state });
  }

  get lang() {
    const ui = this.settings.uiLanguage;
    if (ui === 'de' || ui === 'en') return ui;
    const locale = (moment.locale() || 'en').toLowerCase();
    return locale.startsWith('de') ? 'de' : 'en';
  }

  get t() {
    return STRINGS[this.lang];
  }

  get steamLanguage() {
    return this.settings.language || this.t.steamLanguage;
  }

  get baseFolder() {
    return normalizePath(this.settings.folder);
  }

  get focusPath() {
    return normalizePath(`${this.baseFolder}/${this.t.focusFile}`);
  }

  fmtPercent(p) {
    return Number(p).toFixed(1).replace('.', this.t.decimal);
  }

  hiddenAwareDescription(a) {
    if (a.hidden && !this.settings.showHiddenDescriptions) return this.t.noteHidden;
    if (!a.description) return a.hidden ? this.t.noteHidden : '';
    return a.description;
  }

  setupInterval() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    this.intervalId = null;
    const minutes = Number(this.settings.intervalMinutes);
    if (minutes > 0) {
      this.intervalId = window.setInterval(() => {
        if (this.isConfigured()) this.syncAll(false, true);
      }, minutes * 60 * 1000);
      this.registerInterval(this.intervalId);
    }
  }

  isConfigured() {
    return Boolean(this.settings.apiKey && this.settings.steamId);
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
    if (!this.app.vault.getAbstractFileByPath(this.focusPath)) await this.updateFocusPage();
    await this.app.workspace.openLinkText(this.focusPath, '', false);
  }

  // ---------- Steam API ----------

  async api(path, params) {
    const qs = new URLSearchParams(Object.assign({ key: this.settings.apiKey, format: 'json' }, params));
    const res = await requestUrl({ url: `${API}/${path}/?${qs.toString()}`, throw: false });
    let json = null;
    try {
      json = res.json;
    } catch (e) {
      json = null;
    }
    return { status: res.status, json };
  }

  async getSteamId() {
    const input = this.settings.steamId.trim();
    if (/^\d{17}$/.test(input)) return input;
    const m = input.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/);
    if (m && m[1] === 'profiles') return m[2];
    const vanity = m ? m[2] : input;
    if (this.state.resolvedSteamId && this.state.resolvedSteamId.vanity === vanity) {
      return this.state.resolvedSteamId.id;
    }
    const { json } = await this.api('ISteamUser/ResolveVanityURL/v0001', { vanityurl: vanity });
    if (json?.response?.success === 1) {
      this.state.resolvedSteamId = { vanity, id: json.response.steamid };
      return json.response.steamid;
    }
    throw new Error(this.t.errProfileNotFound(vanity));
  }

  async getOwnedGames(steamid) {
    const { status, json } = await this.api('IPlayerService/GetOwnedGames/v0001', {
      steamid,
      include_appinfo: 1,
      include_played_free_games: 1,
    });
    if (status === 401 || status === 403) throw new Error(this.t.errInvalidKey);
    if (status !== 200 || !json) throw new Error(this.t.errHttp(status));
    const games = json.response?.games;
    if (!games) throw new Error(this.t.errNoGames);
    return games;
  }

  async getAchievements(appid, steamid) {
    const lang = this.steamLanguage;
    const schemaRes = await this.api('ISteamUserStats/GetSchemaForGame/v2', { appid, l: lang });
    const schemaList = schemaRes.json?.game?.availableGameStats?.achievements || [];
    if (schemaList.length === 0) return [];

    const playerRes = await this.api('ISteamUserStats/GetPlayerAchievements/v0001', { appid, steamid, l: lang });
    const ps = playerRes.json?.playerstats;
    if (ps && ps.success === false && /not public/i.test(ps.error || '')) {
      throw new Error(this.t.errPrivateAchievements);
    }
    const playerMap = new Map((ps?.achievements || []).map((a) => [a.apiname, a]));

    const globalRes = await this.api('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002', {
      gameid: appid,
    });
    const globalList = globalRes.json?.achievementpercentages?.achievements || [];
    const rarity = new Map(globalList.map((a) => [a.name, Number(a.percent)]));

    return schemaList.map((s) => {
      const p = playerMap.get(s.name);
      return {
        apiname: s.name,
        name: oneLine(s.displayName || p?.name || s.name),
        description: oneLine(s.description || p?.description || ''),
        hidden: s.hidden === 1,
        icon: s.icon,
        icongray: s.icongray,
        achieved: p?.achieved === 1,
        unlocktime: p?.unlocktime || 0,
        percent: rarity.has(s.name) ? rarity.get(s.name) : null,
      };
    });
  }

  /** Genres etc. from the store. Returns null when rate-limited, {} when nothing was found. */
  async getStoreDetails(appid, ctx) {
    const wait = ctx.lastStoreCall + STORE_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    ctx.lastStoreCall = Date.now();
    const res = await requestUrl({
      url: `${STORE_API}?appids=${appid}&l=${encodeURIComponent(this.steamLanguage)}`,
      throw: false,
    });
    if (res.status === 429 || res.status === 403) return null;
    let json = null;
    try {
      json = res.json;
    } catch (e) {
      json = null;
    }
    const entry = json?.[appid];
    if (!entry?.success || !entry.data) return {};
    const d = entry.data;
    const year = (d.release_date?.date || '').match(/\d{4}/);
    return {
      genres: (d.genres || []).map((g) => oneLine(g.description)).filter(Boolean),
      developer: (d.developers || [])[0] || null,
      release_year: year ? Number(year[0]) : null,
      metacritic: d.metacritic?.score || null,
    };
  }

  // ---------- Status & folders ----------

  decideStatus(cur, info) {
    const { perfect, playedAgain, lastPlayed } = info;
    const now = Date.now() / 1000;
    if (!cur) {
      if (perfect) return 'completed';
      return lastPlayed && now - lastPlayed < RECENT_DAYS * 86400 ? 'playing' : 'paused';
    }
    if (cur === 'dropped') return cur;
    if (perfect && (cur === 'playing' || cur === 'paused' || cur === 'next')) return 'completed';
    if (playedAgain && (cur === 'paused' || cur === 'next' || cur === 'backlog')) return 'playing';
    const stale = Number(this.settings.staleDays);
    if (cur === 'playing' && stale > 0 && lastPlayed && now - lastPlayed > stale * 86400) return 'paused';
    return cur;
  }

  async moveGameFile(file, appid, status, total) {
    const folders = this.t.folders;
    const sub = total === 0 ? folders.noach : folders[status];
    if (!sub) return file;
    const dir = normalizePath(`${this.baseFolder}/${sub}`);
    if (file.parent?.path === dir) return file;
    await this.ensureFolder(dir);
    let target = normalizePath(`${dir}/${file.name}`);
    if (this.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${dir}/${file.basename} (${appid}).md`);
      if (this.app.vault.getAbstractFileByPath(target)) return file;
    }
    await this.app.fileManager.renameFile(file, target);
    return file;
  }

  /** After a language switch: remove the other language's empty status folders and stale focus page. */
  async cleanUpOtherLanguages() {
    for (const [code, strings] of Object.entries(STRINGS)) {
      if (code === this.lang) continue;
      for (const sub of Object.values(strings.folders)) {
        if (Object.values(this.t.folders).includes(sub)) continue;
        const folder = this.app.vault.getAbstractFileByPath(normalizePath(`${this.baseFolder}/${sub}`));
        if (folder instanceof TFolder && folder.children.length === 0) {
          await this.app.vault.delete(folder);
        }
      }
      if (strings.focusFile !== this.t.focusFile) {
        const oldFocus = this.app.vault.getAbstractFileByPath(normalizePath(`${this.baseFolder}/${strings.focusFile}`));
        if (oldFocus instanceof TFile) await this.app.vault.trash(oldFocus, true);
      }
    }
  }

  onMetadataChanged(file, cache) {
    if (this.syncing) return;
    if (!file.path.startsWith(this.baseFolder + '/')) return;
    const fm = cache?.frontmatter;
    if (!fm?.appid) return;
    clearTimeout(this.moveTimers[file.path]);
    this.moveTimers[file.path] = setTimeout(async () => {
      delete this.moveTimers[file.path];
      if (this.syncing) return;
      const fresh = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fresh?.appid) return;
      const appid = Number(fresh.appid);
      try {
        await this.moveGameFile(file, appid, fresh.status, fresh.achievements_total);
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

  scheduleFocusRefresh() {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(async () => {
      this.focusTimer = null;
      await this.updateFocusPage();
      await this.saveAll();
    }, 2000);
  }

  // ---------- Sync ----------

  async syncAll(force, silent = false) {
    const t = this.t;
    if (this.syncing) {
      if (!silent) new Notice(t.noticeAlreadySyncing);
      return;
    }
    if (!this.isConfigured()) {
      new Notice(t.noticeConfigure);
      return;
    }
    this.syncing = true;
    this.updateStatusBar();
    const notice = silent ? null : new Notice(t.noticeLoadingLibrary, 0);
    const errors = [];
    let updated = 0;
    const ctx = { storeOk: true, lastStoreCall: 0 };

    try {
      const steamid = await this.getSteamId();
      const games = await this.getOwnedGames(steamid);
      await this.ensureFolder(this.baseFolder);
      const fileMap = this.buildFileMap();

      const candidates = games.filter((g) => g.playtime_forever > 0 || fileMap.has(g.appid));

      for (let i = 0; i < candidates.length; i++) {
        const game = candidates[i];
        const mode = this.syncMode(game, fileMap, force);
        notice?.setMessage(t.noticeProgress(i + 1, candidates.length, game.name));
        try {
          const didWork = await this.processGame(game, steamid, fileMap, mode, ctx);
          if (didWork) updated++;
        } catch (e) {
          console.error('[steam-tracker]', game.name, e);
          errors.push(`${game.name}: ${e.message}`);
          if (t.privateErrorPattern.test(e.message)) break;
        }
        if (mode === 'full') await sleep(150);
      }

      const unplayed = games
        .filter((g) => !g.playtime_forever && !fileMap.has(g.appid))
        .map((g) => ({ appid: g.appid, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.state.unplayed = unplayed;

      this.state.lastSync = Date.now();
      await this.updateDashboard(unplayed, false);
      await this.updateFocusPage();
      await this.cleanUpOtherLanguages();
      await this.saveAll();

      let msg = t.noticeSyncDone(updated, unplayed.length);
      if (!ctx.storeOk) msg += '\n' + t.noticeStoreLimit;
      if (errors.length) msg += '\n' + t.noticeErrors(errors.length, errors[0]);
      if (notice) {
        notice.setMessage(msg);
        setTimeout(() => notice.hide(), 6000);
      }
    } catch (e) {
      console.error('[steam-tracker]', e);
      if (notice) notice.hide();
      new Notice(t.noticeSyncFailed(e.message), 10000);
    } finally {
      this.syncing = false;
      this.updateStatusBar();
    }
  }

  /** full = load achievements, light = playtime only (games without achievements), none = only check status/folder */
  syncMode(game, fileMap, force) {
    const prev = this.state.games[game.appid];
    if (force || !prev || !fileMap.has(game.appid) || prev.total == null) return 'full';
    if (prev.total === 0) return prev.playtime !== game.playtime_forever ? 'light' : 'none';
    if (prev.playtime !== game.playtime_forever || !prev.openTop) return 'full';
    return 'none';
  }

  async syncSingle(file, appid) {
    const t = this.t;
    if (this.syncing) return new Notice(t.noticeAlreadySyncing);
    if (!this.isConfigured()) return new Notice(t.noticeConfigure);
    this.syncing = true;
    this.updateStatusBar();
    try {
      const steamid = await this.getSteamId();
      const games = await this.getOwnedGames(steamid);
      const game = games.find((g) => g.appid === appid);
      if (!game) throw new Error(t.errNotInLibrary(appid));
      const fileMap = new Map([[appid, file]]);
      await this.processGame(game, steamid, fileMap, 'full', { storeOk: true, lastStoreCall: 0 });
      await this.updateFocusPage();
      await this.saveAll();
      new Notice(t.noticeGameUpdated(game.name));
    } catch (e) {
      new Notice(t.noticeSyncFailed(e.message), 10000);
    } finally {
      this.syncing = false;
      this.updateStatusBar();
    }
  }

  buildFileMap() {
    const folder = this.baseFolder;
    const map = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(folder + '/')) continue;
      const appid = this.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
      if (appid) map.set(Number(appid), file);
    }
    return map;
  }

  async ensureFolder(folder) {
    const path = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
  }

  /** Returns true if anything was written. */
  async processGame(game, steamid, fileMap, mode, ctx) {
    const appid = game.appid;
    const prev = this.state.games[appid] || null;
    const hours = Math.round((game.playtime_forever / 60) * 10) / 10;
    const lastPlayed = game.rtime_last_played || 0;
    const cover = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
    const playedAgain = Boolean(prev && game.playtime_forever > prev.playtime);

    let file = fileMap.get(appid);
    const cachedFm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {};

    // Achievements
    let total, unlocked, perfect, openTop;
    if (mode === 'full') {
      const achievements = await this.getAchievements(appid, steamid);
      total = achievements.length;
      unlocked = achievements.filter((a) => a.achieved).length;
      perfect = total > 0 && unlocked === total;
      openTop = achievements
        .filter((a) => !a.achieved)
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
        .slice(0, 5)
        .map((a) => ({ name: a.name, percent: a.percent, desc: truncate(this.hiddenAwareDescription(a), 110) }));
      const section = this.buildSection(achievements, unlocked, total);
      if (!file) {
        file = await this.createNote(game, cover, section);
        fileMap.set(appid, file);
      } else {
        await this.app.vault.process(file, (content) => replaceOrAppend(content, SYNC_RE, section));
      }
    } else {
      total = prev.total;
      unlocked = prev.unlocked;
      perfect = prev.perfect;
      openTop = prev.openTop || [];
    }

    // Genres (once per game)
    let store = null;
    if (ctx.storeOk && cachedFm.genres === undefined) {
      store = await this.getStoreDetails(appid, ctx);
      if (store === null) ctx.storeOk = false;
    }

    // Status: a note without a status (new note) gets a starting value
    const statusInfo = { perfect, playedAgain, lastPlayed };
    const newStatus = this.decideStatus(cachedFm.status, statusInfo);

    const needsFrontmatter = mode !== 'none' || newStatus !== cachedFm.status || Boolean(store);
    let finalStatus = newStatus;
    if (needsFrontmatter) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.appid = appid;
        fm.title = game.name;
        fm.status = this.decideStatus(fm.status, statusInfo);
        finalStatus = fm.status;
        fm.playtime_hours = hours;
        fm.achievements_unlocked = unlocked;
        fm.achievements_total = total;
        fm.completion = total ? Math.floor((unlocked / total) * 100) : null;
        fm.last_played = fmtDate(lastPlayed);
        fm.perfect = perfect;
        fm.cover = cover;
        if (store) {
          fm.genres = store.genres || [];
          if (store.developer) fm.developer = store.developer;
          if (store.release_year) fm.release_year = store.release_year;
          if (store.metacritic) fm.metacritic = store.metacritic;
          const tags = Array.isArray(fm.tags) ? fm.tags.slice() : fm.tags ? String(fm.tags).split(/[\s,]+/) : [];
          const clean = new Set(tags.map((tag) => String(tag).replace(/^#/, '')).filter(Boolean));
          clean.add('game');
          for (const g of store.genres || []) {
            const slug = tagSlug(g);
            if (slug) clean.add(`genre/${slug}`);
          }
          fm.tags = Array.from(clean);
        }
      });
    }

    await this.moveGameFile(file, appid, finalStatus, total);

    if (perfect && prev && prev.perfect === false) {
      new Notice(this.t.noticePerfect(game.name), 10000);
    }

    this.state.games[appid] = {
      name: game.name,
      playtime: game.playtime_forever,
      hours,
      lastPlayed,
      unlocked,
      total,
      perfect,
      openTop,
      status: finalStatus,
      file: file.path,
    };
    return Boolean(needsFrontmatter);
  }

  async createNote(game, cover, section) {
    const t = this.t;
    const folder = this.baseFolder;
    const base = sanitizeFileName(game.name);
    let path = normalizePath(`${folder}/${base}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) {
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
    return this.app.vault.create(path, body);
  }

  buildSection(achievements, unlocked, total) {
    const t = this.t;
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
      const desc = this.hiddenAwareDescription(a);
      const rarity = a.percent != null ? ' ' + t.noteRarity(this.fmtPercent(a.percent)) : '';
      const icon = a.icongray ? `![icon|32](${a.icongray}) ` : '';
      lines.push(`- [ ] ${icon}**${a.name}**${desc ? ': ' + desc : ''}${rarity}`);
    }

    lines.push('');
    lines.push(t.noteDone(done.length));
    for (const a of done) {
      const date = fmtDate(a.unlocktime);
      const parts = [];
      if (date) parts.push(t.noteUnlocked(date));
      if (a.percent != null) parts.push(`${this.fmtPercent(a.percent)} %`);
      const meta = parts.length ? ` *(${parts.join(', ')})*` : '';
      const icon = a.icon ? `![icon|32](${a.icon}) ` : '';
      lines.push(`- [x] ${icon}**${a.name}**${a.description ? ': ' + a.description : ''}${meta}`);
    }

    lines.push(SYNC_END);
    return lines.join('\n');
  }

  // ---------- Plan a backlog game ----------

  async planBacklogGame(item) {
    if (this.syncing) return new Notice(this.t.noticeWaitForSync);
    await this.ensureFolder(this.baseFolder);
    const cover = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.appid}/header.jpg`;
    const placeholder = `${SYNC_START}\n${this.t.notePlaceholder}\n${SYNC_END}`;
    const file = await this.createNote(item, cover, placeholder);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.appid = item.appid;
      fm.title = item.name;
      fm.status = 'next';
    });
    this.state.unplayed = (this.state.unplayed || []).filter((g) => g.appid !== item.appid);
    // wait for the metadata cache, then load achievements & genres
    await sleep(500);
    await this.syncSingle(file, item.appid);
    await this.updateDashboard(this.state.unplayed, false);
    await this.saveAll();
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // ---------- Focus page ----------

  gameLink(g) {
    const name = (g.name || '').replace(/[|[\]]/g, '-');
    if (!g.file) return name;
    return `[[${g.file.replace(/\.md$/, '')}|${name}]]`;
  }

  async updateFocusPage() {
    const t = this.t;
    const all = Object.values(this.state.games).filter((g) => g.file);
    const withAch = all.filter((g) => g.total > 0);
    const progress = (g) => `<progress value="${g.unlocked}" max="${g.total}"></progress> ${g.unlocked}/${g.total}`;
    const pct = (g) => (g.total ? Math.floor((g.unlocked / g.total) * 100) : 0);
    const lastSync = this.state.lastSync ? new Date(this.state.lastSync).toLocaleString(t.locale) : '–';

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
        `- ${this.gameLink(g)} · ${progress(g)} · ${open ? t.focusOpenCount(open) : t.focusDoneLabel} · ${g.hours} h · ${fmtDate(g.lastPlayed)}`
      );
    }
    lines.push('');

    // 2. Planned
    const planned = withAch.filter((g) => g.status === 'next').sort((a, b) => a.name.localeCompare(b.name));
    lines.push(t.focusPlanned);
    if (!planned.length) lines.push(t.focusPlannedEmpty);
    for (const g of planned) lines.push(`- ${this.gameLink(g)} · ${t.focusAchCount(g.total)}`);
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
      lines.push(`- **${a.name}** (${this.fmtPercent(a.percent)} %) – ${this.gameLink(g)}${a.desc ? ': ' + a.desc : ''}`);
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
      lines.push(`- ${this.gameLink(g)} – ${t.focusLeft(g.total - g.unlocked)} · ${progress(g)} (${pct(g)} %)`);
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
      lines.push(
        `- ${this.gameLink(g)} · ${progress(g)} (${pct(g)} %) · ${t.focusLastPlayed(fmtDate(g.lastPlayed) || '–')}`
      );
    }
    lines.push('');

    const content = lines.join('\n');
    const existing = this.app.vault.getAbstractFileByPath(this.focusPath);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(this.focusPath, content);
  }

  // ---------- Dashboard ----------

  async updateDashboard(unplayed, forceReset) {
    const t = this.t;
    const folder = this.baseFolder;
    const path = normalizePath(`${folder}/${DASHBOARD_FILE}`);

    const games = Object.values(this.state.games);
    const withAch = games.filter((g) => g.total > 0);
    const sum = (list, fn) => list.reduce((s, g) => s + (fn(g) || 0), 0);
    const statsBlock = [
      STATS_START,
      [
        t.statsGames(withAch.length),
        t.statsAchievements(sum(withAch, (g) => g.unlocked), sum(withAch, (g) => g.total)),
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

    let existing = this.app.vault.getAbstractFileByPath(path);
    const outdated =
      (this.state.dashboardVersion || 1) < DASHBOARD_VERSION || (this.state.dashboardLang || 'de') !== this.lang;
    if (existing instanceof TFile && (forceReset || outdated)) {
      let backup = normalizePath(`${folder}/${t.dashboardBackup}.md`);
      if (this.app.vault.getAbstractFileByPath(backup)) {
        backup = normalizePath(`${folder}/${t.dashboardBackup} ${Date.now()}.md`);
      }
      await this.app.fileManager.renameFile(existing, backup);
      existing = null;
    }

    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => {
        let c = replaceOrAppend(content, STATS_RE, statsBlock);
        c = replaceOrAppend(c, BACKLOG_RE, backlogBlock);
        return c;
      });
      return;
    }

    const progressCol =
      `"<progress value='" + achievements_unlocked + "' max='" + achievements_total + "'></progress> " + completion + " %" AS "${t.colProgress}"`;

    const table = (where, sort) =>
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

    await this.app.vault.create(path, content);
    this.state.dashboardVersion = DASHBOARD_VERSION;
    this.state.dashboardLang = this.lang;
  }
};

// ---------- Backlog picker ----------

class BacklogModal extends FuzzySuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder(plugin.t.modalPlaceholder);
  }

  getItems() {
    const items = this.plugin.state.unplayed || [];
    if (!items.length) new Notice(this.plugin.t.noticeNoUnplayed);
    return items;
  }

  getItemText(item) {
    return item.name;
  }

  onChooseItem(item) {
    this.plugin.planBacklogGame(item).catch((e) => {
      console.error('[steam-tracker]', e);
      new Notice(this.plugin.t.noticeError(e.message));
    });
  }
}

// ---------- Settings tab ----------

class SteamTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const t = this.plugin.t;
    containerEl.empty();

    const save = async () => {
      await this.plugin.saveAll();
    };

    new Setting(containerEl)
      .setName(t.setUiLanguage)
      .setDesc(t.setUiLanguageDesc)
      .addDropdown((d) =>
        d
          .addOption('auto', t.setUiAuto)
          .addOption('en', 'English')
          .addOption('de', 'Deutsch')
          .setValue(s.uiLanguage)
          .onChange(async (v) => {
            s.uiLanguage = v;
            await save();
            this.plugin.updateStatusBar();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t.setApiKey)
      .setDesc(
        createFragment((f) => {
          f.appendText(t.setApiKeyDescPre);
          f.createEl('a', { text: 'steamcommunity.com/dev/apikey', href: 'https://steamcommunity.com/dev/apikey' });
          f.appendText(t.setApiKeyDescPost);
        })
      )
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
          .setValue(s.apiKey)
          .onChange(async (v) => {
            s.apiKey = v.trim();
            await save();
          });
      });

    new Setting(containerEl)
      .setName(t.setProfile)
      .setDesc(t.setProfileDesc)
      .addText((text) =>
        text.setValue(s.steamId).onChange(async (v) => {
          s.steamId = v.trim();
          await save();
        })
      );

    new Setting(containerEl)
      .setName(t.setFolder)
      .setDesc(t.setFolderDesc)
      .addText((text) =>
        text.setValue(s.folder).onChange(async (v) => {
          s.folder = v.trim() || 'Games';
          await save();
        })
      );

    new Setting(containerEl)
      .setName(t.setSteamLanguage)
      .setDesc(t.setSteamLanguageDesc)
      .addText((text) =>
        text
          .setPlaceholder(t.steamLanguage)
          .setValue(s.language)
          .onChange(async (v) => {
            s.language = v.trim();
            await save();
          })
      );

    new Setting(containerEl).setName(t.setSyncOnStartup).addToggle((toggle) =>
      toggle.setValue(s.syncOnStartup).onChange(async (v) => {
        s.syncOnStartup = v;
        await save();
      })
    );

    new Setting(containerEl)
      .setName(t.setInterval)
      .setDesc(t.setIntervalDesc)
      .addText((text) =>
        text.setValue(String(s.intervalMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.intervalMinutes = Number.isFinite(n) && n >= 0 ? n : 60;
          await save();
          this.plugin.setupInterval();
        })
      );

    new Setting(containerEl)
      .setName(t.setStaleDays)
      .setDesc(t.setStaleDaysDesc(t.folders.paused))
      .addText((text) =>
        text.setValue(String(s.staleDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.staleDays = Number.isFinite(n) && n >= 0 ? n : 30;
          await save();
        })
      );

    new Setting(containerEl)
      .setName(t.setShowHidden)
      .setDesc(t.setShowHiddenDesc)
      .addToggle((toggle) =>
        toggle.setValue(s.showHiddenDescriptions).onChange(async (v) => {
          s.showHiddenDescriptions = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName(t.setSync)
      .addButton((b) => b.setButtonText(t.setSyncNow).setCta().onClick(() => this.plugin.syncAll(false)))
      .addButton((b) => b.setButtonText(t.setSyncFull).onClick(() => this.plugin.syncAll(true)));
  }
}
