// Special cards: header badges, smoke alerts, weather warning, trash, persons, announcement, bottom navigation.
import {
  h, icon, domainOf, entityIcon, isUnavailable, stateLabel, numeric, moreInfo, navigate, resolveColor,
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
  constructor(badges, user) {
    this.user = user;
    this.items = (badges || []).filter((b) => b && b.entity_id).map((cfg) => this._make(cfg));
    this.el = h('div', { class: 'badges' }, this.items.map((i) => i.el));
  }

  _make(cfg) {
    const el = h('button', { class: 'badge', hidden: true });
    const item = { cfg, el };
    const open = () => moreInfo(el, cfg.entity_id);
    const tap = () => {
      if (cfg.tap === 'navigate' && cfg.path) navigate(cfg.path);
      else if (cfg.tap === 'service' && cfg.service?.includes('.')) {
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
    for (const { cfg, el } of this.items) {
      const st = hass.states[cfg.entity_id];
      const show = Badges.visible(cfg, st);
      el.hidden = !show;
      if (!show) continue;
      const parts = [];
      if (cfg.show_name) parts.push(h('span', { class: 'badge-name' }, cfg.name || st?.attributes?.friendly_name || cfg.entity_id));
      if (cfg.show_state) parts.push(h('span', {}, stateLabel(hass, st)));
      el.style.setProperty('--badge-color', resolveColor(cfg.color) || 'var(--cd-accent)');
      el.replaceChildren(icon(cfg.icon || entityIcon(cfg.entity_id, st)), ...parts);
    }
  }
}

// ═══════════════ Smoke alerts (automatic, no config) ═══════════════
export class SmokeAlerts {
  constructor() {
    this.el = h('div', { class: 'side', style: { gap: '8px' } });
    this._key = '';
  }

  update(hass) {
    const ids = Object.keys(hass.states).filter((id) => {
      if (!id.startsWith('binary_sensor.')) return false;
      const st = hass.states[id];
      return st.state === 'on' && st.attributes?.device_class === 'smoke';
    });
    const key = ids.join(',');
    if (key === this._key) return;
    this._key = key;
    this.el.replaceChildren(...ids.map((id) => h('div', { class: 'alert-card alert-smoke', onClick: () => moreInfo(this.el, id) },
      h('div', { class: 'a-icon' }, icon('mdi:fire-alert')),
      h('div', {},
        h('div', { class: 'a-title' }, hass.states[id].attributes.friendly_name || id),
        h('div', { class: 'a-sub' }, 'In diesem Raum wurde Rauch gemeldet')))));
    this.el.hidden = ids.length === 0;
  }
}

// ═══════════════ Weather warning ═══════════════
export class WarningCard {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.title = h('div', { class: 'a-title' });
    this.el = h('div', { class: 'alert-card alert-warn', hidden: true, onClick: () => navigate(this.cfg.path) },
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
    this.el = h('div', { class: 'stack-row', hidden: true }, this.bins);
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
    const entities = (this.cfg.calendar_entities || []).filter(Boolean);
    if (!entities.length) { this.el.hidden = true; return; }
    this._loading = true;
    try {
      const days = Math.max(1, Number(this.cfg.next_days) || 2);
      const start = startOfDay(new Date());
      const end = new Date(start.getTime() + days * DAY);
      const results = await Promise.all(entities.map((eid) => hass
        .callApi('GET', `calendars/${eid}?start=${start.toISOString()}&end=${end.toISOString()}`)
        .catch(() => [])));
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
      const summary = String(ev.summary || '').toLowerCase();
      const match = patterns.find((p) => p.pattern && summary.includes(String(p.pattern).toLowerCase()));
      if (!match) continue; // filter_events: only known bin types
      const key = `${match.pattern}|${diff}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ match, diff });
    }
    entries.sort((a, b) => a.diff - b.diff);
    this.bins.replaceChildren(...entries.map(({ match, diff }) => {
      const color = resolveColor(match.color) || 'var(--cd-secondary)';
      const when = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : `in ${diff} T`;
      const fallback = h('ha-icon', { icon: match.icon || 'mdi:trash-can-outline', style: { color } });
      const visual = match.picture
        ? h('img', { src: match.picture, alt: match.pattern, onError: (e) => e.target.replaceWith(fallback) })
        : fallback;
      return h('div', { class: 'bin', title: match.pattern }, visual, h('span', { class: `when${diff === 0 ? ' today' : ''}` }, when));
    }));
    this.el.hidden = entries.length === 0;
  }
}

// ═══════════════ Persons ═══════════════
export class PersonCards {
  constructor(persons, user) {
    this.user = user;
    this.persons = (persons || []).filter((p) => p && p.entity_id && allowed(p.users, user?.id));
    this.el = h('div', { class: 'bins', hidden: true });
    this.items = this.persons.map((p) => ({ cfg: p, el: h('div', { class: 'person', hidden: true, onClick: () => moreInfo(this.el, p.entity_id) }) }));
    this.el.append(...this.items.map((i) => i.el));
  }

  update(hass) {
    let any = false;
    for (const { cfg, el } of this.items) {
      const st = hass.states[cfg.entity_id];
      const show = !!st && st.state === 'home';
      el.hidden = !show;
      if (!show) continue;
      any = true;
      const pic = st.attributes?.entity_picture;
      const avatar = h('div', { class: 'avatar', style: pic ? { backgroundImage: `url("${pic}")` } : {} }, pic ? null : icon('mdi:account'));
      el.replaceChildren(avatar, h('div', {},
        h('div', { class: 'p-name' }, st.attributes?.friendly_name || cfg.entity_id),
        h('div', { class: 'p-state' }, stateLabel(hass, st))));
    }
    this.el.hidden = !any;
  }
}

// ═══════════════ Announcement + chips ═══════════════
export class AnnounceCard {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.chips = h('div', { class: 'chips', hidden: true });
    this.row = h('div', { class: 'full-tile', onClick: () => moreInfo(this.el, this.cfg.entity_id) },
      h('div', { class: 'tile-icon', style: { '--tile-color': 'var(--cd-accent)' } }, icon(this.cfg.icon || 'mdi:bullhorn')),
      h('div', { class: 'tile-name' }, this.cfg.name || 'Ankündigung'));
    this.el = h('div', { hidden: !this.cfg.entity_id }, this.row, this.chips);
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
  constructor(buttons) {
    const items = (buttons || []).filter((b) => b && b.path);
    this.el = h('nav', { class: 'nav', hidden: items.length === 0 },
      items.map((b) => h('button', { class: 'nav-btn', onClick: () => navigate(b.path), 'aria-label': b.name || b.path },
        b.icon ? icon(b.icon) : null, b.name || null)));
  }
}
