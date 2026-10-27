// Settings dialog (admin only): schema-driven editor for everything the dashboard shows.
import { h, icon, COLOR_NAMES, resolveColor } from '../lib/util.js';

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
   * @param {{hass:object, config:object, layout:object, users:Array, onClose:Function, onSaved:Function}} opts
   */
  constructor({ hass, config, layout, users, onClose, onSaved }) {
    this.hass = hass;
    this.users = users;
    this.areas = layout.areas;
    this.onClose = onClose;
    this.onSaved = onSaved;
    this.draft = clone(config);
    this.draft.rooms ||= {};

    // Local, editable copy of the room/tile structure (includes hidden tiles).
    this.rooms = layout.rooms.map((r) => ({
      area_id: r.area_id,
      name: r.name,
      tiles: r.tiles.map((t) => ({ key: t.key, name: t.name, entity_id: t.entity_id, hidden: !!t.hidden, users: [...(t.users || [])] })),
    }));

    this.tab = 'header';
    this.tabs = [
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
  _build() {
    this.datalist = h('datalist', { id: 'cd-entities' },
      Object.keys(this.hass.states).sort().map((id) => h('option', { value: id })));
    this.body = h('div', { class: 'dialog-body' });
    this.tabBar = h('div', { class: 'tabs' });
    this.saveBtn = h('button', { class: 'btn primary', onClick: () => this._save() }, icon('mdi:content-save'), 'Speichern');
    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this.onClose(); } },
      this.datalist,
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Dashboard-Einstellungen' },
        h('div', { class: 'dialog-head' }, h('h2', {}, 'Dashboard einrichten'),
          h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => this.onClose() }, icon('mdi:close'))),
        this.tabBar, this.body,
        h('div', { class: 'dialog-foot' },
          h('button', { class: 'btn', onClick: () => this.onClose() }, 'Abbrechen'), this.saveBtn)));
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
      this.onSaved();
    } catch (err) {
      this.saveBtn.disabled = false;
      this.onSaved(err);
    }
  }

  // ═══════════ Field builders ═══════════
  _field(label, input, cls = '') {
    return h('label', { class: `field ${cls}` }, label, input);
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

  _entity(obj, key, label) {
    return this._text(obj, key, label, { placeholder: 'domain.entity_id', list: 'cd-entities' });
  }

  _select(obj, key, label, options, fallback = options[0][0]) {
    const select = h('select', { onChange: (e) => { obj[key] = e.target.value; } },
      options.map(([v, l]) => h('option', { value: v, selected: (obj[key] ?? fallback) === v }, l)));
    return this._field(label, select);
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
    return this._select(obj, key, label, [['', 'Automatisch'], ...COLOR_NAMES.map((c) => [c, c])], '');
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
      this._hint('• Leer = automatische Begrüßung (Tageszeit + Name)\n• Sensor-Status wird als Begrüßung angezeigt'),
      this._title('Badges'),
      this._hint('• Kleine Status-Kacheln unter der Begrüßung\n• Sichtbarkeit per Regel steuerbar'),
      this._list(this.draft.badges, {
        rowTitle: (b) => b.name || b.entity_id || 'Neues Badge',
        make: () => ({ entity_id: '', show_state: true, tap: 'more-info', visible_when: 'always' }),
        fields: (b) => [
          this._entity(b, 'entity_id', 'Entität'),
          this._text(b, 'name', 'Anzeigename'),
          this._text(b, 'icon', 'Icon (mdi:…)'),
          this._color(b, 'color', 'Farbe'),
          this._check(b, 'show_name', 'Name anzeigen'),
          this._check(b, 'show_state', 'Status anzeigen'),
          this._select(b, 'tap', 'Bei Tipp', TAP_OPTIONS),
          this._text(b, 'path', 'Pfad (bei „Seite öffnen“)', { placeholder: '/lovelace/solar' }),
          this._text(b, 'service', 'Dienst (bei „Dienst ausführen“)', { placeholder: 'input_boolean.turn_on' }),
          this._select(b, 'visible_when', 'Sichtbar', VISIBLE_OPTIONS, 'always'),
          this._text(b, 'visible_value', 'Vergleichswert', { placeholder: '0  /  unavailable, off' }),
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
      this._hint('• Anzeige ab Warnstufe > 0\n• Rauchmelder-Alarm automatisch aktiv (alle Rauchmelder)'),
      this._title('Ankündigung'),
      h('div', { class: 'fields' },
        this._entity(d.announce, 'entity_id', 'Skript / Entität'),
        this._text(d.announce, 'name', 'Anzeigename'),
        this._text(d.announce, 'icon', 'Icon (mdi:…)'),
        this._entity(d.announce, 'chips_visible_entity', 'Chips nur sichtbar wenn verfügbar (z. B. Drucker)')),
      this._list(d.announce.chips, {
        rowTitle: (c) => c.entity_id || 'Chip',
        make: () => ({ entity_id: '', icon: '' }),
        fields: (c) => [this._entity(c, 'entity_id', 'Entität'), this._text(c, 'icon', 'Icon (mdi:…)')],
        addLabel: 'Chip hinzufügen',
      }),
      this._title('Personen'),
      this._hint('• Anzeige nur bei Status „Zuhause“\n• Nur für gewählte Benutzer sichtbar'),
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
      this._hint('• Terminname enthält Muster → Tonne\n• Bild optional, Fallback = Icon\n• Bild z. B. /local/custom-icons/trash-bins/blue.png'),
      this._list(d.trash.patterns, {
        rowTitle: (p) => p.pattern || 'Tonne',
        make: () => ({ pattern: '', icon: 'mdi:trash-can-outline', color: 'grey', picture: '' }),
        fields: (p) => [
          this._text(p, 'pattern', 'Muster im Terminnamen'), this._text(p, 'icon', 'Fallback-Icon'),
          this._color(p, 'color', 'Farbe'), this._text(p, 'picture', 'Bild-URL (optional)'),
        ],
        addLabel: 'Tonne hinzufügen',
      }),
    ];
  }

  _tabNav() {
    this.draft.nav ||= [];
    return [
      this._title('Untere Leiste'),
      this._hint('• Schnellzugriff-Buttons am unteren Rand\n• Pfad = beliebige HA-Seite'),
      this._list(this.draft.nav, {
        rowTitle: (n) => n.name || n.path || 'Button',
        make: () => ({ name: '', icon: 'mdi:home', path: '' }),
        fields: (n) => [
          this._text(n, 'name', 'Beschriftung (optional)'), this._text(n, 'icon', 'Icon (mdi:…)'),
          this._text(n, 'path', 'Pfad', { placeholder: '/lovelace/sicherheit' }),
        ],
        addLabel: 'Button hinzufügen',
      }),
    ];
  }

  _tabRooms() {
    const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; this._renderBody(true); };
    return [
      this._hint('• Reihenfolge der Räume und Kacheln\n• Ausblenden pro Kachel\n• Sichtbarkeit pro Raum/Kachel für Benutzer'),
      ...this.rooms.map((room, ri) => {
        const rc = (this.draft.rooms[room.area_id] ||= {});
        rc.expanded_users ||= [];
        rc.visible_users ||= [];
        return h('div', { class: 'row-card' },
          h('div', { class: 'row-head' },
            icon('mdi:home-outline'),
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
            h('div', { class: 'hint', style: { marginTop: '8px' } }, 'Benutzer-Sichtbarkeit einzelner Kacheln:'),
            ...room.tiles.map((t) => h('details', { class: 'sub' },
              h('summary', {}, `${t.name || t.entity_id}${t.users.length ? ` · ${t.users.length} Benutzer` : ''}`),
              this._usersField(t.users, 'Sichtbar für')))));
      }),
    ];
  }

  _tabExtra() {
    this.draft.extra_tiles ||= [];
    const areaOptions = [['', 'Automatisch (Raum der Entität)'], ...this.areas.map((a) => [a.area_id, a.name])];
    return [
      this._title('Zusatz-Kacheln'),
      this._hint('• Entitäten ohne Gerät (Helfer, Skripte, Klima …)\n• Werden einem Raum zugewiesen\n• Bleiben bei Umbenennung verknüpft (eindeutige ID)'),
      this._list(this.draft.extra_tiles, {
        rowTitle: (e) => e.name || e.entity_id || 'Neue Kachel',
        make: () => ({ entity_id: '', area_id: '' }),
        fields: (e) => [
          this._entity(e, 'entity_id', 'Entität'), this._select(e, 'area_id', 'Raum', areaOptions, ''),
          this._text(e, 'name', 'Anzeigename (optional)'), this._text(e, 'icon', 'Icon (optional)'),
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
      this._title('Farb-Voreinstellungen für Lichter'),
      this._hint('• Erscheinen bei farbfähigen Lichtern\n• Tipp = Farbe setzen'),
      wrap,
    ];
  }
}

// Re-exported so the main panel can reuse the named-colour palette.
export { resolveColor };
