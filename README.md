# FEATHER NET (desktop)

Crew, dispatch and story desk for X-Plane 12, as a standalone Windows app. Before this, FEATHER NET ran as a claude.ai Artifact and needed the FEATHER LINK extension in the Claude desktop app. Now it's one program:

- **FEATHER LINK is built in.** The app listens to X-Plane 12 on UDP port 49000 and picks up the APU, engine start, taxi, takeoff, top of climb and descent, touchdown rate and parking. It also fetches road routes, places and map tiles for the map.
- **The story desk uses the Claude API** with your own key. It writes the briefs, crew briefings, crew replies and ratings.
- **Your campaign is saved on this PC**, as JSON files in the app's data folder (File › Open data folder).

## Run it

Download `FEATHER-NET-<version>-portable.exe` (no install, just run it) or `FEATHER-NET-Setup-<version>.exe` (installs with a Start-menu shortcut). Both are built by GitHub Actions; open the latest run of **Build FEATHER NET** and download the `FEATHER-NET-windows` artifact.

The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**. When Windows Firewall asks about FEATHER NET, allow it on private networks so X-Plane's data can reach it.

### First start

1. **Settings** opens on its own (later: File › Settings, or Ctrl+,).
2. Paste a Claude API key from <https://console.anthropic.com/settings/keys>. **Test key**, then **Save**. On Windows the key is encrypted with your Windows account (DPAPI). Without a key the app still works; you load briefs made elsewhere on the Dispatch tab.
3. If X-Plane runs on a different computer, enter that computer's address. Otherwise leave `127.0.0.1` / `49000`.

### Moving an existing campaign over from claude.ai

In the old page, go to Dispatch › Campaign file › **Export**. In the app, use **Import** on the same card.

## Models

Settings › Model picks the Claude model (Opus 5.5 by default; Sonnet 5.5 and Haiku 5.5 cost less). The page's tiers set the effort level: crew replies and ratings run at `low`, briefs at `medium`, and "Brief writer › Best, slower" at `high`. Requests on Opus and Sonnet opt into the API's server-side refusal fallback (`fallbacks: "default"`).

## Develop

```sh
npm install
npm start          # run the app
npm test           # bridge (fake X-Plane over UDP), storage, JSON parsing
npm run dist:win   # build dist/*.exe (the installer target needs Windows or Wine)
```

| Path | What |
| --- | --- |
| `app/index.html` | The FEATHER NET page (from the original artifact, with host text adjusted) |
| `app/brief/brief.html` | The crew brief template |
| `app/host-shim.js` | Provides the page's `window.claude.use(...)` capabilities (`db`, `sample`, `downloads`, `mcp`, `permissions`) from the app |
| `app/settings.html` | Settings window |
| `electron/main.js` | Window, `app://` protocol, menu, IPC |
| `electron/bridge.js` | FEATHER LINK: X-Plane RREF over UDP, flight-event detection, OSRM / Nominatim / CARTO |
| `electron/claude.js` | Claude API calls (streaming, JSON parsing, error mapping) |
| `electron/store.js`, `electron/settings.js` | Campaign files, settings and API key |
| `original/` | The original artifact zip and `feather-link.mcpb`, for reference |

Map data © OpenStreetMap contributors © CARTO.
