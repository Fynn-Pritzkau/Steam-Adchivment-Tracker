import { normalizePath } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { Achievement, GameState } from '../types';
import { pad } from '../util';

/** [playtime in minutes, unlocked achievements] */
export type Snapshot = [number, number];

export interface History {
  /** Latest known values per appid, so we only store changes. */
  last: Record<string, Snapshot>;
  /** Day (YYYY-MM-DD) → appid → values recorded that day. */
  days: Record<string, Record<string, Snapshot>>;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Local cache next to the plugin (not part of the vault's notes):
 *   cache/achievements/<appid>.json – full achievement list per game
 *   cache/history.json              – daily playtime/achievement snapshots
 */
export class DataCache {
  private achievements = new Map<number, Achievement[]>();
  private history: History | null = null;

  constructor(private plugin: SteamTrackerPlugin) {}

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }

  private get dir() {
    return normalizePath(`${this.plugin.manifest.dir}/cache`);
  }

  private get achDir() {
    return normalizePath(`${this.dir}/achievements`);
  }

  private achPath(appid: number) {
    return normalizePath(`${this.achDir}/${appid}.json`);
  }

  private get historyPath() {
    return normalizePath(`${this.dir}/history.json`);
  }

  private async ensureDirs() {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    if (!(await this.adapter.exists(this.achDir))) await this.adapter.mkdir(this.achDir);
  }

  /** Appids that already have a cached achievement list. */
  async listAchievementIds(): Promise<Set<number>> {
    await this.ensureDirs();
    const listing = await this.adapter.list(this.achDir);
    const ids = new Set<number>();
    for (const f of listing.files) {
      const m = f.match(/(\d+)\.json$/);
      if (m) ids.add(Number(m[1]));
    }
    return ids;
  }

  async saveAchievements(appid: number, list: Achievement[]): Promise<void> {
    await this.ensureDirs();
    this.achievements.set(appid, list);
    await this.adapter.write(this.achPath(appid), JSON.stringify(list));
  }

  async loadAchievements(appid: number): Promise<Achievement[] | null> {
    if (this.achievements.has(appid)) return this.achievements.get(appid);
    const path = this.achPath(appid);
    if (!(await this.adapter.exists(path))) return null;
    try {
      const list = JSON.parse(await this.adapter.read(path)) as Achievement[];
      this.achievements.set(appid, list);
      return list;
    } catch (e) {
      console.error('[steam-tracker] cache read', appid, e);
      return null;
    }
  }

  async loadHistory(): Promise<History> {
    if (this.history) return this.history;
    let history: History = { last: {}, days: {} };
    if (await this.adapter.exists(this.historyPath)) {
      try {
        history = Object.assign(history, JSON.parse(await this.adapter.read(this.historyPath)));
      } catch (e) {
        console.error('[steam-tracker] history read', e);
      }
    }
    this.history = history;
    return history;
  }

  /** Stores today's values for every game that changed since the last snapshot. */
  async recordSnapshot(games: Record<string, GameState>): Promise<void> {
    const history = await this.loadHistory();
    const day = today();
    let changed = false;
    for (const [appid, g] of Object.entries(games)) {
      const snap: Snapshot = [g.playtime || 0, g.unlocked || 0];
      const last = history.last[appid];
      if (last && last[0] === snap[0] && last[1] === snap[1]) continue;
      (history.days[day] = history.days[day] || {})[appid] = snap;
      history.last[appid] = snap;
      changed = true;
    }
    if (changed) {
      await this.ensureDirs();
      await this.adapter.write(this.historyPath, JSON.stringify(history));
    }
  }
}
