// Tile component: one entity as a HA-tile-like card (lights, switches, covers, climate, media, sensors).
import {
  h, icon, domainOf, entityIcon, isActive, isUnavailable, stateLabel, numeric, moreInfo, toggleEntity,
  isToggleable, resolveColor, effectiveCategory, getEntityColor, setSliderVal,
} from '../lib/util.js?v=2.8.17';

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
    this.deviceId = spec.device_id || (spec.key && spec.key.includes(':') && !spec.key.startsWith('e:') && !spec.key.startsWith('l:') ? spec.key.split(':')[0] : null) || spec.entity_id;
    this.rawDomain = domainOf(spec.entity_id);
    const cat = effectiveCategory(spec);
    // Effective domain overrides raw domain for UI purposes
    this.domain = (cat === 'light' || cat === 'cover' || cat === 'media_player' || cat === 'climate' || cat === 'valve' || cat === 'pumpe' || cat === 'motion' || cat === 'sensor' || cat === 'outlet' || cat === 'switch')
      ? cat : this.rawDomain;
    this.kind = ['cover', 'media_player', 'climate', 'sensor', 'binary_sensor', 'motion'].includes(this.domain)
      ? (this.domain === 'motion' ? 'sensor' : this.domain) : 'toggle';
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
    this.info = h('div', {
      class: 'tile-info',
      onClick: () => {
        if (this.ctx?.isEditMode?.()) {
          const targetId = this.deviceId || this.spec?.device_id || this.entityId;
          this.ctx.onOpenDevice?.(targetId);
          return;
        }
        moreInfo(this.el, this.entityId);
      },
    }, this.nameEl, this.stateEl);
    this.btns = h('div', { class: 'tile-btns' });
    this.feature = h('div', { class: 'tile-feature', hidden: true });

    const wide = ['cover', 'media_player', 'climate'].includes(this.kind);
    this.el = h('div', { class: `tile ${this.kind}${wide ? ' wide' : ''}`, 'data-key': this.spec.key },
      h('div', { class: 'tile-main' }, this.iconBtn, this.info, this.btns),
      this.feature);

    this.el.addEventListener('pointerdown', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    this.el.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
        const targetId = this.deviceId || this.spec?.device_id || this.entityId;
        this.ctx.onOpenDevice?.(targetId);
      }
    }, true);

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
    return ['cover', 'media_player', 'climate'].includes(this.kind)
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
      setSliderVal(this.slider, this.slider.value);
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
    if (this.ctx?.isEditMode?.()) {
      const targetId = this.deviceId || this.spec?.device_id || this.entityId;
      this.ctx.onOpenDevice?.(targetId);
      return;
    }
    if (!this.hass) return;
    if (this.kind === 'sensor' || this.kind === 'binary_sensor' || this.domain === 'sensor' || this.domain === 'motion' || !isToggleable(this.entityId)) {
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
      case 'motion': return !!st && (st.state === 'on' || st.state === 'detected' || st.state === 'motion');
      case 'valve': return !!st && (st.state === 'on' || st.state === 'open');
      case 'pumpe': return !!st && st.state === 'on';
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
    let text = stateLabel(hass, st, this.spec.category);
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
    if (!hasFeature) return;
    this.slider.hidden = !showSlider;
    this.swatches.hidden = !showSwatches;
    if (showSwatches) this._renderPresets();
    if (showSlider && !this._dragging) {
      const pct = Math.max(1, Math.round(((st.attributes.brightness || 0) / 255) * 100));
      setSliderVal(this.slider, pct);
    }
  }
}

/**
 * Hierarchical Group Tile (e.g. Master Light Group with collapsible subgroups / child lamps).
 */
export class GroupTile {
  /**
   * @param {object} spec  {key, group_id, name, category, icon, color, entity_ids, children}
   * @param {object} ctx
   */
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.entityIds = spec.entity_ids || [];
    this.category = spec.category || 'leuchte';
    this.domain = this.category === 'leuchte' ? 'light' : 'switch';
    this.hass = null;
    this._open = false;
    this._dragging = false;

    // Instantiate child components (either nested GroupTile or Tile)
    this.children = (spec.children || []).map((childSpec) => {
      if (childSpec.is_group) {
        return new GroupTile(childSpec, ctx);
      }
      return new Tile(childSpec, ctx);
    });

    this._build();
  }

  get isWide() {
    return true; // Master group is wide so it sits above its collapsible children
  }

  setWide(wide) {
    this.el.classList.toggle('wide', !!wide);
  }

  _build() {
    this.iconEl = icon(this.spec.icon || (this.category === 'leuchte' ? 'mdi:lightbulb-group' : 'mdi:power-plug'));
    this.badgeEl = h('span', { class: 'group-badge', hidden: true }, '0');

    this.iconBtn = h('button', {
      class: 'tile-icon group-icon-btn',
      'aria-label': `${this.spec.name} Schalten`,
      title: 'Alle ein-/ausschalten',
      onClick: (e) => {
        e.stopPropagation();
        this._toggleMaster();
      },
    }, this.iconEl, this.badgeEl);

    this.nameEl = h('div', { class: 'tile-name' }, this.spec.name);
    this.stateEl = h('div', { class: 'tile-state' }, 'Aus');
    this.chevron = icon('mdi:chevron-down');

    this.info = h('div', {
      class: 'tile-info',
      title: 'Ausklappen / Zuklappen',
      onClick: () => this._toggleOpen(),
    }, this.nameEl, this.stateEl);

    this.btnChevron = h('button', {
      class: 'mini-btn chevron-btn',
      'aria-label': 'Ausklappen',
      title: 'Unterlampen anzeigen',
      onClick: (e) => {
        e.stopPropagation();
        this._toggleOpen();
      },
    }, this.chevron);

    this.btns = h('div', { class: 'tile-btns' }, this.btnChevron);

    // Master brightness slider
    this.feature = h('div', { class: 'tile-feature', hidden: true });
    this.slider = h('input', {
      type: 'range', class: 'slider', min: '1', max: '100', step: '1', 'aria-label': 'Gruppenhelligkeit',
      style: { touchAction: 'none' },
    });
    this.slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.slider.addEventListener('input', () => {
      this._dragging = true;
      setSliderVal(this.slider, this.slider.value);
    });
    this.slider.addEventListener('change', () => {
      this._dragging = false;
      this._setMasterBrightness(Number(this.slider.value));
    });
    this.feature.append(this.slider);

    // Collapsible Sub-Items Container
    this.subGrid = h('div', { class: 'group-sub-grid' }, ...this.children.map((c) => c.el));

    this.subContainer = h('div', { class: 'group-sub-container', hidden: true }, this.subGrid);

    this.el = h('div', {
      class: 'tile group wide',
      'data-key': this.spec.key,
      'data-group': 'true',
      style: { '--tile-color': this.spec.color || '#ffc107' },
    },
      h('div', { class: 'tile-main' }, this.iconBtn, this.info, this.btns),
      this.feature,
      this.subContainer
    );

    // Edit Mode click interception
    this.el.addEventListener('pointerdown', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    this.el.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        e.stopPropagation();
        e.preventDefault();
        this.ctx.onOpenGroup?.(this.spec.group_id);
      }
    }, true);
  }

  _toggleOpen() {
    this._open = !this._open;
    this.el.toggleAttribute('data-open', this._open);
    this.subContainer.hidden = !this._open;
    this.chevron.setAttribute('icon', this._open ? 'mdi:chevron-up' : 'mdi:chevron-down');
  }

  _toggleMaster() {
    if (!this.hass) return;
    const states = this.entityIds.map((id) => this.hass.states[id]).filter(Boolean);
    const anyOn = states.some((s) => s.state === 'on');
    const service = anyOn ? 'turn_off' : 'turn_on';
    const domain = this.domain;
    for (const eid of this.entityIds) {
      const d = domainOf(eid);
      this.hass.callService(d === 'light' || d === 'switch' ? d : domain, service, { entity_id: eid });
    }
  }

  _setMasterBrightness(pct) {
    if (!this.hass) return;
    for (const eid of this.entityIds) {
      if (domainOf(eid) === 'light') {
        this.hass.callService('light', 'turn_on', { entity_id: eid, brightness_pct: pct });
      }
    }
  }

  update(hass) {
    this.hass = hass;
    this.children.forEach((c) => c.update(hass));

    const states = this.entityIds.map((id) => hass.states[id]).filter(Boolean);
    const activeStates = states.filter((s) => s.state === 'on');
    const activeCount = activeStates.length;
    const anyOn = activeCount > 0;

    this.el.dataset.active = String(anyOn);
    this.iconBtn.classList.toggle('active', anyOn);

    if (activeCount > 0) {
      this.badgeEl.textContent = String(activeCount);
      this.badgeEl.hidden = false;
    } else {
      this.badgeEl.hidden = true;
    }

    if (!states.length) {
      this.stateEl.textContent = 'Keine Entitäten';
    } else if (activeCount === 0) {
      this.stateEl.textContent = 'Aus';
    } else if (activeCount === states.length) {
      const avgBr = this._avgBrightness(activeStates);
      this.stateEl.textContent = avgBr ? `Alle Ein · ${avgBr} %` : 'Alle Ein';
    } else {
      const avgBr = this._avgBrightness(activeStates);
      this.stateEl.textContent = avgBr ? `${activeCount} von ${states.length} Ein · ${avgBr} %` : `${activeCount} von ${states.length} Ein`;
    }

    if (this.category === 'leuchte' && anyOn) {
      const avgBr = this._avgBrightness(activeStates);
      if (avgBr !== null) {
        this.feature.hidden = false;
        if (!this._dragging) {
          setSliderVal(this.slider, avgBr);
        }
      } else {
        this.feature.hidden = true;
      }
    } else {
      this.feature.hidden = true;
    }
  }

  _avgBrightness(activeStates) {
    const brs = activeStates
      .map((s) => s.attributes?.brightness)
      .filter((b) => typeof b === 'number');
    if (!brs.length) return null;
    const avg = Math.round(brs.reduce((a, b) => a + b, 0) / brs.length);
    return Math.max(1, Math.round((avg / 255) * 100));
  }
}
