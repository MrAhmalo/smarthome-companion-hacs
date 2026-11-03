// Tile component: one entity as a HA-tile-like card (lights, switches, covers, climate, media, sensors).
import {
  h, icon, domainOf, entityIcon, isActive, isUnavailable, stateLabel, numeric, moreInfo, toggleEntity,
  isToggleable, resolveColor, effectiveCategory,
} from '../lib/util.js';

const DOMAIN_COLORS = {
  cover: '#9c27b0', // Lila (Home Assistant / Mushroom standard)
  jalousie: '#9c27b0',
  light: '#ffc107', // Amber
  leuchte: '#ffc107',
  switch: '#2196f3', // Blau
  schalter: '#2196f3',
  steckdose: '#009688', // Türkis
  outlet: '#009688',
  climate: '#ff9800', // Orange (heat)
  klima: '#ff9800',
  media_player: '#03a9f4', // Hellblau
  fernseher: '#03a9f4',
  fan: '#00bcd4', // Cyan
  luefter: '#00bcd4',
  valve: '#00bcd4',
  wasserventil: '#00bcd4',
  lock: '#4caf50',
  sensor: '#2196f3',
};

function getEntityColor(entityId, st, category, specColor) {
  const domain = domainOf(entityId);
  const dc = st?.attributes?.device_class;
  if (category === 'jalousie' || domain === 'cover') return DOMAIN_COLORS.cover;
  if (category === 'leuchte' || domain === 'light') {
    if (Array.isArray(st?.attributes?.rgb_color)) return `rgb(${st.attributes.rgb_color.join(',')})`;
    return DOMAIN_COLORS.light;
  }
  if (category === 'steckdose' || dc === 'outlet') return DOMAIN_COLORS.steckdose;
  if (category === 'schalter' || domain === 'switch') return DOMAIN_COLORS.switch;
  if (category === 'klima' || domain === 'climate') {
    return st?.attributes?.hvac_action === 'cooling' ? '#00bcd4' : '#ff9800';
  }
  if (category === 'fernseher' || category === 'medien' || domain === 'media_player') return DOMAIN_COLORS.media_player;
  if (specColor && specColor !== '#6366F1') return resolveColor(specColor) || specColor;
  if (domain === 'fan') return DOMAIN_COLORS.fan;
  if (domain === 'valve') return DOMAIN_COLORS.valve;
  return DOMAIN_COLORS[domain] || '#2196f3';
}

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

function lightSupport(st) {
  const modes = st?.attributes?.supported_color_modes || [];
  return {
    brightness: modes.some((m) => m !== 'onoff'),
    color: modes.some((m) => COLOR_MODES.includes(m)),
  };
}

export class Tile {
  /**
   * @param {object} spec   tile from the backend layout {key, entity_id, name, icon, color, power}
   * @param {object} ctx    {presets: number[][]}
   */
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.entityId = spec.entity_id;
    this.rawDomain = domainOf(spec.entity_id);
    const cat = effectiveCategory(spec);
    // Effective domain overrides raw domain for UI purposes
    this.domain = (cat === 'light' || cat === 'cover' || cat === 'media_player' || cat === 'climate')
      ? cat : this.rawDomain;
    this.kind = ['cover', 'media_player', 'climate', 'sensor', 'binary_sensor'].includes(this.domain)
      ? this.domain : 'toggle';
    this.hass = null;
    this._st = undefined;
    this._pw = undefined;
    this._presetKey = '';
    this._build();
  }

  _build() {
    this.iconEl = icon('mdi:bookmark');
    this.iconBtn = h('button', {
      class: 'tile-icon', 'aria-label': 'Schalten',
      onClick: (e) => { e.stopPropagation(); this._onIcon(); },
    }, this.iconEl);
    this.nameEl = h('div', { class: 'tile-name' });
    this.stateEl = h('div', { class: 'tile-state' });
    this.info = h('div', { class: 'tile-info', onClick: () => moreInfo(this.el, this.entityId) }, this.nameEl, this.stateEl);
    this.btns = h('div', { class: 'tile-btns' });
    this.feature = h('div', { class: 'tile-feature', hidden: true });

    const wide = ['cover', 'media_player', 'climate'].includes(this.kind);
    this.el = h('div', { class: `tile ${this.kind}${wide ? ' wide' : ''}`, 'data-key': this.spec.key },
      h('div', { class: 'tile-main' }, this.iconBtn, this.info, this.btns),
      this.feature);

    if (this.kind === 'cover') this._buildCover();
    if (this.kind === 'media_player') this._buildMedia();
    if (this.domain === 'light') this._buildLightFeature();
  }

  // ── builders ──
  _service(domain, service, data = {}) {
    if (domain === 'cover' && this.rawDomain !== 'cover') {
      if (service === 'open_cover') return this.hass?.callService(this.rawDomain, 'turn_on', { entity_id: this.entityId });
      if (service === 'close_cover') return this.hass?.callService(this.rawDomain, 'turn_off', { entity_id: this.entityId });
      if (service === 'stop_cover') return this.hass?.callService(this.rawDomain, 'turn_off', { entity_id: this.entityId });
    }
    return this.hass?.callService(domain, service, { entity_id: this.entityId, ...data });
  }

  _buildCover() {
    const mk = (ic, label, fn) => h('button', { class: 'mini-btn', 'aria-label': label, onClick: (e) => { e.stopPropagation(); fn(); } }, icon(ic));
    this.btnUp = mk('mdi:arrow-up', 'Öffnen', () => this._service('cover', 'open_cover'));
    this.btnStop = mk('mdi:stop', 'Stopp', () => this._service('cover', 'stop_cover'));
    this.btnDown = mk('mdi:arrow-down', 'Schließen', () => this._service('cover', 'close_cover'));
    this.btns.append(this.btnUp, this.btnStop, this.btnDown);
  }

  _buildMedia() {
    this.btnPlay = h('button', {
      class: 'mini-btn', 'aria-label': 'Wiedergabe',
      onClick: (e) => { e.stopPropagation(); this._service('media_player', 'media_play_pause'); },
    }, icon('mdi:play-pause'));
    this.btns.append(this.btnPlay);
    this.el.classList.add('media');
  }

  get isWide() {
    const active = this._active(this._st);
    const { brightness } = lightSupport(this._st);
    return ['cover', 'media_player', 'climate'].includes(this.kind)
      || (this.domain === 'light' && active && brightness)
      || this.spec.wide === true;
  }

  setWide(wide) {
    this.el.classList.toggle('wide', !!wide);
  }

  _buildLightFeature() {
    this.slider = h('input', {
      type: 'range', class: 'slider', min: '1', max: '100', step: '1', 'aria-label': 'Helligkeit',
      style: { touchAction: 'none' },
    });
    // Prevent vertical page scroll during slider touch interaction
    this.slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('input', () => {
      this._dragging = true;
      this.slider.style.setProperty('--val', `${this.slider.value}%`);
    });
    this.slider.addEventListener('change', () => {
      this._dragging = false;
      this._service('light', 'turn_on', { brightness_pct: Number(this.slider.value) });
    });
    this.swatches = h('div', { style: { display: 'flex', gap: '8px' } });
    this.feature.append(this.slider, this.swatches);
  }

  _renderPresets() {
    const presets = this.ctx.presets || [];
    const key = JSON.stringify(presets);
    if (key === this._presetKey) return;
    this._presetKey = key;
    this.swatches.replaceChildren(...presets.map((rgb) => h('button', {
      class: 'swatch', 'aria-label': `Farbe ${rgb.join(',')}`,
      style: { background: `rgb(${rgb.join(',')})` },
      onClick: (e) => {
        e.stopPropagation();
        const br = this._st?.attributes?.brightness || 255;
        this._service('light', 'turn_on', { rgb_color: rgb, brightness: br });
      },
    })));
  }

  _onIcon() {
    if (!this.hass) return;
    if (this.kind === 'sensor' || this.kind === 'binary_sensor' || !isToggleable(this.entityId)) {
      moreInfo(this.el, this.entityId);
    } else {
      toggleEntity(this.hass, this.entityId);
    }
  }

  // ── state ──
  _active(st) {
    if (this.spec.category === 'jalousie' || this.domain === 'cover') {
      return !!st && st.state !== 'closed' && !isUnavailable(st);
    }
    switch (this.domain) {
      case 'climate': return !!st && st.state !== 'off' && !isUnavailable(st);
      case 'media_player': return !!st && !['off', 'standby', 'idle', 'unavailable', 'unknown'].includes(st.state);
      case 'sensor': return false;
      default: return isActive(st);
    }
  }

  update(hass) {
    this.hass = hass;
    const st = hass.states[this.entityId];
    const pw = this.spec.power ? hass.states[this.spec.power] : null;
    if (this._rendered && st === this._st && pw === this._pw) return;
    this._rendered = true;
    this._st = st;
    this._pw = pw;

    const attrs = st?.attributes || {};
    const unavailable = isUnavailable(st);
    const active = this._active(st);
    this.el.toggleAttribute('data-unavailable', unavailable);
    this.el.dataset.active = String(active);

    // Name
    this.nameEl.textContent = this.spec.name || attrs.friendly_name || this.entityId;

    // Icon + colour
    this.iconEl.setAttribute('icon', entityIcon(this.entityId, st, this.spec.icon, this.spec.category));
    let color = '';
    if (active) {
      color = getEntityColor(this.entityId, st, this.spec.category, this.spec.color);
    }
    if (color) this.el.style.setProperty('--tile-color', color); else this.el.style.removeProperty('--tile-color');

    // State text
    this.stateEl.textContent = this._stateText(hass, st, pw, active);

    // Kind specifics
    if (this.kind === 'cover') this._updateCover(st, unavailable);
    if (this.kind === 'media_player') this._updateMedia(st, unavailable);
    if (this.domain === 'light') this._updateLight(st, active);
  }

  _stateText(hass, st, pw, active) {
    if (!st) return 'Nicht gefunden';
    const attrs = st.attributes || {};
    let text = stateLabel(hass, st);
    if (this.domain === 'cover' && typeof attrs.current_position === 'number' && st.state !== 'closed' && st.state !== 'open') {
      text += ` · ${attrs.current_position} %`;
    } else if (this.domain === 'light' && active && typeof attrs.brightness === 'number') {
      text += ` · ${Math.round((attrs.brightness / 255) * 100)} %`;
    } else if (this.domain === 'climate') {
      const cur = attrs.current_temperature;
      const tgt = attrs.temperature;
      if (cur != null) text += ` · ${cur}°`;
      if (tgt != null && st.state !== 'off') text += ` → ${tgt}°`;
    } else if (this.domain === 'media_player' && ['playing', 'paused'].includes(st.state) && attrs.media_title) {
      text = [attrs.media_title, attrs.media_artist].filter(Boolean).join(' – ');
    }
    const watts = numeric(pw);
    if (watts !== null && watts > 0 && active) text += ` · ${watts % 1 ? watts.toFixed(1) : watts} W`;
    return text;
  }

  _updateCover(st, unavailable) {
    const state = st?.state;
    const moving = state === 'opening' || state === 'closing';
    this.btnUp.disabled = unavailable;
    this.btnDown.disabled = unavailable;
    this.btnStop.disabled = unavailable;
    this.btnStop.hidden = false;
    if (moving) {
      this.btnStop.style.color = 'var(--cd-active, #ffc107)';
      this.btnStop.style.background = 'color-mix(in srgb, var(--cd-active) 25%, transparent)';
    } else {
      this.btnStop.style.color = '';
      this.btnStop.style.background = '';
    }
  }

  _updateMedia(st, unavailable) {
    const art = st?.attributes?.entity_picture;
    const playing = !!st && ['playing', 'paused'].includes(st.state);
    if (art && playing) {
      this.el.style.backgroundImage = `url("${art}")`;
      this.el.dataset.art = '1';
    } else {
      this.el.style.backgroundImage = '';
      delete this.el.dataset.art;
    }
    this.btnPlay.disabled = unavailable || st?.state === 'off';
    this.btnPlay.firstChild?.setAttribute('icon', st?.state === 'playing' ? 'mdi:pause' : 'mdi:play');
  }

  _updateLight(st, active) {
    const { brightness, color } = lightSupport(st);
    const presets = this.ctx.presets || [];
    const showSlider = active && brightness;
    const showSwatches = active && color && presets.length > 0;
    const hasFeature = showSlider || showSwatches;
    this.feature.hidden = !hasFeature;
    this.el.classList.toggle('wide', hasFeature);
    if (!hasFeature) return;
    this.slider.hidden = !showSlider;
    this.swatches.hidden = !showSwatches;
    if (showSwatches) this._renderPresets();
    if (showSlider && !this._dragging) {
      const pct = Math.max(1, Math.round(((st.attributes.brightness || 0) / 255) * 100));
      this.slider.value = String(pct);
      this.slider.style.setProperty('--val', `${pct}%`);
    }
  }
}
