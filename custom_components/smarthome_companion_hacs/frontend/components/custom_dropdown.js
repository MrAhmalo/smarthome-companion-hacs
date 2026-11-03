// CustomDropdown: beautiful bespoke select component replacing native browser <select>.
// Features: custom styling, icons, color dots, optional search, keyboard & click-outside handling.
import { h, icon } from '../lib/util.js';

export class CustomDropdown {
  /**
   * @param {{
   *   options: Array<{value: string, label: string, icon?: string, color?: string, sub?: string}>,
   *   value: string,
   *   placeholder?: string,
   *   disabled?: boolean,
   *   searchable?: boolean,
   *   onChange: (val: string) => void
   * }} opts
   */
  constructor({ options, value, placeholder = 'Bitte wählen...', disabled = false, searchable, onChange }) {
    this.options = options || [];
    this.value = value || '';
    this.placeholder = placeholder;
    this.disabled = disabled;
    this.searchable = searchable !== undefined ? searchable : this.options.length > 5;
    this.onChange = onChange;
    this.isOpen = false;
    this.searchQuery = '';

    this._onDocClick = (e) => {
      if (!this.isOpen) return;
      if (!e.composedPath().includes(this.el)) {
        this.close();
      }
    };
    document.addEventListener('click', this._onDocClick);

    this._build();
  }

  destroy() {
    document.removeEventListener('click', this._onDocClick);
  }

  setDisabled(disabled) {
    this.disabled = !!disabled;
    this.box.classList.toggle('disabled', this.disabled);
    if (this.disabled) this.close();
  }

  setValue(val) {
    this.value = val;
    this._updateSelected();
  }

  setOptions(opts) {
    this.options = opts || [];
    this.searchable = this.options.length > 5;
    this._updateSelected();
    if (this.isOpen) this._renderMenu();
  }

  _build() {
    this.iconEl = h('div', { class: 'cdd-icon', hidden: true });
    this.textEl = h('div', { class: 'cdd-text' }, this.placeholder);
    this.chevron = icon('mdi:chevron-down', 'cdd-chevron');

    this.box = h('div', {
      class: `cdd-box${this.disabled ? ' disabled' : ''}`,
      role: 'combobox',
      tabindex: this.disabled ? '-1' : '0',
      'aria-expanded': 'false',
      onClick: (e) => {
        e.stopPropagation();
        if (this.disabled) return;
        this.toggle();
      },
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggle();
        } else if (e.key === 'Escape') {
          this.close();
        }
      },
    }, this.iconEl, this.textEl, this.chevron);

    this.menu = h('div', { class: 'cdd-menu', hidden: true });

    this.el = h('div', { class: 'custom-dropdown' }, this.box, this.menu);
    this._updateSelected();
  }

  _updateSelected() {
    const sel = this.options.find((o) => o.value === this.value);
    if (sel) {
      this.textEl.textContent = sel.label;
      this.textEl.classList.remove('placeholder');
      if (sel.icon) {
        this.iconEl.replaceChildren(icon(sel.icon));
        if (sel.color) this.iconEl.style.color = sel.color;
        else this.iconEl.style.color = '';
        this.iconEl.hidden = false;
      } else if (sel.color) {
        const dot = h('span', { class: 'cdd-dot', style: { background: sel.color } });
        this.iconEl.replaceChildren(dot);
        this.iconEl.hidden = false;
      } else {
        this.iconEl.hidden = true;
      }
    } else {
      this.textEl.textContent = this.placeholder;
      this.textEl.classList.add('placeholder');
      this.iconEl.hidden = true;
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.disabled || this.isOpen) return;
    this.isOpen = true;
    this.box.dataset.open = '';
    this.box.setAttribute('aria-expanded', 'true');
    this.menu.hidden = false;
    this.searchQuery = '';
    this._renderMenu();

    if (this.searchInput) {
      setTimeout(() => this.searchInput.focus(), 50);
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    delete this.box.dataset.open;
    this.box.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
  }

  _renderMenu() {
    const q = this.searchQuery.toLowerCase().trim();
    const filtered = q
      ? this.options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub && o.sub.toLowerCase().includes(q)))
      : this.options;

    const items = [];

    if (this.searchable) {
      this.searchInput = h('input', {
        type: 'text',
        class: 'cdd-search-input',
        placeholder: 'Suchen...',
        value: this.searchQuery,
        onClick: (e) => e.stopPropagation(),
        onInput: (e) => {
          this.searchQuery = e.target.value;
          this._renderMenu();
        },
      });
      const searchRow = h('div', { class: 'cdd-search-row' }, icon('mdi:magnify'), this.searchInput);
      items.push(searchRow);
    }

    const list = h('div', { class: 'cdd-list' });

    if (!filtered.length) {
      list.append(h('div', { class: 'cdd-empty' }, 'Keine Optionen gefunden'));
    } else {
      for (const opt of filtered) {
        const isSelected = opt.value === this.value;
        const iconWrap = h('div', { class: 'cdd-item-icon' });
        if (opt.icon) {
          iconWrap.append(icon(opt.icon));
          if (opt.color) iconWrap.style.color = opt.color;
        } else if (opt.color) {
          iconWrap.append(h('span', { class: 'cdd-dot', style: { background: opt.color } }));
        } else {
          iconWrap.style.display = 'none';
        }

        const labelWrap = h('div', { class: 'cdd-item-texts' },
          h('div', { class: 'cdd-item-label' }, opt.label),
          opt.sub ? h('div', { class: 'cdd-item-sub' }, opt.sub) : null);

        const checkWrap = h('div', { class: 'cdd-item-check' });
        if (isSelected) checkWrap.append(icon('mdi:check'));

        const item = h('div', {
          class: `cdd-item${isSelected ? ' selected' : ''}`,
          onClick: (e) => {
            e.stopPropagation();
            this.value = opt.value;
            this._updateSelected();
            this.close();
            this.onChange?.(opt.value);
          },
        }, iconWrap, labelWrap, checkWrap);

        list.append(item);
      }
    }

    items.push(list);
    this.menu.replaceChildren(...items);
  }
}
