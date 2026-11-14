// Rich Icon Picker for Companion Dashboard (HA-style single-input search across all MDI icons).
import { h, icon, POPULAR_ICONS, positionFloatingMenu } from '../lib/util.js';

let _mdiCatalog = null;
let _mdiLoadPromise = null;

function _buildBaseCatalog(hass) {
  const seen = new Set();
  const list = [];

  for (const item of POPULAR_ICONS) {
    const ic = typeof item === 'string' ? item : item?.icon;
    if (!ic || seen.has(ic)) continue;
    seen.add(ic);
    const label = (typeof item === 'object' && item?.name) ? item.name : ic.replace(/^mdi:/, '');
    const tags = (typeof item === 'object' && item?.cat) ? item.cat.toLowerCase() : '';
    list.push({ icon: ic, label, search: `${ic} ${label} ${tags}`.toLowerCase() });
  }

  if (hass?.states) {
    for (const st of Object.values(hass.states)) {
      const ic = st?.attributes?.icon;
      if (typeof ic === 'string' && ic.startsWith('mdi:') && !seen.has(ic)) {
        seen.add(ic);
        const slug = ic.slice(4);
        list.push({ icon: ic, label: slug, search: ic.toLowerCase() });
      }
    }
  }

  return { seen, list };
}

async function _loadFullMdiCatalog(hass) {
  if (_mdiCatalog) return _mdiCatalog;
  if (_mdiLoadPromise) return _mdiLoadPromise;

  _mdiLoadPromise = (async () => {
    const { seen, list } = _buildBaseCatalog(hass);
    try {
      const resp = await fetch('/static/mdi/iconList.json', { credentials: 'same-origin' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          for (const entry of data) {
            const rawName = typeof entry === 'string' ? entry : entry?.name;
            if (!rawName) continue;
            const ic = rawName.startsWith('mdi:') ? rawName : `mdi:${rawName}`;
            if (seen.has(ic)) continue;
            seen.add(ic);
            const slug = ic.slice(4);
            const kw = Array.isArray(entry?.keywords) ? entry.keywords.join(' ') : '';
            list.push({
              icon: ic,
              label: slug,
              search: `${ic} ${kw}`.toLowerCase(),
            });
          }
        }
      }
    } catch (_) {
      // Offline / dev mock fallback: base catalog + HA state icons already loaded
    }
    _mdiCatalog = list;
    return _mdiCatalog;
  })();

  return _mdiLoadPromise;
}

const INITIAL_BATCH_SIZE = 160;
const SCROLL_BATCH_SIZE = 160;

function _buildPriorityEntries(priorityIcons) {
  if (!Array.isArray(priorityIcons) || !priorityIcons.length) return [];
  const entries = [];
  const seen = new Set();
  for (const item of priorityIcons) {
    const ic = typeof item === 'string' ? item : (item?.icon || item?.value);
    if (!ic || seen.has(ic)) continue;
    seen.add(ic);
    const label = (typeof item === 'object' && (item?.label || item?.name))
      ? (item.label || item.name)
      : ic.replace(/^mdi:/, '');
    const tags = (typeof item === 'object' && item?.cat) ? item.cat.toLowerCase() : '';
    entries.push({ icon: ic, label, search: `${ic} ${label} ${tags}`.toLowerCase() });
  }
  return entries;
}

export class IconPicker {
  constructor({ hass, value = '', onChange, placeholder = 'Icon suchen', priorityIcons = null }) {
    this.hass = hass;
    this.value = value || '';
    this.onChange = onChange;
    this.placeholder = placeholder;
    this.priorityEntries = _buildPriorityEntries(priorityIcons);
    this.isOpen = false;
    this.searchQuery = '';
    this._catalog = _mdiCatalog || _buildBaseCatalog(hass).list;
    this._filteredCatalog = [];
    this._renderedCount = 0;

    this._onDocClick = (e) => {
      const path = e.composedPath?.() || [];
      if (!path.includes(this.el) && !path.includes(this.dropdown)) this._close();
    };

    this._build();

    // Preload full HA MDI catalog in background
    _loadFullMdiCatalog(this.hass).then((catalog) => {
      this._catalog = catalog;
      if (this.isOpen) this._renderGrid();
    });
  }

  _build() {
    this.previewIcon = h('div', {
      class: 'ip-preview',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    });

    this.textInput = h('input', {
      type: 'text',
      class: 'ip-input',
      value: this.value,
      placeholder: this.placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
      onInput: (e) => {
        const raw = e.target.value.trim();
        this.value = raw;
        this.searchQuery = raw.replace(/^mdi:/i, '').toLowerCase();
        this._updatePreview();
        this._updateClearBtn();
        if (!this.isOpen) this._open(false);
        else this._renderGrid();
        this.onChange?.(this.value);
      },
      onFocus: () => {
        if (!this.isOpen) {
          this.searchQuery = '';
          this._open(true);
        }
      },
      onClick: (e) => {
        e.stopPropagation();
        if (!this.isOpen) {
          this.searchQuery = '';
          this._open(false);
        }
      },
    });

    this.clearBtn = h('button', {
      type: 'button',
      class: 'ip-clear',
      'aria-label': 'Löschen',
      title: 'Löschen',
      hidden: !this.value,
      onClick: (e) => {
        e.stopPropagation();
        this.value = '';
        this.textInput.value = '';
        this.searchQuery = '';
        this._updatePreview();
        this._updateClearBtn();
        this.onChange?.('');
        if (!this.isOpen) this._open(false);
        else this._renderGrid();
        if (window.matchMedia?.('(pointer: fine)').matches) this.textInput.focus();
      },
    }, icon('mdi:close'));

    this.toggleBtn = h('button', {
      type: 'button',
      class: 'ip-toggle',
      'aria-label': 'Icon auswählen',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    }, icon('mdi:chevron-down'));

    this.box = h('div', { class: 'ip-box' }, this.previewIcon, this.textInput, this.clearBtn, this.toggleBtn);

    this.grid = h('div', {
      class: 'ip-grid',
      onScroll: () => this._onGridScroll(),
    });
    this.dropdown = h('div', { class: 'ip-dropdown', hidden: true }, this.grid);

    this.el = h('div', { class: 'icon-picker' }, this.box, this.dropdown);
    this._updatePreview();
  }

  _updateClearBtn() {
    this.clearBtn.hidden = !this.textInput.value;
  }

  _setValue(val) {
    this.value = val;
    this.textInput.value = val;
    this._updatePreview();
    this._updateClearBtn();
    this.onChange?.(val);
    this._close();
  }

  _updatePreview() {
    const ic = this.value && this.value.includes(':') ? this.value : 'mdi:star-four-points-outline';
    this.previewIcon.replaceChildren(icon(ic));
  }

  _toggle() {
    if (this.isOpen) this._close();
    else {
      this.searchQuery = '';
      this._open(true);
    }
  }

  _open(selectInput = false) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.dropdown.hidden = false;
    this.box.dataset.open = '';
    this._renderGrid();
    this._portalCleanup?.();
    this._portalCleanup = positionFloatingMenu(this.box, this.dropdown, {
      minWidth: 260,
      maxHeight: 280,
      matchWidth: true,
    });
    setTimeout(() => {
      if (selectInput && window.matchMedia?.('(pointer: fine)').matches) {
        this.textInput.focus();
        if (this.textInput.value) this.textInput.select();
      }
      document.addEventListener('pointerdown', this._onDocClick);
    }, 10);
  }

  _close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._portalCleanup?.();
    this._portalCleanup = null;
    this.dropdown.hidden = true;
    delete this.box.dataset.open;
    document.removeEventListener('pointerdown', this._onDocClick);
  }

  destroy() {
    this._close();
    this._portalCleanup?.();
    this._portalCleanup = null;
    document.removeEventListener('pointerdown', this._onDocClick);
  }

  _getCatalog() {
    if (!this.priorityEntries.length) return this._catalog;
    const priorityMap = new Map(this.priorityEntries.map((e) => [e.icon, e]));
    const merged = this.priorityEntries.map((prio) => {
      const catEntry = this._catalog.find((c) => c.icon === prio.icon);
      if (!catEntry) return prio;
      return {
        icon: prio.icon,
        label: prio.label,
        search: `${prio.search} ${catEntry.search}`.trim(),
      };
    });
    for (const entry of this._catalog) {
      if (!priorityMap.has(entry.icon)) merged.push(entry);
    }
    return merged;
  }

  _makeChip(entry, customLabel = null) {
    const isSel = this.value === entry.icon;
    const label = customLabel ?? entry.label;
    return h('button', {
      type: 'button',
      class: `ip-chip${isSel ? ' active' : ''}`,
      title: `${label} (${entry.icon})`,
      onClick: (e) => { e.stopPropagation(); this._setValue(entry.icon); },
    }, icon(entry.icon), h('span', { class: 'ip-chip-name' }, label));
  }

  _onGridScroll() {
    if (this._renderedCount >= this._filteredCatalog.length) return;
    const { scrollTop, clientHeight, scrollHeight } = this.grid;
    if (scrollTop + clientHeight >= scrollHeight - 240) {
      this._appendBatch(SCROLL_BATCH_SIZE);
    }
  }

  _appendBatch(count) {
    const total = this._filteredCatalog.length;
    if (this._renderedCount >= total) return;
    const nextEnd = Math.min(this._renderedCount + count, total);
    const frag = document.createDocumentFragment();
    for (let i = this._renderedCount; i < nextEnd; i++) {
      frag.appendChild(this._makeChip(this._filteredCatalog[i]));
    }
    this._renderedCount = nextEnd;
    this.grid.appendChild(frag);
  }

  _renderGrid() {
    const q = this.searchQuery;
    const catalog = this._getCatalog();
    const filtered = q
      ? catalog.filter((entry) => entry.search.includes(q))
      : catalog;

    this._filteredCatalog = filtered;
    this._renderedCount = 0;
    this.grid.scrollTop = 0;

    if (!filtered.length) {
      if (q) {
        const slug = q.replace(/^mdi:/i, '').replace(/\s+/g, '-');
        const customMdi = `mdi:${slug}`;
        this.grid.replaceChildren(
          this._makeChip({ icon: customMdi, label: customMdi }, customMdi)
        );
        return;
      }
      this.grid.replaceChildren(h('div', { class: 'ip-empty' }, 'Keine Icons'));
      return;
    }

    this.grid.replaceChildren();
    // When searching, render up to 240 immediately and stream the rest seamlessly on scroll
    // so every matching available icon can be browsed without lag.
    this._appendBatch(q ? 240 : INITIAL_BATCH_SIZE);
  }
}
