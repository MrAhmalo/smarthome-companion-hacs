// Apple-style "Neu in deinem Smart Home" welcome modal with strict per-user frequency limits.
import { h, icon } from '../lib/util.js';

export const WHATS_NEW_MAX_SHOWS = 3;
export const WHATS_NEW_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000; // 10,800,000 ms (3 hours)
export const WHATS_NEW_STORAGE_PREFIX = 'smarthome_companion.whats_new.v1.';

export const WHATS_NEW_HIGHLIGHTS = [
  {
    icon: 'mdi:view-dashboard-outline',
    color: 'var(--cd-accent, #03a9f4)',
    bg: 'rgba(3, 169, 244, 0.16)',
    title: 'Startseite & Live-Sensoren',
    description: 'Status-Badges, Warnungen sowie Klima- und Bodenwerte pro Raum.',
  },
  {
    icon: 'mdi:lightning-bolt',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.16)',
    title: 'Smarte Raumsteuerung',
    description: 'Direktschalter für Licht, Steckdosen und Rollläden im Raum-Header.',
  },
  {
    icon: 'mdi:plus-circle-outline',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.16)',
    title: 'Geführter Geräte-Assistent',
    description: 'Geräte & Kanäle per + einrichten – inkl. Watt- & kWh-Erkennung.',
  },
  {
    icon: 'mdi:pencil-outline',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.16)',
    title: 'Direkt anpassbar',
    description: 'Kacheln per Stift bearbeiten – für Desktop, Tablet und Mobil.',
  },
];

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function storageKey(userId) {
  return `${WHATS_NEW_STORAGE_PREFIX}${String(userId)}`;
}

/** Read persisted per-user display count & timestamp safely. */
export function readWhatsNewState(userId, storage = null) {
  const store = getStorage(storage);
  if (!store || !userId) return { count: 0, lastShownAt: 0 };
  try {
    const raw = store.getItem(storageKey(userId));
    if (!raw) return { count: 0, lastShownAt: 0 };
    const parsed = JSON.parse(raw);
    const count = Number.isFinite(Number(parsed?.count)) ? Math.max(0, Math.floor(Number(parsed.count))) : 0;
    const lastShownAt = Number.isFinite(Number(parsed?.lastShownAt)) ? Math.max(0, Number(parsed.lastShownAt)) : 0;
    return { count, lastShownAt };
  } catch {
    return { count: 0, lastShownAt: 0 };
  }
}

function writeWhatsNewState(userId, state, storage = null) {
  const store = getStorage(storage);
  if (!store || !userId) return;
  try {
    store.setItem(storageKey(userId), JSON.stringify({
      count: Math.max(0, Math.floor(state.count || 0)),
      lastShownAt: Math.max(0, Number(state.lastShownAt || 0)),
    }));
  } catch {
    // Ignore storage quota or private-mode failures cleanly.
  }
}

/**
 * Check whether the popup may be shown for this user:
 * 1) Never more than 3 times total.
 * 2) At least 3 hours (10,800,000 ms) since last show/dismiss.
 */
export function shouldShowWhatsNew(userId, now = Date.now(), storage = null) {
  if (!userId) return false;
  const state = readWhatsNewState(userId, storage);
  if (state.count >= WHATS_NEW_MAX_SHOWS) return false;
  if (state.lastShownAt > 0 && (now - state.lastShownAt) < WHATS_NEW_MIN_INTERVAL_MS) {
    return false;
  }
  return true;
}

/** Increment display count and record timestamp when the modal opens. */
export function recordWhatsNewShown(userId, now = Date.now(), storage = null) {
  if (!userId) return null;
  const prev = readWhatsNewState(userId, storage);
  const next = {
    count: Math.min(WHATS_NEW_MAX_SHOWS, prev.count + 1),
    lastShownAt: now,
  };
  writeWhatsNewState(userId, next, storage);
  return next;
}

/** Refresh lastShownAt on close so the 3-hour cooldown also applies after dismissal. */
export function recordWhatsNewDismissed(userId, now = Date.now(), storage = null) {
  if (!userId) return null;
  const prev = readWhatsNewState(userId, storage);
  const next = {
    count: Math.min(WHATS_NEW_MAX_SHOWS, Math.max(1, prev.count)),
    lastShownAt: now,
  };
  writeWhatsNewState(userId, next, storage);
  return next;
}

export class WhatsNewModal {
  constructor({ onDismiss } = {}) {
    this.onDismiss = onDismiss;
    this._closed = false;
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.dismiss();
      }
    };
    this._build();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
    }
  }

  _build() {
    const items = WHATS_NEW_HIGHLIGHTS.map((item) => h('div', { class: 'wn-item' },
      h('div', {
        class: 'wn-item-icon',
        style: { '--wn-item-color': item.color, '--wn-item-bg': item.bg },
        'aria-hidden': 'true',
      }, icon(item.icon)),
      h('div', { class: 'wn-item-text' },
        h('h3', { class: 'wn-item-title' }, item.title),
        h('p', { class: 'wn-item-desc' }, item.description))));

    this.ctaBtn = h('button', {
      type: 'button',
      class: 'wn-cta',
      onClick: () => this.dismiss(),
    }, 'Los geht’s');

    this.closeBtn = h('button', {
      type: 'button',
      class: 'wn-close-btn',
      'aria-label': 'Schließen',
      title: 'Schließen',
      onClick: () => this.dismiss(),
    }, icon('mdi:close'));

    this.el = h('div', {
      class: 'overlay wn-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'wn-dialog-title',
      onClick: (e) => { if (e.target === this.el) this.dismiss(); },
    },
    h('div', { class: 'wn-dialog' },
      h('div', { class: 'wn-grabber', 'aria-hidden': 'true' }),
      this.closeBtn,
      h('div', { class: 'wn-scroll' },
        h('div', { class: 'wn-hero' },
          h('div', { class: 'wn-app-badge', 'aria-hidden': 'true' }, icon('mdi:home-automation')),
          h('h2', { id: 'wn-dialog-title', class: 'wn-title' }, 'Neu in deinem Smart Home'),
          h('p', { class: 'wn-subtitle' }, 'Räume, Geräte und Live-Werte im Überblick.')),
        h('div', { class: 'wn-features' }, ...items)),
      h('div', { class: 'wn-foot' }, this.ctaBtn)));
  }

  dismiss() {
    if (this._closed) return;
    this._closed = true;
    this.destroy();
    this.onDismiss?.();
  }

  destroy() {
    if (typeof window !== 'undefined' && this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
    }
    this.el?.remove();
  }
}
