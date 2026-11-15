// Auto View: Dynamic BMW CarData Entity/Device Discovery & Configurable Volvo Webview (with HTTPS Mixed-Content Guard).
import {
  h, icon, isUnavailable, moreInfo, formatState,
} from '../lib/util.js';

const _AUTO_UTILITY_RE = /(overcharge|protection|kindersicherung|child_lock|childlock|led_mode|ledmode)/i;

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
  constructor({ hass, layout, config, ctx }) {
    this.hass = hass;
    this.layout = layout || null;
    this.config = config;
    this.ctx = ctx || null;
    this._destroyed = false;
    this._bmwSig = '';
    this._volvoUrlRendered = null;

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#3b82f6' } });
    this._buildShell();
    if (hass) this.update(hass, layout, config);
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
          this._subEl)));

    this._bmwPlateChip = h('span', { class: 'badge-chip' }, '');
    this._bmwKpiGrid = h('div', { class: 'kpi-grid' });
    this._bmwControls = h('div', { class: 'alarm-modes' });
    this._bmwOther = h('div', { class: 'log-list' });
    this._bmwDetails = h('details', {},
      h('summary', { style: { cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: 'var(--cd-secondary)', padding: '4px 0' } }, 'Alle Fahrzeugsensoren'),
      this._bmwOther);

    this._bmwSec = h('section', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('auto'); },
    },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:car-electric'), 'Fahrzeug-Status'),
        this._bmwPlateChip),
      this._bmwKpiGrid,
      this._bmwControls,
      this._bmwDetails);

    this._volvoActions = h('div', { class: 'subview-actions' });
    this._volvoBody = h('div', { style: { display: 'grid', gap: '10px', minWidth: '0' } });
    this._volvoSec = h('section', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('auto'); },
    },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:car-estate'), 'Fahrzeug-Webansicht'),
        this._volvoActions),
      this._volvoBody);

    this.el.append(head, this._bmwSec, this._volvoSec);
  }

  update(hass, layout, config, ctx) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (layout !== undefined) this.layout = layout;
    if (config !== undefined) this.config = config;
    if (ctx !== undefined) this.ctx = ctx;
    const editMode = Boolean(this.ctx?.editMode);
    this._bmwSec?.toggleAttribute('data-edit-mode', editMode);
    this._volvoSec?.toggleAttribute('data-edit-mode', editMode);
    const plate = this.config?.views?.auto?.plate || '';
    if (this._bmwPlateChip) {
      this._bmwPlateChip.textContent = plate;
      this._bmwPlateChip.hidden = !plate;
    }
    this._renderBmw(hass.states || {});
    this._renderVolvo();
  }

  _collectBmwIds(states) {
    const autoCfg = this.config?.views?.auto || {};
    const extraPrefix = (autoCfg.entity_prefix || '').trim().toLowerCase();
    const devId = autoCfg.device_id || autoCfg.bmw_device_id || '';
    const configuredDevs = new Set(this.layout?.configured?.device_ids || []);
    const configuredEnts = new Set(this.layout?.configured?.entity_ids || []);
    const targetDevId = devId || (configuredDevs.has(devId) ? devId : '');
    if (!targetDevId && !extraPrefix) return [];

    const ids = new Set();
    const haEnts = this.hass?.entities || {};
    for (const [eid, entry] of Object.entries(haEnts)) {
      if (!entry || entry.disabled_by) continue;
      if (['config', 'diagnostic'].includes(entry.entity_category)) continue;
      if (!states[eid]) continue;
      const matchDev = targetDevId && entry.device_id === targetDevId;
      const matchPrefix = extraPrefix && eid.toLowerCase().includes(extraPrefix);
      if ((matchDev || matchPrefix) && !_autoIsUtility(states[eid], entry)) {
        ids.add(eid);
      }
    }
    if (extraPrefix) {
      for (const id of Object.keys(states)) {
        if (id.toLowerCase().includes(extraPrefix) && !_autoIsUtility(states[id], haEnts[id])) {
          ids.add(id);
        }
      }
    }
    for (const cid of configuredEnts) {
      if (extraPrefix && cid.toLowerCase().includes(extraPrefix) && states[cid]) ids.add(cid);
    }
    return [...ids].sort();
  }

  _renderBmw(states) {
    const ids = this._collectBmwIds(states);
    const editMode = !!this.ctx?.isEditMode?.();
    const sig = ids.map((id) => `${id}:${states[id]?.state}`).join('|') + `|em:${editMode ? 1 : 0}`;
    if (sig === this._bmwSig) return;
    this._bmwSig = sig;
    const e2d = this.layout?.configured?.entity_to_device || {};

    if (!ids.length) {
      this._bmwKpiGrid.replaceChildren(h('div', {
        class: 'empty-hint',
        ...(editMode ? { 'data-edit-mode': '', onClick: () => this.ctx?.onOpenSettings?.() } : {}),
      }, 'Keine Fahrzeug-Entitäten konfiguriert.'));
      this._bmwControls.replaceChildren();
      this._bmwDetails.hidden = true;
      return;
    }

    const { kpis, controls, trackers, other } = _autoClassify(states, ids);
    const primary = [...kpis, ...trackers].slice(0, 8);
    if (!primary.length) primary.push(...other.slice(0, 4).map((s) => s));

    this._bmwKpiGrid.replaceChildren(...primary.map((st) => h('div', {
      class: 'kpi-card',
      ...(editMode ? { 'data-edit-mode': '' } : {}),
      style: { '--kpi-color': isUnavailable(st) ? '#64748b' : '#3b82f6' },
      onClick: () => {
        if (editMode) {
          const did = e2d[st.entity_id];
          if (did) this.ctx?.onOpenDevice?.(did);
          else this.ctx?.onOpenSettings?.();
          return;
        }
        moreInfo(this.el, st.entity_id);
      },
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
      ? `${this.config?.views?.auto?.plate || 'Fahrzeug'} · ${formatState(firstTracker)}`
      : `${ids.length} Fahrzeug-Sensoren aktiv`;
  }

  _renderVolvo() {
    const rawUrl = this.config?.views?.auto?.webview_url ?? '';
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
