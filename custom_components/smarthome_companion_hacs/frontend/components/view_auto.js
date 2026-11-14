// Auto View: Dynamic BMW CarData Entity/Device Discovery & Configurable Volvo Webview (with HTTPS Mixed-Content Guard).
import {
  h, icon, isUnavailable, moreInfo, formatState,
} from '../lib/util.js';

const _AUTO_BMW_DEVICE_ID = '7ae00fdd4f8a117f65bb4f5275b021fc';
const _AUTO_DEFAULT_VOLVO_URL = 'http://192.168.178.188:6176/';
const _AUTO_UTILITY_RE = /(overcharge|protection|kindersicherung|child_lock|childlock|led_mode|ledmode)/i;

function _autoMatchId(id, extraPrefix = '') {
  if (_AUTO_UTILITY_RE.test(id)) return false;
  if (extraPrefix && id.toLowerCase().includes(String(extraPrefix).toLowerCase())) return true;
  return /(?:^|\.)(?:.*(?:bmw|gv_jm_13|cardata).*)$/i.test(id);
}

function _autoIsUtility(st, entry) {
  if (entry && (entry.disabled_by || ['config', 'diagnostic'].includes(entry.entity_category))) return true;
  const hay = `${st?.entity_id || ''} ${st?.attributes?.friendly_name || ''}`;
  return _AUTO_UTILITY_RE.test(hay);
}

function _autoClassify(states, ids) {
  const kpis = [];
  const controls = [];
  const trackers = [];
  const other = [];

  for (const id of ids) {
    const st = states[id];
    if (!st || _autoIsUtility(st, null)) continue;
    const dom = id.split('.')[0];
    const dc = st.attributes?.device_class || '';
    const unit = st.attributes?.unit_of_measurement || '';
    const name = st.attributes?.friendly_name || id;

    if (dom === 'device_tracker') {
      trackers.push(st);
    } else if (['button', 'switch', 'lock'].includes(dom)) {
      controls.push(st);
    } else if (
      dc === 'battery' || dc === 'distance' || dc === 'energy' ||
      /soc|reichweite|range|batterie|kilometer|odometer|ladestatus|charging|stecker|plug|verriegel|lock/i.test(`${id} ${name} ${unit}`)
    ) {
      kpis.push(st);
    } else {
      other.push(st);
    }
  }
  return { kpis, controls, trackers, other };
}

export class AutoView {
  constructor({ hass, config, onBack }) {
    this.hass = hass;
    this.config = config;
    this.onBack = onBack;
    this._destroyed = false;
    this._bmwSig = '';
    this._volvoUrlRendered = null;

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#3b82f6' } });
    this._buildShell();
    if (hass) this.update(hass, config);
  }

  destroy() {
    this._destroyed = true;
  }

  _buildShell() {
    this._subEl = h('div', { class: 'subview-sub' }, 'Fahrzeugstatus & Lade-Übersicht');

    const head = h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('div', { class: 'subview-hero-icon' }, icon('mdi:car')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, 'Auto'),
          this._subEl)),
      h('div', { class: 'subview-actions' },
        this.onBack ? h('button', { type: 'button', class: 'btn', onClick: this.onBack }, icon('mdi:arrow-left'), 'Zurück') : null));

    // BMW CarData Section
    this._bmwPlateChip = h('span', { class: 'badge-chip' }, 'GV-JM-13');
    this._bmwKpiGrid = h('div', { class: 'kpi-grid' });
    this._bmwControls = h('div', { class: 'alarm-modes' });
    this._bmwOther = h('div', { class: 'log-list' });
    this._bmwDetails = h('details', {},
      h('summary', { style: { cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: 'var(--cd-secondary)', padding: '4px 0' } }, 'Alle Fahrzeugsensoren'),
      this._bmwOther);

    const bmwSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:car-electric'), 'BMW CarData'),
        this._bmwPlateChip),
      this._bmwKpiGrid,
      this._bmwControls,
      this._bmwDetails);

    // Volvo / External Iframe Section
    this._volvoActions = h('div', { class: 'subview-actions' });
    this._volvoBody = h('div', { style: { display: 'grid', gap: '10px', minWidth: '0' } });
    this._volvoSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:car-estate'), 'Volvo'),
        this._volvoActions),
      this._volvoBody);

    this.el.append(head, bmwSec, this._volvoSec);
  }

  update(hass, config) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (config !== undefined) this.config = config;
    const plate = this.config?.views?.auto?.plate || 'GV-JM-13';
    if (this._bmwPlateChip) {
      this._bmwPlateChip.textContent = plate;
      this._bmwPlateChip.hidden = !plate;
    }
    this._renderBmw(hass.states || {});
    this._renderVolvo();
  }

  _collectBmwIds(states) {
    const autoCfg = this.config?.views?.auto || {};
    const extraPrefix = autoCfg.entity_prefix || '';
    const devId = autoCfg.bmw_device_id || _AUTO_BMW_DEVICE_ID;
    const ids = new Set();
    const haEnts = this.hass?.entities || {};
    for (const [eid, entry] of Object.entries(haEnts)) {
      if (!entry || entry.disabled_by) continue;
      if (['config', 'diagnostic'].includes(entry.entity_category)) continue;
      if (!states[eid]) continue;
      if (
        (entry.device_id === devId || entry.platform === 'bmw_cardata' || _autoMatchId(eid, extraPrefix))
        && !_autoIsUtility(states[eid], entry)
      ) {
        ids.add(eid);
      }
    }
    for (const id of Object.keys(states)) {
      if (_autoMatchId(id, extraPrefix) && !_autoIsUtility(states[id], haEnts[id])) {
        ids.add(id);
      }
    }
    return [...ids].sort();
  }

  _renderBmw(states) {
    const ids = this._collectBmwIds(states);
    const sig = ids.map((id) => `${id}:${states[id]?.state}`).join('|');
    if (sig === this._bmwSig) return;
    this._bmwSig = sig;

    if (!ids.length) {
      this._bmwKpiGrid.replaceChildren(h('div', { class: 'empty-hint' }, 'Keine BMW CarData Entitäten gefunden.'));
      this._bmwControls.replaceChildren();
      this._bmwDetails.hidden = true;
      return;
    }

    const { kpis, controls, trackers, other } = _autoClassify(states, ids);
    const primary = [...kpis, ...trackers].slice(0, 8);
    if (!primary.length) primary.push(...other.slice(0, 4).map((s) => s));

    this._bmwKpiGrid.replaceChildren(...primary.map((st) => h('div', {
      class: 'kpi-card',
      style: { '--kpi-color': isUnavailable(st) ? '#64748b' : '#3b82f6' },
      onClick: () => moreInfo(this.el, st.entity_id),
    },
      h('div', { class: 'kpi-top' },
        icon(st.attributes?.icon || 'mdi:car-info'),
        h('span', {}, st.attributes?.friendly_name || st.entity_id)),
      h('div', { class: 'kpi-val' }, formatState(st)),
      h('div', { class: 'kpi-sub' }, st.entity_id))));

    this._bmwControls.replaceChildren(...controls.map((st) => {
      const dom = st.entity_id.split('.')[0];
      const lbl = st.attributes?.friendly_name || st.entity_id;
      const active = dom === 'switch' ? st.state === 'on' : st.state === 'locked';
      return h('button', {
        type: 'button',
        class: `btn${active ? ' primary' : ''}`,
        disabled: dom === 'button' ? (!st || st.state === 'unavailable') : isUnavailable(st),
        onClick: () => {
          if (!this.hass) return;
          if (dom === 'button') this.hass.callService('button', 'press', { entity_id: st.entity_id });
          else if (dom === 'switch') this.hass.callService('switch', 'toggle', { entity_id: st.entity_id });
          else if (dom === 'lock') {
            this.hass.callService('lock', st.state === 'locked' ? 'unlock' : 'lock', { entity_id: st.entity_id });
          }
        },
      }, icon(st.attributes?.icon || 'mdi:gesture-tap-button'), lbl);
    }));

    const rest = ids
      .filter((id) => !primary.some((p) => p.entity_id === id) && !controls.some((c) => c.entity_id === id))
      .map((id) => states[id]);
    if (rest.length) {
      this._bmwDetails.hidden = false;
      this._bmwOther.replaceChildren(...rest.map((st) => h('div', {
        class: 'log-row', style: { cursor: 'pointer' },
        onClick: () => moreInfo(this.el, st.entity_id),
      },
        h('span', { class: 'log-row-main' }, st.attributes?.friendly_name || st.entity_id),
        h('span', { class: 'log-row-time' }, formatState(st)))));
    } else {
      this._bmwDetails.hidden = true;
    }

    const firstTracker = trackers[0];
    this._subEl.textContent = firstTracker
      ? `BMW GV-JM-13 · ${formatState(firstTracker)}`
      : `${ids.length} BMW Sensoren aktiv`;
  }

  _renderVolvo() {
    const rawUrl = this.config?.views?.auto?.webview_url ?? _AUTO_DEFAULT_VOLVO_URL;
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    const isHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const isMixedContent = Boolean(url && isHttps && /^http:/i.test(url));
    const renderKey = `${url}|${isMixedContent}`;
    if (renderKey === this._volvoUrlRendered) return;
    this._volvoUrlRendered = renderKey;

    if (!url) {
      this._volvoSec.hidden = true;
      return;
    }
    this._volvoSec.hidden = false;

    const extBtn = h('a', {
      href: url, target: '_blank', rel: 'noopener noreferrer', class: 'btn sm',
    }, icon('mdi:open-in-new'), 'Im neuen Tab öffnen');
    this._volvoActions.replaceChildren(extBtn);

    if (isMixedContent) {
      this._volvoBody.replaceChildren(
        h('div', { class: 'inline-notice' },
          icon('mdi:shield-lock-outline'),
          h('span', {}, 'Lokale HTTP-Quelle unter HTTPS blockiert. Öffne Volvo direkt im neuen Tab.')),
        h('div', { style: { fontSize: '12px', color: 'var(--cd-secondary)', wordBreak: 'break-all' } }, url));
      return;
    }

    const frame = h('iframe', {
      class: 'iframe-card',
      src: url,
      title: 'Volvo Ansicht',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
    this._volvoBody.replaceChildren(frame);
  }
}
