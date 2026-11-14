import { h, icon, COLOR_NAMES, resolveColor, renderTrashBin, showToast, showConfirmDialog, preserveScroll } from '../lib/util.js';
import { EntityPicker } from './entity_picker.js';
import { IconPicker } from './icon_picker.js';
import { ColorPicker } from './color_picker.js';
import { CustomDropdown } from './custom_dropdown.js';
import { DEVICE_CATEGORIES, createGroupCard, createDeviceRoomSection } from './device_list.js';

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

const TAP_OPTIONS = [
  ['more-info', 'Details öffnen'], ['navigate', 'Seite öffnen'], ['service', 'Dienst ausführen'], ['none', 'Keine Aktion'],
];
const VISIBLE_OPTIONS = [
  ['always', 'Immer'], ['above', 'Wert größer als'], ['below', 'Wert kleiner als'],
  ['state_in', 'Status ist (Liste)'], ['state_not_in', 'Status ist nicht (Liste)'],
];
const EXPAND_OPTIONS = [['collapsed', 'Eingeklappt'], ['expanded', 'Ausgeklappt'], ['always', 'Immer offen']];

export class Settings {
  /**
   * @param {{hass:object, config:object, layout:object, users:Array, onClose:Function, onSaved:Function, onOpenDevice?:Function}} opts
   */
  constructor({ hass, config, layout, users, onClose, onSaved, onOpenDevice, onOpenGroup }) {
    this.hass = hass;
    this.users = users;
    this.areas = layout.areas;
    this.onClose = onClose;
    this.onSaved = onSaved;
    this.onOpenDevice = onOpenDevice;
    this.onOpenGroup = onOpenGroup;
    this.draft = clone(config);
    this.draft.rooms ||= {};

    // Local, editable copy of the room/tile structure (includes hidden tiles).
    this.rooms = layout.rooms.map((r) => ({
      area_id: r.area_id,
      name: r.name,
      tiles: r.tiles.map((t) => ({ key: t.key, name: t.name, entity_id: t.entity_id, hidden: !!t.hidden, users: [...(t.users || [])] })),
    }));

    this.tab = 'devices';
    this.tabs = [
      ['devices', 'Geräte', () => this._tabDevices()],
      ['header', 'Kopfzeile', () => this._tabHeader()],
      ['info', 'Infos & Alarme', () => this._tabInfo()],
      ['trash', 'Müll', () => this._tabTrash()],
      ['nav', 'Navigation', () => this._tabNav()],
      ['rooms', 'Räume & Kacheln', () => this._tabRooms()],
      ['extra', 'Zusatz-Kacheln', () => this._tabExtra()],
      ['colors', 'Farben', () => this._tabColors()],
    ];
    this._build();
  }

  // ═══════════ Shell ═══════════
  _track(picker) {
    (this._pickers ||= []).push(picker);
    return picker;
  }

  destroy() {
    for (const p of (this._pickers || [])) {
      try { p?.destroy?.(); } catch {}
    }
    this._pickers = [];
  }

  _close() {
    this.destroy();
    this.onClose();
  }

  _build() {
    this.body = h('div', { class: 'dialog-body' });
    this.tabBar = h('div', { class: 'tabs' });
    this.saveBtn = h('button', { class: 'btn primary', onClick: () => this._save() }, icon('mdi:content-save'), 'Speichern');
    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this._close(); } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Einstellungen' },
        h('div', { class: 'dialog-head' }, h('h2', {}, 'Einstellungen'),
          h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => this._close() }, icon('mdi:close'))),
        this.tabBar, this.body,
        h('div', { class: 'dialog-foot' },
          h('button', { class: 'btn', onClick: () => this._close() }, 'Abbrechen'), this.saveBtn)));
    this._renderTabs();
    this._renderBody();
  }

  _renderTabs() {
    this.tabBar.replaceChildren(...this.tabs.map(([id, label]) => h('button', {
      class: 'tab', ...(id === this.tab ? { 'data-active': '' } : {}),
      onClick: () => { this.tab = id; this._renderTabs(); this._renderBody(); },
    }, label)));
  }

  _renderBody(keepScroll = false) {
    const top = this.body.scrollTop;
    this.destroy();
    const render = this.tabs.find(([id]) => id === this.tab)[2];
    this.body.replaceChildren(...render());
    if (keepScroll) this.body.scrollTop = top;
  }

  async _save() {
    const config = clone(this.draft);
    config.room_order = this.rooms.map((r) => r.area_id);
    config.tile_order = {};
    config.tile_users = {};
    config.hidden_tiles = [];
    for (const room of this.rooms) {
      config.tile_order[room.area_id] = room.tiles.map((t) => t.key);
      for (const t of room.tiles) {
        if (t.hidden) config.hidden_tiles.push(t.key);
        if (t.users.length) config.tile_users[t.key] = t.users;
      }
    }
    this.saveBtn.disabled = true;
    try {
      const res = await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config });
      if (res?.save_failed) throw new Error('Speichern fehlgeschlagen');
      this.destroy();
      this.onSaved();
    } catch (err) {
      this.saveBtn.disabled = false;
      this.onSaved(err);
    }
  }

  // ═══════════ Field builders ═══════════
  _field(label, input, cls = '') {
    return h('div', { class: `field ${cls}`.trim() }, h('span', { class: 'field-label' }, label), input);
  }

  _text(obj, key, label, { placeholder = '', list = '', type = 'text' } = {}) {
    const input = h('input', {
      type, value: obj[key] ?? '', placeholder, ...(list ? { list } : {}),
      onInput: (e) => {
        const v = e.target.value;
        if (type === 'number') obj[key] = v === '' ? undefined : Number(v);
        else if (v === '') delete obj[key]; else obj[key] = v;
      },
    });
    return this._field(label, input);
  }

  _entity(obj, key, label, opts = {}) {
    const picker = this._track(new EntityPicker({
      hass: this.hass,
      value: obj[key] || '',
      placeholder: opts.placeholder || 'Entität suchen',
      domain: opts.domain,
      filter: opts.filter,
      onChange: (val) => {
        if (val) obj[key] = val;
        else delete obj[key];
      },
    }));
    return this._field(label, picker.el);
  }

  _select(obj, key, label, options, fallback = options[0][0]) {
    const val = obj[key] ?? fallback;
    const cdd = this._track(new CustomDropdown({
      options: options.map(([v, l, ic]) => ({ value: v, label: l, ...(ic ? { icon: ic } : {}) })),
      value: val,
      onChange: (v) => { obj[key] = v; },
    }));
    return this._field(label, cdd.el);
  }

  _check(obj, key, label) {
    const input = h('input', { type: 'checkbox', checked: !!obj[key], onChange: (e) => { obj[key] = e.target.checked; } });
    return h('label', { class: 'field check' }, input, label);
  }

  _csv(obj, key, label, placeholder = '') {
    const input = h('input', {
      type: 'text', value: (obj[key] || []).join(', '), placeholder, list: 'cd-entities',
      onInput: (e) => { obj[key] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); },
    });
    return this._field(label, input);
  }

  _usersField(arr, label, onChange) {
    const wrap = h('div', { class: 'user-chips' });
    const render = () => wrap.replaceChildren(...this.users.map((u) => h('button', {
      class: 'user-chip', type: 'button', ...(arr.includes(u.id) ? { 'data-on': '' } : {}),
      onClick: () => {
        const i = arr.indexOf(u.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(u.id);
        onChange?.(arr);
        render();
      },
    }, u.name || u.id)));
    render();
    return this._field(`${label} (leer = alle)`, wrap);
  }

  _color(obj, key, label) {
    const picker = this._track(new ColorPicker({
      value: obj[key] || '',
      label,
      onChange: (val) => {
        if (val) obj[key] = val;
        else delete obj[key];
      },
    }));
    return this._field(label, picker.el);
  }

  _icon(obj, key, label, placeholder = 'mdi:...') {
    const picker = this._track(new IconPicker({
      hass: this.hass,
      value: obj[key] || '',
      placeholder,
      onChange: (val) => {
        if (val) obj[key] = val;
        else delete obj[key];
      },
    }));
    return this._field(label, picker.el);
  }

  /** Reorderable list of object rows. */
  _list(arr, { rowTitle, fields, make, addLabel = 'Hinzufügen' }) {
    const wrap = h('div', { style: { display: 'grid', gap: '10px' } });
    const render = () => {
      wrap.replaceChildren(
        ...arr.map((item, i) => h('div', { class: 'row-card' },
          h('div', { class: 'row-head' },
            h('div', { class: 'row-title' }, rowTitle(item, i)),
            this._miniBtn('mdi:arrow-up', 'Nach oben', i === 0, () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; render(); }),
            this._miniBtn('mdi:arrow-down', 'Nach unten', i === arr.length - 1, () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; render(); }),
            this._miniBtn('mdi:delete-outline', 'Entfernen', false, () => { arr.splice(i, 1); render(); })),
          h('div', { class: 'fields' }, fields(item)))),
        h('div', {}, h('button', { class: 'btn', type: 'button', onClick: () => { arr.push(make()); render(); } }, icon('mdi:plus'), addLabel)));
    };
    render();
    return wrap;
  }

  _miniBtn(ic, label, disabled, onClick) {
    return h('button', { class: 'mini-btn', type: 'button', 'aria-label': label, disabled, onClick }, icon(ic));
  }

  _title(text) { return h('div', { class: 'section-title' }, text); }
  _hint(text) { return h('div', { class: 'hint' }, text); }

  // ═══════════ Tabs ═══════════
  _tabHeader() {
    this.draft.badges ||= [];
    return [
      this._title('Begrüßung'),
      h('div', { class: 'fields' }, this._entity(this.draft, 'greeting_entity', 'Begrüßungs-Sensor (optional)')),
      this._hint('• Leer = Standard-Begrüßung\n• Sensorwert ersetzt Begrüßung'),
      this._title('Badges'),
      this._hint('• Status-Badges unter Begrüßung\n• Sichtbarkeit nach Regel'),
      this._list(this.draft.badges, {
        rowTitle: (b) => b.name || b.entity_id || 'Neues Badge',
        make: () => ({ entity_id: '', show_state: true, tap: 'more-info', visible_when: 'always' }),
        fields: (b) => [
          this._entity(b, 'entity_id', 'Entität'),
          this._text(b, 'name', 'Anzeigename'),
          this._icon(b, 'icon', 'Icon'),
          this._color(b, 'color', 'Farbe'),
          this._check(b, 'show_name', 'Name anzeigen'),
          this._check(b, 'show_state', 'Status anzeigen'),
          this._select(b, 'tap', 'Bei Tipp', TAP_OPTIONS),
          this._text(b, 'path', 'Pfad („Seite“)', { placeholder: '/lovelace/solar' }),
          this._text(b, 'service', 'Dienst („Dienst“)', { placeholder: 'input_boolean.turn_on' }),
          this._select(b, 'visible_when', 'Sichtbar', VISIBLE_OPTIONS, 'always'),
          this._text(b, 'visible_value', 'Vergleichswert', { placeholder: '0 / unavailable, off' }),
        ],
        addLabel: 'Badge hinzufügen',
      }),
    ];
  }

  _tabInfo() {
    const d = this.draft;
    d.warning ||= {};
    d.announce ||= {};
    d.announce.chips ||= [];
    d.persons ||= [];
    return [
      this._title('Wetterwarnung'),
      h('div', { class: 'fields' },
        this._entity(d.warning, 'entity_id', 'Warnstufen-Sensor'),
        this._text(d.warning, 'headline_attribute', 'Attribut für Überschrift', { placeholder: 'warning_1_headline' }),
        this._text(d.warning, 'path', 'Pfad bei Tipp', { placeholder: '/dashboard-warnungen/dash-warnungen' })),
      this._hint('• Anzeige ab Warnstufe > 0\n• Rauchmelder immer aktiv'),
      this._title('Ankündigung'),
      h('div', { class: 'fields' },
        this._entity(d.announce, 'entity_id', 'Skript / Entität'),
        this._text(d.announce, 'name', 'Anzeigename'),
        this._icon(d.announce, 'icon', 'Icon'),
        this._entity(d.announce, 'chips_visible_entity', 'Chip-Verfügbarkeit (Sensor)')),
      this._list(d.announce.chips, {
        rowTitle: (c) => c.entity_id || 'Chip',
        make: () => ({ entity_id: '', icon: '' }),
        fields: (c) => [this._entity(c, 'entity_id', 'Entität'), this._icon(c, 'icon', 'Icon')],
        addLabel: 'Chip hinzufügen',
      }),
      this._title('Personen'),
      this._hint('• Anzeige nur „Zuhause“\n• Pro Benutzer filterbar'),
      this._list(d.persons, {
        rowTitle: (p) => p.entity_id || 'Person',
        make: () => ({ entity_id: '', users: [] }),
        fields: (p) => { p.users ||= []; return [this._entity(p, 'entity_id', 'Person / Tracker'), this._usersField(p.users, 'Sichtbar für')]; },
        addLabel: 'Person hinzufügen',
      }),
    ];
  }

  _tabTrash() {
    const d = this.draft;
    d.trash ||= {};
    d.trash.patterns ||= [];
    d.trash.calendar_entities ||= [];
    return [
      this._title('Müllkalender'),
      h('div', { class: 'fields' },
        this._csv(d.trash, 'calendar_entities', 'Kalender (kommagetrennt)', 'calendar.muellplan'),
        this._text(d.trash, 'next_days', 'Vorschau (Tage)', { type: 'number' })),
      this._hint('• Muster im Terminnamen → Tonne\n• Standard: 3D-Vektortonne\n• Eigenes Bild optional'),
      this._list(d.trash.patterns, {
        rowTitle: (p) => p.pattern || 'Tonne',
        make: () => ({ pattern: '', icon: 'mdi:trash-can-outline', color: 'grey', picture: '' }),
        fields: (p) => {
          const previewWrap = h('div', { class: 'trash-preview-box' }, renderTrashBin(p.color || 'grey', 42));
          const colorField = this._track(new ColorPicker({
            value: p.color || 'grey',
            label: 'Farbe',
            allowAuto: false,
            onChange: (val) => {
              p.color = val || 'grey';
              previewWrap.replaceChildren(renderTrashBin(p.color, 42));
            },
          }));
          return [
            this._text(p, 'pattern', 'Termin-Muster'),
            this._field('Farbe', colorField.el),
            this._icon(p, 'icon', 'Fallback-Icon'),
            this._text(p, 'picture', 'Eigenes Bild (optional)', { placeholder: '/local/custom-icons/...' }),
            this._field('Tonnen-Vorschau', previewWrap),
          ];
        },
        addLabel: 'Tonne hinzufügen',
      }),
    ];
  }

  _tabNav() {
    this.draft.nav ||= [];
    return [
      this._title('Untere Leiste'),
      this._hint('• Untere Schnellzugriff-Leiste\n• Beliebiger HA-Pfad'),
      this._list(this.draft.nav, {
        rowTitle: (n) => n.name || n.path || 'Button',
        make: () => ({ name: '', icon: 'mdi:home', path: '' }),
        fields: (n) => [
          this._text(n, 'name', 'Beschriftung (optional)'), this._icon(n, 'icon', 'Icon'),
          this._text(n, 'path', 'Pfad', { placeholder: '/lovelace/sicherheit' }),
        ],
        addLabel: 'Button hinzufügen',
      }),
    ];
  }

  _tabRooms() {
    const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; this._renderBody(true); };
    return [
      this._hint('• Raum- & Kachel-Reihenfolge\n• Kacheln ein-/ausblenden\n• Benutzer-Sichtbarkeit'),
      ...this.rooms.map((room, ri) => {
        const rc = (this.draft.rooms[room.area_id] ||= {});
        rc.expanded_users ||= [];
        rc.visible_users ||= [];
        return h('div', { class: 'row-card' },
          h('div', { class: 'row-head' },
            icon(rc.icon || room.icon || 'mdi:home-outline'),
            h('div', { class: 'row-title' }, room.name),
            this._miniBtn('mdi:arrow-up', 'Raum nach oben', ri === 0, () => move(this.rooms, ri, -1)),
            this._miniBtn('mdi:arrow-down', 'Raum nach unten', ri === this.rooms.length - 1, () => move(this.rooms, ri, 1))),
          h('div', { class: 'fields' },
            this._select(rc, 'expanded', 'Standard', EXPAND_OPTIONS, 'collapsed'),
            this._usersField(rc.expanded_users, 'Ausgeklappt für'),
            this._usersField(rc.visible_users, 'Sichtbar für')),
          h('details', { class: 'sub' },
            h('summary', {}, `${room.tiles.length} Kacheln`),
            ...room.tiles.map((t, ti) => h('div', { class: 'sub-tile', ...(t.hidden ? { 'data-hidden': '' } : {}) },
              h('div', { class: 'st-name' }, t.name || t.entity_id, h('div', { class: 'st-id' }, t.entity_id)),
              this._miniBtn('mdi:arrow-up', 'Hoch', ti === 0, () => move(room.tiles, ti, -1)),
              this._miniBtn('mdi:arrow-down', 'Runter', ti === room.tiles.length - 1, () => move(room.tiles, ti, 1)),
              this._miniBtn(t.hidden ? 'mdi:eye-off' : 'mdi:eye', t.hidden ? 'Einblenden' : 'Ausblenden', false,
                () => { t.hidden = !t.hidden; this._renderBody(true); })),
            ),
            h('div', { class: 'hint', style: { marginTop: '8px' } }, 'Sichtbarkeit pro Kachel:'),
            ...room.tiles.map((t) => h('details', { class: 'sub' },
              h('summary', {}, `${t.name || t.entity_id}${t.users.length ? ` · ${t.users.length} Benutzer` : ''}`),
              this._usersField(t.users, 'Sichtbar für')))));
      }),
    ];
  }

  _tabExtra() {
    this.draft.extra_tiles ||= [];
    const resolveAreaIcon = (area) => (
      this.draft.rooms?.[area.area_id]?.icon
      || this.rooms.find((r) => r.area_id === area.area_id)?.icon
      || area.icon
      || 'mdi:home-outline'
    );
    const areaOptions = [
      ['', 'Automatisch', 'mdi:auto-fix'],
      ...this.areas.map((a) => [a.area_id, a.name, resolveAreaIcon(a)]),
    ];
    return [
      this._title('Zusatz-Kacheln'),
      this._hint('• Entitäten ohne Gerät (Helfer, Skripte, Klima)\n• Raumzuweisung per ID'),
      this._list(this.draft.extra_tiles, {
        rowTitle: (e) => e.name || e.entity_id || 'Neue Kachel',
        make: () => ({ entity_id: '', area_id: '' }),
        fields: (e) => [
          this._entity(e, 'entity_id', 'Entität'), this._select(e, 'area_id', 'Raum', areaOptions, ''),
          this._text(e, 'name', 'Anzeigename (optional)'), this._icon(e, 'icon', 'Icon (optional)'),
        ],
        addLabel: 'Kachel hinzufügen',
      }),
    ];
  }

  _tabColors() {
    const presets = (this.draft.color_presets ||= []);
    const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
    const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const wrap = h('div', { class: 'user-chips', style: { gap: '12px' } });
    const render = () => wrap.replaceChildren(
      ...presets.map((rgb, i) => h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
        h('input', { type: 'color', value: toHex(rgb), style: { width: '48px', height: '40px', border: 0, background: 'none' }, onInput: (e) => { presets[i] = fromHex(e.target.value); } }),
        this._miniBtn('mdi:close', 'Entfernen', false, () => { presets.splice(i, 1); render(); }))),
      h('button', { class: 'btn', type: 'button', onClick: () => { presets.push([255, 160, 60]); render(); } }, icon('mdi:plus'), 'Farbe'));
    render();
    return [
      this._title('Licht-Farbpresets'),
      this._hint('• Auswahl bei Farblampen\n• Tipp = Farbe setzen'),
      wrap,
    ];
  }

  // ═══════════ Geräteverwaltung Tab ═══════════
  _tabDevices() {
    const wrap = h('div', { class: 'settings-devices-tab' });
    this._renderDevicesTab(wrap);
    return [
      this._title('Geräte'),
      this._hint('• Eingerichtete Geräte & Gruppen\n• Name, Raum, Kategorie editierbar'),
      wrap,
    ];
  }

  async _renderDevicesTab(wrap) {
    wrap.replaceChildren(h('div', { class: 'empty' }, icon('mdi:loading'), h('div', { style: { marginTop: '8px' } }, 'Lade Geräte...')));
    try {
      const [setup, devs, areas] = await Promise.all([
        this.hass.callWS({ type: 'smarthome_companion/devices/get' }),
        this.hass.callWS({ type: 'config/device_registry/list' }),
        this.hass.callWS({ type: 'config/area_registry/list' }),
      ]);
      const configuredMap = setup?.devices || {};
      const groupsMap = setup?.groups || {};
      const devList = devs || [];
      const areaMap = new Map((areas || []).map((a) => [a.area_id, a.name]));

      const configuredIds = Object.keys(configuredMap);
      if (!configuredIds.length && !Object.keys(groupsMap).length) {
        wrap.replaceChildren(
          h('div', { class: 'empty' },
            icon('mdi:devices'),
            h('div', { style: { fontWeight: '600', margin: '8px 0 4px' } }, 'Keine Geräte eingerichtet'),
            h('div', { class: 'hint' }, 'Erstes Gerät über Assistent einrichten'),
            h('div', { style: { marginTop: '14px' } },
              h('button', {
                class: 'btn primary',
                type: 'button',
                onClick: () => this.onOpenDevice?.(null),
              }, icon('mdi:plus-circle-outline'), 'Gerät einrichten')))
        );
        return;
      }

      let searchQ = '';
      const listEl = h('div', { class: 'device-list', style: { marginTop: '12px' } });

      const updateList = () => {
        const filtered = configuredIds.filter((id) => {
          const cfg = configuredMap[id];
          const dev = devList.find((d) => d.id === id);
          const name = (cfg.custom_name || dev?.name_by_user || dev?.name || '').toLowerCase();
          const area = (areaMap.get(cfg.area_id || dev?.area_id) || '').toLowerCase();
          const mfg = (dev?.manufacturer || '').toLowerCase();
          const model = (dev?.model || '').toLowerCase();
          return !searchQ || name.includes(searchQ) || area.includes(searchQ) || mfg.includes(searchQ) || model.includes(searchQ);
        });

        const filteredGroups = Object.values(groupsMap).filter((g) => {
          const gName = (g.name || '').toLowerCase();
          const area = (areaMap.get(g.area_id) || '').toLowerCase();
          return !searchQ || gName.includes(searchQ) || area.includes(searchQ);
        });

        if (!filtered.length && !filteredGroups.length) {
          listEl.replaceChildren(h('div', { class: 'empty' }, icon('mdi:magnify'), h('div', {}, 'Keine Treffer')));
          return;
        }

        const groups = new Map();
        for (const id of filtered) {
          const cfg = configuredMap[id];
          const dev = devList.find((d) => d.id === id);
          const areaName = areaMap.get(cfg?.area_id || dev?.area_id) || 'Ohne Raum';
          if (!groups.has(areaName)) groups.set(areaName, []);
          groups.get(areaName).push(id);
        }

        // Include rooms from matching groups
        for (const g of filteredGroups) {
          const areaName = areaMap.get(g.area_id) || 'Ohne Raum';
          if (!groups.has(areaName)) groups.set(areaName, []);
        }

        const sortedGroupNames = Array.from(groups.keys()).sort((a, b) => {
          if (a === 'Ohne Raum') return 1;
          if (b === 'Ohne Raum') return -1;
          return a.localeCompare(b);
        });

        const sections = sortedGroupNames.map((areaName) => {
          const ids = groups.get(areaName) || [];
          ids.sort((aId, bId) => {
            const nameA = (configuredMap[aId]?.custom_name || devList.find((d) => d.id === aId)?.name_by_user || devList.find((d) => d.id === aId)?.name || '').toLowerCase();
            const nameB = (configuredMap[bId]?.custom_name || devList.find((d) => d.id === bId)?.name_by_user || devList.find((d) => d.id === bId)?.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
          });

          const roomGroups = filteredGroups.filter((g) => (areaMap.get(g.area_id) || 'Ohne Raum') === areaName);

          const groupCards = roomGroups.map((g) => createGroupCard({
            group: g,
            onEdit: () => this.onOpenGroup?.(g.id),
            onDelete: async () => {
              const conf = await showConfirmDialog(this.el, {
                title: 'Gruppe auflösen?',
                message: `Gruppe „${g.name}“ auflösen?\n• Enthaltene Geräte bleiben erhalten`,
                confirmLabel: 'Auflösen',
                danger: true,
              });
              if (!conf) return;
              try {
                await this.hass.callWS({ type: 'smarthome_companion/groups/delete', group_id: g.id });
                delete groupsMap[g.id];
                showToast(this.el, 'Gruppe aufgelöst');
                if (!configuredIds.length && !Object.keys(groupsMap).length) {
                  this._renderDevicesTab(wrap);
                } else {
                  preserveScroll(this.body, updateList);
                }
              } catch (err) {
                showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
              }
            },
          }));

          const cards = ids.map((id) => {
            const cfg = configuredMap[id];
            const dev = devList.find((d) => d.id === id);
            const name = cfg.custom_name || dev?.name_by_user || dev?.name || 'Unbenanntes Gerät';
            const mfg = [dev?.manufacturer, dev?.model].filter(Boolean).join(' · ');

            const cat = DEVICE_CATEGORIES.find((c) => c.id === cfg.category);
            const catName = cat?.name || cfg.category;
            const catIcon = cat?.icon || 'mdi:devices';
            const catColor = cat?.color || 'var(--cd-accent)';

            const badges = [
              h('span', {
                class: 'badge-tag category',
                style: { '--badge-cat-color': catColor },
              }, icon(catIcon), catName),
            ];

            return h('div', { class: 'device-card' },
              h('div', { class: 'd-icon', style: { color: catColor } }, icon(catIcon)),
              h('div', { class: 'd-info' },
                h('div', { class: 'd-name' }, name),
                h('div', { class: 'd-meta' }, mfg ? h('span', { class: 'd-mfg' }, mfg) : null, ...badges)),
              h('div', { class: 'device-card-actions' },
                h('button', {
                  class: 'btn secondary small',
                  type: 'button',
                  title: 'Gerät bearbeiten',
                  'aria-label': 'Bearbeiten',
                  onClick: () => this.onOpenDevice?.(id),
                }, icon('mdi:pencil'), h('span', {}, 'Bearbeiten')),
                h('button', {
                  class: 'icon-btn danger',
                  type: 'button',
                  title: 'Einrichtung aufheben',
                  'aria-label': 'Einrichtung aufheben',
                  onClick: async () => {
                    const conf = await showConfirmDialog(this.el, {
                      title: 'Einrichtung aufheben?',
                      message: `Einrichtung für „${name}“ aufheben?\n• Gerät bleibt in Home Assistant erhalten`,
                      confirmLabel: 'Aufheben',
                      danger: true,
                    });
                    if (!conf) return;
                    try {
                      await this.hass.callWS({ type: 'smarthome_companion/devices/remove', device_id: id });
                      delete configuredMap[id];
                      const idx = configuredIds.indexOf(id);
                      if (idx >= 0) configuredIds.splice(idx, 1);
                      showToast(this.el, 'Einrichtung aufgehoben');
                      if (!configuredIds.length && !Object.keys(groupsMap).length) {
                        this._renderDevicesTab(wrap);
                      } else {
                        preserveScroll(this.body, updateList);
                      }
                    } catch (err) {
                      showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
                    }
                  },
                }, icon('mdi:delete-outline'))));
          });

          const totalCount = groupCards.length + cards.length;
          return createDeviceRoomSection(areaName, [...groupCards, ...cards], totalCount);
        });

        listEl.replaceChildren(...sections);
      };

      const searchInput = h('input', {
        type: 'text', placeholder: 'Suchen (Name, Raum, Modell)',
        onInput: (e) => { searchQ = e.target.value.toLowerCase().trim(); updateList(); },
      });
      const topRow = h('div', { class: 'devices-toolbar' },
        h('div', { class: 'search-bar' }, icon('mdi:magnify'), searchInput),
        h('button', {
          class: 'btn primary',
          type: 'button',
          onClick: () => this.onOpenDevice?.(null),
        }, icon('mdi:plus-circle-outline'), 'Gerät einrichten'));

      updateList();
      wrap.replaceChildren(topRow, listEl);
    } catch (err) {
      wrap.replaceChildren(h('div', { class: 'empty' }, icon('mdi:alert'), h('div', {}, `Fehler: ${err.message || err}`)));
    }
  }
}

// Re-exported so the main panel can reuse the named-colour palette.
export { resolveColor };
