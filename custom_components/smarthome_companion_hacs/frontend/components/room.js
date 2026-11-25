// Room component: collapsible "expander" card with area header (sensors, alerts, group controls) and tiles.
import {
  h, icon, editBorder, domainOf, isActive, numeric, effectiveCategory, parseChannelKey,
  enableGridPointerReorder, moreInfo,
} from '../lib/util.js';
import { Tile, GroupTile } from './tile.js';

export { effectiveCategory };

export const GROUPS = [
  { key: 'light', icon: 'mdi:lightbulb', label: 'Alle Lichter', color: '#ffc107' },
  { key: 'switch', icon: 'mdi:power-plug', label: 'Alle Geräte & Steckdosen', color: '#2196f3' },
  { key: 'cover', icon: 'mdi:window-shutter', label: 'Alle Jalousien', color: '#9c27b0' },
];

export function average(hass, ids) {
  const values = ids.map((id) => numeric(hass.states[id])).filter((v) => v !== null);
  if (!values.length) return null;
  const unit = ids.map((id) => hass.states[id]?.attributes?.unit_of_measurement).find(Boolean) || '';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return `${avg.toFixed(1).replace(/\.0$/, '')}${unit ? ` ${unit}` : ''}`.replace(' %', '%').replace(' °', '°');
}

/**
 * Smart 2-per-row layout algorithm respecting slider vs compact tiles,
 * keeping a strictly stable order regardless of active/on/off state.
 * - Top wide tiles (Media Player/TV, covers) take full width.
 * - Compact non-slider tiles are paired cleanly 2-per-row together.
 * - Slider-capable tiles always take full row width (never paired with other tiles).
 * - Group tiles sit at the bottom in full width.
 */
export function applySmartTileLayout(tiles, grid = null) {
  if (!tiles || !tiles.length) {
    if (grid && grid.children.length) grid.replaceChildren();
    return;
  }

  // Preserve the exact tile order (pinned + drag-and-drop) while pairing consecutive
  // compact tiles 2-up (left/right). Explicit layoutMode ('compact' | 'wide') overrides
  // automatic hasSlider / isAlwaysWide defaults (except groups & grouped covers which stay wide).
  let pendingCompact = null;
  for (const t of tiles) {
    const isGroup = t.spec?.is_group || t.is_group === true || t.constructor?.name === 'GroupTile';
    const hardWide = isGroup || t.isForceOwnRow || t.constructor?.name === 'GroupedCoverTile';
    const mode = t.layoutMode ?? t.spec?.layout_mode ?? null;
    const isWide = hardWide || (mode === 'wide' ? true : mode === 'compact' ? false : (t.isAlwaysWide || t.hasSlider));
    if (isWide) {
      if (pendingCompact) {
        pendingCompact.setWide(true);
        pendingCompact = null;
      }
      t.setWide(true);
    } else if (!pendingCompact) {
      pendingCompact = t;
    } else {
      pendingCompact.setWide(false);
      t.setWide(false);
      pendingCompact = null;
    }
  }
  if (pendingCompact) {
    pendingCompact.setWide(true);
  }

  if (grid) {
    const current = Array.from(grid.children);
    const changed = current.length !== tiles.length || tiles.some((t, i) => current[i] !== t.el);
    if (changed) {
      grid.replaceChildren(...tiles.map((t) => t.el));
    }
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
    this.isAlwaysWide = true;
    this.hasSlider = false;
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
          const devId = firstCover?.device_id || parseChannelKey(firstCover?.key).deviceId || null;
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
          const devId = firstCover?.device_id || parseChannelKey(firstCover?.key).deviceId || null;
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
      class: 'mini-btn', 'aria-label': 'Details', title: 'Details',
      onClick: (e) => { e.stopPropagation(); this.ctx.onOpenRoom?.(this.roomSpec.area_id); },
    }, icon('mdi:arrow-right'));

    this.btns = h('div', { class: 'tile-btns' }, this.btnUp, this.btnStop, this.btnDown, this.btnDetail);
    this.dragHandle = h('button', {
      type: 'button',
      class: 'tile-drag-handle',
      'aria-label': 'Kachel verschieben',
      title: 'Kachel verschieben',
      onClick: (e) => e.stopPropagation(),
    }, icon('mdi:drag'));

    this.el = h('div', {
      class: 'tile grouped-cover wide',
      'data-active': 'true',
      'data-key': this.coverSpecs[0]?.key || `cover-group:${this.roomSpec.area_id}`,
    }, h('div', { class: 'tile-main' }, this.dragHandle, this.iconBtn, this.info, this.btns), editBorder(10));
    this.el.__tileInstance = this;

    this.el.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        if (e.target.closest('.tile-drag-handle')) return;
        e.stopPropagation();
        e.preventDefault();
        const firstCover = this.coverSpecs[0];
        const devId = firstCover?.device_id || parseChannelKey(firstCover?.key).deviceId || firstCover?.entity_id;
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

    const makeTileInstance = (t) => {
      if (t.is_group) return new GroupTile(t, ctx);
      return new Tile(t, ctx);
    };

    // Smart Rollladen Gruppierung:
    // Group covers only when there are >= 2 covers AND the room has >= 3 tiles total.
    const covers = spec.tiles.filter((t) => effectiveCategory(t) === 'cover');
    if (covers.length > 1 && spec.tiles.length >= 3) {
      this.groupedCover = new GroupedCoverTile(spec, covers, ctx);
      let insertedCover = false;
      this.tiles = [];
      for (const t of spec.tiles) {
        if (effectiveCategory(t) === 'cover') {
          if (!insertedCover) {
            this.tiles.push(this.groupedCover);
            insertedCover = true;
          }
        } else {
          this.tiles.push(makeTileInstance(t));
        }
      }
    } else {
      this.tiles = spec.tiles.map(makeTileInstance);
    }

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
        const collectIds = (list) => {
          const out = [];
          const seen = new Set();
          for (const t of list) {
            const eids = t.is_group && Array.isArray(t.entity_ids)
              ? t.entity_ids
              : (t.entity_id ? [t.entity_id] : []);
            for (const eid of eids) {
              if (eid && !seen.has(eid)) {
                seen.add(eid);
                out.push(eid);
              }
            }
          }
          return out;
        };
        return {
          ...g,
          ids: collectIds(matchingTiles),
        };
      })
      .filter((g) => g.ids.length > 0)
      .map((g) => {
        const btn = h('button', {
          class: 'ctrl-btn', 'aria-label': g.label,
          style: { '--group-color': g.color },
          onClick: (e) => { e.stopPropagation(); this._toggleGroup(g); },
        }, icon(g.icon));
        return { ...g, btn };
      });

    // Room detail view button (sub-menu navigation)
    this.detailBtn = h('button', {
      class: 'ctrl-btn', 'aria-label': `${spec.name} Details`, title: 'Details',
      onClick: (e) => { e.stopPropagation(); this.ctx.onOpenRoom?.(this.spec.area_id); },
    }, icon('mdi:arrow-right'));

    this.controlsEl = h('div', { class: 'room-controls' }, ...this.groups.map((g) => g.btn), this.detailBtn);

    this.head = h('div', {
      class: 'room-head', role: 'button', tabindex: '0', 'aria-expanded': String(this.open),
      onClick: () => {
        if (this.ctx?.isEditMode?.()) {
          this.ctx.onEditRoom?.(this.spec);
          return;
        }
        this._toggleOpen();
      },
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (this.ctx?.isEditMode?.()) this.ctx.onEditRoom?.(this.spec);
          else this._toggleOpen();
        }
      },
    },
      h('div', { class: 'room-icon' }, icon(spec.icon)),
      h('div', { class: 'room-title' }, h('div', { class: 'room-name' }, spec.name)),
      this.controlsEl,
      icon('mdi:chevron-down', 'chevron'),
      editBorder(17));

    // Capture clicks anywhere on the room header in Edit Mode (except chevron expand/collapse)
    this.head.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
        if (e.target.closest('.chevron')) {
          this._toggleOpen();
          return;
        }
        this.ctx.onEditRoom?.(this.spec);
      }
    }, true);

    this.grid = h('div', {
      class: 'tile-grid',
      'data-area-id': spec.area_id,
    }, this.tiles.map((t) => t.el));
    this.grid.__roomInstance = this;
    this.statusBar = h('div', { class: 'room-status-bar', hidden: true });
    this.el = h('div', {
      class: 'card room',
      'data-area-id': spec.area_id,
    },
      this.head,
      h('div', { class: 'room-body' }, h('div', { class: 'room-body-inner' }, this.grid)),
      this.statusBar);
    this.el.__roomInstance = this;
    this._applyOpen();
    applySmartTileLayout(this.tiles, this.grid);

    const serializeTiles = (tiles) => {
      const order = [];
      const layout = {};
      for (const t of tiles) {
        if (t instanceof GroupedCoverTile) {
          for (const c of (t.coverSpecs || [])) {
            if (c.key) {
              order.push(c.key);
              if (t.layoutMode === 'compact' || t.layoutMode === 'wide') layout[c.key] = t.layoutMode;
            }
          }
        } else if (t.spec?.key) {
          order.push(t.spec.key);
          if (t.layoutMode === 'compact' || t.layoutMode === 'wide') layout[t.spec.key] = t.layoutMode;
        }
      }
      return { order, layout };
    };

    let dragBaseline = null;
    const captureBaseline = () => {
      const root = this.grid.getRootNode?.() || document;
      const roomEls = Array.from(root.querySelectorAll('.room[data-area-id]'));
      const rooms = [];
      const modes = new Map();
      const wideBefore = new Map();
      const origTiles = new Map();
      for (const rEl of roomEls) {
        const rm = rEl.__roomInstance;
        if (!rm) continue;
        rooms.push(rm);
        origTiles.set(rm, [...rm.tiles]);
        for (const t of rm.tiles) {
          modes.set(t, t.layoutMode ?? null);
          wideBefore.set(t, !!t.isWide);
        }
      }
      return { rooms, modes, wideBefore, origTiles };
    };

    const restoreBaseline = (baseline) => {
      if (!baseline) return;
      for (const [t, mode] of baseline.modes.entries()) {
        t.layoutMode = mode;
      }
    };

    enableGridPointerReorder(this.grid, {
      itemSelector: '.tile',
      handleSelector: '.tile-drag-handle',
      isEnabled: () => !!this.ctx?.isEditMode?.(),
      onDragStart: () => {
        dragBaseline = captureBaseline();
      },
      onPreview: ({ itemEl, fromGrid, targetGrid, toIdx, intent, partnerEl }) => {
        if (!this.ctx?.isEditMode?.()) return;
        const itemTile = itemEl?.__tileInstance;
        const fromRoom = fromGrid?.__roomInstance || this;
        const toRoom = targetGrid?.__roomInstance || this;
        if (!itemTile || !fromRoom || !toRoom) return;

        if (!dragBaseline) dragBaseline = captureBaseline();
        restoreBaseline(dragBaseline);

        // Remove itemTile from whichever room currently holds it
        for (const rm of dragBaseline.rooms) {
          const idx = rm.tiles.indexOf(itemTile);
          if (idx >= 0) rm.tiles.splice(idx, 1);
        }

        const safeIdx = Math.max(0, Math.min(toRoom.tiles.length, toIdx));
        toRoom.tiles.splice(safeIdx, 0, itemTile);

        const isDragGroup = itemTile.spec?.is_group || itemTile.is_group === true || itemTile.constructor?.name === 'GroupTile' || itemTile instanceof GroupedCoverTile;
        const partnerTile = partnerEl?.__tileInstance || null;
        const isPartnerGroup = !partnerTile || partnerTile.spec?.is_group || partnerTile.is_group === true || partnerTile.constructor?.name === 'GroupTile' || partnerTile instanceof GroupedCoverTile;

        if (intent === 'compact' && !isDragGroup && !isPartnerGroup && partnerTile !== itemTile) {
          itemTile.layoutMode = 'compact';
          partnerTile.layoutMode = 'compact';
          const wasPartnerWide = dragBaseline.wideBefore.get(partnerTile) === true;
          if (wasPartnerWide) {
            const pairStart = Math.min(toRoom.tiles.indexOf(itemTile), toRoom.tiles.indexOf(partnerTile));
            let compactRun = 0;
            for (let i = 0; i < pairStart; i++) {
              const t = toRoom.tiles[i];
              const tGroup = t.spec?.is_group || t.is_group === true || t.constructor?.name === 'GroupTile' || t instanceof GroupedCoverTile;
              const m = t.layoutMode ?? null;
              const tWide = tGroup || (m === 'wide' ? true : m === 'compact' ? false : (t.isAlwaysWide || t.hasSlider));
              if (tWide) compactRun = 0;
              else compactRun += 1;
            }
            if (compactRun % 2 === 1 && pairStart > 0) {
              for (let i = pairStart - 1; i >= 0; i--) {
                const t = toRoom.tiles[i];
                if ((t.layoutMode ?? null) !== 'compact') {
                  t.layoutMode = 'wide';
                  break;
                }
              }
            }
          }
        } else if (intent === 'wide' && !isDragGroup) {
          itemTile.layoutMode = 'wide';
        }

        if (fromRoom !== toRoom) {
          applySmartTileLayout(fromRoom.tiles, fromRoom.grid);
        }
        applySmartTileLayout(toRoom.tiles, toRoom.grid);
      },
      onCancel: () => {
        if (!dragBaseline) return;
        for (const [t, mode] of dragBaseline.modes.entries()) {
          t.layoutMode = mode;
        }
        for (const rm of dragBaseline.rooms) {
          const orig = dragBaseline.origTiles.get(rm);
          if (orig) rm.tiles = [...orig];
          applySmartTileLayout(rm.tiles, rm.grid);
        }
        dragBaseline = null;
      },
      onReorder: ({ itemEl, sourceGrid, targetGrid }) => {
        const baseline = dragBaseline;
        dragBaseline = null;
        if (!this.ctx?.isEditMode?.()) return;
        const sourceRoom = sourceGrid?.__roomInstance || this;
        const targetRoom = targetGrid?.__roomInstance || this;
        const itemTile = itemEl?.__tileInstance;

        if (sourceRoom === targetRoom) {
          applySmartTileLayout(targetRoom.tiles, targetRoom.grid);
          const { order, layout } = serializeTiles(targetRoom.tiles);
          this.ctx?.hass?.callWS({
            type: 'smarthome_companion/dashboard/tile_order',
            area_id: targetRoom.spec.area_id,
            tile_order: order,
            tile_layout: layout,
          }).catch(() => {});
          return;
        }

        applySmartTileLayout(sourceRoom.tiles, sourceRoom.grid);
        applySmartTileLayout(targetRoom.tiles, targetRoom.grid);
        const srcSer = serializeTiles(sourceRoom.tiles);
        const dstSer = serializeTiles(targetRoom.tiles);
        this.ctx?.onMoveTileToRoom?.({
          tile: itemTile,
          fromAreaId: sourceRoom.spec.area_id,
          toAreaId: targetRoom.spec.area_id,
          sourceOrder: srcSer.order,
          sourceLayout: srcSer.layout,
          targetOrder: dstSer.order,
          targetLayout: dstSer.layout,
        });
      },
    });
  }

  setOpen(open) {
    if (this.spec.always_open && !open) return;
    this.ctx.openState.set(this.spec.area_id, !!open);
    this._applyOpen();
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
      const coverIds = [];
      const otherIds = [];
      for (const id of group.ids) {
        if (domainOf(id) === 'cover') coverIds.push(id);
        else otherIds.push(id);
      }
      if (coverIds.length) {
        this.hass.callService('cover', targetService, { entity_id: coverIds });
      }
      if (otherIds.length) {
        this.hass.callService('homeassistant', targetService === 'close_cover' ? 'turn_off' : 'turn_on', { entity_id: otherIds });
      }
    } else {
      const anyOn = states.some((s) => isActive(s));
      const targetService = anyOn ? 'turn_off' : 'turn_on';
      const lightIds = [];
      const valveIds = [];
      const genericIds = [];
      for (const id of group.ids) {
        const dom = domainOf(id);
        if (dom === 'light') lightIds.push(id);
        else if (dom === 'valve') valveIds.push(id);
        else genericIds.push(id);
      }
      if (lightIds.length) {
        this.hass.callService('light', targetService, { entity_id: lightIds });
      }
      if (genericIds.length) {
        this.hass.callService('homeassistant', targetService, { entity_id: genericIds });
      }
      if (valveIds.length) {
        this.hass.callService('valve', targetService === 'turn_on' ? 'open_valve' : 'close_valve', { entity_id: valveIds });
      }
    }
  }

  update(hass) {
    this.hass = hass;
    this.tiles.forEach((t) => t.update(hass));
    applySmartTileLayout(this.tiles, this.grid);

    // Group controls
    for (const g of this.groups) {
      const states = g.ids.map((id) => hass.states[id]).filter(Boolean);
      const count = g.key === 'cover'
        ? states.filter((s) => s.state !== 'closed').length
        : states.filter((s) => isActive(s)).length;
      g.btn.toggleAttribute('data-on', count > 0);
    }

    // Bottom compact status bar (configured room sensors + smoke/motion alerts)
    const { sensors } = this.spec;
    const isSensorOn = (id) => {
      const st = hass.states[id];
      if (!st) return false;
      const v = String(st.state || '').toLowerCase();
      return isActive(st) || ['on', 'home', 'detected', 'occupied', 'true'].includes(v);
    };
    const isSmokeTriggered = (id) => {
      const st = hass.states[id];
      if (!st) return false;
      const v = String(st.state || '').toLowerCase();
      return ['on', 'detected', 'smoke', 'alarm', 'true'].includes(v);
    };

    const barSmokeIds = Array.isArray(sensors.smoke) ? sensors.smoke : [];
    const tileSmokeIds = (this.spec.tiles || [])
      .filter((t) => effectiveCategory(t) === 'rauchmelder' && t.entity_id)
      .map((t) => t.entity_id);
    const allSmokeIds = Array.from(new Set([...barSmokeIds, ...tileSmokeIds]));
    const smokeTriggered = allSmokeIds.some(isSmokeTriggered);
    this.el.toggleAttribute('data-smoke-alarm', smokeTriggered);

    const statusEntries = [];
    const pushStatus = ({ ic, val, color, alert = false, entityId = null, title = '' }) => {
      statusEntries.push({
        key: `${ic}|${val}|${alert ? 1 : 0}|${color || ''}`,
        node: h('button', {
          type: 'button',
          class: `room-status-item${alert ? ' alert' : ''}`,
          title: title || undefined,
          style: color ? { '--status-color': color } : undefined,
          onClick: (e) => {
            e.stopPropagation();
            if (this.ctx?.isEditMode?.()) {
              this.ctx.onEditRoom?.(this.spec);
              return;
            }
            if (entityId) moreInfo(this.el, entityId);
          },
        },
        h('span', { class: 'room-status-badge' }, icon(ic)),
        h('span', { class: 'room-status-val' }, val)),
      });
    };

    if (barSmokeIds.length > 0) {
      const barSmokeAlarm = barSmokeIds.some(isSmokeTriggered);
      pushStatus({
        ic: barSmokeAlarm ? 'mdi:smoke-detector-alert' : 'mdi:smoke-detector',
        val: barSmokeAlarm ? 'Alarm!' : 'OK',
        color: barSmokeAlarm ? '#ef4444' : '#22c55e',
        alert: barSmokeAlarm,
        entityId: barSmokeIds[0],
        title: barSmokeAlarm ? 'Rauchalarm!' : 'Rauchmelder OK',
      });
    }

    const temp = sensors.temperature?.length ? average(hass, sensors.temperature) : null;
    if (temp) {
      pushStatus({
        ic: 'mdi:thermometer',
        val: temp,
        color: '#ff7043',
        entityId: sensors.temperature[0],
        title: 'Temperatur',
      });
    }

    const hum = sensors.humidity?.length ? average(hass, sensors.humidity) : null;
    if (hum) {
      pushStatus({
        ic: 'mdi:water-percent',
        val: hum,
        color: '#29b6f6',
        entityId: sensors.humidity[0],
        title: 'Luftfeuchtigkeit',
      });
    }

    const moistIds = sensors.moisture || [];
    const numericMoistIds = moistIds.filter((id) => numeric(hass.states[id]) !== null);
    const binaryMoistIds = moistIds.filter((id) => numeric(hass.states[id]) === null);
    const moistAvg = numericMoistIds.length ? average(hass, numericMoistIds) : null;
    if (moistAvg) {
      pushStatus({
        ic: 'mdi:sprout',
        val: moistAvg,
        color: '#4caf50',
        entityId: numericMoistIds[0],
        title: 'Bodenfeuchtigkeit',
      });
    }
    if (binaryMoistIds.length > 0) {
      const wet = binaryMoistIds.some(isSensorOn);
      pushStatus({
        ic: 'mdi:water-alert',
        val: wet ? 'Feucht' : 'Trocken',
        color: wet ? '#ef4444' : '#26c6da',
        alert: wet,
        entityId: binaryMoistIds[0],
        title: 'Feuchtigkeitsmelder',
      });
    }

    const motionIds = sensors.motion || [];
    if (motionIds.length > 0) {
      const motionActive = motionIds.some(isSensorOn);
      pushStatus({
        ic: motionActive ? 'mdi:motion-sensor' : 'mdi:motion-sensor-off',
        val: motionActive ? 'Bewegung' : 'Ruhig',
        color: motionActive ? '#e91e63' : '#9b9b9b',
        alert: motionActive,
        entityId: motionIds[0],
        title: 'Bewegung / Anwesenheit',
      });
    }

    const key = `${statusEntries.map((x) => x.key).join('||')}|${smokeTriggered ? 1 : 0}`;
    if (key !== this._statusKey) {
      this._statusKey = key;
      this.statusBar.replaceChildren(...statusEntries.map((x) => x.node));
      this.statusBar.hidden = statusEntries.length === 0;
    }
  }
}
