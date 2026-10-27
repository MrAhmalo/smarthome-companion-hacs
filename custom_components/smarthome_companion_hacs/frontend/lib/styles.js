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
.rooms { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); align-items: start; }

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
.room-title { flex: 1; min-width: 0; }
.room-name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.room-meta { display: flex; gap: 10px; font-size: 12px; color: var(--cd-secondary); min-height: 16px; }
.room-meta span { display: inline-flex; align-items: center; gap: 3px; }
.room-meta ha-icon { --mdc-icon-size: 14px; }
.room-meta .alert { color: var(--cd-active); font-weight: 600; }
.room-controls { display: flex; gap: 6px; }
.ctrl-btn {
  position: relative; width: 38px; height: 38px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; background: var(--cd-tile-bg); color: var(--cd-secondary);
}
.ctrl-btn[data-on] { color: var(--cd-active); background: rgba(255, 193, 7, 0.18); background: color-mix(in srgb, var(--cd-active) 18%, transparent); }
.ctrl-btn .count {
  position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px;
  background: var(--cd-active); color: #000; font-size: 10px; font-weight: 700; display: grid; place-items: center;
}
.chevron { flex: none; color: var(--cd-secondary); transition: transform .28s ease; }
.room[data-open] .chevron { transform: rotate(180deg); }
.room[data-always] .chevron { display: none; }
.room-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s ease; }
.room[data-open] .room-body { grid-template-rows: 1fr; }
.room-body-inner { overflow: hidden; min-height: 0; }
.tile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 8px 10px; }
@media (max-width: 420px) { .tile-grid { grid-template-columns: minmax(0, 1fr); } }

/* ── Tiles ── */
.tile {
  --tile-color: var(--cd-active);
  display: grid; gap: 8px; padding: 8px 10px 8px 8px; min-width: 0; border-radius: 14px;
  background: var(--cd-tile-bg); transition: background .2s, opacity .2s;
}
.tile.wide { grid-column: span 2; }
@media (max-width: 420px) { .tile.wide { grid-column: span 1; } }
.tile[data-active="false"] { --tile-color: var(--cd-secondary); }
.tile[data-unavailable] { opacity: .5; }
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
.tile-feature { display: flex; align-items: center; gap: 10px; padding: 0 2px 2px; }
.tile-feature[hidden] { display: none; }
.swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); cursor: pointer; flex: none; padding: 0; }
.swatch:active { transform: scale(0.9); }
input[type=range].slider {
  -webkit-appearance: none; appearance: none; flex: 1; min-width: 60px; height: 28px; border-radius: 14px; outline: none; cursor: pointer;
  background: linear-gradient(to right, var(--tile-color) var(--val, 0%), rgba(128,128,128,.25) var(--val, 0%));
}
input[type=range].slider::-webkit-slider-thumb { -webkit-appearance: none; width: 6px; height: 18px; border-radius: 3px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
input[type=range].slider::-moz-range-thumb { width: 6px; height: 18px; border: 0; border-radius: 3px; background: #fff; }

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
.stack { display: grid; gap: 0; }
.stack > * + * { border-top: 1px solid rgba(128,128,128,.12); }
.stack-row { padding: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bins { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
.bin {
  position: relative; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 14px;
  background: var(--cd-tile-bg); overflow: hidden;
}
.bin img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.8); }
.bin ha-icon { --mdc-icon-size: 34px; }
.bin .when {
  position: absolute; bottom: 3px; right: 3px; min-width: 20px; height: 20px; border-radius: 10px; padding: 0 6px;
  background: rgba(0,0,0,.65); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center;
}
.bin .when.today { background: #f44336; }
.trash-empty { font-size: 12px; color: var(--cd-secondary); padding: 6px; }
.person {
  display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; border-radius: 14px; background: var(--cd-tile-bg);
}
.person .avatar { width: 40px; height: 40px; border-radius: 50%; background: rgba(128,128,128,.25) center/cover no-repeat; display: grid; place-items: center; }
.person .p-name { font-weight: 600; font-size: 14px; }
.person .p-state { font-size: 12px; color: var(--cd-secondary); }
.chips { display: flex; gap: 8px; justify-content: center; padding: 6px 8px 8px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 8px; border-radius: 16px; background: var(--cd-tile-bg); font-size: 13px; cursor: pointer; }
.chip ha-icon { --mdc-icon-size: 18px; }
.full-tile { display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; }

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
.overlay { position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.55); display: grid; place-items: center; padding: 12px; }
.dialog {
  width: min(980px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: var(--cd-radius);
  background: var(--cd-card); box-shadow: 0 12px 48px rgba(0,0,0,.5); overflow: hidden;
}
.dialog-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 20px; border-bottom: 1px solid rgba(128,128,128,.18); }
.dialog-head h2 { flex: 1; margin: 0; font-size: 18px; }
.tabs { display: flex; gap: 4px; padding: 8px 12px 0; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid rgba(128,128,128,.18); }
.tab { border: 0; background: transparent; cursor: pointer; padding: 10px 14px; border-radius: 10px 10px 0 0; font-weight: 600; color: var(--cd-secondary); white-space: nowrap; }
.tab[data-active] { color: var(--cd-accent); box-shadow: inset 0 -2px 0 var(--cd-accent); }
.dialog-body { overflow-y: auto; padding: 16px 20px; display: grid; gap: 14px; align-content: start; }
.dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid rgba(128,128,128,.18); }
.hint { font-size: 12px; color: var(--cd-secondary); line-height: 1.5; white-space: pre-line; }
.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--cd-secondary); margin-top: 6px; }
.row-card { border-radius: 14px; background: var(--cd-tile-bg); padding: 10px 12px; display: grid; gap: 10px; }
.row-head { display: flex; align-items: center; gap: 6px; }
.row-head .row-title { flex: 1; font-weight: 600; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.field { display: grid; gap: 4px; font-size: 12px; color: var(--cd-secondary); min-width: 0; }
.field input[type=text], .field input[type=number], .field select, .field input:not([type]) {
  height: 38px; border-radius: 10px; border: 1px solid rgba(128,128,128,.3); padding: 0 10px; font: inherit; font-size: 14px;
  background: var(--cd-card); color: var(--primary-text-color, #fff); min-width: 0; width: 100%;
}
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
.btn.danger { color: #f44336; }
.btn:disabled { opacity: .5; cursor: default; }
details.sub { border-radius: 10px; background: rgba(128,128,128,.08); padding: 6px 10px; }
details.sub summary { cursor: pointer; font-size: 13px; font-weight: 600; padding: 4px 0; }
.sub-tile { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid rgba(128,128,128,.12); font-size: 13px; }
.sub-tile .st-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-tile .st-id { color: var(--cd-secondary); font-size: 11px; }
.sub-tile[data-hidden] .st-name { opacity: .45; text-decoration: line-through; }
.toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 30; background: #323232; color: #fff; padding: 10px 18px; border-radius: 20px; font-size: 14px; }
`;
