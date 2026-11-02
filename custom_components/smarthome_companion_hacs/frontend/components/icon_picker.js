import { h, icon, POPULAR_ICONS } from '../lib/util.js';

export class IconPicker {
  /**
   * @param {{
   *   value: string,
   *   onChange: (iconName: string) => void,
   *   placeholder?: string,
   * }} opts
   */
  constructor({ hass, value = '', onChange, placeholder = 'mdi:...' }) {
    this.hass = hass;
    this.value = value || '';
    this.onChange = onChange;
    this.placeholder = placeholder;

    // Use native Home Assistant <ha-icon-picker> when running inside HA
    if (typeof customElements !== 'undefined' && customElements.get('ha-icon-picker')) {
      const el = document.createElement('ha-icon-picker');
      if (hass) el.hass = hass;
      el.value = this.value;
      el.label = placeholder || 'Icon';
      el.style.width = '100%';
      el.style.display = 'block';
      el.addEventListener('value-changed', (e) => {
        const val = e.detail?.value ?? '';
        this.value = val;
        this.onChange?.(val);
      });
      this.el = el;
      return;
    }

    this.isOpen = false;
    this.searchQuery = '';

    this._onDocClick = (e) => {
      if (!this.el.contains(e.target)) this._close();
    };

    this._buildCustom();
  }

  _buildCustom() {
    this.previewIcon = h('div', { class: 'ip-preview' });
    this.textInput = h('input', {
      type: 'text',
      class: 'ip-input',
      value: this.value,
      placeholder: this.placeholder,
      onInput: (e) => {
        this.value = e.target.value.trim();
        this._updatePreview();
        this.onChange?.(this.value);
      },
      onFocus: () => this._open(),
    });

    this.toggleBtn = h('button', {
      type: 'button',
      class: 'ip-toggle',
      'aria-label': 'Icon auswählen',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    }, icon('mdi:magnify'));

    this.box = h('div', { class: 'ip-box' }, this.previewIcon, this.textInput, this.toggleBtn);

    // Dropdown popover
    this.searchInput = h('input', {
      type: 'text',
      class: 'ip-search-input',
      placeholder: 'Icon suchen (z. B. Lampe, Jalousie, TV)...',
      onInput: (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this._renderGrid();
    this.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    const ic = this.value || 'mdi:help-circle-outline';
    this.previewIcon.replaceChildren(icon(ic));
  }

  _toggle() {
    if (this.isOpen) this._close();
    else this._open();
  }

  _open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.dropdown.hidden = false;
    this.box.dataset.open = '';
    this.searchQuery = '';
    this.searchInput.value = '';
    this._renderGrid();
    this.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => {
      this.searchInput.focus();
      document.addEventListener('pointerdown', this._onDocClick);
    }, 20);
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
    const filtered = POPULAR_ICONS.filter((item) => {
      if (!q) return true;
      return item.icon.toLowerCase().includes(q)
        || item.name.toLowerCase().includes(q)
        || item.cat.toLowerCase().includes(q);
    });

    if (!filtered.length) {
      this.grid.replaceChildren(h('div', { class: 'ip-empty' },
        h('div', {}, 'Kein passendes Vorschlags-Icon gefunden'),
        h('div', { class: 'hint', style: { fontSize: '11px', marginTop: '4px' } }, `„${this.value || q}“ kann direkt im Textfeld eingetragen werden.`)));
      return;
    }

    this.grid.replaceChildren(...filtered.map((item) => {
      const isSel = this.value === item.icon;
      return h('button', {
        type: 'button',
        class: `ip-chip${isSel ? ' active' : ''}`,
        title: `${item.name} (${item.icon})`,
        onClick: (e) => { e.stopPropagation(); this._setValue(item.icon); },
      },
      icon(item.icon),
      h('span', { class: 'ip-chip-name' }, item.name));
    }));
  }
}
