// Rich Entity Picker for Companion Dashboard (native Home Assistant style).
// Replaces plain text inputs with an interactive searchbox, entity icons, friendly names, and live states.
import { h, icon, domainOf, entityIcon, stateLabel, resolveColor } from '../lib/util.js';

export class EntityPicker {
  /**
   * @param {{
   *   hass: object,
   *   value: string,
   *   onChange: (entityId: string) => void,
   *   filter?: (entityId: string, stateObj: object) => boolean,
   *   domain?: string | string[],
   *   placeholder?: string,
   *   allowClear?: boolean,
   * }} opts
   */
  constructor({ hass, value = '', onChange, filter, domain, placeholder = 'Entität suchen...', allowClear = true }) {
    this.hass = hass;
    this.value = value || '';
    this.onChange = onChange;
    this.filter = filter;
    this.domains = domain ? (Array.isArray(domain) ? domain : [domain]) : null;
    this.placeholder = placeholder;
    this.allowClear = allowClear;

    this.isOpen = false;
    this.searchQuery = '';
    this.selectedDomain = 'all';

    // If running in Home Assistant and <ha-entity-picker> is defined, use the native component
    if (typeof customElements !== 'undefined' && customElements.get('ha-entity-picker')) {
      const el = document.createElement('ha-entity-picker');
      el.hass = hass;
      el.value = this.value;
      el.label = placeholder;
      if (this.domains) el.includeDomains = this.domains;
      if (this.filter && typeof this.filter === 'function') el.entityFilter = this.filter;
      el.allowCustomEntity = true;
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

    this._onDocClick = (e) => {
      if (!this.el.contains(e.target)) this._close();
    };

    this._buildCustom();
  }

  _buildCustom() {
    this.boxIcon = h('div', { class: 'ep-icon' });
    this.boxTitle = h('div', { class: 'ep-title' });
    this.boxSub = h('div', { class: 'ep-sub' });
    this.boxContent = h('div', { class: 'ep-content' }, this.boxTitle, this.boxSub);

    this.clearBtn = h('button', {
      type: 'button', class: 'ep-clear', 'aria-label': 'Löschen',
      onClick: (e) => { e.stopPropagation(); this._setValue(''); },
    }, icon('mdi:close'));

    this.chevron = icon('mdi:chevron-down', 'ep-chevron');

    this.box = h('div', {
      class: 'ep-box', tabindex: '0', role: 'combobox', 'aria-expanded': 'false',
      onClick: () => this._toggle(),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); }
        else if (e.key === 'Escape') { this._close(); }
      },
    }, this.boxIcon, this.boxContent, this.clearBtn, this.chevron);

    // Dropdown popover
    this.searchInput = h('input', {
      type: 'text', placeholder: 'Suchen nach Name oder ID...',
      onInput: (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this._updateList(); },
      onKeydown: (e) => {
        if (e.key === 'Escape') this._close();
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._focusFirstItem(); }
      },
    });

    this.searchRow = h('div', { class: 'ep-search' }, icon('mdi:magnify'), this.searchInput);
    this.chipsRow = h('div', { class: 'ep-chips' });
    this.listEl = h('div', { class: 'ep-list' });

    this.dropdown = h('div', { class: 'ep-dropdown', hidden: true },
      this.searchRow,
      this.chipsRow,
      this.listEl);

    this.el = h('div', { class: 'entity-picker' }, this.box, this.dropdown);

    this._updateBox();
  }

  _setValue(val) {
    this.value = val;
    this._updateBox();
    this.onChange?.(val);
    this._close();
  }

  _updateBox() {
    const st = this.value ? this.hass?.states?.[this.value] : null;
    const hasVal = !!this.value;

    this.clearBtn.hidden = !hasVal || !this.allowClear;

    if (hasVal) {
      const name = st?.attributes?.friendly_name || this.value;
      const ic = entityIcon(this.value, st);
      this.boxIcon.replaceChildren(icon(ic));
      this.boxTitle.textContent = name;
      this.boxSub.textContent = this.value;
      this.boxSub.hidden = false;
    } else {
      this.boxIcon.replaceChildren(icon('mdi:magnify'));
      this.boxTitle.textContent = this.placeholder;
      this.boxSub.textContent = '';
      this.boxSub.hidden = true;
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
    this.box.setAttribute('aria-expanded', 'true');
    this.searchQuery = '';
    this.searchInput.value = '';
    this._renderDomainChips();
    this._updateList();

    this.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    this.box.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this._onDocClick);
  }

  _getAvailableEntities() {
    const states = this.hass?.states || {};
    const entries = [];

    for (const [entityId, st] of Object.entries(states)) {
      const d = domainOf(entityId);
      if (this.domains && !this.domains.includes(d)) continue;
      if (this.filter && !this.filter(entityId, st)) continue;
      entries.push({ entityId, st, domain: d });
    }

    return entries;
  }

  _renderDomainChips() {
    const all = this._getAvailableEntities();
    const domainCounts = new Map();
    for (const { domain } of all) {
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }

    if (domainCounts.size <= 1) {
      this.chipsRow.hidden = true;
      return;
    }
    this.chipsRow.hidden = false;

    const chips = [['all', `Alle (${all.length})`]];
    for (const [dom, count] of Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      chips.push([dom, `${dom} (${count})`]);
    }

    this.chipsRow.replaceChildren(...chips.map(([id, label]) => h('button', {
      type: 'button', class: 'filter-chip', ...(id === this.selectedDomain ? { 'data-active': '' } : {}),
      onClick: () => {
        this.selectedDomain = id;
        this._renderDomainChips();
        this._updateList();
      },
    }, label)));
  }

  _updateList() {
    const all = this._getAvailableEntities();
    const q = this.searchQuery;
    const dom = this.selectedDomain;

    const filtered = all.filter(({ entityId, st, domain }) => {
      if (dom !== 'all' && domain !== dom) return false;
      if (!q) return true;
      const fn = (st?.attributes?.friendly_name || '').toLowerCase();
      return entityId.toLowerCase().includes(q) || fn.includes(q);
    });

    if (!filtered.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty', style: { padding: '24px 12px' } },
        icon('mdi:file-search-outline'),
        h('div', { style: { fontSize: '12px', marginTop: '4px' } }, 'Keine passenden Entitäten gefunden')));
      return;
    }

    // Sort: selected item on top, then alphabetical by friendly name
    filtered.sort((a, b) => {
      if (a.entityId === this.value) return -1;
      if (b.entityId === this.value) return 1;
      const an = a.st?.attributes?.friendly_name || a.entityId;
      const bn = b.st?.attributes?.friendly_name || b.entityId;
      return an.localeCompare(bn);
    });

    // Limit to 100 items to guarantee instant zero-lag rendering
    this.listEl.replaceChildren(...filtered.slice(0, 100).map(({ entityId, st }) => {
      const isSel = entityId === this.value;
      const name = st?.attributes?.friendly_name || entityId;
      const ic = entityIcon(entityId, st);
      const stateTxt = stateLabel(this.hass, st);

      const item = h('div', {
        class: 'ep-item', ...(isSel ? { 'data-active': '' } : {}),
        tabindex: '0', role: 'option', 'aria-selected': String(isSel),
        onClick: () => this._setValue(entityId),
        onKeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); this._setValue(entityId); }
        },
      },
      icon(ic),
      h('div', { class: 'ep-content' },
        h('div', { class: 'ep-title' }, name),
        h('div', { class: 'ep-sub' }, entityId)),
      stateTxt ? h('span', { class: 'item-state' }, stateTxt) : null,
      isSel ? icon('mdi:check', 'ep-check') : null);
      return item;
    }));
  }

  _focusFirstItem() {
    this.listEl.querySelector('.ep-item')?.focus();
  }
}
