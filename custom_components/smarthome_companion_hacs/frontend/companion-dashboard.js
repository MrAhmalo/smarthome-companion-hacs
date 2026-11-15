// SmartHome Companion dashboard panel (sidebar entry "Übersicht").
// Self-contained: no HACS cards required. The layout is resolved by the backend on every load,
// so renamed entities / re-configured devices never leave dead tiles behind.
import { STYLES } from './lib/styles.js';
import {
  h, icon, debounce, showToast, navigate, resolveInternalView,
} from './lib/util.js';
import { Room } from './components/room.js';
import { RoomDetailView } from './components/room_detail.js';
import { WarningDetailView } from './components/warning_detail.js';
import {
  Badges, SmokeAlerts, WarningCard, TrashCard, AnnounceCard, NavBar,
} from './components/specials.js';
import { Settings } from './components/settings.js';
import { RoomEditModal } from './components/room_modals.js';
import {
  WhatsNewModal, shouldShowWhatsNew, recordWhatsNewShown, recordWhatsNewDismissed,
} from './components/whats_new_modal.js';
import { DeviceWizard } from './components/device_wizard.js';
import { SecurityView } from './components/view_security.js';
import { SolarView } from './components/view_solar.js';
import { BlindsView } from './components/view_blinds.js';
import { AutoView } from './components/view_auto.js';
import { Printer3DView } from './components/view_printer3d.js';
import { MoreView } from './components/view_more.js';

class CompanionDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._openState = new Map();
    this._components = [];
    this._data = null;
    this._raf = 0;
    this._activeView = 'overview';
    this._prevView = 'overview';
    this._activeRoomId = null;
    this._activeWarningView = false;
    this._editMode = false;
    this._isLovelaceCard = false;
    this._usersCache = null;
    this._reload = debounce(() => this._load(), 800);
    this._onPopState = () => this._syncRouteFromHash(true);
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
    this._syncToolbar();
  }

  set panel(value) {
    const isCard = Boolean(value?.config?.is_lovelace_card);
    this._isLovelaceCard = isCard;
    if (isCard) this.setAttribute('data-lovelace', '');
    else this.removeAttribute('data-lovelace');
  }

  set route(_value) { /* unused */ }

  connectedCallback() {
    if (this._hass && !this._initialised) this._init();
  }

  _destroyComponents() {
    for (const c of this._components) c?.destroy?.();
    this._components = [];
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
    this._ro?.disconnect();
    this._ro = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this._onPopState);
    }
    this._destroyComponents();
    this._roomModal?.destroy?.();
    this._roomModal = null;
    this._whatsNew?.destroy?.();
    this._whatsNew = null;
    if (this._whatsNewTimer) {
      clearTimeout(this._whatsNewTimer);
      this._whatsNewTimer = null;
    }
    this._wizard?.destroy?.();
    this._wizard = null;
    this._settings?.destroy?.();
    this._settings = null;
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
    this._backBtn = h('button', {
      class: 'icon-btn back-btn', 'aria-label': 'Zurück zum Dashboard', title: 'Zurück', hidden: true,
      onClick: () => {
        if (this._activeWarningView) this._closeWarningDetail();
        else if (this._activeRoomId) this._closeRoom();
        else if (this._activeView && this._activeView !== 'overview') {
          this._navigate(this._prevView === 'more' && ['auto', 'printer3d'].includes(this._activeView) ? 'more' : 'overview');
        }
      },
    }, icon('mdi:arrow-left'));
    this._wizardBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Gerät einrichten', title: 'Gerät einrichten', hidden: true,
      onClick: () => this._openWizard(),
    }, icon('mdi:plus-circle-outline'));
    this._editBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Bearbeitungsmodus', title: 'Bearbeitungsmodus (Gerät direkt anklicken)', hidden: true,
      onClick: () => this._toggleEditMode(),
    }, icon('mdi:pencil'));
    this._settingsBtn = h('button', {
      class: 'icon-btn', 'aria-label': 'Dashboard einrichten', title: 'Dashboard einrichten', hidden: true,
      onClick: () => this._openSettings(),
    }, icon('mdi:cog-outline'));
    this._content = h('div');
    this._toolbar = h('div', { class: 'toolbar' },
      this._menuBtn, this._backBtn, h('div', { class: 'spacer' }), this._wizardBtn, this._editBtn, this._settingsBtn);
    this._page = h('div', { class: 'page' }, this._toolbar, this._content);
    this.shadowRoot.replaceChildren(style, this._page);

    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this._onPopState);
      this._syncRouteFromHash(false);
    }
    this._syncToolbar();
    this._load();
    this._subscribe();
  }

  _syncToolbar() {
    if (!this._toolbar) return;
    const anyVisible = [this._menuBtn, this._backBtn, this._wizardBtn, this._editBtn, this._settingsBtn]
      .some((b) => b && !b.hidden);
    this._toolbar.hidden = !anyVisible;
  }

  _syncRouteFromHash(shouldRender = true) {
    if (typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const v = params.get('view');
    const r = params.get('room');
    if (r) {
      this._activeRoomId = r;
      this._activeWarningView = false;
      this._activeView = 'overview';
    } else if (v === 'warning') {
      this._activeWarningView = true;
      this._activeRoomId = null;
      this._activeView = 'warning';
    } else if (v && ['security', 'solar', 'blinds', 'auto', 'printer3d', 'more'].includes(v)) {
      this._activeView = v;
      this._activeRoomId = null;
      this._activeWarningView = false;
    } else {
      this._activeView = 'overview';
      this._activeRoomId = null;
      this._activeWarningView = false;
    }
    if (shouldRender && this._data) this._render();
  }

  _pushHash(nextHash) {
    if (typeof window === 'undefined') return;
    const target = nextHash || '';
    if ((window.location.hash || '') === target) return;
    try {
      const url = target || (window.location.pathname + window.location.search);
      window.history.pushState(null, '', url);
    } catch (_) {
      window.location.hash = target;
    }
  }

  _navigate(target) {
    const internal = resolveInternalView(target);
    if (!internal) {
      if (typeof target === 'string' && target) navigate(target);
      return;
    }
    if (internal === 'warning') {
      this._openWarningDetail();
      return;
    }
    this._prevView = this._activeView || 'overview';
    this._activeWarningView = false;
    this._activeRoomId = null;
    this._activeView = internal;
    this._pushHash(internal === 'overview' ? '' : `#view=${encodeURIComponent(internal)}`);
    if (this._data) this._render();
    this.scrollTop = 0;
  }

  _makeNavBar(config, user) {
    const active = this._activeWarningView ? 'warning' : (this._activeView || 'overview');
    return new NavBar(config.nav, {
      activeView: active,
      viewsConfig: config.views || {},
      user,
      onNavigate: (target) => this._navigate(target),
    });
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
      this._editBtn.hidden = !res.user?.is_admin;
      this._syncToolbar();
      this._render();
      if (!this._whatsNewChecked) {
        this._whatsNewChecked = true;
        this._maybeShowWhatsNew();
      }
    } catch (err) {
      this._error = err;
      this._renderError(err);
    }
  }

  // ── rendering ──
  _render() {
    this._destroyComponents();
    const { config, layout, user } = this._data;
    const ctx = {
      presets: config.color_presets || [],
      openState: this._openState,
      onOpenRoom: (areaId) => this._openRoom(areaId),
      onEditRoom: (roomSpec) => this._openRoomEdit(roomSpec),
      onOpenDevice: (deviceId) => {
        this._openWizard(deviceId);
      },
      onOpenGroup: (groupId) => {
        this._openWizard(null, groupId);
      },
      onOpenSettings: () => this._openSettings(),
      isEditMode: () => !!this._editMode,
    };

    // Subview: weather warning detailed view
    if (this._activeWarningView) {
      this._ro?.disconnect();
      this._backBtn.hidden = false;
      this._menuBtn.hidden = true;
      this._syncToolbar();
      this._warningDetail = new WarningDetailView(config.warning || layout.warning || { entity_id: config.warning_entity }, () => this._closeWarningDetail());
      this._nav = this._makeNavBar(config, user);
      this._components = [this._warningDetail];
      this._content.replaceChildren(this._warningDetail.el, this._nav.el);
      if (this._editMode && this._editBanner) {
        this._content.prepend(this._editBanner);
      }
      this._push();
      return;
    }

    // Subview: single room detailed view
    if (this._activeRoomId) {
      const roomSpec = layout.rooms.find((r) => r.area_id === this._activeRoomId);
      if (roomSpec) {
        this._ro?.disconnect();
        this._backBtn.hidden = false;
        this._menuBtn.hidden = true;
        this._syncToolbar();
        this._roomDetail = new RoomDetailView(roomSpec, ctx, () => this._closeRoom());
        this._nav = this._makeNavBar(config, user);
        this._components = [this._roomDetail];
        this._content.replaceChildren(this._roomDetail.el, this._nav.el);
        if (this._editMode && this._editBanner) {
          this._content.prepend(this._editBanner);
        }
        this._push();
        return;
      }
      this._activeRoomId = null;
    }

    // Subview: built-in migrated views (security, solar, blinds, auto, printer3d, more)
    const activeView = this._activeView;
    if (activeView && activeView !== 'overview') {
      let viewInst = null;
      if (activeView === 'security') viewInst = new SecurityView({ hass: this._hass, layout, config, ctx });
      else if (activeView === 'solar') viewInst = new SolarView({ hass: this._hass, layout, config, ctx });
      else if (activeView === 'blinds') viewInst = new BlindsView({ hass: this._hass, layout, config, ctx });
      else if (activeView === 'auto') viewInst = new AutoView({ hass: this._hass, layout, config, ctx });
      else if (activeView === 'printer3d') viewInst = new Printer3DView({ hass: this._hass, layout, config, ctx });
      else if (activeView === 'more') {
        viewInst = new MoreView({
          hass: this._hass,
          layout,
          config,
          ctx,
          user,
          isAdmin: !!user?.is_admin,
          onNavigate: (target) => this._navigate(target),
          onOpenSettings: () => this._openSettings(),
        });
      }

      if (viewInst) {
        this._ro?.disconnect();
        this._backBtn.hidden = true;
        this._menuBtn.hidden = !this._narrow;
        this._syncToolbar();
        this._nav = this._makeNavBar(config, user);
        this._components = [viewInst];
        this._content.replaceChildren(viewInst.el, this._nav.el);
        if (this._editMode && this._editBanner) {
          this._content.prepend(this._editBanner);
        }
        this._push();
        if (activeView === 'security' && this._pendingSecuritySmokeScroll) {
          this._pendingSecuritySmokeScroll = false;
          requestAnimationFrame(() => {
            this._content.querySelector('#security-smoke')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
        return;
      }
      this._activeView = 'overview';
    }

    this._backBtn.hidden = true;
    this._menuBtn.hidden = !this._narrow;
    this._syncToolbar();

    const scroll = this.scrollTop;

    // Greeting + badges
    this._greeting = h('h1', {});
    this._badges = new Badges(config.badges, user, (target) => this._navigate(target));

    // Smoke alert banner right under status badges (configured smoke detectors only)
    this._smoke = new SmokeAlerts({
      onOpenSmoke: () => {
        this._pendingSecuritySmokeScroll = true;
        this._navigate('security');
      },
    });
    this._smoke.setLayout(layout);

    // Side column (warning / trash / announcement — persons removed from home overview)
    this._warning = new WarningCard(config.warning, () => this._openWarningDetail());
    this._trash = new TrashCard(config.trash);
    this._announce = new AnnounceCard(config.announce);

    const hasSide = !!(config.warning?.entity_id || config.trash?.calendar_entities?.length || config.announce?.entity_id);

    // Rooms (independent masonry columns layout)
    this._rooms = layout.rooms.map((r) => new Room(r, ctx));
    this._roomsWrap = h('div', { class: 'rooms' });
    const roomsEl = this._rooms.length ? this._roomsWrap : this._emptyState();

    this._nav = this._makeNavBar(config, user);

    this._components = [this._badges, this._smoke, this._warning, this._trash, this._announce, ...this._rooms];

    this._content.replaceChildren(
      h('div', { class: 'greeting' }, this._greeting),
      this._badges.el,
      this._smoke.el,
      h('div', { class: `layout${hasSide ? ' has-side' : ''}` },
        hasSide ? h('div', { class: 'side' }, this._warning.el, this._trash.el, this._announce.el) : null,
        h('div', { class: 'main' }, roomsEl)),
      this._nav.el);

    if (this._rooms.length) {
      this._colCount = 0;
      this._layoutRooms();
      this._ro?.disconnect();
      this._ro = new ResizeObserver(debounce(() => this._layoutRooms(), 100));
      this._ro.observe(this._roomsWrap);
    }

    if (this._editMode && this._editBanner) {
      this._content.prepend(this._editBanner);
    }

    this._push();
    this.scrollTop = scroll;
  }

  _layoutRooms() {
    if (!this._roomsWrap || !this._rooms?.length) return;
    const winW = (typeof window !== 'undefined' ? window.innerWidth : 0) || 1000;
    const width = this._roomsWrap.clientWidth || this._content?.clientWidth || winW;
    const gap = 12;
    const colCount = Math.max(1, Math.min(this._rooms.length, Math.floor((width + gap) / 360)));

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
      h('div', { style: { fontWeight: '600', margin: '8px 0 4px', color: 'var(--primary-text-color)' } }, 'Keine Geräte eingerichtet'),
      h('div', { class: 'hint' }, '• Einrichtung über + oben rechts\n• Räume aus Home Assistant\n• Zusatz-Kacheln in Einstellungen'),
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
    if (this._greeting) {
      this._greeting.textContent = this._greetingText(hass);
    }
  }

  _greetingText(hass) {
    const name = hass.user?.name || '';
    const g = this._data?.config?.greetings || {};
    const hour = new Date().getHours();
    let hello;
    if (hour < 11) {
      hello = (typeof g.morning === 'string' && g.morning.trim()) ? g.morning.trim() : 'Guten Morgen';
    } else if (hour < 18) {
      hello = (typeof g.day === 'string' && g.day.trim()) ? g.day.trim() : 'Guten Tag';
    } else {
      hello = (typeof g.evening === 'string' && g.evening.trim()) ? g.evening.trim() : 'Guten Abend';
    }
    return name ? `${hello}, ${name}` : hello;
  }

  // ── room subview ──
  _openRoom(areaId) {
    this._activeWarningView = false;
    this._activeView = 'overview';
    this._activeRoomId = areaId;
    this._pushHash(areaId ? `#room=${encodeURIComponent(areaId)}` : '');
    this._render();
    this.scrollTop = 0;
  }

  _closeRoom() {
    this._activeWarningView = false;
    this._activeRoomId = null;
    this._activeView = 'overview';
    this._pushHash('');
    this._backBtn.hidden = true;
    this._menuBtn.hidden = !this._narrow;
    this._syncToolbar();
    this._render();
  }

  // ── warning subview ──
  _openWarningDetail() {
    this._activeWarningView = true;
    this._activeRoomId = null;
    this._activeView = 'warning';
    this._pushHash('#view=warning');
    this._render();
    this.scrollTop = 0;
  }

  _closeWarningDetail() {
    this._activeWarningView = false;
    this._activeView = 'overview';
    this._pushHash('');
    this._backBtn.hidden = true;
    this._menuBtn.hidden = !this._narrow;
    this._syncToolbar();
    this._render();
  }

  // ── edit mode ──
  _toggleEditMode() {
    this._editMode = !this._editMode;
    this._editBtn?.toggleAttribute('data-active', this._editMode);
    this._editBtn?.classList.toggle('edit-btn-active', this._editMode);
    this._page?.toggleAttribute('data-edit-mode', this._editMode);
    if (this._editMode) {
      if (!this._editBanner) {
        this._editBanner = h('div', { class: 'edit-mode-banner' },
          h('div', { class: 'edit-mode-banner-info' },
            icon('mdi:pencil'),
            h('span', {}, 'Bearbeitungsmodus: Kachel oder Raum tippen')),
          h('button', {
            class: 'edit-mode-banner-btn',
            type: 'button',
            onClick: () => this._toggleEditMode(),
          }, 'Fertig'));
      }
      this._content?.prepend(this._editBanner);
    } else {
      this._editBanner?.remove();
    }
    this._push();
  }

  // ── room edit modal ──
  async _openRoomEdit(roomSpec) {
    if (!this._hass || !roomSpec) return;
    if (!this._usersCache) {
      try {
        const res = await this._hass.callWS({ type: 'smarthome_companion/dashboard/users' });
        this._usersCache = res?.users || [];
      } catch (_) {
        this._usersCache = [];
      }
    }
    this._roomModal?.destroy?.();
    this._roomModal = new RoomEditModal({
      hass: this._hass,
      roomSpec,
      users: this._usersCache || [],
      onClose: () => {
        this._roomModal?.destroy?.();
        this._roomModal = null;
      },
      onSaved: () => {
        this._roomModal?.destroy?.();
        this._roomModal = null;
        this._serialized = null;
        this._load();
        this._toast('Raum gespeichert');
      },
    });
    this.shadowRoot.append(this._roomModal.el);
  }

  // ── device wizard ──
  _openWizard(deviceId = null, groupId = null) {
    this._wizard?.destroy?.();
    this._wizard = new DeviceWizard({
      hass: this._hass,
      initialDeviceId: deviceId,
      initialGroupId: groupId,
      onClose: () => {
        this._wizard?.destroy?.();
        this._wizard = null;
      },
      onSaved: (err) => {
        if (err) { this._toast(`Fehler: ${err.message || err}`, true); return; }
        this._wizard?.destroy?.();
        this._wizard = null;
        this._toast('Gespeichert');
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
      this._settings?.destroy?.();
      this._settings = new Settings({
        hass: this._hass,
        config: edit.config,
        layout: edit.layout,
        users: users.users,
        onClose: () => {
          this._settings?.destroy?.();
          this._settings = null;
        },
        onOpenDevice: (devId) => {
          this._settings?.destroy?.();
          this._settings = null;
          this._openWizard(devId);
        },
        onOpenGroup: (groupId) => {
          this._settings?.destroy?.();
          this._settings = null;
          this._openWizard(null, groupId);
        },
        onSaved: (err) => {
          if (err) { this._toast(`Fehler: ${err.message || err}`, true); return; }
          this._settings?.destroy?.();
          this._settings = null;
          this._toast('Gespeichert');
          this._serialized = null;
          this._load();
        },
      });
      this.shadowRoot.append(this._settings.el);
    } catch (err) {
      this._toast(`Einstellungen nicht verfügbar: ${err.message || err}`, true);
    }
  }

  _maybeShowWhatsNew() {
    if (this._whatsNew || this._whatsNewTimer || this._wizard || this._settings || this._roomModal) return;
    const userId = this._hass?.user?.id || this._data?.user?.id;
    if (!shouldShowWhatsNew(userId)) return;
    this._whatsNewTimer = setTimeout(() => {
      this._whatsNewTimer = null;
      if (!this.isConnected || this._whatsNew || this._wizard || this._settings || this._roomModal) return;
      if (!shouldShowWhatsNew(userId)) return;
      recordWhatsNewShown(userId);
      this._whatsNew = new WhatsNewModal({
        onDismiss: () => {
          recordWhatsNewDismissed(userId);
          this._whatsNew = null;
        },
      });
      this.shadowRoot.append(this._whatsNew.el);
    }, 250);
  }

  _toast(text, error = false) {
    showToast(this.shadowRoot, text, { error });
  }
}

if (!customElements.get('companion-dashboard-panel')) {
  customElements.define('companion-dashboard-panel', CompanionDashboardPanel);
}

class CompanionDashboardCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._panel = null;
    this._hass = null;
  }

  connectedCallback() {
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.height = '100%';
  }

  setConfig(config) {
    this._config = config || {};
    if (this._panel) {
      this._panel.panel = { config: { ...this._config, is_lovelace_card: true } };
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._panel) {
      this._panel = document.createElement('companion-dashboard-panel');
      this._panel.panel = { config: { ...this._config, is_lovelace_card: true } };
      this._panel.narrow = !!this._narrow;
      this.replaceChildren(this._panel);
    }
    this._panel.hass = hass;
  }

  set narrow(value) {
    this._narrow = value;
    if (this._panel) this._panel.narrow = value;
  }

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return { columns: 'full', rows: 'auto' };
  }
}

if (!customElements.get('companion-dashboard-card')) {
  customElements.define('companion-dashboard-card', CompanionDashboardCard);
}

if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'companion-dashboard-card')) {
    window.customCards.push({
      type: 'companion-dashboard-card',
      name: 'SmartHome Companion Übersicht',
      description: 'Vollständiges SmartHome Companion Dashboard als Lovelace-Ansicht.',
    });
  }
}
