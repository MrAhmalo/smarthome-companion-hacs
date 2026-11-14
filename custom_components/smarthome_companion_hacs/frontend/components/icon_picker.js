// Rich Icon Picker for Companion Dashboard (HA-style single-input search across all MDI icons).
import { h, icon, POPULAR_ICONS } from '../lib/util.js';

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

export class IconPicker {
  constructor({ hass, value = '', onChange, placeholder = 'Icon suchen (z. B. Lampe, mdi:bed)...' }) {
    this.hass = hass;
    this.value = value || '';
    this.onChange = onChange;
    this.placeholder = placeholder;
    this.isOpen = false;
    this.searchQuery = '';
    this._catalog = _mdiCatalog || _buildBaseCatalog(hass).list;

    this._onDocClick = (e) => {
      if (!e.composedPath().includes(this.el)) this._close();
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
          this._open(true);
        }
      },
    });

    this.clearBtn = h('button', {
      type: 'button',
      class: 'ip-clear',
      'aria-label': 'Eingabe löschen',
      title: 'Löschen & alle Icons anzeigen',
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
        this.textInput.focus();
      },
    }, icon('mdi:close'));

    this.toggleBtn = h('button', {
      type: 'button',
      class: 'ip-toggle',
      'aria-label': 'Icon auswählen',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    }, icon('mdi:chevron-down'));

    this.box = h('div', { class: 'ip-box' }, this.previewIcon, this.textInput, this.clearBtn, this.toggleBtn);

    this.statusEl = h('div', { class: 'ip-status' });
    this.grid = h('div', { class: 'ip-grid' });
    this.dropdown = h('div', { class: 'ip-dropdown', hidden: true }, this.statusEl, this.grid);

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
    setTimeout(() => {
      if (selectInput) {
        this.textInput.focus();
        if (this.textInput.value) this.textInput.select();
      }
      document.addEventListener('pointerdown', this._onDocClick);
    }, 10);
  }

  _close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.dropdown.hidden = true;
    delete this.box.dataset.open;
    document.removeEventListener('pointerdown', this._onDocClick);
  }

  _renderGrid() {
    const q = this.searchQuery;
    const filtered = q
      ? this._catalog.filter((entry) => entry.search.includes(q))
      : this._catalog;

    const maxVisible = 80;
    const visible = filtered.slice(0, maxVisible);

    if (q) {
      this.statusEl.textContent = filtered.length > maxVisible
        ? `${maxVisible} von ${filtered.length} Treffern – weiter tippen zum Eingrenzen`
        : `${filtered.length} Treffer`;
    } else {
      this.statusEl.textContent = `${this._catalog.length} Icons verfügbar · Direkt oben tippen zum Suchen`;
    }

    const items = visible.map((entry) => {
      const isSel = this.value === entry.icon;
      return h('button', {
        type: 'button',
        class: `ip-chip${isSel ? ' active' : ''}`,
        title: `${entry.label} (${entry.icon})`,
        onClick: (e) => { e.stopPropagation(); this._setValue(entry.icon); },
      }, icon(entry.icon), h('span', { class: 'ip-chip-name' }, entry.label));
    });

    if (q) {
      const customMdi = `mdi:${q.replace(/\s+/g, '-')}`;
      if (!visible.some((entry) => entry.icon === customMdi)) {
        items.unshift(h('button', {
          type: 'button',
          class: 'ip-chip',
          title: customMdi,
          onClick: (e) => { e.stopPropagation(); this._setValue(customMdi); },
        }, icon(customMdi), h('span', { class: 'ip-chip-name' }, customMdi)));
      }
    }

    if (!items.length) {
      this.grid.replaceChildren(h('div', { class: 'ip-empty' }, 'Kein Icon gefunden – direkt „mdi:name“ eingeben'));
      return;
    }

    this.grid.replaceChildren(...items);
  }
}
