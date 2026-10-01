import { Events, TFile } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { GameState } from '../types';
import { coverUrl } from '../util';

/** Everything the UI needs about one game: sync state + note frontmatter. */
export interface Game extends GameState {
  appid: number;
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

  constructor(private plugin: SteamTrackerPlugin) {
    super();
  }

  getGames(): Game[] {
    const { app, state } = this.plugin;
    const games: Game[] = [];
    for (const [id, g] of Object.entries(state.games)) {
      const appid = Number(id);
      const file = g.file ? app.vault.getAbstractFileByPath(g.file) : null;
      const note = file instanceof TFile ? file : null;
      const fm: Record<string, any> = (note && app.metadataCache.getFileCache(note)?.frontmatter) || {};
      games.push({
        ...g,
        appid,
        status: fm.status || g.status,
        cover: coverUrl(appid),
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
