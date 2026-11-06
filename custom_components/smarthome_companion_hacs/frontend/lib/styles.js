// Stylesheet for the Companion dashboard. Inherits the active HA theme via CSS variables.
export const STYLES = `
:host {
  display: block;
  min-height: 100%;
  background: var(--primary-background-color, #111);
  color: var(--primary-text-color, #e6e6e6);
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif));
  --cd-card: var(--ha-card-background, var(--card-background-color, #1c1c1c));
  --cd-radius: 20px;
  --cd-tile-radius: 12px;
  --cd-secondary: var(--secondary-text-color, #9b9b9b);
  --cd-accent: var(--primary-color, #03a9f4);
  --cd-tile-bg: rgba(128, 128, 128, 0.12);
  --cd-tile-bg: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent);
  --cd-active: var(--state-active-color, #ffc107);
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
ha-icon { --mdc-icon-size: 22px; display: inline-flex; }
button { font: inherit; color: inherit; }

.page { max-width: 1680px; margin: 0 auto; padding: 0 16px 110px; }

/* ── Toolbar / header ── */
.toolbar { display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 4px; }
.toolbar .spacer { flex: 1; }
.icon-btn {
  width: 44px; height: 44px; border-radius: 50%; border: 0; background: transparent; cursor: pointer;
  display: grid; place-items: center; color: var(--primary-text-color, #fff);
}
.icon-btn:hover { background: var(--cd-tile-bg); }
.icon-btn.edit-btn-active,
.icon-btn[data-active] {
  background: var(--cd-accent, #0284c7) !important;
  color: #fff !important;
  box-shadow: 0 0 12px color-mix(in srgb, var(--cd-accent, #0284c7) 80%, transparent) !important;
}
.edit-mode-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px; margin: 4px 0 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--cd-accent, #0284c7) 22%, var(--cd-card, #1a1a1a));
  border: 1.5px solid var(--cd-accent, #0284c7);
  color: var(--primary-text-color, #fff);
  box-shadow: 0 4px 18px rgba(0,0,0,.35);
  animation: cdFadeIn 0.2s ease-out;
}
.edit-mode-banner-info {
  display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; min-width: 0;
}
.edit-mode-banner-info ha-icon {
  color: var(--cd-accent, #0284c7); --mdc-icon-size: 20px; flex: none;
}
.edit-mode-banner-info span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edit-mode-banner-btn {
  padding: 6px 14px; border-radius: 18px; border: 0;
  background: var(--cd-accent, #0284c7); color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer; flex: none;
  transition: transform .1s, opacity .15s;
}
.edit-mode-banner-btn:active { transform: scale(0.95); }
.page[data-edit-mode] .tile,
.page[data-edit-mode] .cover-detail-row {
  cursor: pointer !important;
  position: relative !important;
  outline: 2px dashed var(--cd-accent) !important;
  outline-offset: -2px;
}
.page[data-edit-mode] .tile:hover,
.page[data-edit-mode] .cover-detail-row:hover {
  outline-color: #fff !important;
  box-shadow: 0 0 14px color-mix(in srgb, var(--cd-accent) 45%, transparent) !important;
}
.page[data-edit-mode] .tile::after,
.page[data-edit-mode] .cover-detail-row::after {
  content: '✏️';
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 6px;
  background: rgba(0,0,0,0.7);
  border: 1px solid var(--cd-accent);
  pointer-events: none;
  z-index: 10;
}
.device-room-section { margin-top: 16px; }
.device-room-section:first-child { margin-top: 4px; }
.device-room-header {
  display: flex; align-items: center; gap: 8px; padding: 6px 4px 8px;
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--primary-text-color, #fff);
  border-bottom: 1px solid rgba(255,255,255,.08); margin-bottom: 8px;
}
.device-room-header ha-icon { color: var(--cd-accent); --mdc-icon-size: 18px; flex: none; }
.device-room-header .room-count { font-size: 12px; font-weight: 500; color: var(--cd-secondary); }
.greeting { text-align: center; margin: 4px 0 12px; }
.greeting h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.3px; }
.badges {
  display: flex; gap: 8px; overflow-x: auto; justify-content: center; flex-wrap: wrap;
  padding: 4px 0 14px; scrollbar-width: none;
}
.badge {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 10px;
  border-radius: 18px; background: var(--cd-card); cursor: pointer; border: 0; white-space: nowrap;
  font-size: 14px; font-weight: 500; --badge-color: var(--cd-accent);
}
.badge ha-icon { --mdc-icon-size: 20px; color: var(--badge-color); }
.badge .badge-name { color: var(--cd-secondary); font-weight: 400; }
.badge:active { transform: scale(0.97); }

/* ── Layout ── */
.layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 1000px) {
  .layout.has-side { grid-template-columns: minmax(300px, 360px) minmax(0, 1fr); }
}
.side, .main { display: grid; gap: 12px; min-width: 0; align-content: start; }
.rooms {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start;
}
.room-col {
  flex: 1 1 360px; max-width: 440px; min-width: min(100%, 320px);
  display: flex; flex-direction: column; gap: 12px;
}

/* ── Cards ── */
.card { background: var(--cd-card); border-radius: var(--cd-radius); overflow: hidden; }
.empty { text-align: center; color: var(--cd-secondary); padding: 48px 16px; }
.empty ha-icon { --mdc-icon-size: 48px; opacity: .5; }

/* ── Room (expander) ── */
.room-head { display: flex; align-items: center; gap: 12px; padding: 10px 12px; min-height: 60px; cursor: pointer; user-select: none; }
.room-icon {
  flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  color: var(--cd-accent); background: rgba(3, 169, 244, 0.15);
  background: color-mix(in srgb, var(--cd-accent) 16%, transparent);
}
.room-title { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.room-name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
.room-meta { display: flex; gap: 8px; flex-wrap: wrap; overflow: hidden; font-size: 12px; color: var(--cd-secondary); margin-top: 3px; line-height: 1.2; }
.room-meta[hidden], .room-meta:empty { display: none !important; }
.room-meta span { display: inline-flex; align-items: center; gap: 3px; }
.room-meta ha-icon { --mdc-icon-size: 14px; }
.room-meta .alert { color: var(--cd-active); font-weight: 600; }
.room-controls { display: flex; gap: 6px; flex-shrink: 0; }
.ctrl-btn {
  position: relative; width: 38px; height: 38px; border-radius: 14px; border: 0; cursor: pointer;
  display: grid; place-items: center; background: var(--cd-tile-bg); color: var(--cd-secondary);
  transition: transform .15s, background .15s, color .15s;
}
.ctrl-btn[data-on] {
  color: var(--group-color, var(--cd-active));
  background: color-mix(in srgb, var(--group-color, var(--cd-active)) 18%, transparent);
}
.ctrl-btn .count {
  position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px;
  background: var(--group-color, var(--cd-active)); color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center;
}
.chevron { flex: none; color: var(--cd-secondary); transition: transform .28s ease; }
.room[data-open] .chevron { transform: rotate(180deg); }
.room[data-always] .chevron { display: none; }
.room-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s ease; }
.room[data-open] .room-body { grid-template-rows: 1fr; }
.room-body-inner { overflow: hidden; min-height: 0; }
.tile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 8px 10px; }

/* ── Tiles ── */
.tile {
  --tile-color: var(--cd-active);
  display: grid; gap: 8px; padding: 8px 10px 8px 8px; min-width: 0; overflow: hidden; border-radius: var(--cd-tile-radius, 12px);
  background: var(--cd-tile-bg); transition: background .2s, opacity .2s;
}
.tile.wide { grid-column: span 2; }
.tile[data-active="false"] { --tile-color: var(--cd-secondary); }
.tile[data-unavailable] { opacity: .5; }

/* ── Hierarchical Group Tile ── */
.tile.group {
  position: relative;
  transition: background .2s, box-shadow .2s;
}
.tile.group[data-open] {
  background: color-mix(in srgb, var(--cd-tile-bg) 85%, var(--cd-accent));
  box-shadow: 0 4px 18px rgba(0,0,0,.35);
}
.group-icon-btn { position: relative; }
.group-badge {
  position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px;
  background: var(--tile-color, var(--cd-accent)); color: #fff; font-size: 10px; font-weight: 700;
  display: grid; place-items: center; box-shadow: 0 1px 4px rgba(0,0,0,.5);
}
.group-sub-container {
  width: 100%; padding: 8px 6px 10px; margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 0 0 var(--cd-tile-radius, 12px) var(--cd-tile-radius, 12px);
  animation: cdFadeIn 0.2s ease-out;
}
.group-sub-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0;
}
.chevron-btn { transition: transform .25s ease; }
.tile[data-open] .chevron-btn { transform: rotate(180deg); }

/* ── Multi-select & Action Bar ── */
.sel-checkbox {
  width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(255,255,255,.3);
  background: transparent; display: grid; place-items: center; cursor: pointer; flex: none;
  transition: background .15s, border-color .15s; color: transparent;
}
.sel-checkbox[data-checked] {
  background: var(--cd-accent); border-color: var(--cd-accent); color: #fff;
}
.sel-checkbox ha-icon { --mdc-icon-size: 16px; }
.device-card[data-selected] {
  outline: 2px solid var(--cd-accent);
  background: color-mix(in srgb, var(--cd-accent) 14%, var(--cd-tile-bg));
}
.selection-action-bar {
  position: sticky; bottom: 0; left: 0; right: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 18px; margin: 12px -16px -16px; border-radius: 0 0 var(--cd-radius) var(--cd-radius);
  background: var(--cd-card); border-top: 1.5px solid var(--cd-accent);
  box-shadow: 0 -4px 20px rgba(0,0,0,.4); animation: cdFadeIn 0.2s ease-out;
}
.sel-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sel-count { font-size: 13px; font-weight: 700; color: var(--primary-text-color, #fff); }
.sel-names { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sel-buttons { display: flex; align-items: center; gap: 8px; flex: none; }
.tile-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tile-icon {
  flex: none; width: 38px; height: 38px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
  color: var(--tile-color); background: rgba(128, 128, 128, 0.18);
  background: color-mix(in srgb, var(--tile-color) 18%, transparent);
  transition: background .2s, color .2s;
}
.tile-icon:active { transform: scale(0.92); }
.tile-info { flex: 1; min-width: 0; cursor: pointer; }
.tile-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-state { font-size: 12px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-btns { display: flex; gap: 4px; flex: none; }
.mini-btn {
  width: 34px; height: 34px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
  background: rgba(128, 128, 128, 0.2); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent);
}
.mini-btn:disabled { opacity: .35; cursor: default; }
.mini-btn:not(:disabled):active { transform: scale(0.9); }
.mini-btn ha-icon { --mdc-icon-size: 20px; }
.tile-feature { display: flex; align-items: center; gap: 10px; padding: 0 2px 2px; flex-wrap: wrap; min-width: 0; }
.tile-feature[hidden] { display: none; }
.swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); cursor: pointer; flex: none; padding: 0; }
.swatch:active { transform: scale(0.9); }
input[type=range].slider {
  -webkit-appearance: none; appearance: none; flex: 1; min-width: 60px; height: 28px; border-radius: 14px; outline: none; cursor: pointer;
  background: linear-gradient(to right, var(--tile-color) var(--val, 0%), rgba(128,128,128,.25) var(--val, 0%));
  touch-action: none;
  box-sizing: border-box;
  padding: 0 7px;
}
input[type=range].slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 5px;
  height: 16px;
  background-color: #fff;
  border-radius: 999px;
  border: 0;
  box-shadow: 0 0 2px rgba(0,0,0,.5);
}
input[type=range].slider::-moz-range-thumb {
  width: 5px;
  height: 16px;
  background-color: #fff;
  border-radius: 999px;
  border: 0;
  box-shadow: 0 0 2px rgba(0,0,0,.5);
}

/* media + climate cards */
.tile.media { background-size: cover; background-position: center; position: relative; overflow: hidden; }
.tile.media[data-art] { background-blend-mode: overlay; background-color: rgba(0,0,0,.55); color: #fff; }
.tile.media[data-art] .tile-state { color: rgba(255,255,255,.75); }

/* ── Alerts ── */
.alert-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--cd-radius); cursor: pointer; }
.alert-card .a-icon { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.alert-card .a-title { font-weight: 600; font-size: 15px; }
.alert-card .a-sub { font-size: 12px; opacity: .8; }
.alert-smoke { color: #fff; background: rgba(255,0,0,.3); border: 2px solid red; animation: cd-flash 1s infinite alternate; }
.alert-smoke .a-icon { background: rgba(255,0,0,.35); animation: cd-shake .3s infinite; }
.alert-warn { background: var(--cd-card); }
.alert-warn .a-icon { background: rgba(255,152,0,.2); color: #ff9800; }
@keyframes cd-flash {
  0% { background: rgba(255,0,0,.2); border-color: rgba(255,0,0,.5); box-shadow: 0 0 0 transparent; }
  100% { background: rgba(255,0,0,.45); border-color: red; box-shadow: 0 0 15px red; }
}
@keyframes cd-shake { 0%{transform:rotate(0)} 25%{transform:rotate(15deg)} 50%{transform:rotate(0)} 75%{transform:rotate(-15deg)} 100%{transform:rotate(0)} }

/* ── Info stack (trash / person / announce) ── */
.info-card {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 12px;
  align-items: center;
}
.info-card > * {
  flex: 1 1 135px;
  min-width: 0;
}
.info-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.info-col:not(:has(> :not([hidden]))) { display: none !important; }
.info-card > [hidden] { display: none !important; }
.info-card:not(:has(> :not([hidden]))) { display: none !important; }

.stack { display: flex; flex-direction: column; gap: 0; }
.stack > [hidden] { display: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; height: 0 !important; }
.stack-row { padding: 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
.stack-row[hidden] { display: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; height: 0 !important; }

.bins { display: flex; flex-direction: column; gap: 6px; flex: 1; width: 100%; min-width: 0; }
.bin {
  display: flex; align-items: center; gap: 10px; padding: 4px 6px; border-radius: var(--cd-tile-radius, 12px);
  background: transparent; min-height: 44px; transition: transform .15s, background .15s; width: 100%; min-width: 0;
}
.bin:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }
.bin img { width: 38px; height: 38px; object-fit: contain; pointer-events: none; flex-shrink: 0; }
.bin svg { width: 38px; height: 38px; flex-shrink: 0; pointer-events: none; }
.bin ha-icon { --mdc-icon-size: 32px; flex-shrink: 0; }
.bin .b-info { display: flex; flex-direction: column; min-width: 0; flex: 1; justify-content: center; text-align: left; }
.bin .when {
  font-size: 11px; font-weight: 500; color: var(--cd-secondary); margin-top: 2px;
}
.bin .when.today { color: var(--error-color, #f44336); font-weight: 700; }
.bin .when.tomorrow { color: #f59e0b; font-weight: 600; }
.bin-label { font-size: 13px; font-weight: 600; color: var(--primary-text-color, #fff); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trash-empty { font-size: 12px; color: var(--cd-secondary); padding: 6px; }

/* ── Standalone Trash Card (Horizontal Layout) ── */
.trash-card {
  padding: 0;
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0;
}
.trash-card .bins {
  display: flex; flex-direction: row; align-items: stretch; gap: 10px; flex-wrap: wrap; width: 100%; min-width: 0;
}
.trash-card .bin {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--cd-radius);
  background: var(--cd-card); min-height: 52px; transition: transform .15s, background .15s;
  flex: 1 1 140px; min-width: 120px;
}
.trash-card .bin:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }

/* ── Standalone Announce Card ── */
.announce-card { padding: 0; overflow: hidden; cursor: pointer; }
.announce-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; transition: background .15s; }
.announce-row:hover { background: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent); }
.announce-icon {
  width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none;
  color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 18%, transparent);
}
.announce-icon ha-icon { --mdc-icon-size: 20px; }
.announce-name { flex: 1; font-weight: 600; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.announce-row .chevron { color: var(--cd-secondary); --mdc-icon-size: 20px; flex: none; }
.person {
  display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; border-radius: 14px; background: var(--cd-tile-bg);
}
.person .avatar { width: 40px; height: 40px; border-radius: 50%; background: rgba(128,128,128,.25) center/cover no-repeat; display: grid; place-items: center; }
.person .p-name { font-weight: 600; font-size: 14px; }
.person .p-state { font-size: 12px; color: var(--cd-secondary); }
.chips { display: flex; gap: 8px; justify-content: center; padding: 6px 8px 8px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 8px; border-radius: 16px; background: var(--cd-tile-bg); font-size: 13px; cursor: pointer; }
.chip ha-icon { --mdc-icon-size: 18px; }
.full-tile { display: flex; align-items: center; gap: 12px; padding: 12px; cursor: pointer; }

/* ── Bottom nav ── */
.nav {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 5;
  display: flex; gap: 8px; padding: 8px; border-radius: 28px; max-width: calc(100% - 24px);
  background: var(--cd-card); box-shadow: 0 4px 24px rgba(0,0,0,.35);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
.nav-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 52px; height: 48px;
  padding: 0 18px; border-radius: 24px; border: 0; cursor: pointer; background: var(--cd-tile-bg); font-weight: 600; font-size: 14px;
}
.nav-btn:active { transform: scale(0.96); }

/* ── Settings dialog ── */
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 16px;
  overflow-y: auto;
}
.dialog {
  width: min(1200px, 96vw);
  min-height: min(740px, 88vh);
  max-height: min(94vh, 940px);
  height: min(820px, 90vh);
  margin: auto;
  display: flex; flex-direction: column;
  border-radius: var(--cd-radius);
  background: var(--cd-card);
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  position: relative;
}
.dialog-head { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 20px; border-bottom: 1px solid rgba(128,128,128,.18); }
.dialog-head h2 { flex: 1; margin: 0; font-size: 18px; }
.tabs { flex-shrink: 0; display: flex; gap: 4px; padding: 6px 12px 0; min-height: 44px; align-items: flex-end; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid rgba(128,128,128,.18); }
.tab { flex-shrink: 0; border: 0; background: transparent; cursor: pointer; padding: 9px 14px; border-radius: 10px 10px 0 0; font-weight: 600; font-size: 13px; color: var(--cd-secondary); white-space: nowrap; transition: color .15s, background .15s; }
.tab:hover { color: var(--primary-text-color, #fff); background: rgba(128,128,128,.08); }
.tab[data-active] { color: var(--cd-accent); box-shadow: inset 0 -2px 0 var(--cd-accent); }
.dialog-body { flex: 1; min-height: 520px; overflow-y: auto; overflow-x: hidden; padding: 22px 28px 80px; display: grid; gap: 16px; align-content: start; }
.dialog-foot { flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 24px; border-top: 1px solid rgba(128,128,128,.18); background: var(--cd-card); }
.dialog-foot-actions { display: flex; align-items: center; gap: 10px; }
.hint { font-size: 12px; color: var(--cd-secondary); line-height: 1.5; white-space: pre-line; }
.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--cd-secondary); margin-top: 6px; }
.row-card { border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg); padding: 10px 12px; display: grid; gap: 10px; }
.row-head { display: flex; align-items: center; gap: 6px; }
.row-head .row-title { flex: 1; font-weight: 600; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fields { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.field { display: grid; gap: 6px; font-size: 12px; color: var(--cd-secondary); min-width: 0; position: relative; }
.field:has([data-open]), .row-card:has([data-open]), .channel-card:has([data-open]) { position: relative; z-index: 100; }
.field-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 22px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--cd-secondary); white-space: nowrap; }
.field > input[type=text], .field > input[type=number], .field > select, .field > input:not([type]) {
  height: 40px; border-radius: 12px; border: 1px solid rgba(128,128,128,.3); padding: 0 10px; font: inherit; font-size: 13px;
  background: var(--cd-card); color: var(--primary-text-color, #fff); min-width: 0; width: 100%; outline: none; transition: border-color .2s;
}
.field > input[type=text]:focus, .field > input[type=number]:focus, .field > select:focus { border-color: var(--cd-accent); }
.field input[type=color] { height: 38px; width: 100%; border: 1px solid rgba(128,128,128,.3); border-radius: 10px; background: var(--cd-card); padding: 2px; }
.field.check { grid-auto-flow: column; justify-content: start; align-items: center; gap: 8px; height: 38px; color: var(--primary-text-color, #fff); font-size: 14px; }
.user-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.user-chip {
  border: 1px solid rgba(128,128,128,.35); background: transparent; border-radius: 16px; padding: 4px 12px; cursor: pointer; font-size: 13px; color: var(--primary-text-color, #fff);
}
.user-chip[data-on] { background: var(--cd-accent); border-color: var(--cd-accent); color: #fff; }
.btn {
  height: 40px; padding: 0 18px; border-radius: 20px; border: 0; cursor: pointer; font-weight: 600; background: var(--cd-tile-bg);
  display: inline-flex; align-items: center; gap: 6px;
}
.btn.primary { background: var(--cd-accent); color: #fff; }
.btn.success { background: var(--success-color, #43a047); color: #fff; }
.btn.danger { color: #f44336; }
.btn:disabled { opacity: .5; cursor: default; }

/* ── Wizard ── */
.wizard-steps { flex-shrink: 0; display: flex; gap: 8px; padding: 12px 20px 8px; border-bottom: 1px solid rgba(128,128,128,.18); }
.wizard-step { flex: 1; display: grid; gap: 4px; font-size: 11px; font-weight: 600; color: var(--cd-secondary); }
.wizard-step[data-active] { color: var(--primary-text-color, #fff); }
.wizard-step[data-done] { color: var(--success-color, #43a047); }
.wizard-bar { height: 4px; border-radius: 2px; background: rgba(128,128,128,.2); transition: background .3s; }
.wizard-step[data-active] .wizard-bar { background: var(--cd-accent); }
.wizard-step[data-done] .wizard-bar { background: var(--success-color, #43a047); }
.device-list { display: grid; gap: 8px; max-height: 520px; overflow-y: auto; }
.device-card {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px;
  background: var(--cd-tile-bg); cursor: pointer; border: 1px solid transparent; transition: border-color .2s, background .2s;
}
.device-card:hover { background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }
.device-card[data-selected] { border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
.device-card .d-icon {
  width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(128,128,128,.18); color: var(--cd-accent); flex: none;
}
.device-card .d-info { flex: 1; min-width: 0; }
.device-card .d-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-card .d-meta { font-size: 12px; color: var(--cd-secondary); display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(135px, 1fr)); gap: 8px; }
.cat-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; border-radius: 12px;
  background: var(--cd-tile-bg); border: 1px solid transparent; cursor: pointer; text-align: center; font-size: 12px; font-weight: 600;
  transition: transform .15s, border-color .15s, background .15s;
}
.cat-card:hover { transform: translateY(-2px); }
.cat-card[data-selected] { border-color: var(--cat-color, var(--cd-accent)); background: color-mix(in srgb, var(--cat-color, var(--cd-accent)) 16%, transparent); }
.cat-card ha-icon { --mdc-icon-size: 28px; color: var(--cat-color, var(--cd-accent)); }
.badge-tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
  background: rgba(128,128,128,.2); color: var(--cd-secondary);
}
.badge-tag.ok { background: rgba(67, 160, 71, .2); color: #81c784; }
.badge-tag.area { background: rgba(3, 169, 244, .18); color: #4fc3f7; }
.badge-tag.category {
  background: color-mix(in srgb, var(--badge-cat-color, var(--cd-accent)) 16%, transparent);
  color: var(--badge-cat-color, var(--cd-accent));
  border: 1px solid color-mix(in srgb, var(--badge-cat-color, var(--cd-accent)) 25%, transparent);
}
.badge-tag.category ha-icon {
  --mdc-icon-size: 14px;
  color: var(--badge-cat-color, var(--cd-accent));
}
.channel-card {
  border-radius: 12px; background: var(--cd-tile-bg); padding: 10px 14px; display: grid; gap: 10px;
}
.channel-head { display: flex; align-items: center; gap: 10px; }
.channel-head .ch-title { flex: 1; font-weight: 600; font-size: 14px; }
.search-bar {
  display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 40px; border-radius: 12px;
  background: var(--cd-card); border: 1px solid rgba(128,128,128,.3);
}
.search-bar input { flex: 1; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.filter-chip {
  padding: 4px 12px; border-radius: 14px; border: 1px solid rgba(128,128,128,.3); background: transparent;
  color: var(--cd-secondary); cursor: pointer; font-size: 12px; font-weight: 500;
}
.filter-chip[data-active] { background: var(--cd-accent); color: #fff; border-color: var(--cd-accent); }

details.sub { border-radius: 10px; background: rgba(128,128,128,.08); padding: 6px 10px; }
details.sub summary { cursor: pointer; font-size: 13px; font-weight: 600; padding: 4px 0; }
.sub-tile { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid rgba(128,128,128,.12); font-size: 13px; }
.sub-tile .st-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-tile .st-id { color: var(--cd-secondary); font-size: 11px; }
.sub-tile[data-hidden] .st-name { opacity: .45; text-decoration: line-through; }
.toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 30; background: #323232; color: #fff; padding: 10px 18px; border-radius: 20px; font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }

/* ── Entity Picker ── */
.entity-picker { position: relative; width: 100%; font-size: 13px; }
.ep-box {
  display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 4px 10px;
  border-radius: 10px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  cursor: pointer; transition: border-color .2s, box-shadow .2s; outline: none;
}
.ep-box:hover { border-color: var(--cd-accent); }
.ep-box[data-open] { border-color: var(--cd-accent); box-shadow: 0 0 0 1px var(--cd-accent); }
.ep-icon { flex: none; color: var(--cd-accent); display: grid; place-items: center; }
.ep-content { flex: 1; min-width: 0; display: grid; gap: 1px; }
.ep-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color, #fff); }
.ep-sub { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-placeholder { color: var(--cd-secondary); font-size: 13px; }
.ep-clear { border: 0; background: transparent; cursor: pointer; color: var(--cd-secondary); padding: 4px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.ep-clear:hover { color: var(--primary-text-color, #fff); background: rgba(128,128,128,.2); }
.ep-chevron { flex: none; color: var(--cd-secondary); transition: transform .2s ease; }
.ep-box[data-open] .ep-chevron { transform: rotate(180deg); }
.ep-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60;
  border-radius: 12px; background: var(--cd-card); border: 1px solid rgba(128,128,128,.3);
  box-shadow: 0 8px 32px rgba(0,0,0,.6); display: flex; flex-direction: column; overflow: hidden;
}
.ep-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid rgba(128,128,128,.15); background: var(--cd-tile-bg);
}
.ep-search input {
  flex: 1; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none;
}
.ep-chips { display: flex; gap: 6px; padding: 6px 10px; overflow-x: auto; background: var(--cd-tile-bg); border-bottom: 1px solid rgba(128,128,128,.12); }
.ep-list { max-height: 240px; overflow-y: auto; display: grid; }
.ep-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer;
  border-bottom: 1px solid rgba(128,128,128,.06); transition: background .15s; outline: none;
}
.ep-item:hover, .ep-item:focus { background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
.ep-item[data-active] { background: color-mix(in srgb, var(--cd-accent) 22%, transparent); }
.ep-item .item-state { flex: none; font-size: 11px; color: var(--cd-secondary); background: rgba(128,128,128,.15); padding: 2px 6px; border-radius: 6px; }
.ep-check { flex: none; color: var(--cd-accent); }

/* ── Color Picker ── */
.color-picker { position: relative; width: 100%; }
.cp-box {
  display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px;
  border-radius: 12px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  color: inherit; width: 100%; cursor: pointer; text-align: left; font-size: 13px;
  transition: border-color .2s; outline: none;
}
.cp-box:hover, .cp-box[data-open] { border-color: var(--cd-accent); }
.cp-dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.25); flex-shrink: 0; }
.cp-label { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-chevron { flex-shrink: 0; color: var(--cd-secondary); transition: transform .2s ease; }
.cp-box[data-open] .cp-chevron { transform: rotate(180deg); }
.cp-dropdown {
  position: absolute; top: calc(100% + 4px); right: 0; width: max(100%, 250px); max-width: 85vw; z-index: 90;
  border-radius: 14px; background: var(--cd-card); border: 1px solid rgba(128,128,128,.3);
  box-shadow: 0 12px 36px rgba(0,0,0,.6); max-height: 260px; overflow-y: auto; padding: 6px;
}
.cp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.cp-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px;
  cursor: pointer; transition: background .15s; font-size: 13px;
}
.cp-item:hover { background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
.cp-item[data-active] { background: color-mix(in srgb, var(--cd-accent) 22%, transparent); font-weight: 600; }
.cp-opt-name { flex: 1; }
.cp-check { margin-left: auto; color: var(--cd-accent); }

/* ── Icon Picker ── */
.icon-picker { position: relative; width: 100%; }
.ip-box {
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 2px 6px 2px 8px;
  border-radius: 12px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  transition: border-color .2s;
}
.ip-box:hover, .ip-box[data-open] { border-color: var(--cd-accent); }
.ip-preview {
  width: 30px; height: 30px; border-radius: 8px; background: var(--cd-tile-bg);
  display: grid; place-items: center; color: var(--cd-accent); flex-shrink: 0;
}
.ip-input { flex: 1; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none; min-width: 0; }
.ip-toggle {
  width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent;
  cursor: pointer; color: var(--cd-secondary); display: grid; place-items: center;
}
.ip-toggle:hover { background: var(--cd-tile-bg); color: #fff; }
.ip-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 90;
  border-radius: 14px; background: var(--cd-card); border: 1px solid rgba(128,128,128,.3);
  box-shadow: 0 12px 36px rgba(0,0,0,.6); max-height: 280px; display: flex; flex-direction: column; overflow: hidden;
}
.ip-search-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--cd-tile-bg); border-bottom: 1px solid rgba(128,128,128,.15);
}
.ip-search-input { flex: 1; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none; }
.ip-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px;
  padding: 8px; overflow-y: auto; max-height: 220px;
}
.ip-chip {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px;
  border-radius: 10px; border: 1px solid transparent; background: var(--cd-tile-bg);
  color: inherit; cursor: pointer; text-align: center; font-size: 11px;
  transition: transform .12s, border-color .12s, background .12s;
}
.ip-chip:hover { transform: translateY(-2px); border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
.ip-chip.active { border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 22%, transparent); font-weight: 600; }
.ip-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70px; }
.ip-empty { padding: 20px 12px; text-align: center; color: var(--cd-secondary); font-size: 12px; }

/* ── Trash preview box ── */
.trash-preview-box {
  display: flex; align-items: center; justify-content: center; height: 50px;
  border-radius: 12px; background: var(--cd-tile-bg);
}

/* ── Grouped Cover & Room Subview ── */
.tile.grouped-cover {
  --tile-color: #9c27b0;
}
.tile.grouped-cover .tile-icon {
  color: #9c27b0;
  background: rgba(156, 39, 176, 0.18);
  background: color-mix(in srgb, #9c27b0 18%, transparent);
}
.tile.grouped-cover .tile-state {
  color: #ce93d8;
  font-weight: 500;
}

.room-detail-page {
  display: flex; flex-direction: column; gap: 16px;
  width: 100%; max-width: 980px; margin: 0 auto; padding: 0 4px 40px;
  animation: cdFadeIn 0.2s ease-out;
}
@keyframes cdFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.room-detail-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 16px; border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
}
.room-detail-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.room-detail-back {
  display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px 0 10px;
  border-radius: 19px; border: 0; cursor: pointer; background: var(--cd-tile-bg);
  color: var(--primary-text-color, #fff); font-weight: 600; font-size: 13px;
  transition: transform .12s, background .15s;
}
.room-detail-back:active { transform: scale(0.96); }
.room-detail-title-wrap { display: flex; align-items: center; gap: 10px; }
.room-detail-title-wrap .icon {
  width: 40px; height: 40px; border-radius: 12px; background: rgba(128,128,128,.15);
  display: grid; place-items: center; color: var(--cd-accent);
}
.room-detail-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--primary-text-color, #fff); }
.room-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.room-detail-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px;
  border-radius: 15px; background: var(--cd-tile-bg); font-size: 12px; font-weight: 600;
  color: var(--primary-text-color, #fff);
}
.room-detail-chip ha-icon { --mdc-icon-size: 16px; }

.room-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.room-detail-body {
  display: grid; gap: 8px; padding: 8px;
  border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 2px 14px rgba(0,0,0,.25);
}
.room-detail-body .tile-grid { padding: 0; gap: 8px; }
.cover-detail-list { display: grid; gap: 8px; }

.cover-detail-row {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px; border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg);
  transition: background .15s;
}
.cover-detail-top {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0;
}
.cover-detail-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.cover-detail-icon {
  width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none;
  color: #9c27b0; background: rgba(156, 39, 176, 0.18);
}
.cover-detail-texts { min-width: 0; }
.cover-detail-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cover-detail-state { font-size: 12px; color: #ce93d8; font-weight: 500; }
.cover-slider-wrap {
  display: flex; align-items: center; gap: 10px; padding: 0 4px;
}
.cover-slider-label { font-size: 11px; color: var(--cd-secondary); font-weight: 600; min-width: 26px; }
.cover-slider-wrap input[type=range].slider {
  --tile-color: #9c27b0;
  height: 24px;
  border-radius: 12px;
  box-sizing: border-box;
  padding: 0 7px;
}
.cover-slider-wrap input[type=range].slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 5px;
  height: 14px;
  background-color: #fff;
  border-radius: 999px;
  border: 0;
  box-shadow: 0 0 2px rgba(0,0,0,.5);
}
.cover-slider-wrap input[type=range].slider::-moz-range-thumb {
  width: 5px;
  height: 14px;
  background-color: #fff;
  border-radius: 999px;
  border: 0;
  box-shadow: 0 0 2px rgba(0,0,0,.5);
}

/* ── Custom Dropdown (No native browser <select>) ── */
.custom-dropdown { position: relative; width: 100%; font-size: 13px; }
.cdd-box {
  display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 4px 12px;
  border-radius: 10px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  cursor: pointer; transition: border-color .2s, box-shadow .2s; outline: none; user-select: none;
}
.cdd-box:hover:not(.disabled) { border-color: var(--cd-accent); }
.cdd-box[data-open] { border-color: var(--cd-accent); box-shadow: 0 0 0 1px var(--cd-accent); }
.cdd-box.disabled { opacity: .5; cursor: default; }
.cdd-icon { flex: none; display: grid; place-items: center; font-size: 18px; }
.cdd-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.cdd-text { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdd-text.placeholder { color: var(--cd-secondary); }
.cdd-chevron { flex: none; color: var(--cd-secondary); transition: transform .2s ease; }
.cdd-box[data-open] .cdd-chevron { transform: rotate(180deg); }
.cdd-menu {
  position: absolute; z-index: 120; left: 0; right: 0; top: calc(100% + 4px);
  background: var(--cd-card); border-radius: 12px; border: 1px solid rgba(128,128,128,.25);
  box-shadow: 0 14px 40px rgba(0,0,0,.65); max-height: 280px; display: flex; flex-direction: column; overflow: hidden;
  animation: cddSlideDown .15s ease-out;
}
@keyframes cddSlideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.cdd-search-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--cd-tile-bg); border-bottom: 1px solid rgba(128,128,128,.15);
}
.cdd-search-input { flex: 1; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none; }
.cdd-list { overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.cdd-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
  cursor: pointer; transition: background .12s; user-select: none;
}
.cdd-item:hover { background: rgba(128,128,128,.15); }
.cdd-item.selected { background: color-mix(in srgb, var(--cd-accent) 18%, transparent); }
.cdd-item-texts { flex: 1; min-width: 0; }
.cdd-item-label { font-size: 13px; font-weight: 600; color: var(--primary-text-color, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdd-item-sub { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdd-item-check { color: var(--cd-accent); flex: none; font-size: 16px; }
.cdd-empty { padding: 16px 12px; text-align: center; color: var(--cd-secondary); font-size: 12px; }

/* ── Windows 11 OOBE Setup Styling & Animations ── */
.win11-hero-badge {
  width: 60px; height: 60px; border-radius: 50%; margin: 4px auto 14px;
  display: grid; place-items: center;
  background: radial-gradient(circle, color-mix(in srgb, var(--hero-color, var(--cd-accent)) 28%, transparent) 0%, color-mix(in srgb, var(--hero-color, var(--cd-accent)) 6%, transparent) 70%);
  box-shadow: 0 0 24px color-mix(in srgb, var(--hero-color, var(--cd-accent)) 40%, transparent);
  color: var(--hero-color, var(--cd-accent));
  animation: win11GlowPulse 3.5s infinite ease-in-out;
}
.win11-hero-badge ha-icon {
  --mdc-icon-size: 32px; width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit; fill: currentColor;
}
@keyframes win11GlowPulse {
  0%, 100% { box-shadow: 0 0 16px color-mix(in srgb, var(--hero-color, var(--cd-accent)) 25%, transparent); }
  50% { box-shadow: 0 0 34px color-mix(in srgb, var(--hero-color, var(--cd-accent)) 65%, transparent); }
}
@keyframes win11SuccessGlow {
  0%, 100% { box-shadow: 0 0 18px rgba(16,185,129,0.3); }
  50% { box-shadow: 0 0 36px rgba(16,185,129,0.65); }
}
@keyframes win11Pop {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

/* ── Interactive Feature Cards (Anwesenheitssimulation & Leistung) ── */
.feature-card {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px;
  background: var(--cd-tile-bg); border: 1px solid rgba(128,128,128,.18); cursor: pointer;
  transition: background .15s, border-color .15s, transform .1s;
}
.feature-card:hover { border-color: rgba(255,255,255,.25); }
.feature-card[data-active] {
  border-color: var(--feat-color, var(--cd-accent));
  background: color-mix(in srgb, var(--feat-color, var(--cd-accent)) 12%, var(--cd-tile-bg));
}
.feature-icon {
  width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; flex: none;
  color: var(--feat-color, var(--cd-accent));
  background: color-mix(in srgb, var(--feat-color, var(--cd-accent)) 18%, transparent);
}
.feature-info { flex: 1; min-width: 0; }
.feature-title { font-size: 13px; font-weight: 600; color: var(--primary-text-color, #fff); }
.feature-desc { font-size: 11px; color: var(--cd-secondary); margin-top: 2px; line-height: 1.3; }

/* ── Switch UI Toggle ── */
.switch-ui {
  position: relative; width: 44px; height: 24px; border-radius: 12px;
  background: rgba(128,128,128,.35); flex: none; transition: background .2s;
}
.switch-ui::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 50%; background: #fff; transition: transform .2s cubic-bezier(.4, 0, .2, 1);
  box-shadow: 0 2px 4px rgba(0,0,0,.3);
}
.feature-card[data-active] .switch-ui {
  background: var(--feat-color, var(--cd-accent));
}
.feature-card[data-active] .switch-ui::after {
  transform: translateX(20px);
}

/* ── Wizard Endscreen Preview & Celebration ── */
.win11-preview-card {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 14px;
  background: var(--cd-tile-bg); border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 6px 20px rgba(0,0,0,.35);
}
.win11-preview-icon {
  width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none;
  color: var(--preview-color, var(--cd-accent));
  background: color-mix(in srgb, var(--preview-color, var(--cd-accent)) 20%, transparent);
}
.win11-preview-info { flex: 1; min-width: 0; }
.win11-preview-name { font-size: 15px; font-weight: 700; color: var(--primary-text-color, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win11-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

.win11-celebration {
  text-align: center; padding: 40px 24px 32px; display: flex; flex-direction: column; align-items: center; gap: 14px;
  animation: win11Pop .35s cubic-bezier(.2, .9, .3, 1);
  background: radial-gradient(circle at center, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0.05) 60%, transparent 100%);
  border-radius: 16px; border: 1px solid rgba(16, 185, 129, 0.3);
  margin: 12px auto; max-width: 600px;
}
.win11-success-badge {
  width: 68px; height: 68px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0.12) 70%);
  color: #10b981; box-shadow: 0 0 32px rgba(16,185,129,0.55);
  animation: win11SuccessGlow 3s infinite ease-in-out;
}
.win11-success-badge ha-icon { --mdc-icon-size: 38px; }

/* ── Advanced options details ── */
details.adv-options {
  border-radius: 12px; background: rgba(128,128,128,.08); padding: 8px 14px; margin-top: 10px;
  border: 1px solid rgba(128,128,128,.15);
}
details.adv-options summary {
  cursor: pointer; font-size: 13px; font-weight: 600; color: var(--cd-secondary); user-select: none;
  display: flex; align-items: center; gap: 6px;
}
details.adv-options summary:hover { color: var(--primary-text-color, #fff); }
.adv-content { margin-top: 10px; display: grid; gap: 8px; }

.btn.danger {
  background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.3);
}
.btn.danger:hover {
  background: rgba(244, 67, 54, 0.25);
}
.icon-btn.danger {
  color: #f44336; background: rgba(244, 67, 54, 0.1); border-radius: 8px;
}
.icon-btn.danger:hover {
  background: rgba(244, 67, 54, 0.22);
}


`;
