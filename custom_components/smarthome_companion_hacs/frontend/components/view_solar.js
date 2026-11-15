// Solar View: In-Place Live SVG Energy Flow, Statistics Trend Chart, Forecast & Consumption KPIs.
import {
  h, icon, numeric, moreInfo,
} from '../lib/util.js';

function _pickState(states, id) {
  return (id && states[id]) ? states[id] : null;
}

function _num(st) {
  const n = numeric(st);
  return n !== null ? n : 0;
}

function _fmtWatts(w) {
  const abs = Math.abs(w);
  return abs >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}

export class SolarView {
  constructor({ hass, layout, config, ctx }) {
    this.hass = hass;
    this.layout = layout || null;
    this.config = config || {};
    this.ctx = ctx || null;
    this._destroyed = false;
    this._lastSig = '';
    this._statsCache = null;
    this._statsFetchedAt = 0;
    this._fetchSeq = 0;

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#f59e0b' } });
    this._buildShell();
    if (hass) this.update(hass, layout, config);
  }

  destroy() {
    this._destroyed = true;
  }

  _buildShell() {
    this._svgNodes = {};
    const mkSvgEl = (tag, attrs = {}, text = '') => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text) el.textContent = text;
      return el;
    };

    // Static Energiefluss SVG created once — patched in-place on updates (Zero-Flicker)
    const flowSvg = mkSvgEl('svg', { viewBox: '0 0 420 226', role: 'img', 'aria-label': 'Energiefluss' });
    this._flowPvHouse = mkSvgEl('path', { d: 'M 210 74 L 210 144', class: 'flow-line', stroke: '#f59e0b' });
    this._flowPvBat = mkSvgEl('path', { d: 'M 176 46 C 110 46 68 68 68 100', class: 'flow-line', stroke: '#10b981' });
    this._flowPvGrid = mkSvgEl('path', { d: 'M 244 46 C 310 46 352 68 352 100', class: 'flow-line', stroke: '#03a9f4' });
    this._flowBatHouse = mkSvgEl('path', { d: 'M 102 142 C 138 148 158 164 178 176', class: 'flow-line', stroke: '#22c55e' });
    this._flowGridHouse = mkSvgEl('path', { d: 'M 318 142 C 282 148 262 164 242 176', class: 'flow-line', stroke: '#ef4444' });

    flowSvg.append(this._flowPvHouse, this._flowPvBat, this._flowPvGrid, this._flowBatHouse, this._flowGridHouse);

    const mkNode = (cx, cy, color, title, withSub = false) => {
      const g = mkSvgEl('g');
      const circle = mkSvgEl('circle', { cx, cy, r: 34, fill: 'rgba(128,128,128,0.14)', stroke: color, 'stroke-width': 2.2 });
      const lbl = mkSvgEl('text', { x: cx, y: cy - (withSub ? 11 : 6), 'text-anchor': 'middle', fill: 'currentColor', 'font-size': '9.5', 'font-weight': '600', opacity: '0.78' }, title);
      const val = mkSvgEl('text', { x: cx, y: cy + (withSub ? 4 : 9), 'text-anchor': 'middle', fill: color, 'font-size': '11', 'font-weight': '800' }, '0 W');
      g.append(circle, lbl, val);
      let sub = null;
      if (withSub) {
        sub = mkSvgEl('text', { x: cx, y: cy + 17, 'text-anchor': 'middle', fill: color, 'font-size': '8.5', 'font-weight': '600', opacity: '0.88' }, '');
        g.append(sub);
      }
      flowSvg.append(g);
      return withSub ? { val, sub } : val;
    };

    this._flowValPv = mkNode(210, 40, '#f59e0b', 'PV');
    const batNodes = mkNode(68, 134, '#10b981', 'Batterie', true);
    this._flowValBat = batNodes.val;
    this._flowSubBat = batNodes.sub;
    this._flowValGrid = mkNode(352, 134, '#03a9f4', 'Netz');
    this._flowValHouse = mkNode(210, 180, 'var(--primary-text-color, #e5e7eb)', 'Haus');

    this._kpiWrap = h('div', { class: 'kpi-grid' });
    this._chartWrap = h('div', { class: 'solar-svg-wrap' },
      h('div', { class: 'hint' }, 'Lade 24h Solar-Verlauf...'));
    this._forecastWrap = h('div', { class: 'kpi-grid' });

    this._flowSec = h('div', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('solar'); },
    },
      h('div', { class: 'subview-section-title' }, icon('mdi:transmission-tower'), 'Energiefluss'),
      h('div', { class: 'solar-svg-wrap' }, flowSvg),
      this._kpiWrap);
    this._chartSec = h('div', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('solar'); },
    },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:chart-areaspline'), '24h Verlauf (PV & Haus)'),
        h('button', { type: 'button', class: 'btn secondary small', onClick: (e) => { e.stopPropagation(); this._loadHistory(true); } }, icon('mdi:refresh'), 'Aktualisieren')),
      this._chartWrap);
    this._forecastSec = h('div', {
      class: 'subview-section',
      onClick: () => { if (this.ctx?.editMode) this.ctx?.onOpenSettings?.('solar'); },
    },
      h('div', { class: 'subview-section-title' }, icon('mdi:weather-sunny'), 'Produktions-Prognose (Ost / West)'),
      this._forecastWrap);

    this.el.replaceChildren(
      h('div', { class: 'subview-head' },
        h('div', { class: 'subview-head-left' },
          h('div', { class: 'subview-hero-icon' }, icon('mdi:solar-power-variant')),
          h('div', { style: { minWidth: '0' } },
            h('h2', { class: 'subview-title' }, 'Solar & Energie'),
            h('div', { class: 'subview-sub' }, 'Live-Energiefluss, Verlauf & Prognose')))),
      this._flowSec,
      this._chartSec,
      this._forecastSec);
  }

  async _loadHistory(force = false) {
    if (!this.hass?.callWS || this._destroyed) return;
    const now = Date.now();
    if (!force && this._statsCache && (now - this._statsFetchedAt) < 300000) {
      this._renderChart(this._statsCache);
      return;
    }

    const seq = ++this._fetchSeq;
    if (this._statsCache) this._chartWrap.style.opacity = '0.6';

    const sCfg = this.config?.views?.solar || {};
    const pvId = _pickState(this.hass.states, sCfg.pv_entity)?.entity_id;
    const houseId = _pickState(this.hass.states, sCfg.house_entity)?.entity_id;
    const entityIds = [pvId, houseId].filter(Boolean);
    if (!entityIds.length) {
      this._chartWrap.style.opacity = '1';
      this._chartWrap.replaceChildren(h('div', { class: 'hint' }, '• Keine PV-/Haus-Sensoren in Einstellungen hinterlegt'));
      return;
    }

    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    let series = null;
    try {
      const res = await this.hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: entityIds,
        period: 'hour',
        types: ['mean'],
      });
      if (res && Object.values(res).some((arr) => Array.isArray(arr) && arr.length > 0)) {
        series = { mode: 'stats', data: res, pvId, houseId };
      }
    } catch { /* fallback to history */ }

    if (!series) {
      try {
        const res = await this.hass.callWS({
          type: 'history/history_during_period',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          entity_ids: entityIds,
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: true,
        });
        series = { mode: 'history', data: res || {}, pvId, houseId };
      } catch {
        series = { mode: 'empty', data: {}, pvId, houseId };
      }
    }

    if (this._destroyed || seq !== this._fetchSeq) return;
    this._statsCache = series;
    this._statsFetchedAt = Date.now();
    this._chartWrap.style.opacity = '1';
    this._renderChart(series);
  }

  _renderChart(series) {
    const extract = (id) => {
      const arr = id ? (series?.data?.[id] || []) : [];
      if (series.mode === 'stats') {
        return arr.filter((p) => Number.isFinite(Number(p.mean))).map((p) => ({
          t: typeof p.start === 'number' ? p.start : Date.parse(p.start),
          v: Math.max(0, Number(p.mean)),
        }));
      }
      return arr.filter((p) => Number.isFinite(Number(p.s))).map((p) => ({
        t: typeof p.lu === 'number' ? p.lu * 1000 : Date.parse(p.lu || p.last_updated),
        v: Math.max(0, Number(p.s)),
      }));
    };

    const pvPts = extract(series?.pvId);
    const housePts = extract(series?.houseId);
    const allPts = [...pvPts, ...housePts];
    if (!allPts.length) {
      this._chartWrap.replaceChildren(h('div', { class: 'hint' }, '• Noch keine 24h-Verlaufsdaten vorhanden'));
      return;
    }

    const minT = Math.min(...allPts.map((p) => p.t));
    const maxT = Math.max(...allPts.map((p) => p.t), minT + 1);
    const maxV = Math.max(...allPts.map((p) => p.v), 500);
    const W = 400; const H = 130; const padL = 6; const padR = 6; const padT = 10; const padB = 20;
    const toX = (t) => padL + ((t - minT) / (maxT - minT)) * (W - padL - padR);
    const toY = (v) => padT + (1 - v / maxV) * (H - padT - padB);

    const mkSvg = (tag, attrs = {}, text = '') => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text) el.textContent = text;
      return el;
    };

    const svg = mkSvg('svg', { viewBox: `0 0 ${W} ${H}` });
    svg.append(mkSvg('line', { x1: padL, y1: H - padB, x2: W - padR, y2: H - padB, stroke: 'rgba(128,128,128,0.28)' }));
    svg.append(mkSvg('text', { x: padL, y: H - 5, fill: 'rgba(155,155,155,0.9)', 'font-size': '9.5' }, 'vor 24h'));
    svg.append(mkSvg('text', { x: W - padR, y: H - 5, 'text-anchor': 'end', fill: 'rgba(155,155,155,0.9)', 'font-size': '9.5' }, `Max ${_fmtWatts(maxV)} · Jetzt`));

    const drawLine = (pts, color) => {
      if (pts.length < 2) return;
      const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(p.t).toFixed(1)} ${toY(p.v).toFixed(1)}`).join(' ');
      svg.append(mkSvg('path', { d, fill: 'none', stroke: color, 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    };
    drawLine(housePts, '#ef4444');
    drawLine(pvPts, '#f59e0b');

    this._chartWrap.replaceChildren(
      h('div', { style: { display: 'flex', gap: '12px', fontSize: '12px', marginBottom: '6px' } },
        h('span', { style: { color: '#f59e0b', fontWeight: '600' } }, '● PV-Erzeugung'),
        h('span', { style: { color: '#ef4444', fontWeight: '600' } }, '● Hausverbrauch')),
      svg);
  }

  update(hass, arg1, arg2, arg3) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (arg1 && (Array.isArray(arg1.rooms) || 'configured' in arg1)) {
      this.layout = arg1;
      if (arg2 !== undefined) this.config = arg2;
      if (arg3 !== undefined) this.ctx = arg3;
    } else {
      if (arg1 !== undefined) this.config = arg1;
      if (arg2 !== undefined) this.ctx = arg2;
    }
    const editMode = Boolean(this.ctx?.editMode);
    this._flowSec?.toggleAttribute('data-edit-mode', editMode);
    this._chartSec?.toggleAttribute('data-edit-mode', editMode);
    this._forecastSec?.toggleAttribute('data-edit-mode', editMode);

    const states = hass.states || {};
    const sCfg = this.config?.views?.solar || {};
    const pick = (key) => _pickState(states, sCfg[key]);

    const pv = pick('pv_entity');
    const chg = pick('charge_entity');
    const dis = pick('discharge_entity');
    const soc = pick('soc_entity');
    const imp = pick('grid_import_entity');
    const exp = pick('grid_export_entity');
    const house = pick('house_entity');
    const dy = pick('daily_yield_entity');
    const dh = pick('daily_house_entity');
    const inc = pick('daily_income_entity');
    const sch = pick('schimmeldry_entity');

    const wNow = pick('west_now_entity');
    const wToday = pick('west_today_entity');
    const wPeak = pick('west_peak_entity');
    const eNow = pick('east_now_entity');
    const eToday = pick('east_today_entity');
    const ePeak = pick('east_peak_entity');

    const pvW = _num(pv);
    const chgW = _num(chg);
    const disW = _num(dis);
    const impW = _num(imp);
    const expW = _num(exp);
    const houseW = _num(house);
    const socVal = soc ? `${Math.round(_num(soc))}%` : '—';

    // Patch flow SVG nodes in-place without rebuilding DOM
    this._flowValPv.textContent = _fmtWatts(pvW);
    this._flowValBat.textContent = socVal;
    if (this._flowSubBat) {
      this._flowSubBat.textContent = chgW > 10 ? `+${_fmtWatts(chgW)}` : (disW > 10 ? `-${_fmtWatts(disW)}` : 'Standby');
    }
    this._flowValGrid.textContent = expW > 10 ? `-${_fmtWatts(expW)}` : `+${_fmtWatts(impW)}`;
    this._flowValHouse.textContent = _fmtWatts(houseW);

    this._flowPvHouse.toggleAttribute('data-active', pvW > 15 && houseW > 15);
    this._flowPvBat.toggleAttribute('data-active', chgW > 15);
    this._flowPvGrid.toggleAttribute('data-active', expW > 15);
    this._flowBatHouse.toggleAttribute('data-active', disW > 15);
    this._flowGridHouse.toggleAttribute('data-active', impW > 15);

    const sig = `${editMode ? 1 : 0}|` + [pv, chg, dis, soc, imp, exp, house, dy, dh, inc, sch, wNow, wToday, eNow, eToday]
      .map((s) => `${s?.entity_id || ''}:${s?.state || ''}`).join('|');
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    const kpis = [
      ...(pv ? [{ label: 'PV-Leistung', val: _fmtWatts(pvW), icon: 'mdi:solar-power', color: '#f59e0b', id: pv.entity_id }] : []),
      ...(house ? [{ label: 'Hausverbrauch', val: _fmtWatts(houseW), icon: 'mdi:home-lightning-bolt', color: '#ef4444', id: house.entity_id }] : []),
      ...(soc ? [{ label: 'Batterie', val: socVal, sub: chgW > 5 ? `Lädt ${_fmtWatts(chgW)}` : (disW > 5 ? `Entlädt ${_fmtWatts(disW)}` : 'Standby'), icon: 'mdi:battery-charging', color: '#10b981', id: soc.entity_id }] : []),
      ...((exp || imp) ? [{ label: expW > 10 ? 'Einspeisung' : 'Netzbezug', val: _fmtWatts(expW > 10 ? expW : impW), icon: 'mdi:transmission-tower', color: '#03a9f4', id: (expW > 10 ? exp : imp)?.entity_id }] : []),
      ...(dy ? [{ label: 'Tagesertrag', val: `${_num(dy).toFixed(1)} kWh`, icon: 'mdi:counter', color: '#f59e0b', id: dy.entity_id }] : []),
      ...(dh ? [{ label: 'Tagesverbrauch', val: `${_num(dh).toFixed(1)} kWh`, icon: 'mdi:home-analytics', color: '#fb7185', id: dh.entity_id }] : []),
      ...(inc ? [{ label: 'Tagesersparnis', val: `${_num(inc).toFixed(2)} €`, icon: 'mdi:cash-multiple', color: '#22c55e', id: inc.entity_id }] : []),
      ...(sch ? [{ label: 'Schimmeldry', val: `${_num(sch).toFixed(2)} ${sch.attributes?.unit_of_measurement || 'kWh'}`, icon: 'mdi:fan', color: '#38bdf8', id: sch.entity_id }] : []),
    ];

    this._kpiWrap.replaceChildren(...(kpis.length
      ? kpis.map((k) => h('div', {
          class: 'kpi-card',
          style: { '--kpi-color': k.color },
          onClick: (e) => {
            if (editMode) return;
            e.stopPropagation();
            if (k.id) moreInfo(this.el, k.id);
          },
        },
        h('div', { class: 'kpi-top' }, icon(k.icon), h('span', {}, k.label)),
        h('div', { class: 'kpi-val' }, k.val),
        k.sub ? h('div', { class: 'kpi-sub' }, k.sub) : null))
      : [h('div', { class: 'empty-hint' }, '• Keine Solar-Sensoren konfiguriert\n• Sensoren in Einstellungen → Solar hinterlegen')]));

    const totalNow = _num(wNow) + _num(eNow);
    const totalToday = _num(wToday) + _num(eToday);
    const fCards = [];
    if (wNow || eNow) {
      const primForecastId = (wNow || eNow)?.entity_id;
      fCards.push(
        h('div', {
          class: 'kpi-card', style: { '--kpi-color': '#f59e0b' },
          onClick: (e) => {
            if (editMode) return;
            e.stopPropagation();
            if (primForecastId) moreInfo(this.el, primForecastId);
          },
        },
          h('div', { class: 'kpi-top' }, icon('mdi:solar-power'), h('span', {}, 'Gesamt Prognose')),
          h('div', { class: 'kpi-val' }, _fmtWatts(totalNow)),
          h('div', { class: 'kpi-sub' }, `Heute ca. ${totalToday.toFixed(1)} kWh`)),
        ...(wNow ? [h('div', { class: 'kpi-card', style: { '--kpi-color': '#fb923c' }, onClick: (e) => { if (editMode) return; e.stopPropagation(); moreInfo(this.el, wNow.entity_id); } },
          h('div', { class: 'kpi-top' }, icon('mdi:weather-sunset-down'), h('span', {}, 'Westen')),
          h('div', { class: 'kpi-val' }, _fmtWatts(_num(wNow))),
          h('div', { class: 'kpi-sub' }, `Heute ${_num(wToday).toFixed(1)} kWh${wPeak ? ` · Peak ${wPeak.state}` : ''}`))] : []),
        ...(eNow ? [h('div', { class: 'kpi-card', style: { '--kpi-color': '#38bdf8' }, onClick: (e) => { if (editMode) return; e.stopPropagation(); moreInfo(this.el, eNow.entity_id); } },
          h('div', { class: 'kpi-top' }, icon('mdi:weather-sunset-up'), h('span', {}, 'Osten')),
          h('div', { class: 'kpi-val' }, _fmtWatts(_num(eNow))),
          h('div', { class: 'kpi-sub' }, `Heute ${_num(eToday).toFixed(1)} kWh${ePeak ? ` · Peak ${ePeak.state}` : ''}`))] : []),
      );
    } else {
      fCards.push(h('div', { class: 'hint' }, '• Keine Solarprognose-Sensoren konfiguriert'));
    }
    this._forecastWrap.replaceChildren(...fCards);

    if (!this._statsCache && (pv || house)) this._loadHistory(false);
  }
}
