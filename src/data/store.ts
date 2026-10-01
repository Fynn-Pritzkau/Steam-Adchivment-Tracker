import { Events, TFile } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { GameState } from '../types';
import { coverUrl, heroUrl } from '../util';
import { buildFileMap } from '../vault/notes';

/** Everything the UI needs about one game: sync state + note frontmatter. */
export interface Game extends GameState {
  appid: number;
  /** Cover candidates, best first. */
  covers: string[];
  cover: string;
  note: TFile | null;
  genres: string[];
  developer: string | null;
  releaseYear: number | null;
  metacritic: number | null;
  completion: number;
}

/**
 * Read model for the views. Combines the plugin state with each note's
 * frontmatter (status and genres may be edited by hand) and tells the
 * views when something changed.
 */
export class GameStore extends Events {
  private notifyTimer: number | null = null;
  private noteMap: Map<number, TFile> | null = null;

  constructor(private plugin: SteamTrackerPlugin) {
    super();
  }

  /**
   * Finds a game's note by the appid in its frontmatter. The path stored in the
   * state can be stale (e.g. when a sync was interrupted after moving notes),
   * so it is only a fast path and gets corrected here.
   */
  findNote(appid: number): TFile | null {
    const { app, state } = this.plugin;
    const g = state.games[appid];
    if (g?.file) {
      const file = app.vault.getAbstractFileByPath(g.file);
      if (file instanceof TFile && Number(app.metadataCache.getFileCache(file)?.frontmatter?.appid) === appid) {
        return file;
      }
    }
    if (!this.noteMap) this.noteMap = buildFileMap(this.plugin);
    const note = this.noteMap.get(appid) || null;
    if (note && g && g.file !== note.path) {
      g.file = note.path;
      this.plugin.requestSave();
    }
    return note;
  }

  getGames(): Game[] {
    const { app, state } = this.plugin;
    const games: Game[] = [];
    for (const [id, g] of Object.entries(state.games)) {
      const appid = Number(id);
      const note = this.findNote(appid);
      const fm: Record<string, any> = (note && app.metadataCache.getFileCache(note)?.frontmatter) || {};
      games.push({
        ...g,
        appid,
        status: fm.status || g.status,
        covers: Array.from(new Set([fm.cover, coverUrl(appid), heroUrl(appid)].filter(Boolean))),
        cover: fm.cover || coverUrl(appid),
        note,
        genres: Array.isArray(fm.genres) ? fm.genres.map(String) : [],
        developer: fm.developer || null,
        releaseYear: fm.release_year || null,
        metacritic: fm.metacritic || null,
        completion: g.total ? Math.floor((g.unlocked / g.total) * 100) : 0,
      });
    }
    return games;
  }

  getGame(appid: number): Game | null {
    return this.getGames().find((g) => g.appid === appid) || null;
  }

  /** Debounced "changed" event so a burst of file events only re-renders once. */
  notify(delay = 300) {
    this.noteMap = null;
    if (this.notifyTimer) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.trigger('changed');
    }, delay);
  }

  onChanged(callback: () => void) {
    return this.on('changed', callback);
  }
}
