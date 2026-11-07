// Rich Icon Picker for Companion Dashboard (Shadow-DOM safe, instant visual search).
import { h, icon, POPULAR_ICONS } from '../lib/util.js?v=2.8.22';

export class IconPicker {
  constructor({ hass, value = '', onChange, placeholder = 'mdi:...' }) {
    this.hass = hass;
    this.value = value || '';
    this.onChange = onChange;
    this.placeholder = placeholder;
    this.isOpen = false;
    this.searchQuery = '';

    this._onDocClick = (e) => {
      if (!e.composedPath().includes(this.el)) this._close();
    };

    this._build();
  }

  _build() {
    this.previewIcon = h('div', { class: 'ip-preview', onClick: (e) => { e.stopPropagation(); this._toggle(); } });
    this.textInput = h('input', {
      type: 'text',
      class: 'ip-input',
      value: this.value,
      placeholder: this.placeholder,
      onInput: (e) => {
        const raw = e.target.value.trim();
        this.value = raw;
        this.searchQuery = raw.replace(/^mdi:/i, '').toLowerCase();
        this._updatePreview();
        if (!this.isOpen) this._open(false);
        else this._renderGrid();
        this.onChange?.(this.value);
      },
      onFocus: () => this._open(false),
    });

    this.toggleBtn = h('button', {
      type: 'button',
      class: 'ip-toggle',
      'aria-label': 'Icon auswählen',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    }, icon('mdi:chevron-down'));

    this.box = h('div', { class: 'ip-box' }, this.previewIcon, this.textInput, this.toggleBtn);

    this.searchInput = h('input', {
      type: 'text',
      class: 'ip-search-input',
      placeholder: 'Icon suchen (z. B. Lampe, Jalousie, TV, Müll)...',
      onInput: (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this._renderGrid();
      },
    });
    this.searchRow = h('div', { class: 'ip-search-row' }, icon('mdi:magnify'), this.searchInput);
    this.grid = h('div', { class: 'ip-grid' });
    this.dropdown = h('div', { class: 'ip-dropdown', hidden: true }, this.searchRow, this.grid);

    this.el = h('div', { class: 'icon-picker' }, this.box, this.dropdown);
    this._updatePreview();
  }

  _setValue(val) {
    this.value = val;
    this.textInput.value = val;
    this._updatePreview();
    this.onChange?.(val);
    this._close();
  }

  _updatePreview() {
    const ic = this.value && this.value.includes(':') ? this.value : 'mdi:star-four-points-outline';
    this.previewIcon.replaceChildren(icon(ic));
  }

  _toggle() {
    if (this.isOpen) this._close();
    else this._open(true);
  }

  _open(focusSearch = true) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.dropdown.hidden = false;
    this.box.dataset.open = '';
    this.searchQuery = '';
    this.searchInput.value = '';
    this._renderGrid();
    setTimeout(() => {
      if (focusSearch) this.searchInput.focus();
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
    const filtered = POPULAR_ICONS.filter(([ic, label, tags]) => {
      if (!q) return true;
      return ic.toLowerCase().includes(q) || label.toLowerCase().includes(q) || (tags && tags.toLowerCase().includes(q));
    });

    const items = filtered.map(([ic, label]) => {
      const isSel = this.value === ic;
      return h('button', {
        type: 'button',
        class: `ip-chip${isSel ? ' active' : ''}`,
        title: `${label} (${ic})`,
        onClick: (e) => { e.stopPropagation(); this._setValue(ic); },
      }, icon(ic), h('span', { class: 'ip-chip-name' }, label));
    });

    if (q && !q.startsWith('mdi:')) {
      const customMdi = `mdi:${q.replace(/\s+/g, '-')}`;
      if (!filtered.some(([ic]) => ic === customMdi)) {
        items.unshift(h('button', {
          type: 'button',
          class: 'ip-chip',
          title: customMdi,
          onClick: (e) => { e.stopPropagation(); this._setValue(customMdi); },
        }, icon(customMdi), h('span', { class: 'ip-chip-name' }, customMdi)));
      }
    }

    if (!items.length) {
      this.grid.replaceChildren(h('div', { class: 'ip-empty' }, 'Kein Icon gefunden – direkt „mdi:name“ oben eingeben'));
      return;
    }

    this.grid.replaceChildren(...items);
  }
}
