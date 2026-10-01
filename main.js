'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  FuzzySuggestModal,
  requestUrl,
  normalizePath,
  TFile,
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
const FOCUS_FILE = 'Als Nächstes.md';
const DASHBOARD_FILE = '_Dashboard.md';

const STATUS_FOLDERS = {
  next: '0 Als Nächstes',
  playing: '1 Aktiv',
  paused: '2 Pausiert',
  completed: '3 Abgeschlossen',
  dropped: '4 Abgebrochen',
};
const NOACH_FOLDER = '5 Ohne Achievements';

const DEFAULT_SETTINGS = {
  apiKey: '',
  steamId: '',
  folder: 'Games',
  language: 'german',
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
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Unbenannt';
}

function oneLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function fmtPercent(p) {
  return Number(p).toFixed(1).replace('.', ',');
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

function hiddenAwareDescription(a, showHidden) {
  if (a.hidden && !showHidden) return '*(Verstecktes Achievement)*';
  if (!a.description) return a.hidden ? '*(Verstecktes Achievement)*' : '';
  return a.description;
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

    this.addRibbonIcon('gamepad-2', 'Steam: Jetzt synchronisieren', () => this.syncAll(false));
    this.addRibbonIcon('list-todo', 'Steam: Als Nächstes öffnen', () => this.openFocusPage());

    this.addCommand({ id: 'sync-now', name: 'Jetzt synchronisieren', callback: () => this.syncAll(false) });
    this.addCommand({
      id: 'sync-full',
      name: 'Alles neu synchronisieren (ignoriert Cache)',
      callback: () => this.syncAll(true),
    });
    this.addCommand({
      id: 'sync-current',
      name: 'Dieses Spiel synchronisieren',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const appid = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.appid;
        if (!appid) return false;
        if (!checking) this.syncSingle(file, Number(appid));
        return true;
      },
    });
    this.addCommand({ id: 'open-focus', name: 'Als Nächstes öffnen', callback: () => this.openFocusPage() });
    this.addCommand({
      id: 'plan-backlog',
      name: 'Backlog-Spiel einplanen',
      callback: () => new BacklogModal(this.app, this).open(),
    });
    this.addCommand({
      id: 'reset-dashboard',
      name: 'Dashboard zurücksetzen',
      callback: async () => {
        await this.updateDashboard(this.state.unplayed || [], true);
        await this.saveAll();
        new Notice('Steam: Dashboard neu erzeugt (altes als Backup gesichert).');
      },
    });

    // Status von Hand geändert → Note in passenden Ordner verschieben
    this.registerEvent(
      this.app.metadataCache.on('changed', (file, _data, cache) => this.onMetadataChanged(file, cache))
    );
    // Datei verschoben/umbenannt → Pfad im State aktuell halten
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
        // kurz warten, bis der Metadata-Cache aufgebaut ist
        setTimeout(() => this.syncAll(false), 3000);
      }
    });
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    Object.values(this.moveTimers).forEach((t) => clearTimeout(t));
    if (this.focusTimer) clearTimeout(this.focusTimer);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    this.state = Object.assign(
      { games: {}, unplayed: [], lastSync: null, resolvedSteamId: null, dashboardVersion: 1 },
      data.state
    );
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, state: this.state });
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

  get baseFolder() {
    return normalizePath(this.settings.folder);
  }

  updateStatusBar() {
    if (!this.statusBar) return;
    if (this.syncing) {
      this.statusBar.setText('Steam: synchronisiere …');
    } else if (this.state.lastSync) {
      const d = new Date(this.state.lastSync);
      this.statusBar.setText(`Steam: ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      this.statusBar.setText('');
    }
  }

  async openFocusPage() {
    const path = normalizePath(`${this.baseFolder}/${FOCUS_FILE}`);
    if (!this.app.vault.getAbstractFileByPath(path)) await this.updateFocusPage();
    await this.app.workspace.openLinkText(path, '', false);
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
    throw new Error(`Steam-Profil "${vanity}" nicht gefunden. Bitte SteamID64 oder Profil-URL eintragen.`);
  }

  async getOwnedGames(steamid) {
    const { status, json } = await this.api('IPlayerService/GetOwnedGames/v0001', {
      steamid,
      include_appinfo: 1,
      include_played_free_games: 1,
    });
    if (status === 401 || status === 403) throw new Error('Steam-API-Key ungültig.');
    if (status !== 200 || !json) throw new Error(`Steam-API-Fehler (HTTP ${status}).`);
    const games = json.response?.games;
    if (!games) {
      throw new Error(
        'Keine Spiele erhalten. Ist dein Profil privat? Steam → Profil bearbeiten → Privatsphäre → "Spieldetails: Öffentlich".'
      );
    }
    return games;
  }

  async getAchievements(appid, steamid) {
    const lang = this.settings.language;
    const schemaRes = await this.api('ISteamUserStats/GetSchemaForGame/v2', { appid, l: lang });
    const schemaList = schemaRes.json?.game?.availableGameStats?.achievements || [];
    if (schemaList.length === 0) return [];

    const playerRes = await this.api('ISteamUserStats/GetPlayerAchievements/v0001', { appid, steamid, l: lang });
    const ps = playerRes.json?.playerstats;
    if (ps && ps.success === false && /not public/i.test(ps.error || '')) {
      throw new Error('Achievements privat. Steam → Privatsphäre → "Spieldetails: Öffentlich".');
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

  /** Genres etc. aus dem Store. Gibt null bei Rate-Limit zurück, {} wenn nichts gefunden. */
  async getStoreDetails(appid, ctx) {
    const wait = ctx.lastStoreCall + STORE_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    ctx.lastStoreCall = Date.now();
    const res = await requestUrl({
      url: `${STORE_API}?appids=${appid}&l=${encodeURIComponent(this.settings.language)}`,
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

  // ---------- Status & Ordner ----------

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
    const sub = total === 0 ? NOACH_FOLDER : STATUS_FOLDERS[status];
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
    if (this.syncing) {
      if (!silent) new Notice('Steam-Sync läuft bereits.');
      return;
    }
    if (!this.isConfigured()) {
      new Notice('Steam Tracker: Bitte zuerst API-Key und SteamID in den Einstellungen eintragen.');
      return;
    }
    this.syncing = true;
    this.updateStatusBar();
    const notice = silent ? null : new Notice('Steam: lade Bibliothek …', 0);
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
        notice?.setMessage(`Steam: ${i + 1}/${candidates.length} – ${game.name}`);
        try {
          const didWork = await this.processGame(game, steamid, fileMap, mode, ctx);
          if (didWork) updated++;
        } catch (e) {
          console.error('[steam-tracker]', game.name, e);
          errors.push(`${game.name}: ${e.message}`);
          if (/privat/i.test(e.message)) break;
        }
        if (mode === 'full') await sleep(150);
      }

      const unplayed = games
        .filter((g) => !g.playtime_forever && !fileMap.has(g.appid))
        .map((g) => ({ appid: g.appid, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.state.unplayed = unplayed;

      await this.updateDashboard(unplayed, false);
      await this.updateFocusPage();

      this.state.lastSync = Date.now();
      await this.saveAll();

      let msg = `Steam-Sync fertig: ${updated} Spiel(e) aktualisiert, ${unplayed.length} im Backlog.`;
      if (!ctx.storeOk) msg += '\nGenres: Store-Limit erreicht, Rest folgt beim nächsten Sync.';
      if (notice) notice.setMessage(errors.length ? `${msg}\n${errors.length} Fehler – siehe Konsole.\n${errors[0]}` : msg);
      if (notice) setTimeout(() => notice.hide(), 6000);
    } catch (e) {
      console.error('[steam-tracker]', e);
      if (notice) notice.hide();
      new Notice(`Steam-Sync fehlgeschlagen: ${e.message}`, 10000);
    } finally {
      this.syncing = false;
      this.updateStatusBar();
    }
  }

  /** full = Achievements laden, light = nur Spielzeit (Spiele ohne Achievements), none = nur Status/Ordner prüfen */
  syncMode(game, fileMap, force) {
    const prev = this.state.games[game.appid];
    if (force || !prev || !fileMap.has(game.appid) || prev.total == null) return 'full';
    if (prev.total === 0) return prev.playtime !== game.playtime_forever ? 'light' : 'none';
    if (prev.playtime !== game.playtime_forever || !prev.openTop) return 'full';
    return 'none';
  }

  async syncSingle(file, appid) {
    if (this.syncing) return new Notice('Steam-Sync läuft bereits.');
    if (!this.isConfigured()) return new Notice('Steam Tracker: Bitte zuerst die Einstellungen ausfüllen.');
    this.syncing = true;
    this.updateStatusBar();
    try {
      const steamid = await this.getSteamId();
      const games = await this.getOwnedGames(steamid);
      const game = games.find((g) => g.appid === appid);
      if (!game) throw new Error(`App ${appid} nicht in deiner Bibliothek gefunden.`);
      const fileMap = new Map([[appid, file]]);
      await this.processGame(game, steamid, fileMap, 'full', { storeOk: true, lastStoreCall: 0 });
      await this.updateFocusPage();
      await this.saveAll();
      new Notice(`Steam: ${game.name} aktualisiert.`);
    } catch (e) {
      new Notice(`Steam-Sync fehlgeschlagen: ${e.message}`, 10000);
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

  /** Gibt true zurück, wenn etwas geschrieben wurde. */
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
        .map((a) => ({
          name: a.name,
          percent: a.percent,
          desc: truncate(hiddenAwareDescription(a, this.settings.showHiddenDescriptions), 110),
        }));
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

    // Genres (einmalig pro Spiel)
    let store = null;
    if (ctx.storeOk && cachedFm.genres === undefined) {
      store = await this.getStoreDetails(appid, ctx);
      if (store === null) ctx.storeOk = false;
    }

    // Status: ohne vorhandenen Status (neue Note) wird ein Startwert gewählt
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
          const clean = new Set(tags.map((t) => String(t).replace(/^#/, '')).filter(Boolean));
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
      new Notice(`🏆 100 % in ${game.name}! Glückwunsch!`, 10000);
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
    const folder = this.baseFolder;
    const base = sanitizeFileName(game.name);
    let path = normalizePath(`${folder}/${base}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${base} (${game.appid}).md`);
    }
    const body = [
      `![cover|460](${cover})`,
      '',
      `[Steam-Store](https://store.steampowered.com/app/${game.appid}) · ` +
        `[Achievements auf Steam](https://steamcommunity.com/stats/${game.appid}/achievements)`,
      '',
      '## Meine Notizen',
      '',
      '',
      '',
      '## Achievements',
      '',
      section,
      '',
    ].join('\n');
    return this.app.vault.create(path, body);
  }

  buildSection(achievements, unlocked, total) {
    const lines = [SYNC_START];
    if (total === 0) {
      lines.push('*Dieses Spiel hat keine Steam-Achievements.*');
      lines.push(SYNC_END);
      return lines.join('\n');
    }
    const completion = Math.floor((unlocked / total) * 100);
    lines.push(
      `**Fortschritt:** <progress value="${unlocked}" max="${total}"></progress> ${unlocked}/${total} (${completion} %)`
    );
    lines.push('');

    const open = achievements.filter((a) => !a.achieved).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
    const done = achievements.filter((a) => a.achieved).sort((a, b) => b.unlocktime - a.unlocktime);

    lines.push(`### Offen (${open.length})`);
    if (open.length === 0) lines.push('*Alles erledigt! 🏆*');
    for (const a of open) {
      const desc = hiddenAwareDescription(a, this.settings.showHiddenDescriptions);
      const rarity = a.percent != null ? ` *(${fmtPercent(a.percent)} % der Spieler)*` : '';
      const icon = a.icongray ? `![icon|32](${a.icongray}) ` : '';
      lines.push(`- [ ] ${icon}**${a.name}**${desc ? ': ' + desc : ''}${rarity}`);
    }

    lines.push('');
    lines.push(`### Erledigt (${done.length})`);
    for (const a of done) {
      const date = fmtDate(a.unlocktime);
      const rarity = a.percent != null ? `, ${fmtPercent(a.percent)} %` : '';
      const icon = a.icon ? `![icon|32](${a.icon}) ` : '';
      const meta = date || rarity ? ` *(${date ? 'freigeschaltet ' + date : ''}${rarity})*` : '';
      lines.push(`- [x] ${icon}**${a.name}**${a.description ? ': ' + a.description : ''}${meta}`);
    }

    lines.push(SYNC_END);
    return lines.join('\n');
  }

  // ---------- Backlog einplanen ----------

  async planBacklogGame(item) {
    if (this.syncing) return new Notice('Steam-Sync läuft gerade, bitte kurz warten.');
    await this.ensureFolder(this.baseFolder);
    const cover = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.appid}/header.jpg`;
    const placeholder = `${SYNC_START}\n*Wird synchronisiert …*\n${SYNC_END}`;
    const file = await this.createNote(item, cover, placeholder);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.appid = item.appid;
      fm.title = item.name;
      fm.status = 'next';
    });
    this.state.unplayed = (this.state.unplayed || []).filter((g) => g.appid !== item.appid);
    // auf Metadata-Cache warten, dann Achievements & Genres laden
    await sleep(500);
    await this.syncSingle(file, item.appid);
    await this.updateDashboard(this.state.unplayed, false);
    await this.saveAll();
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // ---------- Fokus-Seite ----------

  gameLink(g) {
    const name = (g.name || '').replace(/[|[\]]/g, '-');
    if (!g.file) return name;
    return `[[${g.file.replace(/\.md$/, '')}|${name}]]`;
  }

  async updateFocusPage() {
    const path = normalizePath(`${this.baseFolder}/${FOCUS_FILE}`);
    const all = Object.values(this.state.games).filter((g) => g.file);
    const withAch = all.filter((g) => g.total > 0);
    const progress = (g) => `<progress value="${g.unlocked}" max="${g.total}"></progress> ${g.unlocked}/${g.total}`;
    const pct = (g) => (g.total ? Math.floor((g.unlocked / g.total) * 100) : 0);

    const lines = [
      '# 🎯 Als Nächstes',
      '',
      `> [!info]- Automatisch erzeugt`,
      `> Diese Seite wird bei jedem Steam-Sync neu geschrieben, Änderungen hier gehen verloren.`,
      `> Letzter Sync: ${this.state.lastSync ? new Date(this.state.lastSync).toLocaleString('de-DE') : '–'}`,
      '',
    ];

    // 1. Zuletzt gespielt
    const recent = withAch
      .filter((g) => g.status !== 'dropped' && g.lastPlayed)
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .slice(0, 5);
    lines.push('## ▶️ Zuletzt gespielt');
    if (!recent.length) lines.push('*Noch nichts gespielt.*');
    for (const g of recent) {
      const open = g.total - g.unlocked;
      lines.push(
        `- ${this.gameLink(g)} · ${progress(g)} · ${open ? open + ' offen' : '🏆 fertig'} · ${g.hours} h · ${fmtDate(g.lastPlayed)}`
      );
    }
    lines.push('');

    // 2. Geplant
    const planned = withAch.filter((g) => g.status === 'next').sort((a, b) => a.name.localeCompare(b.name));
    lines.push('## 📋 Als Nächstes geplant');
    if (!planned.length) lines.push('*Nichts geplant – Befehl „Steam: Backlog-Spiel einplanen“ oder `status: next` setzen.*');
    for (const g of planned) lines.push(`- ${this.gameLink(g)} · ${g.total} Achievements`);
    lines.push('');

    // 3. Quick Wins
    const quick = withAch
      .filter((g) => ['playing', 'paused', 'next'].includes(g.status))
      .flatMap((g) => (g.openTop || []).filter((a) => a.percent != null).map((a) => ({ g, a })))
      .sort((x, y) => y.a.percent - x.a.percent)
      .slice(0, 15);
    lines.push('## ⚡ Quick Wins');
    lines.push('*Offene Achievements, die die meisten Spieler haben – also vermutlich leicht.*');
    if (!quick.length) lines.push('*Keine gefunden.*');
    for (const { g, a } of quick) {
      lines.push(`- **${a.name}** (${fmtPercent(a.percent)} %) – ${this.gameLink(g)}${a.desc ? ': ' + a.desc : ''}`);
    }
    lines.push('');

    // 4. Fast geschafft
    const almost = withAch
      .filter((g) => !g.perfect && g.unlocked > 0 && g.status !== 'dropped')
      .sort((a, b) => a.total - a.unlocked - (b.total - b.unlocked) || pct(b) - pct(a))
      .slice(0, 10);
    lines.push('## 🔥 Fast geschafft');
    if (!almost.length) lines.push('*Keine.*');
    for (const g of almost) {
      lines.push(`- ${this.gameLink(g)} – noch **${g.total - g.unlocked}** · ${progress(g)} (${pct(g)} %)`);
    }
    lines.push('');

    // 5. Lange nicht angefasst
    const dusty = withAch
      .filter((g) => g.status === 'paused' && g.unlocked > 0)
      .sort((a, b) => pct(b) - pct(a))
      .slice(0, 5);
    lines.push('## 💤 Lange nicht angefasst');
    lines.push('*Pausierte Spiele mit dem meisten Fortschritt.*');
    if (!dusty.length) lines.push('*Keine.*');
    for (const g of dusty) {
      lines.push(`- ${this.gameLink(g)} · ${progress(g)} (${pct(g)} %) · zuletzt ${fmtDate(g.lastPlayed) || '–'}`);
    }
    lines.push('');

    const content = lines.join('\n');
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  // ---------- Dashboard ----------

  async updateDashboard(unplayed, forceReset) {
    const folder = this.baseFolder;
    const path = normalizePath(`${folder}/${DASHBOARD_FILE}`);

    const games = Object.values(this.state.games);
    const withAch = games.filter((g) => g.total > 0);
    const sum = (list, fn) => list.reduce((s, g) => s + (fn(g) || 0), 0);
    const statsBlock = [
      STATS_START,
      `🎮 **${withAch.length}** Spiele mit Achievements · ` +
        `🏆 **${sum(withAch, (g) => g.unlocked)}/${sum(withAch, (g) => g.total)}** Achievements · ` +
        `⭐ **${withAch.filter((g) => g.perfect).length}** Perfect Games · ` +
        `⏱️ **${Math.round(sum(games, (g) => g.playtime) / 60)}** h gespielt · ` +
        `🚫 **${games.length - withAch.length}** ohne Achievements · ` +
        `📦 **${unplayed.length}** nie gestartet`,
      STATS_END,
    ].join('\n');

    const backlogBlock = [
      BACKLOG_START,
      ...(unplayed.length
        ? unplayed.map((g) => `- [${g.name}](https://store.steampowered.com/app/${g.appid})`)
        : ['*Keine ungespielten Spiele – stark!*']),
      BACKLOG_END,
    ].join('\n');

    let existing = this.app.vault.getAbstractFileByPath(path);
    const outdated = (this.state.dashboardVersion || 1) < DASHBOARD_VERSION;
    if (existing instanceof TFile && (forceReset || outdated)) {
      let backup = normalizePath(`${folder}/_Dashboard (alt).md`);
      if (this.app.vault.getAbstractFileByPath(backup)) {
        backup = normalizePath(`${folder}/_Dashboard (alt ${Date.now()}).md`);
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
      `"<progress value='" + achievements_unlocked + "' max='" + achievements_total + "'></progress> " + completion + " %" AS Fortschritt`;

    const table = (where, sort, limit) =>
      [
        '```dataview',
        'TABLE WITHOUT ID',
        '  file.link AS Spiel,',
        `  ${progressCol},`,
        '  achievements_unlocked + "/" + achievements_total AS Achievements,',
        '  playtime_hours + " h" AS Spielzeit,',
        '  last_played AS "Zuletzt gespielt"',
        `FROM "${folder}"`,
        `WHERE appid AND achievements_total > 0 AND ${where}`,
        `SORT ${sort}`,
        ...(limit ? [`LIMIT ${limit}`] : []),
        '```',
      ].join('\n');

    const content = [
      '# 🎮 Gaming Dashboard',
      '',
      `Schneller Überblick: [[${folder}/Als Nächstes|🎯 Als Nächstes]]`,
      '',
      statsBlock,
      '',
      '## ▶️ Aktuell am Spielen',
      table('status = "playing"', 'last_played DESC'),
      '',
      '## 📋 Als Nächstes geplant',
      table('status = "next"', 'file.name ASC'),
      '',
      '## 🔥 Fast geschafft (≥ 75 %)',
      table('!perfect AND completion >= 75 AND status != "dropped"', 'completion DESC'),
      '',
      '## ⏸️ Pausiert',
      table('status = "paused"', 'last_played DESC'),
      '',
      '## 🏆 100 % abgeschlossen',
      table('perfect', 'last_played DESC'),
      '',
      '## ❌ Abgebrochen',
      table('status = "dropped"', 'last_played DESC'),
      '',
      '## 🎭 Nach Genre',
      '```dataview',
      'TABLE WITHOUT ID g AS Genre, length(rows) AS Spiele, rows.file.link AS Titel',
      `FROM "${folder}"`,
      'WHERE appid AND genres',
      'FLATTEN genres AS g',
      'GROUP BY g',
      'SORT length(rows) DESC',
      '```',
      '',
      '## 📦 Backlog – nie gestartet',
      '*Mit dem Befehl „Steam: Backlog-Spiel einplanen“ holst du ein Spiel nach „Als Nächstes“.*',
      '',
      backlogBlock,
      '',
      '> [!note]- 🚫 Ohne Achievements',
      '> ```dataview',
      '> TABLE WITHOUT ID file.link AS Spiel, playtime_hours + " h" AS Spielzeit, last_played AS "Zuletzt gespielt", status AS Status',
      `> FROM "${folder}"`,
      '> WHERE appid AND achievements_total = 0',
      '> SORT playtime_hours DESC',
      '> ```',
      '',
    ].join('\n');

    await this.app.vault.create(path, content);
    this.state.dashboardVersion = DASHBOARD_VERSION;
  }
};

// ---------- Backlog-Auswahl ----------

class BacklogModal extends FuzzySuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder('Welches ungespielte Spiel willst du als Nächstes angehen?');
  }

  getItems() {
    const items = this.plugin.state.unplayed || [];
    if (!items.length) new Notice('Keine ungespielten Spiele bekannt – erst synchronisieren.');
    return items;
  }

  getItemText(item) {
    return item.name;
  }

  onChooseItem(item) {
    this.plugin.planBacklogGame(item).catch((e) => {
      console.error('[steam-tracker]', e);
      new Notice(`Fehler: ${e.message}`);
    });
  }
}

// ---------- Settings Tab ----------

class SteamTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    const save = async () => {
      await this.plugin.saveAll();
    };

    new Setting(containerEl)
      .setName('Steam-API-Key')
      .setDesc(
        createFragment((f) => {
          f.appendText('Kostenlos unter ');
          f.createEl('a', { text: 'steamcommunity.com/dev/apikey', href: 'https://steamcommunity.com/dev/apikey' });
          f.appendText('. Wird im Klartext in data.json des Plugins gespeichert.');
        })
      )
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setPlaceholder('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
          .setValue(s.apiKey)
          .onChange(async (v) => {
            s.apiKey = v.trim();
            await save();
          });
      });

    new Setting(containerEl)
      .setName('Steam-Profil')
      .setDesc('SteamID64 (17 Ziffern), Profil-URL oder eigener Profilname (steamcommunity.com/id/<name>).')
      .addText((t) =>
        t.setValue(s.steamId).onChange(async (v) => {
          s.steamId = v.trim();
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Ordner')
      .setDesc('Hier werden die Spiel-Notes (in Status-Unterordnern), das Dashboard und „Als Nächstes“ angelegt.')
      .addText((t) =>
        t.setValue(s.folder).onChange(async (v) => {
          s.folder = v.trim() || 'Games';
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Sprache')
      .setDesc('Sprache für Achievement-Namen und Genres (Steam-Sprachcode, z. B. german, english).')
      .addText((t) =>
        t.setValue(s.language).onChange(async (v) => {
          s.language = v.trim() || 'german';
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Beim Start synchronisieren')
      .addToggle((t) =>
        t.setValue(s.syncOnStartup).onChange(async (v) => {
          s.syncOnStartup = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Auto-Sync-Intervall (Minuten)')
      .setDesc('0 = aus. Läuft nur, solange Obsidian geöffnet ist.')
      .addText((t) =>
        t.setValue(String(s.intervalMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.intervalMinutes = Number.isFinite(n) && n >= 0 ? n : 60;
          await save();
          this.plugin.setupInterval();
        })
      );

    new Setting(containerEl)
      .setName('Tage bis automatisch pausiert')
      .setDesc('Spiele mit Status „playing“, die so lange nicht gespielt wurden, wandern nach „2 Pausiert“. 0 = aus.')
      .addText((t) =>
        t.setValue(String(s.staleDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.staleDays = Number.isFinite(n) && n >= 0 ? n : 30;
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Beschreibungen versteckter Achievements zeigen')
      .setDesc('Aus = keine Spoiler bei offenen, versteckten Achievements.')
      .addToggle((t) =>
        t.setValue(s.showHiddenDescriptions).onChange(async (v) => {
          s.showHiddenDescriptions = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Synchronisieren')
      .addButton((b) => b.setButtonText('Jetzt synchronisieren').setCta().onClick(() => this.plugin.syncAll(false)))
      .addButton((b) => b.setButtonText('Alles neu').onClick(() => this.plugin.syncAll(true)));
  }
}
