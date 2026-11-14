// Tile component: one entity as a HA-tile-like card (lights, switches, covers, climate, media, sensors).
import {
  h, icon, editBorder, domainOf, entityIcon, isActive, isUnavailable, stateLabel, numeric, moreInfo, toggleEntity,
  isToggleable, resolveColor, effectiveCategory, getEntityColor, setSliderVal, parseChannelKey,
} from '../lib/util.js';

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
    this.deviceId = spec.device_id || parseChannelKey(spec.key).deviceId || spec.entity_id;
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
    this._optimisticOn = null;
    this._optimisticUntil = 0;
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

    const wide = ['cover', 'media_player', 'climate'].includes(this.kind)
      || this.spec.wide === true
      || this.spec.force_own_row === true;
    this.el = h('div', { class: `tile ${this.kind}${wide ? ' wide' : ''}`, 'data-key': this.spec.key },
      h('div', { class: 'tile-main' }, this.iconBtn, this.info, this.btns),
      this.feature,
      editBorder(10));

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

  get hasSlider() {
    if (this.domain === 'light') {
      const { brightness } = lightSupport(this._st);
      return !!brightness;
    }
    return false;
  }

  get isForceOwnRow() {
    return this.spec.force_own_row === true;
  }

  get isAlwaysWide() {
    return ['cover', 'media_player', 'climate'].includes(this.kind)
      || this.spec.is_group === true
      || this.spec.wide === true
      || this.spec.force_own_row === true;
  }

  get isWide() {
    return this.el.classList.contains('wide');
  }

  setWide(wide) {
    this.el.classList.toggle('wide', !!wide);
  }

  _buildLightFeature() {
    this.slider = h('input', {
      type: 'range', class: 'slider', min: '1', max: '100', step: '1', 'aria-label': 'Helligkeit',
      style: { touchAction: 'none' },
    });
    // Prevent vertical page scroll & parent toggle during slider interaction
    this.slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('click', (e) => e.stopPropagation());
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

  _applyOptimistic(desiredOn, until) {
    this._optimisticOn = desiredOn;
    this._optimisticUntil = until;
    if (this.hass) this.update(this.hass);
  }

  update(hass) {
    this.hass = hass;
    const st = hass.states[this.entityId];
    const pw = this.spec.power ? hass.states[this.spec.power] : null;
    if (this._optimisticOn !== null) {
      const actualActive = this._active(st);
      if (actualActive === this._optimisticOn || Date.now() >= this._optimisticUntil) {
        this._optimisticOn = null;
        this._optimisticUntil = 0;
      }
    }
    const stateKey = `${st?.state}|${st?.attributes?.brightness}|${st?.attributes?.current_position}|${st?.attributes?.rgb_color}|${st?.last_updated}|${pw?.state}|${this._optimisticOn}`;
    if (this._rendered && this._stateKey === stateKey) return;
    this._rendered = true;
    this._stateKey = stateKey;
    this._st = st;
    this._pw = pw;

    const attrs = st?.attributes || {};
    const unavailable = isUnavailable(st);
    const active = this._optimisticOn !== null ? this._optimisticOn : this._active(st);
    this.el.toggleAttribute('data-unavailable', unavailable);
    this.el.dataset.active = String(active);

    // Name
    this.nameEl.textContent = this.spec.name || attrs.friendly_name || this.entityId;

    // Icon + colour
    const effectiveSt = this._optimisticOn !== null && st
      ? { ...st, state: this._optimisticOn ? 'on' : 'off' }
      : st;
    this.iconEl.setAttribute('icon', entityIcon(this.entityId, effectiveSt, this.spec.icon, this.spec.category));
    let color = '';
    if (active) {
      color = getEntityColor(this.entityId, effectiveSt, this.spec.category, this.spec.color);
    }
    if (color) this.el.style.setProperty('--tile-color', color); else this.el.style.removeProperty('--tile-color');

    // State text
    this.stateEl.textContent = this._optimisticOn !== null
      ? (this._optimisticOn ? 'An' : 'Aus')
      : this._stateText(hass, st, pw, active);

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
    this.isSubGroup = !!ctx?.isSubGroup;
    this.entityIds = spec.entity_ids || [];
    this.category = spec.category || 'leuchte';
    this.domain = this.category === 'leuchte' ? 'light' : 'switch';
    this.hass = null;
    this._open = false;
    this._dragging = false;
    this._optimisticOn = null;
    this._optimisticUntil = 0;
    this._stragglerTimer = null;

    // Sub-groups inside a group NEVER have children or nested accordions!
    if (this.isSubGroup) {
      this.children = [];
    } else {
      this.children = (spec.children || []).map((childSpec) => {
        if (childSpec.is_group) {
          return new GroupTile(childSpec, { ...ctx, isSubGroup: true });
        }
        return new Tile(childSpec, ctx);
      });
    }

    this._build();
  }

  get hasSlider() {
    return true;
  }

  get isAlwaysWide() {
    return !this.isSubGroup;
  }

  get isWide() {
    return !this.isSubGroup;
  }

  setWide(wide) {
    this.el.classList.toggle('wide', !!wide);
  }

  _build() {
    const isLeuchte = this.category === 'leuchte';
    const defaultIcon = isLeuchte ? 'mdi:lightbulb-group-outline' : 'mdi:power-plug-off';
    this.iconEl = icon(this.spec.icon ? `${this.spec.icon}-outline` : defaultIcon);

    this.iconBtn = h('button', {
      class: 'tile-icon group-icon-btn',
      'aria-label': `${this.spec.name} Schalten`,
      title: 'Schalten',
      onClick: (e) => {
        e.stopPropagation();
        this._toggleMaster();
      },
    }, this.iconEl);

    this.nameEl = h('div', { class: 'tile-name' }, this.spec.name);
    this.stateEl = h('div', { class: 'tile-state' }, 'Aus');

    this.info = h('div', {
      class: 'tile-info',
      onClick: (e) => {
        e.stopPropagation();
        if (this.ctx?.isEditMode?.()) {
          this.ctx.onOpenGroup?.(this.spec.group_id);
          return;
        }
        this._toggleMaster();
      },
    }, this.nameEl, this.stateEl);

    if (this.isSubGroup) {
      this.btns = h('div', { class: 'tile-btns' });
    } else {
      this.chevron = icon('mdi:chevron-down');
      this.btnChevron = h('button', {
        type: 'button',
        class: 'mini-btn chevron-btn',
        'aria-label': 'Gruppe ausklappen',
        'aria-expanded': 'false',
        title: 'Unterlampen',
        onClick: (e) => {
          e.stopPropagation();
          this._toggleOpen();
        },
      }, this.chevron);
      this.btns = h('div', { class: 'tile-btns' }, this.btnChevron);
    }

    // Master brightness slider
    this.feature = h('div', { class: 'tile-feature', hidden: true });
    this.slider = h('input', {
      type: 'range', class: 'slider', min: '1', max: '100', step: '1', 'aria-label': 'Gruppenhelligkeit',
      style: { touchAction: 'none' },
    });
    this.slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    this.slider.addEventListener('click', (e) => e.stopPropagation());
    this.slider.addEventListener('input', () => {
      this._dragging = true;
      setSliderVal(this.slider, this.slider.value);
    });
    this.slider.addEventListener('change', () => {
      this._dragging = false;
      this._setMasterBrightness(Number(this.slider.value));
    });
    this.feature.append(this.slider);

    const mainRow = h('div', {
      class: 'tile-main',
      onClick: (e) => {
        if (e.target.closest('button')) return;
        if (this.ctx?.isEditMode?.()) {
          this.ctx.onOpenGroup?.(this.spec.group_id);
          return;
        }
        this._toggleMaster();
      },
    }, this.iconBtn, this.info, this.btns);

    if (this.isSubGroup) {
      this.el = h('div', {
        class: 'tile group subgroup',
        'data-key': this.spec.key,
        'data-group': 'true',
      }, mainRow, this.feature, editBorder(10));
    } else {
      const wideChildren = [];
      const compactChildren = [];
      for (const c of this.children) {
        if (c.isForceOwnRow || c.isAlwaysWide || c.hasSlider) {
          c.setWide?.(true);
          wideChildren.push(c);
        } else {
          compactChildren.push(c);
        }
      }
      if (compactChildren.length % 2 === 1) {
        for (let i = 0; i < compactChildren.length - 1; i++) {
          compactChildren[i].setWide?.(false);
        }
        compactChildren[compactChildren.length - 1].setWide?.(true);
      } else {
        compactChildren.forEach((c) => c.setWide?.(false));
      }
      const orderedChildren = [...compactChildren, ...wideChildren];
      this.subGrid = h('div', { class: 'group-sub-grid' }, ...orderedChildren.map((c) => c.el));
      this.subContainer = h('div', { class: 'group-sub-container' }, this.subGrid);
      this.subInner = h('div', { class: 'group-sub-inner' }, this.subContainer);
      this.subBody = h('div', { class: 'group-sub-body' }, this.subInner);
      this.el = h('div', {
        class: 'tile group wide',
        'data-key': this.spec.key,
        'data-group': 'true',
      }, mainRow, this.feature, this.subBody, editBorder(10));
    }

    // Edit Mode click interception (allow chevron toggle & child/subgroup tile clicks)
    this.el.addEventListener('click', (e) => {
      if (this.ctx?.isEditMode?.()) {
        const closestTile = e.target.closest('.tile');
        if (e.target.closest('.chevron-btn') || (closestTile && closestTile !== this.el) || (this.subBody && this.subBody.contains(e.target))) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        this.ctx.onOpenGroup?.(this.spec.group_id);
      }
    }, true);
  }

  _toggleOpen() {
    if (this.isSubGroup) return;
    this._open = !this._open;
    this.el.toggleAttribute('data-open', this._open);
    this.btnChevron?.setAttribute('aria-expanded', String(this._open));
  }

  _applyOptimistic(desiredOn, until) {
    this._optimisticOn = desiredOn;
    this._optimisticUntil = until;
    this.children.forEach((c) => c._applyOptimistic?.(desiredOn, until));
    if (this.hass) this.update(this.hass);
  }

  _toggleMaster() {
    if (!this.hass || !this.entityIds.length) return;
    const states = this.entityIds.map((id) => this.hass.states[id]).filter(Boolean);
    const hasActiveLock = this._optimisticOn !== null && Date.now() < this._optimisticUntil;
    const anyOn = hasActiveLock ? this._optimisticOn : states.some((s) => s.state === 'on');
    const desiredOn = !anyOn;
    const service = desiredOn ? 'turn_on' : 'turn_off';
    const until = Date.now() + 4000;

    this._applyOptimistic(desiredOn, until);
    this.hass.callService('homeassistant', service, { entity_id: this.entityIds });

    if (this._stragglerTimer) clearTimeout(this._stragglerTimer);
    this._stragglerTimer = setTimeout(() => {
      this._stragglerTimer = null;
      if (!this.hass) return;
      const targetState = desiredOn ? 'on' : 'off';
      const stragglers = this.entityIds.filter((eid) => {
        const st = this.hass.states[eid];
        return !st || st.state !== targetState;
      });
      if (stragglers.length > 0 && Date.now() < this._optimisticUntil) {
        this.hass.callService('homeassistant', service, { entity_id: stragglers });
      }
      setTimeout(() => {
        if (this.hass && Date.now() >= this._optimisticUntil) {
          this._optimisticOn = null;
          this._optimisticUntil = 0;
          this.update(this.hass);
        }
      }, 2600);
    }, 1500);
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
    if (this._optimisticOn !== null) {
      const targetState = this._optimisticOn ? 'on' : 'off';
      const allConverged =
        states.length === this.entityIds.length &&
        states.every((s) => s.state === targetState);
      if (allConverged || Date.now() >= this._optimisticUntil) {
        this._optimisticOn = null;
        this._optimisticUntil = 0;
      }
    }

    const activeStates = states.filter((s) => s.state === 'on');
    const anyOn = this._optimisticOn !== null ? this._optimisticOn : activeStates.length > 0;

    this.el.dataset.active = String(anyOn);
    this.iconBtn.classList.toggle('active', anyOn);

    if (anyOn) {
      const activeColor = this.spec.color || '#ffc107';
      this.el.style.setProperty('--tile-color', activeColor);
      this.iconEl.setAttribute('icon', this.spec.icon || (this.category === 'leuchte' ? 'mdi:lightbulb-group' : 'mdi:power-plug'));
    } else {
      this.el.style.removeProperty('--tile-color');
      const offIcon = this.spec.icon ? `${this.spec.icon}-outline` : (this.category === 'leuchte' ? 'mdi:lightbulb-group-outline' : 'mdi:power-plug-off');
      this.iconEl.setAttribute('icon', offIcon);
    }

    if (!states.length) {
      this.stateEl.textContent = 'Keine Entitäten';
    } else if (!anyOn) {
      this.stateEl.textContent = 'Aus';
    } else {
      const avgBr = this._avgBrightness(activeStates);
      this.stateEl.textContent = avgBr ? `Ein · ${avgBr} %` : 'Ein';
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
