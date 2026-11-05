// Room component: collapsible "expander" card with area header (sensors, alerts, group controls) and tiles.
import {
  h, icon, domainOf, isActive, numeric, effectiveCategory,
} from '../lib/util.js';
import { Tile } from './tile.js';

export { effectiveCategory };

const GROUPS = [
  { key: 'light', icon: 'mdi:lightbulb', label: 'Alle Lichter', color: '#ffc107' },
  { key: 'switch', icon: 'mdi:power-plug', label: 'Alle Geräte & Steckdosen', color: '#2196f3' },
  { key: 'cover', icon: 'mdi:window-shutter', label: 'Alle Jalousien', color: '#9c27b0' },
];

function average(hass, ids) {
  const values = ids.map((id) => numeric(hass.states[id])).filter((v) => v !== null);
  if (!values.length) return null;
  const unit = ids.map((id) => hass.states[id]?.attributes?.unit_of_measurement).find(Boolean) || '';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return `${avg.toFixed(1).replace(/\.0$/, '')}${unit ? ` ${unit}` : ''}`.replace(' %', '%').replace(' °', '°');
}

/**
 * Smart 2-per-row pairing layout algorithm.
 * Pairs compact/half tiles side-by-side (2 in a row).
 * Expands any odd leftover half tile to full-width (span 2) so no empty gap exists.
 */
export function applySmartTileLayout(tiles) {
  let halfPending = null;
  for (const t of tiles) {
    const wide = t.isWide;
    if (wide) {
      if (halfPending) {
        halfPending.setWide(true);
        halfPending = null;
      }
      t.setWide(true);
    } else {
      if (halfPending) {
        halfPending.setWide(false);
        t.setWide(false);
        halfPending = null;
      } else {
        halfPending = t;
      }
    }
  }
  if (halfPending) {
    halfPending.setWide(true);
  }
}

/**
 * Smart Grouped Cover Tile for rooms with > 1 shutter.
 * Simultaneously operates all shutters in the room and opens the room subview on click.
 */
export class GroupedCoverTile {
  constructor(roomSpec, coverSpecs, ctx) {
    this.roomSpec = roomSpec;
    this.coverSpecs = coverSpecs;
    this.ctx = ctx;
    this.hass = null;
    this.entityIds = coverSpecs.map((c) => c.entity_id);
    this.isWide = true;
    this._build();
  }

  setWide(wide) {
    this.el.classList.toggle('wide', !!wide);
  }

  _build() {
    this.iconEl = icon('mdi:window-shutter');
    this.iconBtn = h('button', {
      class: 'tile-icon',
      style: { color: '#9c27b0', background: 'rgba(156, 39, 176, 0.18)' },
      onClick: (e) => {
        e.stopPropagation();
        if (this.ctx?.isEditMode?.()) {
          const firstCover = this.coverSpecs[0];
          const devId = firstCover?.device_id || (firstCover?.key?.includes(':') ? firstCover.key.split(':')[0] : null);
          if (devId) { this.ctx.onOpenDevice?.(devId); return; }
        }
        this.ctx.onOpenRoom?.(this.roomSpec.area_id);
      },
    }, this.iconEl);

    this.nameEl = h('div', { class: 'tile-name' }, 'Rollläden');
    this.stateEl = h('div', { class: 'tile-state' }, `${this.coverSpecs.length} Rollläden`);
    this.info = h('div', {
      class: 'tile-info',
      onClick: () => {
        if (this.ctx?.isEditMode?.()) {
          const firstCover = this.coverSpecs[0];
          const devId = firstCover?.device_id || (firstCover?.key?.includes(':') ? firstCover.key.split(':')[0] : null);
          if (devId) { this.ctx.onOpenDevice?.(devId); return; }
        }
        this.ctx.onOpenRoom?.(this.roomSpec.area_id);
      },
    }, this.nameEl, this.stateEl);

    const mk = (ic, label, fn) => h('button', {
      class: 'mini-btn', 'aria-label': label,
      onClick: (e) => { e.stopPropagation(); fn(); },
    }, icon(ic));

    this.btnUp = mk('mdi:arrow-up', 'Alle öffnen', () => this._service('open'));
    this.btnStop = mk('mdi:stop', 'Alle stoppen', () => this._service('stop'));
    this.btnDown = mk('mdi:arrow-down', 'Alle schließen', () => this._service('close'));

    this.btnDetail = h('button', {
      class: 'mini-btn', 'aria-label': 'Details', title: 'Einzelne Rollläden anzeigen',
      onClick: (e) => { e.stopPropagation(); this.ctx.onOpenRoom?.(this.roomSpec.area_id); },
    }, icon('mdi:arrow-right'));

    this.btns = h('div', { class: 'tile-btns' }, this.btnUp, this.btnStop, this.btnDown, this.btnDetail);

    this.el = h('div', {
      class: 'tile grouped-cover wide',
      'data-active': 'true',
    }, h('div', { class: 'tile-main' }, this.iconBtn, this.info, this.btns));

    this.el.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
        const firstCover = this.coverSpecs[0];
        const devId = firstCover?.device_id || (firstCover?.key?.includes(':') ? firstCover.key.split(':')[0] : null) || firstCover?.entity_id;
        if (devId) this.ctx.onOpenDevice?.(devId);
      }
    }, true);
  }

  _service(cmd) {
    if (!this.hass) return;
    const byDomain = {};
    for (const id of this.entityIds) {
      const d = domainOf(id);
      (byDomain[d] ||= []).push(id);
    }
    for (const [dom, ids] of Object.entries(byDomain)) {
      if (dom === 'cover') {
        this.hass.callService('cover', cmd === 'stop' ? 'stop_cover' : `${cmd}_cover`, { entity_id: ids });
      } else {
        const svc = cmd === 'stop' ? 'turn_off' : cmd === 'open' ? 'turn_on' : 'turn_off';
        this.hass.callService(dom, svc, { entity_id: ids });
      }
    }
  }

  update(hass) {
    this.hass = hass;
    const states = this.entityIds.map((id) => hass.states[id]).filter(Boolean);
    const openCount = states.filter((s) => s.state !== 'closed' && s.state !== 'unavailable').length;
    const closedCount = states.filter((s) => s.state === 'closed').length;
    const moving = states.some((s) => s.state === 'opening' || s.state === 'closing');

    if (moving) {
      this.stateEl.textContent = 'In Bewegung...';
      this.btnStop.style.color = '#9c27b0';
      this.btnStop.style.background = 'rgba(156, 39, 176, 0.25)';
    } else {
      this.btnStop.style.color = '';
      this.btnStop.style.background = '';
      if (openCount === states.length && states.length > 0) {
        this.stateEl.textContent = 'Alle geöffnet';
      } else if (closedCount === states.length && states.length > 0) {
        this.stateEl.textContent = 'Alle geschlossen';
      } else {
        this.stateEl.textContent = `${closedCount} geschlossen · ${openCount} geöffnet`;
      }
    }
  }
}

export class Room {
  /**
   * @param {object} spec  room from backend layout
   * @param {object} ctx   {presets, openState: Map<string, boolean>, onOpenRoom: (areaId) => void}
   */
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.hass = null;

    // Smart Rollladen Gruppierung:
    // If room has > 1 cover, group them into a single master GroupedCoverTile
    const covers = spec.tiles.filter((t) => effectiveCategory(t) === 'cover');
    if (covers.length > 1) {
      this.groupedCover = new GroupedCoverTile(spec, covers, ctx);
      const nonCovers = spec.tiles.filter((t) => effectiveCategory(t) !== 'cover');
      this.tiles = [this.groupedCover, ...nonCovers.map((t) => new Tile(t, ctx))];
    } else {
      this.tiles = spec.tiles.map((t) => new Tile(t, ctx));
    }

    // Strict priority in room: 1. Jalousien (Rollläden), 2. Medien / TV, 3. Der Rest
    const tileWeight = (t) => {
      if (t instanceof GroupedCoverTile) return 0;
      const cat = effectiveCategory(t);
      if (cat === 'cover') return 0;
      if (cat === 'media_player') return 1;
      if (cat === 'light') return 2;
      if (cat === 'outlet') return 3;
      if (cat === 'switch') return 4;
      return 5;
    };
    this.tiles.sort((a, b) => tileWeight(a) - tileWeight(b));

    this._build();
  }

  get open() {
    if (this.spec.always_open) return true;
    const saved = this.ctx.openState.get(this.spec.area_id);
    return saved === undefined ? !!this.spec.expanded : saved;
  }

  _build() {
    const { spec } = this;

    // Group controls (all lights / switches / covers of this room based on effective category)
    this.groups = GROUPS
      .map((g) => {
        let matchingTiles = [];
        if (g.key === 'light') {
          matchingTiles = spec.tiles.filter((t) => effectiveCategory(t) === 'light');
        } else if (g.key === 'switch') {
          matchingTiles = spec.tiles.filter((t) => ['switch', 'outlet', 'valve', 'pumpe'].includes(effectiveCategory(t)));
        } else if (g.key === 'cover') {
          matchingTiles = spec.tiles.filter((t) => effectiveCategory(t) === 'cover');
        }
        return {
          ...g,
          ids: matchingTiles.map((t) => t.entity_id),
        };
      })
      .filter((g) => g.ids.length > 0)
      .map((g) => {
        const countEl = h('span', { class: 'count', hidden: true });
        const btn = h('button', {
          class: 'ctrl-btn', 'aria-label': g.label,
          style: { '--group-color': g.color },
          onClick: (e) => { e.stopPropagation(); this._toggleGroup(g); },
        }, icon(g.icon), countEl);
        return { ...g, btn, countEl };
      });

    // Room detail view button (sub-menu navigation)
    this.detailBtn = h('button', {
      class: 'ctrl-btn', 'aria-label': `${spec.name} Details`, title: `${spec.name} öffnen`,
      onClick: (e) => { e.stopPropagation(); this.ctx.onOpenRoom?.(this.spec.area_id); },
    }, icon('mdi:arrow-right'));

    this.metaEl = h('div', { class: 'room-meta', hidden: true });
    this.controlsEl = h('div', { class: 'room-controls' }, ...this.groups.map((g) => g.btn), this.detailBtn);

    this.head = h('div', {
      class: 'room-head', role: 'button', tabindex: '0', 'aria-expanded': String(this.open),
      onClick: () => this._toggleOpen(),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleOpen(); } },
    },
    h('div', { class: 'room-icon' }, icon(spec.icon)),
    h('div', { class: 'room-title' }, h('div', { class: 'room-name' }, spec.name), this.metaEl),
    this.controlsEl,
    icon('mdi:chevron-down', 'chevron'));

    this.grid = h('div', { class: 'tile-grid' }, this.tiles.map((t) => t.el));
    this.el = h('div', { class: 'card room' },
      this.head,
      h('div', { class: 'room-body' }, h('div', { class: 'room-body-inner' }, this.grid)));
    this._applyOpen();
    applySmartTileLayout(this.tiles);
  }

  _applyOpen() {
    this.el.toggleAttribute('data-open', this.open);
    this.el.toggleAttribute('data-always', !!this.spec.always_open);
    this.head.setAttribute('aria-expanded', String(this.open));
  }

  _toggleOpen() {
    if (this.spec.always_open) return;
    this.ctx.openState.set(this.spec.area_id, !this.open);
    this._applyOpen();
  }

  _toggleGroup(group) {
    const states = group.ids.map((id) => this.hass.states[id]).filter(Boolean);
    if (group.key === 'cover') {
      const anyOpen = states.some((s) => s.state !== 'closed');
      const targetService = anyOpen ? 'close_cover' : 'open_cover';
      for (const id of group.ids) {
        const dom = domainOf(id);
        if (dom === 'cover') {
          this.hass.callService('cover', targetService, { entity_id: id });
        } else {
          this.hass.callService(dom, targetService === 'close_cover' ? 'turn_off' : 'turn_on', { entity_id: id });
        }
      }
    } else {
      const anyOn = states.some((s) => isActive(s));
      const targetService = anyOn ? 'turn_off' : 'turn_on';
      const byDomain = {};
      for (const id of group.ids) {
        const dom = domainOf(id);
        (byDomain[dom] ||= []).push(id);
      }
      for (const [dom, ids] of Object.entries(byDomain)) {
        if (['light', 'switch', 'input_boolean'].includes(dom)) {
          this.hass.callService(dom, targetService, { entity_id: ids });
        } else if (dom === 'valve') {
          this.hass.callService('valve', targetService === 'turn_on' ? 'open_valve' : 'close_valve', { entity_id: ids });
        } else {
          this.hass.callService('homeassistant', targetService, { entity_id: ids });
        }
      }
    }
  }

  update(hass) {
    this.hass = hass;
    this.tiles.forEach((t) => t.update(hass));
    applySmartTileLayout(this.tiles);

    // Group controls
    for (const g of this.groups) {
      const states = g.ids.map((id) => hass.states[id]).filter(Boolean);
      const count = g.key === 'cover'
        ? states.filter((s) => s.state !== 'closed').length
        : states.filter((s) => isActive(s)).length;
      g.btn.toggleAttribute('data-on', count > 0);
      g.countEl.hidden = count === 0;
      g.countEl.textContent = String(count);
    }

    // Header meta: temperature, humidity, alerts
    const { sensors } = this.spec;
    const chips = [];
    const temp = sensors.temperature?.length ? average(hass, sensors.temperature) : null;
    const hum = sensors.humidity?.length ? average(hass, sensors.humidity) : null;
    if (temp) chips.push(h('span', {}, icon('mdi:thermometer'), temp));
    if (hum) chips.push(h('span', {}, icon('mdi:water-percent'), hum));
    if ((sensors.motion || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('span', { class: 'alert' }, icon('mdi:motion-sensor'), 'Bewegung'));
    }
    if ((sensors.moisture || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('span', { class: 'alert' }, icon('mdi:water-alert'), 'Feuchtigkeit'));
    }
    const key = chips.map((c) => c.textContent).join('|');
    if (key !== this._metaKey) {
      this._metaKey = key;
      this.metaEl.replaceChildren(...chips);
      this.metaEl.hidden = chips.length === 0;
    }
  }
}
