// More View: Unified Navigation Hub (Topics & Settings), Persons & iPhone Batteries, Exterior Temp, Trash Preview & Helpers.
import {
  h, icon, isUnavailable, numeric, moreInfo, formatState, BUILTIN_VIEWS,
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
    this._trashEvents = null;
    this._trashFetchedAt = 0;

    this.el = h('div', { class: 'subview-page', style: { '--view-color': '#03a9f4' } });
    this._buildShell();
    if (hass) this.update(hass, config, user, isAdmin);
  }

  destroy() {
    this._destroyed = true;
  }

  _buildShell() {
    this._fritzChip = h('span', { class: 'badge-chip', hidden: true });
    const head = h('div', { class: 'subview-head' },
      h('div', { class: 'subview-head-left' },
        h('div', { class: 'subview-hero-icon' }, icon('mdi:view-grid-plus-outline')),
        h('div', { style: { minWidth: '0' } },
          h('h2', { class: 'subview-title' }, 'Mehr & Bereiche'),
          h('div', { class: 'subview-sub' }, 'Themen, Familie, Müllplan & Helfer'))),
      h('div', { class: 'subview-actions' },
        this._fritzChip,
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
        h('div', { class: 'subview-section-title' }, icon('mdi:account-group-outline'), 'Personen & iPhones')),
      this._peopleGrid);

    // Climate & Trash Preview
    this._tempCard = h('div', { class: 'kpi-grid' });
    this._trashList = h('div', { class: 'log-list' });
    const infoSec = h('section', { class: 'subview-section' },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:calendar-month-outline'), 'Wetter & Müllplan')),
      this._tempCard,
      this._trashList);

    // Schimmeldry & Helpers
    this._helpersWrap = h('div', { class: 'log-list' });
    this._helpersSec = h('section', { class: 'subview-section', hidden: true },
      h('div', { class: 'subview-section-head' },
        h('div', { class: 'subview-section-title' }, icon('mdi:fan'), 'Schimmeldry & Automationen')),
      this._helpersWrap);

    this.el.append(head, hubSec, this._peopleSec, infoSec, this._helpersSec);
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
          h('div', { style: { fontSize: '14px', fontWeight: '700' } }, title),
          h('div', { style: { fontSize: '11.5px', color: 'var(--cd-secondary)' } }, def.desc || def.subtitle || 'Bereich öffnen')),
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

  update(hass, config, user, isAdmin) {
    if (this._destroyed || !hass) return;
    this.hass = hass;
    if (config !== undefined) this.config = config;
    if (user !== undefined) this.user = user;
    if (isAdmin !== undefined) this.isAdmin = Boolean(isAdmin);

    this._renderHub();

    const states = hass.states || {};
    const fritz = states['binary_sensor.fritz_box_7590_ax_verbindung'];
    if (fritz) {
      this._fritzChip.hidden = false;
      const online = fritz.state === 'on';
      this._fritzChip.textContent = online ? 'Fritz!Box Online' : 'Fritz!Box Offline';
      this._fritzChip.style.color = online ? '#10b981' : '#ef4444';
    } else {
      this._fritzChip.hidden = true;
    }

    const trackedIds = [
      ..._MORE_PEOPLE_TRACKERS.flatMap((p) => [p.tracker, p.battery]),
      'sensor.aussentemperatur_fallback',
      'calendar.muellplan',
      ..._MORE_SCHIMMELDRY.map((s) => s.id),
    ];
    const sig = trackedIds.map((id) => `${id}:${states[id]?.state}`).join('|');
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._renderPeople(states);
      this._renderTempAndTrash(states);
      this._renderHelpers(states);
    }

    if (Date.now() - this._trashFetchedAt > 300000) {
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
        h('div', { class: 'kpi-top' }, icon(isHome ? 'mdi:home-account' : 'mdi:account-arrow-right'), p.name),
        h('div', { class: 'kpi-val', style: { fontSize: '16px' } },
          tr ? (isHome ? 'Zuhause' : tr.state === 'not_home' ? 'Abwesend' : tr.state) : '—'),
        h('div', {
          class: 'kpi-sub',
          style: { color: batPct != null ? batColor : 'var(--cd-secondary)', fontWeight: '600' },
          onClick: (e) => { if (bat) { e.stopPropagation(); moreInfo(this.el, bat.entity_id); } },
        }, bat ? `iPhone Batterie: ${formatState(bat)}` : 'Kein Akku-Sensor')));
    }

    if (!cards.length) {
      const fallbackPersons = Object.values(states).filter((s) => s.entity_id.startsWith('person.')).slice(0, 6);
      for (const s of fallbackPersons) {
        const isHome = s.state === 'home';
        cards.push(h('div', {
          class: 'kpi-card', style: { '--kpi-color': isHome ? '#10b981' : '#64748b' },
          onClick: () => moreInfo(this.el, s.entity_id),
        },
          h('div', { class: 'kpi-top' }, icon('mdi:account'), s.attributes?.friendly_name || s.entity_id),
          h('div', { class: 'kpi-val', style: { fontSize: '16px' } }, isHome ? 'Zuhause' : s.state)));
      }
    }

    this._peopleSec.hidden = cards.length === 0;
    this._peopleGrid.replaceChildren(...cards);
  }

  _renderTempAndTrash(states) {
    const ext = states['sensor.aussentemperatur_fallback'];
    this._tempCard.replaceChildren(ext
      ? h('div', {
          class: 'kpi-card', style: { '--kpi-color': '#4dd0e1' },
          onClick: () => moreInfo(this.el, ext.entity_id),
        },
          h('div', { class: 'kpi-top' }, icon('mdi:thermometer'), 'Außentemperatur'),
          h('div', { class: 'kpi-val' }, formatState(ext)),
          h('div', { class: 'kpi-sub' }, 'Tippen für 24h Verlauf'))
      : h('div', { class: 'kpi-card' },
          h('div', { class: 'kpi-top' }, icon('mdi:thermometer'), 'Außentemperatur'),
          h('div', { class: 'kpi-val' }, '—'),
          h('div', { class: 'kpi-sub' }, 'Kein Sensor')));
    this._renderTrashList();
  }

  _renderTrashList() {
    if (!this._trashEvents) {
      const cal = this.hass?.states?.['calendar.muellplan'];
      if (!cal) {
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
    this._trashList.replaceChildren(...this._trashEvents.slice(0, 6).map((ev) => h('div', {
      class: 'log-row', style: { cursor: 'pointer' },
      onClick: () => moreInfo(this.el, 'calendar.muellplan'),
    },
      h('span', { class: 'log-row-main' }, ev.summary || ev.title || 'Abholung'),
      h('span', { class: 'log-row-time' }, _moreFmtTrashDate(ev)))));
  }

  async _fetchTrash() {
    if (!this.hass || this._destroyed || !this.hass.states?.['calendar.muellplan']) return;
    this._trashFetchedAt = Date.now();
    try {
      const start = new Date().toISOString();
      const end = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
      const res = await this.hass.callWS({
        type: 'calendars/get_events',
        entity_id: 'calendar.muellplan',
        start_date_time: start,
        end_date_time: end,
      });
      if (this._destroyed) return;
      this._trashEvents = Array.isArray(res?.events) ? res.events : (Array.isArray(res) ? res : []);
      this._renderTrashList();
    } catch (_) {
      if (this._destroyed) return;
      this._trashEvents = [];
      this._renderTrashList();
    }
  }

  _renderHelpers(states) {
    const rows = [];
    for (const item of _MORE_SCHIMMELDRY) {
      const st = states[item.id];
      if (!st) continue;
      if (item.toggle) {
        const isOn = st.state === 'on';
        const dom = item.id.split('.')[0];
        rows.push(h('div', { class: 'log-row', style: { padding: '8px 12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1', cursor: 'pointer' }, onClick: () => moreInfo(this.el, item.id) },
            icon(item.icon),
            h('span', { class: 'log-row-main' }, st.attributes?.friendly_name || item.name)),
          h('button', {
            type: 'button', class: `btn sm${isOn ? ' primary' : ''}`,
            disabled: isUnavailable(st),
            onClick: () => this.hass?.callService(dom, 'toggle', { entity_id: item.id }),
          }, isOn ? 'Ein' : 'Aus')));
      } else {
        rows.push(h('div', { class: 'log-row', style: { cursor: 'pointer' }, onClick: () => moreInfo(this.el, item.id) },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } },
            icon(item.icon),
            h('span', { class: 'log-row-main' }, st.attributes?.friendly_name || item.name)),
          h('span', { class: 'log-row-time' }, formatState(st))));
      }
    }
    this._helpersSec.hidden = rows.length === 0;
    this._helpersWrap.replaceChildren(...rows);
  }
}
