// Room detail subview: dedicated granular control page for a single room.
import {
  h, icon, domainOf, numeric, isActive, isUnavailable, entityIcon, setSliderVal,
} from '../lib/util.js?v=2.8.18';
import { Tile, GroupTile } from './tile.js?v=2.8.18';
import { effectiveCategory, applySmartTileLayout } from './room.js?v=2.8.18';

const GROUPS = [
  { key: 'light', icon: 'mdi:lightbulb', label: 'Alle Lichter', color: '#ffc107' },
  { key: 'cover', icon: 'mdi:window-shutter', label: 'Alle Jalousien', color: '#9c27b0' },
  { key: 'switch', icon: 'mdi:power-plug', label: 'Alle Geräte & Steckdosen', color: '#2196f3' },
];

function average(hass, ids) {
  const values = ids.map((id) => numeric(hass.states[id])).filter((v) => v !== null);
  if (!values.length) return null;
  const unit = ids.map((id) => hass.states[id]?.attributes?.unit_of_measurement).find(Boolean) || '';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return `${avg.toFixed(1).replace(/\.0$/, '')}${unit ? ` ${unit}` : ''}`.replace(' %', '%').replace(' °', '°');
}

export class RoomDetailView {
  constructor(roomSpec, ctx, onBack) {
    this.spec = roomSpec;
    this.ctx = ctx;
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
      if (t.is_group) return new GroupTile(t, ctx);
      return new Tile(t, ctx);
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
      applySmartTileLayout(this.childTiles);
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
    const iconEl = icon('mdi:window-shutter');
    const nameEl = h('div', { class: 'cover-detail-name' }, spec.name);
    const stateEl = h('div', { class: 'cover-detail-state' }, 'Laden...');

    const mkBtn = (ic, lbl, fn) => h('button', {
      class: 'mini-btn', 'aria-label': lbl,
      onClick: (e) => { e.stopPropagation(); fn(); },
    }, icon(ic));

    const btnUp = mkBtn('mdi:arrow-up', 'Öffnen', () => this._coverService(spec, 'open_cover'));
    const btnStop = mkBtn('mdi:stop', 'Stopp', () => this._coverService(spec, 'stop_cover'));
    const btnDown = mkBtn('mdi:arrow-down', 'Schließen', () => this._coverService(spec, 'close_cover'));

    const slider = h('input', {
      type: 'range', class: 'slider', min: '0', max: '100', step: '1', 'aria-label': `${spec.name} Position`,
      style: { touchAction: 'none', '--tile-color': '#9c27b0' },
    });
    slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

    let dragging = false;
    slider.addEventListener('input', () => {
      dragging = true;
      setSliderVal(slider, slider.value);
      stateEl.textContent = `Position: ${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      dragging = false;
      const rawDom = domainOf(spec.entity_id);
      if (rawDom === 'cover') {
        this.hass?.callService('cover', 'set_cover_position', {
          entity_id: spec.entity_id,
          position: Number(slider.value),
        });
      } else {
        this.hass?.callService(rawDom, Number(slider.value) > 0 ? 'turn_on' : 'turn_off', {
          entity_id: spec.entity_id,
        });
      }
    });

    const sliderWrap = h('div', { class: 'cover-slider-wrap' },
      h('span', { class: 'cover-slider-label' }, '0%'),
      slider,
      h('span', { class: 'cover-slider-label' }, '100%'));

    const row = h('div', { class: 'cover-detail-row' },
      h('div', { class: 'cover-detail-top' },
        h('div', {
          class: 'cover-detail-info',
          onClick: () => {
            if (this.ctx?.isEditMode?.()) {
              const devId = spec.device_id || (spec.key?.includes(':') ? spec.key.split(':')[0] : null) || spec.entity_id;
              if (devId) { this.ctx.onOpenDevice?.(devId); return; }
            }
          },
        },
          h('div', { class: 'cover-detail-icon' }, iconEl),
          h('div', { class: 'cover-detail-texts' }, nameEl, stateEl)),
        h('div', { class: 'tile-btns' }, btnUp, btnStop, btnDown)),
      sliderWrap);

    row.addEventListener('pointerdown', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    row.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
        const devId = spec.device_id || (spec.key?.includes(':') ? spec.key.split(':')[0] : null) || spec.entity_id;
        if (devId) this.ctx.onOpenDevice?.(devId);
      }
    }, true);

    return {
      spec, row, iconEl, stateEl, slider, btnUp, btnStop, btnDown,
      get dragging() { return dragging; },
    };
  }

  update(hass) {
    this.hass = hass;

    // Group quick controls
    if (this.groups) {
      for (const g of this.groups) {
        const states = g.ids.map((id) => hass.states[id]).filter(Boolean);
        const count = g.key === 'cover'
          ? states.filter((s) => s.state !== 'closed').length
          : states.filter((s) => isActive(s)).length;
        g.btn.toggleAttribute('data-on', count > 0);
        g.countEl.hidden = count === 0;
        g.countEl.textContent = String(count);
      }
    }

    // Update child tiles
    this.childTiles.forEach((t) => t.update(hass));
    if (this.childTiles.length > 0) {
      applySmartTileLayout(this.childTiles);
    }

    // Update covers with granular positions
    if (this.coverRows) {
      for (const cr of this.coverRows) {
        const st = hass.states[cr.spec.entity_id];
        const unav = isUnavailable(st);
        cr.iconEl.setAttribute('icon', entityIcon(cr.spec.entity_id, st, cr.spec.icon, cr.spec.category));
        cr.btnUp.disabled = unav;
        cr.btnStop.disabled = unav;
        cr.btnDown.disabled = unav;
        cr.slider.disabled = unav;

        if (unav) {
          cr.stateEl.textContent = 'Nicht verfügbar';
          continue;
        }

        const pos = st?.attributes?.current_position != null ? Number(st.attributes.current_position) : null;
        const state = st?.state;
        const moving = state === 'opening' || state === 'closing';

        if (moving) {
          cr.stateEl.textContent = state === 'opening' ? 'Öffnet...' : 'Schließt...';
          cr.btnStop.style.color = '#9c27b0';
        } else {
          cr.btnStop.style.color = '';
          const posTxt = pos != null ? ` · ${pos}%` : '';
          cr.stateEl.textContent = (state === 'closed' ? 'Geschlossen' : 'Geöffnet') + posTxt;
        }

        if (pos != null && !cr.dragging) {
          setSliderVal(cr.slider, pos);
        }
      }
    }

    // Header sensors chips
    const { sensors } = this.spec;
    const chips = [];
    const temp = sensors.temperature?.length ? average(hass, sensors.temperature) : null;
    const hum = sensors.humidity?.length ? average(hass, sensors.humidity) : null;
    if (temp) chips.push(h('div', { class: 'room-detail-chip' }, icon('mdi:thermometer'), temp));
    if (hum) chips.push(h('div', { class: 'room-detail-chip' }, icon('mdi:water-percent'), hum));
    if ((sensors.motion || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('div', { class: 'room-detail-chip', style: { color: '#ffb74d' } }, icon('mdi:motion-sensor'), 'Bewegung'));
    }
    if ((sensors.moisture || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('div', { class: 'room-detail-chip', style: { color: '#e57373' } }, icon('mdi:water-alert'), 'Feuchtigkeit'));
    }
    this.metaEl.replaceChildren(...chips);
  }
}
