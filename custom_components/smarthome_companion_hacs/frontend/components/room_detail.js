// Room detail subview: dedicated granular control page for a single room.
import {
  h, icon, domainOf, numeric, isActive, isUnavailable,
} from '../lib/util.js';
import { Tile } from './tile.js';

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

    // Partition tiles by category/domain
    const tiles = roomSpec.tiles || [];
    this.coverSpecs = tiles.filter((t) => domainOf(t.entity_id) === 'cover');
    this.lightSpecs = tiles.filter((t) => domainOf(t.entity_id) === 'light');
    this.switchSpecs = tiles.filter((t) => ['switch', 'input_boolean'].includes(domainOf(t.entity_id)));
    this.climateSpecs = tiles.filter((t) => ['climate', 'media_player'].includes(domainOf(t.entity_id)));
    this.otherSpecs = tiles.filter((t) =>
      !['cover', 'light', 'switch', 'input_boolean', 'climate', 'media_player'].includes(domainOf(t.entity_id)));

    // Create Tile instances for child components
    this.lightTiles = this.lightSpecs.map((t) => new Tile({ ...t, wide: true }, ctx));
    this.switchTiles = this.switchSpecs.map((t) => new Tile(t, ctx));
    this.climateTiles = this.climateSpecs.map((t) => new Tile({ ...t, wide: true }, ctx));
    this.otherTiles = this.otherSpecs.map((t) => new Tile(t, ctx));

    this._build();
  }

  _build() {
    const { spec } = this;

    // ── Header ──
    const backBtn = h('button', {
      class: 'room-detail-back', 'aria-label': 'Zurück',
      onClick: () => this.onBack?.(),
    }, icon('mdi:arrow-left'), 'Zurück');

    const titleWrap = h('div', { class: 'room-detail-title-wrap' },
      h('div', { class: 'icon' }, icon(spec.icon || 'mdi:home')),
      h('h2', { class: 'room-detail-title' }, spec.name));

    this.metaEl = h('div', { class: 'room-detail-meta' });

    const head = h('div', { class: 'room-detail-head' },
      h('div', { class: 'room-detail-left' }, backBtn, titleWrap),
      this.metaEl);

    // ── Sections ──
    const sections = [];

    // 1. Cover Section (with individual position sliders)
    if (this.coverSpecs.length > 0) {
      this._buildCoversSection(sections);
    }

    // 2. Lights Section
    if (this.lightSpecs.length > 0) {
      this._buildLightsSection(sections);
    }

    // 3. Switches Section
    if (this.switchSpecs.length > 0) {
      this._buildSwitchesSection(sections);
    }

    // 4. Climate & Media Section
    if (this.climateSpecs.length > 0) {
      this._buildClimateSection(sections);
    }

    // 5. Other Section
    if (this.otherSpecs.length > 0) {
      this._buildOtherSection(sections);
    }

    this.el = h('div', { class: 'room-detail-page' }, head, ...sections);
  }

  _buildCoversSection(sections) {
    const coverIds = this.coverSpecs.map((c) => c.entity_id);

    const btnAllOpen = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('cover', 'open_cover', { entity_id: coverIds }),
    }, icon('mdi:arrow-up'), 'Alle Auf');

    const btnAllStop = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('cover', 'stop_cover', { entity_id: coverIds }),
    }, icon('mdi:stop'), 'Stopp');

    const btnAllClose = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('cover', 'close_cover', { entity_id: coverIds }),
    }, icon('mdi:arrow-down'), 'Alle Zu');

    const head = h('div', { class: 'room-detail-section-head' },
      h('div', { class: 'room-detail-section-title', style: { color: '#ba68c8' } },
        icon('mdi:window-shutter'), `Rollläden (${this.coverSpecs.length})`),
      h('div', { class: 'room-detail-section-actions' }, btnAllOpen, btnAllStop, btnAllClose));

    this.coverRows = this.coverSpecs.map((spec) => {
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
    });

    sections.push(h('div', { class: 'room-detail-section' }, head, ...this.coverRows.map((cr) => cr.row)));
  }

  _buildLightsSection(sections) {
    const lightIds = this.lightSpecs.map((l) => l.entity_id);

    const btnAllOn = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('light', 'turn_on', { entity_id: lightIds }),
    }, icon('mdi:lightbulb-on'), 'Alle An');

    const btnAllOff = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('light', 'turn_off', { entity_id: lightIds }),
    }, icon('mdi:lightbulb-off'), 'Alle Aus');

    const head = h('div', { class: 'room-detail-section-head' },
      h('div', { class: 'room-detail-section-title', style: { color: '#ffd54f' } },
        icon('mdi:lightbulb'), `Beleuchtung (${this.lightSpecs.length})`),
      h('div', { class: 'room-detail-section-actions' }, btnAllOn, btnAllOff));

    const grid = h('div', { class: 'tile-grid' }, this.lightTiles.map((t) => t.el));
    sections.push(h('div', { class: 'room-detail-section' }, head, grid));
  }

  _buildSwitchesSection(sections) {
    const switchIds = this.switchSpecs.map((s) => s.entity_id);

    const btnAllOn = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('homeassistant', 'turn_on', { entity_id: switchIds }),
    }, 'Alle An');

    const btnAllOff = h('button', {
      class: 'btn secondary small',
      onClick: () => this.hass?.callService('homeassistant', 'turn_off', { entity_id: switchIds }),
    }, 'Alle Aus');

    const head = h('div', { class: 'room-detail-section-head' },
      h('div', { class: 'room-detail-section-title', style: { color: '#64b5f6' } },
        icon('mdi:toggle-switch'), `Geräte & Steckdosen (${this.switchSpecs.length})`),
      h('div', { class: 'room-detail-section-actions' }, btnAllOn, btnAllOff));

    const grid = h('div', { class: 'tile-grid' }, this.switchTiles.map((t) => t.el));
    sections.push(h('div', { class: 'room-detail-section' }, head, grid));
  }

  _buildClimateSection(sections) {
    const head = h('div', { class: 'room-detail-section-head' },
      h('div', { class: 'room-detail-section-title', style: { color: '#4dd0e1' } },
        icon('mdi:thermostat'), 'Klima & Medien'));

    const grid = h('div', { class: 'tile-grid' }, this.climateTiles.map((t) => t.el));
    sections.push(h('div', { class: 'room-detail-section' }, head, grid));
  }

  _buildOtherSection(sections) {
    const head = h('div', { class: 'room-detail-section-head' },
      h('div', { class: 'room-detail-section-title' },
        icon('mdi:widgets'), 'Weitere Sensoren & Kacheln'));

    const grid = h('div', { class: 'tile-grid' }, this.otherTiles.map((t) => t.el));
    sections.push(h('div', { class: 'room-detail-section' }, head, grid));
  }

  update(hass) {
    this.hass = hass;

    // Update child tiles
    this.lightTiles.forEach((t) => t.update(hass));
    this.switchTiles.forEach((t) => t.update(hass));
    this.climateTiles.forEach((t) => t.update(hass));
    this.otherTiles.forEach((t) => t.update(hass));

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

