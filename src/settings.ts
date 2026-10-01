import { App, PluginSettingTab, Setting } from 'obsidian';
import type SteamTrackerPlugin from './main';
import type { Settings } from './types';

export const DEFAULT_UI = {
  statuses: [],
  genre: '',
  search: '',
  sort: 'recent',
  showNoAch: false,
} as Settings['ui'];

export const DEFAULT_SETTINGS: Settings = {
  ui: DEFAULT_UI,
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

export class SteamTrackerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SteamTrackerPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
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
            s.uiLanguage = v as Settings['uiLanguage'];
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
      .addButton((b) =>
        b
          .setButtonText(t.setSyncNow)
          .setCta()
          .onClick(() => this.plugin.syncer.syncAll(false))
      )
      .addButton((b) => b.setButtonText(t.setSyncFull).onClick(() => this.plugin.syncer.syncAll(true)));
  }
}
