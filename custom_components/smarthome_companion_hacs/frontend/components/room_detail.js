// Room detail subview: dedicated granular control page for a single room.
import {
  h, icon, isActive,
} from '../lib/util.js';
import { Tile, GroupTile } from './tile.js';
import { effectiveCategory, applySmartTileLayout, GROUPS, average } from './room.js';
import { createCoverRow, updateCoverRow } from './cover_row.js';

export class RoomDetailView {
  constructor(roomSpec, ctx, onBack) {
    this.spec = roomSpec;
    this.ctx = { ...(ctx || {}), isDetail: true };
    this.onBack = onBack;
    this.hass = null;

    const tiles = roomSpec.tiles || [];
    // Partition by effective category (custom category takes priority!)
    this.coverSpecs = tiles.filter((t) => effectiveCategory(t) === 'cover');
    this.lightSpecs = tiles.filter((t) => effectiveCategory(t) === 'light');
    this.switchSpecs = tiles.filter((t) => ['switch', 'outlet', 'valve', 'pumpe'].includes(effectiveCategory(t)));
    this.mediaSpecs = tiles.filter((t) => effectiveCategory(t) === 'media_player');
    this.otherSpecs = tiles.filter((t) =>
      !['cover', 'light', 'switch', 'outlet', 'valve', 'pumpe', 'media_player'].includes(effectiveCategory(t)));

    const makeTileInstance = (t) => {
      if (t.is_group) return new GroupTile(t, this.ctx);
      return new Tile(t, this.ctx);
    };

    // Strict priority for non-cover devices: 1. Media, 2. Light, 3. Switches, 4. Other
    const otherDeviceSpecs = [
      ...this.mediaSpecs,
      ...this.lightSpecs,
      ...this.switchSpecs,
      ...this.otherSpecs,
    ];
    this.childTiles = otherDeviceSpecs.map(makeTileInstance);

    this._build();
  }

  _build() {
    const { spec } = this;

    // ── Header Left ──
    const titleWrap = h('div', { class: 'room-detail-title-wrap' },
      h('div', { class: 'icon' }, icon(spec.icon || 'mdi:home')),
      h('h2', { class: 'room-detail-title' }, spec.name));

    this.metaEl = h('div', { class: 'room-detail-meta' });

    // ── Header Right: Group Quick Action Controls (Identical to Room cards: Icon + active count badge) ──
    this.groups = GROUPS
      .map((g) => {
        let matchingTiles = [];
        if (g.key === 'light') matchingTiles = this.lightSpecs;
        else if (g.key === 'cover') matchingTiles = this.coverSpecs;
        else if (g.key === 'switch') matchingTiles = this.switchSpecs;
        const ids = [];
        const seen = new Set();
        for (const t of matchingTiles) {
          const eids = t.is_group && Array.isArray(t.entity_ids)
            ? t.entity_ids
            : (t.entity_id ? [t.entity_id] : []);
          for (const eid of eids) {
            if (eid && !seen.has(eid)) {
              seen.add(eid);
              ids.push(eid);
            }
          }
        }
        return {
          ...g,
          ids,
        };
      })
      .filter((g) => g.ids.length > 0)
      .map((g) => {
        const btn = h('button', {
          class: 'ctrl-btn', type: 'button', 'aria-label': g.label, title: g.label,
          style: { '--group-color': g.color },
          onClick: (e) => { e.stopPropagation(); this._toggleGroup(g); },
        }, icon(g.icon));
        return { ...g, btn };
      });

    this.actionsEl = h('div', { class: 'room-detail-actions' }, ...this.groups.map((g) => g.btn));

    const head = h('div', { class: 'room-detail-head' },
      h('div', { class: 'room-detail-left' }, titleWrap, this.metaEl),
      this.actionsEl);

    // ── Body: Unified Device Container ──
    const bodyChildren = [];

    // 1. Cover rows (granular position sliders & controls)
    if (this.coverSpecs.length > 0) {
      this.coverRows = this.coverSpecs.map((cSpec) => this._buildCoverRow(cSpec));
      const coverList = h('div', { class: 'cover-detail-list' }, ...this.coverRows.map((cr) => cr.row));
      bodyChildren.push(coverList);
    }

    // 2. All other tiles in responsive smart grid (Media, Lights, Switches, Others)
    if (this.childTiles.length > 0) {
      this.gridEl = h('div', { class: 'tile-grid' }, this.childTiles.map((t) => t.el));
      bodyChildren.push(this.gridEl);
      this._orderAndLayoutTiles();
    }

    const bodyCard = h('div', { class: 'card room-detail-body' }, ...bodyChildren);

    this.el = h('div', { class: 'room-detail-page' }, head, bodyCard);
  }

  _coverService(spec, action, data = {}) {
    const rawDom = domainOf(spec.entity_id);
    if (rawDom !== 'cover') {
      if (action === 'open_cover') return this.hass?.callService(rawDom, 'turn_on', { entity_id: spec.entity_id });
      if (action === 'close_cover') return this.hass?.callService(rawDom, 'turn_off', { entity_id: spec.entity_id });
      if (action === 'stop_cover') return this.hass?.callService(rawDom, 'turn_off', { entity_id: spec.entity_id });
    }
    return this.hass?.callService('cover', action, { entity_id: spec.entity_id, ...data });
  }

  _toggleGroup(group) {
    if (!this.hass) return;
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

  _buildCoverRow(spec) {
    return createCoverRow(spec, { getHass: () => this.hass, ctx: this.ctx });
  }

  update(hass) {
    this.hass = hass;

    // Group quick controls (clean icons only, no clipped numbers)
    if (this.groups) {
      for (const g of this.groups) {
        const states = g.ids.map((id) => hass.states[id]).filter(Boolean);
        const count = g.key === 'cover'
          ? states.filter((s) => s.state !== 'closed').length
          : states.filter((s) => isActive(s)).length;
        g.btn.toggleAttribute('data-on', count > 0);
      }
    }

    // Update child tiles
    this.childTiles.forEach((t) => t.update(hass));
    if (this.childTiles.length > 0) {
      this._orderAndLayoutTiles();
    }

    // Update covers with granular positions
    if (this.coverRows) {
      for (const cr of this.coverRows) {
        updateCoverRow(cr, hass);
      }
    }

    // Header sensor chips (only mutate DOM when sensor values change)
    const { sensors } = this.spec;
    const temp = sensors.temperature?.length ? average(hass, sensors.temperature) : null;
    const hum = sensors.humidity?.length ? average(hass, sensors.humidity) : null;
    const mot = (sensors.motion || []).some((id) => hass.states[id]?.state === 'on');
    const moi = (sensors.moisture || []).some((id) => hass.states[id]?.state === 'on');
    const chipKey = `${temp || ''}|${hum || ''}|${mot ? 1 : 0}|${moi ? 1 : 0}`;
    if (chipKey !== this._chipKey) {
      this._chipKey = chipKey;
      const chips = [];
      if (temp) chips.push(h('div', { class: 'room-detail-chip' }, icon('mdi:thermometer'), temp));
      if (hum) chips.push(h('div', { class: 'room-detail-chip' }, icon('mdi:water-percent'), hum));
      if (mot) chips.push(h('div', { class: 'room-detail-chip', style: { color: '#ffb74d' } }, icon('mdi:motion-sensor'), 'Bewegung'));
      if (moi) chips.push(h('div', { class: 'room-detail-chip', style: { color: '#e57373' } }, icon('mdi:water-alert'), 'Feuchtigkeit'));
      this.metaEl.replaceChildren(...chips);
    }
  }

  _orderAndLayoutTiles() {
    if (!this.gridEl || !this.childTiles.length) return;
    applySmartTileLayout(this.childTiles, this.gridEl);
  }
}
