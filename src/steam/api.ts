import { requestUrl } from 'obsidian';
import type SteamTrackerPlugin from '../main';
import type { Achievement, OwnedGame, StoreDetails, SyncContext } from '../types';
import { oneLine, sleep } from '../util';

const API = 'https://api.steampowered.com';
const STORE_API = 'https://store.steampowered.com/api/appdetails';
const STORE_DELAY_MS = 1500;

export class SteamApi {
  constructor(private plugin: SteamTrackerPlugin) {}

  private get t() {
    return this.plugin.t;
  }

  async call(path: string, params: Record<string, string | number>): Promise<{ status: number; json: any }> {
    const query: Record<string, string> = { key: this.plugin.settings.apiKey, format: 'json' };
    for (const [k, v] of Object.entries(params)) query[k] = String(v);
    const qs = new URLSearchParams(query);
    const res = await requestUrl({ url: `${API}/${path}/?${qs.toString()}`, throw: false });
    let json = null;
    try {
      json = res.json;
    } catch (e) {
      json = null;
    }
    return { status: res.status, json };
  }

  async getSteamId(): Promise<string> {
    const state = this.plugin.state;
    const input = this.plugin.settings.steamId.trim();
    if (/^\d{17}$/.test(input)) return input;
    const m = input.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/);
    if (m && m[1] === 'profiles') return m[2];
    const vanity = m ? m[2] : input;
    if (state.resolvedSteamId && state.resolvedSteamId.vanity === vanity) {
      return state.resolvedSteamId.id;
    }
    const { json } = await this.call('ISteamUser/ResolveVanityURL/v0001', { vanityurl: vanity });
    if (json?.response?.success === 1) {
      state.resolvedSteamId = { vanity, id: json.response.steamid };
      return json.response.steamid;
    }
    throw new Error(this.t.errProfileNotFound(vanity));
  }

  async getOwnedGames(steamid: string): Promise<OwnedGame[]> {
    const { status, json } = await this.call('IPlayerService/GetOwnedGames/v0001', {
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

  async getAchievements(appid: number, steamid: string): Promise<Achievement[]> {
    const lang = this.plugin.steamLanguage;
    const schemaRes = await this.call('ISteamUserStats/GetSchemaForGame/v2', { appid, l: lang });
    const schemaList: any[] = schemaRes.json?.game?.availableGameStats?.achievements || [];
    if (schemaList.length === 0) return [];

    const playerRes = await this.call('ISteamUserStats/GetPlayerAchievements/v0001', { appid, steamid, l: lang });
    const ps = playerRes.json?.playerstats;
    if (ps && ps.success === false && /not public/i.test(ps.error || '')) {
      throw new Error(this.t.errPrivateAchievements);
    }
    const playerMap = new Map<string, any>((ps?.achievements || []).map((a: any) => [a.apiname, a]));

    const globalRes = await this.call('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002', {
      gameid: appid,
    });
    const globalList: any[] = globalRes.json?.achievementpercentages?.achievements || [];
    const rarity = new Map<string, number>(globalList.map((a) => [a.name, Number(a.percent)]));

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
  async getStoreDetails(appid: number, ctx: SyncContext): Promise<StoreDetails | null> {
    const wait = ctx.lastStoreCall + STORE_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    ctx.lastStoreCall = Date.now();
    const res = await requestUrl({
      url: `${STORE_API}?appids=${appid}&l=${encodeURIComponent(this.plugin.steamLanguage)}`,
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
      genres: (d.genres || []).map((g: any) => oneLine(g.description)).filter(Boolean),
      developer: (d.developers || [])[0] || null,
      release_year: year ? Number(year[0]) : null,
      metacritic: d.metacritic?.score || null,
    };
  }
}
