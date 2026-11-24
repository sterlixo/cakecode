# architecture

how cakecode is wired: five processes, one proxy, and a browser tab that is
repaired at runtime rather than built.

numbers here were read off the live machine, not guessed. file/line references
match `ui.mjs` as of the commit that added this document.

---

## 0. the structural fact everything follows from

**The repository is the runtime config directory.**

```
  git checkout  ==  ~/.config/cakecode   <-- ui.mjs reads and writes here
```

`ui.mjs` defaults its state root to `os.homedir()/.config/cakecode` (`CC_CONF`
overrides it). So the checkout contains live mutable state:

| file | role |
|---|---|
| `theme.json` | **both** the shipped default and the live theme — `POST /__cc/theme` rewrites it |
| `service.json` | upstream port + password, read per request |
| `ui.log` | launchd stdout, gitignored |
| `wallpapers/` | served at `/__cc/wall/<name>` |
| `favicon/` | served at `/__cc/favicon/<size>` |

Consequence: after any normal use of the customization drawer, `theme.json` is
dirty. It is state that happens to be tracked.

---

## 1. process topology

```
   browser tab
   http://127.0.0.1:49778
        │
        │
   ┌────▼─────────────────────────┐        ┌───────────────────────────┐
   │ ui.mjs            :49778     │◄───────┤ launchd ai.cakecode.ui    │
   │ theme + branding proxy       │ spawn  │ RunAtLoad, KeepAlive      │
   │ 2,574 lines, no dependencies │        │ plist NOT in this repo    │
   └───┬────────────────────┬─────┘        └───────────────────────────┘
       │                    │
       │ proxied HTML       │ /__cc/quota, /__cc/events[/stream],
       │ + injected assets  │ /__cc/health, /__cc/quota/rotate
       │                    ▼
       │            ┌────────────────────┐       ┌──────────────────────┐
       │            │ zen relay :8791    │──────►│ WARP tunnel :40000   │
       │            │ bun server.js      │       │ outbound egress      │
       │            │ quota + event bus  │       └──────────────────────┘
       │            └────────────────────┘
       ▼
   ┌────────────────────────────┐
   │ opencode server   :49777   │   Basic auth from service.json
   │ app shell + /api + DB      │   user "opencode", pass from file
   └──────────┬─────────────────┘
              │ model traffic -> baseURL 127.0.0.1:8787/v1
              ▼
   ┌────────────────────────────┐
   │ zengate           :8787    │   OpenAI-compatible shim, no deps
   │ ~/zenfree/zengate.mjs      │   chain below
   └────────────────────────────┘
```

### ports

| port | owner | responsibility | binds |
|---|---|---|---|
| 49777 | `opencode` | app shell, `/api`, sessions, SQLite | loopback |
| 49778 | `node ui.mjs` | theme proxy — **the artifact in this repo** | loopback |
| 8787 | `node zengate.mjs` | model shim, per-request failover chain | loopback |
| 8791 | `bun server.js` | native free tier via WARP, quota latch, SSE | loopback |
| 40000 | `warp-cli` | tunnel used by 8791 | loopback |

### model failover chain (zengate, outside this repo)

```
  cakecode/deepseek-v4.1-flash-free
        │
        ▼
  1. zen-native  http://127.0.0.1:8791/v1   (bun + WARP, x-opencode fingerprint)
  2. openrouter  ALIASES[model] || DEFAULT_FREE
  3. kilo        kilo-auto/free
  4. openrouter  google/gemma-4-31b-it:free
  5. groq        openai/gpt-oss-120b
```

First 200 wins. `429` on hop 1 rotates WARP rather than failing the request.

---

## 2. launch paths

Two entry points. Only one of them is themed.

```
  $ cakecode                                 $ cakecode-ui
       │                                          │
       ▼                                          ▼
  bin/cakecode                               bin/cakecode-ui
  │                                          ├─ up() ?  → open browser
  │ exports, isolating the instance:         ├─ 49777 down → cakecode service start
  │   OPENCODE_CONFIG_DIR = ~/.config/cakecode│
  │   OPENCODE_DB         = ROOT/cakecode.db  ├─ launchctl bootout  (ignore errors)
  │   XDG_DATA_HOME       = ROOT              ├─ launchctl bootstrap PLIST (ignore errors)
  │   XDG_STATE_HOME      = ROOT/state        ├─ launchctl kickstart -k
  │   XDG_CACHE_HOME      = ROOT/cache        └─ poll /__cc/theme x40 @250ms
  │   OPENCODE_DISABLE_AUTOUPDATE = 1
  ▼
  ~/.opencode/bin/opencode   ← isolated DB, state, cache
       │
       ▼
  reads opencode.jsonc
     model          cakecode/deepseek-v4.1-flash-free
     default_agent  cakecode
     provider       cakecode -> @ai-sdk/openai-compatible  baseURL 127.0.0.1:8787/v1
       │
       └─► TUI. no theme proxy, no wallpaper, no branding swap.
```

`ROOT = ~/.local/share/cakecode`. LaunchAgent label is `ai.cakecode.ui`.

---

## 3. request lifecycle in the proxy

`ui.mjs` is a single `http.createServer` handler (`server` at line 2331). Thirteen
paths are handled locally; **everything else is proxied**.

```
  req ──► 49778
           │
           ├─ /__cc/selftest            GET    iframe harness, own CSP
           ├─ /__cc/theme               GET    readTheme()  -> sanitized JSON
           ├─ /__cc/theme               POST   writeTheme(patch) -> disk
           ├─ /__cc/wallpapers          GET    list wallpapers/
           ├─ /__cc/quota               GET    -> relay /__quota
           ├─ /__cc/quota/reset         POST   -> relay /__quota/reset
           ├─ /__cc/events              GET    -> relay /__events
           ├─ /__cc/events/stream       GET    -> relay /__events/stream (piped)
           ├─ /__cc/quota/rotate        POST   warp-cli rotate + egress probe
           ├─ /__cc/health              GET    N-model probe, max_tokens 1 each
           ├─ /__cc/wall                POST   upload, 64MB cap, extension allowlist
           ├─ /__cc/favicon/<size>      GET    whitelisted {16,32,48,180,192,512}
           └─ /__cc/wall/<name>         GET    bytes; HTTP Range -> 206 for video
                       │
                       ▼  (no match)
              proxy to TARGET (49777)
                 │
                 ├─ withUpstreamAuth()    strips client Authorization,
                 │                        attaches Basic("opencode:"+password)
                 │                        re-reads service.json on mtime change
                 │
                 ├─ if content-type != text/html
                 │      stream through untouched
                 │
                 └─ if text/html
                        brandShell()       OpenCode -> cakecode in <title>, og:*
                        stripIconLinks()   drop upstream favicon.ico + apple-touch
                        inject inj.head    before </head>
                        inject inj.body    before </body>
                        patchCsp()         sha256 allowlist for inline scripts
```

`server.on('upgrade')` (line 2555) tunnels websockets over raw TCP to 49777,
forwarding headers minus `host`.

### what gets injected

```
  upstream index.html
        │
        ├─ brandShell()         <title>, <meta content="...OpenCode...">
        ├─ stripIconLinks()     <link rel=icon>, <link rel=apple-touch-icon>
        │
        ├─ <head> += 
        │     fonts.googleapis preconnect + stylesheet
        │     faviconTags()           6 PNG links + apple-touch
        │     <style #cc-vars>        themeCss(t)      <- server sheet, 122 lines
        │     <style #cc-wall-css>    wallpaperCss(t)  <- server sheet
        │     <style #cc-struct>      STRUCT_CSS       <- static chrome, 170 lines
        │     <script>                buildInitScript  -> __CC_THEME__,
        │                                                __CC_DEFAULTS__,
        │                                                __CC_THEMES__
        │
        └─ </body> += 
              UI_HTML                 9 nodes: wall, video, tint, petals,
                                      dock, toast, console, drawer, palette
              <script> UI_JS          1,385 lines of client runtime
```

CSP is rewritten, never removed: the two inline scripts are hashed
(`INLINE_SCRIPT_HASH`, line 2010) and appended to `script-src`/`style-src`.

---

## 4. client runtime: who owns what

`UI_JS` is an IIFE. `boot()` (line 1975) runs once, then three `MutationObserver`s
and two intervals keep the theme true.

```
  boot()
   ├── applyTheme()
   │     ├─ styleEl('cc-vars')      <- varsCss(T)      REPLACES server sheet
   │     ├─ styleEl('cc-wall-css')  <- wallCss(T)      REPLACES server sheet
   │     ├─ <html> classList        cc-focus | cc-compact | cc-reduce
   │     ├─ dock className          cc-<hudPos>
   │     ├─ renderWallpapers()
   │     ├─ applyWallVideo()
   │     └─ applyPetals()
   ├── buildPanel()      7 tabs: look quota wallpaper motion layout brand raw
   ├── loadWalls()       GET /__cc/wallpapers
   ├── renderThemes()    8 presets
   ├── watchTitle()      MutationObserver on <title>
   ├── scheduleSwap()    x4 (t=0,400,1200,3000) then setInterval 2500ms
   ├── pollQuota()       GET /__cc/quota, then every 6s
   ├── connectEvents()   only if the console is already open
   └── hash routes       #ui / #settings -> drawer,  #console -> console
```

### the three observers — the theme is repaired, not rendered once

The upstream SPA re-renders on every route change and would repaint the original
brand for a frame. Every visual guarantee here is a race being won.

```
  document.body   MutationObserver
     │  (childList, subtree, characterData)
     ├─► swapTouched(records)          SYNCHRONOUS, same frame the app painted
     │      text nodes: OpenCode -> cakecode
     │      attributes: aria-label, title, placeholder, alt, aria-description
     │      skips: SCRIPT STYLE TEXTAREA INPUT CODE PRE + [data-cc-noswap]
     │
     └─► scheduleSwap()                debounced 250ms
            ├─ brandSwap(document.body)      full TreeWalker sweep
            ├─ swapWordmarks()               blank 234x42 plates (viewBox w>=140, h<=64)
            └─ hideWordmarkHost()            visibility:hidden on
                                             [data-slot=wordmark-box],
                                             [data-component=new-session-wordmark]
                                             + animation:none (kills the shimmer)

  document.head   MutationObserver  ──► watchTitle() when a new <title> is added
  <title>         MutationObserver  ──► applyTitle()   (re-bound per <title>)
  window          error / unhandledrejection ──► window.__ccErr (read by selftest)
```

Plus two intervals: `scheduleSwap` every 2500ms as a safety net for anything the
scoped pass cannot see, and `pollQuota` every 6000ms while the page is open.

`applyTitle()` writes `cakecode` at home and `<session> · cakecode` inside a
session, and is idempotent so observer callbacks cannot loop.

The wordmark is matched by **aspect ratio**, not by slot, because the square
16x20 logo mark carries the same `data-slot=logo-*` children as the wide plate.

---

## 5. theme state lives in three places

```
   theme.json  (disk)  ◄──── POST /__cc/theme, debounced 350ms ────┐
        │                                                          │
        │ GET /__cc/theme   (+ readTheme per proxied HTML request)  │
        ▼                                                          │
   __CC_THEME__  (window global, injected per request)              │
        │                                                          │
        ▼                                                          │
   T = {...__CC_THEME__}  ── set() / setAndDetach() ── applyTheme() │
        │                        │                                  │
        │                        └── persist() ────────────────────┘
        └── also mirrored to localStorage['cc.theme']
```

`localStorage['cc.theme']` is written and **never read**. Boot uses the injected
server copy, so the server is the single source of truth. That is deliberate
(it makes a stale browser cache harmless) but it means the localStorage entry is
dead weight, not a fallback.

`sanitize()` (line 156) is the only writer gate: 16 numeric clamps, enum
allowlists for `wallMode` / `wallFit` / `hudPos`, hex validation for the eight
color keys, and length caps on strings. `writeTheme` always merges over
`readTheme()` then re-sanitizes, so a partial PATCH cannot drop keys.

---

## 6. the duplicate stylesheet problem

There are **two hand-maintained copies of the same sheet**, and the client one
wins at runtime:

```
  server   themeCss(t)      (line 230)  ──►  <style #cc-vars>
  client   varsCss(t)       (line 656)  ──►  replaces #cc-vars on boot

  server   wallpaperCss(t)  (line 352)  ──►  <style #cc-wall-css>
  client   wallCss(t)       (line 753)  ──►  replaces #cc-wall-css on boot
```

They have already diverged. Diffing the two at the time of writing:

| rule | server | client | live | effect |
|---|---|---|---|---|
| `scrollbar-thumb:hover` | yes | **no** | absent | hover tint dies after boot |
| `cc-reduce` wall transform | yes | **no** | absent | parallax not reset under reduce-motion |
| `html{font-size}` from `uiScale` | **no** | yes | present | scale applies only after JS boots |
| `--cc-scale` property | yes | no | absent | declared, consumed nowhere |

This seam has already shipped a silent regression: commit `1a5202b` records that
focus-mode dimming "lived only in the server `themeCss`, but the client's
`varsCss` replaces that sheet at boot — so the rule stopped applying as soon as
the drawer rebuilt anything." The fix had to be written into both copies.

Any future stylesheet change belongs in both, or the pair should be collapsed
into one generator.

---

## 7. wallpaper pipeline

```
  wallMode: none | gradient | url | file | video
                                       │
              ┌────────────────────────┴────────────────────────┐
              ▼                                                 ▼
      #cc-wall (still layer)                        #cc-wall-video
      z-index -3                                    z-index -3, later in DOM
      position fixed, inset -4%                     <video muted loop playsinline>
      background-image                              width/height 108%
      filter: blur saturate brightness contrast     same filter chain
      opacity from wallOpacity                      object-fit from wallFit
              │                                                 │
              │                                    loadeddata ──┘
              │                                        │ capturePoster()
              │                                        │   canvas, scaled to 1920 max
              │                                        │   toDataURL('image/jpeg', 0.82)
              │                                        │   keyed by T.wallUrl
              │◄────────── syncPoster() ───────────────┘   (inline background-image)
              │             cleared when leaving video mode
              ▼
      #cc-wall-tint   z-index -2
      radial vignette (wallVignette) + flat wallDim
```

Degradation paths, all verified in the running app:

| condition | behaviour |
|---|---|
| `reduceMotion` on | `<video>` paused, poster still painted |
| tab hidden | `visibilitychange` -> pause, poster still painted |
| `play()` rejected (low power) | promise swallowed, poster still painted |
| codec error | `posterCache[url] = null`, still layer shows |
| `wallMode` not video | still layer uses `background-image`, video `display:none` |

The still layer is **always mounted**, even in video mode. That is the fix for the
black-screen-on-boot bug: a paused or not-yet-decoded `<video>` paints nothing,
so hiding the still layer left the viewport on the bare body color.

Serving: `/__cc/wall/<name>` answers Range requests with `206` +
`content-range`, because `<video>` seeks by range and would otherwise buffer an
18MB file before the first frame.

---

## 8. file map

```
  install.sh ── curl | bash ──► fetch from raw.githubusercontent.com/sterlixo/cakecode
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                         ▼
  agents/cakecode.md        opencode.jsonc            theme.json
  persona + operating       model + provider          palette, wallpaper,
  rules, primary agent      wiring to :8787           scrim, fonts, brand
        │                        │                         │
        │                        │                    ui.mjs  2,574 lines
        │                        │                    ├─   35-100  8 THEMES presets
        │                        │                    ├─  104-228  DEFAULTS, sanitize,
        │                        │                    │            readTheme, writeTheme
        │                        │                    ├─  230-407  themeCss, wallpaperCss
        │                        │                    ├─  410-578  STRUCT_CSS
        │                        │                    ├─  580-615  UI_HTML
        │                        │                    ├─  617-2000 UI_JS
        │                        │                    ├─ 2004-2066 buildInitScript,
        │                        │                    │            patchCsp, brandShell,
        │                        │                    │            faviconTags,
        │                        │                    │            stripIconLinks
        │                        │                    └─ 2069-2574 relay, warp, routes,
        │                        │                                 proxy, upgrade
        ▼                        ▼                         │
  service.json             zengate :8787 ──► :8791 ──► WARP
  { port, password }       failover chain
        │
        ├─ bin/cakecode      isolated opencode instance (own DB/state/cache)
        ├─ bin/cakecode-ui   launchd ai.cakecode.ui -> ui.mjs
        ├─ favicon/          6 PNG + master, whitelist-served
        └─ wallpapers/       svg + jpg + 18MB mp4, Range-served
```

No dependencies: `ui.mjs` imports only `node:*` builtins (`http`, `net`, `fs`,
`path`, `os`, `crypto`, `child_process`).

---

## 9. one turn end to end

```
  you type into the composer
        │
        ▼
  SPA fetch /api/...          (401 without auth)
        │
        ▼
  49778 ui.mjs  ──►  withUpstreamAuth()  ──►  Basic("opencode:"+password)
        │
        ▼
  49777 opencode server
        │
        ▼
  model cakecode/deepseek-v4.1-flash-free
        │
        ▼
  8787 zengate
        │
        ├─► 8791 relay  ──► WARP ──► opencode.ai        (hop 1)
        └─► openrouter ─► kilo ─► groq                  (hops 2-5, on 429/error)
        │
        ▼
  SSE streamed back  49777 -> 49778 -> browser
        │
        └─► relay also emits quota + stat events
                   │
                   ▼
             SSE /__cc/events/stream  ──►  console panel, live dot
```

---

## 10. known gaps (verified, not hypothetical)

1. **`install.sh` never fetches `wallpapers/`.** The committed `theme.json` points
   at `/__cc/wall/sakura-tree-girl.mp4`, which a fresh install does not have.
   Confirmed by running `ui.mjs` against an empty `CC_CONF`: `/__cc/wallpapers`
   returned `{"files":[]}` and the committed wallpaper URL returned `404`. It
   degrades to the gradient rather than breaking, but the wallpaper is absent.

2. **The LaunchAgent plist is not in this repo and `install.sh` does not create
   it.** `cakecode-ui` calls `launchctl bootstrap "$PLIST"` with `|| true`, so a
   missing plist fails silently and the 10s readiness poll then times out with no
   explanation. Verified by running the bootstrap path against an empty `HOME`
   where no plist exists. `bin/cakecode-ui` is the only thing that references the
   label, so nothing else creates it either.

3. **`service.json` ships a real password** (`cakelocal`) in the repo. It only
   guards a loopback-bound server, so the blast radius is local processes, but
   it is a tracked credential.

4. **The two stylesheet builders have diverged** — see §6. Two rules exist only
   in the server copy and stop applying once the client overwrites it
   (`scrollbar-thumb:hover`, `cc-reduce` transform reset); one exists only in the
   client copy, so it is absent on first paint (`uiScale`).

5. **`localStorage['cc.theme']` is write-only.** Harmless, but it looks like a
   fallback and is not one.

6. **`--cc-scale` is declared and never consumed.** `uiScale` reaches the page
   only through the client sheet's `html{font-size}`.

7. **No automated tests.** `GET /__cc/selftest` is a manual iframe harness that
   reports computed values; it is not wired into any runner.
