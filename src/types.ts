export type Status = 'next' | 'playing' | 'paused' | 'completed' | 'dropped';

export const STATUSES: Status[] = ['next', 'playing', 'paused', 'completed', 'dropped'];

export type SyncMode = 'full' | 'light' | 'none';

export type LibrarySort = 'recent' | 'progress' | 'playtime' | 'name' | 'almost';

/** View preferences that should survive restarts. */
export interface UiPrefs {
  statuses: string[];
  genre: string;
  search: string;
  sort: LibrarySort;
  showNoAch: boolean;
}

export interface Settings {
  ui: UiPrefs;
  uiLanguage: 'auto' | 'de' | 'en';
  apiKey: string;
  steamId: string;
  folder: string;
  language: string;
  syncOnStartup: boolean;
  intervalMinutes: number;
  staleDays: number;
  showHiddenDescriptions: boolean;
}

export interface OpenAchievementSummary {
  name: string;
  percent: number | null;
  desc: string;
}

/** Per-game data the plugin remembers between syncs (stored in data.json). */
export interface GameState {
  name: string;
  playtime: number;
  hours: number;
  lastPlayed: number;
  unlocked: number;
  total: number;
  perfect: boolean;
  openTop: OpenAchievementSummary[];
  status: string;
  file: string;
}

export interface UnplayedGame {
  appid: number;
  name: string;
}

export interface PluginState {
  games: Record<string, GameState>;
  unplayed: UnplayedGame[];
  lastSync: number | null;
  resolvedSteamId: { vanity: string; id: string } | null;
  dashboardVersion: number;
  dashboardLang: string;
}

export interface Achievement {
  apiname: string;
  name: string;
  description: string;
  hidden: boolean;
  icon: string;
  icongray: string;
  achieved: boolean;
  unlocktime: number;
  percent: number | null;
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
}

export interface StoreDetails {
  genres?: string[];
  developer?: string | null;
  release_year?: number | null;
  metacritic?: number | null;
}

export interface SyncContext {
  storeOk: boolean;
  lastStoreCall: number;
}
