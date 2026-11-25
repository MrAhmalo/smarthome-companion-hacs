// SmartHome Companion dashboard panel (sidebar entry "Übersicht").
// Self-contained: no HACS cards required. The layout is resolved by the backend on every load,
// so renamed entities / re-configured devices never leave dead tiles behind.
import { STYLES } from './lib/styles.js';
import {
  h, icon, debounce, showToast, navigate, resolveInternalView, parseChannelKey,
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
    this._scrollPositions = new Map();
    this._renderedKey = null;
    this._scrollRestoreSeq = 0;
    this._restoringScrollUntil = 0;
    this._activeScrollEl = null;
    this._moreInfoScrollSnap = null;
    this._headerPortaled = false;
    this._headerObserver = null;
    this._headerPortalRoot = null;
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
    this._teardownHeaderPortal();
    if (this._boundScrollEl && this._onContainerScroll) {
      this._boundScrollEl.removeEventListener('scroll', this._onContainerScroll);
      this._boundScrollEl = null;
    }
    if (this._onMoreInfo) {
      this.removeEventListener('hass-more-info', this._onMoreInfo);
      this._onMoreInfo = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this._onPopState);
      if (this._onAnyScroll) {
        window.removeEventListener('scroll', this._onAnyScroll, true);
        this._onAnyScroll = null;
      }
      if (this._cancelScrollRestore) {
        window.removeEventListener('wheel', this._cancelScrollRestore);
        window.removeEventListener('touchmove', this._cancelScrollRestore);
        this._cancelScrollRestore = null;
      }
      if (this._onDialogClosed) {
        window.removeEventListener('dialog-closed', this._onDialogClosed);
        this._onDialogClosed = null;
      }
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
    this._stickyBannerSlot = h('div', { class: 'sticky-banner-slot' });
    this._stickyHeader = h('div', { class: 'cd-sticky-header' }, this._toolbar, this._stickyBannerSlot);
    this._page = h('div', { class: 'page' }, this._stickyHeader, this._content);
    this.shadowRoot.replaceChildren(style, this._page);

    this._onMoreInfo = () => {
      const key = this._currentScrollKey();
      const { el, y } = this._readScrollY();
      if (y > 0) this._writeStoredScroll(key, y);
      this._lastScrollEl = el;
      this._moreInfoScrollSnap = {
        key,
        y: Math.max(y, this._readStoredScroll(key) || 0),
        el: this._activeScrollEl || el,
      };
    };
    this.addEventListener('hass-more-info', this._onMoreInfo);

    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this._onPopState);
      this._onAnyScroll = (e) => {
        if (Date.now() < this._restoringScrollUntil || !this._data) return;
        const target = e.target;
        if (!target) return;
        const isDoc = target === document || target === window || target === document.documentElement || target === document.body;
        if (!isDoc) {
          if (!(target instanceof Element)) return;
          if (target.closest?.('.dialog-body, .overlay, .ep-list, .cdd-list, .ip-grid, .badges, .nav')) {
            return;
          }
          const ov = getComputedStyle(target).overflowY;
          const scrollable = (ov === 'auto' || ov === 'scroll' || ov === 'overlay') && target.scrollHeight > target.clientHeight + 2;
          if (!scrollable) return;
          if (target !== this && !(typeof target.contains === 'function' && target.contains(this))) return;
        }
        const docEl = document.scrollingElement || document.documentElement;
        const y = isDoc
          ? (window.scrollY || docEl?.scrollTop || 0)
          : (target.scrollTop || 0);
        this._activeScrollEl = isDoc ? docEl : target;
        this._lastScrollEl = this._activeScrollEl;
        this._writeStoredScroll(this._currentScrollKey(), y);
      };
      window.addEventListener('scroll', this._onAnyScroll, { capture: true, passive: true });

      this._cancelScrollRestore = () => {
        this._restoringScrollUntil = 0;
        this._scrollRestoreSeq++;
      };
      window.addEventListener('wheel', this._cancelScrollRestore, { passive: true });
      window.addEventListener('touchmove', this._cancelScrollRestore, { passive: true });

      this._onDialogClosed = () => {
        if (this._moreInfoScrollSnap && this._moreInfoScrollSnap.key === this._currentScrollKey() && this._moreInfoScrollSnap.y > 0) {
          const snap = this._moreInfoScrollSnap;
          this._moreInfoScrollSnap = null;
          this._restoreScroll(snap.key, snap.y, snap.el);
        }
      };
      window.addEventListener('dialog-closed', this._onDialogClosed);
      this._syncRouteFromHash(false);
    }
    this._onContainerScroll = (e) => {
      if (Date.now() < this._restoringScrollUntil || !this._data) return;
      const sc = e.currentTarget;
      if (!sc) return;
      this._activeScrollEl = sc;
      this._lastScrollEl = sc;
      this._writeStoredScroll(this._currentScrollKey(), sc.scrollTop || 0);
    };
    this._syncHeaderPortal();
    this._syncToolbar();
    this._load();
    this._subscribe();
  }

  _bindScrollContainer() {
    const sc = this._getScrollContainer();
    const docEl = typeof document !== 'undefined' ? (document.scrollingElement || document.documentElement) : null;
    if (!sc || sc === docEl || sc === document.body) return sc;
    if (this._boundScrollEl !== sc && this._onContainerScroll) {
      if (this._boundScrollEl) {
        this._boundScrollEl.removeEventListener('scroll', this._onContainerScroll);
      }
      sc.addEventListener('scroll', this._onContainerScroll, { passive: true });
      this._boundScrollEl = sc;
    }
    return sc;
  }

  _nextComposedParent(el) {
    if (!el) return null;
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const rn = el.getRootNode?.();
    return rn instanceof ShadowRoot ? rn.host : null;
  }

  _findHaHeaderRoot() {
    if (typeof document === 'undefined') return null;
    let node = this;
    while (node) {
      if (node.tagName === 'HUI-ROOT' && node.shadowRoot) {
        const sr = node.shadowRoot;
        const toolbar = sr.querySelector('.header .toolbar, .toolbar');
        if (toolbar) {
          return {
            root: node,
            shadowRoot: sr,
            header: sr.querySelector('.header') || toolbar.parentElement,
            toolbar,
            actionItems: toolbar.querySelector('.action-items') || toolbar,
          };
        }
      }
      node = this._nextComposedParent(node);
    }
    return null;
  }

  _teardownHeaderPortal() {
    this._headerObserver?.disconnect();
    this._headerObserver = null;
    if (this._headerPortalRoot?.shadowRoot) {
      this._headerPortalRoot.shadowRoot.getElementById('cd-ha-header-actions')?.remove();
      this._headerPortalRoot.shadowRoot.getElementById('cd-ha-header-edit-banner')?.remove();
    } else if (typeof document !== 'undefined') {
      document.querySelectorAll('hui-root').forEach((hr) => {
        hr.shadowRoot?.getElementById('cd-ha-header-actions')?.remove();
        hr.shadowRoot?.getElementById('cd-ha-header-edit-banner')?.remove();
      });
    }
    this._headerPortalRoot = null;
    this._headerPortaled = false;
  }

  _syncHeaderPortal() {
    const haHeader = this._findHaHeaderRoot();
    const isAdmin = !!this._data?.user?.is_admin;

    if (!haHeader) {
      if (this._headerPortaled) {
        this._teardownHeaderPortal();
      }
      this._wizardBtn?.removeAttribute('data-portaled');
      this._editBtn?.removeAttribute('data-portaled');
      this._settingsBtn?.removeAttribute('data-portaled');
      if (this._editMode && this._editBanner && this._stickyBannerSlot && this._editBanner.parentNode !== this._stickyBannerSlot) {
        this._stickyBannerSlot.replaceChildren(this._editBanner);
      } else if (!this._editMode) {
        this._editBanner?.remove();
      }
      return;
    }

    this._headerPortaled = true;
    this._headerPortalRoot = haHeader.root;
    this._wizardBtn?.setAttribute('data-portaled', '');
    this._editBtn?.setAttribute('data-portaled', '');
    this._settingsBtn?.setAttribute('data-portaled', '');
    this._editBanner?.remove();

    const sr = haHeader.shadowRoot;
    if (!this._headerObserver && sr) {
      this._headerObserver = new MutationObserver(debounce(() => {
        if (!this.isConnected) return;
        const missingActions = isAdmin && !sr.getElementById('cd-ha-header-actions');
        const missingBanner = this._editMode && !sr.getElementById('cd-ha-header-edit-banner');
        if (missingActions || missingBanner) this._syncHeaderPortal();
      }, 60));
      this._headerObserver.observe(sr, { childList: true, subtree: true });
    }

    let actionHost = sr.getElementById('cd-ha-header-actions');
    if (!isAdmin) {
      actionHost?.remove();
    } else {
      if (!actionHost) {
        actionHost = h('div', {
          id: 'cd-ha-header-actions',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            marginRight: '4px',
            paddingRight: '6px',
            borderRight: '1px solid rgba(128,128,128,0.28)',
          },
        });
        const mkPortalBtn = (ic, label, onClick) => {
          const btn = h('button', {
            type: 'button',
            title: label,
            'aria-label': label,
            style: {
              width: '40px',
              height: '40px',
              minWidth: '40px',
              borderRadius: '50%',
              border: '0',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              display: 'inline-grid',
              placeItems: 'center',
              padding: '0',
            },
            onClick,
          }, icon(ic));
          return btn;
        };
        const pWizard = mkPortalBtn('mdi:plus-circle-outline', 'Gerät einrichten', () => this._openWizard());
        const pEdit = mkPortalBtn('mdi:pencil', 'Bearbeitungsmodus', () => this._toggleEditMode());
        const pSettings = mkPortalBtn('mdi:cog-outline', 'Dashboard einrichten', () => this._openSettings());
        actionHost.append(pWizard, pEdit, pSettings);
        haHeader.actionItems.prepend(actionHost);
      }
      const pEditBtn = actionHost.children?.[1];
      if (pEditBtn) {
        pEditBtn.style.background = this._editMode ? 'var(--primary-color, #03a9f4)' : 'transparent';
        pEditBtn.style.color = this._editMode ? '#fff' : 'inherit';
        pEditBtn.toggleAttribute('data-active', !!this._editMode);
      }
    }

    let pBanner = sr.getElementById('cd-ha-header-edit-banner');
    if (this._editMode && haHeader.header) {
      if (!pBanner) {
        pBanner = h('div', {
          id: 'cd-ha-header-edit-banner',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '6px 16px',
            background: 'color-mix(in srgb, var(--primary-color, #03a9f4) 22%, var(--app-header-background-color, #1a1a1a))',
            borderTop: '1px solid var(--primary-color, #03a9f4)',
            color: 'var(--app-header-text-color, var(--primary-text-color, #fff))',
            fontSize: '13px',
            fontWeight: '600',
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } },
          h('ha-icon', { icon: 'mdi:pencil', style: { color: 'var(--primary-color, #03a9f4)', '--mdc-icon-size': '18px' } }),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'Bearbeitungsmodus: Kachel oder Raum tippen')),
        h('button', {
          type: 'button',
          style: {
            padding: '5px 14px',
            minHeight: '32px',
            borderRadius: '16px',
            border: '0',
            background: 'var(--primary-color, #03a9f4)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
            flex: 'none',
          },
          onClick: () => this._toggleEditMode(),
        }, 'Fertig'));
        haHeader.header.append(pBanner);
      }
    } else {
      pBanner?.remove();
    }
  }

  _syncToolbar() {
    if (!this._toolbar) return;
    this._syncHeaderPortal();
    this._bindScrollContainer();
    const anyVisible = [this._menuBtn, this._backBtn, this._wizardBtn, this._editBtn, this._settingsBtn]
      .some((b) => b && !b.hidden && !b.hasAttribute('data-portaled'));
    this._toolbar.hidden = !anyVisible;
    if (this._stickyHeader) {
      const hasBanner = !!this._stickyBannerSlot?.children?.length;
      this._stickyHeader.hidden = !anyVisible && !hasBanner;
    }
  }

  _syncRouteFromHash(shouldRender = true) {
    if (typeof window === 'undefined') return;
    if (shouldRender && this._data) {
      const prevKey = this._currentScrollKey();
      const { el, y } = this._readScrollY();
      if (y > 0 || !this._scrollPositions.has(prevKey)) {
        this._writeStoredScroll(prevKey, y);
        this._lastScrollEl = el;
      }
    }
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

  _currentScrollKey() {
    if (this._activeWarningView) return 'view:warning';
    if (this._activeRoomId) return `room:${this._activeRoomId}`;
    return `view:${this._activeView || 'overview'}`;
  }

  _scrollStorageKey(key) {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    return `cd_scroll_v1:${path}:${key}`;
  }

  _readStoredScroll(key) {
    if (this._scrollPositions.has(key)) return this._scrollPositions.get(key);
    try {
      const raw = sessionStorage.getItem(this._scrollStorageKey(key));
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch (_) { /* ignore */ }
    return undefined;
  }

  _writeStoredScroll(key, y) {
    const clean = Math.max(0, Math.round(Number(y) || 0));
    this._scrollPositions.set(key, clean);
    try {
      sessionStorage.setItem(this._scrollStorageKey(key), String(clean));
    } catch (_) { /* ignore */ }
  }

  _getScrollContainer() {
    if (this._activeScrollEl && this._activeScrollEl.isConnected) {
      const docEl = document.scrollingElement || document.documentElement;
      if (this._activeScrollEl === docEl || this._activeScrollEl.scrollHeight > this._activeScrollEl.clientHeight + 2) {
        return this._activeScrollEl;
      }
    }
    if (this.scrollTop > 0) return this;
    let firstOverflow = null;
    let el = this._nextComposedParent(this);
    while (el) {
      if (el instanceof Element) {
        const ov = getComputedStyle(el).overflowY;
        const isScrollStyle = ov === 'auto' || ov === 'scroll' || ov === 'overlay';
        if (isScrollStyle && el.scrollHeight > el.clientHeight + 2) {
          return el;
        }
        if (!firstOverflow && (isScrollStyle || el.id === 'view' || /^(HUI-VIEW-CONTAINER|HA-PANEL-LOVELACE)$/.test(el.tagName || ''))) {
          firstOverflow = el;
        }
      }
      el = this._nextComposedParent(el);
    }
    return firstOverflow || document.scrollingElement || document.documentElement;
  }

  _readScrollY() {
    const el = this._bindScrollContainer() || this._getScrollContainer();
    const docEl = document.scrollingElement || document.documentElement;
    if (!el || el === docEl || el === document.body) {
      const y = (typeof window !== 'undefined' ? window.scrollY : 0) || docEl?.scrollTop || 0;
      return { el: docEl, y };
    }
    return { el, y: el.scrollTop || 0 };
  }

  _writeScrollY(y, elHint = null) {
    const targetY = Math.max(0, Number(y) || 0);
    const docEl = document.scrollingElement || document.documentElement;
    const el = (elHint && elHint.isConnected) ? elHint : (this._bindScrollContainer() || this._getScrollContainer());
    if (!el || el === docEl || el === document.body) {
      if (typeof window !== 'undefined') window.scrollTo(0, targetY);
      if (docEl) docEl.scrollTop = targetY;
      return docEl ? docEl.scrollTop : targetY;
    }
    el.scrollTop = targetY;
    return el.scrollTop;
  }

  _saveCurrentScroll() {
    const { el, y } = this._readScrollY();
    this._writeStoredScroll(this._currentScrollKey(), y);
    this._lastScrollEl = el;
  }

  _restoreScroll(key, fallback = 0, elHintArg = null) {
    const stored = this._readStoredScroll(key);
    const targetY = stored !== undefined ? stored : fallback;
    const seq = ++this._scrollRestoreSeq;
    const elHint = elHintArg || this._lastScrollEl || this._activeScrollEl;
    if (targetY > 0) this._restoringScrollUntil = Date.now() + 260;
    let settled = false;
    const apply = () => {
      if (seq !== this._scrollRestoreSeq || settled) return true;
      const actual = this._writeScrollY(targetY, elHint);
      if (targetY > 0 && Math.abs((actual || 0) - targetY) <= 2) {
        settled = true;
        this._restoringScrollUntil = 0;
        return true;
      }
      return targetY === 0;
    };
    apply();
    if (!settled) {
      requestAnimationFrame(() => {
        if (apply()) return;
        requestAnimationFrame(() => {
          if (apply()) return;
          setTimeout(() => {
            if (apply()) return;
            setTimeout(() => { apply(); }, 120);
          }, 80);
        });
      });
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
    this._saveCurrentScroll();
    this._prevView = this._activeView || 'overview';
    this._activeWarningView = false;
    this._activeRoomId = null;
    this._activeView = internal;
    this._pushHash(internal === 'overview' ? '' : `#view=${encodeURIComponent(internal)}`);
    if (this._data) this._render();
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
    const renderKey = this._currentScrollKey();
    if (this._renderedKey === renderKey && this._content) {
      this._saveCurrentScroll();
    }
    const prevMinH = this._content?.style.minHeight ?? '';
    if (this._content && this._content.offsetHeight > 0) {
      this._content.style.minHeight = `${this._content.offsetHeight}px`;
    }
    this._renderedKey = renderKey;

    this._destroyComponents();
    const { config, layout, user } = this._data;
    const scale = ['small', 'medium', 'large'].includes(config?.ui_scale) ? config.ui_scale : 'medium';
    this.setAttribute('data-scale', scale);
    const ctx = {
      hass: this._hass,
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
      onMoveTileToRoom: (payload) => this._moveTileToRoom(payload),
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
      this._push();
      this._content.style.minHeight = prevMinH;
      this._restoreScroll(renderKey, 0);
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
        this._push();
        this._content.style.minHeight = prevMinH;
        this._restoreScroll(renderKey, 0);
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
        this._push();
        this._content.style.minHeight = prevMinH;
        if (activeView === 'security' && this._pendingSecuritySmokeScroll) {
          this._pendingSecuritySmokeScroll = false;
          requestAnimationFrame(() => {
            this._content.querySelector('#security-smoke')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        } else {
          this._restoreScroll(renderKey, 0);
        }
        return;
      }
      this._activeView = 'overview';
    }

    this._backBtn.hidden = true;
    this._menuBtn.hidden = !this._narrow;
    this._syncToolbar();

    // Greeting + badges
    this._greeting = h('h1', {});
    this._badges = new Badges(config.badges, user, (target) => this._navigate(target), { layout, config });

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

    this._push();
    this._content.style.minHeight = prevMinH;
    this._restoreScroll(renderKey, 0);
  }

  _layoutRooms() {
    if (!this._roomsWrap || !this._rooms?.length) return;
    const winW = (typeof window !== 'undefined' ? window.innerWidth : 0) || 1000;
    const width = this._roomsWrap.clientWidth || this._content?.clientWidth || winW;
    const gap = 12;
    const scale = this.getAttribute('data-scale') || 'medium';
    const minColW = scale === 'large' ? 400 : scale === 'small' ? 320 : 360;
    const colCount = Math.max(1, Math.min(this._rooms.length, Math.floor((width + gap) / minColW)));

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
    this._saveCurrentScroll();
    this._activeWarningView = false;
    this._activeView = 'overview';
    this._activeRoomId = areaId;
    this._pushHash(areaId ? `#room=${encodeURIComponent(areaId)}` : '');
    this._render();
  }

  _closeRoom() {
    this._saveCurrentScroll();
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
    this._saveCurrentScroll();
    this._activeWarningView = true;
    this._activeRoomId = null;
    this._activeView = 'warning';
    this._pushHash('#view=warning');
    this._render();
  }

  _closeWarningDetail() {
    this._saveCurrentScroll();
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
    } else {
      this._editBanner?.remove();
    }
    this._syncToolbar();
    this._push();
  }

  // ── room edit modal ──
  async _openRoomEdit(roomSpec) {
    if (!this._hass || !roomSpec) return;
    this._saveCurrentScroll();
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
        this._restoreScroll(this._currentScrollKey(), 0);
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
    this._saveCurrentScroll();
    this._wizard?.destroy?.();
    this._wizard = new DeviceWizard({
      hass: this._hass,
      initialDeviceId: deviceId,
      initialGroupId: groupId,
      onClose: () => {
        this._wizard?.destroy?.();
        this._wizard = null;
        this._restoreScroll(this._currentScrollKey(), 0);
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

  async _moveTileToRoom({ tile, fromAreaId, toAreaId, sourceOrder, sourceLayout, targetOrder, targetLayout }) {
    if (!this._hass || !tile || !toAreaId || fromAreaId === toAreaId) return;
    const hass = this._hass;
    const nextAreaVal = toAreaId === '__no_area__' ? '' : toAreaId;
    const spec = tile.spec || {};
    const renamed = {};

    try {
      if (spec.group_id) {
        const gRes = await hass.callWS({ type: 'smarthome_companion/groups/list' });
        const groupCfg = (gRes?.groups || {})[spec.group_id];
        if (groupCfg) {
          await hass.callWS({
            type: 'smarthome_companion/groups/save',
            group: { ...groupCfg, area_id: nextAreaVal },
          });
        }
      } else {
        const keys = tile.coverSpecs?.length
          ? tile.coverSpecs.map((c) => ({ key: c.key, device_id: c.device_id, entity_id: c.entity_id }))
          : [{ key: spec.key, device_id: spec.device_id, entity_id: spec.entity_id }];

        const devRes = await hass.callWS({ type: 'smarthome_companion/devices/get' });
        const devices = devRes?.devices || {};
        const seenDevices = new Set();

        for (const item of keys) {
          const parsed = parseChannelKey(item.key);
          const devId = item.device_id || parsed.deviceId || item.entity_id;
          if (!devId || seenDevices.has(devId)) continue;
          const devCfg = devices[devId];
          if (!devCfg) continue;

          const entities = JSON.parse(JSON.stringify(devCfg.entities || {}));
          const subEnts = entities.sub_entities;
          const isChannelTile = String(item.key || '').startsWith('d:')
            && subEnts && typeof subEnts === 'object'
            && Object.keys(subEnts).length > 1
            && item.entity_id && subEnts[item.entity_id];

          let deviceAreaArg = nextAreaVal;
          if (isChannelTile) {
            subEnts[item.entity_id] = { ...subEnts[item.entity_id], area_id: nextAreaVal };
            deviceAreaArg = devCfg.area_id ?? undefined;
          } else {
            seenDevices.add(devId);
            if (subEnts && typeof subEnts === 'object') {
              for (const k of Object.keys(subEnts)) {
                if (subEnts[k] && typeof subEnts[k] === 'object' && 'area_id' in subEnts[k]) {
                  subEnts[k] = { ...subEnts[k], area_id: nextAreaVal };
                }
              }
            }
          }

          const cfgRes = await hass.callWS({
            type: 'smarthome_companion/devices/configure',
            device_id: devId,
            category: devCfg.category || 'sonstiges',
            entities,
            custom_name: devCfg.custom_name ?? null,
            area_id: deviceAreaArg,
            options: devCfg.options || {},
            icon: devCfg.icon ?? null,
          });
          if (cfgRes?.renamed && typeof cfgRes.renamed === 'object') {
            Object.assign(renamed, cfgRes.renamed);
          }
        }
      }

      const rewriteKey = (k) => {
        let out = k;
        for (const [oldEid, newEid] of Object.entries(renamed)) {
          if (out === oldEid || out.endsWith(`:${oldEid}`)) {
            out = out.slice(0, out.length - oldEid.length) + newEid;
          }
        }
        return out;
      };
      const cleanTargetOrder = (targetOrder || []).map(rewriteKey);
      const cleanTargetLayout = {};
      for (const [k, v] of Object.entries(targetLayout || {})) {
        cleanTargetLayout[rewriteKey(k)] = v;
      }

      await Promise.all([
        hass.callWS({
          type: 'smarthome_companion/dashboard/tile_order',
          area_id: fromAreaId,
          tile_order: sourceOrder || [],
          tile_layout: sourceLayout || {},
        }),
        hass.callWS({
          type: 'smarthome_companion/dashboard/tile_order',
          area_id: toAreaId,
          tile_order: cleanTargetOrder,
          tile_layout: cleanTargetLayout,
        }),
      ]);

      this._toast('In neuen Raum verschoben');
      this._serialized = null;
      await this._load();
    } catch (err) {
      this._toast(`Verschieben fehlgeschlagen: ${err.message || err}`, true);
      this._serialized = null;
      await this._load();
    }
  }

  // ── settings ──
  async _openSettings() {
    this._saveCurrentScroll();
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
          this._restoreScroll(this._currentScrollKey(), 0);
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
