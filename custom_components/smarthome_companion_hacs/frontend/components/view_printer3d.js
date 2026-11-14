// 3D Printer View: Bambu Lab A1 Mini Auto-Discovery, Print Progress, Temperatures & Hue Work Light.
import {
  h, icon, isUnavailable, numeric, moreInfo, formatState, showConfirmDialog,
} from '../lib/util.js';

const _P3D_DEVICE_ID = '3896a2c7ff7d1946d671305a9359c828';
const _P3D_LIGHT_ID = 'light.phillips_hue_vintage_8_temp';

const _P3D_KNOWN = {
  step: 'sensor.3dprinter_a1mini_aktueller_arbeitsschritt',
  task: 'sensor.3dprinter_a1mini_name_der_aufgabe',
  remaining: 'sensor.3dprinter_a1mini_verbleibende_zeit',
  eta: 'sensor.3dprinter_a1mini_vrs_fertigstellung',
  progress: 'sensor.3dprinter_a1mini_druckfortschritt',
  layerCur: 'sensor.3dprinter_a1mini_aktuelle_schicht',
  layerTotal: 'sensor.3dprinter_a1mini_gesamtzahl_der_schichten',
  nozzleSize: 'sensor.3dprinter_a1mini_dusengrosse',
  nozzleType: 'sensor.3dprinter_a1mini_dusentyp',
  fan: 'fan.3dprinter_a1mini_druckkopflufter',
  nozzleTempTarget: 'number.3dprinter_a1mini_zieltemperatur_der_duse',
  bedTempTarget: 'number.3dprinter_a1mini_zieltemperatur_des_druckbett',
  speedSelect: 'select.3dprinter_a1mini_druckgeschwindigkeit',
};

export class Printer3DView {
  constructor({ hass, config, onBack }) {
    this.hass = hass;
    this.config = config || {};
    this.onBack = onBack;
    this._destroyed = false;
    this._lastSig = '';

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#10b981' } });
    this._buildShell();
    if (hass) this.update(hass, config);
  }

  destroy() {
    this._destroyed = true;
  }

  _lightId() {
    return this.config?.views?.printer3d?.light_entity || _P3D_LIGHT_ID;
  }

  _knownState(states, key) {
    const baseId = _P3D_KNOWN[key];
    if (!baseId) return null;
    if (states[baseId]) return states[baseId];
    const prefix = (this.config?.views?.printer3d?.entity_prefix || '').trim();
    if (prefix && prefix !== '3dprinter_a1mini') {
      const altId = baseId.replace('3dprinter_a1mini', prefix);
      if (states[altId]) return states[altId];
    }
    return null;
  }

  _buildShell() {
    this._subEl = h('div', { class: 'subview-sub' }, 'Bambu Lab A1 Mini');
    this._lightBtn = h('button', {
      type: 'button', class: 'btn', hidden: true,
      onClick: () => this.hass?.callService('light', 'toggle', { entity_id: this._lightId() }),
    }, icon('mdi:lightbulb-outline'), 'Drucker-Licht');

    const head = h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('div', { class: 'subview-hero-icon' }, icon('mdi:printer-3d-nozzle')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, '3D-Drucker'),
          this._subEl)),
      h('div', { class: 'subview-actions' },
        this._lightBtn,
        this.onBack ? h('button', { type: 'button', class: 'btn', onClick: this.onBack }, icon('mdi:arrow-left'), 'Zurück') : null));

    // Print Status Hero
    this._jobTitleEl = h('div', { style: { fontSize: '16px', fontWeight: '700' } }, 'Standby');
    this._stepBadgeEl = h('span', { class: 'badge-chip' }, 'Bereit');
    this._progressValEl = h('span', { style: { fontSize: '20px', fontWeight: '800', fontVariantNumeric: 'tabular-nums' } }, '0 %');
    this._progressFillEl = h('div', { class: 'progress-bar-fill', style: { width: '0%', background: '#10b981' } });
    this._heroKpiGrid = h('div', { class: 'kpi-grid' });

    const statusSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:cube-scan'), 'Druckstatus'),
        this._stepBadgeEl),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
        this._jobTitleEl,
        this._progressValEl),
      h('div', { class: 'progress-bar-track' }, this._progressFillEl),
      this._heroKpiGrid);

    // Controls Section (Fan, Speed, Nozzle & Bed Target Temps, Action buttons)
    this._controlsWrap = h('div', { style: { display: 'grid', gap: '10px', minWidth: '0' } });
    const ctrlSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:tune-variant'), 'Steuerung')),
      this._controlsWrap);

    // Details & Specs
    this._detailsWrap = h('div', { class: 'log-list' });
    const detailsSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:information-outline'), 'Drucker-Details')),
      this._detailsWrap);

    this.el.append(head, statusSec, ctrlSec, detailsSec);
  }

  _collectEntityIds(states) {
    const p3dCfg = this.config?.views?.printer3d || {};
    const devId = p3dCfg.device_id || _P3D_DEVICE_ID;
    const prefix = p3dCfg.entity_prefix || '3dprinter_a1mini';
    const haEnts = this.hass?.entities || {};
    const ids = new Set();

    for (const [eid, entry] of Object.entries(haEnts)) {
      if (!entry || entry.disabled_by) continue;
      if (['config', 'diagnostic'].includes(entry.entity_category)) continue;
      if (!states[eid]) continue;
      if (entry.device_id === devId || eid.toLowerCase().includes(prefix.toLowerCase())) {
        ids.add(eid);
      }
    }
    for (const id of Object.values(_P3D_KNOWN)) {
      const altId = prefix && prefix !== '3dprinter_a1mini' ? id.replace('3dprinter_a1mini', prefix) : id;
      if (states[id]) ids.add(id);
      if (states[altId]) ids.add(altId);
    }
    for (const id of Object.keys(states)) {
      if (id.toLowerCase().includes(prefix.toLowerCase())) ids.add(id);
    }
    return [...ids].sort();
  }

  update(hass, config) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (config !== undefined) this.config = config;
    const states = hass.states || {};
    const ids = this._collectEntityIds(states);

    const lightId = this._lightId();
    const lightSt = states[lightId];
    if (lightSt) {
      this._lightBtn.hidden = false;
      this._lightBtn.classList.toggle('primary', lightSt.state === 'on');
    } else {
      this._lightBtn.hidden = true;
    }

    const sig = `${lightId}|` + ids.map((id) => `${id}:${states[id]?.state}:${states[id]?.attributes?.percentage ?? ''}`).join('|');
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    const stepSt = this._knownState(states, 'step');
    const taskSt = this._knownState(states, 'task');
    const remSt = this._knownState(states, 'remaining');
    const etaSt = this._knownState(states, 'eta');
    const progSt = this._knownState(states, 'progress');
    const curL = this._knownState(states, 'layerCur');
    const totL = this._knownState(states, 'layerTotal');
    const nozzleSize = this._knownState(states, 'nozzleSize');
    const nozzleType = this._knownState(states, 'nozzleType');

    const stepRaw = stepSt ? String(stepSt.state) : 'offline';
    const isOffline = !stepSt || isUnavailable(stepSt) || stepRaw === 'offline';
    const pct = Math.max(0, Math.min(100, numeric(progSt) ?? 0));

    this._subEl.textContent = isOffline ? 'Offline / Nicht verbunden' : `${formatState(stepSt)} · A1 Mini`;
    this._stepBadgeEl.textContent = isOffline ? 'Offline' : formatState(stepSt);
    this._stepBadgeEl.style.color = isOffline ? '#ef4444' : '#10b981';
    this._jobTitleEl.textContent = (taskSt && !isUnavailable(taskSt) && taskSt.state) ? taskSt.state : 'Kein aktiver Druckauftrag';
    this._progressValEl.textContent = `${Math.round(pct)} %`;
    this._progressFillEl.style.width = `${pct}%`;

    const etaText = etaSt && !isUnavailable(etaSt)
      ? (() => {
          const d = new Date(etaSt.state);
          return Number.isNaN(d.getTime()) ? etaSt.state : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        })()
      : '—';

    const layerText = (curL && totL && !isUnavailable(curL) && !isUnavailable(totL))
      ? `${curL.state} / ${totL.state}`
      : '—';

    this._heroKpiGrid.replaceChildren(
      h('div', { class: 'kpi-card', onClick: () => remSt && moreInfo(this.el, remSt.entity_id) },
        h('div', { class: 'kpi-top' }, icon('mdi:timer-sand'), 'Verbleibend'),
        h('div', { class: 'kpi-val' }, remSt && !isUnavailable(remSt) ? formatState(remSt) : '—'),
        h('div', { class: 'kpi-sub' }, `Fertig ca. ${etaText}`)),
      h('div', { class: 'kpi-card', onClick: () => curL && moreInfo(this.el, curL.entity_id) },
        h('div', { class: 'kpi-top' }, icon('mdi:layers-outline'), 'Schicht'),
        h('div', { class: 'kpi-val' }, layerText),
        h('div', { class: 'kpi-sub' }, 'Aktuell / Gesamt')),
      h('div', { class: 'kpi-card', onClick: () => nozzleSize && moreInfo(this.el, nozzleSize.entity_id) },
        h('div', { class: 'kpi-top' }, icon('mdi:printer-3d-nozzle-outline'), 'Düse'),
        h('div', { class: 'kpi-val' }, nozzleSize && !isUnavailable(nozzleSize) ? formatState(nozzleSize) : '—'),
        h('div', { class: 'kpi-sub' }, nozzleType && !isUnavailable(nozzleType) ? nozzleType.state : 'Standard')),
    );

    this._renderControls(states, ids);
    this._renderDetails(states, ids);
  }

  _renderControls(states, ids) {
    const rows = [];

    const fan = this._knownState(states, 'fan');
    if (fan) {
      const isOn = fan.state === 'on';
      rows.push(h('div', { class: 'log-row', style: { padding: '10px 12px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
          icon('mdi:fan'),
          h('span', { class: 'log-row-main' }, 'Druckkopflüfter')),
        h('button', {
          type: 'button', class: `btn sm${isOn ? ' primary' : ''}`,
          disabled: isUnavailable(fan),
          onClick: () => this.hass?.callService('fan', 'toggle', { entity_id: fan.entity_id }),
        }, isOn ? `Ein (${fan.attributes?.percentage ?? 100}%)` : 'Aus')));
    }

    const speed = this._knownState(states, 'speedSelect');
    if (speed && Array.isArray(speed.attributes?.options)) {
      const sel = h('select', {
        class: 'text-input',
        style: { width: 'auto', minWidth: '130px' },
        disabled: isUnavailable(speed),
        onChange: (e) => {
          this.hass?.callService('select', 'select_option', {
            entity_id: speed.entity_id,
            option: e.target.value,
          });
        },
      }, ...speed.attributes.options.map((opt) => {
        const o = h('option', { value: opt }, opt);
        if (opt === speed.state) o.selected = true;
        return o;
      }));
      rows.push(h('div', { class: 'log-row', style: { padding: '8px 12px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
          icon('mdi:speedometer'),
          h('span', { class: 'log-row-main' }, 'Druckgeschwindigkeit')),
        sel));
    }

    for (const [key, label, ic] of [
      ['nozzleTempTarget', 'Zieltemperatur Düse', 'mdi:thermometer'],
      ['bedTempTarget', 'Zieltemperatur Druckbett', 'mdi:radiator'],
    ]) {
      const st = this._knownState(states, key);
      if (!st) continue;
      const id = st.entity_id;
      const cur = numeric(st) ?? 0;
      const step = Number(st.attributes?.step || 5);
      const min = Number(st.attributes?.min ?? 0);
      const max = Number(st.attributes?.max ?? 300);
      const unit = st.attributes?.unit_of_measurement || '°C';
      const setVal = (v) => {
        const clamped = Math.max(min, Math.min(max, v));
        this.hass?.callService('number', 'set_value', { entity_id: id, value: clamped });
      };
      rows.push(h('div', { class: 'log-row', style: { padding: '8px 12px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
          icon(ic),
          h('span', { class: 'log-row-main' }, label)),
        h('div', { class: 'tile-btns' },
          h('button', { type: 'button', class: 'mini-btn', disabled: isUnavailable(st), onClick: () => setVal(cur - step) }, icon('mdi:minus')),
          h('span', { style: { minWidth: '52px', textAlign: 'center', fontWeight: '700', fontSize: '12px' } }, `${cur} ${unit}`),
          h('button', { type: 'button', class: 'mini-btn', disabled: isUnavailable(st), onClick: () => setVal(cur + step) }, icon('mdi:plus')))));
    }

    // Discovered printer button controls (Pause/Resume/Stop)
    const btns = ids.filter((id) => id.startsWith('button.'));
    if (btns.length) {
      rows.push(h('div', { class: 'alarm-modes', style: { marginTop: '4px' } },
        ...btns.map((id) => {
          const st = states[id];
          const isStop = /stop|abbruch|cancel/i.test(id);
          return h('button', {
            type: 'button',
            class: `btn sm${isStop ? ' danger' : ''}`,
            disabled: !st || st.state === 'unavailable',
            onClick: async () => {
              if (isStop) {
                const ok = await showConfirmDialog(this.el, {
                  title: 'Druckauftrag abbrechen?',
                  message: 'Möchtest du den laufenden Druckauftrag wirklich abbrechen?',
                  confirmLabel: 'Abbrechen',
                  danger: true,
                });
                if (!ok) return;
              }
              this.hass?.callService('button', 'press', { entity_id: id });
            },
          }, icon(st?.attributes?.icon || 'mdi:gesture-tap-button'), st?.attributes?.friendly_name || id);
        })));
    }

    if (!rows.length) {
      rows.push(h('div', { class: 'empty-hint' }, 'Keine Drucker-Steuerungen verfügbar.'));
    }
    this._controlsWrap.replaceChildren(...rows);
  }

  _renderDetails(states, ids) {
    const rows = ids
      .filter((id) => id.startsWith('sensor.') || id.startsWith('binary_sensor.'))
      .map((id) => {
        const st = states[id];
        return h('div', {
          class: 'log-row', style: { cursor: 'pointer' },
          onClick: () => moreInfo(this.el, id),
        },
          h('span', { class: 'log-row-main' }, st?.attributes?.friendly_name || id),
          h('span', { class: 'log-row-time' }, formatState(st)));
      });
    this._detailsWrap.replaceChildren(...(rows.length ? rows : [
      h('div', { class: 'empty-hint' }, 'Keine Sensordaten gefunden.'),
    ]));
  }
}
