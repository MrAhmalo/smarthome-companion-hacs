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
  --cd-text: var(--primary-text-color, #e6e6e6);
  --cd-border: rgba(128, 128, 128, 0.22);
  --cd-accent: var(--primary-color, #03a9f4);
  --cd-tile-bg: rgba(128, 128, 128, 0.12);
  --cd-tile-bg: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent);
  --cd-active: var(--state-active-color, #ffc107);
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --cd-scale: 1;
  --cd-pad-scale: 1;
}
:host([data-scale="small"]) { --cd-scale: 0.88; --cd-pad-scale: 0.86; }
:host([data-scale="medium"]) { --cd-scale: 1; --cd-pad-scale: 1; }
:host([data-scale="large"]) { --cd-scale: 1.14; --cd-pad-scale: 1.12; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
ha-icon { --mdc-icon-size: calc(22px * var(--cd-scale)); display: inline-flex; align-items: center; justify-content: center; }
@keyframes cdSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
ha-icon[icon="mdi:loading"], .spin {
  animation: cdSpin 0.9s linear infinite;
  transform-origin: center;
}
button { font: inherit; color: inherit; touch-action: manipulation; }

.page {
  max-width: 1680px;
  margin: 0 auto;
  padding: var(--safe-top) calc(16px + var(--safe-right)) calc(96px + var(--safe-bottom)) calc(16px + var(--safe-left));
  overflow-x: clip;
  container-type: inline-size;
  container-name: cdpage;
}
:host([data-lovelace]) .page {
  padding-top: 2px;
}

/* ── Toolbar / header ── */
.cd-sticky-header {
  position: sticky;
  top: var(--safe-top, 0px);
  z-index: 40;
  background: color-mix(in srgb, var(--primary-background-color, #111) 90%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  margin: 0 calc(-16px - var(--safe-right)) 4px calc(-16px - var(--safe-left));
  padding: 0 calc(16px + var(--safe-right)) 0 calc(16px + var(--safe-left));
}
.cd-sticky-header[hidden],
.cd-sticky-header:not(:has(.toolbar:not([hidden]), .edit-mode-banner)) {
  display: none !important;
}
.icon-btn[data-portaled] { display: none !important; }
.toolbar { display: flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 2px; min-width: 0; }
.toolbar:not(:has(> button:not([hidden]))) { display: none; }
.toolbar .spacer { flex: 1; min-width: 8px; }
.icon-btn {
  width: 44px; height: 44px; min-width: 44px; min-height: 44px; flex: none;
  border-radius: 50%; border: 0; background: transparent; cursor: pointer;
  display: grid; place-items: center; color: var(--primary-text-color, #fff); position: relative;
}
@media (hover: hover) {
  .icon-btn:hover { background: var(--cd-tile-bg); }
}
.icon-btn.edit-btn-active,
.icon-btn[data-active] {
  background: var(--cd-accent, #0284c7) !important;
  color: #fff !important;
  box-shadow: 0 0 12px rgba(2, 132, 199, 0.5) !important;
  box-shadow: 0 0 12px color-mix(in srgb, var(--cd-accent, #0284c7) 80%, transparent) !important;
}
.edit-mode-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; margin: 4px 0 14px; border-radius: 12px;
  background: rgba(2, 132, 199, 0.16);
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
  padding: 6px 14px; min-height: 36px; border-radius: 18px; border: 0;
  background: var(--cd-accent, #0284c7); color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer; flex: none;
  transition: transform .1s, opacity .15s;
}
.edit-mode-banner-btn:active { transform: scale(0.95); }
.page[data-edit-mode] .tile,
.page[data-edit-mode] .cover-detail-row,
.page[data-edit-mode] .room-head {
  cursor: grab !important;
  position: relative !important;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.page[data-edit-mode] .tile[data-dragging],
.tile-drag-slot {
  cursor: grabbing !important;
  touch-action: none;
}
.tile-drag-slot {
  opacity: 0.35 !important;
  outline: 2px dashed var(--cd-accent) !important;
  outline-offset: -2px;
  background: color-mix(in srgb, var(--cd-accent) 10%, transparent) !important;
  pointer-events: none !important;
}
.tile-drag-slot > * {
  opacity: 0.35;
}
.tile-drag-ghost {
  position: fixed !important;
  margin: 0 !important;
  z-index: 9999 !important;
  pointer-events: none !important;
  box-shadow: 0 18px 42px rgba(0,0,0,.52), 0 0 0 2px var(--cd-accent) !important;
  opacity: 0.96 !important;
  transform: scale(1.02);
  transform-origin: center;
  transition: none !important;
  border-radius: var(--cd-tile-radius, 14px);
}
.room[data-drop-room] {
  outline: 2px solid color-mix(in srgb, var(--cd-accent) 75%, transparent) !important;
  outline-offset: -2px;
  background: color-mix(in srgb, var(--cd-accent) 6%, var(--cd-card-bg, rgba(255,255,255,.04))) !important;
}
.edit-march-svg {
  display: none;
  position: absolute;
  inset: 3px;
  width: calc(100% - 6px);
  height: calc(100% - 6px);
  overflow: visible;
  pointer-events: none;
  z-index: 2;
}
.room-head > .edit-march-svg {
  inset: 4px;
  width: calc(100% - 8px);
  height: calc(100% - 8px);
}
.page[data-edit-mode] .edit-march-svg {
  display: block;
}
.edit-march-svg rect {
  fill: none;
  stroke: var(--cd-accent);
  stroke-width: 2px;
  stroke-dasharray: 8 6;
}
@keyframes cdEditMarch {
  to { stroke-dashoffset: -28; }
}
@media (hover: hover) {
  .page[data-edit-mode] .tile:hover:not(:has(.tile:hover)) > .edit-march-svg rect,
  .page[data-edit-mode] .cover-detail-row:hover > .edit-march-svg rect,
  .page[data-edit-mode] .room-head:hover > .edit-march-svg rect {
    animation: cdEditMarch 0.8s linear infinite;
  }
}
.device-room-section { margin-top: 14px; }
.device-room-section:first-child { margin-top: 2px; }
.device-room-header {
  display: flex; align-items: center; gap: 8px; padding: 6px 4px 8px;
  font-size: 14px; font-weight: 700; letter-spacing: 0.1px;
  color: var(--primary-text-color, inherit);
  border-bottom: 1px solid rgba(128, 128, 128, .22); margin-bottom: 8px;
}
.device-room-header ha-icon { color: var(--cd-accent); --mdc-icon-size: 18px; flex: none; }
.device-room-header .room-count { font-size: 12px; font-weight: 500; color: var(--cd-secondary); }
.greeting { text-align: center; margin: 0 0 calc(10px * var(--cd-pad-scale)); }
.greeting h1 { margin: 0; font-size: calc(24px * var(--cd-scale)); font-weight: 600; letter-spacing: -0.3px; }
.badges {
  display: flex; gap: calc(8px * var(--cd-pad-scale)); overflow-x: auto; justify-content: center; flex-wrap: wrap;
  padding: calc(4px * var(--cd-pad-scale)) 0 calc(14px * var(--cd-pad-scale)); scrollbar-width: none;
}
.badges:not(:has(> :not([hidden]))) { display: none; }
.badge {
  display: inline-flex; align-items: center; gap: calc(6px * var(--cd-pad-scale)); min-height: calc(38px * var(--cd-scale));
  padding: 0 calc(14px * var(--cd-pad-scale)) 0 calc(10px * var(--cd-pad-scale));
  border-radius: 999px; background: var(--cd-card); cursor: pointer; border: 0; white-space: nowrap;
  font-size: calc(14px * var(--cd-scale)); font-weight: 500; --badge-color: var(--cd-accent); position: relative;
}
.badge::after { content: ''; position: absolute; inset: -3px 0; }
.badge ha-icon { --mdc-icon-size: calc(20px * var(--cd-scale)); color: var(--badge-color); }
.badge .badge-name { color: var(--cd-secondary); font-weight: 400; }
.badge:active { transform: scale(0.97); }

/* ── Layout ── */
.layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
@container cdpage (min-width: 960px) {
  .layout.has-side { grid-template-columns: minmax(290px, 350px) minmax(0, 1fr); }
  .layout.has-side:not(:has(.side > :not([hidden]))) { grid-template-columns: minmax(0, 1fr); }
  .layout.has-side:not(:has(.side > :not([hidden]))) .side { display: none; }
}
.side, .main { display: grid; gap: 12px; min-width: 0; align-content: start; }
.rooms {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; min-width: 0;
}
.room-col {
  flex: 1 1 320px; max-width: 460px; min-width: min(100%, 280px);
  display: flex; flex-direction: column; gap: 12px;
}

/* ── Cards ── */
.card { background: var(--cd-card); border-radius: var(--cd-radius); overflow: hidden; }
.empty { text-align: center; color: var(--cd-secondary); padding: 48px 16px; }
.empty ha-icon { --mdc-icon-size: 48px; opacity: .5; }

/* ── Room (expander) ── */
.room-head { display: flex; align-items: center; gap: calc(10px * var(--cd-pad-scale)); padding: calc(10px * var(--cd-pad-scale)); min-height: calc(40px * var(--cd-scale)); cursor: pointer; user-select: none; position: relative; touch-action: manipulation; }
.room-icon {
  flex: none; width: calc(40px * var(--cd-scale)); height: calc(40px * var(--cd-scale)); border-radius: 50%; display: grid; place-items: center;
  color: var(--cd-accent); background: rgba(3, 169, 244, 0.15);
  background: color-mix(in srgb, var(--cd-accent) 16%, transparent);
}
.room-title { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.room-name { font-size: calc(16px * var(--cd-scale)); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
.room-controls { display: flex; gap: calc(6px * var(--cd-pad-scale)); flex-shrink: 0; }
.ctrl-btn {
  position: relative; width: calc(38px * var(--cd-scale)); height: calc(38px * var(--cd-scale)); border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; background: var(--cd-tile-bg); color: var(--cd-secondary);
  transition: transform .15s, background .15s, color .15s; touch-action: manipulation;
}
.ctrl-btn::after { content: ''; position: absolute; inset: -3px; }
.ctrl-btn[data-on] {
  color: var(--group-color, var(--cd-active));
  background: rgba(255, 193, 7, 0.16);
  background: color-mix(in srgb, var(--group-color, var(--cd-active)) 18%, transparent);
}
.chevron {
  flex: none; width: calc(38px * var(--cd-scale)); height: calc(38px * var(--cd-scale)); border-radius: 50%;
  display: grid; place-items: center;
  background: var(--cd-tile-bg); color: var(--cd-secondary);
  transition: transform .28s cubic-bezier(0.22, 1, 0.36, 1);
}
.room[data-open] .chevron { transform: rotate(180deg); }
.room[data-always] .chevron { display: none; }
.room-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s ease; }
.room[data-open] .room-body { grid-template-rows: 1fr; }
.room-body-inner { overflow: hidden; min-height: 0; }
.tile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(8px * var(--cd-pad-scale)); padding: calc(2px * var(--cd-pad-scale)) calc(10px * var(--cd-pad-scale)) calc(10px * var(--cd-pad-scale)); min-width: 0; width: 100%; }
.room-status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(6px * var(--cd-pad-scale)) calc(12px * var(--cd-pad-scale));
  padding: calc(8px * var(--cd-pad-scale)) calc(12px * var(--cd-pad-scale)) calc(10px * var(--cd-pad-scale));
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  border-top-color: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent);
  min-width: 0;
}
.room-status-bar[hidden], .room-status-bar:empty { display: none !important; }
.room-status-item {
  --status-color: var(--cd-accent);
  display: inline-flex;
  align-items: center;
  gap: calc(6px * var(--cd-pad-scale));
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  max-width: 100%;
}
.room-status-badge {
  width: calc(26px * var(--cd-scale));
  height: calc(26px * var(--cd-scale));
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--status-color);
  background: color-mix(in srgb, var(--status-color) 16%, transparent);
}
.room-status-badge ha-icon { --mdc-icon-size: calc(15px * var(--cd-scale)); }
.room-status-val {
  font-size: calc(13px * var(--cd-scale));
  font-weight: 600;
  color: var(--cd-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.room-status-item.alert .room-status-badge {
  color: #fff;
  background: var(--status-color, #ef4444);
}
.room-status-item.alert .room-status-val {
  color: var(--status-color, #ef4444);
  font-weight: 700;
}
@container cdpage (max-width: 340px) {
  .tile-grid, .group-sub-grid { grid-template-columns: minmax(0, 1fr); }
  .tile.wide { grid-column: span 1; }
}

/* ── Tiles ── */
.tile {
  --tile-color: var(--cd-active);
  display: grid; grid-template-columns: minmax(0, 1fr); gap: calc(8px * var(--cd-pad-scale)); padding: calc(10px * var(--cd-pad-scale)); min-width: 0; max-width: 100%; overflow: hidden; border-radius: var(--cd-tile-radius, 12px);
  background: var(--cd-tile-bg); transition: background .2s, opacity .2s;
  position: relative; touch-action: manipulation;
}
.tile:not(:has(.tile-feature:not([hidden]))):not(:has(.group-sub-body)) {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: calc(48px * var(--cd-scale));
  height: 100%;
  box-sizing: border-box;
}
.tile:not(:has(.tile-feature:not([hidden]))):not(:has(.group-sub-body)) .tile-main {
  width: 100%;
}
.tile.wide { grid-column: span 2; }
.tile[data-active="false"] { --tile-color: var(--cd-secondary); }
.tile[data-unavailable] { opacity: .5; }

/* ── Hierarchical Group Tile ── */
.tile.group {
  position: relative;
  gap: 0;
  padding: calc(10px * var(--cd-pad-scale));
  border: 1px solid transparent;
  box-sizing: border-box;
  transition: background .2s, border-color .2s;
  box-shadow: none;
}
.tile.group .tile-main {
  cursor: pointer;
}
.tile.group .tile-btns:empty {
  display: none;
}
.tile.group .tile-feature:not([hidden]) {
  margin-top: calc(10px * var(--cd-pad-scale));
}
.tile.group[data-open] {
  background: var(--cd-tile-bg);
  border-color: rgba(128, 128, 128, 0.16);
  border-color: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent);
  box-shadow: none;
}
.tile.group.subgroup {
  padding: calc(10px * var(--cd-pad-scale));
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(128, 128, 128, 0.12);
  border-color: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent);
  grid-column: span 1;
}
@media (hover: hover) {
  .tile:not(.group):not(.media[data-art]):hover {
    background-color: color-mix(in srgb, var(--primary-text-color, #fff) 8%, var(--cd-tile-bg));
  }
  .tile.group:not(.subgroup):hover:not(:has(.tile.group.subgroup:hover)):not(:has(.tile:hover)) {
    background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, var(--cd-tile-bg));
    border-color: color-mix(in srgb, var(--primary-text-color, #fff) 16%, transparent);
  }
  .tile.group.subgroup:hover {
    background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, rgba(255, 255, 255, 0.05));
    border-color: color-mix(in srgb, var(--primary-text-color, #fff) 18%, transparent);
  }
}
.group-icon-btn { position: relative; }
.group-sub-body {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows .28s cubic-bezier(0.22, 1, 0.36, 1), opacity .22s ease;
}
.tile.group[data-open] .group-sub-body {
  grid-template-rows: 1fr;
  opacity: 1;
}
.group-sub-inner {
  overflow: hidden;
  min-height: 0;
}
.group-sub-container {
  width: 100%; padding: 10px 0 0 0; margin-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  border-top-color: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent);
  background: transparent;
  border-radius: 0;
}
.group-sub-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0;
}
.chevron-btn { flex-shrink: 0; }
.chevron-btn ha-icon { transition: transform .28s cubic-bezier(0.22, 1, 0.36, 1); }
.tile.group[data-open] .chevron-btn ha-icon { transform: rotate(180deg); }

/* ── Multi-select & Action Bar ── */
.sel-checkbox {
  width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(128, 128, 128, .45);
  background: transparent; display: grid; place-items: center; cursor: pointer; flex: none;
  transition: background .15s, border-color .15s; color: transparent; position: relative;
}
.sel-checkbox::after { content: ''; position: absolute; inset: -11px; }
.sel-checkbox[data-checked] {
  background: var(--cd-accent); border-color: var(--cd-accent); color: #fff;
}
.sel-checkbox ha-icon { --mdc-icon-size: 16px; }
.wizard-selection-slot {
  flex-shrink: 0;
  padding: 0 20px 10px;
}
.wizard-selection-slot:empty { display: none; }
.selection-action-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; margin: 0; border-radius: var(--cd-radius);
  background: var(--cd-card); border: 1.5px solid var(--cd-accent);
  box-shadow: 0 4px 18px rgba(0,0,0,.35); animation: cdFadeIn 0.2s ease-out;
  box-sizing: border-box; width: 100%;
}
.sel-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 140px; }
.sel-count { font-size: 13px; font-weight: 700; color: var(--primary-text-color, inherit); }
.sel-names { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sel-buttons { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; justify-content: flex-end; flex-wrap: wrap; }
.btn-label-mobile { display: none; }
.btn-label-desktop { display: inline; }
.tile-main { display: flex; align-items: center; gap: calc(10px * var(--cd-pad-scale)); min-width: 0; }
.tile-icon {
  flex: none; width: calc(38px * var(--cd-scale)); height: calc(38px * var(--cd-scale)); border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
  color: var(--tile-color); background: rgba(128, 128, 128, 0.18);
  background: color-mix(in srgb, var(--tile-color) 18%, transparent);
  transition: background .2s, color .2s; position: relative;
}
.tile-icon::after { content: ''; position: absolute; inset: -3px; }
.tile-icon:active { transform: scale(0.92); }
.tile-info { flex: 1; min-width: 0; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.tile-name { font-size: calc(14px * var(--cd-scale)); line-height: 1.2; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-state { font-size: calc(13.5px * var(--cd-scale)); line-height: 1.2; font-weight: 500; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-btns { display: flex; gap: calc(4px * var(--cd-pad-scale)); flex: none; }
.mini-btn {
  width: calc(38px * var(--cd-scale)); height: calc(38px * var(--cd-scale)); border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
  flex-shrink: 0; touch-action: manipulation; position: relative;
  background: rgba(128, 128, 128, 0.2); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent);
}
.mini-btn::after { content: ''; position: absolute; inset: -3px; }
.mini-btn:disabled { opacity: .35; cursor: default; }
.mini-btn:not(:disabled):active { transform: scale(0.9); }
.mini-btn ha-icon { --mdc-icon-size: calc(20px * var(--cd-scale)); }
.tile-feature { display: flex; align-items: center; gap: 10px; padding: 0 2px 2px; flex-wrap: wrap; min-width: 0; }
.tile-feature[hidden] { display: none; }
.tile:not(.wide) .tile-feature { gap: 6px; padding-top: 2px; }
.tile:not(.wide) input[type=range].slider { flex: 1 1 100%; height: 22px; border-radius: 11px; }
.tile:not(.wide) input[type=range].slider::-webkit-slider-runnable-track { height: 22px; border-radius: 11px; }
.tile:not(.wide) input[type=range].slider::-webkit-slider-thumb { height: 14px; margin-top: 4px; }
.tile:not(.wide) input[type=range].slider::-moz-range-track { height: 22px; border-radius: 11px; }
.tile:not(.wide) input[type=range].slider::-moz-range-thumb { height: 14px; }
.tile:not(.wide) .tile-swatches { flex-wrap: wrap; gap: 6px !important; }
.tile:not(.wide) .swatch { width: 22px; height: 22px; }
.tile:not(.wide) .tile-btns { gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 96px; }
.tile:not(.wide) .mini-btn { width: 30px; height: 30px; }
.swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); cursor: pointer; flex: none; padding: 0; position: relative; }
.swatch::after { content: ''; position: absolute; inset: -8px; }
.swatch:active { transform: scale(0.9); }
input[type=range].slider {
  -webkit-appearance: none; appearance: none; flex: 1 1 0%; min-width: 0; width: 100%; height: 28px; border-radius: 14px; outline: none; cursor: pointer;
  background: linear-gradient(to right, var(--tile-color) var(--val, 0%), rgba(128,128,128,.25) var(--val, 0%));
  touch-action: none;
  box-sizing: border-box;
  padding: 0 5px;
  margin: 0;
}
input[type=range].slider::-webkit-slider-runnable-track {
  height: 28px;
  border-radius: 14px;
  background: transparent;
}
input[type=range].slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 6px;
  height: 16px;
  background-color: #fff;
  border-radius: 3px;
  margin-top: 6px;
  border: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
input[type=range].slider::-moz-range-track {
  height: 28px;
  border-radius: 14px;
  background: transparent;
}
input[type=range].slider::-moz-range-thumb {
  width: 6px;
  height: 16px;
  background-color: #fff;
  border-radius: 3px;
  border: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}

/* media + climate cards */
.tile.media { background-size: cover; background-position: center; position: relative; overflow: hidden; }
.tile.media[data-art],
.tile.media[data-art]:hover {
  background-blend-mode: overlay;
  background-color: rgba(0,0,0,.55);
  background-size: cover;
  background-position: center;
  color: #fff;
  transform: none;
  transition: none;
}
.tile.media[data-art] .tile-state { color: rgba(255,255,255,.82); }
.tile.media .tile-btns { gap: calc(4px * var(--cd-pad-scale)); }
.tile.media .mini-btn[data-on] {
  color: var(--cd-accent, #03a9f4);
  background: color-mix(in srgb, var(--cd-accent, #03a9f4) 22%, rgba(0, 0, 0, .25));
}
@container cdpage (max-width: 420px) {
  .tile.media .mini-btn { width: calc(32px * var(--cd-scale)); height: calc(32px * var(--cd-scale)); }
  .tile.media .mini-btn ha-icon { --mdc-icon-size: calc(18px * var(--cd-scale)); }
}

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
@media (hover: hover) {
  .bin:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }
}
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
@media (hover: hover) {
  .trash-card .bin:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }
}

/* ── Standalone Announce Card ── */
.announce-card { padding: 0; overflow: hidden; cursor: pointer; }
.announce-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; transition: background .15s; }
@media (hover: hover) {
  .announce-row:hover { background: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent); }
}
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
  position: fixed; left: 50%; bottom: calc(12px + var(--safe-bottom)); transform: translateX(-50%); z-index: 5;
  display: flex; gap: calc(8px * var(--cd-pad-scale)); padding: calc(8px * var(--cd-pad-scale)); border-radius: 28px;
  max-width: calc(100vw - 24px - var(--safe-left) - var(--safe-right));
  overflow-x: auto; scrollbar-width: none;
  background: var(--cd-card); box-shadow: 0 4px 24px rgba(0,0,0,.35);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
.nav-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: calc(8px * var(--cd-pad-scale)); min-width: 52px; min-height: calc(44px * var(--cd-scale)); height: calc(46px * var(--cd-scale));
  padding: 0 calc(18px * var(--cd-pad-scale)); border-radius: 23px; border: 0; cursor: pointer; background: var(--cd-tile-bg); font-weight: 600; font-size: calc(14px * var(--cd-scale)); flex: none;
}
.nav-btn:active { transform: scale(0.96); }

/* ── Settings dialog ── */
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center;
  padding: max(16px, var(--safe-top)) max(16px, var(--safe-right)) max(16px, var(--safe-bottom)) max(16px, var(--safe-left));
  overflow: hidden;
  overscroll-behavior: contain;
}
.overlay.confirm-overlay {
  z-index: 1600;
  backdrop-filter: none; -webkit-backdrop-filter: none;
}
.dialog {
  width: min(1040px, 100%);
  height: min(780px, calc(100vh - 32px));
  height: min(780px, calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom)));
  min-height: 0;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom));
  margin: auto;
  display: flex; flex-direction: column;
  border-radius: var(--cd-radius);
  background: var(--cd-card);
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(128, 128, 128, 0.22);
  overflow: hidden;
  position: relative;
}
.dialog-head { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 20px; border-bottom: 1px solid rgba(128,128,128,.18); border-radius: calc(var(--cd-radius) - 1px) calc(var(--cd-radius) - 1px) 0 0; }
.dialog-head h2 { flex: 1; min-width: 0; margin: 0; font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabs { flex-shrink: 0; display: flex; gap: 4px; padding: 6px 12px 0; min-height: 44px; align-items: flex-end; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid rgba(128,128,128,.18); }
.tab { flex-shrink: 0; border: 0; background: transparent; cursor: pointer; padding: 9px 14px; min-height: 40px; border-radius: 10px 10px 0 0; font-weight: 600; font-size: 13px; color: var(--cd-secondary); white-space: nowrap; transition: color .15s, background .15s; }
@media (hover: hover) {
  .tab:hover { color: var(--primary-text-color, inherit); background: rgba(128,128,128,.08); }
}
.tab[data-active] { color: var(--cd-accent); box-shadow: inset 0 -2px 0 var(--cd-accent); }
.dialog-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 16px 22px 20px;
  display: flex; flex-direction: column; gap: 14px;
}
.dialog-foot { flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid rgba(128,128,128,.18); background: var(--cd-card); border-radius: 0 0 calc(var(--cd-radius) - 1px) calc(var(--cd-radius) - 1px); }
.dialog-foot-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.confirm-modal-dialog {
  width: min(420px, calc(100vw - 32px - var(--safe-left) - var(--safe-right)));
  height: auto !important;
  min-height: 0 !important;
  max-height: calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom));
}
.confirm-modal-body { flex: 0 1 auto; }
.confirm-modal-msg { margin: 0; font-size: 14px; line-height: 1.45; color: var(--primary-text-color, inherit); }
.hint { font-size: 12px; color: var(--cd-secondary); line-height: 1.45; white-space: pre-line; }
.section-title { font-size: 13px; font-weight: 700; letter-spacing: .1px; color: var(--cd-secondary); margin-top: 4px; }
.row-card { border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg); padding: 10px 12px; display: grid; gap: 10px; min-width: 0; }
.row-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.row-head .row-title { flex: 1; font-weight: 600; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fields { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); min-width: 0; }
.field { display: grid; gap: 6px; font-size: 12px; color: var(--cd-secondary); min-width: 0; position: relative; }
.field-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 22px; flex-wrap: wrap; }
.field-label { font-size: 12px; font-weight: 600; color: var(--cd-secondary); }
.field > input[type=text], .field > input[type=number], .field > select, .field > input:not([type]) {
  height: 40px; border-radius: 12px; border: 1px solid rgba(128,128,128,.3); padding: 0 10px; font: inherit; font-size: 13px;
  background: var(--cd-card); color: var(--primary-text-color, inherit); min-width: 0; width: 100%; outline: none; transition: border-color .2s;
}
.field > input[type=text]:focus, .field > input[type=number]:focus, .field > select:focus { border-color: var(--cd-accent); }
.field input[type=color] { height: 38px; width: 100%; border: 1px solid rgba(128,128,128,.3); border-radius: 10px; background: var(--cd-card); padding: 2px; }
.field.check { grid-auto-flow: column; justify-content: start; align-items: center; gap: 8px; min-height: 40px; color: var(--primary-text-color, inherit); font-size: 14px; }
.user-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.user-chip {
  border: 1px solid rgba(128,128,128,.35); background: transparent; border-radius: 16px; padding: 6px 12px; min-height: 36px; cursor: pointer; font-size: 13px; color: var(--primary-text-color, inherit);
}
.user-chip[data-on] { background: var(--cd-accent); border-color: var(--cd-accent); color: #fff; }
.btn {
  min-height: 40px; padding: 0 16px; border-radius: 20px; border: 0; cursor: pointer; font-weight: 600; font-size: 13px;
  background: var(--cd-tile-bg); color: var(--primary-text-color, inherit);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn.small, .btn.sm { min-height: 36px; padding: 0 12px; border-radius: 18px; font-size: 12px; }
.btn.secondary { background: var(--cd-tile-bg); border: 1px solid rgba(128,128,128,.22); color: var(--primary-text-color, inherit); }
.btn.primary { background: var(--cd-accent); color: #fff; }
.btn.success { background: var(--success-color, #43a047); color: #fff; }
.btn.danger { color: #f44336; }
.btn:disabled { opacity: .5; cursor: default; }

/* ── Wizard & Shared Device List ── */
.wizard-steps { flex-shrink: 0; display: flex; gap: 8px; padding: 10px 20px 8px; border-bottom: 1px solid rgba(128,128,128,.18); }
.wizard-step { flex: 1; display: grid; gap: 4px; font-size: 11px; font-weight: 600; color: var(--cd-secondary); min-width: 0; }
.wizard-step > div:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wizard-step[data-active] { color: var(--primary-text-color, inherit); }
.wizard-step[data-done] { color: var(--success-color, #43a047); }
.wizard-bar { height: 4px; border-radius: 2px; background: rgba(128,128,128,.2); transition: background .3s; }
.wizard-step[data-active] .wizard-bar { background: var(--cd-accent); }
.wizard-step[data-done] .wizard-bar { background: var(--success-color, #43a047); }
.devices-toolbar {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-width: 0;
}
.devices-toolbar > * { flex: 1 1 180px; min-width: 0; }
.device-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; box-sizing: border-box; }
.device-cards { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.device-card {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px;
  background: var(--cd-tile-bg); cursor: pointer; border: 2px solid transparent; transition: border-color .2s, background .2s;
  box-sizing: border-box; min-width: 0; width: 100%;
}
@media (hover: hover) {
  .device-card:hover { background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); }
}
.device-card[data-selected] {
  border-color: var(--cd-accent);
  background: rgba(3, 169, 244, 0.14);
  background: color-mix(in srgb, var(--cd-accent) 14%, var(--cd-tile-bg));
}
.device-card-actions {
  display: flex; align-items: center; gap: 6px; flex: none; margin-left: auto;
}
.group-card {
  border: 1.5px solid rgba(255, 193, 7, 0.28);
}
.group-card[data-selected] {
  border-color: var(--cd-accent);
  background: rgba(3, 169, 244, 0.14);
  background: color-mix(in srgb, var(--cd-accent) 14%, var(--cd-tile-bg));
}
.device-channels-wrap {
  display: grid; gap: 4px; padding: 6px 10px 8px 24px; margin-top: -4px;
  background: var(--cd-tile-bg); border-radius: 0 0 12px 12px;
  border-left: 2px solid var(--cd-accent); min-width: 0;
}
.device-channel-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; min-height: 44px; border-radius: 8px;
  background: var(--cd-card); cursor: pointer; border: 1.5px solid transparent;
  transition: border-color .15s, background .15s; min-width: 0;
}
@media (hover: hover) {
  .device-channel-row:hover { background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent); }
}
.device-channel-row[data-selected] {
  border-color: var(--cd-accent);
  background: rgba(3, 169, 244, 0.14);
  background: color-mix(in srgb, var(--cd-accent) 14%, var(--cd-tile-bg));
}
.device-channel-info { flex: 1; min-width: 0; }
.device-channel-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-channel-meta { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-channels-toggle {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; min-height: 30px; border-radius: 10px;
  background: var(--cd-tile-bg); color: var(--primary-text-color, inherit); font-size: 11px; font-weight: 600;
  border: 1px solid rgba(128,128,128,.2); cursor: pointer; transition: background .15s; position: relative;
}
.btn-channels-toggle::after { content: ''; position: absolute; inset: -7px -4px; }
@media (hover: hover) {
  .btn-channels-toggle:hover { background: rgba(128,128,128,.2); }
}
.btn-channels-toggle ha-icon { --mdc-icon-size: 14px; }
.group-member-tag {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px;
  background: rgba(128,128,128,.2); font-size: 12px; font-weight: 600; color: var(--primary-text-color, inherit);
}
.group-member-tag .remove-btn {
  background: transparent; border: 0; cursor: pointer; color: var(--cd-secondary);
  padding: 2px; min-width: 24px; min-height: 24px; display: grid; place-items: center; font-size: 12px; border-radius: 50%; position: relative;
}
.group-member-tag .remove-btn::after { content: ''; position: absolute; inset: -10px; }
@media (hover: hover) {
  .group-member-tag .remove-btn:hover { color: #f44336; }
}
.device-card .d-icon {
  width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(128,128,128,.18); color: var(--cd-accent); flex: none;
}
.device-card .d-info { flex: 1; min-width: 0; }
.device-card .d-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-card .d-meta { font-size: 12px; color: var(--cd-secondary); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 3px; min-width: 0; }
.device-card .d-mfg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 118px), 1fr)); gap: 8px; }
.cat-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; border-radius: 12px;
  background: var(--cd-tile-bg); border: 1px solid transparent; cursor: pointer; text-align: center; font-size: 12px; font-weight: 600;
  transition: transform .15s, border-color .15s, background .15s; min-width: 0;
}
@media (hover: hover) {
  .cat-card:hover { transform: translateY(-2px); }
}
.cat-card[data-selected] {
  border-color: var(--cat-color, var(--cd-accent));
  background: rgba(3, 169, 244, 0.16);
  background: color-mix(in srgb, var(--cat-color, var(--cd-accent)) 16%, transparent);
}
.cat-card ha-icon { --mdc-icon-size: 28px; color: var(--cat-color, var(--cd-accent)); }
.badge-tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
  background: rgba(128,128,128,.2); color: var(--cd-secondary); max-width: 100%; min-width: 0;
}
.badge-tag.ok { background: rgba(67, 160, 71, .2); color: #81c784; }
.badge-tag.area { background: rgba(3, 169, 244, .18); color: #4fc3f7; }
.badge-tag.category {
  background: rgba(3, 169, 244, 0.16);
  background: color-mix(in srgb, var(--badge-cat-color, var(--cd-accent)) 16%, transparent);
  color: var(--badge-cat-color, var(--cd-accent));
  border: 1px solid color-mix(in srgb, var(--badge-cat-color, var(--cd-accent)) 25%, transparent);
}
.badge-tag.category ha-icon {
  --mdc-icon-size: 14px;
  color: var(--badge-cat-color, var(--cd-accent));
}
.channel-card {
  border-radius: 12px; background: var(--cd-tile-bg); padding: 10px 14px; display: grid; gap: 10px; min-width: 0;
}
.channel-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.channel-head .ch-title { flex: 1 1 140px; min-width: 0; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-head .badge-tag { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.search-bar {
  display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 42px; border-radius: 12px;
  background: var(--cd-card); border: 1px solid rgba(128,128,128,.3); min-width: 0; width: 100%;
}
.search-bar input { flex: 1; min-width: 0; width: 100%; border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.filter-chip {
  padding: 6px 12px; min-height: 36px; border-radius: 18px; border: 1px solid rgba(128,128,128,.3); background: transparent;
  color: var(--cd-secondary); cursor: pointer; font-size: 12px; font-weight: 500; position: relative;
}
.filter-chip::after { content: ''; position: absolute; inset: -4px 0; }
.filter-chip[data-active] { background: var(--cd-accent); color: #fff; border-color: var(--cd-accent); }

details.sub { border-radius: 10px; background: rgba(128,128,128,.08); padding: 6px 10px; }
details.sub summary { cursor: pointer; font-size: 13px; font-weight: 600; padding: 4px 0; }
.sub-tile { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid rgba(128,128,128,.12); font-size: 13px; }
.sub-tile .st-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-tile .st-id { color: var(--cd-secondary); font-size: 11px; }
.sub-tile[data-hidden] .st-name { opacity: .45; text-decoration: line-through; }
.toast {
  position: fixed; left: 50%; bottom: calc(20px + var(--safe-bottom)); transform: translateX(-50%); z-index: 2000;
  max-width: calc(100vw - 32px - var(--safe-left) - var(--safe-right));
  background: #262626; color: #fff; padding: 10px 18px; border-radius: 20px; font-size: 13px; font-weight: 600;
  text-align: center; box-shadow: 0 6px 22px rgba(0,0,0,.45);
}
.toast.error { background: #c62828; }

.cd-portal-menu {
  position: fixed;
  z-index: 1500;
  margin: 0;
  box-sizing: border-box;
  box-shadow: 0 14px 36px rgba(0, 0, 0, .36);
}

/* ── Entity Picker ── */
.entity-picker { position: relative; width: 100%; min-width: 0; font-size: 13px; }
.ep-box {
  display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 10px;
  border-radius: 10px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  color: var(--primary-text-color, inherit);
  cursor: pointer; transition: border-color .2s, box-shadow .2s; outline: none;
}
@media (hover: hover) {
  .ep-box:hover { border-color: var(--cd-accent); }
}
.ep-box[data-open] { border-color: var(--cd-accent); box-shadow: 0 0 0 1px var(--cd-accent); }
.ep-icon { flex: none; color: var(--cd-accent); display: grid; place-items: center; }
.ep-content { flex: 1; min-width: 0; display: grid; gap: 1px; }
.ep-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color, inherit); }
.ep-sub { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-placeholder { color: var(--cd-secondary); font-size: 13px; }
.ep-clear { border: 0; background: transparent; cursor: pointer; color: var(--cd-secondary); padding: 6px; min-width: 32px; min-height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; position: relative; }
.ep-clear::after { content: ''; position: absolute; inset: -6px; }
@media (hover: hover) {
  .ep-clear:hover { color: var(--primary-text-color, inherit); background: rgba(128,128,128,.2); }
}
.ep-chevron { flex: none; color: var(--cd-secondary); transition: transform .2s ease; }
.ep-box[data-open] .ep-chevron { transform: rotate(180deg); }
.ep-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1500;
  border-radius: 12px; background: var(--cd-card); color: var(--primary-text-color, inherit);
  border: 1px solid rgba(128,128,128,.28);
  box-shadow: 0 12px 32px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden;
}
.ep-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-shrink: 0;
  border-bottom: 1px solid rgba(128,128,128,.15); background: var(--cd-tile-bg);
}
.ep-search input {
  flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none;
}
.ep-chips { display: flex; gap: 6px; padding: 6px 10px; overflow-x: auto; flex-shrink: 0; background: var(--cd-tile-bg); border-bottom: 1px solid rgba(128,128,128,.12); scrollbar-width: none; }
.ep-list { flex: 1; min-height: 0; max-height: 240px; overflow-y: auto; -webkit-overflow-scrolling: touch; display: grid; }
.ep-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; min-height: 44px; cursor: pointer;
  border-bottom: 1px solid rgba(128,128,128,.06); transition: background .15s; outline: none;
}
@media (hover: hover) {
  .ep-item:hover, .ep-item:focus { background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
}
.ep-item[data-active] { background: rgba(3, 169, 244, 0.18); background: color-mix(in srgb, var(--cd-accent) 22%, transparent); }
.ep-item .item-state { flex: none; font-size: 11px; color: var(--cd-secondary); background: rgba(128,128,128,.15); padding: 2px 6px; border-radius: 6px; }
.ep-divider { height: 1px; margin: 6px 10px; background: var(--cd-border); opacity: 0.9; }
.ep-check { flex: none; color: var(--cd-accent); }

/* ── Color Picker ── */
.color-picker { position: relative; width: 100%; min-width: 0; }
.cp-box {
  display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px;
  border-radius: 12px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  color: var(--primary-text-color, inherit); width: 100%; cursor: pointer; text-align: left; font-size: 13px;
  transition: border-color .2s; outline: none;
}
@media (hover: hover) {
  .cp-box:hover { border-color: var(--cd-accent); }
}
.cp-box[data-open] { border-color: var(--cd-accent); }
.cp-dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(128,128,128,.35); flex-shrink: 0; }
.cp-label { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-chevron { flex-shrink: 0; color: var(--cd-secondary); transition: transform .2s ease; }
.cp-box[data-open] .cp-chevron { transform: rotate(180deg); }
.cp-dropdown {
  position: absolute; top: calc(100% + 4px); right: 0; width: max(100%, 250px); max-width: calc(100vw - 24px); z-index: 1500;
  border-radius: 14px; background: var(--cd-card); color: var(--primary-text-color, inherit);
  border: 1px solid rgba(128,128,128,.28);
  box-shadow: 0 12px 32px rgba(0,0,0,.28); max-height: 260px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 6px;
}
.cp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.cp-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; min-height: 42px; border-radius: 8px;
  cursor: pointer; transition: background .15s; font-size: 13px;
}
@media (hover: hover) {
  .cp-item:hover { background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
}
.cp-item[data-active] { background: rgba(3, 169, 244, 0.2); background: color-mix(in srgb, var(--cd-accent) 22%, transparent); font-weight: 600; }
.cp-opt-name { flex: 1; }
.cp-check { margin-left: auto; color: var(--cd-accent); }

/* ── Icon Picker ── */
.icon-picker { position: relative; width: 100%; min-width: 0; }
.ip-box {
  display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 2px 6px 2px 8px;
  border-radius: 12px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  color: var(--primary-text-color, inherit);
  transition: border-color .2s, box-shadow .2s;
}
@media (hover: hover) {
  .ip-box:hover { border-color: var(--cd-accent); }
}
.ip-box[data-open] { border-color: var(--cd-accent); box-shadow: 0 0 0 1px var(--cd-accent); }
.ip-preview {
  width: 32px; height: 32px; border-radius: 8px; background: var(--cd-tile-bg);
  display: grid; place-items: center; color: var(--cd-accent); flex-shrink: 0; cursor: pointer;
}
.ip-input { flex: 1; border: 0; background: transparent; color: var(--primary-text-color, inherit); font: inherit; font-size: 13px; outline: none; min-width: 0; }
.ip-clear, .ip-toggle {
  width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent;
  cursor: pointer; color: var(--cd-secondary); display: grid; place-items: center; flex-shrink: 0; position: relative;
}
.ip-clear::after, .ip-toggle::after { content: ''; position: absolute; inset: -6px; }
@media (hover: hover) {
  .ip-clear:hover, .ip-toggle:hover { background: var(--cd-tile-bg); color: var(--primary-text-color, inherit); }
}
.ip-clear[hidden] { display: none; }
.ip-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1500;
  border-radius: 14px; background: var(--cd-card); color: var(--primary-text-color, inherit);
  border: 1px solid rgba(128,128,128,.28);
  box-shadow: 0 12px 32px rgba(0,0,0,.28); max-height: 340px; display: flex; flex-direction: column; overflow: hidden;
}
.ip-dropdown[hidden] { display: none; }
.ip-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  grid-auto-rows: max-content; align-content: start; gap: 6px;
  padding: 8px; overflow-y: auto; -webkit-overflow-scrolling: touch; flex: 1 1 auto; min-height: 0;
}
.ip-chip {
  display: block; width: 100%; min-width: 0; height: auto; min-height: 68px; padding: 10px 6px;
  border-radius: 10px; border: 1px solid transparent; background: var(--cd-tile-bg);
  color: inherit; cursor: pointer; text-align: center; font-size: 11px; line-height: 1.25;
  box-sizing: border-box; appearance: none; -webkit-appearance: none;
  transition: transform .12s, border-color .12s, background .12s;
}
.ip-chip-inner {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px; width: 100%; min-width: 0;
}
.ip-chip-inner ha-icon { flex: none; --mdc-icon-size: 22px; }
@media (hover: hover) {
  .ip-chip:hover { transform: translateY(-2px); border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 15%, transparent); }
}
.ip-chip.active { border-color: var(--cd-accent); background: rgba(3, 169, 244, 0.2); background: color-mix(in srgb, var(--cd-accent) 22%, transparent); font-weight: 600; }
.ip-chip-name {
  display: block; width: 100%; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; line-height: 1.25;
}
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

/* ── Weather Warning Subview ── */
.warning-detail-page {
  display: flex; flex-direction: column; gap: 16px;
  width: 100%; max-width: 860px; margin: 0 auto; padding: 0 4px 40px;
  animation: cdFadeIn 0.2s ease-out;
}
.warning-detail-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 16px; border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
}
.warning-detail-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.warning-detail-back {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px 0 10px;
  border-radius: 22px; border: 0; cursor: pointer; background: var(--cd-tile-bg);
  color: var(--primary-text-color, inherit); font-weight: 600; font-size: 13px;
  transition: transform .12s, background .15s;
}
.warning-detail-back:active { transform: scale(0.96); }
.warning-detail-title-wrap { display: flex; align-items: center; gap: 10px; min-width: 0; }
.warning-detail-title-wrap .icon {
  width: 40px; height: 40px; border-radius: 12px; background: rgba(251, 140, 0, 0.15);
  display: grid; place-items: center; color: #fb8c00; font-size: 20px; flex: none;
}
.warning-detail-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--primary-text-color, inherit); }
.warning-detail-count {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border-radius: 14px; background: var(--cd-tile-bg); font-size: 12px; font-weight: 600;
  color: var(--primary-text-color, inherit);
}
.warning-list { display: flex; flex-direction: column; gap: 14px; }
.warning-card {
  background: var(--cd-card); border-radius: var(--cd-radius); padding: 18px 20px;
  display: flex; flex-direction: column; gap: 14px; border: 1px solid rgba(128,128,128,.16);
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
}
.warning-top {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.warning-level-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
  border-radius: 8px; font-size: 12px; font-weight: 700; color: #fff;
  letter-spacing: 0.2px;
}
.warning-time {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--cd-secondary); font-weight: 500;
}
.warning-time ha-icon { --mdc-icon-size: 16px; }
.warning-hl { font-size: 18px; font-weight: 700; line-height: 1.3; color: var(--primary-text-color, inherit); }
.warning-desc { font-size: 14px; line-height: 1.55; color: var(--primary-text-color, inherit); opacity: 0.9; white-space: pre-line; }
.warning-instruction {
  background: color-mix(in srgb, var(--cd-tile-bg) 80%, rgba(251,140,0,.15));
  border-radius: var(--cd-tile-radius, 12px); border-left: 3px solid #fb8c00;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
}
.warning-instruction-title {
  display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
  letter-spacing: .2px; color: #fb8c00;
}
.warning-instruction-title ha-icon { --mdc-icon-size: 16px; }
.warning-instruction-text { font-size: 13px; line-height: 1.5; color: var(--primary-text-color, inherit); opacity: 0.9; }
.warning-empty {
  background: var(--cd-card); border-radius: var(--cd-radius); padding: 48px 24px;
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px;
  border: 1px solid rgba(128,128,128,.12);
}
.warning-empty .icon {
  width: 56px; height: 56px; border-radius: 50%; background: rgba(76, 175, 80, 0.15);
  display: grid; place-items: center; color: #4caf50; font-size: 28px;
}
.warning-empty .title { font-size: 18px; font-weight: 700; }
.warning-empty .sub { font-size: 13px; color: var(--cd-secondary); max-width: 420px; line-height: 1.4; }
.room-detail-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 14px 16px; border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
}
.room-detail-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.room-detail-back {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px 0 10px;
  border-radius: 22px; border: 0; cursor: pointer; background: var(--cd-tile-bg);
  color: var(--primary-text-color, inherit); font-weight: 600; font-size: 13px;
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
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 8px; min-width: 0; width: 100%; max-width: 100%;
  border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 2px 14px rgba(0,0,0,.25); overflow: hidden;
}
.room-detail-body .tile-grid { padding: 0; gap: 8px; min-width: 0; width: 100%; }
.cover-detail-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; width: 100%; }

.cover-detail-row {
  display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%; max-width: 100%; overflow: hidden; position: relative;
  padding: 12px 14px; border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg);
  transition: background .15s; cursor: pointer;
}
.cover-detail-top {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; width: 100%;
}
.cover-detail-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 0%; }
.cover-detail-icon {
  width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none;
  color: #9c27b0; background: rgba(156, 39, 176, 0.18);
}
.cover-detail-texts { flex: 1; min-width: 0; overflow: hidden; }
.cover-detail-name { font-size: calc(14px * var(--cd-scale)); line-height: 1.2; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cover-detail-state { font-size: calc(13.5px * var(--cd-scale)); line-height: 1.2; color: #ce93d8; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cover-slider-wrap {
  display: flex; align-items: center; gap: 8px; padding: 0 2px; min-width: 0; width: 100%; overflow: hidden;
}
.cover-slider-label { font-size: 11px; color: var(--cd-secondary); font-weight: 600; flex: none; min-width: 0; }
.cover-slider-wrap input[type=range].slider {
  --tile-color: #9c27b0;
  height: 24px;
  border-radius: 12px;
  box-sizing: border-box;
  padding: 0 5px;
  margin: 2px 0;
  background: linear-gradient(to right, var(--tile-color) var(--val, 0%), rgba(128,128,128,.25) var(--val, 0%));
}
.cover-slider-wrap input[type=range].slider::-webkit-slider-runnable-track {
  height: 24px;
  border-radius: 12px;
  background: transparent;
}
.cover-slider-wrap input[type=range].slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 6px;
  height: 14px;
  background-color: #fff;
  border-radius: 3px;
  margin-top: 5px;
  border: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
.cover-slider-wrap input[type=range].slider::-moz-range-track {
  height: 24px;
  border-radius: 12px;
  background: transparent;
}
.cover-slider-wrap input[type=range].slider::-moz-range-thumb {
  width: 6px;
  height: 14px;
  background-color: #fff;
  border-radius: 3px;
  border: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}

/* ── Custom Dropdown (No native browser <select>) ── */
.custom-dropdown { position: relative; width: 100%; min-width: 0; font-size: 13px; }
.cdd-box {
  display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 12px;
  border-radius: 10px; border: 1px solid rgba(128,128,128,.3); background: var(--cd-card);
  color: var(--primary-text-color, inherit);
  cursor: pointer; transition: border-color .2s, box-shadow .2s; outline: none; user-select: none; min-width: 0;
}
@media (hover: hover) {
  .cdd-box:hover:not(.disabled) { border-color: var(--cd-accent); }
}
.cdd-box[data-open] { border-color: var(--cd-accent); box-shadow: 0 0 0 1px var(--cd-accent); }
.cdd-box.disabled { opacity: .5; cursor: default; }
.cdd-icon { flex: none; display: grid; place-items: center; font-size: 18px; }
.cdd-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.cdd-text { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color, inherit); }
.cdd-text.placeholder { color: var(--cd-secondary); }
.cdd-chevron { flex: none; color: var(--cd-secondary); transition: transform .2s ease; }
.cdd-box[data-open] .cdd-chevron { transform: rotate(180deg); }
.cdd-menu {
  position: absolute; z-index: 1500; left: 0; right: 0; top: calc(100% + 4px);
  background: var(--cd-card); color: var(--primary-text-color, inherit);
  border-radius: 12px; border: 1px solid rgba(128,128,128,.28);
  box-shadow: 0 12px 32px rgba(0,0,0,.28); max-height: 280px; display: flex; flex-direction: column; overflow: hidden;
  animation: cddSlideDown .15s ease-out;
}
@keyframes cddSlideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.cdd-search-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-shrink: 0;
  background: var(--cd-tile-bg); color: var(--primary-text-color, inherit);
  border-bottom: 1px solid rgba(128,128,128,.15);
}
.cdd-search-input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--primary-text-color, inherit); font: inherit; font-size: 13px; outline: none; }
.cdd-list { overflow-y: auto; -webkit-overflow-scrolling: touch; flex: 1; min-height: 0; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.cdd-item {
  display: flex; align-items: center; gap: 10px; padding: 10px; min-height: 44px; border-radius: 8px;
  color: var(--primary-text-color, inherit);
  cursor: pointer; transition: background .12s; user-select: none;
}
@media (hover: hover) {
  .cdd-item:hover { background: rgba(128,128,128,.15); }
}
.cdd-item.selected { background: rgba(3, 169, 244, 0.16); background: color-mix(in srgb, var(--cd-accent) 18%, transparent); }
.cdd-item-texts { flex: 1; min-width: 0; }
.cdd-item-label { font-size: 13px; font-weight: 600; color: var(--primary-text-color, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  transition: background .15s, border-color .15s, transform .1s; min-width: 0;
}
@media (hover: hover) {
  .feature-card:hover { border-color: rgba(128,128,128,.4); }
}
.feature-card[data-active] {
  border-color: var(--feat-color, var(--cd-accent));
  background: rgba(3, 169, 244, 0.12);
  background: color-mix(in srgb, var(--feat-color, var(--cd-accent)) 12%, var(--cd-tile-bg));
}
.feature-icon {
  width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; flex: none;
  color: var(--feat-color, var(--cd-accent));
  background: rgba(3, 169, 244, 0.16);
  background: color-mix(in srgb, var(--feat-color, var(--cd-accent)) 18%, transparent);
}
.feature-info { flex: 1; min-width: 0; }
.feature-title { font-size: 13px; font-weight: 600; color: var(--primary-text-color, inherit); }
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
.feature-card[data-active] .switch-ui,
.channel-head[data-active] .switch-ui,
.switch-ui[data-active] {
  background: var(--feat-color, var(--cd-accent));
}
.feature-card[data-active] .switch-ui::after,
.channel-head[data-active] .switch-ui::after,
.switch-ui[data-active]::after {
  transform: translateX(20px);
}

/* ── Wizard Endscreen Preview & Celebration ── */
.win11-preview-card {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 14px;
  background: var(--cd-tile-bg); border: 1px solid rgba(128,128,128,.22);
  box-shadow: 0 6px 20px rgba(0,0,0,.25); min-width: 0;
}
.win11-preview-icon {
  width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none;
  color: var(--preview-color, var(--cd-accent));
  background: rgba(3, 169, 244, 0.18);
  background: color-mix(in srgb, var(--preview-color, var(--cd-accent)) 20%, transparent);
}
.win11-preview-info { flex: 1; min-width: 0; }
.win11-preview-name { font-size: 15px; font-weight: 700; color: var(--primary-text-color, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win11-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

.win11-celebration {
  text-align: center; padding: 32px 20px 28px; display: flex; flex-direction: column; align-items: center; gap: 14px;
  animation: win11Pop .35s cubic-bezier(.2, .9, .3, 1);
  background: radial-gradient(circle at center, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0.05) 60%, transparent 100%);
  border-radius: 16px; border: 1px solid rgba(16, 185, 129, 0.3);
  margin: 12px auto; max-width: 600px; width: 100%;
}
.win11-success-badge {
  width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0.12) 70%);
  color: #10b981; box-shadow: 0 0 32px rgba(16,185,129,0.55);
  animation: win11SuccessGlow 3s infinite ease-in-out;
}
.win11-success-badge ha-icon { --mdc-icon-size: 36px; }

/* ── Advanced options details ── */
details.adv-options {
  border-radius: 12px; background: rgba(128,128,128,.08); padding: 10px 14px; margin-top: 6px;
  border: 1px solid rgba(128,128,128,.15);
}
details.adv-options summary {
  cursor: pointer; font-size: 13px; font-weight: 600; color: var(--cd-secondary); user-select: none;
  display: flex; align-items: center; gap: 6px; min-height: 28px;
}
@media (hover: hover) {
  details.adv-options summary:hover { color: var(--primary-text-color, inherit); }
}
.adv-content { margin-top: 10px; display: grid; gap: 8px; }

.btn.danger {
  background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.3);
}
@media (hover: hover) {
  .btn.danger:hover { background: rgba(244, 67, 54, 0.25); }
}
.icon-btn.danger {
  color: #f44336; background: rgba(244, 67, 54, 0.1); border-radius: 10px;
}
@media (hover: hover) {
  .icon-btn.danger:hover { background: rgba(244, 67, 54, 0.22); }
}

/* ── Group & Room Modal Dialogs (Menus portal cleanly, so overflow stays hidden!) ── */
.group-modal-dialog,
.room-modal-dialog {
  width: min(560px, calc(100vw - 24px - var(--safe-left) - var(--safe-right)));
  height: auto !important;
  min-height: 0 !important;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom));
  overflow: hidden;
}
.group-modal-dialog .dialog-body,
.room-modal-dialog .dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 16px 20px 20px;
}
.group-modal-dialog .dialog-foot,
.room-modal-dialog .dialog-foot {
  border-radius: 0 0 calc(var(--cd-radius) - 1px) calc(var(--cd-radius) - 1px);
}

/* ── Mobile Dialog, Safe-Area & Touch Responsive ── */
@container cdpage (max-width: 560px) {
  .subview-head { padding: 12px; gap: 10px; }
  .subview-actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; }
  .subview-actions .btn { flex: 1 1 auto; min-height: 40px; padding: 0 12px; }
  .blinds-room-head { padding: 12px; gap: 8px; }
  .blinds-room-body { padding: 0 10px 10px; gap: 8px; }
  .blinds-room-title { font-size: calc(15px * var(--cd-scale)); }
  .blinds-room-actions { gap: 6px; }
  .blinds-room-actions .mini-btn { width: calc(36px * var(--cd-scale)); height: calc(36px * var(--cd-scale)); }
  .cover-detail-row { padding: 12px; gap: 10px; }
  .cover-detail-top { flex-wrap: wrap; gap: 10px; }
  .cover-detail-info { flex: 1 1 100%; }
  .cover-detail-name { font-size: calc(15px * var(--cd-scale)); white-space: normal; line-height: 1.25; }
  .cover-detail-state { font-size: calc(13.5px * var(--cd-scale)); }
  .cover-detail-row .tile-btns { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: none; }
  .cover-detail-row .mini-btn { width: 100%; height: calc(40px * var(--cd-scale)); border-radius: 12px; }
  .cover-detail-row .mini-btn ha-icon { --mdc-icon-size: calc(22px * var(--cd-scale)); }
  .cover-slider-wrap input[type=range].slider { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-runnable-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-thumb { height: 16px; margin-top: 6px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-thumb { height: 16px; }
}

@media (max-width: 650px) {
  .page {
    padding: var(--safe-top) calc(10px + var(--safe-right)) calc(92px + var(--safe-bottom)) calc(10px + var(--safe-left));
  }
  .cd-sticky-header {
    margin: 0 calc(-10px - var(--safe-right)) 4px calc(-10px - var(--safe-left));
    padding: 0 calc(10px + var(--safe-right)) 0 calc(10px + var(--safe-left));
  }
  .greeting h1 { font-size: calc(22px * var(--cd-scale)); }
  .edit-mode-banner { padding: 10px 12px; gap: 10px; flex-wrap: wrap; }
  .edit-mode-banner-info span { white-space: normal; line-height: 1.3; }
  .edit-mode-banner-btn { padding: 8px 14px; min-height: 40px; }
  .room-head { padding: 10px; gap: 8px; }
  .room-controls { gap: 4px; }
  .tile-main { gap: 8px; }
  .chevron-btn { width: 42px; height: 42px; }
  .btn { min-height: 44px; touch-action: manipulation; }
  .btn.small { min-height: 40px; }

  /* Prevent iOS Safari input auto-zoom (minimum 16px font-size on focused inputs) */
  .search-bar input,
  .ep-search input,
  .cdd-search-input,
  .ip-input,
  .field > input[type=text],
  .field > input[type=number],
  .field > select,
  .field > input:not([type]) {
    font-size: 16px;
  }

  .btn-label-desktop { display: none !important; }
  .btn-label-mobile { display: inline !important; }

  .wizard-selection-slot {
    padding: 0 calc(10px + var(--safe-right)) 8px calc(10px + var(--safe-left));
  }
  .selection-action-bar {
    padding: 8px 10px;
    gap: 8px;
  }
  .sel-info {
    width: 100%;
    flex: 1 1 100%;
  }
  .sel-buttons {
    width: 100%;
    display: flex;
    gap: 8px;
  }
  .sel-buttons button {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: center;
    white-space: nowrap;
    padding: 8px 10px;
  }

  .win11-hero-badge {
    width: 44px;
    height: 44px;
    margin: 0 auto 6px;
  }
  .win11-hero-badge ha-icon {
    --mdc-icon-size: 24px;
    width: 24px;
    height: 24px;
  }

  .overlay {
    padding: max(12px, var(--safe-top)) max(10px, var(--safe-right)) max(12px, var(--safe-bottom)) max(10px, var(--safe-left));
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .overlay:has(.dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog)) {
    padding: 0;
  }
  .dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog) {
    width: 100%;
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
    border: 0;
  }
  .dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog) .dialog-head {
    padding: calc(10px + var(--safe-top)) calc(10px + var(--safe-right)) 10px calc(16px + var(--safe-left));
    border-radius: 0;
  }
  .dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog) .tabs {
    padding: 4px calc(10px + var(--safe-right)) 0 calc(10px + var(--safe-left));
  }
  .dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog) .wizard-steps {
    padding: 8px calc(12px + var(--safe-right)) 6px calc(12px + var(--safe-left));
    gap: 6px;
  }
  .dialog:not(.group-modal-dialog):not(.room-modal-dialog):not(.confirm-modal-dialog):not(.pin-dialog) .dialog-body {
    padding: 12px calc(14px + var(--safe-right)) 16px calc(14px + var(--safe-left));
    min-height: 0;
  }
  .dialog .dialog-foot {
    padding: 10px calc(14px + var(--safe-right)) calc(10px + var(--safe-bottom)) calc(14px + var(--safe-left));
    border-radius: 0;
  }
}

@media (max-width: 480px) {
  .device-card {
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 10px 12px;
  }
  .device-card .d-icon {
    width: 34px;
    height: 34px;
  }
  .device-card .d-info {
    flex: 1 1 140px;
    min-width: 0;
  }
  .device-card .d-name {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .device-card-actions {
    width: 100%;
    justify-content: flex-end;
    padding-top: 8px;
    margin-top: 2px;
    border-top: 1px solid rgba(128, 128, 128, .14);
  }
  .device-channels-wrap {
    padding: 6px 8px 8px 16px;
  }
  .wizard-step { font-size: 10px; }
}

@media (max-height: 560px) {
  .win11-hero-badge { display: none; }
  .wizard-steps { padding-top: 6px; padding-bottom: 6px; }
}

/* ── Room Edit & Sensor Conflict Modals ── */
.sensor-pref-card {
  background: var(--cd-tile-bg);
  border: 1px solid rgba(128,128,128,0.18);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 12px;
}
.sensor-pref-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 10px;
}
.sensor-pref-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 14px;
}
.sensor-mode-tabs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-bottom: 10px;
}
.sensor-mode-tab {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 10px; min-height: 40px; border-radius: 10px;
  border: 1px solid rgba(128,128,128,0.22);
  background: var(--cd-card); color: var(--cd-secondary);
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all .15s; touch-action: manipulation;
}
.sensor-mode-tab.active {
  background: color-mix(in srgb, var(--cd-accent) 18%, transparent);
  border-color: var(--cd-accent); color: var(--primary-text-color, inherit);
}
.sensor-choice-list {
  display: flex; flex-direction: column; gap: 6px;
}
.sensor-choice-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; min-height: 46px; border-radius: 10px;
  border: 1px solid rgba(128,128,128,0.18);
  background: var(--cd-card);
  cursor: pointer; transition: border-color .15s, background .15s; touch-action: manipulation;
}
@media (hover: hover) {
  .sensor-choice-row:hover { border-color: var(--cd-accent); }
}
.sensor-choice-row.selected {
  border-color: var(--cd-accent);
  background: color-mix(in srgb, var(--cd-accent) 12%, transparent);
}
.sensor-choice-check { color: var(--cd-accent); display: grid; place-items: center; flex-shrink: 0; }
.sensor-choice-info { flex: 1; min-width: 0; }
.sensor-choice-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sensor-choice-id { font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Smoke Detector Tile (Normal OK & Alarm State) ── */
.tile.smoke[data-active="false"] .tile-state { color: #22c55e; font-weight: 500; }
.tile.smoke[data-alarm] {
  background: rgba(239, 68, 68, 0.24);
  border: 2px solid #ef4444;
  animation: cd-flash 1s infinite alternate;
}
.tile.smoke[data-alarm] .tile-icon {
  background: rgba(239, 68, 68, 0.32);
  color: #fff;
  animation: cd-shake .35s infinite;
}
.tile.smoke[data-alarm] .tile-state {
  color: #fecaca;
  font-weight: 700;
}

/* ── Pending Multi-Channel & Placement Styles ── */
.badge-tag.pending-channels {
  background: rgba(245, 158, 11, 0.16);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.channel-card[data-disabled="true"] {
  opacity: 0.62;
}

/* ── Apple-style "Neu in deinem Smart Home" Welcome Modal ── */
.overlay.wn-overlay {
  z-index: 1100;
  animation: wnOverlayFade .2s ease-out;
}
@keyframes wnOverlayFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.wn-dialog {
  width: min(490px, 100%);
  max-height: min(640px, calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom)));
  background: var(--cd-card);
  color: var(--primary-text-color, #e6e6e6);
  border-radius: 26px;
  border: 1px solid rgba(128, 128, 128, 0.22);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.48);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  animation: wnSheetDesktop .32s cubic-bezier(0.16, 1, 0.3, 1);
}
.wn-grabber {
  display: none;
  width: 38px;
  height: 5px;
  border-radius: 99px;
  background: rgba(128, 128, 128, 0.35);
  margin: 10px auto 0;
  flex: none;
}
.wn-close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 50%;
  border: 0;
  background: var(--cd-tile-bg);
  color: var(--cd-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  z-index: 2;
  touch-action: manipulation;
  transition: background .15s, color .15s, transform .1s;
}
.wn-close-btn ha-icon { --mdc-icon-size: 20px; }
@media (hover: hover) {
  .wn-close-btn:hover {
    color: var(--primary-text-color, inherit);
    background: rgba(128, 128, 128, 0.2);
  }
}
.wn-close-btn:active { transform: scale(0.92); }
.wn-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 28px 30px 18px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.wn-hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.wn-app-badge {
  width: 60px;
  height: 60px;
  border-radius: 17px;
  background: linear-gradient(145deg, var(--cd-accent, #03a9f4) 0%, color-mix(in srgb, var(--cd-accent, #03a9f4) 72%, #000) 100%);
  color: #ffffff;
  display: grid;
  place-items: center;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--cd-accent, #03a9f4) 34%, transparent);
  margin-bottom: 4px;
}
.wn-app-badge ha-icon { --mdc-icon-size: 32px; }
.wn-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.025em;
  color: var(--primary-text-color, inherit);
}
.wn-subtitle {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--cd-secondary);
  max-width: 36ch;
}
.wn-features {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.wn-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.wn-item-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex: none;
  display: grid;
  place-items: center;
  margin-top: 1px;
  background: var(--wn-item-bg, var(--cd-tile-bg));
  color: var(--wn-item-color, var(--cd-accent));
}
.wn-item-icon ha-icon { --mdc-icon-size: 21px; }
.wn-item-text {
  flex: 1;
  min-width: 0;
}
.wn-item-title {
  margin: 0 0 2px;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--primary-text-color, inherit);
}
.wn-item-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--cd-secondary);
}
.wn-foot {
  flex: none;
  padding: 14px 30px 24px;
  border-top: 1px solid rgba(128, 128, 128, 0.16);
  background: var(--cd-card);
}
.wn-cta {
  width: 100%;
  min-height: 48px;
  height: 48px;
  border-radius: 14px;
  border: 0;
  background: var(--cd-accent, #03a9f4);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  box-shadow: 0 6px 20px color-mix(in srgb, var(--cd-accent, #03a9f4) 30%, transparent);
  transition: transform .12s, filter .15s;
}
@media (hover: hover) {
  .wn-cta:hover { filter: brightness(1.06); }
}
.wn-cta:active { transform: scale(0.98); }
@keyframes wnSheetDesktop {
  from { opacity: 0; transform: translateY(14px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wnSheetMobile {
  from { opacity: 0; transform: translateY(42px); }
  to { opacity: 1; transform: translateY(0); }
}
@container cdpage (max-width: 560px) {
  .subview-head { padding: 12px; gap: 10px; }
  .subview-actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; }
  .subview-actions .btn { flex: 1 1 auto; min-height: 40px; padding: 0 12px; }
  .blinds-room-head { padding: 12px; gap: 8px; }
  .blinds-room-body { padding: 0 10px 10px; gap: 8px; }
  .blinds-room-title { font-size: calc(15px * var(--cd-scale)); }
  .blinds-room-actions { gap: 6px; }
  .blinds-room-actions .mini-btn { width: calc(36px * var(--cd-scale)); height: calc(36px * var(--cd-scale)); }
  .cover-detail-row { padding: 12px; gap: 10px; }
  .cover-detail-top { flex-wrap: wrap; gap: 10px; }
  .cover-detail-info { flex: 1 1 100%; }
  .cover-detail-name { font-size: calc(15px * var(--cd-scale)); white-space: normal; line-height: 1.25; }
  .cover-detail-state { font-size: calc(13.5px * var(--cd-scale)); }
  .cover-detail-row .tile-btns { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: none; }
  .cover-detail-row .mini-btn { width: 100%; height: calc(40px * var(--cd-scale)); border-radius: 12px; }
  .cover-detail-row .mini-btn ha-icon { --mdc-icon-size: calc(22px * var(--cd-scale)); }
  .cover-slider-wrap input[type=range].slider { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-runnable-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-thumb { height: 16px; margin-top: 6px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-thumb { height: 16px; }
}

@media (max-width: 650px) {
  .overlay.wn-overlay {
    align-items: flex-end;
    justify-content: center;
    padding: max(20px, var(--safe-top)) 0 0;
  }
  .wn-dialog {
    width: 100%;
    max-height: calc(100dvh - max(20px, var(--safe-top)));
    border-radius: 26px 26px 0 0;
    border-bottom: 0;
    border-left: 0;
    border-right: 0;
    animation: wnSheetMobile .32s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .wn-grabber { display: block; }
  .wn-close-btn { top: 12px; right: max(12px, var(--safe-right)); }
  .wn-scroll {
    padding: 12px calc(20px + var(--safe-right)) 14px calc(20px + var(--safe-left));
    gap: 16px;
  }
  .wn-app-badge { width: 52px; height: 52px; border-radius: 15px; }
  .wn-app-badge ha-icon { --mdc-icon-size: 28px; }
  .wn-title { font-size: 21px; }
  .wn-subtitle { font-size: 13px; }
  .wn-features { gap: 13px; }
  .wn-item-icon { width: 36px; height: 36px; border-radius: 10px; }
  .wn-item-icon ha-icon { --mdc-icon-size: 19px; }
  .wn-item-title { font-size: 14px; }
  .wn-item-desc { font-size: 12.5px; }
  .wn-foot {
    padding: 12px calc(20px + var(--safe-right)) calc(18px + var(--safe-bottom)) calc(20px + var(--safe-left));
  }
}
@media (max-height: 560px) {
  .wn-app-badge { width: 44px; height: 44px; border-radius: 13px; margin-bottom: 0; }
  .wn-app-badge ha-icon { --mdc-icon-size: 24px; }
  .wn-scroll { padding-top: 14px; gap: 12px; }
  .wn-title { font-size: 19px; }
  .wn-features { gap: 10px; }
}

/* ── Drag & Drop + Collapsible Room & Settings Accordions ── */
.reorder-list { display: grid; gap: 10px; min-width: 0; }
.reorder-items { display: grid; gap: 8px; min-width: 0; position: relative; }
.drag-handle {
  width: 34px; height: 38px; flex: none; display: grid; place-items: center;
  border-radius: 8px; color: var(--cd-secondary); cursor: grab;
  touch-action: none; user-select: none; -webkit-user-select: none;
  transition: background .15s, color .15s;
}
.drag-handle.small { width: 28px; height: 32px; }
.drag-handle:active { cursor: grabbing; color: var(--cd-accent); background: rgba(128,128,128,.14); }
.tile-drag-handle {
  display: none;
  flex: none; align-items: center; justify-content: center;
  width: 22px; height: 28px; margin-left: -4px; margin-right: -2px;
  border-radius: 6px; border: 0; padding: 0;
  background: transparent; color: var(--cd-secondary); cursor: grab;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.page[data-edit-mode] .tile-drag-handle { display: inline-flex; }
.tile-drag-handle:active { cursor: grabbing; color: var(--cd-accent); }
.tile[data-drop-target] {
  outline: 2px dashed var(--cd-accent);
  outline-offset: 2px;
}
[data-dragging] {
  position: relative; z-index: 20; opacity: 0.92;
  box-shadow: 0 10px 28px rgba(0,0,0,.45), 0 0 0 1.5px var(--cd-accent);
  pointer-events: none;
}
[data-drop-before] { box-shadow: inset 0 3px 0 var(--cd-accent); }
[data-drop-after] { box-shadow: inset 0 -3px 0 var(--cd-accent); }

.acc-toggle-head, .room-acc-head { cursor: pointer; user-select: none; gap: 8px; }
.acc-title-wrap { flex: 1; min-width: 0; display: grid; gap: 2px; }
.acc-sub, .room-acc-summary {
  font-size: 11px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-chevron {
  width: 28px; height: 28px; display: grid; place-items: center; flex: none;
  color: var(--cd-secondary); transition: transform .22s ease;
}
.open > .row-head .acc-chevron { transform: rotate(180deg); color: var(--cd-accent); }

.room-acc-icon {
  width: 34px; height: 34px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: color-mix(in srgb, var(--cd-accent) 16%, transparent); color: var(--cd-accent);
}
.room-acc-body {
  display: grid; gap: 14px; padding-top: 10px;
  border-top: 1px solid rgba(128,128,128,.16); min-width: 0;
}
.room-acc-footer { display: flex; justify-content: flex-start; padding-top: 4px; }
.room-settings-form { display: grid; gap: 12px; min-width: 0; }
.sub-tiles-list { gap: 6px; }
.sub-tile-card {
  border-radius: 10px; background: rgba(128,128,128,.08); padding: 4px 8px;
  display: grid; gap: 6px; min-width: 0;
}
.sub-tile-card .sub-tile { border-top: 0; padding: 2px 0; }
.sub-tile-card.is-hidden .st-name { opacity: .48; text-decoration: line-through; }
.sub-tile-users { padding: 6px 4px 8px; border-top: 1px solid rgba(128,128,128,.12); }

/* ── Per-User 3-Way Room Default Expand Pills ── */
.user-expand-list { display: grid; gap: 6px; min-width: 0; }
.user-expand-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px; border-radius: 10px; background: var(--cd-card);
  border: 1px solid rgba(128,128,128,.16); min-width: 0;
}
.user-expand-name {
  display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
  color: var(--primary-text-color, inherit); min-width: 0;
}
.user-expand-name ha-icon { --mdc-icon-size: 16px; color: var(--cd-secondary); flex: none; }
.tri-pills {
  display: inline-flex; padding: 2px; border-radius: 10px;
  background: var(--cd-tile-bg); border: 1px solid rgba(128,128,128,.18); gap: 2px;
}
.tri-pill {
  border: 0; background: transparent; color: var(--cd-secondary); font-size: 11px; font-weight: 600;
  padding: 5px 9px; min-height: 28px; border-radius: 8px; cursor: pointer;
  transition: background .15s, color .15s;
}
.tri-pill[data-active] {
  background: var(--cd-accent); color: #fff;
}

.inline-notice {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--cd-accent) 12%, var(--cd-tile-bg));
  border: 1px solid color-mix(in srgb, var(--cd-accent) 30%, transparent);
  font-size: 12px; font-weight: 500; color: var(--primary-text-color, inherit);
}
.inline-notice ha-icon { --mdc-icon-size: 18px; color: var(--cd-accent); flex: none; }

/* ── Bottom Navigation Enhancements ── */
.nav-btn[data-active] {
  background: var(--cd-accent); color: #fff;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--cd-accent) 38%, transparent);
}

/* ── Modern Redesign Subviews (Security, Solar, Auto, Blinds, 3D Print, More) ── */
.subview-page {
  display: flex; flex-direction: column; gap: 14px;
  width: 100%; max-width: 1060px; margin: 0 auto; padding: 0 2px 36px; min-width: 0;
  animation: cdFadeIn 0.2s ease-out;
}
.subview-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
  padding: 14px 16px; border-radius: var(--cd-radius); background: var(--cd-card);
  box-shadow: 0 4px 20px rgba(0,0,0,.22); min-width: 0;
}
.subview-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 200px; }
.subview-hero-icon {
  width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none;
  color: var(--view-color, var(--cd-accent));
  background: color-mix(in srgb, var(--view-color, var(--cd-accent)) 18%, transparent);
}
.subview-title { margin: 0; font-size: 19px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subview-sub { font-size: 12px; color: var(--cd-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subview-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.subview-section {
  background: var(--cd-card); border-radius: var(--cd-radius); padding: 14px;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0;
  box-shadow: 0 2px 14px rgba(0,0,0,.18);
}
.subview-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
}
.subview-section-title {
  display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700;
}
.subview-section-title ha-icon { --mdc-icon-size: 18px; color: var(--view-color, var(--cd-accent)); }

.kpi-grid {
  display: grid; gap: 10px; min-width: 0;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 175px), 1fr));
}
.kpi-card {
  background: var(--cd-tile-bg); border-radius: var(--cd-tile-radius, 12px);
  padding: 12px 14px; display: grid; gap: 4px; min-width: 0; cursor: pointer;
  border: 1px solid rgba(128,128,128,.12); transition: background .15s, border-color .15s;
}
@media (hover: hover) {
  .kpi-card:hover { border-color: rgba(128,128,128,.32); }
}
.kpi-top {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  font-size: 12px; font-weight: 600; color: var(--cd-secondary); letter-spacing: .1px;
}
.kpi-top span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpi-top ha-icon { --mdc-icon-size: 16px; color: var(--kpi-color, var(--cd-accent)); flex: none; }
.kpi-val { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpi-sub { font-size: 12px; color: var(--cd-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.badge-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: var(--cd-tile-bg); border: 1px solid var(--cd-border);
  color: var(--cd-text); white-space: nowrap;
}
.badge-chip ha-icon { --mdc-icon-size: 15px; flex: none; }
.empty-hint {
  padding: 18px 14px; border-radius: var(--cd-tile-radius, 12px);
  background: var(--cd-tile-bg); color: var(--cd-secondary);
  font-size: 13px; text-align: center; line-height: 1.45;
}
.section-label {
  font-size: 13px; font-weight: 700; color: var(--cd-secondary);
  padding: 2px 2px 0;
}
.filter-chips {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;
}
.filter-chip {
  display: inline-flex; align-items: center; gap: 5px; min-height: 32px;
  padding: 0 12px; border-radius: 999px; border: 1px solid var(--cd-border);
  background: var(--cd-tile-bg); color: var(--cd-text);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .14s, border-color .14s, color .14s;
}
.filter-chip[data-active] {
  background: color-mix(in srgb, var(--view-color, var(--cd-accent)) 18%, transparent);
  border-color: color-mix(in srgb, var(--view-color, var(--cd-accent)) 55%, transparent);
  color: var(--cd-text);
}
.blinds-room-card { gap: 0; padding: 0; overflow: hidden; }
.blinds-room-head {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 12px 14px; border: 0; background: transparent;
  cursor: pointer; text-align: left; min-width: 0;
}
.blinds-room-head-left {
  display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;
}
.blinds-room-head-left ha-icon { --mdc-icon-size: 18px; color: var(--view-color, var(--cd-accent)); flex: none; }
.blinds-room-title {
  font-size: 14px; font-weight: 700; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.blinds-room-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.blinds-room-chevron {
  --mdc-icon-size: 20px; color: var(--cd-secondary); transition: transform .18s ease; flex: none;
}
.blinds-room-card[data-open] .blinds-room-chevron { transform: rotate(180deg); }
.blinds-room-body {
  display: grid; gap: 8px; padding: 0 14px 14px; min-width: 0;
}
.blinds-room-body[hidden] { display: none; }

.smoke-alert-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 14px 16px; border-radius: var(--cd-radius);
  background: rgba(239, 68, 68, 0.22); border: 2px solid #ef4444;
  box-shadow: 0 0 22px rgba(239, 68, 68, 0.35);
  animation: cdSmokePulse 1.3s ease-in-out infinite alternate;
}
@keyframes cdSmokePulse {
  from { box-shadow: 0 0 10px rgba(239, 68, 68, 0.2); }
  to { box-shadow: 0 0 26px rgba(239, 68, 68, 0.55); }
}
.timer-digits { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: .5px; }

.alarm-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 16px; border-radius: var(--cd-radius); background: var(--cd-card);
  border: 1.5px solid color-mix(in srgb, var(--alarm-color, #4caf50) 40%, transparent);
}
.alarm-status-pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  font-size: 13px; font-weight: 700;
  background: color-mix(in srgb, var(--alarm-color, #4caf50) 18%, transparent);
  color: var(--alarm-color, #4caf50);
}
.alarm-modes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.alarm-mode-active {
  background: color-mix(in srgb, var(--alarm-color, var(--cd-accent)) 20%, transparent) !important;
  border-color: color-mix(in srgb, var(--alarm-color, var(--cd-accent)) 50%, transparent) !important;
  color: var(--cd-text) !important;
  opacity: .95 !important;
}

/* ── PIN Keypad Modal ── */
.pin-dialog {
  width: min(360px, calc(100vw - 24px - var(--safe-left) - var(--safe-right)));
  height: auto !important;
  min-height: 0 !important;
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px - var(--safe-top) - var(--safe-bottom));
  overflow: hidden;
}
.pin-dialog .dialog-body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 18px 16px;
}
.pin-mode-bar {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
}
.pin-mode-chip {
  appearance: none;
  border: 1px solid var(--cd-border);
  background: rgba(128,128,128,.12);
  color: var(--cd-text);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; font-family: inherit;
  transition: background .12s, border-color .12s, color .12s;
}
.pin-mode-chip ha-icon { --mdc-icon-size: 15px; }
.pin-mode-chip[data-selected] {
  background: color-mix(in srgb, var(--cd-accent) 20%, transparent);
  border-color: color-mix(in srgb, var(--cd-accent) 55%, transparent);
  color: var(--cd-accent);
}
.pin-mode-chip:disabled { opacity: .4; cursor: default; }
.pin-dots {
  display: flex; justify-content: center; gap: 12px; padding: 8px;
}
.pin-dots[data-shake] { animation: cdShake .35s ease; }
@keyframes cdShake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  50% { transform: translateX(8px); }
  75% { transform: translateX(-5px); }
}
.pin-dot {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(128,128,128,.45); background: transparent;
  transition: background .12s, border-color .12s, transform .12s;
}
.pin-dot[data-filled] {
  background: var(--cd-accent); border-color: var(--cd-accent); transform: scale(1.1);
}
.pin-error {
  text-align: center; font-size: 12px; font-weight: 600; color: #ef4444; min-height: 18px;
}
.pin-pad {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 4px 12px 8px;
}
.pin-key {
  height: 54px; border-radius: 14px; border: 1px solid rgba(128,128,128,.2);
  background: var(--cd-tile-bg); color: var(--primary-text-color, inherit);
  font-size: 20px; font-weight: 700; cursor: pointer; display: grid; place-items: center;
  transition: background .12s, transform .08s; touch-action: manipulation;
}
.pin-key:active { transform: scale(0.94); background: color-mix(in srgb, var(--cd-accent) 20%, var(--cd-tile-bg)); }

/* ── Camera Cards ── */
.camera-grid {
  display: grid; gap: 12px; min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
}
.camera-card {
  border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg); overflow: hidden;
  border: 1px solid rgba(128,128,128,.16); cursor: pointer;
}
.camera-frame {
  position: relative; aspect-ratio: 16 / 9; background: #0d0d10; display: grid; place-items: center; overflow: hidden;
}
.camera-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.camera-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; font-size: 13px; font-weight: 600;
}

/* ── Solar Flow & Trend SVGs ── */
.solar-svg-wrap { width: 100%; overflow: hidden; }
.solar-svg-wrap svg { display: block; width: 100%; height: auto; max-height: 290px; margin: 0 auto; }
.flow-line { fill: none; stroke-width: 3; stroke-linecap: round; opacity: .25; transition: opacity .3s; }
.flow-line[data-active] {
  opacity: .95; stroke-dasharray: 8 8; animation: cdFlowDash 1.1s linear infinite;
}
@keyframes cdFlowDash { to { stroke-dashoffset: -16; } }

/* ── More Hub & Progress Bars ── */
.more-grid {
  display: grid; gap: 10px; min-width: 0;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 215px), 1fr));
}
.more-tile {
  display: flex; align-items: center; gap: 12px; padding: 14px; min-height: 64px;
  border-radius: var(--cd-tile-radius, 12px); background: var(--cd-tile-bg);
  border: 1px solid rgba(128,128,128,.14); cursor: pointer; text-align: left; min-width: 0;
  transition: transform .12s, border-color .15s, background .15s;
}
.more-tile:active { transform: scale(0.97); }
@media (hover: hover) {
  .more-tile:hover { border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 10%, var(--cd-tile-bg)); }
}
.more-tile-icon {
  width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none;
  color: var(--tile-color, var(--cd-accent));
  background: color-mix(in srgb, var(--tile-color, var(--cd-accent)) 18%, transparent);
}
.progress-bar-track {
  width: 100%; height: 10px; border-radius: 999px; background: rgba(128,128,128,.22); overflow: hidden;
}
.progress-bar-fill {
  height: 100%; border-radius: 999px; background: var(--cd-accent); transition: width .35s ease;
}

.log-list { display: grid; gap: 6px; min-width: 0; }
.log-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border-radius: 10px; background: var(--cd-tile-bg); font-size: 12.5px; min-width: 0;
}
.log-row-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.log-row-time { flex: none; font-size: 11px; color: var(--cd-secondary); font-variant-numeric: tabular-nums; }

.iframe-card {
  width: 100%; min-height: 360px; border: 0; border-radius: 12px; background: #0f172a;
}

@container cdpage (max-width: 560px) {
  .subview-head { padding: 12px; gap: 10px; }
  .subview-actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; }
  .subview-actions .btn { flex: 1 1 auto; min-height: 40px; padding: 0 12px; }
  .blinds-room-head { padding: 12px; gap: 8px; }
  .blinds-room-body { padding: 0 10px 10px; gap: 8px; }
  .blinds-room-title { font-size: calc(15px * var(--cd-scale)); }
  .blinds-room-actions { gap: 6px; }
  .blinds-room-actions .mini-btn { width: calc(36px * var(--cd-scale)); height: calc(36px * var(--cd-scale)); }
  .cover-detail-row { padding: 12px; gap: 10px; }
  .cover-detail-top { flex-wrap: wrap; gap: 10px; }
  .cover-detail-info { flex: 1 1 100%; }
  .cover-detail-name { font-size: calc(15px * var(--cd-scale)); white-space: normal; line-height: 1.25; }
  .cover-detail-state { font-size: calc(13.5px * var(--cd-scale)); }
  .cover-detail-row .tile-btns { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: none; }
  .cover-detail-row .mini-btn { width: 100%; height: calc(40px * var(--cd-scale)); border-radius: 12px; }
  .cover-detail-row .mini-btn ha-icon { --mdc-icon-size: calc(22px * var(--cd-scale)); }
  .cover-slider-wrap input[type=range].slider { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-runnable-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-thumb { height: 16px; margin-top: 6px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-thumb { height: 16px; }
}

@media (max-width: 650px) {
  .room-detail-head { padding: 12px; gap: 10px; }
  .cover-detail-row { padding: 12px; gap: 10px; }
  .subview-head { padding: 12px; gap: 10px; }
  .subview-actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; }
  .subview-actions .btn { flex: 1 1 auto; min-height: 40px; padding: 0 12px; }
  .subview-section { padding: 12px; }
  .blinds-room-card { padding: 0; }
  .blinds-room-head { padding: 12px; gap: 8px; }
  .blinds-room-body { padding: 0 10px 10px; gap: 8px; }
  .nav { padding: 6px; gap: 4px; max-width: calc(100vw - 16px - var(--safe-left) - var(--safe-right)); }
  .nav-btn { padding: 0 12px; min-width: 44px; height: 42px; min-height: 42px; font-size: 12.5px; gap: 5px; }
}
@media (max-width: 520px) {
  .nav-btn:not([data-active]) { padding: 0 10px; min-width: 44px; }
  .nav-btn:not([data-active]) span { display: none; }
  .blinds-room-title { font-size: calc(15px * var(--cd-scale)); }
  .blinds-room-actions { gap: 6px; }
  .blinds-room-actions .mini-btn { width: calc(36px * var(--cd-scale)); height: calc(36px * var(--cd-scale)); }
  .cover-detail-top { flex-wrap: wrap; gap: 10px; }
  .cover-detail-info { flex: 1 1 100%; }
  .cover-detail-name { font-size: calc(15px * var(--cd-scale)); white-space: normal; line-height: 1.25; }
  .cover-detail-state { font-size: calc(13.5px * var(--cd-scale)); }
  .cover-detail-row .tile-btns { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: none; }
  .cover-detail-row .mini-btn { width: 100%; height: calc(40px * var(--cd-scale)); border-radius: 12px; }
  .cover-detail-row .mini-btn ha-icon { --mdc-icon-size: calc(22px * var(--cd-scale)); }
  .cover-slider-wrap input[type=range].slider { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-runnable-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-webkit-slider-thumb { height: 16px; margin-top: 6px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-track { height: 28px; border-radius: 14px; }
  .cover-slider-wrap input[type=range].slider::-moz-range-thumb { height: 16px; }
}

/* ── Smoke Detector Room & Home Alerts ── */
.smoke-header-chip {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--cd-secondary); opacity: .82;
}
.smoke-header-chip ha-icon { --mdc-icon-size: 14px; }
.smoke-header-chip.alert {
  opacity: 1; color: #fff; background: #dc2626;
  padding: 2px 8px; border-radius: 999px; font-weight: 700;
}
.card.room[data-smoke-alarm],
.room-detail-page[data-smoke-alarm] .room-detail-head {
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.34), rgba(153, 27, 27, 0.24)) !important;
  border-color: #ef4444 !important;
  box-shadow: 0 0 24px rgba(239, 68, 68, 0.38);
  animation: cdSmokePulse 1.3s ease-in-out infinite alternate;
}
.card.room[data-smoke-alarm] .room-name {
  color: #fecaca;
}
.smoke-home-banner {
  width: 100%; display: flex; flex-direction: column; gap: 10px;
  padding: 16px 18px; margin-bottom: 14px; border-radius: var(--cd-radius, 18px);
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  border: 2px solid #fca5a5; color: #ffffff;
  box-shadow: 0 10px 28px rgba(220, 38, 38, 0.38);
  cursor: pointer; text-align: left;
  transition: transform .14s ease, filter .14s ease;
  animation: cdSmokePulse 1.3s ease-in-out infinite alternate;
}
.smoke-home-banner:active { transform: scale(0.99); }
@media (hover: hover) {
  .smoke-home-banner:hover { filter: brightness(1.06); }
}
.smoke-home-banner-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
}
.smoke-home-banner-title {
  display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 800; color: #ffffff;
}
.smoke-home-banner-title ha-icon { --mdc-icon-size: 24px; color: #ffffff; }
.smoke-home-banner-sub {
  font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.92);
}
.smoke-home-rooms {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.smoke-home-room-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 12px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.32);
  color: #ffffff; font-size: 13px; font-weight: 700;
}
.smoke-home-room-pill ha-icon { --mdc-icon-size: 17px; color: #ffffff; }

/* ── Wizard Pre-Filter Cards ── */
.wizard-prefilter-grid {
  display: grid; gap: 12px; margin-top: 6px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
}
.wizard-prefilter-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  padding: 18px 16px; border-radius: 16px; text-align: left; cursor: pointer;
  background: var(--cd-tile-bg); border: 1.5px solid rgba(128,128,128,.2);
  transition: border-color .15s, background .15s, transform .12s;
}
.wizard-prefilter-card:active { transform: scale(0.98); }
@media (hover: hover) {
  .wizard-prefilter-card:hover {
    border-color: var(--cd-accent);
    background: color-mix(in srgb, var(--cd-accent) 10%, var(--cd-tile-bg));
  }
}
.wizard-prefilter-icon {
  width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--cd-accent) 16%, transparent);
  color: var(--cd-accent);
}
.wizard-prefilter-title { font-size: 15px; font-weight: 700; color: var(--cd-text); }
.wizard-prefilter-sub { font-size: 12.5px; color: var(--cd-secondary); line-height: 1.35; }
.wizard-filter-subbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;
}

/* ── Settings Badge Preview & Subview Edit Mode ── */
.badge-preview-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px;
  border-radius: 999px; font-size: 12.5px; font-weight: 600;
  background: color-mix(in srgb, var(--badge-color, var(--cd-accent)) 18%, var(--cd-tile-bg));
  border: 1px solid color-mix(in srgb, var(--badge-color, var(--cd-accent)) 45%, transparent);
  color: var(--cd-text);
}
.badge-preview-chip ha-icon { --mdc-icon-size: 15px; color: var(--badge-color, var(--cd-accent)); }
[data-edit-mode] {
  outline: 1.5px dashed color-mix(in srgb, var(--cd-accent) 70%, transparent);
  outline-offset: 2px;
  cursor: pointer !important;
}

/* ── Global Scale Selector & Scaled Secondary Cards ── */
.scale-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.scale-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 12px 10px;
  border-radius: 12px;
  border: 1.5px solid rgba(128,128,128,.22);
  background: var(--cd-tile-bg);
  color: inherit;
  cursor: pointer;
  text-align: center;
  transition: border-color .15s, background .15s, transform .1s;
}
.scale-card ha-icon { --mdc-icon-size: 22px; color: var(--cd-secondary); }
.scale-card-title { font-size: 13px; font-weight: 700; color: var(--cd-text); }
.scale-card-sub { font-size: 11px; color: var(--cd-secondary); line-height: 1.25; }
.scale-card[data-selected] {
  border-color: var(--cd-accent);
  background: color-mix(in srgb, var(--cd-accent) 16%, transparent);
}
.scale-card[data-selected] ha-icon { color: var(--cd-accent); }
.scale-card:active { transform: scale(0.97); }
@media (max-width: 480px) {
  .scale-options { grid-template-columns: minmax(0, 1fr); }
}

.alert-card { padding: calc(12px * var(--cd-pad-scale)) calc(14px * var(--cd-pad-scale)); gap: calc(12px * var(--cd-pad-scale)); }
.alert-card .a-title { font-size: calc(15px * var(--cd-scale)); }
.alert-card .a-sub { font-size: calc(12px * var(--cd-scale)); }
.announce-row { padding: calc(12px * var(--cd-pad-scale)) calc(14px * var(--cd-pad-scale)); gap: calc(12px * var(--cd-pad-scale)); }
.announce-name { font-size: calc(14px * var(--cd-scale)); }
.trash-card .bin { padding: calc(10px * var(--cd-pad-scale)) calc(14px * var(--cd-pad-scale)); gap: calc(12px * var(--cd-pad-scale)); }
.bin-label { font-size: calc(13px * var(--cd-scale)); }
.bin .when { font-size: calc(11.5px * var(--cd-scale)); }
.subview-head { padding: calc(14px * var(--cd-pad-scale)) calc(16px * var(--cd-pad-scale)); }
.subview-title { font-size: calc(19px * var(--cd-scale)); }
.room-detail-title { font-size: calc(20px * var(--cd-scale)); }
.kpi-val { font-size: calc(19px * var(--cd-scale)); }
.kpi-top { font-size: calc(12px * var(--cd-scale)); }
.kpi-sub { font-size: calc(12px * var(--cd-scale)); }
`;
