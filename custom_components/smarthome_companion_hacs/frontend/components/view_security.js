// Security View: Alarmo + In-Memory PIN Modal, Smoke/Countdown, Cameras, Windows/Batteries & Diagnostics.
import {
  h, icon, isUnavailable, moreInfo, formatCountdownMs, formatState,
} from '../lib/util.js';

const ALARM_STATE_META = {
  disarmed: { label: 'Unscharf', color: '#4caf50', icon: 'mdi:shield-off-outline' },
  arming: { label: 'Wird scharfgeschaltet...', color: '#ff9800', icon: 'mdi:shield-sync' },
  pending: { label: 'Auslöseverzögerung!', color: '#f59e0b', icon: 'mdi:shield-alert-outline' },
  armed_home: { label: 'Zuhause scharf', color: '#03a9f4', icon: 'mdi:shield-home' },
  armed_away: { label: 'Abwesend scharf', color: '#ef4444', icon: 'mdi:shield-lock' },
  armed_night: { label: 'Nacht scharf', color: '#8b5cf6', icon: 'mdi:shield-moon' },
  armed_vacation: { label: 'Urlaub scharf', color: '#ec4899', icon: 'mdi:shield-airplane' },
  armed_custom_bypass: { label: 'Teilweise scharf', color: '#06b6d4', icon: 'mdi:shield-half-full' },
  triggered: { label: 'ALARM AUSGELÖST!', color: '#ef4444', icon: 'mdi:alarm-light' },
  unavailable: { label: 'Nicht verfügbar', color: '#64748b', icon: 'mdi:shield-alert-outline' },
};

const ALARM_MODES = [
  { flag: 1, service: 'alarm_arm_home', state: 'armed_home', label: 'Zuhause', icon: 'mdi:shield-home' },
  { flag: 2, service: 'alarm_arm_away', state: 'armed_away', label: 'Abwesend', icon: 'mdi:shield-lock' },
  { flag: 4, service: 'alarm_arm_night', state: 'armed_night', label: 'Nacht', icon: 'mdi:shield-moon' },
  { flag: 32, service: 'alarm_arm_vacation', state: 'armed_vacation', label: 'Urlaub', icon: 'mdi:shield-airplane' },
  { flag: 16, service: 'alarm_arm_custom_bypass', state: 'armed_custom_bypass', label: 'Teilweise', icon: 'mdi:shield-half-full' },
];

function getSupportedAlarmModes(st) {
  const features = Number(st?.attributes?.supported_features || 0);
  const matched = ALARM_MODES.filter((m) => (features & m.flag) !== 0);
  return matched.length ? matched : ALARM_MODES.slice(0, 4);
}

function extractSensorNames(raw, hass) {
  const ids = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.keys(raw) : []);
  return ids.filter(Boolean).map((id) => hass?.states?.[id]?.attributes?.friendly_name || id);
}

/**
 * In-Memory Alarm Keypad Modal:
 * Holds code exclusively in closure state (never DOM values, attributes, or storage).
 * Allows switching arming modes directly inside the modal while entering the PIN.
 * Auto-clears on error, submit, close, or 30s inactivity.
 */
class AlarmPinModal {
  constructor({ hass, entityId, service, actionLabel, modes = [], currentState = '', openSensors = [], onDone }) {
    this.hass = hass;
    this.entityId = entityId;
    this.service = service;
    this.actionLabel = actionLabel;
    this.modes = Array.isArray(modes) ? modes : [];
    this.currentState = currentState || '';
    this.openSensors = openSensors;
    this.onDone = onDone;

    this._code = '';
    this._busy = false;
    this._inactivityTimer = null;
    this._build();
    this._resetInactivity();
  }

  _resetInactivity() {
    clearTimeout(this._inactivityTimer);
    this._inactivityTimer = setTimeout(() => {
      this._code = '';
      this.destroy();
      this.onDone?.(false);
    }, 30000);
  }

  destroy() {
    this._code = '';
    clearTimeout(this._inactivityTimer);
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown, true);
      this._onKeyDown = null;
    }
    this.el?.remove();
    this.el = null;
  }

  _selectMode(mode) {
    if (this._busy || !mode || mode.state === this.currentState) return;
    this._resetInactivity();
    this.service = mode.service;
    this.actionLabel = `${mode.label} aktivieren`;
    this._errEl.textContent = '';
    if (this._titleEl) this._titleEl.textContent = this.actionLabel;
    if (this._submitText) this._submitText.textContent = this.actionLabel;
    this._dialog?.setAttribute('aria-label', `PIN für ${this.actionLabel}`);
    this._modeBar?.querySelectorAll('.pin-mode-chip').forEach((btn) => {
      btn.toggleAttribute('data-selected', btn.getAttribute('data-service') === this.service);
    });
  }

  _build() {
    this._dotsWrap = h('div', { class: 'pin-dots' });
    this._errEl = h('div', { class: 'pin-error' });
    this._titleEl = h('h2', {}, this.actionLabel);
    this._submitText = document.createTextNode(this.actionLabel);
    this._submitBtn = h('button', {
      type: 'button', class: 'btn primary', disabled: true,
      onClick: () => this._submit(),
    }, icon('mdi:check'), this._submitText);

    const showModeBar = this.service !== 'alarm_disarm' && this.modes.length > 1;
    this._modeBar = showModeBar
      ? h('div', { class: 'pin-mode-bar', role: 'group', 'aria-label': 'Alarm-Modus wählen' },
          ...this.modes.map((m) => h('button', {
            type: 'button',
            class: 'pin-mode-chip',
            'data-service': m.service,
            ...(m.service === this.service ? { 'data-selected': '' } : {}),
            disabled: m.state === this.currentState,
            onClick: () => this._selectMode(m),
          }, icon(m.icon), m.label)))
      : null;

    const openHint = this.openSensors.length
      ? h('div', { class: 'inline-notice', style: { marginBottom: '2px' } },
          icon('mdi:window-open-variant'),
          h('span', {}, `Offen: ${this.openSensors.join(', ')}`))
      : null;

    const mkKey = (lbl, onClick, ic = null, aria = lbl) => h('button', {
      type: 'button', class: 'pin-key', 'aria-label': aria,
      onClick: () => { this._resetInactivity(); onClick(); },
    }, ic ? icon(ic) : lbl);

    const keys = [
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
    ].map((d) => mkKey(d, () => this._pushDigit(d)));

    keys.push(
      mkKey('Löschen', () => { this._code = ''; this._errEl.textContent = ''; this._syncDots(); }, 'mdi:backspace-outline', 'Alles löschen'),
      mkKey('0', () => this._pushDigit('0')),
      mkKey('Zurück', () => {
        if (this._code.length) this._code = this._code.slice(0, -1);
        this._errEl.textContent = '';
        this._syncDots();
      }, 'mdi:keyboard-backspace', 'Letzte Ziffer löschen'),
    );

    this._dialog = h('div', { class: 'dialog pin-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `PIN für ${this.actionLabel}` },
      h('div', { class: 'dialog-head' },
        icon('mdi:shield-key-outline'),
        this._titleEl,
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': 'Abbrechen',
          onClick: () => { this.destroy(); this.onDone?.(false); },
        }, icon('mdi:close'))),
      h('div', { class: 'dialog-body', style: { paddingTop: '12px', gap: '8px' } },
        this._modeBar,
        openHint,
        this._dotsWrap,
        this._errEl,
        h('div', { class: 'pin-pad' }, ...keys)),
      h('div', { class: 'dialog-foot' },
        h('button', {
          type: 'button', class: 'btn',
          onClick: () => { this.destroy(); this.onDone?.(false); },
        }, 'Abbrechen'),
        this._submitBtn));

    this.el = h('div', {
      class: 'overlay',
      onClick: (e) => { if (e.target === this.el) { this.destroy(); this.onDone?.(false); } },
    }, this._dialog);

    this._onKeyDown = (e) => {
      if (this._busy) return;
      this._resetInactivity();
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.destroy();
        this.onDone?.(false);
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this._pushDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this._code = this._code.slice(0, -1);
        this._syncDots();
      } else if (e.key === 'Enter' && this._code.length > 0) {
        e.preventDefault();
        this._submit();
      }
    };
    document.addEventListener('keydown', this._onKeyDown, true);
    this._syncDots();
  }

  _pushDigit(d) {
    if (this._busy || this._code.length >= 10) return;
    this._errEl.textContent = '';
    this._code += d;
    this._syncDots();
  }

  _syncDots() {
    const slots = Math.max(4, Math.min(8, this._code.length));
    const dots = [];
    for (let i = 0; i < slots; i++) {
      dots.push(h('span', { class: 'pin-dot', ...(i < this._code.length ? { 'data-filled': '' } : {}) }));
    }
    this._dotsWrap.replaceChildren(...dots);
    this._submitBtn.disabled = this._busy || this._code.length === 0;
  }

  async _submit() {
    if (this._busy || !this._code) return;
    this._busy = true;
    const attempt = this._code;
    this._code = '';
    this._syncDots();
    this._errEl.textContent = 'Prüfe PIN...';
    try {
      await this.hass.callService('alarm_control_panel', this.service, {
        entity_id: this.entityId,
        code: attempt,
      });
      this.destroy();
      this.onDone?.(true);
    } catch (err) {
      this._busy = false;
      this._syncDots();
      this._dotsWrap.removeAttribute('data-shake');
      void this._dotsWrap.offsetWidth;
      this._dotsWrap.setAttribute('data-shake', '');
      const msg = String(err?.message || err || '');
      this._errEl.textContent = /code|pin|invalid|wrong|unauth/i.test(msg)
        ? 'Falscher PIN-Code'
        : (msg || 'Aktion fehlgeschlagen');
    }
  }
}

export class SecurityView {
  constructor({ hass, config, onBack }) {
    this.hass = hass;
    this.config = config || {};
    this.onBack = onBack;
    this._destroyed = false;
    this._pinModal = null;
    this._countdownInterval = null;
    this._camInterval = null;
    this._camTick = 0;
    this._camObserver = null;
    this._visibleCams = new Set();
    this._lastSig = '';

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#ef4444' } });
    this._onVisibility = () => {
      if (!this._destroyed && document.visibilityState === 'visible') this._refreshCameras();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._camInterval = setInterval(() => this._refreshCameras(), 8000);
    if (hass) this.update(hass);
  }

  destroy() {
    this._destroyed = true;
    clearInterval(this._countdownInterval);
    clearInterval(this._camInterval);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._camObserver?.disconnect?.();
    this._pinModal?.destroy?.();
    this._pinModal = null;
    // Drop open image requests on destroy
    this.el?.querySelectorAll('img[data-cam-img]').forEach((img) => {
      img.removeAttribute('src');
    });
  }

  _findAlarmEntity(hass) {
    const cfgId = this.config?.views?.security?.alarm_entity;
    if (cfgId && hass.states[cfgId]) return cfgId;
    if (hass.states['alarm_control_panel.alarmo']) return 'alarm_control_panel.alarmo';
    return Object.keys(hass.states).find((id) => id.startsWith('alarm_control_panel.')) || null;
  }

  _refreshCameras() {
    if (this._destroyed || document.visibilityState !== 'visible') return;
    this._camTick = Date.now();
    this.el?.querySelectorAll('img[data-cam-base]').forEach((img) => {
      const id = img.getAttribute('data-cam-id');
      if (this._visibleCams.size && id && !this._visibleCams.has(id)) return;
      const base = img.getAttribute('data-cam-base');
      if (!base) return;
      const sep = base.includes('?') ? '&' : '?';
      img.src = `${base}${sep}_t=${this._camTick}`;
    });
  }

  _triggerAlarmAction(alarmId, service, label, modes = null) {
    const st = this.hass?.states?.[alarmId];
    if (!st) return;
    const needsCode = !!st.attributes?.code_format
      && (service === 'alarm_disarm' || st.attributes?.code_arm_required !== false);
    const openSensors = extractSensorNames(st.attributes?.open_sensors, this.hass);
    const availModes = Array.isArray(modes) && modes.length ? modes : getSupportedAlarmModes(st);

    if (!needsCode) {
      this.hass.callService('alarm_control_panel', service, { entity_id: alarmId });
      return;
    }

    const root = this.el.getRootNode?.();
    this._pinModal?.destroy?.();
    this._pinModal = new AlarmPinModal({
      hass: this.hass,
      entityId: alarmId,
      service,
      actionLabel: label,
      modes: availModes,
      currentState: st.state,
      openSensors,
      onDone: () => { this._pinModal = null; },
    });
    (root?.append ? root : this.el).append(this._pinModal.el);
  }

  update(hass) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    const states = hass.states || {};

    const secCfg = this.config?.views?.security || {};
    const alarmId = this._findAlarmEntity(hass);
    const timerId = secCfg.timer_entity && states[secCfg.timer_entity] ? secCfg.timer_entity : 'timer.rauchalarm_countdown';
    const timerSt = states[timerId];
    const abortId = secCfg.abort_entity && states[secCfg.abort_entity] ? secCfg.abort_entity : 'input_boolean.rauchalarm_abbrechen';
    const smokeSensors = Object.keys(states).filter((id) => id.startsWith('binary_sensor.') && states[id]?.attributes?.device_class === 'smoke');
    const sirens = Object.keys(states).filter((id) => (id.startsWith('switch.') || id.startsWith('siren.')) && /sirene|siren/i.test(id));
    const camIds = Object.keys(states).filter((id) => id.startsWith('camera.'));
    const windowDoors = Object.keys(states).filter((id) => id.startsWith('binary_sensor.') && ['window', 'door', 'garage_door', 'opening'].includes(states[id]?.attributes?.device_class));
    const coverAutos = Object.keys(states).filter((id) => id.startsWith('automation.') && /rollladen|jalousie/i.test(id));
    const batteries = Object.keys(states).filter((id) => id.startsWith('sensor.') && states[id]?.attributes?.device_class === 'battery' && !/iphone|ipad|handy|phone|pixel|galaxy|watch|macbook|ios_/i.test(`${id} ${states[id]?.attributes?.friendly_name || ''}`));
    const fritz = (secCfg.router_entity && states[secCfg.router_entity])
      || states['binary_sensor.fritz_box_7590_ax_verbindung']
      || Object.values(states).find((s) => /fritz.*verbindung|router.*online/i.test(s.entity_id));
    const presenceId = secCfg.presence_entity && states[secCfg.presence_entity] ? secCfg.presence_entity : 'switch.anwesenheitssimulation';
    const pumpId = secCfg.water_pump_entity && states[secCfg.water_pump_entity] ? secCfg.water_pump_entity : 'switch.garten_wasserpumpe_fenster';

    const trackedIds = [
      alarmId,
      timerId,
      abortId,
      presenceId,
      pumpId,
      fritz?.entity_id,
      ...smokeSensors,
      ...sirens,
      ...camIds,
      ...windowDoors,
      ...coverAutos,
      ...batteries,
    ].filter(Boolean);

    const aSig = alarmId && states[alarmId]
      ? (() => {
          const a = states[alarmId].attributes || {};
          const openKey = a.open_sensors ? Object.keys(a.open_sensors).length : 0;
          const bypKey = Array.isArray(a.bypassed_sensors) ? a.bypassed_sensors.length : 0;
          return `|af=${a.supported_features ?? ''}:${a.arm_mode ?? ''}:${a.next_state ?? ''}:${a.code_arm_required ?? ''}:${openKey}:${bypKey}:${a.changed_by ?? ''}`;
        })()
      : '';
    const sig = trackedIds.map((id) => `${id}=${states[id]?.state}:${states[id]?.attributes?.finishes_at || ''}`).join('|') + aSig;
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    const children = [];

    // 1. Header (clean — no isolated floating status chip)
    const fritzOffline = fritz && (fritz.state === 'off' || isUnavailable(fritz));
    children.push(h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('button', { type: 'button', class: 'room-detail-back', onClick: () => this.onBack?.() }, icon('mdi:arrow-left'), 'Zurück'),
        h('div', { class: 'subview-hero-icon' }, icon('mdi:shield-home')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, 'Sicherheit'),
          h('div', { class: 'subview-sub' }, 'Alarmanlage, Rauchmelder, Kameras & Sensoren')))));

    // 2. Active Smoke Alarm or Timer Banner
    const activeSmokes = smokeSensors.filter((id) => ['on', 'detected', 'smoke'].includes(states[id]?.state));
    const timerActive = timerSt && (timerSt.state === 'active' || timerSt.state === 'paused');
    clearInterval(this._countdownInterval);
    this._countdownInterval = null;

    if (activeSmokes.length || timerActive) {
      const timerDigits = h('div', { class: 'timer-digits' }, '00:00');
      const tickTimer = () => {
        if (!timerSt) return;
        if (timerSt.state === 'active' && timerSt.attributes?.finishes_at) {
          const rem = Date.parse(timerSt.attributes.finishes_at) - Date.now();
          timerDigits.textContent = formatCountdownMs(rem);
        } else if (timerSt.attributes?.remaining) {
          timerDigits.textContent = String(timerSt.attributes.remaining);
        }
      };
      if (timerActive) {
        tickTimer();
        if (timerSt.state === 'active') {
          this._countdownInterval = setInterval(tickTimer, 1000);
        }
      }

      const abortEntity = states[abortId] ? abortId : null;
      children.push(h('div', { class: 'smoke-alert-banner' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          icon('mdi:fire-alert'),
          h('div', {},
            h('div', { style: { fontWeight: '800', fontSize: '15px', color: '#fecaca' } },
              activeSmokes.length ? `Rauch erkannt (${activeSmokes.map((id) => states[id]?.attributes?.friendly_name || id).join(', ')})` : 'Rauchalarm-Countdown aktiv'),
            h('div', { class: 'hint', style: { color: '#fee2e2' } }, '• Sirenen-Auslösung prüfen\n• Abbruch über Button'))),
        timerActive ? timerDigits : null,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          abortEntity ? h('button', {
            type: 'button', class: 'btn danger',
            onClick: () => hass.callService('input_boolean', 'turn_on', { entity_id: abortEntity }),
          }, icon('mdi:smoke-detector-variant-off'), 'Rauchalarm abbrechen') : null,
          timerActive ? h('button', {
            type: 'button', class: 'btn secondary',
            onClick: () => hass.callService('timer', 'cancel', { entity_id: timerId }),
          }, 'Timer stoppen') : null)));
    }

    // 3. Alarmo / Alarm Control Panel
    if (alarmId && states[alarmId]) {
      const aSt = states[alarmId];
      const meta = ALARM_STATE_META[aSt.state] || ALARM_STATE_META.unavailable;
      const modes = getSupportedAlarmModes(aSt);
      const isDisarmed = aSt.state === 'disarmed';
      const isArmed = aSt.state.startsWith('armed_');
      const isUnavail = isUnavailable(aSt);
      const nextMode = aSt.attributes?.next_state || aSt.attributes?.arm_mode;
      const nextMeta = nextMode ? ALARM_STATE_META[nextMode] : null;
      const statusText = aSt.state === 'arming' && nextMeta
        ? `Alarmanlage: Aktiviert (${nextMeta.label})...`
        : `Alarmanlage: ${meta.label}`;
      const openSensors = extractSensorNames(aSt.attributes?.open_sensors, hass);
      const bypassedSensors = extractSensorNames(aSt.attributes?.bypassed_sensors, hass);

      const actionButtons = [];
      if (!isUnavail) {
        if (isDisarmed) {
          modes.forEach((m) => actionButtons.push(h('button', {
            type: 'button', class: 'btn primary small',
            onClick: () => this._triggerAlarmAction(alarmId, m.service, `${m.label} aktivieren`, modes),
          }, icon(m.icon), m.label)));
        } else {
          actionButtons.push(h('button', {
            type: 'button', class: `btn danger${isArmed ? ' small' : ''}`,
            onClick: () => this._triggerAlarmAction(alarmId, 'alarm_disarm', 'Alarmanlage entschärfen', modes),
          }, icon('mdi:shield-off'), 'Entschärfen'));
          if (isArmed && modes.length > 1) {
            modes.forEach((m) => {
              const isCurrent = m.state === aSt.state;
              actionButtons.push(h('button', {
                type: 'button',
                class: `btn small${isCurrent ? ' alarm-mode-active' : ' secondary'}`,
                disabled: isCurrent,
                onClick: () => this._triggerAlarmAction(alarmId, m.service, `${m.label} aktivieren`, modes),
              }, icon(isCurrent ? 'mdi:check-circle' : m.icon), m.label));
            });
          }
        }
      }

      children.push(h('div', { class: 'alarm-hero', style: { '--alarm-color': meta.color } },
        h('div', { style: { display: 'grid', gap: '6px' } },
          h('div', { class: 'alarm-status-pill', onClick: () => moreInfo(this.el, alarmId) },
            icon(meta.icon),
            h('span', {}, statusText)),
          aSt.attributes?.changed_by ? h('div', { class: 'hint' }, `Zuletzt: ${aSt.attributes.changed_by}`) : null,
          openSensors.length ? h('div', { class: 'hint', style: { color: '#f59e0b' } }, `Offene Sensoren: ${openSensors.join(', ')}`) : null,
          bypassedSensors.length ? h('div', { class: 'hint' }, `Umgehung aktiv: ${bypassedSensors.join(', ')}`) : null),
        h('div', { class: 'alarm-modes' }, ...actionButtons)));
    }

    // 4. Quick Security Toggles (Presence Sim, Water Pump, Sirens)
    const quickEntities = [
      { id: presenceId, name: 'Anwesenheitssimulation', icon: 'mdi:home-clock', color: '#8b5cf6' },
      { id: pumpId, name: 'Garten Wasserpumpe', icon: 'mdi:water-pump', color: '#0ea5e9' },
      ...sirens.map((id) => ({
        id,
        name: states[id]?.attributes?.friendly_name || id,
        icon: 'mdi:bullhorn-variant',
        color: '#ef4444',
      })),
    ].filter((q) => states[q.id]);

    if (quickEntities.length) {
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon('mdi:shield-check'), 'Schutz & Aktoren')),
        h('div', { class: 'tile-grid', style: { padding: '0' } },
          ...quickEntities.map((q) => {
            const st = states[q.id];
            const active = st.state === 'on';
            const unav = isUnavailable(st);
            return h('div', {
              class: 'tile',
              'data-active': active ? 'true' : 'false',
              ...(unav ? { 'data-unavailable': '' } : {}),
              style: { '--tile-color': active ? q.color : 'var(--cd-secondary)' },
            },
            h('div', { class: 'tile-main' },
              h('button', {
                type: 'button', class: 'tile-icon',
                onClick: () => hass.callService(q.id.split('.')[0], 'toggle', { entity_id: q.id }),
              }, icon(q.icon)),
              h('div', { class: 'tile-info', onClick: () => moreInfo(this.el, q.id) },
                h('div', { class: 'tile-name' }, q.name),
                h('div', { class: 'tile-state' }, unav ? 'Nicht verfügbar' : (active ? 'Ein' : 'Aus')))));
          }))));
    }

    // 5. Cameras (each camera reads its own entity_picture — never hardcoded cross-camera ID)
    if (camIds.length) {
      this._camObserver?.disconnect?.();
      this._visibleCams.clear();
      if (typeof IntersectionObserver !== 'undefined') {
        this._camObserver = new IntersectionObserver((entries) => {
          for (const ent of entries) {
            const cid = ent.target.getAttribute('data-cam-id');
            if (!cid) continue;
            if (ent.isIntersecting) this._visibleCams.add(cid);
            else this._visibleCams.delete(cid);
          }
        }, { threshold: 0.05 });
      }
      const tick = Date.now();
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon('mdi:cctv'), `Kameras (${camIds.length})`)),
        h('div', { class: 'camera-grid' },
          ...camIds.map((cid) => {
            const st = states[cid];
            const name = st?.attributes?.friendly_name || cid;
            const pic = st?.attributes?.entity_picture || '';
            const unav = isUnavailable(st);
            const img = pic ? h('img', {
              alt: name,
              'data-cam-img': '',
              'data-cam-id': cid,
              'data-cam-base': pic,
              src: `${pic}${pic.includes('?') ? '&' : '?'}_t=${tick}`,
              loading: 'lazy',
            }) : h('div', { class: 'empty', style: { padding: '24px' } }, icon('mdi:video-off'));
            const card = h('div', {
              class: 'camera-card',
              'data-cam-id': cid,
              onClick: () => moreInfo(this.el, cid),
            },
            h('div', { class: 'camera-frame' }, unav ? h('div', { class: 'hint' }, 'Kamera offline') : img),
            h('div', { class: 'camera-foot' },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
              h('span', { class: 'badge-tag' }, unav ? 'Offline' : 'Live')));
            this._camObserver?.observe?.(card);
            return card;
          }))));
    }

    // 6. Smoke Detectors + Windows/Doors + Rolladen Automations
    if (smokeSensors.length) {
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon('mdi:smoke-detector-variant'), `Rauchmelder (${smokeSensors.length})`)),
        h('div', { class: 'kpi-grid' },
          ...smokeSensors.map((id) => {
            const st = states[id];
            const alarm = ['on', 'detected', 'smoke'].includes(st?.state);
            const unav = isUnavailable(st);
            return h('div', {
              class: 'kpi-card',
              style: alarm ? { borderColor: '#ef4444', background: 'rgba(239,68,68,.16)' } : {},
              onClick: () => moreInfo(this.el, id),
            },
            h('div', { class: 'kpi-top' },
              icon(alarm ? 'mdi:fire-alert' : 'mdi:smoke-detector'),
              h('span', {}, st?.attributes?.friendly_name || id)),
            h('div', { class: 'kpi-val', style: { fontSize: '15px', color: alarm ? '#ef4444' : (unav ? 'var(--cd-secondary)' : '#4caf50') } },
              unav ? 'Nicht verfügbar' : (alarm ? 'Rauchalarm' : 'OK · Kein Rauch')));
          }))));
    }

    if (windowDoors.length) {
      const openCount = windowDoors.filter((id) => states[id]?.state === 'on').length;
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon('mdi:window-open-variant'), `Fenster & Türen`),
          h('span', { class: 'badge-tag', style: openCount ? { color: '#ff9800' } : { color: '#4caf50' } },
            openCount ? `${openCount} geöffnet` : 'Alle geschlossen')),
        h('div', { class: 'log-list' },
          ...windowDoors.slice(0, 12).map((id) => {
            const st = states[id];
            const open = st?.state === 'on';
            return h('div', { class: 'log-row', style: { cursor: 'pointer' }, onClick: () => moreInfo(this.el, id) },
              h('div', { class: 'log-row-main' }, st?.attributes?.friendly_name || id),
              h('span', { class: 'badge-tag', style: open ? { color: '#ff9800' } : { color: '#4caf50' } }, open ? 'Offen' : 'Geschlossen'));
          }))));
    }

    if (coverAutos.length) {
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-title' }, icon('mdi:window-shutter-auto'), 'Rollladen-Automationen'),
        h('div', { class: 'tile-grid', style: { padding: '0' } },
          ...coverAutos.map((id) => {
            const st = states[id];
            const on = st?.state === 'on';
            return h('div', { class: 'tile', 'data-active': on ? 'true' : 'false' },
              h('div', { class: 'tile-main' },
                h('button', {
                  type: 'button', class: 'tile-icon',
                  onClick: () => hass.callService('automation', 'toggle', { entity_id: id }),
                }, icon('mdi:robot')),
                h('div', { class: 'tile-info', onClick: () => moreInfo(this.el, id) },
                  h('div', { class: 'tile-name' }, st?.attributes?.friendly_name || id),
                  h('div', { class: 'tile-state' }, on ? 'Aktiv' : 'Deaktiviert'))));
          }))));
    }

    const batThreshold = Number(secCfg.battery_threshold ?? 20);
    const critBat = batteries
      .map((id) => {
        const st = states[id];
        const raw = st?.state;
        const val = raw != null && raw !== '' ? Number(raw) : NaN;
        return { id, st, val, name: st?.attributes?.friendly_name || id };
      })
      .filter((b) => Number.isFinite(b.val) && b.val <= batThreshold)
      .sort((a, b) => a.val - b.val || a.name.localeCompare(b.name, 'de'));

    if (critBat.length) {
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon('mdi:battery-alert'), `Kritische Geräte-Batterien (≤ ${batThreshold} %)`),
          h('span', { class: 'badge-tag', style: { color: '#ef4444' } }, `${critBat.length} schwach`)),
        h('div', { class: 'kpi-grid' },
          ...critBat.map((b) => h('div', { class: 'kpi-card', onClick: () => moreInfo(this.el, b.id) },
            h('div', { class: 'kpi-top' }, icon('mdi:battery-alert'), h('span', {}, b.name)),
            h('div', { class: 'kpi-val', style: { fontSize: '16px', color: '#ef4444' } }, formatState(b.st)))))));
    }

    if (fritz) {
      children.push(h('div', { class: 'subview-section' },
        h('div', { class: 'subview-section-head' },
          h('div', { class: 'subview-section-title' }, icon(fritzOffline ? 'mdi:cloud-off-outline' : 'mdi:router-wireless'), 'System & Konnektivität')),
        h('div', { class: 'log-row', style: { cursor: 'pointer' }, onClick: () => moreInfo(this.el, fritz.entity_id) },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
            icon(fritzOffline ? 'mdi:router-wireless-off' : 'mdi:router-wireless'),
            h('span', { class: 'log-row-main' }, fritz.attributes?.friendly_name || 'Router / Internet')),
          h('span', { class: 'badge-tag', style: fritzOffline ? { color: '#ef4444' } : { color: '#4caf50' } },
            fritzOffline ? 'Offline' : 'Online'))));
    }

    if (!alarmId && !smokeSensors.length && !camIds.length && !quickEntities.length) {
      children.push(h('div', { class: 'card empty' },
        icon('mdi:shield-outline'),
        h('div', { style: { fontWeight: '600', margin: '8px 0 4px' } }, 'Keine Sicherheits-Entitäten gefunden'),
        h('div', { class: 'hint' }, '• Alarmanlage, Rauchmelder oder Kameras in HA einrichten')));
    }

    this.el.replaceChildren(...children);
  }
}
