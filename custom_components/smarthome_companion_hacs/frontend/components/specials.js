// Special cards: header badges, smoke alerts, weather warning, trash, persons, announcement, bottom navigation.
import {
  h, icon, domainOf, entityIcon, isUnavailable, stateLabel, numeric, moreInfo, navigate, resolveColor, renderTrashBin,
  resolveInternalView,
} from '../lib/util.js';

const allowed = (users, userId) => !users || users.length === 0 || users.includes(userId);

/** Attach tap + long-press (-> more-info) behaviour. */
function bindPress(el, onTap, onHold) {
  let timer = null;
  let held = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', () => {
    held = false;
    if (!onHold) return;
    timer = setTimeout(() => { held = true; onHold(); }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => el.addEventListener(evt, clear));
  el.addEventListener('click', (e) => {
    if (held) { held = false; e.preventDefault(); return; }
    onTap(e);
  });
}

// ═══════════════ Header badges ═══════════════
export class Badges {
  constructor(badges, user, onNavigate = null) {
    this.user = user;
    this.onNavigate = onNavigate;
    this.items = (badges || []).filter((b) => b && b.entity_id).map((cfg) => this._make(cfg));
    this.el = h('div', { class: 'badges' }, this.items.map((i) => i.el));
  }

  _make(cfg) {
    const el = h('button', { class: 'badge', type: 'button', hidden: true });
    const item = { cfg, el, key: null };
    const open = () => moreInfo(el, cfg.entity_id);
    const tap = () => {
      if (cfg.tap === 'navigate' && cfg.path) {
        if (this.onNavigate) this.onNavigate(cfg.path);
        else navigate(cfg.path);
      } else if (cfg.tap === 'service' && cfg.service?.includes('.')) {
        const [domain, service] = cfg.service.split('.');
        this.hass?.callService(domain, service, { entity_id: cfg.entity_id });
      } else if (cfg.tap === 'none') { /* no-op */ } else open();
    };
    bindPress(el, tap, cfg.tap === 'more-info' || !cfg.tap ? null : open);
    return item;
  }

  static visible(cfg, st) {
    const state = (st ? st.state : 'unavailable').toLowerCase();
    const raw = String(cfg.visible_value ?? '').trim();
    switch (cfg.visible_when) {
      case 'above': { const n = numeric(st); return n !== null && n > Number(raw); }
      case 'below': { const n = numeric(st); return n !== null && n < Number(raw); }
      case 'state_in': return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(state);
      case 'state_not_in': return !raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(state);
      default: return !!st;
    }
  }

  update(hass) {
    this.hass = hass;
    for (const item of this.items) {
      const { cfg, el } = item;
      const st = hass.states[cfg.entity_id];
      const show = Badges.visible(cfg, st);
      if (el.hidden !== !show) el.hidden = !show;
      if (!show) continue;
      const ic = cfg.icon || entityIcon(cfg.entity_id, st);
      const nameTxt = cfg.show_name ? (cfg.name || st?.attributes?.friendly_name || cfg.entity_id) : '';
      const valTxt = cfg.show_state ? stateLabel(hass, st) : '';
      const color = resolveColor(cfg.color) || 'var(--cd-accent)';
      const nextKey = `${ic}|${nameTxt}|${valTxt}|${color}`;
      if (item.key === nextKey) continue;
      item.key = nextKey;
      const parts = [];
      if (cfg.show_name) parts.push(h('span', { class: 'badge-name' }, nameTxt));
      if (cfg.show_state) parts.push(h('span', {}, valTxt));
      el.style.setProperty('--badge-color', color);
      el.replaceChildren(icon(ic), ...parts);
    }
  }
}

// ═══════════════ Smoke alerts (strictly configured smoke detectors) ═══════════════
export class SmokeAlerts {
  constructor({ onOpenSmoke = null } = {}) {
    this.onOpenSmoke = onOpenSmoke;
    this.el = h('div', { style: { display: 'grid', gap: '10px' } });
    this._key = '';
    this._layout = null;
  }

  setLayout(layout) {
    this._layout = layout || null;
    this._key = '';
  }

  _collectConfiguredSmokeEntries() {
    const map = new Map();
    const layout = this._layout;
    if (!layout) return [];
    const rooms = layout.rooms || [];
    const roomById = new Map(rooms.map((r) => [r.area_id, r]));

    for (const item of (layout.configured?.smoke || [])) {
      if (!item?.entity_id) continue;
      map.set(item.entity_id, {
        entity_id: item.entity_id,
        name: item.name || item.entity_id,
        area_id: item.area_id || '__none__',
        area_name: item.area_name || roomById.get(item.area_id)?.name || 'Nicht zugeordnet',
        area_icon: item.area_icon || roomById.get(item.area_id)?.icon || 'mdi:home-outline',
      });
    }
    for (const r of rooms) {
      for (const eid of (r.sensors?.smoke || [])) {
        if (!eid || map.has(eid)) continue;
        map.set(eid, {
          entity_id: eid,
          name: eid,
          area_id: r.area_id,
          area_name: r.name || 'Raum',
          area_icon: r.icon || 'mdi:home-outline',
        });
      }
      for (const t of (r.tiles || [])) {
        if ((t.category === 'rauchmelder' || t.category === 'smoke') && t.entity_id && !map.has(t.entity_id)) {
          map.set(t.entity_id, {
            entity_id: t.entity_id,
            name: t.name || t.entity_id,
            area_id: r.area_id,
            area_name: r.name || 'Raum',
            area_icon: r.icon || 'mdi:home-outline',
          });
        }
      }
    }
    return Array.from(map.values());
  }

  update(hass) {
    const entries = this._collectConfiguredSmokeEntries();
    const triggered = entries.filter((entry) => {
      const st = hass.states[entry.entity_id];
      if (!st) return false;
      const v = String(st.state || '').toLowerCase();
      return ['on', 'detected', 'smoke', 'alarm', 'true'].includes(v);
    });
    const key = triggered.map((e) => `${e.entity_id}:${e.area_id}`).join('|');
    if (key === this._key) return;
    this._key = key;
    if (!triggered.length) {
      this.el.replaceChildren();
      this.el.hidden = true;
      return;
    }

    // Group active alarms by room so each affected room appears cleanly with its icon
    const roomsById = new Map();
    for (const entry of triggered) {
      if (!roomsById.has(entry.area_id)) {
        roomsById.set(entry.area_id, {
          area_id: entry.area_id,
          name: entry.area_name,
          icon: entry.area_icon,
          count: 1,
        });
      } else {
        roomsById.get(entry.area_id).count += 1;
      }
    }

    const banner = h('button', {
      type: 'button',
      class: 'smoke-home-banner',
      onClick: () => this.onOpenSmoke?.(),
    },
    h('div', { class: 'smoke-home-banner-head' },
      h('div', { class: 'smoke-home-banner-title' },
        icon('mdi:smoke-detector-alert'),
        h('span', {}, triggered.length === 1 ? 'Rauchalarm erkannt!' : `${triggered.length} Rauchmelder ausgelöst!`)),
      icon('mdi:chevron-right')),
    h('div', { class: 'smoke-home-banner-sub' }, 'Tippen für Sicherheits- & Rauchmelderübersicht'),
    h('div', { class: 'smoke-home-rooms' },
      ...Array.from(roomsById.values()).map((r) => h('span', { class: 'smoke-home-room-pill' },
        icon(r.icon || 'mdi:home-outline'),
        h('span', {}, r.count > 1 ? `${r.name} (${r.count})` : r.name)))));

    this.el.replaceChildren(banner);
    this.el.hidden = false;
  }
}

// ═══════════════ Weather warning ═══════════════
export class WarningCard {
  constructor(cfg, onOpen) {
    this.cfg = cfg || {};
    this.onOpen = onOpen;
    this.title = h('div', { class: 'a-title' });
    this.el = h('div', {
      class: 'alert-card alert-warn',
      hidden: true,
      onClick: () => {
        if (this.onOpen) this.onOpen();
        else if (this.cfg.path) navigate(this.cfg.path);
      },
    },
      h('div', { class: 'a-icon' }, icon('mdi:alert')),
      h('div', {}, this.title, h('div', { class: 'a-sub' }, 'Meldung ansehen')));
  }

  update(hass) {
    const st = this.cfg.entity_id ? hass.states[this.cfg.entity_id] : null;
    const level = numeric(st);
    const show = level !== null && level > 0;
    this.el.hidden = !show;
    if (show) {
      this.title.textContent = st.attributes?.[this.cfg.headline_attribute || 'warning_1_headline'] || st.attributes?.friendly_name || 'Warnung';
    }
  }
}

// ═══════════════ Trash (calendar based) ═══════════════
const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = (value) => {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export class TrashCard {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.bins = h('div', { class: 'bins' });
    this.el = h('div', { class: 'trash-card', hidden: true }, this.bins);
    this._day = '';
    this._lastLoad = 0;
  }

  update(hass) {
    this.hass = hass;
    const today = startOfDay(new Date()).toDateString();
    const stale = Date.now() - this._lastLoad > 30 * 60 * 1000;
    if ((today !== this._day || stale) && !this._loading) this._load(hass, today);
  }

  async _load(hass, today) {
    const states = hass?.states || {};
    let entities = (this.cfg.calendar_entities || []).filter((id) => id && states[id]);
    if (!entities.length && states['calendar.muellplan']) entities = ['calendar.muellplan'];
    if (!entities.length) entities = (this.cfg.calendar_entities || []).filter(Boolean);
    if (!entities.length) { this.el.hidden = true; return; }
    this._loading = true;
    try {
      const days = Math.max(1, Number(this.cfg.next_days) || 2);
      const start = startOfDay(new Date());
      const end = new Date(start.getTime() + days * DAY);
      const qs = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
      const results = await Promise.all(entities.map(async (eid) => {
        if (typeof hass.callApi === 'function') {
          try {
            const list = await hass.callApi('GET', `calendars/${eid}?${qs}`);
            if (Array.isArray(list)) return list;
          } catch (_) { /* fall back to calendar/get_events WS */ }
        }
        try {
          const res = await hass.callWS({
            type: 'calendar/get_events',
            entity_id: eid,
            start_date_time: start.toISOString(),
            end_date_time: end.toISOString(),
          });
          return res?.events || (Array.isArray(res) ? res : []);
        } catch (_) {
          return [];
        }
      }));
      this._render(results.flat(), start, days);
      this._day = today;
      this._lastLoad = Date.now();
    } finally {
      this._loading = false;
    }
  }

  _render(events, start, days) {
    const patterns = this.cfg.patterns || [];
    const seen = new Set();
    const entries = [];
    for (const ev of events) {
      const raw = ev.start?.date || ev.start?.dateTime || ev.start;
      if (!raw) continue;
      const diff = Math.round((parseDay(raw) - start) / DAY);
      if (diff < 0 || diff >= days) continue;
      const rawSummary = String(ev.summary || '').trim();
      const summary = rawSummary.toLowerCase();
      let match = patterns.find((p) => p.pattern && summary.includes(String(p.pattern).toLowerCase()));
      if (!match) {
        if (/gelb|leichtverpack|wertstoff|grüner punkt|verpackung/.test(summary)) {
          match = { pattern: rawSummary, color: 'amber', picture: '/local/custom-icons/trash-bins/yellow.png' };
        } else if (/papier|pappe|karton|blau/.test(summary)) {
          match = { pattern: rawSummary, color: 'blue', picture: '/local/custom-icons/trash-bins/blue.png' };
        } else if (/bio|kompost|braun|grünschnitt|laub/.test(summary)) {
          match = { pattern: rawSummary, color: 'brown', picture: '/local/custom-icons/trash-bins/brown.png' };
        } else if (/rest|hausmüll|grau|schwarz/.test(summary)) {
          match = { pattern: rawSummary, color: 'black', picture: '/local/custom-icons/trash-bins/black.png' };
        } else {
          continue;
        }
      }
      const label = rawSummary || match.pattern || 'Müllabfuhr';
      const key = `${match.pattern || label}|${diff}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ match, label, diff });
    }
    entries.sort((a, b) => a.diff - b.diff);
    this.bins.replaceChildren(...entries.map(({ match, label, diff }) => {
      // Bioabfall historically used 'lime' for flower icon; map to brown/green for 3D bin if brown.png is used
      let cName = match.color;
      if (cName === 'lime' && String(match.pattern || '').toLowerCase().includes('bio')) cName = 'brown';
      const color = resolveColor(cName) || cName || '#64748b';
      const when = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : `In ${diff} Tagen`;
      const fallback = renderTrashBin(color, 38);
      const visual = match.picture
        ? h('img', { src: match.picture, alt: label, onError: (e) => e.target.replaceWith(fallback) })
        : fallback;
      return h('div', { class: 'bin' },
        h('div', { class: 'visual' }, visual),
        h('div', { class: 'b-info' },
          h('div', { class: 'bin-label', title: label }, label),
          h('div', { class: `when${diff === 0 ? ' today' : diff === 1 ? ' tomorrow' : ''}` }, when)));
    }));
    this.el.hidden = entries.length === 0;
    this.el.style.display = entries.length === 0 ? 'none' : '';
  }
}

// ═══════════════ Persons ═══════════════
export class PersonCards {
  constructor(persons, user) {
    this.user = user;
    this.persons = (persons || []).filter((p) => p && p.entity_id && allowed(p.users, user?.id));
    this.itemsWrap = h('div', { class: 'bins' });
    this.el = h('div', { class: 'card persons-card', hidden: true }, this.itemsWrap);
    this.items = this.persons.map((p) => ({
      cfg: p,
      key: null,
      el: h('div', { class: 'person', hidden: true, onClick: () => moreInfo(this.el, p.entity_id) }),
    }));
    this.itemsWrap.append(...this.items.map((i) => i.el));
  }

  update(hass) {
    let any = false;
    for (const item of this.items) {
      const { cfg, el } = item;
      const st = hass.states[cfg.entity_id];
      const show = !!st && st.state === 'home';
      if (el.hidden !== !show) el.hidden = !show;
      if (!show) continue;
      any = true;
      const pic = st.attributes?.entity_picture || '';
      const nameTxt = st.attributes?.friendly_name || cfg.entity_id;
      const lbl = stateLabel(hass, st);
      const nextKey = `${pic}|${nameTxt}|${lbl}`;
      if (item.key === nextKey) continue;
      item.key = nextKey;
      const avatar = h('div', { class: 'avatar', style: pic ? { backgroundImage: `url("${pic}")` } : {} }, pic ? null : icon('mdi:account'));
      el.replaceChildren(avatar, h('div', {},
        h('div', { class: 'p-name' }, nameTxt),
        h('div', { class: 'p-state' }, lbl)));
    }
    this.el.hidden = !any;
    this.el.style.display = any ? '' : 'none';
  }
}

// ═══════════════ Announcement + chips ═══════════════
export class AnnounceCard {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.chips = h('div', { class: 'chips', hidden: true });
    this.row = h('div', { class: 'announce-row', onClick: () => moreInfo(this.el, this.cfg.entity_id) },
      h('div', { class: 'announce-icon' }, icon(this.cfg.icon || 'mdi:bullhorn')),
      h('div', { class: 'announce-name' }, this.cfg.name || 'Ankündigung'),
      icon('mdi:chevron-right', 'chevron'));
    this.el = h('div', { class: 'card announce-card', hidden: !this.cfg.entity_id, style: this.cfg.entity_id ? {} : { display: 'none' } }, this.row, this.chips);
  }

  update(hass) {
    const gate = this.cfg.chips_visible_entity;
    const showChips = !gate || !isUnavailable(hass.states[gate]) || hass.states[gate]?.state === 'unknown';
    const chips = showChips ? (this.cfg.chips || []).filter((c) => c.entity_id && hass.states[c.entity_id]) : [];
    this.chips.hidden = chips.length === 0;
    const key = chips.map((c) => `${c.entity_id}=${hass.states[c.entity_id].state}`).join('|');
    if (key === this._key) return;
    this._key = key;
    this.chips.replaceChildren(...chips.map((c) => h('div', { class: 'chip', onClick: () => moreInfo(this.el, c.entity_id) },
      icon(c.icon || entityIcon(c.entity_id, hass.states[c.entity_id])), stateLabel(hass, hass.states[c.entity_id]))));
  }
}

// ═══════════════ Bottom navigation ═══════════════
export class NavBar {
  constructor(buttons, opts = {}) {
    const { activeView = 'overview', viewsConfig = {}, user = null, onNavigate = null } = opts;
    const viewAllowed = (viewId) => {
      const vc = viewsConfig?.[viewId];
      if (!vc) return true;
      if (vc.enabled === false) return false;
      return allowed(vc.users, user?.id);
    };

    const raw = (buttons || []).filter((b) => b && (b.path || b.view));
    const list = [];
    const seenViews = new Set();

    // Always lead with "Übersicht"
    list.push({ name: 'Übersicht', icon: 'mdi:view-dashboard', view: 'overview' });
    seenViews.add('overview');

    for (const b of raw) {
      const internal = resolveInternalView(b);
      if (internal) {
        if (!viewAllowed(internal) || seenViews.has(internal)) continue;
        seenViews.add(internal);
        const fallbackName = internal === 'more' ? 'Mehr' : b.name;
        list.push({ ...b, name: fallbackName ?? b.name, view: internal });
      } else {
        list.push(b);
      }
    }

    // Preserve configured order strictly; seed missing core hubs only when absent
    const hasCustomOrder = raw.length > 0;
    const defaults = [
      { view: 'security', name: 'Sicherheit', icon: 'mdi:shield-home' },
      { view: 'solar', name: 'Solar', icon: 'mdi:solar-power-variant' },
      { view: 'blinds', name: 'Rollläden', icon: 'mdi:window-shutter' },
      { view: 'more', name: 'Mehr', icon: 'mdi:apps' },
    ];
    for (const def of defaults) {
      if (!seenViews.has(def.view) && viewAllowed(def.view)) {
        if (def.view === 'more' && !hasCustomOrder) continue;
        if (def.view === 'more') {
          seenViews.add(def.view);
          list.push(def);
          continue;
        }
        seenViews.add(def.view);
        const moreIdx = list.findIndex((i) => i.view === 'more');
        if (moreIdx >= 0) list.splice(moreIdx, 0, def);
        else list.push(def);
      }
    }
    if (!seenViews.has('more') && viewAllowed('more')) {
      list.push({ view: 'more', name: 'Mehr', icon: 'mdi:apps' });
    }

    this.el = h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation', hidden: list.length === 0 },
      list.map((b) => {
        const isActive = (b.view && b.view === activeView)
          || (b.view === 'more' && ['auto', 'printer3d'].includes(activeView));
        return h('button', {
          type: 'button',
          class: 'nav-btn',
          ...(isActive ? { 'data-active': '', 'aria-current': 'page' } : {}),
          'aria-label': b.name || b.view || b.path,
          onClick: () => {
            if (onNavigate) onNavigate(b.view || b.path);
            else if (b.path) navigate(b.path);
          },
        }, b.icon ? icon(b.icon) : null, b.name ? h('span', {}, b.name) : null);
      }));
  }
}
