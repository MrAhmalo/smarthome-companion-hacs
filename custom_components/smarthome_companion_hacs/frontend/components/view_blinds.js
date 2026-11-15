// Blinds View: Sun & Facade Solar Intensity, Configured/Unconfigured Stats, Grouped Cover Controls & 24h Logbook.
import {
  h, icon, isUnavailable, moreInfo, areaIdForEntity, formatState,
} from '../lib/util.js';
import { createCoverRow, updateCoverRow } from './cover_row.js';

function _blCoverSignature(states, rooms, coverIds, editMode) {
  const avail = (coverIds || []).map((id) => `${id}:${isUnavailable(states[id]) ? '0' : '1'}`).join(',');
  const roomSig = (rooms || []).map((r) => `${r.area_id}:${r.name}:${r.expanded ? 1 : 0}`).join('|');
  return `${editMode ? 1 : 0}##${avail}##${roomSig}`;
}

function _blFmtTime(raw) {
  if (raw == null) return '';
  let d;
  if (typeof raw === 'number') {
    d = new Date(raw < 1e12 ? raw * 1000 : raw);
  } else {
    d = new Date(raw);
  }
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export class BlindsView {
  constructor({ hass, layout, config, ctx, onBack } = {}) {
    this.hass = hass;
    this.layout = layout;
    this.config = config;
    this.ctx = ctx || {};
    this.onBack = onBack;
    this._destroyed = false;
    this._structSig = '';
    this._sunFacadeSig = '';
    this._setupSig = '';
    this._rowCtrls = new Map();
    this._logCache = null;
    this._logFetchedAt = 0;
    this._logSeq = 0;

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#9c27b0' } });
    this._buildShell();
    if (hass) this.update(hass, layout, config, ctx);
  }

  destroy() {
    this._destroyed = true;
    this._rowCtrls.clear();
  }

  _buildShell() {
    this._subEl = h('div', { class: 'subview-sub' }, 'Alle Rollläden nach Räumen');

    const openIntegrationBtn = h('button', {
      type: 'button', class: 'btn',
      onClick: () => {
        const target = '/config/integrations/integration/smarthome_companion_hacs';
        window.history.pushState(null, '', target);
        window.dispatchEvent(new CustomEvent('location-changed', { bubbles: true, composed: true }));
      },
    }, icon('mdi:clock-outline'), 'Planung');

    const allOpenBtn = h('button', {
      type: 'button', class: 'btn',
      onClick: () => this._allAction('open_cover'),
    }, icon('mdi:arrow-up'), 'Alle auf');

    const allCloseBtn = h('button', {
      type: 'button', class: 'btn',
      onClick: () => this._allAction('close_cover'),
    }, icon('mdi:arrow-down'), 'Alle zu');

    const head = h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('div', { class: 'subview-hero-icon' }, icon('mdi:window-shutter-cog')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, 'Rollläden'),
          this._subEl)),
      h('div', { class: 'subview-actions' },
        allOpenBtn,
        allCloseBtn,
        openIntegrationBtn));

    // Sun & Facades
    this._sunSummaryEl = h('span', { class: 'badge-chip' });
    this._facadeGrid = h('div', { class: 'kpi-grid' });
    this._facadeSec = h('section', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('blinds'); },
    },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:weather-sunny'), 'Sonnenstand & Fassaden'),
        this._sunSummaryEl),
      this._facadeGrid);

    // Offline warning section
    this._offlineWrap = h('div', { class: 'log-list' });
    this._offlineSec = h('section', { class: 'subview-section', hidden: true },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:cloud-off-outline'), 'Offline Rollläden')),
      this._offlineWrap);

    // Grouped Covers container
    this._groupsWrap = h('div', { style: { display: 'grid', gap: '12px', minWidth: '0' } });

    // Setup status (configured / unconfigured sensors)
    this._setupGrid = h('div', { class: 'kpi-grid' });
    this._setupLists = h('div', { style: { display: 'grid', gap: '8px' } });
    this._setupSec = h('section', { class: 'subview-section', hidden: true },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:clipboard-check-outline'), 'Rollladen-Automatik Einrichtung')),
      this._setupGrid,
      this._setupLists);

    // 24h Logbook
    this._logWrap = h('div', { class: 'log-list' },
      h('div', { class: 'log-row' }, h('span', { class: 'log-row-main' }, 'Lade Aktivitäten...')));
    const logSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:history'), 'Aktivitäten (24h)'),
        h('button', {
          type: 'button', class: 'btn sm',
          onClick: () => { this._logFetchedAt = 0; this._fetchLogbook(); },
        }, icon('mdi:refresh'), 'Aktualisieren')),
      this._logWrap);

    this.el.append(head, this._facadeSec, this._offlineSec, this._groupsWrap, this._setupSec, logSec);
  }

  _configuredCoverIds(states) {
    const ids = new Set(
      (this.layout?.configured?.covers || [])
        .map((c) => (typeof c === 'string' ? c : c?.entity_id))
        .filter(Boolean)
    );
    for (const r of this.layout?.rooms || []) {
      for (const t of r.tiles || []) {
        if (t.entity_id?.startsWith('cover.')) ids.add(t.entity_id);
        for (const m of t.members || []) {
          const eid = typeof m === 'string' ? m : m?.entity_id;
          if (eid?.startsWith('cover.')) ids.add(eid);
        }
      }
    }
    return [...ids].filter((id) => Boolean(states[id])).sort();
  }

  _facadesList() {
    const bCfg = this.config?.views?.blinds || {};
    return [
      { key: 'ost', label: 'Osten', intensity: bCfg.facade_east_entity || '', peak: bCfg.facade_east_peak_entity || '' },
      { key: 'sued', label: 'Süden', intensity: bCfg.facade_south_entity || '', peak: bCfg.facade_south_peak_entity || '' },
      { key: 'west', label: 'Westen', intensity: bCfg.facade_west_entity || '', peak: bCfg.facade_west_peak_entity || '' },
    ].filter((f) => f.intensity || f.peak);
  }

  _allAction(svc) {
    if (!this.hass) return;
    const states = this.hass.states || {};
    const ids = this._configuredCoverIds(states).filter((id) => !isUnavailable(states[id]));
    if (!ids.length) return;
    this.hass.callService('cover', svc, { entity_id: ids });
  }

  update(hass, layout, config, ctx) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (layout) this.layout = layout;
    if (config !== undefined) this.config = config;
    if (ctx !== undefined) this.ctx = ctx;
    const states = hass.states || {};
    const rooms = this.layout?.rooms || [];
    const editMode = Boolean(this.ctx?.editMode);
    this._facadeSec.toggleAttribute('data-edit-mode', editMode);

    this._updateSunAndFacades(states);
    this._updateSetupStatus(states);
    this._syncCoverGroups(states, rooms, editMode);

    // Refresh existing persistent cover rows without DOM rebuild
    for (const ctrl of this._rowCtrls.values()) {
      updateCoverRow(ctrl, hass);
    }

    const coverIds = this._configuredCoverIds(states);
    const activeCovers = coverIds.filter((id) => !isUnavailable(states[id]));
    const openCount = activeCovers.filter((id) => states[id].state === 'open').length;
    this._subEl.textContent = coverIds.length
      ? `${openCount} von ${activeCovers.length} geöffnet`
      : 'Noch keine Rollläden eingerichtet';

    if (Date.now() - this._logFetchedAt > 60000) {
      this._fetchLogbook();
    }
  }

  _updateSunAndFacades(states) {
    const sun = states['sun.sun'];
    const facades = this._facadesList();
    const sig = `${sun?.state || ''}:${sun?.attributes?.elevation ?? ''}|` + facades.map((f) => `${states[f.intensity]?.state || ''}:${states[f.peak]?.state || ''}`).join('|');
    if (sig === this._sunFacadeSig) return;
    this._sunFacadeSig = sig;

    if (sun) {
      const above = sun.state === 'above_horizon';
      const elev = sun.attributes?.elevation != null ? ` (${Math.round(sun.attributes.elevation)}°)` : '';
      this._sunSummaryEl.textContent = `${above ? 'Über Horizont' : 'Unter Horizont'}${elev}`;
      this._sunSummaryEl.hidden = false;
    } else {
      this._sunSummaryEl.hidden = true;
    }

    const cards = [];
    for (const fac of facades) {
      const stInt = fac.intensity ? states[fac.intensity] : null;
      const stPeak = fac.peak ? states[fac.peak] : null;
      if (!stInt && !stPeak) continue;
      const valText = stInt ? formatState(stInt) : '—';
      let peakText = 'Höhepunkt: —';
      if (stPeak && !isUnavailable(stPeak)) {
        const d = new Date(stPeak.state);
        peakText = `Höhepunkt: ${Number.isNaN(d.getTime()) ? stPeak.state : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
      }
      cards.push(h('div', {
        class: 'kpi-card', style: { '--kpi-color': '#f59e0b' },
        onClick: (e) => {
          if (this.ctx?.editMode) return;
          e.stopPropagation();
          moreInfo(this.el, (stInt || stPeak).entity_id);
        },
      },
        h('div', { class: 'kpi-top' }, icon('mdi:white-balance-sunny'), fac.label),
        h('div', { class: 'kpi-val' }, valText),
        h('div', { class: 'kpi-sub' }, peakText)));
    }
    if (!cards.length && !sun) {
      this._facadeSec.hidden = true;
    } else {
      this._facadeSec.hidden = false;
      if (!cards.length) {
        cards.push(h('div', { class: 'kpi-card' },
          h('div', { class: 'kpi-top' }, icon('mdi:weather-sunny'), 'Sonnenstand'),
          h('div', { class: 'kpi-val' }, sun.state === 'above_horizon' ? 'Tag' : 'Nacht'),
          h('div', { class: 'kpi-sub' }, '• Keine Fassaden-Sensoren konfiguriert')));
      }
    }
    this._facadeGrid.replaceChildren(...cards);
  }

  _updateSetupStatus(states) {
    const cfg = states['sensor.smarthome_companion_eingerichtete_rollladen'];
    const uncfg = states['sensor.smarthome_companion_nicht_eingerichtete_rollladen'];
    const cfgList = Array.isArray(cfg?.attributes?.configured_blinds) ? cfg.attributes.configured_blinds : [];
    const uncfgList = Array.isArray(uncfg?.attributes?.unconfigured_blinds) ? uncfg.attributes.unconfigured_blinds : [];
    const setupSig = `${cfg?.state ?? ''}:${cfgList.length}|${uncfg?.state ?? ''}:${uncfgList.map((b) => b.entity_id || b.name || b).join(',')}`;
    if (setupSig === this._setupSig) return;
    this._setupSig = setupSig;

    if (!cfg && !uncfg) {
      this._setupSec.hidden = true;
      return;
    }
    this._setupSec.hidden = false;

    this._setupGrid.replaceChildren(
      h('div', {
        class: 'kpi-card', style: { '--kpi-color': '#10b981' },
        onClick: () => cfg && moreInfo(this.el, cfg.entity_id),
      },
        h('div', { class: 'kpi-top' }, icon('mdi:check-circle-outline'), 'Eingerichtet'),
        h('div', { class: 'kpi-val' }, cfg ? String(cfg.state) : String(cfgList.length)),
        h('div', { class: 'kpi-sub' }, 'Aktive Zeitpläne')),
      h('div', {
        class: 'kpi-card', style: { '--kpi-color': '#f59e0b' },
        onClick: () => uncfg && moreInfo(this.el, uncfg.entity_id),
      },
        h('div', { class: 'kpi-top' }, icon('mdi:alert-circle-outline'), 'Offene Einrichtung'),
        h('div', { class: 'kpi-val' }, uncfg ? String(uncfg.state) : String(uncfgList.length)),
        h('div', { class: 'kpi-sub' }, 'Ohne Zeitplan')),
    );

    const blocks = [];
    if (uncfgList.length) {
      blocks.push(h('div', { class: 'log-list' },
        h('div', { class: 'section-label' }, 'Noch nicht eingerichtet'),
        ...uncfgList.slice(0, 12).map((b) => h('div', { class: 'log-row' },
          h('span', { class: 'log-row-main' }, b.name || b.entity_id || String(b)),
          h('span', { class: 'log-row-time' }, 'Offen')))));
    }
    this._setupLists.replaceChildren(...blocks);
  }

  _syncCoverGroups(states, rooms, editMode = false) {
    const allCovers = this._configuredCoverIds(states);
    const sig = _blCoverSignature(states, rooms, allCovers, editMode);
    if (sig === this._structSig) return;
    this._structSig = sig;
    this._rowCtrls.clear();

    const offline = allCovers.filter((id) => isUnavailable(states[id]));
    const active = allCovers.filter((id) => !isUnavailable(states[id]));

    if (offline.length) {
      this._offlineSec.hidden = false;
      this._offlineWrap.replaceChildren(...offline.map((id) => h('div', {
        class: 'log-row', style: { cursor: 'pointer' },
        onClick: () => moreInfo(this.el, id),
      },
        h('span', { class: 'log-row-main' }, states[id]?.attributes?.friendly_name || id),
        h('span', { class: 'log-row-time' }, states[id]?.state || 'unavailable'))));
    } else {
      this._offlineSec.hidden = true;
    }

    // Build entity -> room map (first from layout.rooms tiles, then HA area_id)
    const entityToRoom = new Map();
    const roomById = new Map();
    for (const r of rooms) {
      if (!r?.area_id) continue;
      roomById.set(r.area_id, r);
      for (const t of r.tiles || []) {
        if (t.entity_id?.startsWith('cover.')) entityToRoom.set(t.entity_id, r.area_id);
      }
    }

    const grouped = new Map();
    for (const id of active) {
      const rId = entityToRoom.get(id) || areaIdForEntity(this.hass, id) || '__other__';
      if (!grouped.has(rId)) grouped.set(rId, []);
      grouped.get(rId).push(id);
    }

    // Order rooms matching dashboard order, followed by extra areas and __other__
    const orderedIds = [];
    for (const r of rooms) {
      if (r?.area_id && grouped.has(r.area_id)) orderedIds.push(r.area_id);
    }
    for (const k of grouped.keys()) {
      if (k !== '__other__' && !orderedIds.includes(k)) orderedIds.push(k);
    }
    if (grouped.has('__other__')) orderedIds.push('__other__');

    if (!this._roomOpen) this._roomOpen = new Map();
    const sections = [];
    for (const rId of orderedIds) {
      const ids = grouped.get(rId) || [];
      ids.sort((a, b) => {
        const na = states[a]?.attributes?.friendly_name || a;
        const nb = states[b]?.attributes?.friendly_name || b;
        return na.localeCompare(nb, 'de');
      });

      const roomMeta = roomById.get(rId);
      const areaMeta = this.hass?.areas?.[rId];
      const title = roomMeta?.name || areaMeta?.name || (rId === '__other__' ? 'Weitere Rollläden' : rId);
      const rIcon = roomMeta?.icon || areaMeta?.icon || 'mdi:window-shutter';
      if (!this._roomOpen.has(rId)) {
        this._roomOpen.set(rId, !!(roomMeta && roomMeta.expanded));
      }
      const isOpen = !!this._roomOpen.get(rId);

      const rows = ids.map((id) => {
        const st = states[id];
        const spec = {
          entity_id: id,
          name: st?.attributes?.friendly_name || id,
        };
        const ctrl = createCoverRow(spec, { getHass: () => this.hass });
        this._rowCtrls.set(id, ctrl);
        return ctrl.row;
      });

      const body = h('div', { class: 'blinds-room-body', hidden: !isOpen },
        h('div', { class: 'cover-detail-list' }, ...rows));
      const card = h('section', { class: 'subview-section blinds-room-card' });
      if (isOpen) card.setAttribute('data-open', '');

      const head = h('div', {
        class: 'blinds-room-head',
        role: 'button',
        tabindex: '0',
        'aria-expanded': isOpen ? 'true' : 'false',
        onClick: () => {
          const next = !this._roomOpen.get(rId);
          this._roomOpen.set(rId, next);
          card.toggleAttribute('data-open', next);
          body.hidden = !next;
          head.setAttribute('aria-expanded', next ? 'true' : 'false');
        },
        onKeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); }
        },
      },
        h('div', { class: 'blinds-room-head-left' },
          icon(rIcon),
          h('span', { class: 'blinds-room-title' }, title),
          h('span', { class: 'badge-chip' }, `${ids.length}`)),
        h('div', { class: 'blinds-room-actions' },
          h('button', {
            type: 'button', class: 'mini-btn', 'aria-label': `${title} öffnen`,
            onClick: (e) => {
              e.stopPropagation();
              this.hass?.callService('cover', 'open_cover', { entity_id: ids });
            },
          }, icon('mdi:arrow-up')),
          h('button', {
            type: 'button', class: 'mini-btn', 'aria-label': `${title} schließen`,
            onClick: (e) => {
              e.stopPropagation();
              this.hass?.callService('cover', 'close_cover', { entity_id: ids });
            },
          }, icon('mdi:arrow-down')),
          icon('mdi:chevron-down', 'blinds-room-chevron')));

      card.append(head, body);
      sections.push(card);
    }

    if (!sections.length) {
      const emptyCard = h('section', {
        class: 'subview-section',
        onClick: () => { if (editMode) this.ctx?.onAddDevice?.() || this.ctx?.onOpenSettings?.('blinds'); },
      },
        h('div', { class: 'empty-hint' }, '• Noch keine Rollläden im Assistenten eingerichtet\n• Geräte über „+ Gerät“ hinzufügen'));
      emptyCard.toggleAttribute('data-edit-mode', editMode);
      sections.push(emptyCard);
    }

    this._groupsWrap.replaceChildren(...sections);
  }

  async _fetchLogbook() {
    if (!this.hass || this._destroyed) return;
    const seq = ++this._logSeq;
    this._logFetchedAt = Date.now();
    const coverIds = this._configuredCoverIds(this.hass.states || {});
    if (!coverIds.length) {
      this._logWrap.replaceChildren(h('div', { class: 'empty-hint' }, 'Keine eingerichteten Rollläden vorhanden.'));
      return;
    }

    try {
      const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const end = new Date().toISOString();
      const res = await this.hass.callWS({
        type: 'logbook/get_events',
        start_time: start,
        end_time: end,
        entity_ids: coverIds.slice(0, 60),
      });
      if (this._destroyed || seq !== this._logSeq) return;

      const entries = (Array.isArray(res) ? res : [])
        .slice(-25)
        .reverse();
      if (!entries.length) {
        this._logWrap.replaceChildren(h('div', { class: 'empty-hint' }, 'Keine Aktivitäten in den letzten 24 Stunden.'));
        return;
      }

      this._logWrap.replaceChildren(...entries.map((ev) => {
        const label = ev.name || this.hass?.states?.[ev.entity_id]?.attributes?.friendly_name || ev.entity_id || 'Rollladen';
        const desc = ev.message || (ev.state ? `${label}: ${ev.state}` : label);
        const text = ev.message ? `${label} ${desc}` : desc;
        return h('div', {
          class: 'log-row', style: ev.entity_id ? { cursor: 'pointer' } : {},
          onClick: () => ev.entity_id && moreInfo(this.el, ev.entity_id),
        },
          h('span', { class: 'log-row-main' }, text),
          h('span', { class: 'log-row-time' }, _blFmtTime(ev.when)));
      }));
    } catch (_) {
      if (this._destroyed || seq !== this._logSeq) return;
      this._logWrap.replaceChildren(h('div', { class: 'empty-hint' }, 'Logbook aktuell nicht abrufbar.'));
    }
  }
}
