# Steam Achievement Tracker für Obsidian

🇬🇧 [English version](README.md)

Ein Obsidian-Plugin, das deine Steam-Bibliothek automatisch in deinen Vault synchronisiert: Für jedes gespielte Spiel legt es eine Note mit Spielzeit, Fortschritt und allen offenen bzw. erledigten Achievements an.

## Features

- **Steam-Tracker-Ansicht.** Ein eigener Tab (Gamepad-Icon in der linken Leiste) mit vier Seiten:
  - **Bibliothek:** deine Spiele als Cover-Grid mit Fortschrittsringen. Filter nach Status und Genre, Suche, Sortierung nach zuletzt gespielt, Fortschritt, „fast fertig“, Spielzeit oder Name.
  - **Board:** Kanban-Spalten für Als Nächstes, Aktiv, Pausiert, Abgeschlossen und Abgebrochen. Ziehst du eine Karte in eine andere Spalte, ändert sich der Status, und die Note wandert in den passenden Ordner. Auf dem Handy geht das über das `⋯`-Menü.
  - **Spiel-Details:** großes Cover, Eckdaten, Status-Auswahl und die vollständige Achievement-Liste. Du kannst sie filtern, durchsuchen und nach Seltenheit, Datum oder Name sortieren. Versteckte Achievements bleiben verdeckt, bis du sie anklickst. Daneben steht dein Abschnitt „Meine Notizen“.
  - **Statistik:** Kennzahlen, Achievements pro Monat, meistgespielte Spiele, Spielzeit nach Genre, deine seltensten Achievements und gespielte Stunden pro Tag.
- **Eine Note pro Spiel**, sobald es Spielzeit hat: Cover, Fortschrittsbalken, Achievements als Checkboxen. Offene sind nach Seltenheit sortiert, erledigte nach Datum.
- **Eigene Notizen bleiben erhalten.** Überschrieben wird nur der Bereich zwischen `<!-- steam-sync:start -->` und `<!-- steam-sync:end -->`.
- **Automatische Status-Ordner:**
  ```
  Games/
    Als Nächstes.md      ← Fokus-Seite
    _Dashboard.md        ← Dataview-Übersicht
    0 Als Nächstes/  1 Aktiv/  2 Pausiert/
    3 Abgeschlossen/ 4 Abgebrochen/ 5 Ohne Achievements/
  ```
  Ein Spiel, das du 30 Tage nicht gespielt hast, wird pausiert. Startest du es wieder, wird es aktiv. Bei 100 % wird es abgeschlossen. Ändert man `status` von Hand, wird die Note automatisch verschoben.
- **Fokus-Seite „Als Nächstes“:**
  - zuletzt gespielt
  - geplante Spiele
  - ⚡ Quick Wins (die häufigsten offenen Achievements über alle aktiven Spiele)
  - fast geschafft
  - lange nicht angefasst
- **Genres und Tags** aus dem Steam-Store: `genres`, `developer`, `release_year`, `metacritic`, `#genre/...`
- **Backlog:** Ungespielte Spiele stehen als Liste im Dashboard. Mit „Backlog-Spiel einplanen“ wird daraus eine Note.
- **Sync** beim Start, im Intervall (Standard 60 min) oder per Ribbon-Icon bzw. Befehl.
- **Deutsch und Englisch:** Die Plugin-Sprache lässt sich in den Einstellungen umschalten. Standard ist die Sprache von Obsidian. Beim Wechsel werden die Notes in die übersetzten Ordner verschoben.

## Installation

1. Den Ordner nach `<Vault>/.obsidian/plugins/steam-tracker/` kopieren oder klonen:
   ```bash
   git clone https://github.com/Fynn-Pritzkau/Steam-Adchivment-Tracker.git "<Vault>/.obsidian/plugins/steam-tracker"
   ```
2. In Obsidian: Einstellungen → Community-Plugins → eingeschränkten Modus aus → **Dataview** installieren → **Steam Tracker** aktivieren.
3. Einen Steam-API-Key holen: https://steamcommunity.com/dev/apikey
4. In Steam die Privatsphäre-Einstellung **„Spieldetails: Öffentlich“** setzen.
5. In den Plugin-Einstellungen Key und Profil (SteamID64, Profil-URL oder Profilname) eintragen und synchronisieren.

## Befehle

| Befehl | Funktion |
|---|---|
| Steam Tracker öffnen | Öffnet die Ansicht mit Bibliothek, Board und Statistik |
| Dieses Spiel im Steam Tracker zeigen | Öffnet die Detailseite der aktiven Spiel-Note |
| Jetzt synchronisieren | Sync nur geänderter Spiele (nach Spielzeit) |
| Alles neu synchronisieren | Ignoriert den Cache |
| Dieses Spiel synchronisieren | Nur die aktive Note |
| Als Nächstes öffnen | Öffnet die Fokus-Seite |
| Backlog-Spiel einplanen | Ungespieltes Spiel nach „0 Als Nächstes“ holen |
| Dashboard zurücksetzen | Dashboard neu erzeugen (altes wird gesichert) |

## Hinweise

- Der API-Key wird im Klartext in `data.json` gespeichert. Die Datei ist per `.gitignore` ausgeschlossen.
- Das Plugin legt neben sich einen lokalen Cache in `cache/` an. Darin liegen die vollständigen Achievement-Listen und ein täglicher Spielzeit-Snapshot für das Diagramm „Stunden pro Tag“. Steam liefert keinen Spielzeit-Verlauf, deshalb füllt sich dieses Diagramm erst ab der Installation dieser Version. „Achievements pro Monat“ funktioniert dagegen rückwirkend.

## Entwicklung

Das Plugin ist in TypeScript geschrieben und wird mit esbuild gebaut. Die gebaute `main.js` liegt mit im Repo, damit die Installation per `git clone` ohne Build funktioniert.

```bash
npm install
npm run dev     # baut main.js bei jeder Änderung neu
npm run build   # Typprüfung + minifizierter Produktions-Build
```

Der Quellcode liegt in `src/`: `main.ts` (Plugin, Befehle), `steam/` (API), `sync/` (Sync-Logik), `vault/` (Notes, Dashboard, „Als Nächstes“), `data/` (Cache, Verlauf, GameStore), `ui/` (Ansicht), `i18n.ts` (Texte).
