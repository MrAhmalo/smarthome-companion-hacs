import { h, icon, COLORS, COLOR_NAMES, COLOR_LABELS_DE, resolveColor } from '../lib/util.js?v=2.8.20';

export class ColorPicker {
  /**
   * @param {{
   *   value: string,
   *   onChange: (colorName: string) => void,
   *   label?: string,
   *   allowAuto?: boolean,
   * }} opts
   */
  constructor({ value = '', onChange, label = 'Farbe', allowAuto = true }) {
    this.value = value || '';
    this.onChange = onChange;
    this.label = label;
    this.allowAuto = allowAuto;
    this.isOpen = false;

    this._onDocClick = (e) => {
      if (!e.composedPath().includes(this.el)) this._close();
    };

    this._build();
  }

  _build() {
    this.swatchDot = h('span', { class: 'cp-dot' });
    this.labelEl = h('span', { class: 'cp-label' });
    this.chevron = icon('mdi:chevron-down', 'cp-chevron');

    this.box = h('button', {
      type: 'button',
      class: 'cp-box',
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
    }, this.swatchDot, this.labelEl, this.chevron);

    this.optionsList = h('div', { class: 'cp-list' });
    this.dropdown = h('div', { class: 'cp-dropdown', hidden: true }, this.optionsList);

    this.el = h('div', { class: 'color-picker' }, this.box, this.dropdown);
    this._updateBox();
  }

  _setValue(val) {
    this.value = val;
    this._updateBox();
    this.onChange?.(val);
    this._close();
  }

  _updateBox() {
    const hex = resolveColor(this.value);
    const label = COLOR_LABELS_DE[this.value] || this.value || 'Automatisch';
    this.labelEl.textContent = label;
    if (hex) {
      this.swatchDot.style.background = hex;
      this.swatchDot.style.boxShadow = `0 0 8px ${hex}88`;
    } else {
      this.swatchDot.style.background = 'var(--cd-accent)';
      this.swatchDot.style.boxShadow = 'none';
    }
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
    this._renderOptions();
    
    setTimeout(() => document.addEventListener('pointerdown', this._onDocClick), 20);
  }

  _close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.dropdown.hidden = true;
    delete this.box.dataset.open;
    document.removeEventListener('pointerdown', this._onDocClick);
  }

  _renderOptions() {
    const list = [];
    if (this.allowAuto) {
      list.push(['', 'Automatisch', 'var(--cd-accent)']);
    }
    for (const name of COLOR_NAMES) {
      list.push([name, COLOR_LABELS_DE[name] || name, COLORS[name]]);
    }

    this.optionsList.replaceChildren(...list.map(([val, label, hex]) => {
      const isSel = (this.value || '') === val;
      const dot = h('span', { class: 'cp-dot', style: { background: hex } });
      const name = h('span', { class: 'cp-opt-name' }, label);
      const chk = isSel ? icon('mdi:check', 'cp-check') : null;
      return h('div', {
        class: 'cp-item', ...(isSel ? { 'data-active': '' } : {}),
        onClick: (e) => { e.stopPropagation(); this._setValue(val); },
      }, dot, name, chk);
    }));
  }
}
