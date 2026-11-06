// Rich Entity Picker for Companion Dashboard (Shadow-DOM safe, instant autocomplete).
import { h, icon, domainOf, entityIcon, stateLabel } from '../lib/util.js?v=2.8.18';

const DOMAIN_LABELS_DE = {
  light: 'Lichter', switch: 'Schalter', sensor: 'Sensoren', binary_sensor: 'Binär',
  cover: 'Jalousien', media_player: 'Medien', climate: 'Klima', script: 'Skripte',
  scene: 'Szenen', input_boolean: 'Helfer', calendar: 'Kalender', device_tracker: 'Tracker',
  person: 'Personen', weather: 'Wetter', fan: 'Lüfter', valve: 'Ventile',
};

export class EntityPicker {
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

    // Use composedPath() so Shadow DOM retargeting never closes the dropdown on inner clicks
    this._onDocClick = (e) => {
      if (!e.composedPath().includes(this.el)) this._close();
    };

    this._build();
  }

  _build() {
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
      onClick: (e) => { e.stopPropagation(); this._toggle(); },
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); }
        else if (e.key === 'Escape') { this._close(); }
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          this._open(e.key);
        }
      },
    }, this.boxIcon, this.boxContent, this.clearBtn, this.chevron);

    // Dropdown popover
    this.searchInput = h('input', {
      type: 'text', class: 'ep-search-input', placeholder: 'Name, Raum oder entity_id eintippen...',
      onInput: (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this._updateList(); },
      onKeydown: (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); this._close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._focusFirstItem(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const first = this.listEl.querySelector('.ep-item');
          if (first) first.click();
          else if (this.searchInput.value.includes('.')) this._setValue(this.searchInput.value.trim());
        }
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
      this.boxTitle.classList.remove('ep-placeholder');
      this.boxSub.textContent = this.value;
      this.boxSub.hidden = false;
    } else {
      this.boxIcon.replaceChildren(icon('mdi:magnify'));
      this.boxTitle.textContent = this.placeholder;
      this.boxTitle.classList.add('ep-placeholder');
      this.boxSub.textContent = '';
      this.boxSub.hidden = true;
    }
  }

  _toggle() {
    if (this.isOpen) this._close();
    else this._open();
  }

  _open(initialChar = '') {
    if (this.isOpen) return;
    this.isOpen = true;
    this.dropdown.hidden = false;
    this.box.dataset.open = '';
    this.box.setAttribute('aria-expanded', 'true');
    this.searchQuery = initialChar.toLowerCase();
    this.searchInput.value = initialChar;
    this._renderDomainChips();
    this._updateList();

    setTimeout(() => {
      this.searchInput.focus();
      document.addEventListener('pointerdown', this._onDocClick);
      const rect = this.dropdown.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 30) {
        this.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
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
    for (const [dom, count] of Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      const label = DOMAIN_LABELS_DE[dom] || dom;
      chips.push([dom, `${label} (${count})`]);
    }

    this.chipsRow.replaceChildren(...chips.map(([id, label]) => h('button', {
      type: 'button', class: 'filter-chip', ...(id === this.selectedDomain ? { 'data-active': '' } : {}),
      onClick: (e) => {
        e.stopPropagation();
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
      this.listEl.replaceChildren(h('div', { class: 'empty', style: { padding: '20px 12px' } },
        icon('mdi:file-search-outline'),
        h('div', { style: { fontSize: '12px', marginTop: '4px' } }, 'Keine passenden Entitäten gefunden')));
      return;
    }

    filtered.sort((a, b) => {
      if (a.entityId === this.value) return -1;
      if (b.entityId === this.value) return 1;
      const an = (a.st?.attributes?.friendly_name || a.entityId).toLowerCase();
      const bn = (b.st?.attributes?.friendly_name || b.entityId).toLowerCase();
      if (q) {
        const aStarts = an.startsWith(q) || a.entityId.toLowerCase().startsWith(q);
        const bStarts = bn.startsWith(q) || b.entityId.toLowerCase().startsWith(q);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
      }
      return an.localeCompare(bn);
    });

    this.listEl.replaceChildren(...filtered.slice(0, 80).map(({ entityId, st }) => {
      const isSel = entityId === this.value;
      const name = st?.attributes?.friendly_name || entityId;
      const ic = entityIcon(entityId, st);
      const stateTxt = stateLabel(this.hass, st);

      return h('div', {
        class: 'ep-item', ...(isSel ? { 'data-active': '' } : {}),
        tabindex: '0', role: 'option', 'aria-selected': String(isSel),
        onClick: (e) => { e.stopPropagation(); this._setValue(entityId); },
        onKeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this._setValue(entityId); }
        },
      },
      icon(ic),
      h('div', { class: 'ep-content' },
        h('div', { class: 'ep-title' }, name),
        h('div', { class: 'ep-sub' }, entityId)),
      stateTxt ? h('span', { class: 'item-state' }, stateTxt) : null,
      isSel ? icon('mdi:check', 'ep-check') : null);
    }));
  }

  _focusFirstItem() {
    this.listEl.querySelector('.ep-item')?.focus();
  }
}
