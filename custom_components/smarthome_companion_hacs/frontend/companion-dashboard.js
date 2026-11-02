// SmartHome Companion dashboard panel (sidebar entry "Übersicht").
// Self-contained: no HACS cards required. The layout is resolved by the backend on every load,
// so renamed entities / re-configured devices never leave dead tiles behind.
import { STYLES } from './lib/styles.js';
import { h, icon, debounce } from './lib/util.js';
import { Room } from './components/room.js';
import {
  Badges, SmokeAlerts, WarningCard, TrashCard, PersonCards, AnnounceCard, NavBar,
} from './components/specials.js';
import { Settings } from './components/settings.js';
import { DeviceWizard } from './components/device_wizard.js';

class CompanionDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._openState = new Map();
    this._components = [];
    this._data = null;
    this._raf = 0;
    this._reload = debounce(() => this._load(), 800);
  }

  // ── HA panel contract ──
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else this._schedulePush();
  }

  get hass() { return this._hass; }

  set narrow(value) {
    this._narrow = value;
    this._menuBtn?.toggleAttribute('hidden', !value);
  }

  set panel(_value) { /* unused */ }
  set route(_value) { /* unused */ }

  connectedCallback() {
    if (this._hass && !this._initialised) this._init();
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
    this._ro?.disconnect();
    this._ro = null;
    this._initialised = false;
    cancelAnimationFrame(this._raf);
  }

  // ── lifecycle ──
  _init() {
    if (this._initialised || !this.isConnected) return;
    this._initialised = true;

    const style = h('style', { text: STYLES + '\n[hidden]{display:none !important}' });
    this._menuBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Menü', hidden: !this._narrow,
      onClick: () => this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })),
    }, icon('mdi:menu'));
    this._wizardBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Gerät einrichten', title: 'Gerät einrichten', hidden: true,
      onClick: () => this._openWizard(),
    }, icon('mdi:plus-circle-outline'));
    this._settingsBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Dashboard einrichten', title: 'Dashboard einrichten', hidden: true,
      onClick: () => this._openSettings(),
    }, icon('mdi:cog-outline'));
    this._content = h('div');
    this._page = h('div', { class: 'page' },
      h('div', { class: 'toolbar' }, this._menuBtn, h('div', { class: 'spacer' }), this._wizardBtn, this._settingsBtn),
      this._content);
    this.shadowRoot.replaceChildren(style, this._page);

    this._load();
    this._subscribe();
  }

  async _subscribe() {
    try {
      this._unsub = await this._hass.connection.subscribeMessage(() => this._reload(), {
        type: 'smarthome_companion/dashboard/subscribe',
      });
    } catch (err) {
      console.warn('[companion-dashboard] live updates unavailable', err);
    }
  }

  async _load() {
    try {
      const res = await this._hass.callWS({ type: 'smarthome_companion/dashboard/get' });
      const serialized = JSON.stringify(res);
      if (serialized === this._serialized && !this._error) return;
      this._serialized = serialized;
      this._error = null;
      this._data = res;
      this._settingsBtn.hidden = !res.user?.is_admin;
      this._wizardBtn.hidden = !res.user?.is_admin;
      this._render();
    } catch (err) {
      this._error = err;
      this._renderError(err);
    }
  }

  // ── rendering ──
  _render() {
    const { config, layout, user } = this._data;
    const ctx = { presets: config.color_presets || [], openState: this._openState };
    const scroll = this.scrollTop;

    // Greeting + badges
    this._greeting = h('h1', {});
    this._badges = new Badges(config.badges, user);

    // Side column (alerts / trash / persons / announcement)
    this._smoke = new SmokeAlerts();
    this._warning = new WarningCard(config.warning);
    this._trash = new TrashCard(config.trash);
    this._persons = new PersonCards(config.persons, user);
    this._announce = new AnnounceCard(config.announce);

    const hasSide = !!(config.warning?.entity_id || config.trash?.calendar_entities?.length
      || config.persons?.length || config.announce?.entity_id);
    const infoCard = h('div', { class: 'card info-card' },
      this._trash.el,
      this._persons.el,
      this._announce.el);

    // Rooms (independent masonry columns layout)
    this._rooms = layout.rooms.map((r) => new Room(r, ctx));
    this._roomsWrap = h('div', { class: 'rooms' });
    const roomsEl = this._rooms.length ? this._roomsWrap : this._emptyState();

    this._nav = new NavBar(config.nav);

    this._components = [this._badges, this._smoke, this._warning, this._trash, this._persons, this._announce, ...this._rooms];

    this._content.replaceChildren(
      h('div', { class: 'greeting' }, this._greeting),
      this._badges.el,
      this._smoke.el,
      h('div', { class: `layout${hasSide ? ' has-side' : ''}` },
        hasSide ? h('div', { class: 'side' }, this._warning.el, infoCard) : null,
        h('div', { class: 'main' }, roomsEl)),
      this._nav.el);

    if (this._rooms.length) {
      this._colCount = 0;
      this._layoutRooms();
      this._ro?.disconnect();
      this._ro = new ResizeObserver(debounce(() => this._layoutRooms(), 100));
      this._ro.observe(this._roomsWrap);
    }

    this._push();
    this.scrollTop = scroll;
  }

  _layoutRooms() {
    if (!this._roomsWrap || !this._rooms?.length) return;
    const width = this._roomsWrap.clientWidth || this._content?.clientWidth || window.innerWidth || 1000;
    const colWidth = 350;
    const gap = 12;
    const colCount = Math.max(1, Math.min(this._rooms.length, Math.floor((width + gap) / (colWidth + gap))));

    if (colCount === this._colCount && this._roomsCols?.length === colCount) return;
    this._colCount = colCount;

    this._roomsCols = Array.from({ length: colCount }, () => h('div', { class: 'room-col' }));
    this._rooms.forEach((r, idx) => {
      this._roomsCols[idx % colCount].append(r.el);
    });
    this._roomsWrap.replaceChildren(...this._roomsCols);
  }

  _emptyState() {
    const isAdmin = !!this._data?.user?.is_admin;
    return h('div', { class: 'card empty' },
      icon('mdi:devices'),
      h('div', { style: { fontWeight: '600', margin: '8px 0 4px', color: 'var(--primary-text-color)' } }, 'Noch keine Geräte im Dashboard'),
      h('div', { class: 'hint' }, '• Geräte über den Zauberstab oben rechts einrichten\n• Räume kommen automatisch aus Home Assistant\n• Zusatz-Kacheln über „Dashboard einrichten“'),
      isAdmin ? h('div', { style: { marginTop: '16px' } },
        h('button', { class: 'btn primary', onClick: () => this._openWizard() }, icon('mdi:plus-circle-outline'), 'Gerät einrichten')) : null);
  }

  _renderError(err) {
    const missing = /unknown_command|not found|unknown command/i.test(String(err?.code || err?.message || err));
    this._content.replaceChildren(h('div', { class: 'card empty' },
      icon('mdi:alert-circle-outline'),
      h('div', { style: { fontWeight: '600', margin: '8px 0 4px', color: 'var(--primary-text-color)' } }, 'Dashboard nicht verfügbar'),
      h('div', { class: 'hint' }, missing
        ? '• Companion-Backend aktualisieren\n• Home Assistant neu starten'
        : `• ${err?.message || 'Unbekannter Fehler'}\n• Verbindung prüfen`),
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onClick: () => this._load() }, 'Erneut versuchen'))));
  }

  // ── state updates (coalesced to one per frame) ──
  _schedulePush() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._push(); });
  }

  _push() {
    const hass = this._hass;
    if (!hass || !this._data) return;
    this._components.forEach((c) => c.update(hass));
    this._greeting.textContent = this._greetingText(hass);
  }

  _greetingText(hass) {
    const name = hass.user?.name || '';
    const entityId = this._data.config.greeting_entity;
    const st = entityId ? hass.states[entityId] : null;
    let hello = st && st.state && !['unknown', 'unavailable'].includes(st.state) ? st.state : '';
    if (!hello) {
      const hour = new Date().getHours();
      hello = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
    }
    return name ? `${hello}, ${name}` : hello;
  }

  // ── device wizard ──
  _openWizard() {
    this._wizard?.el.remove();
    this._wizard = new DeviceWizard({
      hass: this._hass,
      onClose: () => { this._wizard?.el.remove(); this._wizard = null; },
      onSaved: (err) => {
        if (err) { this._toast(`Fehler: ${err.message || err}`); return; }
        this._wizard?.el.remove();
        this._wizard = null;
        this._toast('Gerät erfolgreich eingerichtet');
        this._serialized = null;
        this._load();
      },
    });
    this.shadowRoot.append(this._wizard.el);
  }

  // ── settings ──
  async _openSettings() {
    try {
      const [edit, users] = await Promise.all([
        this._hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true }),
        this._hass.callWS({ type: 'smarthome_companion/dashboard/users' }),
      ]);
      this._settings?.el.remove();
      this._settings = new Settings({
        hass: this._hass,
        config: edit.config,
        layout: edit.layout,
        users: users.users,
        onClose: () => { this._settings?.el.remove(); this._settings = null; },
        onSaved: (err) => {
          if (err) { this._toast(`Fehler: ${err.message || err}`); return; }
          this._settings?.el.remove();
          this._settings = null;
          this._toast('Gespeichert');
          this._serialized = null;
          this._load();
        },
      });
      this.shadowRoot.append(this._settings.el);
    } catch (err) {
      this._toast(`Einstellungen nicht verfügbar: ${err.message || err}`);
    }
  }

  _toast(text) {
    const el = h('div', { class: 'toast' }, text);
    this.shadowRoot.append(el);
    setTimeout(() => el.remove(), 3200);
  }
}

if (!customElements.get('companion-dashboard-panel')) {
  customElements.define('companion-dashboard-panel', CompanionDashboardPanel);
}
