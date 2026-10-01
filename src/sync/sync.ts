import { Notice, TFile } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { OwnedGame, StoreDetails, SyncContext, SyncMode, UnplayedGame } from '../types';
import { coverUrl, fmtDate, replaceOrAppend, sleep, SYNC_END, SYNC_RE, SYNC_START, tagSlug, truncate } from '../util';
import {
  buildFileMap,
  buildSection,
  cleanUpOtherLanguages,
  createNote,
  ensureFolder,
  hiddenAwareDescription,
  moveGameFile,
} from '../vault/notes';
import { updateDashboard, updateFocusPage } from '../vault/pages';

const RECENT_DAYS = 30;

interface StatusInfo {
  perfect: boolean;
  playedAgain: boolean;
  lastPlayed: number;
}

export class Syncer {
  constructor(private plugin: SteamTrackerPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  decideStatus(cur: string | undefined, info: StatusInfo): string {
    const { perfect, playedAgain, lastPlayed } = info;
    const now = Date.now() / 1000;
    if (!cur) {
      if (perfect) return 'completed';
      return lastPlayed && now - lastPlayed < RECENT_DAYS * 86400 ? 'playing' : 'paused';
    }
    if (cur === 'dropped') return cur;
    if (perfect && (cur === 'playing' || cur === 'paused' || cur === 'next')) return 'completed';
    if (playedAgain && (cur === 'paused' || cur === 'next' || cur === 'backlog')) return 'playing';
    const stale = Number(this.plugin.settings.staleDays);
    if (cur === 'playing' && stale > 0 && lastPlayed && now - lastPlayed > stale * 86400) return 'paused';
    return cur;
  }

  /** full = load achievements, light = playtime only (games without achievements), none = only check status/folder */
  syncMode(game: OwnedGame, fileMap: Map<number, TFile>, cachedIds: Set<number>, force: boolean): SyncMode {
    const prev = this.plugin.state.games[game.appid];
    if (force || !prev || !fileMap.has(game.appid) || prev.total == null) return 'full';
    if (prev.total === 0) return prev.playtime !== game.playtime_forever ? 'light' : 'none';
    if (prev.playtime !== game.playtime_forever || !prev.openTop || !cachedIds.has(game.appid)) return 'full';
    return 'none';
  }

  async syncAll(force: boolean, silent = false): Promise<void> {
    const plugin = this.plugin;
    const t = plugin.t;
    if (plugin.syncing) {
      if (!silent) new Notice(t.noticeAlreadySyncing);
      return;
    }
    if (!plugin.isConfigured()) {
      new Notice(t.noticeConfigure);
      return;
    }
    plugin.setSyncing(true);
    const notice = silent ? null : new Notice(t.noticeLoadingLibrary, 0);
    const errors: string[] = [];
    let updated = 0;
    const ctx: SyncContext = { storeOk: true, lastStoreCall: 0 };

    try {
      const steamid = await plugin.steam.getSteamId();
      const games = await plugin.steam.getOwnedGames(steamid);
      await ensureFolder(plugin, plugin.baseFolder);
      const fileMap = buildFileMap(plugin);
      const cachedIds = await plugin.cache.listAchievementIds();

      const candidates = games.filter((g) => g.playtime_forever > 0 || fileMap.has(g.appid));

      for (let i = 0; i < candidates.length; i++) {
        const game = candidates[i];
        const mode = this.syncMode(game, fileMap, cachedIds, force);
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

      const unplayed: UnplayedGame[] = games
        .filter((g) => !g.playtime_forever && !fileMap.has(g.appid))
        .map((g) => ({ appid: g.appid, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      plugin.state.unplayed = unplayed;

      plugin.state.lastSync = Date.now();
      await plugin.cache.recordSnapshot(plugin.state.games);
      await updateDashboard(plugin, unplayed, false);
      await updateFocusPage(plugin);
      await cleanUpOtherLanguages(plugin);
      await plugin.saveAll();

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
      plugin.setSyncing(false);
    }
  }

  async syncSingle(file: TFile, appid: number): Promise<void> {
    const plugin = this.plugin;
    const t = plugin.t;
    if (plugin.syncing) {
      new Notice(t.noticeAlreadySyncing);
      return;
    }
    if (!plugin.isConfigured()) {
      new Notice(t.noticeConfigure);
      return;
    }
    plugin.setSyncing(true);
    try {
      const steamid = await plugin.steam.getSteamId();
      const games = await plugin.steam.getOwnedGames(steamid);
      const game = games.find((g) => g.appid === appid);
      if (!game) throw new Error(t.errNotInLibrary(appid));
      const fileMap = new Map<number, TFile>([[appid, file]]);
      await this.processGame(game, steamid, fileMap, 'full', { storeOk: true, lastStoreCall: 0 });
      await updateFocusPage(plugin);
      await plugin.saveAll();
      new Notice(t.noticeGameUpdated(game.name));
    } catch (e) {
      new Notice(t.noticeSyncFailed(e.message), 10000);
    } finally {
      plugin.setSyncing(false);
    }
  }

  /** Returns true if anything was written. */
  async processGame(
    game: OwnedGame,
    steamid: string,
    fileMap: Map<number, TFile>,
    mode: SyncMode,
    ctx: SyncContext
  ): Promise<boolean> {
    const plugin = this.plugin;
    const appid = game.appid;
    const prev = plugin.state.games[appid] || null;
    const hours = Math.round((game.playtime_forever / 60) * 10) / 10;
    const lastPlayed = game.rtime_last_played || 0;
    const cover = coverUrl(appid);
    const playedAgain = Boolean(prev && game.playtime_forever > prev.playtime);

    let file = fileMap.get(appid);
    const cachedFm: Record<string, any> = file ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {};

    // Achievements
    let total: number, unlocked: number, perfect: boolean, openTop;
    if (mode === 'full') {
      const achievements = await plugin.steam.getAchievements(appid, steamid);
      await plugin.cache.saveAchievements(appid, achievements);
      total = achievements.length;
      unlocked = achievements.filter((a) => a.achieved).length;
      perfect = total > 0 && unlocked === total;
      openTop = achievements
        .filter((a) => !a.achieved)
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
        .slice(0, 5)
        .map((a) => ({ name: a.name, percent: a.percent, desc: truncate(hiddenAwareDescription(plugin, a), 110) }));
      const section = buildSection(plugin, achievements, unlocked, total);
      if (!file) {
        file = await createNote(plugin, game, cover, section);
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
    let store: StoreDetails | null = null;
    if (ctx.storeOk && cachedFm.genres === undefined) {
      store = await plugin.steam.getStoreDetails(appid, ctx);
      if (store === null) ctx.storeOk = false;
    }

    // Status: a note without a status (new note) gets a starting value
    const statusInfo: StatusInfo = { perfect, playedAgain, lastPlayed };
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
          const tags: string[] = Array.isArray(fm.tags)
            ? fm.tags.slice()
            : fm.tags
              ? String(fm.tags).split(/[\s,]+/)
              : [];
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

    await moveGameFile(plugin, file, appid, finalStatus, total);

    if (perfect && prev && prev.perfect === false) {
      new Notice(plugin.t.noticePerfect(game.name), 10000);
    }

    plugin.state.games[appid] = {
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

  async planBacklogGame(item: UnplayedGame): Promise<void> {
    const plugin = this.plugin;
    if (plugin.syncing) {
      new Notice(plugin.t.noticeWaitForSync);
      return;
    }
    await ensureFolder(plugin, plugin.baseFolder);
    const placeholder = `${SYNC_START}\n${plugin.t.notePlaceholder}\n${SYNC_END}`;
    const file = await createNote(plugin, item, coverUrl(item.appid), placeholder);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.appid = item.appid;
      fm.title = item.name;
      fm.status = 'next';
    });
    plugin.state.unplayed = (plugin.state.unplayed || []).filter((g) => g.appid !== item.appid);
    // wait for the metadata cache, then load achievements & genres
    await sleep(500);
    await this.syncSingle(file, item.appid);
    await updateDashboard(plugin, plugin.state.unplayed, false);
    await plugin.saveAll();
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}
