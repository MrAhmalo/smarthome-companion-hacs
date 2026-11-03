// Room detail subview: dedicated granular control page for a single room.
import {
  h, icon, domainOf, numeric, isActive, isUnavailable,
} from '../lib/util.js';
import { Tile } from './tile.js';
import { effectiveCategory, applySmartTileLayout } from './room.js';

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
    this.switchSpecs = tiles.filter((t) => ['switch', 'outlet'].includes(effectiveCategory(t)));
    this.mediaSpecs = tiles.filter((t) => effectiveCategory(t) === 'media_player');
    this.otherSpecs = tiles.filter((t) =>
      !['cover', 'light', 'switch', 'outlet', 'media_player'].includes(effectiveCategory(t)));

    // Strict priority for non-cover devices: 1. Media, 2. Light, 3. Switches, 4. Other
    const otherDeviceSpecs = [
      ...this.mediaSpecs,
      ...this.lightSpecs,
      ...this.switchSpecs,
      ...this.otherSpecs,
    ];
    this.childTiles = otherDeviceSpecs.map((t) => new Tile(t, ctx));

    this._build();
  }

  _build() {
    const { spec } = this;

    // ── Header Left ──
    const backBtn = h('button', {
      class: 'room-detail-back', 'aria-label': 'Zurück',
      onClick: () => this.onBack?.(),
    }, icon('mdi:arrow-left'), 'Zurück');

    const titleWrap = h('div', { class: 'room-detail-title-wrap' },
      h('div', { class: 'icon' }, icon(spec.icon || 'mdi:home')),
      h('h2', { class: 'room-detail-title' }, spec.name));

    this.metaEl = h('div', { class: 'room-detail-meta' });

    // ── Header Right: Quick Action Controls ──
    const actions = [];

    // Light quick controls
    if (this.lightSpecs.length > 0) {
      const lightIds = this.lightSpecs.map((l) => l.entity_id);
      const btnAllOn = h('button', {
        class: 'btn secondary small',
        title: 'Alle Lichter anschalten',
        onClick: () => this._toggleLights(lightIds, true),
      }, icon('mdi:lightbulb-on'), 'Alle An');

      const btnAllOff = h('button', {
        class: 'btn secondary small',
        title: 'Alle Lichter ausschalten',
        onClick: () => this._toggleLights(lightIds, false),
      }, icon('mdi:lightbulb-off'), 'Alle Aus');

      actions.push(btnAllOn, btnAllOff);
    }

    // Switch & Socket quick controls
    if (this.switchSpecs.length > 0) {
      const switchIds = this.switchSpecs.map((s) => s.entity_id);
      const btnAllOn = h('button', {
        class: 'btn secondary small',
        title: 'Alle Geräte und Steckdosen anschalten',
        onClick: () => this._toggleSwitches(switchIds, true),
      }, icon('mdi:power-plug'), 'Geräte An');

      const btnAllOff = h('button', {
        class: 'btn secondary small',
        title: 'Alle Geräte und Steckdosen ausschalten',
        onClick: () => this._toggleSwitches(switchIds, false),
      }, icon('mdi:power-plug-off'), 'Geräte Aus');

      actions.push(btnAllOn, btnAllOff);
    }

    // Cover quick controls
    if (this.coverSpecs.length > 0) {
      const coverIds = this.coverSpecs.map((c) => c.entity_id);
      const btnAllOpen = h('button', {
        class: 'btn secondary small',
        title: 'Alle Jalousien öffnen',
        onClick: () => this.hass?.callService('cover', 'open_cover', { entity_id: coverIds }),
      }, icon('mdi:arrow-up'), 'Alle Auf');

      const btnAllStop = h('button', {
        class: 'btn secondary small',
        title: 'Jalousien anhalten',
        onClick: () => this.hass?.callService('cover', 'stop_cover', { entity_id: coverIds }),
      }, icon('mdi:stop'), 'Stopp');

      const btnAllClose = h('button', {
        class: 'btn secondary small',
        title: 'Alle Jalousien schließen',
        onClick: () => this.hass?.callService('cover', 'close_cover', { entity_id: coverIds }),
      }, icon('mdi:arrow-down'), 'Alle Zu');

      actions.push(btnAllOpen, btnAllStop, btnAllClose);
    }

    this.actionsEl = h('div', { class: 'room-detail-actions' }, ...actions);

    const head = h('div', { class: 'room-detail-head' },
      h('div', { class: 'room-detail-left' }, backBtn, titleWrap, this.metaEl),
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

  _toggleLights(ids, turnOn) {
    const byDomain = {};
    for (const id of ids) {
      const dom = domainOf(id);
      (byDomain[dom] ||= []).push(id);
    }
    const targetService = turnOn ? 'turn_on' : 'turn_off';
    for (const [dom, subIds] of Object.entries(byDomain)) {
      if (['light', 'switch', 'input_boolean'].includes(dom)) {
        this.hass?.callService(dom, targetService, { entity_id: subIds });
      } else {
        this.hass?.callService('homeassistant', targetService, { entity_id: subIds });
      }
    }
  }

  _toggleSwitches(ids, turnOn) {
    const byDomain = {};
    for (const id of ids) {
      const dom = domainOf(id);
      (byDomain[dom] ||= []).push(id);
    }
    const targetService = turnOn ? 'turn_on' : 'turn_off';
    for (const [dom, subIds] of Object.entries(byDomain)) {
      if (['switch', 'light', 'input_boolean'].includes(dom)) {
        this.hass?.callService(dom, targetService, { entity_id: subIds });
      } else {
        this.hass?.callService('homeassistant', targetService, { entity_id: subIds });
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

    const btnUp = mkBtn('mdi:arrow-up', 'Öffnen', () => this.hass?.callService('cover', 'open_cover', { entity_id: spec.entity_id }));
    const btnStop = mkBtn('mdi:stop', 'Stopp', () => this.hass?.callService('cover', 'stop_cover', { entity_id: spec.entity_id }));
    const btnDown = mkBtn('mdi:arrow-down', 'Schließen', () => this.hass?.callService('cover', 'close_cover', { entity_id: spec.entity_id }));

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
      slider.style.setProperty('--val', `${slider.value}%`);
      stateEl.textContent = `Position: ${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      dragging = false;
      this.hass?.callService('cover', 'set_cover_position', {
        entity_id: spec.entity_id,
        position: Number(slider.value),
      });
    });

    const sliderWrap = h('div', { class: 'cover-slider-wrap' },
      h('span', { class: 'cover-slider-label' }, '0%'),
      slider,
      h('span', { class: 'cover-slider-label' }, '100%'));

    const row = h('div', { class: 'cover-detail-row' },
      h('div', { class: 'cover-detail-top' },
        h('div', { class: 'cover-detail-info' },
          h('div', { class: 'cover-detail-icon' }, iconEl),
          h('div', { class: 'cover-detail-texts' }, nameEl, stateEl)),
        h('div', { class: 'tile-btns' }, btnUp, btnStop, btnDown)),
      sliderWrap);

    return {
      spec, row, iconEl, stateEl, slider, btnUp, btnStop, btnDown,
      get dragging() { return dragging; },
    };
  }

  update(hass) {
    this.hass = hass;

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
          cr.slider.value = String(pos);
          cr.slider.style.setProperty('--val', `${pos}%`);
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
