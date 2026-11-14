// More View: Unified Navigation Hub (Topics & Settings), Persons & iPhone Batteries, Exterior Temp, Trash Preview & Helpers.
import {
  h, icon, isUnavailable, numeric, moreInfo, formatState, BUILTIN_VIEWS, resolveColor,
} from '../lib/util.js';

const _MORE_PEOPLE_TRACKERS = [
  { tracker: 'device_tracker.iphonevonbrigitte', name: 'Gitte', battery: 'sensor.gitte_battery_level' },
  { tracker: 'device_tracker.iphonevonjulian', name: 'Julian', battery: 'sensor.ahmalo_battery_level' },
  { tracker: 'device_tracker.iphonevonmatilda', name: 'Matilda', battery: 'sensor.matilda_battery_level' },
  { tracker: 'device_tracker.iphonevonsven', name: 'Sven', battery: 'sensor.ios_mphcv50qjl_battery_level' },
];

const _MORE_SCHIMMELDRY = [
  { id: 'switch.schimmeldry', name: 'Schimmeldry', icon: 'mdi:fan', toggle: true },
  { id: 'sensor.schimmeldry_tageslaufzeit', name: 'Tageslaufzeit', icon: 'mdi:timer-outline', toggle: false },
  { id: 'automation.schimmeldry_um_9_an', name: 'Schimmeldry um 9 Uhr an', icon: 'mdi:clock-start', toggle: true },
  { id: 'automation.batterie_leer_schimmeldry_aus', name: 'Batterie leer → Aus', icon: 'mdi:battery-alert', toggle: true },
  { id: 'automation.kein_ertrag_solar_aus', name: 'Kein Solar-Ertrag → Aus', icon: 'mdi:solar-power', toggle: true },
];

function _moreBatColor(pct) {
  if (pct == null) return '#64748b';
  if (pct <= 20) return '#ef4444';
  if (pct <= 40) return '#f59e0b';
  return '#10b981';
}

function _moreFmtTrashDate(ev) {
  const raw = ev.start?.date || ev.start?.dateTime || ev.start || '';
  if (!raw) return '';
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Morgen';
  if (diffDays > 1 && diffDays < 7) return `In ${diffDays} Tagen`;
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function _moreEventMs(ev) {
  const raw = ev?.start?.date || ev?.start?.dateTime || ev?.start || '';
  if (!raw) return Infinity;
  const ms = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw).getTime();
  return Number.isFinite(ms) ? ms : Infinity;
}

function _moreIsPhoneBattery(st) {
  const hay = `${st?.entity_id || ''} ${st?.attributes?.friendly_name || ''}`;
  return /iphone|ipad|handy|phone|pixel|galaxy|watch|macbook|ios_/i.test(hay);
}

const _WEATHER_DE = {
  'clear-night': 'Klare Nacht', cloudy: 'Bewölkt', fog: 'Nebel', hail: 'Hagel',
  lightning: 'Gewitter', 'lightning-rainy': 'Gewitter & Regen', partlycloudy: 'Teilw. bewölkt',
  pouring: 'Starkregen', rainy: 'Regen', snowy: 'Schnee', 'snowy-rainy': 'Schneeregen',
  sunny: 'Sonnig', windy: 'Windig', 'windy-variant': 'Windig', exceptional: 'Ausnahme',
};

export class MoreView {
  constructor({ hass, config, user, isAdmin, onNavigate, onOpenSettings, onBack }) {
    this.hass = hass;
    this.config = config;
    this.user = user;
    this.isAdmin = Boolean(isAdmin);
    this.onNavigate = onNavigate;
    this.onOpenSettings = onOpenSettings;
    this.onBack = onBack;
    this._destroyed = false;
    this._lastSig = '';
    this._hubSig = '';
    this._trashEvents = null;
    this._trashFetchedAt = 0;
    this._trashCalSig = '';
    this._batFilter = 'all';

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#03a9f4' } });
    this._buildShell();
    if (hass) this.update(hass, config, user, isAdmin);
  }

  destroy() {
    this._destroyed = true;
  }

  _buildShell() {
    const head = h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('div', { class: 'subview-hero-icon' }, icon('mdi:view-grid-plus-outline')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, 'Mehr & Bereiche'),
          h('div', { class: 'subview-sub' }, 'Themen, Batterien, Wetter & Müllplan'))),
      h('div', { class: 'subview-actions' },
        this.onBack ? h('button', { type: 'button', class: 'btn', onClick: this.onBack }, icon('mdi:arrow-left'), 'Zurück') : null));

    // Topic Hub Grid
    this._hubGrid = h('div', { class: 'more-grid' });
    const hubSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:compass-outline'), 'Bereiche')),
      this._hubGrid);

    // Persons + iPhone Battery Grid
    this._peopleGrid = h('div', { class: 'kpi-grid' });
    this._peopleSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:account-group-outline'), 'Personen & Smartphones')),
      this._peopleGrid);

    // Climate, System Status & Trash Preview
    this._tempCard = h('div', { class: 'kpi-grid' });
    this._trashList = h('div', { class: 'log-list' });
    const infoSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:calendar-month-outline'), 'Wetter, System & Müllplan')),
      this._tempCard,
      this._trashList);

    // Full Battery Overview with filter chips & low-first sorting
    this._batFilters = h('div', { class: 'filter-chips' });
    this._batList = h('div', { class: 'log-list' });
    this._batSec = h('section', { class: 'subview-section', hidden: true },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:battery-charging-80'), 'Batterie-Übersicht'),
        this._batFilters),
      this._batList);

    // Schimmeldry & Helpers
    this._helpersWrap = h('div', { class: 'log-list' });
    this._helpersSec = h('section', { class: 'subview-section', hidden: true },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:fan'), 'Schimmeldry & Automationen')),
      this._helpersWrap);

    this.el.append(head, hubSec, this._peopleSec, infoSec, this._batSec, this._helpersSec);
  }

  _viewVisible(viewId) {
    const vCfg = this.config?.views?.[viewId];
    if (!vCfg) return true;
    if (vCfg.enabled === false) return false;
    const allowedUsers = vCfg.users || vCfg.visible_users;
    if (Array.isArray(allowedUsers) && allowedUsers.length && this.user?.id) {
      return allowedUsers.includes(this.user.id);
    }
    return true;
  }

  _renderHub() {
    const navSig = (this.config?.nav || []).map((n) => `${n.path || ''}:${n.view || ''}:${n.name || ''}:${n.icon || ''}:${n.show_in_more !== false ? 1 : 0}`).join('|');
    const viewsSig = Object.entries(this.config?.views || {}).map(([k, v]) => `${k}:${v?.enabled !== false ? 1 : 0}:${v?.title || ''}:${v?.icon || ''}:${v?.color || ''}:${(v?.users || v?.visible_users || []).join(',')}`).join('|');
    const hubSig = `${this.isAdmin ? 1 : 0}#${this.user?.id || ''}#${navSig}#${viewsSig}`;
    if (hubSig === this._hubSig) return;
    this._hubSig = hubSig;

    const hubOrder = ['auto', 'printer3d', 'blinds', 'solar', 'security'];
    const tiles = [];

    for (const vId of hubOrder) {
      if (!this._viewVisible(vId)) continue;
      const def = BUILTIN_VIEWS.find((v) => v.id === vId);
      if (!def) continue;
      const vCfg = this.config?.views?.[vId] || {};
      const title = vCfg.title || def.label || def.title;
      const ic = vCfg.icon || def.icon;
      const color = vCfg.color || def.color || 'var(--cd-accent)';

      tiles.push(h('button', {
        type: 'button', class: 'more-tile', style: { '--tile-color': color },
        onClick: () => this.onNavigate?.(vId),
      },
        h('div', { class: 'more-tile-icon' }, icon(ic)),
        h('div', { style: { minWidth: '0', flex: '1' } },
          h('div', { style: { fontSize: '14px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
          h('div', { style: { fontSize: '11.5px', color: 'var(--cd-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, def.desc || def.subtitle || 'Bereich öffnen')),
        icon('mdi:chevron-right')));
    }

    if (this.isAdmin && this.onOpenSettings) {
      tiles.push(h('button', {
        type: 'button', class: 'more-tile', style: { '--tile-color': '#64748b' },
        onClick: () => this.onOpenSettings(),
      },
        h('div', { class: 'more-tile-icon' }, icon('mdi:cog-outline')),
        h('div', { style: { minWidth: '0', flex: '1' } },
          h('div', { style: { fontSize: '14px', fontWeight: '700' } }, 'Einstellungen'),
          h('div', { style: { fontSize: '11.5px', color: 'var(--cd-secondary)' } }, 'Räume, Kacheln & Menü')),
        icon('mdi:chevron-right')));
    }

    this._hubGrid.replaceChildren(...tiles);
  }

  _trashCalendars(states) {
    const configured = (this.config?.trash?.calendar_entities || []).filter((id) => id && states[id]);
    if (configured.length) return configured;
    if (states['calendar.muellplan']) return ['calendar.muellplan'];
    return Object.keys(states).filter((id) => id.startsWith('calendar.') && /m[uü]ll|abfall|trash/i.test(id));
  }

  _weatherEntity(states) {
    const cfgId = this.config?.views?.more?.weather_entity || this.config?.weather_entity;
    if (cfgId && states[cfgId]) return cfgId;
    if (states['weather.forecast_home']) return 'weather.forecast_home';
    return Object.keys(states).find((id) => id.startsWith('weather.')) || '';
  }

  _tempEntity(states) {
    const cfgId = this.config?.views?.more?.temp_entity;
    if (cfgId && states[cfgId]) return cfgId;
    if (states['sensor.aussentemperatur_fallback']) return 'sensor.aussentemperatur_fallback';
    return Object.keys(states).find((id) => (
      id.startsWith('sensor.')
      && states[id]?.attributes?.device_class === 'temperature'
      && /aussen|außen|outdoor|exterior/i.test(`${id} ${states[id]?.attributes?.friendly_name || ''}`)
    )) || '';
  }

  _routerEntity(states) {
    const cfgId = this.config?.views?.more?.router_entity || this.config?.views?.security?.router_entity;
    if (cfgId && states[cfgId]) return cfgId;
    if (states['binary_sensor.fritz_box_7590_ax_verbindung']) return 'binary_sensor.fritz_box_7590_ax_verbindung';
    return Object.keys(states).find((id) => /fritz.*verbindung|router.*online/i.test(id)) || '';
  }

  update(hass, config, user, isAdmin) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (config !== undefined) this.config = config;
    if (user !== undefined) this.user = user;
    if (isAdmin !== undefined) this.isAdmin = Boolean(isAdmin);

    this._renderHub();

    const states = hass.states || {};
    const cals = this._trashCalendars(states);
    const weatherId = this._weatherEntity(states);
    const tempId = this._tempEntity(states);
    const routerId = this._routerEntity(states);
    const batIds = Object.keys(states)
      .filter((id) => id.startsWith('sensor.') && states[id]?.attributes?.device_class === 'battery')
      .sort();

    const trackedIds = [
      ..._MORE_PEOPLE_TRACKERS.flatMap((p) => [p.tracker, p.battery]),
      ...((this.config?.persons || []).map((p) => p.entity_id).filter(Boolean)),
      weatherId,
      tempId,
      routerId,
      ...cals,
      ...batIds,
      ..._MORE_SCHIMMELDRY.map((s) => s.id),
    ].filter(Boolean);

    const sig = trackedIds.map((id) => `${id}:${states[id]?.state}`).join('|') + `|bf:${this._batFilter}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._renderPeople(states);
      this._renderTempAndTrash(states);
      this._renderBatteries(states, batIds);
      this._renderHelpers(states);
    }

    const calSig = cals.join(',');
    if (calSig !== this._trashCalSig) {
      this._trashCalSig = calSig;
      this._trashFetchedAt = 0;
    }
    if (cals.length && Date.now() - this._trashFetchedAt > 300000) {
      this._fetchTrash();
    }
  }

  _renderPeople(states) {
    const cards = [];
    for (const p of _MORE_PEOPLE_TRACKERS) {
      const tr = states[p.tracker];
      const bat = states[p.battery];
      if (!tr && !bat) continue;
      const isHome = tr?.state === 'home';
      const batPct = numeric(bat);
      const batColor = _moreBatColor(batPct);

      cards.push(h('div', {
        class: 'kpi-card',
        style: { '--kpi-color': isHome ? '#10b981' : '#64748b' },
        onClick: () => moreInfo(this.el, (tr || bat).entity_id),
      },
        h('div', { class: 'kpi-top' }, icon(isHome ? 'mdi:home-account' : 'mdi:account-arrow-right'), h('span', {}, p.name)),
        h('div', { class: 'kpi-val', style: { fontSize: '16px' } },
          tr ? (isHome ? 'Zuhause' : tr.state === 'not_home' ? 'Abwesend' : tr.state) : '—'),
        h('div', {
          class: 'kpi-sub',
          style: { color: batPct != null ? batColor : 'var(--cd-secondary)', fontWeight: '600' },
          onClick: (e) => { if (bat) { e.stopPropagation(); moreInfo(this.el, bat.entity_id); } },
        }, bat ? `Akku: ${formatState(bat)}` : 'Kein Akku-Sensor')));
    }

    if (!cards.length) {
      const configuredPersons = (this.config?.persons || [])
        .map((p) => states[p.entity_id])
        .filter(Boolean);
      const fallbackPersons = configuredPersons.length
        ? configuredPersons
        : Object.values(states).filter((s) => s.entity_id.startsWith('person.')).slice(0, 6);
      for (const s of fallbackPersons) {
        const isHome = s.state === 'home';
        cards.push(h('div', {
          class: 'kpi-card', style: { '--kpi-color': isHome ? '#10b981' : '#64748b' },
          onClick: () => moreInfo(this.el, s.entity_id),
        },
          h('div', { class: 'kpi-top' }, icon('mdi:account'), h('span', {}, s.attributes?.friendly_name || s.entity_id)),
          h('div', { class: 'kpi-val', style: { fontSize: '16px' } }, isHome ? 'Zuhause' : s.state === 'not_home' ? 'Abwesend' : s.state)));
      }
    }

    this._peopleSec.hidden = cards.length === 0;
    this._peopleGrid.replaceChildren(...cards);
  }

  _renderTempAndTrash(states) {
    const cards = [];
    const wId = this._weatherEntity(states);
    const wst = wId ? states[wId] : null;
    if (wst) {
      const wTemp = wst.attributes?.temperature;
      const cond = _WEATHER_DE[wst.state] || wst.state;
      const unit = this.hass?.config?.unit_system?.temperature || '°C';
      cards.push(h('div', {
        class: 'kpi-card', style: { '--kpi-color': '#38bdf8' },
        onClick: () => moreInfo(this.el, wst.entity_id),
      },
        h('div', { class: 'kpi-top' }, icon('mdi:weather-partly-cloudy'), h('span', {}, wst.attributes?.friendly_name || 'Wetter')),
        h('div', { class: 'kpi-val' }, wTemp != null ? `${wTemp}${unit}` : cond),
        h('div', { class: 'kpi-sub' }, cond)));
    }

    const extId = this._tempEntity(states);
    const ext = extId ? states[extId] : null;
    if (ext) {
      cards.push(h('div', {
        class: 'kpi-card', style: { '--kpi-color': '#4dd0e1' },
        onClick: () => moreInfo(this.el, ext.entity_id),
      },
        h('div', { class: 'kpi-top' }, icon('mdi:thermometer'), h('span', {}, 'Außentemperatur')),
        h('div', { class: 'kpi-val' }, formatState(ext)),
        h('div', { class: 'kpi-sub' }, 'Tippen für Verlauf')));
    } else if (!wst) {
      cards.push(h('div', { class: 'kpi-card' },
        h('div', { class: 'kpi-top' }, icon('mdi:thermometer'), h('span', {}, 'Außentemperatur')),
        h('div', { class: 'kpi-val' }, '—'),
        h('div', { class: 'kpi-sub' }, 'Kein Sensor')));
    }

    const rId = this._routerEntity(states);
    const fritz = rId ? states[rId] : null;
    if (fritz) {
      const online = fritz.state === 'on';
      cards.push(h('div', {
        class: 'kpi-card', style: { '--kpi-color': online ? '#10b981' : '#ef4444' },
        onClick: () => moreInfo(this.el, fritz.entity_id),
      },
        h('div', { class: 'kpi-top' }, icon(online ? 'mdi:router-wireless' : 'mdi:router-wireless-off'), h('span', {}, 'Router')),
        h('div', { class: 'kpi-val', style: { fontSize: '16px', color: online ? '#10b981' : '#ef4444' } }, online ? 'Online' : 'Offline'),
        h('div', { class: 'kpi-sub' }, fritz.attributes?.friendly_name || fritz.entity_id)));
    }

    this._tempCard.replaceChildren(...cards);
    this._renderTrashList();
  }

  _matchTrashPattern(summary) {
    const s = (summary || '').toLowerCase();
    for (const pat of this.config?.trash?.patterns || []) {
      const p = (pat?.pattern || '').toLowerCase();
      if (p && s.includes(p)) {
        return {
          icon: pat.icon || 'mdi:delete-outline',
          color: resolveColor(pat.color) || pat.color || null,
        };
      }
    }
    if (/gelb|leichtverpack|wertstoff|grüner punkt|verpackung/.test(s)) {
      return { icon: 'mdi:recycle-variant', color: resolveColor('amber') };
    }
    if (/papier|pappe|karton|blau/.test(s)) {
      return { icon: 'mdi:newspaper', color: resolveColor('blue') };
    }
    if (/bio|kompost|braun|grünschnitt|laub/.test(s)) {
      return { icon: 'mdi:flower', color: resolveColor('lime') };
    }
    if (/rest|hausmüll|grau|schwarz/.test(s)) {
      return { icon: 'mdi:trash-can-outline', color: resolveColor('grey') };
    }
    return { icon: 'mdi:delete-outline', color: null };
  }

  _renderTrashList() {
    const cals = this._trashCalendars(this.hass?.states || {});
    if (!this._trashEvents) {
      if (!cals.length) {
        this._trashList.replaceChildren();
        return;
      }
      this._trashList.replaceChildren(h('div', { class: 'log-row' },
        h('span', { class: 'log-row-main' }, 'Lade Müllplan...')));
      return;
    }
    if (!this._trashEvents.length) {
      this._trashList.replaceChildren(h('div', { class: 'empty-hint' }, 'Keine Abholungen in den nächsten 14 Tagen.'));
      return;
    }
    this._trashList.replaceChildren(...this._trashEvents.slice(0, 8).map((ev) => {
      const targetCal = ev._entityId || cals[0] || 'calendar.muellplan';
      const title = ev.summary || ev.title || 'Abholung';
      const match = this._matchTrashPattern(title);
      return h('div', {
        class: 'log-row', style: { cursor: 'pointer' },
        onClick: () => moreInfo(this.el, targetCal),
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
          h('span', { style: { color: match.color || 'var(--cd-secondary)', display: 'inline-flex', flex: 'none' } }, icon(match.icon)),
          h('span', { class: 'log-row-main' }, title)),
        h('span', { class: 'log-row-time' }, _moreFmtTrashDate(ev)));
    }));
  }

  async _fetchTrash() {
    if (!this.hass || this._destroyed) return;
    const cals = this._trashCalendars(this.hass.states || {});
    if (!cals.length) return;
    this._trashFetchedAt = Date.now();
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 14 * 86400 * 1000);
      const qs = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

      const batches = await Promise.all(cals.map(async (eid) => {
        try {
          if (typeof this.hass.callApi === 'function') {
            const list = await this.hass.callApi('GET', `calendars/${eid}?${qs}`);
            return Array.isArray(list) ? list.map((ev) => ({ ...ev, _entityId: eid })) : [];
          }
          const res = await this.hass.callWS({
            type: 'calendar/get_events',
            entity_id: eid,
            start_date_time: start.toISOString(),
            end_date_time: end.toISOString(),
          });
          const arr = res?.events || (Array.isArray(res) ? res : []);
          return arr.map((ev) => ({ ...ev, _entityId: eid }));
        } catch (_) {
          return [];
        }
      }));

      if (this._destroyed) return;
      const merged = batches.flat().sort((a, b) => _moreEventMs(a) - _moreEventMs(b));
      this._trashEvents = merged;
      this._renderTrashList();
    } catch (_) {
      if (this._destroyed) return;
      this._trashEvents = [];
      this._renderTrashList();
    }
  }

  _renderBatteries(states, batIds) {
    if (!batIds.length) {
      this._batSec.hidden = true;
      return;
    }
    this._batSec.hidden = false;

    const all = batIds.map((id) => {
      const st = states[id];
      const pct = numeric(st);
      const phone = _moreIsPhoneBattery(st);
      return {
        id,
        st,
        pct,
        phone,
        name: st?.attributes?.friendly_name || id,
      };
    });

    all.sort((a, b) => {
      const va = a.pct !== null && Number.isFinite(a.pct) ? a.pct : Infinity;
      const vb = b.pct !== null && Number.isFinite(b.pct) ? b.pct : Infinity;
      if (va !== vb) return va - vb;
      return a.name.localeCompare(b.name, 'de');
    });

    const lowCount = all.filter((b) => b.pct !== null && b.pct <= 25).length;
    const deviceCount = all.filter((b) => !b.phone).length;
    const phoneCount = all.filter((b) => b.phone).length;

    const filterOpts = [
      ['all', `Alle (${all.length})`],
      ['low', `Niedrig ≤ 25 % (${lowCount})`],
      ['devices', `Geräte (${deviceCount})`],
      ['phones', `Handys (${phoneCount})`],
    ];
    this._batFilters.replaceChildren(...filterOpts.map(([k, lbl]) => {
      const btn = h('button', {
        type: 'button',
        class: 'filter-chip',
        onClick: () => {
          this._batFilter = k;
          this._lastSig = '';
          this.update(this.hass, this.config, this.user, this.isAdmin);
        },
      }, lbl);
      if (this._batFilter === k) btn.setAttribute('data-active', '');
      return btn;
    }));

    let filtered = all;
    if (this._batFilter === 'low') filtered = all.filter((b) => b.pct !== null && b.pct <= 25);
    else if (this._batFilter === 'devices') filtered = all.filter((b) => !b.phone);
    else if (this._batFilter === 'phones') filtered = all.filter((b) => b.phone);

    if (!filtered.length) {
      this._batList.replaceChildren(h('div', { class: 'empty-hint' }, 'Keine passenden Batterien in diesem Filter.'));
      return;
    }

    this._batList.replaceChildren(...filtered.map((b) => {
      const pct = b.pct;
      const col = _moreBatColor(pct);
      const label = pct !== null ? `${Math.round(pct)} %` : 'Nicht verfügbar';
      const batIcon = pct === null
        ? 'mdi:battery-unknown'
        : pct <= 15 ? 'mdi:battery-alert'
          : pct <= 35 ? 'mdi:battery-30'
            : pct <= 65 ? 'mdi:battery-60'
              : pct <= 90 ? 'mdi:battery-80'
                : 'mdi:battery';
      return h('div', {
        class: 'log-row', style: { cursor: 'pointer' },
        onClick: () => moreInfo(this.el, b.id),
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
          h('span', { style: { color: col, display: 'inline-flex', flex: 'none' } }, icon(batIcon)),
          h('span', { class: 'log-row-main' }, b.name)),
        h('span', { class: 'log-row-time', style: { color: col, fontWeight: '700' } }, label));
    }));
  }

  _renderHelpers(states) {
    const customHelpers = this.config?.views?.more?.helpers;
    const items = Array.isArray(customHelpers) && customHelpers.length ? customHelpers : _MORE_SCHIMMELDRY;
    const rows = [];
    for (const item of items) {
      const st = states[item.id];
      if (!st) continue;
      if (item.toggle) {
        const isOn = st.state === 'on';
        const dom = item.id.split('.')[0];
        rows.push(h('div', { class: 'log-row', style: { padding: '8px 12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1', cursor: 'pointer' }, onClick: () => moreInfo(this.el, item.id) },
            icon(item.icon || 'mdi:toggle-switch'),
            h('span', { class: 'log-row-main' }, st.attributes?.friendly_name || item.name || item.id)),
          h('button', {
            type: 'button', class: `btn sm${isOn ? ' primary' : ''}`,
            disabled: isUnavailable(st),
            onClick: () => this.hass?.callService(dom, 'toggle', { entity_id: item.id }),
          }, isOn ? 'Ein' : 'Aus')));
      } else {
        rows.push(h('div', { class: 'log-row', style: { cursor: 'pointer' }, onClick: () => moreInfo(this.el, item.id) },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
            icon(item.icon || 'mdi:information-outline'),
            h('span', { class: 'log-row-main' }, st.attributes?.friendly_name || item.name || item.id)),
          h('span', { class: 'log-row-time' }, formatState(st))));
      }
    }
    this._helpersSec.hidden = rows.length === 0;
    this._helpersWrap.replaceChildren(...rows);
  }
}
