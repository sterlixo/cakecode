// JavaScript, ui.mjs, Node 18+, theme + customization proxy for the
// cakecode web UI. Proxies 127.0.0.1:49777 and injects a live editor:
// colors, fonts, radius, density, wallpaper (URL / file / folder), motion,
// branding (rename everywhere), raw CSS, theme JSON export/import.
//
//   node ui.mjs                 serve on 127.0.0.1:49778 -> 49777
//   CC_TARGET / CC_PORT         override target / listen
//
// State: ~/.config/cakecode/theme.json
//        ~/.config/cakecode/wallpapers/   (drop images here)

import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const TARGET = process.env.CC_TARGET || 'http://127.0.0.1:49777'
const PORT = Number(process.env.CC_PORT || 49778)
const HOST = process.env.CC_HOST || '127.0.0.1'
const CONF_DIR = process.env.CC_CONF || path.join(os.homedir(), '.config', 'cakecode')
const THEME_FILE = path.join(CONF_DIR, 'theme.json')
const WALL_DIR = path.join(CONF_DIR, 'wallpapers')
const MAX_THEME_BYTES = 512 * 1024

fs.mkdirSync(WALL_DIR, { recursive: true })

/* --------------------------------------------------------------- presets */

// Full theme presets: palette + geometry + wallpaper defaults. Selecting one
// replaces those keys only; per-user tweaks (fonts, brand, custom CSS) survive.
const THEMES = [
  {
    id: 'sakura',
    name: 'sakura terminal',
    note: 'default',
    swatch: ['#ff6f9f', '#c77dff', '#0a0710', '#251732'],
    theme: { accent: '#ff6f9f', accent2: '#c77dff', bg0: '#0a0710', bg1: '#110b19', bg2: '#160e21', bg3: '#251732',
      textBase: '#f8eaf2', textMuted: '#cba8be', radius: 12, wallMode: 'file', wallUrl: '/__cc/wall/sakura-night.svg' },
  },
  {
    id: 'ice',
    name: 'arctic glass',
    note: 'cool',
    swatch: ['#63c8ff', '#a78bfa', '#060a12', '#132030'],
    theme: { accent: '#63c8ff', accent2: '#a78bfa', bg0: '#060a12', bg1: '#0a1119', bg2: '#0f1922', bg3: '#152431',
      textBase: '#e8f4ff', textMuted: '#9fb6cc', radius: 14, wallMode: 'file', wallUrl: '/__cc/wall/deep-grid.svg' },
  },
  {
    id: 'ember',
    name: 'ember forge',
    note: 'warm',
    swatch: ['#ff9558', '#ff4d6d', '#0d0704', '#2b1710'],
    theme: { accent: '#ff9558', accent2: '#ff4d6d', bg0: '#0d0704', bg1: '#150c07', bg2: '#1d1109', bg3: '#2b1710',
      textBase: '#ffeee0', textMuted: '#c8a48d', radius: 10, wallMode: 'gradient', wallUrl: '' },
  },
  {
    id: 'mint',
    name: 'mint grid',
    note: 'cool',
    swatch: ['#5ce6b0', '#4aa8ff', '#04100c', '#0d2019'],
    theme: { accent: '#5ce6b0', accent2: '#4aa8ff', bg0: '#04100c', bg1: '#071611', bg2: '#0a1d17', bg3: '#0d2019',
      textBase: '#e6fff6', textMuted: '#96c2b1', radius: 8, wallMode: 'file', wallUrl: '/__cc/wall/deep-grid.svg' },
  },
  {
    id: 'void',
    name: 'void mono',
    note: 'mono',
    swatch: ['#c9d1d9', '#8b949e', '#000000', '#161b22'],
    theme: { accent: '#c9d1d9', accent2: '#8b949e', bg0: '#000000', bg1: '#0a0c10', bg2: '#11151b', bg3: '#161b22',
      textBase: '#e6edf3', textMuted: '#9aa4af', radius: 6, wallMode: 'none', wallUrl: '' },
  },
  {
    id: 'cyber',
    name: 'cyber yellow',
    note: 'loud',
    swatch: ['#ffe066', '#ff4d9d', '#08070a', '#1e1a10'],
    theme: { accent: '#ffe066', accent2: '#ff4d9d', bg0: '#08070a', bg1: '#0e0c11', bg2: '#151118', bg3: '#1e1a10',
      textBase: '#fff9e0', textMuted: '#c4b58a', radius: 4, wallMode: 'gradient', wallUrl: '' },
  },
  {
    id: 'matcha',
    name: 'matcha paper',
    note: 'soft',
    swatch: ['#8fbc8f', '#b48ead', '#0b100b', '#1c2419'],
    theme: { accent: '#8fbc8f', accent2: '#b48ead', bg0: '#0b100b', bg1: '#101610', bg2: '#151d15', bg3: '#1c2419',
      textBase: '#eaf4e8', textMuted: '#a3b8a0', radius: 16, wallMode: 'gradient', wallUrl: '' },
  },
  {
    id: 'crimson',
    name: 'crimson ink',
    note: 'sharp',
    swatch: ['#ff3860', '#ff8c42', '#0a0406', '#2a0d14'],
    theme: { accent: '#ff3860', accent2: '#ff8c42', bg0: '#0a0406', bg1: '#120609', bg2: '#1a090e', bg3: '#2a0d14',
      textBase: '#ffe8ec', textMuted: '#c99aa5', radius: 2, wallMode: 'gradient', wallUrl: '' },
  },
]

/* ------------------------------------------------------------------ theme */

const DEFAULTS = {
  themeId: 'sakura',
  // palette
  accent: '#ff6f9f',
  accent2: '#c77dff',
  bg0: '#0a0710',
  bg1: '#110b19',
  bg2: '#160e21',
  bg3: '#251732',
  textBase: '#f8eaf2',
  textMuted: '#cba8be',
  // geometry / type
  radius: 12,
  density: 1,
  uiScale: 1,
  fontSans: 'Outfit',
  fontMono: 'JetBrains Mono',
  codeSize: 13,
  letterSpacing: 0,
  // wallpaper
  wallMode: 'gradient', // none | gradient | url | file | video
  wallUrl: '',
  wallFit: 'cover',
  wallPos: 'center',
  wallBlur: 0,
  wallDim: 0.42,
  wallSat: 1,
  wallBright: 1,
  wallContrast: 1,
  wallOpacity: 1,
  wallParallax: 0,
  wallVignette: 0.55,
  wallTile: false,
  // motion
  petals: 1,
  reduceMotion: false,
  // branding
  brandFrom: 'OpenCode',
  brandTo: 'cakecode',
  hudPos: 'br',
  // layout
  focus: false,
  compactSidebar: false,
  backdropBlur: 18,
  // How much darkening sits between the wallpaper and the app content. Enough
  // to hold text contrast over a bright photo, light enough to keep the image
  // readable instead of muddy.
  panelScrim: 0.20,
  // free-form
  customCss: '',
}

function sanitize(theme) {
  const out = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (theme && Object.prototype.hasOwnProperty.call(theme, k) && theme[k] !== null && theme[k] !== undefined) {
      out[k] = theme[k]
    }
  }
  const num = (v, lo, hi, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  out.radius = num(out.radius, 0, 32, DEFAULTS.radius)
  out.density = num(out.density, 0.75, 1.5, DEFAULTS.density)
  out.uiScale = num(out.uiScale, 0.8, 1.4, DEFAULTS.uiScale)
  out.codeSize = num(out.codeSize, 10, 22, DEFAULTS.codeSize)
  out.letterSpacing = num(out.letterSpacing, -0.02, 0.12, DEFAULTS.letterSpacing)
  out.wallBlur = num(out.wallBlur, 0, 40, DEFAULTS.wallBlur)
  out.wallDim = num(out.wallDim, 0, 1, DEFAULTS.wallDim)
  out.wallSat = num(out.wallSat, 0, 2, DEFAULTS.wallSat)
  out.wallBright = num(out.wallBright, 0.2, 4, DEFAULTS.wallBright)
  out.wallContrast = num(out.wallContrast, 0.5, 2.5, DEFAULTS.wallContrast)
  out.wallOpacity = num(out.wallOpacity, 0, 1, DEFAULTS.wallOpacity)
  out.wallParallax = num(out.wallParallax, 0, 1, DEFAULTS.wallParallax)
  out.wallVignette = num(out.wallVignette, 0, 1, DEFAULTS.wallVignette)
  out.petals = num(out.petals, 0, 3, DEFAULTS.petals)
  out.backdropBlur = num(out.backdropBlur, 0, 40, DEFAULTS.backdropBlur)
  out.panelScrim = num(out.panelScrim, 0, 0.85, DEFAULTS.panelScrim)
  out.compactSidebar = !!out.compactSidebar
  out.reduceMotion = !!out.reduceMotion
  out.wallTile = !!out.wallTile
  out.focus = !!out.focus
  if (['none', 'gradient', 'url', 'file', 'video'].indexOf(out.wallMode) < 0) out.wallMode = 'gradient'
  if (['cover', 'contain', 'fill', 'none'].indexOf(out.wallFit) < 0) out.wallFit = 'cover'
  if (['br', 'bl', 'tr', 'tl'].indexOf(out.hudPos) < 0) out.hudPos = 'br'
  for (const k of ['accent', 'accent2', 'bg0', 'bg1', 'bg2', 'bg3', 'textBase', 'textMuted']) {
    if (typeof out[k] !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(out[k])) out[k] = DEFAULTS[k]
  }
  out.themeId = String(out.themeId || DEFAULTS.themeId).slice(0, 40)
  out.customCss = String(out.customCss || '').slice(0, 20000)
  out.brandFrom = String(out.brandFrom || '').slice(0, 60)
  out.brandTo = String(out.brandTo || '').slice(0, 60)
  out.wallUrl = String(out.wallUrl || '').slice(0, 2048)
  out.fontSans = String(out.fontSans || DEFAULTS.fontSans).slice(0, 60)
  out.fontMono = String(out.fontMono || DEFAULTS.fontMono).slice(0, 60)
  out.wallPos = String(out.wallPos || 'center').slice(0, 40)
  return out
}

function readTheme() {
  try {
    return sanitize(JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

function writeTheme(patch) {
  const next = sanitize({ ...readTheme(), ...(patch || {}) })
  fs.writeFileSync(THEME_FILE, JSON.stringify(next, null, 2))
  return next
}

function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex)
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
}

function themeCss(t) {
  const a = t.accent
  const a2 = t.accent2
  const fs_ = Number(t.uiScale).toFixed(2)
  return [
    ':root {',
    '  --v2-background-bg-deep: ' + t.bg0 + ' !important;',
    '  --v2-background-bg-base: ' + t.bg1 + ' !important;',
    '  --v2-background-bg-layer-01: ' + t.bg2 + ' !important;',
    '  --v2-background-bg-layer-02: ' + t.bg3 + ' !important;',
    '  --v2-background-bg-layer-03: ' + t.bg3 + ' !important;',
    '  --v2-background-bg-layer-04: ' + t.bg3 + ' !important;',
    '  --v2-background-bg-inverse: ' + t.textBase + ' !important;',
    '  --v2-background-bg-contrast: ' + a + ' !important;',
    '  --v2-background-bg-accent: ' + a + ' !important;',
    '  --v2-background-bg-button-neutral: ' + t.bg2 + ' !important;',
    '  --v2-background-bg-code-path: ' + t.bg3 + ' !important;',
    '  --v2-text-text-base: ' + t.textBase + ' !important;',
    '  --v2-text-text-muted: ' + t.textMuted + ' !important;',
    '  --v2-text-text-faint: ' + rgba(t.textMuted, 0.72) + ' !important;',
    '  --v2-text-text-inverse: ' + t.bg0 + ' !important;',
    '  --v2-text-text-contrast: ' + t.bg0 + ' !important;',
    '  --v2-text-text-accent: ' + a + ' !important;',
    '  --v2-text-text-accent-hover: ' + a2 + ' !important;',
    '  --v2-text-text-code-accent: ' + a + ' !important;',
    '  --v2-text-text-code-path: ' + a2 + ' !important;',
    '  --v2-icon-icon-base: ' + rgba(t.textBase, 0.9) + ' !important;',
    '  --v2-icon-icon-muted: ' + rgba(t.textMuted, 0.85) + ' !important;',
    '  --v2-icon-icon-faint: ' + rgba(t.textMuted, 0.55) + ' !important;',
    '  --v2-icon-icon-accent: ' + a + ' !important;',
    '  --v2-icon-icon-accent-hover: ' + a2 + ' !important;',
    '  --v2-border-border-base: ' + rgba(a, 0.24) + ' !important;',
    '  --v2-border-border-muted: ' + rgba(a, 0.13) + ' !important;',
    '  --v2-border-border-strong: ' + rgba(a, 0.42) + ' !important;',
    '  --v2-border-border-focus: ' + a + ' !important;',
    '  --v2-overlay-simple-overlay-hover: ' + rgba(a, 0.10) + ' !important;',
    '  --v2-overlay-simple-overlay-pressed: ' + rgba(a, 0.20) + ' !important;',
    '  --v2-overlay-simple-overlay-scrim: ' + rgba(t.bg0, 0.82) + ' !important;',
    '  --v2-overlay-simple-tab-scrim: ' + rgba(a, 0.06) + ' !important;',
    '  --v2-overlay-simple-tab-hover-scrim: ' + rgba(a, 0.12) + ' !important;',
    '  --v2-overlay-simple-tab-active-scrim: ' + rgba(a, 0.18) + ' !important;',
    '  --v2-font-family-sans: \'' + t.fontSans + '\', \'Zen Kaku Gothic New\', system-ui, sans-serif !important;',
    '  --v2-font-family-code: \'' + t.fontMono + '\', ui-monospace, monospace !important;',
    '  --cc-accent: ' + a + ';',
    '  --cc-accent2: ' + a2 + ';',
    '  --cc-radius: ' + t.radius + 'px;',
    '  --cc-scale: ' + fs_ + ';',
    '  color-scheme: dark !important;',
    '}',
    'html, body { background-color: transparent !important; }',
    'body {',
    '  font-family: \'' + t.fontSans + '\', \'Zen Kaku Gothic New\', system-ui, sans-serif !important;',
    '  letter-spacing: ' + t.letterSpacing + 'em;',
    '}',
    // Density scales the app shell only. Zooming <body> drags every
    // position:fixed child (dock, console, drawer) along with it, which pushed
    // the dock off-screen at density != 1.
    '#root { background: transparent !important; zoom: ' + t.density + '; }',
    // The app shell paints an opaque bg-deep surface over the whole viewport,
    // which would hide #cc-wall completely. Tailwind ships these as literal
    // utility classes, so match them by name. Declared first so the specific
    // surfaces further down (titlebar, sidebars, home panel) still win.
    '[class*=\'bg-v2-background-bg-deep\'] { background-color: transparent !important; }',
    // Sticky session headers/banners paint bg-base as a full-width band. Keep
    // them as a translucent, blurred strip instead of an opaque slab.
    '[class*=\'bg-v2-background-bg-base\'].sticky, [class*=\'bg-v2-background-bg-base\'].absolute {',
    '  background-color: ' + rgba(t.bg0, 0.55) + ' !important;',
    '  backdrop-filter: blur(' + t.backdropBlur + 'px) saturate(130%);',
    '}',
    // Every shell view mounts a rounded 10px bg-base plate over the whole
    // viewport: home-panel, the new-session canvas, and session-chat-panel.
    // Only home-panel had a scrim rule, so the other two painted the wallpaper
    // out completely. Match the shared plate shape instead of a data-slot the
    // upstream templates don't provide on two of the three.
    // No backdrop blur: the plate covers the whole viewport, so blurring behind
    // it only smears the wallpaper into mush. Let the image stay sharp.
    '[class*=\'bg-v2-background-bg-base\'][class*=\'rounded-[10px]\'] {',
    '  background-color: ' + rgba(t.bg1, t.panelScrim) + ' !important;',
    '  backdrop-filter: none !important;',
    '}',
    'pre, code, kbd { font-family: \'' + t.fontMono + '\', ui-monospace, monospace !important; }',
    'pre { font-size: ' + t.codeSize + 'px !important; }',
    'pre, [data-slot=\'home-panel\'] { border-radius: var(--cc-radius) !important; }',
    // Keep the wallpaper readable: panels become a light scrim instead of an
    // opaque slab, and the bottom fade stops painting over the image.
    '[data-slot=\'vertical-tabs-sidebar\'], [data-slot=\'sidebar-inbox\'],',
    '[data-slot=\'sidebar-header\'], [data-slot=\'home-panel\'] {',
    '  background: ' + rgba(t.bg1, t.panelScrim) + ' !important;',
    '  backdrop-filter: none !important;',
    '}',
    '[data-slot=\'tabs-trigger-wrapper\'], [data-slot=\'titlebar-v2\'] {',
    '  background: ' + rgba(t.bg0, 0.5) + ' !important;',
    '  backdrop-filter: blur(' + Math.round(t.backdropBlur * 0.45) + 'px);',
    '}',
    '.bg-gradient-to-t.from-v2-background-bg-base {',
    '  --tw-gradient-from: transparent !important;',
    '  background-image: none !important;',
    '}',
    '[data-slot=\'tabs-trigger\'][aria-selected=\'true\'] {',
    '  box-shadow: inset 0 -2px 0 ' + a + ', 0 0 22px ' + rgba(a, 0.16) + ';',
    '}',
    '::selection { background: ' + rgba(a, 0.35) + ' !important; color: #fff !important; }',
    ':focus-visible { outline-color: ' + a + ' !important; }',
    '::-webkit-scrollbar { width: 8px; height: 8px; }',
    '::-webkit-scrollbar-track { background: ' + rgba(t.bg0, 0.7) + '; }',
    '::-webkit-scrollbar-thumb {',
    '  background: linear-gradient(180deg, ' + rgba(a, 0.55) + ', ' + rgba(a2, 0.45) + ');',
    '  border-radius: 8px; border: 2px solid transparent; background-clip: padding-box;',
    '}',
    '::-webkit-scrollbar-thumb:hover { background: ' + rgba(a, 0.8) + '; background-clip: padding-box; }',
    'html.cc-compact [data-slot=\'vertical-tabs-sidebar\'] { max-width: 208px !important; }',
    'html.cc-focus [data-slot=\'vertical-tabs-sidebar\'],',
    'html.cc-focus [data-slot=\'sidebar-inbox\'],',
    'html.cc-focus [data-slot=\'sidebar-header\'],',
    'html.cc-focus [data-slot=\'vertical-tabs-panel\'] { display: none !important; }',
    'html.cc-focus #root { padding-left: 4vw !important; padding-right: 4vw !important; }',
    'html.cc-focus #cc-wall, html.cc-focus #cc-wall-video { opacity: 0.25 !important; }',
    'html.cc-reduce * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }',
    t.customCss || '',
  ].join('\n')
}

function wallpaperCss(t) {
  const isVideo = t.wallMode === 'video'
  const img = isVideo ? '' : (t.wallMode === 'url' || t.wallMode === 'file' ? t.wallUrl : '')
  const grad = [
    'radial-gradient(38% 32% at 18% 12%, ' + rgba(t.accent, 0.20) + ', transparent 70%)',
    'radial-gradient(34% 30% at 84% 22%, ' + rgba(t.accent2, 0.18) + ', transparent 72%)',
    'radial-gradient(42% 38% at 55% 96%, ' + rgba(t.accent, 0.14) + ', transparent 70%)',
    'linear-gradient(160deg, ' + t.bg1 + ', ' + t.bg0 + ')',
  ].join(',')
  const useImg = !!img && t.wallMode !== 'none'
  const bgImage = useImg ? 'url("' + img.replace(/"/g, '\\"') + '")' : grad
  const size = useImg ? (t.wallTile ? 'auto' : t.wallFit) : 'cover'
  const repeat = useImg && t.wallTile ? 'repeat' : 'no-repeat'
  const filter = 'blur(' + t.wallBlur + 'px) saturate(' + t.wallSat + ') brightness(' + t.wallBright + ') contrast(' + t.wallContrast + ')'
  return [
    // The still layer stays mounted in video mode: it is the poster and the
    // fallback. A paused or not-yet-decoded <video> paints nothing, and hiding
    // this layer in that state left the whole viewport on the body colour.
    '#cc-wall {',
    '  position: fixed; inset: -4%; z-index: -3; pointer-events: none;',
    '  display: ' + (t.wallMode === 'none' ? 'none' : 'block') + ';',
    '  background-image: ' + bgImage + ';',
    '  background-size: ' + size + ';',
    '  background-position: ' + t.wallPos + ';',
    '  background-repeat: ' + repeat + ';',
    '  filter: ' + filter + ';',
    '  opacity: ' + t.wallOpacity + ';',
    '  transform: translate3d(0, 0, 0);',
    '  will-change: transform;',
    '}',
    // A live wallpaper is a real <video>: CSS backgrounds cannot decode video.
    // Same box, same filter, same z-index as the still layer so every theme
    // control (brightness, blur, vignette, parallax) keeps working unchanged.
    // Later in the DOM at the same z-index, so it paints over the poster.
    '#cc-wall-video {',
    '  position: fixed; inset: -4%; z-index: -3; pointer-events: none;',
    '  display: ' + (isVideo ? 'block' : 'none') + ';',
    '  width: 108%; height: 108%;',
    '  object-fit: ' + (t.wallFit === 'contain' ? 'contain' : t.wallFit === 'fill' ? 'fill' : 'cover') + ';',
    '  object-position: ' + t.wallPos + ';',
    '  filter: ' + filter + ';',
    '  opacity: ' + t.wallOpacity + ';',
    '  transform: translate3d(0, 0, 0);',
    '  will-change: transform;',
    '}',
    '#cc-wall-tint {',
    '  position: fixed; inset: 0; z-index: -2; pointer-events: none;',
    '  display: ' + (t.wallMode === 'none' ? 'none' : 'block') + ';',
    '  background:',
    '    radial-gradient(circle at 50% 40%, transparent 30%, ' + rgba(t.bg0, t.wallVignette) + ' 100%),',
    '    ' + rgba(t.bg0, t.wallDim) + ';',
    '}',
    'html.cc-reduce #cc-wall, html.cc-reduce #cc-wall-video { transform: none !important; }',
  ].join('\n')
}

/* ---------------------------------------------------------------- inject */

const STRUCT_CSS = [
  '/* ---- cakecode ui ---- */',
  '.cc-dock { position: fixed; z-index: 100020; display: flex; gap: 8px; align-items: center; }',
  '.cc-dock.cc-br { right: 14px; bottom: 14px; }',
  '.cc-dock.cc-bl { left: 14px; bottom: 14px; }',
  '.cc-dock.cc-tr { right: 14px; top: 14px; }',
  '.cc-dock.cc-tl { left: 14px; top: 14px; }',
  '.cc-btn {',
  '  width: 34px; height: 34px; border-radius: 50%;',
  '  border: 1px solid rgba(255,255,255,0.16);',
  '  background: rgba(14,9,20,0.82); color: var(--cc-accent);',
  '  font-size: 15px; line-height: 1; cursor: pointer;',
  '  backdrop-filter: blur(12px); display: grid; place-items: center;',
  '  transition: transform .15s, background .15s, color .15s;',
  '}',
  '.cc-btn:hover { background: var(--cc-accent); color: #140b1c; transform: translateY(-1px); }',
  '.cc-btn.active { background: var(--cc-accent); color: #140b1c; }',
  '.cc-hud-mark { font-size: 13px; line-height: 1; }',
  '/* ---- "Thinking..." indicator (reasoning is batched upstream, so show progress) ---- */',
  '#cc-thinking {',
  '  position: fixed; z-index: 100019; left: 50%; bottom: 84px;',
  '  transform: translateX(-50%) translateY(6px);',
  '  display: flex; align-items: center; gap: 9px;',
  '  padding: 8px 15px 8px 13px; border-radius: 999px;',
  '  border: 1px solid rgba(255,255,255,0.14);',
  '  background: rgba(14,9,20,0.86); color: var(--cc-accent, #ff6f9f);',
  '  font-family: var(--v2-font-family-sans, system-ui); font-size: 13px; font-weight: 500;',
  '  letter-spacing: .01em; backdrop-filter: blur(14px);',
  '  box-shadow: 0 6px 24px rgba(0,0,0,.35);',
  '  opacity: 0; pointer-events: none;',
  '  transition: opacity .28s ease, transform .28s ease;',
  '}',
  '#cc-thinking.show { opacity: 1; transform: translateX(-50%) translateY(0); }',
  '#cc-thinking .cc-think-dot {',
  '  width: 7px; height: 7px; border-radius: 50%; background: var(--cc-accent, #ff6f9f);',
  '  box-shadow: 0 0 0 0 var(--cc-accent, #ff6f9f);',
  '  animation: cc-think-pulse 1.1s ease-out infinite;',
  '}',
  '@keyframes cc-think-pulse {',
  '  0% { box-shadow: 0 0 0 0 rgba(255,111,159,.55); }',
  '  70% { box-shadow: 0 0 0 8px rgba(255,111,159,0); }',
  '  100% { box-shadow: 0 0 0 0 rgba(255,111,159,0); }',
  '}',
  '#cc-thinking .cc-think-label { color: var(--v2-text-text-base, #e8e8ef); }',
  '.cc-drawer {',
  '  position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 92vw;',
  '  z-index: 100050; display: flex; flex-direction: column;',
  '  background: linear-gradient(160deg, rgba(24,14,34,.985), rgba(10,6,15,.99));',
  '  border-left: 1px solid rgba(255,255,255,.12);',
  '  box-shadow: -30px 0 80px rgba(0,0,0,.6);',
  '  transform: translateX(102%); transition: transform .22s cubic-bezier(.2,.7,.2,1);',
  '  font-family: var(--v2-font-family-sans, system-ui); color: #f6e6f0;',
  '}',
  '.cc-drawer.open { transform: translateX(0); }',
  '.cc-dhead { display: flex; align-items: center; gap: 10px; padding: 12px 14px;',
  '  border-bottom: 1px solid rgba(255,255,255,.1); }',
  '.cc-dtitle { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--cc-accent); }',
  '.cc-close { margin-left: auto; background: none; border: 0; color: #c9a9bd; font-size: 18px;',
  '  cursor: pointer; line-height: 1; padding: 2px 6px; }',
  '.cc-close:hover { color: #fff; }',
  '.cc-tabs { display: flex; gap: 4px; padding: 8px 10px; flex-wrap: wrap;',
  '  border-bottom: 1px solid rgba(255,255,255,.08); }',
  '.cc-tab { padding: 5px 10px; border-radius: 8px; font-size: 11px; cursor: pointer;',
  '  color: #c2a3b6; border: 1px solid transparent; background: rgba(255,255,255,.03); }',
  '.cc-tab.on { color: #160b1e; background: var(--cc-accent); font-weight: 600; }',
  '.cc-body { flex: 1; overflow-y: auto; padding: 12px 14px 40px; }',
  '.cc-sec { display: none; }',
  '.cc-sec.on { display: block; }',
  '.cc-field { margin-bottom: 13px; }',
  '.cc-field > label { display: flex; justify-content: space-between; align-items: center;',
  '  font-size: 11px; color: #cbb0c0; margin-bottom: 5px; letter-spacing: .03em; }',
  '.cc-field .cc-val { font-family: var(--v2-font-family-code, monospace); font-size: 10px; color: var(--cc-accent); }',
  '.cc-field input[type=text], .cc-field input[type=number], .cc-field select, .cc-field textarea {',
  '  width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px;',
  '  border: 1px solid rgba(255,255,255,.14); background: rgba(8,5,12,.85);',
  '  color: #f2e4ec; font-size: 12px; outline: none;',
  '  font-family: var(--v2-font-family-code, monospace);',
  '}',
  '.cc-field input:focus, .cc-field select:focus, .cc-field textarea:focus {',
  '  border-color: var(--cc-accent); box-shadow: 0 0 0 3px rgba(255,111,159,.14); }',
  '.cc-field textarea { min-height: 88px; resize: vertical; line-height: 1.45; }',
  '.cc-field input[type=color] { width: 100%; height: 30px; padding: 0; border: 1px solid rgba(255,255,255,.14);',
  '  border-radius: 8px; background: none; cursor: pointer; }',
  '.cc-field input[type=range] { width: 100%; accent-color: var(--cc-accent); }',
  '.cc-row { display: flex; gap: 8px; }',
  '.cc-row > * { flex: 1; }',
  '.cc-mini { padding: 6px 9px; font-size: 11px; border-radius: 8px; cursor: pointer;',
  '  border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.04); color: #e8d3e0; }',
  '.cc-mini:hover { border-color: var(--cc-accent); color: #fff; }',
  '.cc-mini.danger:hover { border-color: #ff5d5d; color: #ffd3d3; }',
  '.cc-sw { display: flex; justify-content: space-between; align-items: center; gap: 10px;',
  '  font-size: 12px; padding: 7px 0; border-bottom: 1px dashed rgba(255,255,255,.07); }',
  '.cc-sw input { width: 16px; height: 16px; accent-color: var(--cc-accent); }',
  '.cc-walls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }',
  '.cc-wallpick { aspect-ratio: 16/10; border-radius: 8px; border: 1px solid rgba(255,255,255,.16);',
  '  background-size: cover; background-position: center; cursor: pointer; position: relative; overflow: hidden; }',
  '.cc-wallpick span { position: absolute; inset: auto 0 0 0; font-size: 8px; padding: 2px 4px;',
  '  background: rgba(0,0,0,.6); color: #dfc8d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.cc-wallpick:hover { border-color: var(--cc-accent); }',
  '.cc-toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 8px);',
  '  z-index: 100060; padding: 8px 14px; border-radius: 10px; font-size: 11px;',
  '  border: 1px solid rgba(255,255,255,.18); background: rgba(16,9,22,.95); color: #ffdfed;',
  '  font-family: var(--v2-font-family-code, monospace); opacity: 0; pointer-events: none;',
  '  transition: opacity .18s, transform .18s; }',
  '.cc-toast.show { opacity: 1; transform: translate(-50%, 0); }',
  '#cc-petals { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none;',
  '  z-index: 99990; transition: opacity .3s; }',
  '.cc-backdrop { position: fixed; inset: 0; z-index: 100045; display: flex; align-items: flex-start;',
  '  justify-content: center; padding-top: 13vh; background: rgba(5,3,8,.72); backdrop-filter: blur(8px); }',
  '.cc-backdrop.hidden { display: none; }',
  '.cc-modal { width: min(560px, 92vw); border-radius: 16px; overflow: hidden;',
  '  border: 1px solid rgba(255,255,255,.16);',
  '  background: linear-gradient(160deg, rgba(30,17,42,.98), rgba(13,8,20,.985));',
  '  box-shadow: 0 30px 90px rgba(0,0,0,.7); color: #f6e6f0;',
  '  font-family: var(--v2-font-family-sans, system-ui); }',
  '.cc-mhead { display: flex; align-items: center; gap: 9px; padding: 12px 14px;',
  '  border-bottom: 1px solid rgba(255,255,255,.1); }',
  '.cc-mhead input { flex: 1; padding: 8px 11px; border-radius: 8px; font-size: 13px;',
  '  border: 1px solid rgba(255,255,255,.16); background: rgba(8,5,12,.85); color: #f2e4ec; outline: none; }',
  '.cc-list { max-height: 46vh; overflow-y: auto; padding: 6px; }',
  '.cc-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;',
  '  cursor: pointer; font-size: 13px; }',
  '.cc-item:hover, .cc-item.active { background: rgba(255,111,159,.15); color: #ffd6e7; }',
  '.cc-item.active { box-shadow: inset 2px 0 0 var(--cc-accent); }',
  '.cc-item-key { margin-left: auto; font-family: var(--v2-font-family-code, monospace);',
  '  font-size: 9px; color: #b98aa7; }',
  '.cc-mfoot { padding: 8px 14px; border-top: 1px solid rgba(255,255,255,.08);',
  '  font-family: var(--v2-font-family-code, monospace); font-size: 10px; color: #a7859a; }',
  '/* ---- console ---- */',
  '.cc-console { position: fixed; top: 0; right: 0; bottom: 0; width: 430px; max-width: 96vw;',
  '  z-index: 100048; display: flex; flex-direction: column; gap: 0;',
  '  background: linear-gradient(165deg, rgba(18,11,26,.985), rgba(8,5,12,.99));',
  '  border-left: 1px solid rgba(255,255,255,.14);',
  '  box-shadow: -30px 0 80px rgba(0,0,0,.65);',
  '  transform: translateX(102%); transition: transform .22s cubic-bezier(.2,.7,.2,1);',
  '  font-family: var(--v2-font-family-sans, system-ui); color: #f4e6ef; }',
  '.cc-console.open { transform: translateX(0); }',
  '.cc-chead { display: flex; align-items: center; gap: 9px; padding: 11px 13px;',
  '  border-bottom: 1px solid rgba(255,255,255,.1); }',
  '.cc-ctitle { font-size: 11px; letter-spacing: 2px; text-transform: uppercase;',
  '  color: var(--cc-accent); }',
  '.cc-cpill { font-family: var(--v2-font-family-code, monospace); font-size: 9px;',
  '  padding: 2px 7px; border-radius: 20px; border: 1px solid rgba(255,255,255,.16); color: #c9a9bd; }',
  '.cc-cpill.on { color: #120a18; background: var(--cc-accent); border-color: transparent; font-weight: 700; }',
  '.cc-cstats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 10px 12px;',
  '  border-bottom: 1px solid rgba(255,255,255,.08); }',
  '.cc-cstat { text-align: center; padding: 6px 2px; border-radius: 9px;',
  '  background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); }',
  '.cc-cstat b { display: block; font-family: var(--v2-font-family-code, monospace);',
  '  font-size: 14px; color: var(--cc-accent); line-height: 1.25; }',
  '.cc-cstat span { font-size: 8px; letter-spacing: .08em; text-transform: uppercase; color: #a7859a; }',
  '.cc-cquota { margin: 10px 12px 0; padding: 10px 11px; border-radius: 11px;',
  '  border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.035); }',
  '.cc-cq-top { display: flex; align-items: center; gap: 8px; font-size: 11px; }',
  '.cc-cq-dot { width: 8px; height: 8px; border-radius: 50%; background: #5eb37e; }',
  '.cc-cq-dot.warn { background: #ffcf6b; }',
  '.cc-cq-dot.bad { background: #ff5d5d; box-shadow: 0 0 10px #ff5d5d; }',
  '.cc-cq-meta { margin-top: 5px; font-family: var(--v2-font-family-code, monospace);',
  '  font-size: 9.5px; color: #a7859a; line-height: 1.5; word-break: break-word; }',
  '.cc-cq-actions { display: flex; gap: 6px; margin-top: 8px; }',
  '.cc-cfilters { display: flex; gap: 4px; padding: 9px 12px; flex-wrap: wrap;',
  '  border-bottom: 1px solid rgba(255,255,255,.08); align-items: center; }',
  '.cc-cfilters .cc-mini { padding: 3px 7px; font-size: 9.5px; }',
  '.cc-cspacer { margin-left: auto; display: flex; gap: 4px; }',
  '.cc-chip { font-size: 10px; padding: 3px 8px; border-radius: 20px; cursor: pointer;',
  '  border: 1px solid rgba(255,255,255,.14); color: #b99bab; background: transparent; }',
  '.cc-chip.on { color: #140b1c; background: var(--cc-accent); border-color: transparent; font-weight: 600; }',
  '.cc-clog { flex: 1; overflow-y: auto; padding: 6px 10px 24px;',
  '  font-family: var(--v2-font-family-code, monospace); font-size: 10.5px; line-height: 1.55; }',
  '.cc-ev { display: grid; grid-template-columns: 54px 58px 1fr; gap: 6px;',
  '  padding: 3px 4px; border-radius: 5px; align-items: baseline; }',
  '.cc-ev:hover { background: rgba(255,255,255,.04); }',
  '.cc-ev-t { color: #6f5a68; }',
  '.cc-ev-k { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }',
  '.cc-ev-k.request { color: #8ab4ff; }',
  '.cc-ev-k.ok { color: #5eb37e; }',
  '.cc-ev-k.fail { color: #ff6b6b; }',
  '.cc-ev-k.quota { color: #ffcf6b; }',
  '.cc-ev-k.retry { color: #c793ff; }',
  '.cc-ev-k.tool { color: #6fd8e0; }',
  '.cc-ev-k.info { color: #a7859a; }',
  '.cc-ev-m { color: #dcc8d6; word-break: break-word; }',
  '.cc-cempty { color: #806a79; padding: 16px 6px; text-align: center; font-size: 11px; }',
  '/* ---- theme cards ---- */',
  '.cc-themes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }',
  '.cc-tcard { border-radius: 11px; border: 1px solid rgba(255,255,255,.13); cursor: pointer;',
  '  overflow: hidden; transition: border-color .15s, transform .15s; }',
  '.cc-tcard:hover { border-color: var(--cc-accent); transform: translateY(-1px); }',
  '.cc-tcard.on { border-color: var(--cc-accent); box-shadow: 0 0 0 1px var(--cc-accent) inset; }',
  '.cc-tswatch { height: 44px; display: flex; }',
  '.cc-tswatch i { flex: 1; display: block; }',
  '.cc-tname { padding: 5px 8px; font-size: 10.5px; color: #d9c2d0;',
  '  display: flex; justify-content: space-between; gap: 6px; }',
  '.cc-tname em { font-style: normal; color: #8a7285; font-size: 9px; }',
].join('\n')

const UI_HTML = [
  '<div id="cc-wall"></div>',
  '<video id="cc-wall-video" muted loop playsinline preload="auto" data-cc-noswap></video>',
  '<div id="cc-wall-tint"></div>',
  '<canvas id="cc-petals"></canvas>',
  '<div id="cc-dock" class="cc-dock cc-br"></div>',
  '<div id="cc-toast" class="cc-toast"></div>',
  '<div id="cc-thinking"><span class="cc-think-dot"></span><span class="cc-think-label">Thinking\u2026</span></div>',
  '<div id="cc-console" class="cc-console">',
  '  <div class="cc-chead">',
  '    <span class="cc-hud-mark">\u25a4</span>',
  '    <span class="cc-ctitle">console</span>',
  '    <span class="cc-cpill" id="cc-c-live">live</span>',
  '    <button class="cc-close" id="cc-c-close" title="close">\u00d7</button>',
  '  </div>',
  '  <div class="cc-cstats" id="cc-c-stats"></div>',
  '  <div class="cc-cquota" id="cc-c-quota"></div>',
  '  <div class="cc-cfilters" id="cc-c-filters"></div>',
  '  <div class="cc-clog" id="cc-c-log"></div>',
  '</div>',
  '<div id="cc-drawer" class="cc-drawer">',
  '  <div class="cc-dhead">',
  '    <span class="cc-hud-mark" id="cc-dmark">\u221e</span>',
  '    <span class="cc-dtitle">cakecode // ui</span>',
  '    <button class="cc-close" id="cc-dclose" title="close">\u00d7</button>',
  '  </div>',
  '  <div class="cc-tabs" id="cc-tabs"></div>',
  '  <div class="cc-body" id="cc-body"></div>',
  '</div>',
  '<div id="cc-palette" class="cc-backdrop hidden">',
  '  <div class="cc-modal">',
  '    <div class="cc-mhead"><input id="cc-pal-input" placeholder="command..." autocomplete="off" spellcheck="false"></div>',
  '    <div id="cc-pal-list" class="cc-list"></div>',
  '    <div class="cc-mfoot">\u2191\u2193 move \u00b7 \u21b5 run \u00b7 esc close \u00b7 ctrl/cmd+k</div>',
  '  </div>',
  '</div>',
].join('')

const UI_JS = String.raw`
(function () {
  'use strict';
  var T = Object.assign({}, window.__CC_THEME__ || {});
  var D = window.__CC_DEFAULTS__ || {};
  var THEMES = window.__CC_THEMES__ || [];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var toastEl = $('#cc-toast');
  var drawer = $('#cc-drawer');
  var body = $('#cc-body');
  var dock = $('#cc-dock');
  var toastTimer = null;

  // surface uncaught errors to the selftest harness instead of dying silently
  window.addEventListener('error', function (e) {
    window.__ccErr = (e.message || 'error') + ' @' + (e.lineno || '?');
  });
  window.addEventListener('unhandledrejection', function (e) {
    window.__ccErr = 'promise: ' + ((e.reason && e.reason.message) || e.reason || 'unknown');
  });

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1900);
  }

  /* ---------- live css ---------- */

  function hexRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { var c = hexRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function varsCss(t) {
    var a = t.accent, a2 = t.accent2;
    var lines = [
      ':root{',
      '--v2-background-bg-deep:' + t.bg0 + '!important;',
      '--v2-background-bg-base:' + t.bg1 + '!important;',
      '--v2-background-bg-layer-01:' + t.bg2 + '!important;',
      '--v2-background-bg-layer-02:' + t.bg3 + '!important;',
      '--v2-background-bg-layer-03:' + t.bg3 + '!important;',
      '--v2-background-bg-layer-04:' + t.bg3 + '!important;',
      '--v2-background-bg-inverse:' + t.textBase + '!important;',
      '--v2-background-bg-contrast:' + a + '!important;',
      '--v2-background-bg-accent:' + a + '!important;',
      '--v2-background-bg-button-neutral:' + t.bg2 + '!important;',
      '--v2-background-bg-code-path:' + t.bg3 + '!important;',
      '--v2-text-text-base:' + t.textBase + '!important;',
      '--v2-text-text-muted:' + t.textMuted + '!important;',
      '--v2-text-text-faint:' + rgba(t.textMuted, .72) + '!important;',
      '--v2-text-text-inverse:' + t.bg0 + '!important;',
      '--v2-text-text-contrast:' + t.bg0 + '!important;',
      '--v2-text-text-accent:' + a + '!important;',
      '--v2-text-text-accent-hover:' + a2 + '!important;',
      '--v2-text-text-code-accent:' + a + '!important;',
      '--v2-text-text-code-path:' + a2 + '!important;',
      '--v2-icon-icon-base:' + rgba(t.textBase, .9) + '!important;',
      '--v2-icon-icon-muted:' + rgba(t.textMuted, .85) + '!important;',
      '--v2-icon-icon-faint:' + rgba(t.textMuted, .55) + '!important;',
      '--v2-icon-icon-accent:' + a + '!important;',
      '--v2-icon-icon-accent-hover:' + a2 + '!important;',
      '--v2-border-border-base:' + rgba(a, .24) + '!important;',
      '--v2-border-border-muted:' + rgba(a, .13) + '!important;',
      '--v2-border-border-strong:' + rgba(a, .42) + '!important;',
      '--v2-border-border-focus:' + a + '!important;',
      '--v2-overlay-simple-overlay-hover:' + rgba(a, .10) + '!important;',
      '--v2-overlay-simple-overlay-pressed:' + rgba(a, .20) + '!important;',
      '--v2-overlay-simple-overlay-scrim:' + rgba(t.bg0, .82) + '!important;',
      '--v2-overlay-simple-tab-scrim:' + rgba(a, .06) + '!important;',
      '--v2-overlay-simple-tab-hover-scrim:' + rgba(a, .12) + '!important;',
      '--v2-overlay-simple-tab-active-scrim:' + rgba(a, .18) + '!important;',
      '--v2-font-family-sans:"' + t.fontSans + '","Zen Kaku Gothic New",system-ui,sans-serif!important;',
      '--v2-font-family-code:"' + t.fontMono + '",ui-monospace,monospace!important;',
      '--cc-accent:' + a + ';--cc-accent2:' + a2 + ';--cc-radius:' + t.radius + 'px;',
      'color-scheme:dark!important;}',
      'html{font-size:' + (16 * t.uiScale).toFixed(2) + 'px;}',
      'html,body{background-color:transparent!important;}',
      'body{font-family:"' + t.fontSans + '","Zen Kaku Gothic New",system-ui,sans-serif!important;',
      'letter-spacing:' + t.letterSpacing + 'em;}',
      '#root{background:transparent!important;zoom:' + t.density + ';}',
      // Opaque app shell must be transparent so #cc-wall shows through.
      "[class*='bg-v2-background-bg-deep']{background-color:transparent!important;}",
      "[class*='bg-v2-background-bg-base'].sticky,[class*='bg-v2-background-bg-base'].absolute{",
      'background-color:' + rgba(t.bg0, .55) + '!important;',
      'backdrop-filter:blur(' + t.backdropBlur + 'px) saturate(130%);}',
      // Every shell view mounts a rounded 10px bg-base plate over the whole
      // viewport: home-panel, the new-session canvas, and session-chat-panel.
      // Only home-panel had a scrim rule, so the other two painted the wallpaper
      // out completely. Match the shared plate shape instead of a data-slot the
      // upstream templates don't provide on two of the three.
      // No backdrop blur: the plate covers the whole viewport, so blurring behind
      // it only smears the wallpaper into mush. Let the image stay sharp.
      "[class*='bg-v2-background-bg-base'][class*='rounded-[10px]']{",
      'background-color:' + rgba(t.bg1, t.panelScrim) + '!important;',
      'backdrop-filter:none!important;}',
      'pre,code,kbd{font-family:"' + t.fontMono + '",ui-monospace,monospace!important;}',
      'pre{font-size:' + t.codeSize + 'px!important;}',
      'pre,[data-slot="home-panel"]{border-radius:var(--cc-radius)!important;}',
      '[data-slot="vertical-tabs-sidebar"],[data-slot="sidebar-inbox"],',
      '[data-slot="sidebar-header"],[data-slot="home-panel"]{',
      'background:' + rgba(t.bg1, t.panelScrim) + '!important;',
      'backdrop-filter:none!important;}',
      '[data-slot="tabs-trigger-wrapper"],[data-slot="titlebar-v2"]{',
      'background:' + rgba(t.bg0, .5) + '!important;',
      'backdrop-filter:blur(' + Math.round(t.backdropBlur * .45) + 'px);}',
      '.bg-gradient-to-t.from-v2-background-bg-base{--tw-gradient-from:transparent!important;background-image:none!important;}',
      '[data-slot="tabs-trigger"][aria-selected="true"]{',
      'box-shadow:inset 0 -2px 0 ' + a + ',0 0 22px ' + rgba(a, .16) + ';}',
      '::selection{background:' + rgba(a, .35) + '!important;color:#fff!important;}',
      ':focus-visible{outline-color:' + a + '!important;}',
      '::-webkit-scrollbar{width:8px;height:8px;}',
      '::-webkit-scrollbar-track{background:' + rgba(t.bg0, .7) + ';}',
      '::-webkit-scrollbar-thumb{background:linear-gradient(180deg,' + rgba(a, .55) + ',' + rgba(a2, .45) + ');',
      'border-radius:8px;border:2px solid transparent;background-clip:padding-box;}',
      'html.cc-compact [data-slot="vertical-tabs-sidebar"]{max-width:208px!important;}',
      'html.cc-focus [data-slot="vertical-tabs-sidebar"],',
      'html.cc-focus [data-slot="sidebar-inbox"],',
      'html.cc-focus [data-slot="sidebar-header"],',
      'html.cc-focus [data-slot="vertical-tabs-panel"]{display:none!important;}',
      'html.cc-focus #root{padding-left:4vw!important;padding-right:4vw!important;}',
      // Focus mode dims the backdrop. This lived only in the server sheet, which
      // the client replaces on boot, so the rule silently stopped applying the
      // moment the drawer rebuilt anything.
      'html.cc-focus #cc-wall,html.cc-focus #cc-wall-video{opacity:.25!important;}',
      'html.cc-reduce *{animation-duration:.001ms!important;transition-duration:.001ms!important;}',
    ];
    return lines.join('') + '\n' + (t.customCss || '');
  }

  function wallCss(t) {
    var isVideo = t.wallMode === 'video';
    var img = isVideo ? '' : (t.wallUrl || '');
    var useImg = !!img && t.wallMode !== 'none' && t.wallMode !== 'gradient';
    var grad = 'radial-gradient(38% 32% at 18% 12%,' + rgba(t.accent, .20) + ',transparent 70%),' +
      'radial-gradient(34% 30% at 84% 22%,' + rgba(t.accent2, .18) + ',transparent 72%),' +
      'radial-gradient(42% 38% at 55% 96%,' + rgba(t.accent, .14) + ',transparent 70%),' +
      'linear-gradient(160deg,' + t.bg1 + ',' + t.bg0 + ')';
    var size = useImg ? (t.wallTile ? 'auto' : t.wallFit) : 'cover';
    var filter = 'blur(' + t.wallBlur + 'px) saturate(' + t.wallSat + ') brightness(' + t.wallBright + ') contrast(' + t.wallContrast + ')';
    return [
      '#cc-wall{position:fixed;inset:-4%;z-index:-3;pointer-events:none;',
      'display:' + (t.wallMode === 'none' ? 'none' : 'block') + ';',
      'background-image:' + (useImg ? 'url("' + img.replace(/"/g, '\\"') + '")' : grad) + ';',
      'background-size:' + size + ';background-position:' + t.wallPos + ';',
      'background-repeat:' + (useImg && t.wallTile ? 'repeat' : 'no-repeat') + ';',
      'filter:' + filter + ';',
      'opacity:' + t.wallOpacity + ';}',
      '#cc-wall-video{position:fixed;inset:-4%;z-index:-3;pointer-events:none;',
      'display:' + (isVideo ? 'block' : 'none') + ';',
      'width:108%;height:108%;',
      'object-fit:' + (t.wallFit === 'contain' ? 'contain' : t.wallFit === 'fill' ? 'fill' : 'cover') + ';',
      'object-position:' + t.wallPos + ';',
      'filter:' + filter + ';',
      'opacity:' + t.wallOpacity + ';}',
      '#cc-wall-tint{position:fixed;inset:0;z-index:-2;pointer-events:none;',
      'display:' + (t.wallMode === 'none' ? 'none' : 'block') + ';',
      'background:radial-gradient(circle at 50% 40%,transparent 30%,' + rgba(t.bg0, t.wallVignette) + ' 100%),' +
        rgba(t.bg0, t.wallDim) + ';}',
    ].join('');
  }

  function styleEl(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    return el;
  }

  // A paused <video> still paints its current frame, so the last decoded frame
  // is a real, correctly graded still of the wallpaper. Capturing it lets the
  // still layer carry the image whenever we are not playing, instead of falling
  // back to a bare gradient. Same-origin, so the canvas is not tainted.
  var posterCache = {};

  function capturePoster(v) {
    try {
      // currentSrc is resolved to an absolute URL while T.wallUrl stays
      // relative, so keying the cache off currentSrc made every lookup miss.
      // ptr is the stable key the rest of the code uses.
      var ptr = (T.wallMode === 'video' && T.wallUrl) ? T.wallUrl : '';
      if (!ptr || posterCache[ptr] || !v.videoWidth) return;
      var scale = Math.min(1, 1920 / v.videoWidth);
      var c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/jpeg', 0.82);
      posterCache[ptr] = url;
      syncPoster();
    } catch (e) {}
  }

  // The poster is applied as an inline background-image, which outranks the
  // stylesheet. It must be cleared the moment we leave video mode or the still
  // layer would keep a stale frame from a previous wallpaper.
  function syncPoster() {
    var w = $('#cc-wall');
    if (!w) return;
    var src = (T.wallMode === 'video' && T.wallUrl) ? T.wallUrl : '';
    var poster = src && posterCache[src];
    if (!poster) { w.style.backgroundImage = ''; return; }
    w.style.backgroundImage = 'url("' + poster + '")';
    // Match the video's framing so the poster is not stretched differently.
    w.style.backgroundSize = (T.wallFit === 'contain' ? 'contain' : T.wallFit === 'fill' ? '100% 100%' : 'cover');
    w.style.backgroundPosition = T.wallPos;
  }

  // The <video> layer is not CSS: it needs a src, a decode, and a play call.
  // Called from applyTheme so switching modes or picking a file just works.
  function applyWallVideo() {
    var v = $('#cc-wall-video');
    if (!v) return;
    var src = (T.wallMode === 'video' && T.wallUrl) ? T.wallUrl : '';
    if (!src) {
      if (!v.paused) v.pause();
      if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
      syncPoster();
      return;
    }
    // Always load the source, even when we will not play it. Setting src only
    // inside the "should play" branch is what left a reduce-motion boot with no
    // frame at all: the element stayed empty over a hidden still layer, so the
    // whole viewport fell back to the body colour.
    if (v.getAttribute('src') !== src) {
      v.setAttribute('src', src);
      v.load();
    }
    syncPoster();
    var shouldPlay = !T.reduceMotion && !document.hidden;
    if (!shouldPlay) {
      if (!v.paused) v.pause();
      return;
    }
    // Muted autoplay is allowed without a gesture, but a rejected promise is
    // still possible (low power mode, energy saver); swallow it so the still
    // layer underneath stays the visible fallback.
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  var wallVideoEl = $('#cc-wall-video');
  if (wallVideoEl) {
    wallVideoEl.addEventListener('loadeddata', function () {
      capturePoster(wallVideoEl);
      syncPoster();
    });
    // A codec the browser cannot decode should degrade to the still layer, not
    // to an empty rectangle.
    wallVideoEl.addEventListener('error', function () {
      posterCache[T.wallUrl] = null;
      syncPoster();
    });
  }

  document.addEventListener('visibilitychange', function () { applyWallVideo(); });

  function applyTheme() {
    styleEl('cc-vars').textContent = varsCss(T);
    styleEl('cc-wall-css').textContent = wallCss(T);
    var root = document.documentElement;
    root.classList.toggle('cc-focus', !!T.focus);
    root.classList.toggle('cc-compact', !!T.compactSidebar);
    root.classList.toggle('cc-reduce', !!T.reduceMotion);
    var dockEl = $('#cc-dock');
    if (dockEl) dockEl.className = 'cc-dock cc-' + T.hudPos;
    // The tab title is owned by stripTitleBrand; writing it here as well made
    // every theme apply repaint the tab.
    renderWallpapers();
    applyWallVideo();
    applyPetals();
  }

  function persist() {
    try { localStorage.setItem('cc.theme', JSON.stringify(T)); } catch (e) {}
    clearTimeout(persist._t);
    persist._t = setTimeout(function () {
      fetch('/__cc/theme', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(T)
      }).catch(function () {});
    }, 350);
  }

  function set(key, val) {
    T[key] = val;
    applyTheme();
    persist();
    syncFields();
  }

  // When the theme is hand-edited, the preset no longer owns the palette.
  // Track that honestly instead of leaving a preset card falsely highlighted.
  function setAndDetach(key, val) {
    if (THEMES.some(function (th) { return th.theme[key] !== undefined; })) T.themeId = 'custom';
    set(key, val);
  }

  /* ---------- branding swap ---------- */

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description'];

  function swapString(v, from, to) {
    return v.indexOf(from) >= 0 ? v.split(from).join(to) : v;
  }

  // Text nodes plus the attributes screen readers and tooltips read from.
  function brandSwap(node) {
    var from = T.brandFrom, to = T.brandTo;
    if (!from || !to || from === to) return;
    if (!node || node.nodeType !== 1) return;

    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var n;
    var out = [];
    while ((n = walker.nextNode())) {
      var p = n.parentElement;
      if (!p || SKIP[p.tagName] || p.closest('[data-cc-noswap]')) continue;
      if (n.nodeValue && n.nodeValue.indexOf(from) >= 0) out.push(n);
    }
    for (var i = 0; i < out.length; i++) {
      out[i].nodeValue = out[i].nodeValue.split(from).join(to);
    }

    var els = node.querySelectorAll('[aria-label], [title], [placeholder], [alt]');
    for (var j = 0; j < els.length; j++) {
      for (var k = 0; k < ATTRS.length; k++) {
        var v = els[j].getAttribute(ATTRS[k]);
        if (v && v.indexOf(from) >= 0) els[j].setAttribute(ATTRS[k], swapString(v, from, to));
      }
    }

    swapWordmarks(node);
    hideWordmarkHost(node);
  }

  // Same rewrite, scoped to the nodes a mutation actually touched. The SPA
  // re-renders small chips (the composer provider label) on every route change,
  // and a debounced full-document pass left the raw name on screen for a frame
  // or two — that gap is the blink. Observer callbacks run before paint, so
  // rewriting here lands in the same frame the app painted.
  function swapTouched(records) {
    var from = T.brandFrom, to = T.brandTo;
    if (!from || !to || from === to) return;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.type === 'characterData') {
        var t = rec.target;
        if (t.nodeValue && t.nodeValue.indexOf(from) >= 0) {
          var pe = t.parentElement;
          if (pe && !SKIP[pe.tagName] && !pe.closest('[data-cc-noswap]')) {
            t.nodeValue = t.nodeValue.split(from).join(to);
          }
        }
        continue;
      }
      for (var j = 0; j < rec.addedNodes.length; j++) {
        var node = rec.addedNodes[j];
        if (node.nodeType === 3) {
          if (node.nodeValue && node.nodeValue.indexOf(from) >= 0) {
            var p2 = node.parentElement;
            if (p2 && !SKIP[p2.tagName] && !p2.closest('[data-cc-noswap]')) {
              node.nodeValue = node.nodeValue.split(from).join(to);
            }
          }
        } else if (node.nodeType === 1) {
          if (node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE') brandSwap(node);
        }
      }
    }
  }

  // The product name is drawn as a block-font SVG, which string replacement
  // can never reach. Rather than draw a replacement word, clear the plate so
  // the space stays but reads empty, keeping the wallpaper front and center.
  //
  // The new-session hero is not one plate: wordmark-box stacks a flat layer, a
  // .wordmark-shimmer layer running a mask-position keyframe, and a
  // wordmark-lodger. Emptying each <svg> left the container and the shimmer
  // animation alive, and the SPA rebuilds the whole tree on every navigation
  // — that was the blink. Hide the component itself.
  var WORDMARK_HOST = '[data-slot="wordmark-box"], [data-component="new-session-wordmark"]';
  function hideWordmarkHost(root) {
    if (!root || !root.querySelectorAll) return;
    var hosts = root.querySelectorAll(WORDMARK_HOST);
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].getAttribute('data-cc-hidden') === '1') continue;
      hosts[i].setAttribute('data-cc-hidden', '1');
      hosts[i].style.setProperty('visibility', 'hidden', 'important');
      hosts[i].style.setProperty('animation', 'none', 'important');
    }
  }

  function isWordmarkSvg(svg) {
    var vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    if (vb.length !== 4) return false;
    var w = vb[2];
    var h = vb[3];
    // The name plate is wide and short (234x42). The square logo mark is
    // 16x20 and must be kept, so match the plate by its aspect, not by the
    // data-slot children (both icons and the plate carry logo-* slots).
    return w >= 140 && h <= 64;
  }

  function blankWordmark(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('data-cc-blank', '1');
  }

  function swapWordmarks(root) {
    var scope = root.querySelectorAll
      ? root.querySelectorAll('svg[viewBox], [role="img"]')
      : [];
    for (var i = 0; i < scope.length; i++) {
      var el = scope[i];
      var svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
      if (!svg || !isWordmarkSvg(svg)) continue;
      if (svg.hasAttribute('data-cc-blank')) continue;
      blankWordmark(svg);
    }
  }
  var swapTimer = null;
  function scheduleSwap() {
    if (swapTimer) return;
    swapTimer = setTimeout(function () {
      swapTimer = null;
      brandSwap(document.body);
      hideWordmarkHost(document.body);
    }, 250);
  }
  // Synchronous pass on the nodes the app just painted, then a slow sweep as a
  // safety net for anything the scoped pass cannot see (attributes, svg plates).
  try {
    new MutationObserver(function (records) {
      swapTouched(records);
      scheduleSwap();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (e) {}

  /* ---------- tab title ---------- */

  // The SPA's MetaProvider replaces the <title> element outright on every route
  // change ("Greeting · OpenCode"), so a one-shot rewrite loses the race and the
  // tab flickers the old name on each navigation. Own the title instead: strip
  // the brand as the app writes it and never write the brand back.
  //
  // Only the separators the app actually uses are treated as segment breaks.
  // Splitting on "-" would mangle session titles like "cbae's 0-0 system prompt".
  var TITLE_SEP = /\s*[·|\u2013\u2014]\s*/;
  function stripTitleBrand(text) {
    var from = T.brandFrom, to = T.brandTo;
    if (!text) return text;
    var parts = String(text).split(TITLE_SEP);
    var keep = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      // Drop any segment that is only the brand, in either spelling, so the tab
      // reads "Greeting" rather than "Greeting · cakecode".
      var bare = p.trim().toLowerCase();
      if (!bare) continue;
      if (from && bare === String(from).toLowerCase()) continue;
      if (to && bare === String(to).toLowerCase()) continue;
      keep.push(p.trim());
    }
    return keep.join(' · ');
  }

  function applyTitle() {
    var t = stripTitleBrand(document.title);
    // An empty result means the title was only the brand. Write it anyway:
    // leaving it alone is what let "OpenCode" sit in the tab.
    if (t !== document.title) document.title = t;
  }

  function watchTitle() {
    var titleEl = document.querySelector('title');
    if (!titleEl) return;
    new MutationObserver(applyTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  try {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeName === 'TITLE') watchTitle();
          else if (added[j].nodeType === 1) hideWordmarkHost(added[j]);
        }
      }
      applyTitle();
    }).observe(document.head, { childList: true, subtree: true });
  } catch (e) {}
  applyTitle();

  /* ---------- petals ---------- */

  var canvas = $('#cc-petals');
  var ctx = canvas ? canvas.getContext('2d') : null;
  var W = 0, H = 0, petals = [], ang = 0, petalTimer = null;
  function resize() {
    if (!canvas) return;
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  function applyPetals() {
    var lvl = Math.round(T.petals);
    var max = [0, 22, 42, 70][lvl] || 0;
    if (canvas) canvas.style.display = max ? '' : 'none';
    if (petalTimer) { clearInterval(petalTimer); petalTimer = null; }
    if (!max || !ctx) return;
    resize();
    petals = [];
    for (var i = 0; i < max; i++) {
      petals.push({
        x: Math.random() * W, y: Math.random() * H - H,
        r: Math.random() * 6 + 4, d: Math.random() * max,
        c: Math.random() > 0.3 ? rgba(T.accent, .72) : rgba(T.textBase, .8),
        tilt: Math.random() * 10 - 10, ta: 0, spin: Math.random() * .07 + .05
      });
    }
    petalTimer = setInterval(function () {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ang += 0.01;
      for (var i = 0; i < petals.length; i++) {
        var p = petals[i];
        p.ta += p.spin;
        p.y += (Math.cos(ang + p.d) + 1 + p.r / 2) / 2;
        p.x += Math.sin(ang) * 1.5;
        p.tilt = Math.sin(p.ta) * 0.5;
        if (p.y > H + 20 || p.x > W + 20 || p.x < -20) {
          p.x = Math.random() * W; p.y = -20; p.r = Math.random() * 6 + 4;
        }
        ctx.save();
        ctx.translate(p.x + p.r, p.y);
        ctx.rotate(p.tilt);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.2);
        ctx.restore();
      }
    }, 28);
  }
  window.addEventListener('resize', function () { resize(); });

  function renderThemes() {
    var host = $('#cc-themes');
    if (!host) return;
    host.innerHTML = '';
    THEMES.forEach(function (th) {
      var card = document.createElement('div');
      card.className = 'cc-tcard' + (T.themeId === th.id ? ' on' : '');
      var sw = document.createElement('div');
      sw.className = 'cc-tswatch';
      th.swatch.forEach(function (c) {
        var i = document.createElement('i');
        i.style.background = c;
        sw.appendChild(i);
      });
      var nm = document.createElement('div');
      nm.className = 'cc-tname';
      var a = document.createElement('span');
      a.textContent = th.name;
      var b = document.createElement('em');
      b.textContent = th.note;
      nm.appendChild(a); nm.appendChild(b);
      card.appendChild(sw); card.appendChild(nm);
      card.title = 'apply ' + th.name;
      card.addEventListener('click', function () { applyPreset(th); });
      host.appendChild(card);
    });
  }

  function applyPreset(th) {
    Object.keys(th.theme).forEach(function (k) { T[k] = th.theme[k]; });
    T.themeId = th.id;
    applyTheme();
    persist();
    syncFields();
    renderThemes();
    toast('theme: ' + th.name);
  }

  /* ---------- console ---------- */

  var consoleEl = $('#cc-console');
  var cLog = $('#cc-c-log');
  var cStats = $('#cc-c-stats');
  var cQuota = $('#cc-c-quota');
  var cFilters = $('#cc-c-filters');
  var cLive = $('#cc-c-live');
  var events = [];
  var evFilter = 'all';
  var evKinds = ['all', 'request', 'ok', 'retry', 'quota', 'fail', 'tool', 'info'];
  var warmed = false;
  var es = null;

  function fmtTime(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  function renderStats(stats) {
    if (!cStats) return;
    if (!stats) { cStats.innerHTML = ''; return; }
    var cells = [
      ['req', stats.requests],
      ['ok', stats.ok],
      ['429', stats.quota429],
      ['fail', stats.failed],
    ];
    cStats.innerHTML = '';
    cells.forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'cc-cstat';
      var b = document.createElement('b');
      b.textContent = String(c[1]);
      var s = document.createElement('span');
      s.textContent = c[0];
      d.appendChild(b); d.appendChild(s);
      cStats.appendChild(d);
    });
  }

  function renderQuota(q) {
    if (!cQuota) return;
    q = q || {};
    var hosts = [cQuota, $('#cc-q-panel')].filter(Boolean);
    hosts.forEach(function (host) {
      host.innerHTML = '';
      var active = !!q.active;
      var dot = active ? 'bad' : (q.hits ? 'warn' : '');
      var top = document.createElement('div');
      top.className = 'cc-cq-top';
      var dotEl = document.createElement('span');
      dotEl.className = 'cc-cq-dot ' + dot;
      var label = document.createElement('span');
      label.textContent = active ? 'quota latched' : (q.hits ? 'quota seen (clear)' : 'quota clear');
      var rel = document.createElement('span');
      rel.className = 'cc-cpill' + (active ? '' : ' on');
      rel.style.marginLeft = 'auto';
      rel.textContent = active ? fmtDur(q.remainingSeconds || 0) : 'go';
      top.appendChild(dotEl); top.appendChild(label); top.appendChild(rel);
      host.appendChild(top);

      var meta = document.createElement('div');
      meta.className = 'cc-cq-meta';
      var lines = [];
      if (q.resetAt) lines.push('upstream reset: ' + new Date(q.resetAt).toLocaleString());
      if (q.upstreamType) lines.push('type: ' + q.upstreamType);
      lines.push('hits: ' + (q.hits || 0));
      meta.textContent = lines.join('\n');
      meta.style.whiteSpace = 'pre-line';
      host.appendChild(meta);

      var acts = document.createElement('div');
      acts.className = 'cc-cq-actions';
      acts.appendChild(button('clear latch', resetQuota));
      acts.appendChild(button('rotate warp', rotateWarpRemote));
      host.appendChild(acts);
    });
  }

  function resetQuota() {
    fetch('/__cc/quota/reset', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
      renderQuota(j.quota);
      pushEvent({ at: Date.now(), kind: 'info', message: 'quota latch cleared from console' });
      toast('quota latch cleared');
    }).catch(function () { toast('reset failed'); });
  }

  function rotateWarpRemote() {
    toast('rotating warp...');
    fetch('/__cc/quota/rotate', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
      renderQuota(j.quota);
      toast(j.ok ? 'warp rotated › ' + (j.egress || '?') : 'rotate failed');
    }).catch(function () { toast('rotate failed'); });
  }

  function probeHealth() {
    var host = $('#cc-health');
    if (host) host.innerHTML = '<div style="color:#ffcf6b">probing...</div>';
    toast('probing models...');
    fetch('/__cc/health', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!host) return;
      host.innerHTML = '';
      (j.models || []).forEach(function (m) {
        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        row.style.padding = '2px 0';
        var dot = document.createElement('span');
        dot.textContent = m.ok ? '\u25cf' : '\u25cb';
        dot.style.color = m.ok ? '#5eb37e' : '#ff6b6b';
        var nm = document.createElement('span');
        nm.textContent = m.id;
        nm.style.flex = '1';
        nm.style.color = '#dcc8d6';
        var ms = document.createElement('span');
        ms.textContent = m.ok ? m.ms + 'ms' : (m.status || m.error || 'fail');
        ms.style.color = m.ok ? '#8a7285' : '#ff9b9b';
        row.appendChild(dot); row.appendChild(nm); row.appendChild(ms);
        host.appendChild(row);
      });
      toast('health done');
    }).catch(function () { toast('probe failed'); });
  }

  function renderFilters() {
    if (!cFilters) return;
    cFilters.innerHTML = '';
    evKinds.forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'cc-chip' + (evFilter === k ? ' on' : '');
      b.textContent = k;
      b.addEventListener('click', function () { evFilter = k; renderFilters(); renderLog(); });
      cFilters.appendChild(b);
    });
    var spacer = document.createElement('span');
    spacer.className = 'cc-cspacer';
    var clr = button('clear', function () { events = []; renderLog(); }, 'danger');
    var cp = button('copy', function () {
      var txt = events.map(function (e) {
        return fmtTime(e.at) + ' ' + (e.kind || 'info') + ' ' + (e.message || '');
      }).join('\n');
      navigator.clipboard.writeText(txt).then(function () { toast('log copied'); }, function () { toast('copy failed'); });
    });
    spacer.appendChild(clr);
    spacer.appendChild(cp);
    cFilters.appendChild(spacer);
  }

  function pushEvent(e) {
    events.push(e);
    if (events.length > 400) events.shift();
    if (evFilter === 'all' || evFilter === e.kind) appendRow(e);
  }

  function appendRow(e) {
    if (!cLog) return;
    var empty = cLog.querySelector('.cc-cempty');
    if (empty) empty.remove();
    var row = document.createElement('div');
    row.className = 'cc-ev';
    var t = document.createElement('span');
    t.className = 'cc-ev-t';
    t.textContent = fmtTime(e.at);
    var k = document.createElement('span');
    k.className = 'cc-ev-k ' + (e.kind || 'info');
    k.textContent = e.kind || 'info';
    var m = document.createElement('span');
    m.className = 'cc-ev-m';
    m.textContent = e.message || '';
    row.appendChild(t); row.appendChild(k); row.appendChild(m);
    cLog.appendChild(row);
    cLog.scrollTop = cLog.scrollHeight;
  }

  function renderLog() {
    if (!cLog) return;
    cLog.innerHTML = '';
    var list = evFilter === 'all' ? events : events.filter(function (e) { return e.kind === evFilter; });
    if (!list.length) {
      var d = document.createElement('div');
      d.className = 'cc-cempty';
      d.textContent = warmed ? 'no events yet' : 'connecting...';
      cLog.appendChild(d);
      return;
    }
    list.slice(-300).forEach(appendRow);
    cLog.scrollTop = cLog.scrollHeight;
  }

  function pollQuota() {
    fetch('/__cc/quota', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      renderQuota(j.quota);
      renderStats(j.stats);
    }).catch(function () {});
  }

  function connectEvents() {
    if (es) { try { es.close(); } catch (e) {} }
    if (!window.EventSource) { warmed = true; renderLog(); return; }
    es = new EventSource('/__cc/events/stream');
    es.onopen = function () {
      if (cLive) { cLive.className = 'cc-cpill on'; cLive.textContent = 'live'; }
    };
    es.onerror = function () {
      if (cLive) { cLive.className = 'cc-cpill'; cLive.textContent = 'off'; }
    };
    es.onmessage = function (msg) {
      warmed = true;
      try {
        var e = JSON.parse(msg.data);
        if (e.kind === 'stats') { renderStats(e.data); return; }
        pushEvent(e);
      } catch (err) {}
    };
  }

  function toggleConsole(on) {
    consoleEl.classList.toggle('open', on);
    var b = $('#cc-console-btn');
    if (b) b.classList.toggle('active', on);
    if (on) {
      drawer.classList.remove('open');
      var g = $('#cc-gear');
      if (g) g.classList.remove('active');
      pollQuota();
      if (!es) connectEvents();
    }
  }

  function openDrawer(on) {
    drawer.classList.toggle('open', on);
    var g = $('#cc-gear');
    if (g) g.classList.toggle('active', on);
    if (on) {
      consoleEl.classList.remove('open');
      var b = $('#cc-console-btn');
      if (b) b.classList.remove('active');
    }
  }

  if ($('#cc-c-close')) $('#cc-c-close').addEventListener('click', function () { toggleConsole(false); });
  renderFilters();
  renderLog();

  var walls = [];
  function loadWalls() {
    fetch('/__cc/wallpapers').then(function (r) { return r.json(); }).then(function (j) {
      walls = j.files || [];
      renderWallpapers();
    }).catch(function () {});
  }
  function renderWallpapers() {
    var host = $('#cc-walls');
    if (!host) return;
    if (!walls.length) {
      host.innerHTML = '<div style="font-size:10px;color:#a7859a">no files in ~/.config/cakecode/wallpapers</div>';
      return;
    }
    host.innerHTML = '';
    walls.forEach(function (name) {
      var isVid = /\.(mp4|webm|m4v|mov)$/i.test(name);
      var url = '/__cc/wall/' + encodeURIComponent(name);
      var d = document.createElement('div');
      d.className = 'cc-wallpick';
      d.title = name;
      if (isVid) {
        // A video has no poster frame here, so let the browser paint the first
        // frame instead of leaving an empty tile.
        var v = document.createElement('video');
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.src = url + '#t=0.1';
        v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
        d.appendChild(v);
        var badge = document.createElement('i');
        badge.textContent = '\u25b6 live';
        badge.style.cssText = 'position:absolute;top:3px;left:4px;font-style:normal;font-size:8px;color:#fff;' +
          'background:rgba(0,0,0,.55);border-radius:3px;padding:1px 3px;z-index:1';
        d.appendChild(badge);
        d.addEventListener('mouseenter', function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
        d.addEventListener('mouseleave', function () { v.pause(); v.currentTime = 0.1; });
      } else {
        d.style.backgroundImage = 'url("' + url + '")';
      }
      var s = document.createElement('span');
      s.textContent = name.replace(/\.[a-z0-9]+$/i, '');
      d.appendChild(s);
      d.addEventListener('click', function () {
        T.wallMode = isVid ? 'video' : 'file';
        set('wallUrl', url);
        toast('wallpaper: ' + name);
      });
      host.appendChild(d);
    });
  }

  /* ---------- fields ---------- */

  var TABS = ['look', 'quota', 'wall', 'motion', 'layout', 'brand', 'raw'];
  var tabNames = { look: 'look', quota: 'quota', wall: 'wallpaper', motion: 'motion', layout: 'layout', brand: 'brand', raw: 'raw' };
  var activeTab = 'look';

  function f(key, label, kind, opts) {
    opts = opts || {};
    var min = opts.min, max = opts.max, step = opts.step, choices = opts.choices;
    var id = 'ccf-' + key;
    var wrap = document.createElement('div');
    wrap.className = 'cc-field';
    var lab = document.createElement('label');
    var name = document.createElement('span');
    name.textContent = label;
    var val = document.createElement('span');
    val.className = 'cc-val';
    val.id = id + '-v';
    val.textContent = String(T[key]);
    lab.appendChild(name);
    lab.appendChild(val);
    wrap.appendChild(lab);
    var el;
    if (kind === 'color') {
      el = document.createElement('input');
      el.type = 'color';
      el.value = T[key];
      el.addEventListener('input', function () { setAndDetach(key, el.value); });
    } else if (kind === 'range') {
      el = document.createElement('input');
      el.type = 'range';
      el.min = min; el.max = max; el.step = step || 1;
      el.value = T[key];
      el.addEventListener('input', function () { setAndDetach(key, Number(el.value)); });
    } else if (kind === 'select') {
      el = document.createElement('select');
      choices.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        el.appendChild(o);
      });
      el.value = T[key];
      el.addEventListener('change', function () { setAndDetach(key, el.value); });
    } else if (kind === 'text') {
      el = document.createElement('input');
      el.type = 'text';
      el.value = T[key];
      el.addEventListener('input', function () { setAndDetach(key, el.value); });
    } else if (kind === 'area') {
      el = document.createElement('textarea');
      el.value = T[key];
      el.spellcheck = false;
      el.addEventListener('input', function () { set(key, el.value); });
    }
    if (el) {
      el.id = id;
      wrap.appendChild(el);
    }
    return wrap;
  }

  function sw(key, label) {
    var row = document.createElement('div');
    row.className = 'cc-sw';
    var s = document.createElement('span');
    s.textContent = label;
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!T[key];
    cb.id = 'ccf-' + key;
    cb.addEventListener('change', function () { set(key, cb.checked); });
    row.appendChild(s);
    row.appendChild(cb);
    return row;
  }

  function button(label, fn, cls) {
    var b = document.createElement('button');
    b.className = 'cc-mini' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function sec(name) {
    var d = document.createElement('div');
    d.className = 'cc-sec' + (name === activeTab ? ' on' : '');
    d.id = 'cc-sec-' + name;
    return d;
  }

  function buildPanel() {
    var tabs = $('#cc-tabs');
    tabs.innerHTML = '';
    TABS.forEach(function (t) {
      var b = document.createElement('div');
      b.className = 'cc-tab' + (t === activeTab ? ' on' : '');
      b.textContent = tabNames[t];
      b.addEventListener('click', function () { showTab(t); });
      tabs.appendChild(b);
    });

    body.innerHTML = '';

    var sLook = sec('look');
    sLook.appendChild(f('accent', 'accent', 'color'));
    sLook.appendChild(f('accent2', 'accent 2 / hover', 'color'));
    sLook.appendChild(f('bg0', 'background deepest', 'color'));
    sLook.appendChild(f('bg1', 'background base', 'color'));
    sLook.appendChild(f('bg2', 'layer 01', 'color'));
    sLook.appendChild(f('bg3', 'layer 02', 'color'));
    sLook.appendChild(f('textBase', 'text', 'color'));
    sLook.appendChild(f('textMuted', 'text muted', 'color'));
    sLook.appendChild(f('radius', 'corner radius', 'range', { min: 0, max: 32, step: 1 }));
    sLook.appendChild(f('density', 'density', 'range', { min: 0.75, max: 1.5, step: 0.05 }));
    sLook.appendChild(f('uiScale', 'ui scale', 'range', { min: 0.8, max: 1.4, step: 0.05 }));
    sLook.appendChild(f('backdropBlur', 'panel blur', 'range', { min: 0, max: 40, step: 1 }));
    sLook.appendChild(f('panelScrim', 'panel scrim', 'range', { min: 0, max: 0.85, step: 0.01 }));
    sLook.appendChild(f('fontSans', 'sans font', 'text'));
    sLook.appendChild(f('fontMono', 'mono font', 'text'));
    sLook.appendChild(f('codeSize', 'code size px', 'range', { min: 10, max: 22, step: 1 }));
    sLook.appendChild(f('letterSpacing', 'letter spacing', 'range', { min: -0.02, max: 0.12, step: 0.005 }));
    var presets = document.createElement('div');
    presets.className = 'cc-field';
    var pl = document.createElement('label');
    pl.innerHTML = '<span>themes</span>';
    presets.appendChild(pl);
    var grid = document.createElement('div');
    grid.className = 'cc-themes';
    grid.id = 'cc-themes';
    presets.appendChild(grid);
    sLook.appendChild(presets);
    body.appendChild(sLook);

    var sQuota = sec('quota');
    var qBox = document.createElement('div');
    qBox.className = 'cc-cquota';
    qBox.id = 'cc-q-panel';
    qBox.style.margin = '0 0 12px';
    sQuota.appendChild(qBox);
    var qNote = document.createElement('div');
    qNote.className = 'cc-cq-meta';
    qNote.style.marginBottom = '10px';
    qNote.textContent = 'the relay latches for 45s on a quota 429. upstream interleaves 200 and 429 on the same egress, so a long latch is a false positive — clear it and retry. "rotate warp" changes the egress IP and restarts the relay.';
    qNote.style.whiteSpace = 'pre-line';
    sQuota.appendChild(qNote);

    var hWrap = document.createElement('div');
    hWrap.className = 'cc-field';
    var hLab = document.createElement('label');
    hLab.innerHTML = '<span>model health</span>';
    var hBtn = button('probe', probeHealth);
    hLab.appendChild(hBtn);
    hWrap.appendChild(hLab);
    var hGrid = document.createElement('div');
    hGrid.id = 'cc-health';
    hGrid.style.fontSize = '10px';
    hGrid.style.fontFamily = 'var(--v2-font-family-code, monospace)';
    hGrid.innerHTML = '<div style="color:#a7859a">probe runs one 1-token request per model</div>';
    hWrap.appendChild(hGrid);
    sQuota.appendChild(hWrap);

    sQuota.appendChild(f('hudPos', 'hud corner', 'select', { choices: ['br', 'bl', 'tr', 'tl'] }));
    body.appendChild(sQuota);

    var sWall = sec('wall');
    sWall.appendChild(f('wallMode', 'mode', 'select', { choices: ['gradient', 'none', 'file', 'url', 'video'] }));
    sWall.appendChild(f('wallUrl', 'image url (https or /__cc/wall/x)', 'text'));
    sWall.appendChild(f('wallFit', 'fit', 'select', { choices: ['cover', 'contain', 'fill', 'none'] }));
    sWall.appendChild(f('wallPos', 'position', 'select', { choices: ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'] }));
    sWall.appendChild(f('wallBlur', 'blur px', 'range', { min: 0, max: 40, step: 1 }));
    sWall.appendChild(f('wallDim', 'dim', 'range', { min: 0, max: 1, step: 0.02 }));
    sWall.appendChild(f('wallVignette', 'vignette', 'range', { min: 0, max: 1, step: 0.02 }));
    sWall.appendChild(f('wallOpacity', 'opacity', 'range', { min: 0, max: 1, step: 0.02 }));
    sWall.appendChild(f('wallSat', 'saturation', 'range', { min: 0, max: 2, step: 0.05 }));
    sWall.appendChild(f('wallBright', 'brightness', 'range', { min: 0.2, max: 4, step: 0.05 }));
    sWall.appendChild(f('wallContrast', 'contrast', 'range', { min: 0.5, max: 2.5, step: 0.05 }));
    sWall.appendChild(sw('wallTile', 'tile pattern'));
    var upWrap = document.createElement('div');
    upWrap.className = 'cc-field';
    var upLab = document.createElement('label');
    upLab.textContent = 'upload image or video to wallpapers/';
    upWrap.appendChild(upLab);
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var isVid = /^video\//.test(file.type) || /\.(mp4|webm|m4v|mov)$/i.test(file.name);
      var limit = isVid ? 64 : 24;
      if (file.size > limit * 1024 * 1024) { toast('file too large (' + limit + 'MB)'); return; }
      file.arrayBuffer().then(function (buf) {
        return fetch('/__cc/wall?name=' + encodeURIComponent(file.name), {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: buf
        });
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.error) { toast(j.error); return; }
        toast('uploaded: ' + j.name);
        loadWalls();
        T.wallMode = isVid ? 'video' : 'file';
        set('wallUrl', '/__cc/wall/' + encodeURIComponent(j.name));
      }).catch(function (e) { toast('upload failed'); });
    });
    upWrap.appendChild(fileInput);
    sWall.appendChild(upWrap);
    var wallListWrap = document.createElement('div');
    wallListWrap.className = 'cc-field';
    var wallListLab = document.createElement('label');
    wallListLab.innerHTML = '<span>wallpapers folder</span>';
    var refreshBtn = button('refresh', loadWalls);
    wallListLab.appendChild(refreshBtn);
    wallListWrap.appendChild(wallListLab);
    var wallGrid = document.createElement('div');
    wallGrid.className = 'cc-walls';
    wallGrid.id = 'cc-walls';
    wallListWrap.appendChild(wallGrid);
    sWall.appendChild(wallListWrap);
    body.appendChild(sWall);

    var sMotion = sec('motion');
    sMotion.appendChild(f('petals', 'petals', 'range', { min: 0, max: 3, step: 1 }));
    sMotion.appendChild(sw('reduceMotion', 'reduce motion'));
    sMotion.appendChild(sw('focus', 'focus mode'));
    body.appendChild(sMotion);

    var sLayout = sec('layout');
    sLayout.appendChild(sw('compactSidebar', 'compact sidebar'));
    sLayout.appendChild(f('wallParallax', 'wallpaper parallax', 'range', { min: 0, max: 1, step: 0.05 }));
    body.appendChild(sLayout);

    var sBrand = sec('brand');
    sBrand.appendChild(f('brandFrom', 'replace text', 'text'));
    sBrand.appendChild(f('brandTo', 'with', 'text'));
    var swapNow = button('apply text swap now', function () { brandSwap(document.body); toast('swapped'); });
    sBrand.appendChild(swapNow);
    body.appendChild(sBrand);

    var sRaw = sec('raw');
    sRaw.appendChild(f('customCss', 'custom css', 'area'));
    var row = document.createElement('div');
    row.className = 'cc-row';
    row.appendChild(button('export theme', function () {
      var blob = new Blob([JSON.stringify(T, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cakecode-theme.json';
      a.click();
      toast('exported');
    }));
    row.appendChild(button('import theme', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        file.text().then(function (txt) {
          var obj = JSON.parse(txt);
          T = Object.assign({}, D, obj);
          applyTheme(); persist(); syncFields(); buildPanel();
          toast('theme imported');
        }).catch(function () { toast('bad json'); });
      });
      inp.click();
    }));
    row.appendChild(button('reset', function () {
      if (!confirm('reset all ui settings?')) return;
      T = Object.assign({}, D);
      applyTheme(); persist(); syncFields(); buildPanel();
      toast('reset');
    }, 'danger'));
    sRaw.appendChild(row);
    sRaw.appendChild(button('copy theme json', function () {
      navigator.clipboard.writeText(JSON.stringify(T, null, 2)).then(function () { toast('copied'); });
    }));
    body.appendChild(sRaw);

    syncFields();
    renderThemes();
    renderWallpapers();
  }

  function syncFields() {
    Object.keys(T).forEach(function (k) {
      var el = document.getElementById('ccf-' + k);
      var v = document.getElementById('ccf-' + k + '-v');
      if (v) v.textContent = String(T[k]);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!T[k];
      else if (document.activeElement !== el) el.value = T[k];
    });
  }

  function showTab(name) {
    activeTab = name;
    var tabs = document.querySelectorAll('.cc-tab');
    TABS.forEach(function (t, i) {
      if (tabs[i]) tabs[i].className = 'cc-tab' + (t === name ? ' on' : '');
    });
    var secs = document.querySelectorAll('.cc-sec');
    secs.forEach(function (s) { s.classList.toggle('on', s.id === 'cc-sec-' + name); });
  }

  /* ---------- dock ---------- */

  var gear = document.createElement('button');
  gear.className = 'cc-btn';
  gear.id = 'cc-gear';
  gear.textContent = '\u2699';
  gear.title = 'customize ui';
  gear.addEventListener('click', function () { openDrawer(!drawer.classList.contains('open')); });
  dock.appendChild(gear);

  var palBtn = document.createElement('button');
  palBtn.className = 'cc-btn';
  palBtn.textContent = '/';
  palBtn.title = 'command palette';
  palBtn.addEventListener('click', function () { showPalette(true); });
  dock.appendChild(palBtn);

  var conBtn = document.createElement('button');
  conBtn.className = 'cc-btn';
  conBtn.id = 'cc-console-btn';
  conBtn.textContent = '\u25a4';
  conBtn.title = 'console (ctrl/cmd+shift+c)';
  conBtn.addEventListener('click', function () { toggleConsole(!consoleEl.classList.contains('open')); });
  dock.appendChild(conBtn);

  document.getElementById('cc-dclose').addEventListener('click', function () {
    drawer.classList.remove('open');
  });

  /* ---------- parallax ---------- */

  var wallEl = $('#cc-wall');
  var wallVid = $('#cc-wall-video');
  window.addEventListener('scroll', function () {
    if (!T.wallParallax) return;
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var t = 'translate3d(0,' + (-y * T.wallParallax * 0.25) + 'px,0)';
    if (wallEl) wallEl.style.transform = t;
    if (wallVid) wallVid.style.transform = t;
  }, { passive: true });

  /* ---------- palette ---------- */

  var ACTIONS = [
    { icon: '\u25a4', label: 'console: live events / quota', key: 'console events quota log', run: function () { toggleConsole(true); } },
    { icon: '\u2665', label: 'models: probe health', key: 'health probe models', run: probeHealth },
    { icon: '\u21ba', label: 'quota: clear latch', key: 'quota reset clear', run: resetQuota },
    { icon: '\u2699', label: 'customize ui', key: 'settings theme', run: function () { openDrawer(true); } },
    { icon: '\u273f', label: 'petals: off / soft / heavy / blizzard', key: 'petals sakura', run: function () { set('petals', (Math.round(T.petals) + 1) % 4); toast('petals ' + T.petals); } },
    { icon: '\u25a3', label: 'toggle focus mode', key: 'focus zen', run: function () { set('focus', !T.focus); } },
    { icon: '\u2261', label: 'toggle compact sidebar', key: 'compact sidebar', run: function () { set('compactSidebar', !T.compactSidebar); } },
    { icon: '\u25c9', label: 'cycle hud corner', key: 'hud corner position', run: function () {
      var order = ['br', 'bl', 'tr', 'tl'];
      set('hudPos', order[(order.indexOf(T.hudPos) + 1) % order.length]);
      toast('hud ' + T.hudPos);
    } },
    { icon: '\u2b1a', label: 'wallpaper: next image in folder', key: 'wallpaper next image', run: function () {
      if (!walls.length) { toast('no wallpapers'); return; }
      var cur = decodeURIComponent(String(T.wallUrl).split('/').pop() || '');
      var i = walls.indexOf(cur);
      var next = walls[(i + 1) % walls.length];
      T.wallMode = /\.(mp4|webm|m4v|mov)$/i.test(next) ? 'video' : 'file';
      set('wallUrl', '/__cc/wall/' + encodeURIComponent(next));
      toast(next);
    } },
    { icon: '\u25d1', label: 'wallpaper: blur on / off', key: 'wallpaper blur', run: function () { set('wallBlur', T.wallBlur ? 0 : 8); } },
    { icon: '\u25d0', label: 'wallpaper: dim darker / lighter', key: 'wallpaper dim', run: function () { set('wallDim', T.wallDim > 0.6 ? 0.2 : Math.min(1, T.wallDim + 0.2)); } },
    { icon: '\u29c9', label: 'wallpaper: parallax on / off', key: 'wallpaper parallax', run: function () { set('wallParallax', T.wallParallax ? 0 : 0.4); } },
    { icon: '\u2327', label: 'toggle reduce motion', key: 'motion reduce', run: function () { set('reduceMotion', !T.reduceMotion); } },
    { icon: '\u270e', label: 'copy last code block', key: 'copy code clipboard', run: function () {
      var b = document.querySelectorAll('pre');
      if (!b.length) { toast('no code'); return; }
      navigator.clipboard.writeText(b[b.length - 1].innerText).then(function () { toast('copied'); });
    } },
    { icon: '\u21bb', label: 'reload ui settings from disk', key: 'reload theme', run: reloadTheme },
    { icon: '\u2717', label: 'reset ui to defaults', key: 'reset defaults', run: function () {
      if (!confirm('reset all ui settings?')) return;
      T = Object.assign({}, D);
      applyTheme(); persist(); buildPanel();
    } }
  ];

  var filtered = ACTIONS.slice(), activeIdx = 0;
  var pal = $('#cc-palette');
  var palInput = $('#cc-pal-input');
  var palList = $('#cc-pal-list');

  function renderPal() {
    palList.innerHTML = '';
    filtered.forEach(function (a, i) {
      var row = document.createElement('div');
      row.className = 'cc-item' + (i === activeIdx ? ' active' : '');
      var ic = document.createElement('span');
      ic.textContent = a.icon;
      var lb = document.createElement('span');
      lb.textContent = a.label;
      var k = document.createElement('span');
      k.className = 'cc-item-key';
      k.textContent = a.key.split(' ')[0];
      row.appendChild(ic); row.appendChild(lb); row.appendChild(k);
      row.addEventListener('click', function () { runAction(a); });
      palList.appendChild(row);
    });
  }
  function runAction(a) { showPalette(false); setTimeout(function () { a.run(); }, 50); }
  function showPalette(on) {
    pal.classList.toggle('hidden', !on);
    if (on) {
      activeIdx = 0;
      filtered = ACTIONS.slice();
      palInput.value = '';
      palInput.focus();
      renderPal();
    }
  }
  palInput.addEventListener('input', function () {
    var q = palInput.value.toLowerCase().trim();
    filtered = ACTIONS.filter(function (a) {
      return !q || a.key.indexOf(q) >= 0 || a.label.toLowerCase().indexOf(q) >= 0;
    });
    activeIdx = 0;
    renderPal();
  });
  palInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); renderPal(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderPal(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) runAction(filtered[activeIdx]); }
  });
  pal.addEventListener('mousedown', function (e) { if (e.target === pal) showPalette(false); });

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); showPalette(true); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); openDrawer(!drawer.classList.contains('open')); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); toggleConsole(!consoleEl.classList.contains('open')); }
    else if (e.key === 'Escape' && !typing) { showPalette(false); drawer.classList.remove('open'); toggleConsole(false); }
  });

  /* ---------- boot ---------- */

  // ---- "Thinking..." indicator -------------------------------- ----------
  // The free-tier upstream batches reasoning into one delta at completion, so
  // the UI never shows live thinking. We listen to opencode's SSE event stream
  // and surface a lightweight progress pill while the model is working.
  var thinkEl = null, thinkES = null, thinkHideT = null;
  var thinkActive = false;

  function currentSessionId() {
    // URL shapes: /session/<id> or /server/<b64>/session/<id>
    var m = location.pathname.match(/\/session\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function showThinking() {
    if (!thinkEl) return;
    thinkActive = true;
    if (thinkHideT) { clearTimeout(thinkHideT); thinkHideT = null; }
    thinkEl.classList.add('show');
  }

  function hideThinking(delay) {
    if (!thinkEl || !thinkActive) return;
    thinkActive = false;
    if (thinkHideT) clearTimeout(thinkHideT);
    var apply = function () { thinkEl.classList.remove('show'); thinkHideT = null; };
    if (delay) thinkHideT = setTimeout(apply, delay);
    else apply();
  }

  function startThinkingIndicator() {
    thinkEl = document.getElementById('cc-thinking');
    if (!thinkEl || typeof EventSource === 'undefined') return;

    // Reconnect the SSE stream if it drops; EventSource auto-reconnects, but
    // we also re-evaluate the active session on each navigation.
    try { thinkES = new EventSource('/api/event'); } catch (e) { return; }

    thinkES.onmessage = function (msg) {
      var e;
      try { e = JSON.parse(msg.data); } catch (err) { return; }
      if (!e || !e.type) return;
      var sid = e.data && e.data.sessionID;
      // Ignore events for other sessions (sidebar sessions can stream too).
      var cur = currentSessionId();
      if (cur && sid && sid !== cur) return;

      switch (e.type) {
        case 'session.step.started':
        case 'session.reasoning.started':
        case 'session.step.first-token':
          showThinking();
          break;
        case 'session.text.delta':
        case 'session.text.started':
          // First answer token means the think phase is over.
          hideThinking(120);
          break;
        case 'session.reasoning.ended':
        case 'session.step.ended':
        case 'session.step.streamed':
          hideThinking(300);
          break;
        case 'session.error':
        case 'session.execution.failed':
          hideThinking(0);
          break;
        default:
          break;
      }
    };

    // If the user navigates while a pill is visible, re-sync on next event.
    window.addEventListener('popstate', function () {
      if (!thinkActive) return;
      // Keep showing only if we're still on a session route.
      if (!currentSessionId()) hideThinking(0);
    });
  }

  /* ---------- boot ---------- */

  function reloadTheme() {
    fetch('/__cc/theme', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      T = Object.assign({}, D, j || {});
      applyTheme(); buildPanel();
      toast('theme reloaded');
    }).catch(function () { toast('reload failed'); });
  }

  function boot() {
    applyTheme();
    buildPanel();
    startThinkingIndicator();
    loadWalls();
    renderThemes();
    watchTitle();
    scheduleSwap();
    setTimeout(scheduleSwap, 400);
    setTimeout(scheduleSwap, 1200);
    setTimeout(scheduleSwap, 3000);
    // The wordmark lives in the SPA's own render tree; re-check it whenever the
    // app repaints (navigating between views re-creates it).
    setInterval(scheduleSwap, 2500);
    if (/(^|#)(ui|settings)$/.test(location.hash)) openDrawer(true);
    if (/(^|#)console$/.test(location.hash)) toggleConsole(true);
    pollQuota();
    setInterval(pollQuota, 6000);
    if (consoleEl.classList.contains('open')) connectEvents();
    toast('ui ready \u00b7 ctrl/cmd+shift+y / +c');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`

// Rebuilt per request: theme.json is hand-edited and written by the panel, so a
// value captured at module load would be stale for every page load after boot.
function buildInitScript(t) {
  return 'window.__CC_THEME__=' + JSON.stringify(t).replace(/</g, '\\u003c')
    + ';window.__CC_DEFAULTS__=' + JSON.stringify(DEFAULTS).replace(/</g, '\\u003c')
    + ';window.__CC_THEMES__=' + JSON.stringify(THEMES).replace(/</g, '\\u003c') + ';'
}

const INLINE_SCRIPT_HASH = createHash('sha256').update(UI_JS).digest('base64')

function patchCsp(csp, initHash) {
  if (!csp) return csp
  return csp
    .replace(/(script-src[^;]*)/, '$1 \'sha256-' + INLINE_SCRIPT_HASH + '\' \'sha256-' + initHash + '\'')
    .replace(/(style-src[^;]*)/, '$1 https://fonts.googleapis.com')
    .replace(/(font-src[^;]*)/, '$1 https://fonts.googleapis.com https://fonts.gstatic.com')
}

// First paint still ships the upstream brand in <title> and og:title; swap it in
// the shell so the tab never reads the old name, even before the SPA boots.
function brandShell(html, t) {
  const from = t.brandFrom, to = t.brandTo
  if (!from || !to || from === to) return html
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return html
    .replace(new RegExp('(<title[^>]*>)([^<]*)(' + '</title>)', 'i'),
      (m, a, text, c) => a + text.split(from).join(to) + c)
    .replace(new RegExp('(<meta[^>]*content=")([^"]*' + esc(from) + '[^"]*)(")', 'gi'),
      (m, a, text, c) => a + text.split(from).join(to) + c)
}

function buildInjection(t) {
  const initScript = buildInitScript(t)
  const head = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Zen+Kaku+Gothic+New:wght@400;700&family=JetBrains+Mono:wght@400;500;600&display=swap">',
    '<style id="cc-vars">' + themeCss(t) + '</style>',
    '<style id="cc-wall-css">' + wallpaperCss(t) + '</style>',
    '<style id="cc-struct">' + STRUCT_CSS + '</style>',
  ].join('')
  const body = UI_HTML
  const scripts = '<script>' + initScript + '</script><script>' + UI_JS + '</script>'
  return { head, body, scripts, initHash: createHash('sha256').update(initScript).digest('base64') }
}

/* ------------------------------------------------------------------ serve */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i
const VIDEO_EXT = /\.(mp4|webm|m4v|mov)$/i
const WALL_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|m4v|mov)$/i

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/x-m4v', mov: 'video/quicktime',
}

// Same-origin self test: loads the themed page in an iframe and reports the
// computed values the theme is supposed to set. Open /__cc/selftest.
const SELFTEST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>pending</title>
<style>body{background:#111;color:#eee;font:12px ui-monospace,monospace;margin:0}
iframe{position:fixed;right:0;bottom:0;width:640px;height:420px;border:1px solid #444;opacity:.35}
pre{padding:12px;white-space:pre-wrap}</style></head><body>
<pre id="out">running...</pre>
<iframe id="f" src="/#ui"></iframe>
<script>
function run(){
  var f=document.getElementById('f');
  var out=document.getElementById('out');
  var lines=[];
  try{
    var d=f.contentDocument, w=f.contentWindow;
    function cs(el,prop,pe){ return w.getComputedStyle(el,pe||null).getPropertyValue(prop); }
    var root=d.documentElement;
    lines.push('accent var: '+cs(root,'--v2-background-bg-accent'));
    lines.push('bg deep var: '+cs(root,'--v2-background-bg-deep'));
    lines.push('radius var: '+cs(root,'--cc-radius'));
    lines.push('font sans: '+cs(root,'--v2-font-family-sans'));
    var wall=d.getElementById('cc-wall');
    lines.push('wall present: '+!!wall);
    if(wall){ var wcs=w.getComputedStyle(wall); lines.push('wall display: '+wcs.display); lines.push('wall image: '+wcs.backgroundImage.slice(0,90)); }
    lines.push('tint present: '+!!d.getElementById('cc-wall-tint'));
    lines.push('petals canvas: '+!!d.getElementById('cc-petals'));
    var drawer=d.getElementById('cc-drawer');
    lines.push('drawer: '+(drawer?drawer.className:'missing'));
    var tabs=d.querySelectorAll('.cc-tab');
    lines.push('tabs: '+tabs.length+' ['+Array.prototype.map.call(tabs,function(t){return t.textContent}).join(', ')+']');
    lines.push('fields: '+d.querySelectorAll('.cc-field').length);
    if(drawer){ var dcs=w.getComputedStyle(drawer); lines.push('drawer width: '+dcs.width+' transform: '+dcs.transform.slice(0,40)); }
    var con=d.getElementById('cc-console');
    lines.push('console: '+(con?('class="'+con.className+'" width='+w.getComputedStyle(con).width):'MISSING'));
    lines.push('console stats: '+((d.getElementById('cc-c-stats')||{}).textContent||'').trim());
    lines.push('console quota: '+((d.getElementById('cc-c-quota')||{}).textContent||'').trim().replace(/\\s+/g,' ').slice(0,120));
    lines.push('console rows: '+(d.querySelectorAll('#cc-c-log .cc-ev').length));
    lines.push('console chips: '+(d.querySelectorAll('#cc-c-filters .cc-chip').length));
    lines.push('themes: '+(d.querySelectorAll('#cc-themes .cc-tcard').length));
    lines.push('page errors: '+(w.__ccErr||'none'));
    lines.push('dock pos: '+(d.getElementById('cc-dock')||{}).className);
    lines.push('body bg: '+cs(d.body,'background-color'));
    lines.push('pre radius: '+(d.querySelector('pre')?cs(d.querySelector('pre'),'border-radius'):'no pre'));
    lines.push('doc title: '+d.title);
    lines.push('styles: '+(d.getElementById('cc-vars')?'vars ok':'vars MISSING')+', '+(d.getElementById('cc-wall-css')?'wall ok':'wall MISSING')+', '+(d.getElementById('cc-struct')?'struct ok':'struct MISSING'));
  }catch(e){ lines.push('ERROR: '+e.message); }
  var txt=lines.join('\\n');
  out.textContent=txt;
  document.title=txt.replace(/[\\n|]/g,' ');
}
document.getElementById('f').addEventListener('load', function(){
  setTimeout(function(){
    // exercise the console toggle the way a user would, then read the DOM
    try {
      var d = document.getElementById('f').contentDocument;
      var btn = d.getElementById('cc-console-btn');
      if (btn) btn.click();
    } catch (e) {}
    setTimeout(run, 2200);
  }, 900);
});
</script></body></html>`


function listWallpapers() {
  try {
    return fs.readdirSync(WALL_DIR).filter((f) => WALL_EXT.test(f)).sort()
  } catch {
    return []
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const target = new URL(TARGET)

// The tenant server answers 401 "Authentication required" on every /api call
// when it has a password. Browsers never send credentials on same-origin
// fetches, so the proxy attaches them on each hop instead of making the UI
// log in. Format is Basic("opencode:" + password); a bare base64 password is
// rejected by the server.
const SERVICE_FILE = path.join(CONF_DIR, 'service.json')

function encodeAuth(password) {
  return 'Basic ' + Buffer.from('opencode:' + password, 'utf8').toString('base64')
}

function readUpstreamPassword() {
  if (process.env.CC_PASSWORD) return process.env.CC_PASSWORD
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVICE_FILE, 'utf8'))
    return typeof parsed.password === 'string' && parsed.password.length > 0
      ? parsed.password
      : null
  } catch {
    return null
  }
}

// Password can rotate (service restart regenerates it), so keep the mtime and
// re-read when the file changes rather than pinning a stale credential.
let upstreamPassword = readUpstreamPassword()
let upstreamAuth = upstreamPassword ? encodeAuth(upstreamPassword) : null
let upstreamMtime = (() => {
  try {
    return fs.statSync(SERVICE_FILE).mtimeMs
  } catch {
    return 0
  }
})()

function refreshUpstreamAuth() {
  let mtime = 0
  try {
    mtime = fs.statSync(SERVICE_FILE).mtimeMs
  } catch {
    return
  }
  if (mtime === upstreamMtime) return
  upstreamMtime = mtime
  const next = readUpstreamPassword()
  if (next === upstreamPassword) return
  upstreamPassword = next
  upstreamAuth = next ? encodeAuth(next) : null
}

function withUpstreamAuth(headers) {
  refreshUpstreamAuth()
  if (!upstreamAuth) return headers
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') continue
    out[k] = v
  }
  out.authorization = upstreamAuth
  return out
}

// The relay (8791) owns quota + events; the tenant server (49777) owns pairing.
const RELAY = process.env.CC_RELAY || 'http://127.0.0.1:8791'

function relayJson(pathName, method) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(pathName, RELAY)
    } catch {
      return resolve(null)
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method || 'GET', timeout: 8000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

function relayStream(res) {
  let u
  try {
    u = new URL('/__events/stream', RELAY)
  } catch {
    res.writeHead(502)
    return res.end('relay url invalid')
  }
  const up = http.request(
    { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: { accept: 'text/event-stream' } },
    (upRes) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      upRes.pipe(res)
    },
  )
  up.on('error', () => {
    try {
      res.writeHead(502)
      res.end('relay unreachable')
    } catch { /* already sent */ }
  })
  res.on('close', () => up.destroy())
  up.end()
}

// WARP egress rotation, mirroring `zengate native`: rotate keys, bounce the
// tunnel, restart the relay, report the new egress address.
function rotateWarp() {
  const cli = ['/usr/local/bin/warp-cli', '/opt/homebrew/bin/warp-cli'].find((p) => fs.existsSync(p))
  const runCli = (args) => {
    try {
      execFileSync(cli, ['--accept-tos', ...args], { encoding: 'utf8', timeout: 25000 })
    } catch { /* best effort */ }
  }
  if (cli) {
    runCli(['tunnel', 'rotate-keys'])
    runCli(['disconnect'])
    runCli(['connect'])
  }
  try {
    execFileSync('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ai.opencode.zenrelay`], { timeout: 10000 })
  } catch { /* best effort */ }
  let egress = null
  try {
    egress = execFileSync('curl', ['-s', '--max-time', '8', '-x', 'http://127.0.0.1:40000', 'https://api.ipify.org'], {
      encoding: 'utf8', timeout: 12000,
    }).trim()
  } catch { /* ignore */ }
  return egress
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (url.pathname === '/__cc/selftest') {
    const body = SELFTEST_HTML
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com",
    })
    return res.end(body)
  }

  if (url.pathname === '/__cc/theme' && req.method === 'GET') {
    return sendJson(res, 200, readTheme())
  }
  if (url.pathname === '/__cc/theme' && req.method === 'POST') {
    try {
      const raw = await readBody(req, MAX_THEME_BYTES)
      const patch = JSON.parse(raw.toString('utf8') || '{}')
      return sendJson(res, 200, writeTheme(patch))
    } catch (err) {
      return sendJson(res, 400, { error: String((err && err.message) || err) })
    }
  }
  if (url.pathname === '/__cc/wallpapers' && req.method === 'GET') {
    return sendJson(res, 200, { dir: WALL_DIR, files: listWallpapers() })
  }

  // Console data: relay quota + stats, relay event tail, relay SSE, warp rotate.
  if (url.pathname === '/__cc/quota' && req.method === 'GET') {
    const j = await relayJson('/__quota')
    if (!j) return sendJson(res, 502, { error: 'relay unreachable' })
    return sendJson(res, 200, j)
  }
  if (url.pathname === '/__cc/quota/reset' && req.method === 'POST') {
    const j = await relayJson('/__quota/reset', 'POST')
    if (!j) return sendJson(res, 502, { error: 'relay unreachable' })
    return sendJson(res, 200, j)
  }
  if (url.pathname === '/__cc/events' && req.method === 'GET') {
    const j = await relayJson('/__events' + (url.search || ''))
    if (!j) return sendJson(res, 502, { error: 'relay unreachable', events: [] })
    return sendJson(res, 200, j)
  }
  if (url.pathname === '/__cc/events/stream' && req.method === 'GET') {
    return relayStream(res)
  }
  if (url.pathname === '/__cc/quota/rotate' && req.method === 'POST') {
    const egress = rotateWarp()
    const j = await relayJson('/__quota')
    return sendJson(res, 200, { ok: !!egress, egress, quota: (j && j.quota) || null })
  }

  // Model health probe: one tiny request per free model, in sequence, so the
  // console can show which ids actually answer right now. Costs one token each.
  if (url.pathname === '/__cc/health' && req.method === 'GET') {
    const ids = String(url.searchParams.get('models') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const list = ids.length ? ids : ['deepseek-v4.1-flash-free', 'hy4-flash-free', 'beam-free',
      'mimo-v2.6-flash-free', 'nemotron-3.5-lightning-free', 'big-pickle',
      'flint-40b-free', 'iceman-free', 'tidepool-alpha-free', 'nemotron-3.5-super-vl-free']
    const results = []
    for (const id of list) {
      const started = Date.now()
      const r = await new Promise((resolve) => {
        const payload = JSON.stringify({
          model: 'opencode-free/' + id,
          messages: [{ role: 'user', content: 'ok' }],
          stream: false,
          max_tokens: 1,
        })
        const u = new URL('/v1/chat/completions', RELAY)
        const rq = http.request({
          hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 45000,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        }, (rs) => {
          let body = ''
          rs.setEncoding('utf8')
          rs.on('data', (c) => { body += c })
          rs.on('end', () => {
            let msg = ''
            try { msg = (JSON.parse(body).error || {}).message || '' } catch { /* ignore */ }
            resolve({ status: rs.statusCode, error: String(msg).slice(0, 160) })
          })
        })
        rq.on('error', (e) => resolve({ status: 0, error: e.message }))
        rq.on('timeout', () => { rq.destroy(); resolve({ status: 0, error: 'timeout' }) })
        rq.end(payload)
      })
      results.push({
        id,
        ok: r.status === 200,
        status: r.status,
        ms: Date.now() - started,
        error: r.error || null,
      })
    }
    return sendJson(res, 200, { models: results, checkedAt: Date.now() })
  }
  if (url.pathname === '/__cc/wall' && req.method === 'POST') {
    const name = path.basename(String(url.searchParams.get('name') || ''))
    if (!name || !WALL_EXT.test(name)) return sendJson(res, 400, { error: 'name must be an image or video extension' })
    try {
      const buf = await readBody(req, 64 * 1024 * 1024)
      fs.writeFileSync(path.join(WALL_DIR, name), buf)
      return sendJson(res, 200, { name, bytes: buf.length })
    } catch (err) {
      return sendJson(res, 400, { error: String((err && err.message) || err) })
    }
  }
  if (url.pathname.startsWith('/__cc/wall/') && req.method === 'GET') {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/__cc/wall/'.length)))
    const file = path.join(WALL_DIR, name)
    if (!WALL_EXT.test(name) || !fs.existsSync(file)) {
      res.writeHead(404)
      return res.end('not found')
    }
    const stat = fs.statSync(file)
    const ext = name.split('.').pop().toLowerCase()
    const type = MIME_BY_EXT[ext] || 'application/octet-stream'
    const isVideo = VIDEO_EXT.test(name)
    const headers = {
      'content-type': type,
      'cache-control': 'public, max-age=3600',
      'accept-ranges': 'bytes',
    }
    // A <video> element seeks by byte range. Serving the whole 17MB body with a
    // plain 200 makes the browser buffer the entire file before the first frame,
    // and blocks looping previews from scrubbing at all.
    const range = req.headers.range
    if (isVideo && range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
      if (m) {
        const size = stat.size
        let start = m[1] === '' ? NaN : parseInt(m[1], 10)
        let end = m[2] === '' ? NaN : parseInt(m[2], 10)
        if (Number.isNaN(start)) {
          // "bytes=-N" means the final N bytes.
          start = Math.max(0, size - (Number.isNaN(end) ? 0 : end))
          end = size - 1
        } else if (Number.isNaN(end) || end >= size) {
          end = size - 1
        }
        if (start > end || start >= size) {
          res.writeHead(416, { 'content-range': 'bytes */' + size })
          return res.end()
        }
        headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size
        headers['content-length'] = end - start + 1
        res.writeHead(206, headers)
        return fs.createReadStream(file, { start, end }).pipe(res)
      }
    }
    headers['content-length'] = stat.size
    res.writeHead(200, headers)
    return fs.createReadStream(file).pipe(res)
  }

  const options = {
    hostname: target.hostname,
    port: target.port,
    path: url.pathname + url.search,
    method: req.method,
    headers: withUpstreamAuth({ ...req.headers, host: target.host, 'accept-encoding': 'identity' }),
  }

  const proxyReq = http.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || ''
    if (!ct.includes('text/html')) {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      return proxyRes.pipe(res)
    }
    let body = ''
    proxyRes.setEncoding('utf8')
    proxyRes.on('data', (c) => { body += c })
    proxyRes.on('end', () => {
      const theme = readTheme()
      const inj = buildInjection(theme)
      body = brandShell(body, theme)
      if (body.includes('</head>')) body = body.replace('</head>', inj.head + '</head>')
      else body = inj.head + body
      if (body.includes('</body>')) body = body.replace('</body>', inj.body + inj.scripts + '</body>')
      else body += inj.body + inj.scripts

      const headers = { ...proxyRes.headers }
      delete headers['content-length']
      delete headers['content-encoding']
      headers['content-length'] = Buffer.byteLength(body)
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'content-security-policy') headers[k] = patchCsp(headers[k], inj.initHash)
      }
      res.writeHead(proxyRes.statusCode || 200, headers)
      res.end(body)
    })
  })

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('Bad Gateway: ' + err.message + '\n\nIs the cakecode server running on ' + TARGET + '?')
  })

  req.pipe(proxyReq)
})

// websocket / upgrade passthrough
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
    const headers = Object.entries(withUpstreamAuth(req.headers))
      .filter(([k]) => k.toLowerCase() !== 'host')
      .map(([k, v]) => k + ': ' + v)
      .join('\r\n')
    upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + headers + '\r\nHost: ' + target.host + '\r\n\r\n')
    if (head && head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, HOST, () => {
  console.log('[cakecode-ui] http://' + HOST + ':' + PORT + ' -> ' + TARGET)
  console.log('[cakecode-ui] theme: ' + THEME_FILE)
  console.log('[cakecode-ui] wallpapers: ' + WALL_DIR)
})
