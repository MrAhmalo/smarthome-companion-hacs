import {
  h, icon, resolveColor, renderTrashBin, showToast, showConfirmDialog, preserveScroll,
  enablePointerReorder, BUILTIN_VIEWS,
} from '../lib/util.js';
import { EntityPicker } from './entity_picker.js';
import { IconPicker } from './icon_picker.js';
import { ColorPicker } from './color_picker.js';
import { CustomDropdown } from './custom_dropdown.js';
import { DEVICE_CATEGORIES, createGroupCard, createDeviceRoomSection } from './device_list.js';
import { RoomSettingsForm, EXPAND_OPTIONS } from './room_settings_form.js';

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

const TAP_OPTIONS = [
  ['more-info', 'Details öffnen'], ['navigate', 'Seite öffnen'], ['service', 'Dienst ausführen'], ['none', 'Keine Aktion'],
];
const VISIBLE_OPTIONS = [
  ['always', 'Immer'], ['above', 'Wert größer als'], ['below', 'Wert kleiner als'],
  ['state_in', 'Status ist (Liste)'], ['state_not_in', 'Status ist nicht (Liste)'],
];
const VIEW_NAV_CHOICES = [
  ['', 'Benutzerdefinierter Pfad'],
  ...BUILTIN_VIEWS.map((v) => [`companion:${v.id}`, `Ansicht: ${v.label}`]),
];

export class Settings {
  /**
   * @param {{hass:object, config:object, layout:object, users:Array, onClose:Function, onSaved:Function, onOpenDevice?:Function, onOpenGroup?:Function}} opts
   */
  constructor({ hass, config, layout, users, onClose, onSaved, onOpenDevice, onOpenGroup }) {
    this.hass = hass;
    this.users = users || [];
    this.areas = layout.areas || [];
    this.onClose = onClose;
    this.onSaved = onSaved;
    this.onOpenDevice = onOpenDevice;
    this.onOpenGroup = onOpenGroup;
    this.draft = clone(config) || {};
    this.draft.rooms ||= {};
    this.draft.views ||= {};

    // Keep complete editable room metadata (icon, sensor specs, user_expanded, visible_users, tiles)
    this.rooms = (layout.rooms || []).map((r) => ({
      area_id: r.area_id,
      name: r.name,
      origName: r.name,
      icon: r.icon || 'mdi:home-outline',
      all_sensors: r.all_sensors || {},
      sensor_prefs: clone(r.sensor_prefs || {}),
      mode: r.mode || 'collapsed',
      expanded_users: [...(r.expanded_users || [])],
      user_expanded: clone(r.user_expanded || {}),
      visible_users: [...(r.visible_users || [])],
      tiles: (r.tiles || []).map((t) => ({
        key: t.key, name: t.name, entity_id: t.entity_id,
        hidden: !!t.hidden, users: [...(t.users || [])],
      })),
    }));

    this._openRoomIds = new Set();
    this._openRowKeys = new Set();
    this._dndCleanups = [];

    this.tab = 'rooms';
    this.tabs = [
      ['rooms', 'Räume & Kacheln', () => this._tabRooms()],
      ['home', 'Startseite & Infos', () => this._tabHome()],
      ['nav', 'Navigation & Design', () => this._tabNavAndDesign()],
      ['devices', 'Geräte', () => this._tabDevices()],
    ];
    this._build();
  }

  // ═══════════ Shell ═══════════
  _track(picker) {
    (this._pickers ||= []).push(picker);
    return picker;
  }

  _trackDnd(cleanupFn) {
    if (typeof cleanupFn === 'function') this._dndCleanups.push(cleanupFn);
  }

  _destroyPickers() {
    for (const p of (this._pickers || [])) {
      try { p?.destroy?.(); } catch {}
    }
    this._pickers = [];
    for (const fn of (this._dndCleanups || [])) {
      try { fn(); } catch {}
    }
    this._dndCleanups = [];
  }

  destroy() {
    this._destroyPickers();
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    this.el?.remove();
    this.el = null;
  }

  _close() {
    this.destroy();
    this.onClose?.();
  }

  _build() {
    this.body = h('div', { class: 'dialog-body' });
    this.tabBar = h('div', { class: 'tabs' });
    this.saveBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => this._save() }, icon('mdi:content-save'), 'Speichern');
    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this._close(); } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Einstellungen' },
        h('div', { class: 'dialog-head' }, h('h2', {}, 'Einstellungen'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onClick: () => this._close() }, icon('mdi:close'))),
        this.tabBar, this.body,
        h('div', { class: 'dialog-foot' },
          h('button', { class: 'btn', type: 'button', onClick: () => this._close() }, 'Abbrechen'), this.saveBtn)));
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this._close();
    };
    document.addEventListener('keydown', this._onKeyDown);
    this._renderTabs();
    this._renderBody();
  }

  _renderTabs() {
    this.tabBar.replaceChildren(...this.tabs.map(([id, label]) => h('button', {
      class: 'tab', type: 'button', ...(id === this.tab ? { 'data-active': '' } : {}),
      onClick: () => { this.tab = id; this._renderTabs(); this._renderBody(); },
    }, label)));
  }

  _renderBody(keepScroll = false) {
    const top = this.body.scrollTop;
    this._destroyPickers();
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

    const renamedRooms = [];
    for (const room of this.rooms) {
      const rc = config.rooms[room.area_id];
      if (rc) {
        const nextName = (rc.name || room.name || '').trim();
        if (room.area_id !== '__none__' && nextName && nextName !== room.origName) {
          renamedRooms.push({ area_id: room.area_id, name: nextName });
        }
        // Keep area name out of saved dashboard config (stored in HA Area Registry)
        delete rc.name;
      }
      config.tile_order[room.area_id] = room.tiles.map((t) => t.key);
      for (const t of room.tiles) {
        if (t.hidden) config.hidden_tiles.push(t.key);
        if (t.users.length) config.tile_users[t.key] = t.users;
      }
    }

    this.saveBtn.disabled = true;
    try {
      for (const rr of renamedRooms) {
        try {
          await this.hass.callWS({
            type: 'smarthome_companion/dashboard/room_update',
            area_id: rr.area_id,
            name: rr.name,
          });
        } catch (renameErr) {
          if (/unknown_command|not found|unknown command/i.test(String(renameErr?.code || renameErr?.message || renameErr))) {
            try {
              await this.hass.callWS({ type: 'config/area_registry/update', area_id: rr.area_id, name: rr.name });
            } catch (_) { /* ignore in dev mock */ }
          } else {
            throw renameErr;
          }
        }
      }
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

  _text(obj, key, label, { placeholder = '', list = '', type = 'text', onChange } = {}) {
    const input = h('input', {
      type, value: obj[key] ?? '', placeholder, ...(list ? { list } : {}),
      onInput: (e) => {
        const v = e.target.value;
        if (type === 'number') obj[key] = v === '' ? undefined : Number(v);
        else if (v === '') delete obj[key]; else obj[key] = v;
        onChange?.(obj[key]);
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
        opts.onChange?.(val);
      },
    }));
    return this._field(label, picker.el);
  }

  _select(obj, key, label, options, fallback = options[0][0], onChange) {
    const val = obj[key] ?? fallback;
    const cdd = this._track(new CustomDropdown({
      options: options.map(([v, l, ic]) => ({ value: v, label: l, ...(ic ? { icon: ic } : {}) })),
      value: val,
      onChange: (v) => {
        obj[key] = v;
        onChange?.(v);
      },
    }));
    return this._field(label, cdd.el);
  }

  _check(obj, key, label, onChange) {
    const input = h('input', {
      type: 'checkbox', checked: !!obj[key],
      onChange: (e) => { obj[key] = e.target.checked; onChange?.(e.target.checked); },
    });
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

  /** Reorderable collapsible list of object rows with Drag Handle + Arrows. */
  _list(arr, { rowTitle, rowSub, fields, make, addLabel = 'Hinzufügen', groupKey = 'list', startOpen = false }) {
    const wrap = h('div', { class: 'reorder-list' });
    const listWrap = h('div', { class: 'reorder-items' });
    let dndStop = null;

    const move = (from, to) => {
      if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      render();
    };

    const render = () => {
      dndStop?.();
      listWrap.replaceChildren(...arr.map((item, i) => {
        const itemKey = `${groupKey}:${i}:${item.entity_id || item.path || item.pattern || item.name || ''}`;
        const isOpen = startOpen || this._openRowKeys.has(itemKey);
        const bodyEl = h('div', { class: 'fields', hidden: !isOpen }, ...(isOpen ? fields(item, render) : []));
        const chevEl = icon('mdi:chevron-down');
        return h('div', { class: `row-card accordion-row${isOpen ? ' open' : ''}`, 'data-reorder-item': '' },
          h('div', {
            class: 'row-head acc-toggle-head',
            onClick: () => {
              if (this._openRowKeys.has(itemKey)) this._openRowKeys.delete(itemKey);
              else this._openRowKeys.add(itemKey);
              render();
            },
          },
            h('span', { class: 'drag-handle', title: 'Ziehen zum Sortieren', onClick: (e) => e.stopPropagation() }, icon('mdi:drag')),
            h('div', { class: 'acc-title-wrap' },
              h('div', { class: 'row-title' }, rowTitle(item, i)),
              rowSub ? h('div', { class: 'acc-sub' }, rowSub(item, i)) : null),
            this._miniBtn('mdi:arrow-up', 'Nach oben', i === 0, (e) => { e.stopPropagation(); move(i, i - 1); }),
            this._miniBtn('mdi:arrow-down', 'Nach unten', i === arr.length - 1, (e) => { e.stopPropagation(); move(i, i + 1); }),
            this._miniBtn('mdi:delete-outline', 'Entfernen', false, (e) => { e.stopPropagation(); arr.splice(i, 1); render(); }),
            h('span', { class: 'acc-chevron' }, chevEl)),
          isOpen ? bodyEl : null);
      }));
      dndStop = enablePointerReorder(listWrap, {
        itemSelector: '.accordion-row',
        handleSelector: '.drag-handle',
        onMove: move,
      });
      this._trackDnd(dndStop);
    };
    render();
    wrap.replaceChildren(
      listWrap,
      h('div', {}, h('button', {
        class: 'btn', type: 'button',
        onClick: () => {
          const idx = arr.length;
          arr.push(make());
          this._openRowKeys.add(`${groupKey}:${idx}:`);
          render();
        },
      }, icon('mdi:plus'), addLabel)),
    );
    return wrap;
  }

  _miniBtn(ic, label, disabled, onClick) {
    return h('button', {
      class: 'mini-btn', type: 'button', 'aria-label': label, title: label, disabled,
      onClick: (e) => { onClick?.(e); },
    }, icon(ic));
  }

  _title(text) { return h('div', { class: 'section-title' }, text); }
  _hint(text) { return h('div', { class: 'hint' }, text); }

  // ═══════════ TAB 1: Räume & Kacheln ═══════════
  _tabRooms() {
    const roomsListWrap = h('div', { class: 'reorder-items' });
    const moveRoom = (from, to) => {
      if (from < 0 || to < 0 || from >= this.rooms.length || to >= this.rooms.length || from === to) return;
      const [moved] = this.rooms.splice(from, 1);
      this.rooms.splice(to, 0, moved);
      this._renderBody(true);
    };

    const expandLabel = (mode) => EXPAND_OPTIONS.find(([v]) => v === mode)?.[1] || 'Eingeklappt';

    this.rooms.forEach((room, ri) => {
      const rc = (this.draft.rooms[room.area_id] ||= {});
      rc.name ??= room.name;
      rc.icon ??= room.icon || 'mdi:home-outline';
      rc.expanded ||= room.mode || 'collapsed';
      rc.expanded_users ||= [...(room.expanded_users || [])];
      rc.user_expanded ||= clone(room.user_expanded || {});
      rc.visible_users ||= [...(room.visible_users || [])];
      rc.sensor_prefs ||= clone(room.sensor_prefs || {});

      const isOpen = this._openRoomIds.has(room.area_id);
      const isUnassigned = room.area_id === '__none__';

      const iconNode = icon(rc.icon || room.icon || 'mdi:home-outline');
      const titleNode = h('div', { class: 'row-title' }, rc.name || room.name);
      const userOverrideCount = Object.keys(rc.user_expanded || {}).length;
      const summaryParts = [
        expandLabel(rc.expanded),
        `${room.tiles.length} Kacheln`,
        ...(userOverrideCount ? [`${userOverrideCount} Benutzer-Regel${userOverrideCount > 1 ? 'n' : ''}`] : []),
      ];
      const summaryNode = h('div', { class: 'room-acc-summary' }, summaryParts.join(' · '));

      const card = h('div', { class: `row-card room-acc-card${isOpen ? ' open' : ''}`, 'data-reorder-item': '' });
      const head = h('div', {
        class: 'row-head room-acc-head',
        onClick: () => {
          if (this._openRoomIds.has(room.area_id)) this._openRoomIds.delete(room.area_id);
          else this._openRoomIds.add(room.area_id);
          this._renderBody(true);
        },
      },
        h('span', { class: 'drag-handle', title: 'Raum ziehen', onClick: (e) => e.stopPropagation() }, icon('mdi:drag')),
        h('div', { class: 'room-acc-icon' }, iconNode),
        h('div', { class: 'acc-title-wrap' }, titleNode, summaryNode),
        this._miniBtn('mdi:arrow-up', 'Raum nach oben', ri === 0, (e) => { e.stopPropagation(); moveRoom(ri, ri - 1); }),
        this._miniBtn('mdi:arrow-down', 'Raum nach unten', ri === this.rooms.length - 1, (e) => { e.stopPropagation(); moveRoom(ri, ri + 1); }),
        h('span', { class: 'acc-chevron' }, icon('mdi:chevron-down')));

      card.append(head);

      if (isOpen) {
        const form = this._track(new RoomSettingsForm({
          hass: this.hass,
          roomSpec: room,
          roomConfig: rc,
          users: this.users,
          onNameChange: (val) => {
            room.name = val || room.origName;
            titleNode.textContent = room.name;
          },
          onIconChange: (ic) => {
            room.icon = ic;
            iconNode.setAttribute('icon', ic);
          },
          onChange: () => {
            const ov = Object.keys(rc.user_expanded || {}).length;
            summaryNode.textContent = [
              expandLabel(rc.expanded),
              `${room.tiles.length} Kacheln`,
              ...(ov ? [`${ov} Benutzer-Regel${ov > 1 ? 'n' : ''}`] : []),
            ].join(' · ');
          },
        }));

        // Tile reorder + visibility
        const tilesListWrap = h('div', { class: 'reorder-items sub-tiles-list' });
        const moveTile = (from, to) => {
          if (from < 0 || to < 0 || from >= room.tiles.length || to >= room.tiles.length || from === to) return;
          const [t] = room.tiles.splice(from, 1);
          room.tiles.splice(to, 0, t);
          renderTiles();
        };

        const renderTiles = () => {
          tilesListWrap.replaceChildren(...room.tiles.map((t, ti) => {
            const tileKey = `tile:${room.area_id}:${t.key}`;
            const usersOpen = this._openRowKeys.has(tileKey);
            return h('div', {
              class: `sub-tile-card${t.hidden ? ' is-hidden' : ''}`,
              'data-reorder-item': '',
            },
              h('div', { class: 'sub-tile' },
                h('span', { class: 'drag-handle small', title: 'Kachel ziehen' }, icon('mdi:drag')),
                h('div', { class: 'st-name' },
                  t.name || t.entity_id,
                  h('div', { class: 'st-id' }, `${t.entity_id}${t.users.length ? ` · ${t.users.length} Benutzer` : ''}`)),
                this._miniBtn('mdi:arrow-up', 'Hoch', ti === 0, () => moveTile(ti, ti - 1)),
                this._miniBtn('mdi:arrow-down', 'Runter', ti === room.tiles.length - 1, () => moveTile(ti, ti + 1)),
                this._miniBtn('mdi:account-multiple-outline', 'Benutzer-Sichtbarkeit', false, () => {
                  if (this._openRowKeys.has(tileKey)) this._openRowKeys.delete(tileKey);
                  else this._openRowKeys.add(tileKey);
                  renderTiles();
                }),
                this._miniBtn(t.hidden ? 'mdi:eye-off' : 'mdi:eye', t.hidden ? 'Einblenden' : 'Ausblenden', false,
                  () => { t.hidden = !t.hidden; renderTiles(); })),
              usersOpen ? h('div', { class: 'sub-tile-users' }, this._usersField(t.users, 'Sichtbar für')) : null);
          }));
          this._trackDnd(enablePointerReorder(tilesListWrap, {
            itemSelector: '.sub-tile-card',
            handleSelector: '.drag-handle',
            onMove: moveTile,
          }));
        };
        if (room.tiles.length) renderTiles();

        const deleteRoomBtn = !isUnassigned ? h('div', { class: 'room-acc-footer' },
          h('button', {
            type: 'button',
            class: 'btn danger small',
            onClick: async () => {
              const conf = await showConfirmDialog(this.el, {
                title: 'Raum löschen?',
                message: `Raum „${room.name}“ löschen?\n• Zugewiesene Geräte bleiben erhalten\n• Verschiebung nach „Nicht zugeordnet“`,
                confirmLabel: 'Löschen',
                danger: true,
              });
              if (!conf) return;
              try {
                try {
                  await this.hass.callWS({ type: 'smarthome_companion/dashboard/room_delete', area_id: room.area_id });
                } catch (wsErr) {
                  if (/unknown_command|not found|unknown command/i.test(String(wsErr?.code || wsErr?.message || wsErr))) {
                    await this.hass.callWS({ type: 'config/area_registry/delete', area_id: room.area_id });
                  } else throw wsErr;
                }
                this.rooms = this.rooms.filter((r) => r.area_id !== room.area_id);
                delete this.draft.rooms[room.area_id];
                this._openRoomIds.delete(room.area_id);
                this._renderBody(true);
                showToast(this.el, 'Raum gelöscht');
              } catch (err) {
                showToast(this.el, `Fehler: ${err?.message || err}`, { error: true });
              }
            },
          }, icon('mdi:delete-outline'), 'Raum löschen')) : null;

        card.append(h('div', { class: 'room-acc-body' },
          form.el,
          h('div', { class: 'section-title' }, `Kacheln in „${room.name}“ (${room.tiles.length})`),
          room.tiles.length
            ? h('div', { class: 'hint' }, '• Sortierung innerhalb Kategorie-Gruppe (Rollläden, Medien, Lichter)\n• Ziehen oder Pfeile nutzen')
            : h('div', { class: 'hint' }, '• Keine Kacheln in diesem Raum'),
          room.tiles.length ? tilesListWrap : null,
          deleteRoomBtn));
      }

      roomsListWrap.append(card);
    });

    this._trackDnd(enablePointerReorder(roomsListWrap, {
      itemSelector: '.room-acc-card',
      handleSelector: '.room-acc-head > .drag-handle',
      onMove: moveRoom,
    }));

    // Zusatz-Kacheln integrated directly below rooms
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
      this._title('Räume & Kacheln'),
      this._hint('• Reihenfolge per Ziehen oder Pfeilen\n• Raum antippen für Icon, Sensoren & Benutzer-Standard'),
      roomsListWrap,
      this._title('Zusatz-Kacheln (ohne Gerät)'),
      this._hint('• Einzelne Helfer, Skripte oder Klima-Entitäten\n• Raumzuweisung per Auswahl'),
      this._list(this.draft.extra_tiles, {
        groupKey: 'extra',
        rowTitle: (e) => e.name || e.entity_id || 'Neue Kachel',
        rowSub: (e) => e.entity_id || 'Noch keine Entität gewählt',
        make: () => ({ entity_id: '', area_id: '' }),
        fields: (e) => [
          this._entity(e, 'entity_id', 'Entität'),
          this._select(e, 'area_id', 'Raum', areaOptions, ''),
          this._text(e, 'name', 'Anzeigename (optional)'),
          this._icon(e, 'icon', 'Icon (optional)'),
        ],
        addLabel: 'Zusatz-Kachel hinzufügen',
      }),
    ];
  }

  // ═══════════ TAB 2: Startseite & Infos ═══════════
  _tabHome() {
    const d = this.draft;
    d.badges ||= [];
    d.warning ||= {};
    d.announce ||= {};
    d.announce.chips ||= [];
    d.persons ||= [];
    d.trash ||= {};
    d.trash.patterns ||= [];
    d.trash.calendar_entities ||= [];

    return [
      this._title('Begrüßung'),
      h('div', { class: 'fields' }, this._entity(d, 'greeting_entity', 'Begrüßungs-Sensor (optional)')),
      this._hint('• Leer = automatische Tageszeit-Begrüßung\n• Sensorwert ersetzt Text'),

      this._title('Status-Badges'),
      this._hint('• Kompakte Status-Chips unter Begrüßung\n• Tippen zum Aufklappen & Bearbeiten'),
      this._list(d.badges, {
        groupKey: 'badge',
        rowTitle: (b) => b.name || b.entity_id || 'Neues Badge',
        rowSub: (b) => `${b.entity_id || 'Entität fehlt'} · ${b.tap || 'more-info'}`,
        make: () => ({ entity_id: '', show_state: true, tap: 'more-info', visible_when: 'always' }),
        fields: (b, rerender) => {
          const tapMode = b.tap || 'more-info';
          const visMode = b.visible_when || 'always';
          return [
            this._entity(b, 'entity_id', 'Entität'),
            this._text(b, 'name', 'Anzeigename'),
            this._icon(b, 'icon', 'Icon'),
            this._color(b, 'color', 'Farbe'),
            this._check(b, 'show_name', 'Name anzeigen'),
            this._check(b, 'show_state', 'Status anzeigen'),
            this._select(b, 'tap', 'Bei Tipp', TAP_OPTIONS, 'more-info', () => rerender()),
            ...(tapMode === 'navigate' ? [this._text(b, 'path', 'Pfad / Ansicht', { placeholder: '/lovelace/solar' })] : []),
            ...(tapMode === 'service' ? [this._text(b, 'service', 'Dienst', { placeholder: 'input_boolean.turn_on' })] : []),
            this._select(b, 'visible_when', 'Sichtbarkeit', VISIBLE_OPTIONS, 'always', () => rerender()),
            ...(visMode !== 'always' ? [this._text(b, 'visible_value', 'Vergleichswert', { placeholder: '0 / unavailable, off' })] : []),
          ];
        },
        addLabel: 'Badge hinzufügen',
      }),

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
        groupKey: 'achip',
        rowTitle: (c) => c.entity_id || 'Chip',
        make: () => ({ entity_id: '', icon: '' }),
        fields: (c) => [this._entity(c, 'entity_id', 'Entität'), this._icon(c, 'icon', 'Icon')],
        addLabel: 'Chip hinzufügen',
      }),

      this._title('Personen'),
      this._hint('• Anzeige nur „Zuhause“\n• Pro Benutzer filterbar'),
      this._list(d.persons, {
        groupKey: 'person',
        rowTitle: (p) => p.entity_id || 'Person',
        make: () => ({ entity_id: '', users: [] }),
        fields: (p) => {
          p.users ||= [];
          return [this._entity(p, 'entity_id', 'Person / Tracker'), this._usersField(p.users, 'Sichtbar für')];
        },
        addLabel: 'Person hinzufügen',
      }),

      this._title('Müllkalender'),
      h('div', { class: 'fields' },
        this._csv(d.trash, 'calendar_entities', 'Kalender (kommagetrennt)', 'calendar.muellplan'),
        this._text(d.trash, 'next_days', 'Vorschau (Tage)', { type: 'number' })),
      this._list(d.trash.patterns, {
        groupKey: 'trash',
        rowTitle: (p) => p.pattern || 'Tonne',
        rowSub: (p) => `Farbe: ${p.color || 'grey'}`,
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

  // ═══════════ TAB 3: Navigation & Design ═══════════
  _tabNavAndDesign() {
    this.draft.nav ||= [];
    this.draft.views ||= {};
    const viewsCfg = this.draft.views;
    const presets = (this.draft.color_presets ||= []);

    // Built-in theme views configuration cards
    const viewCards = BUILTIN_VIEWS.filter((v) => v.id !== 'overview').map((v) => {
      const vc = (viewsCfg[v.id] ||= {});
      if (vc.enabled === undefined) vc.enabled = true;
      vc.users ||= [];
      const row = h('div', { class: 'row-card' },
        h('div', { class: 'row-head' },
          h('div', { class: 'room-acc-icon', style: { color: v.color } }, icon(v.icon)),
          h('div', { class: 'acc-title-wrap' },
            h('div', { class: 'row-title' }, v.label),
            h('div', { class: 'acc-sub' }, v.desc)),
          this._check(vc, 'enabled', 'Aktiviert')),
        h('div', { class: 'fields' },
          ...(v.id === 'auto' ? [this._text(vc, 'webview_url', 'Fahrzeug-Webansicht URL (optional)', { placeholder: 'http://192.168.178.188:6176/' })] : []),
          ...(v.id === 'security' ? [this._entity(vc, 'alarm_entity', 'Alarmanlage (optional)', { domain: 'alarm_control_panel' })] : []),
          this._usersField(vc.users, 'Sichtbar für')));
      return row;
    });

    const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
    const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const colorWrap = h('div', { class: 'user-chips', style: { gap: '12px' } });
    const renderColors = () => colorWrap.replaceChildren(
      ...presets.map((rgb, i) => h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
        h('input', {
          type: 'color', value: toHex(rgb),
          style: { width: '48px', height: '40px', border: 0, background: 'none' },
          onInput: (e) => { presets[i] = fromHex(e.target.value); },
        }),
        this._miniBtn('mdi:close', 'Entfernen', false, () => { presets.splice(i, 1); renderColors(); }))),
      h('button', { class: 'btn', type: 'button', onClick: () => { presets.push([255, 160, 60]); renderColors(); } }, icon('mdi:plus'), 'Farbe'));
    renderColors();

    return [
      this._title('Untere Navigationsleiste'),
      this._hint('• Direktsprung zu eingebauten Ansichten oder HA-Pfaden\n• Übersicht & Mehr automatisch erreichbar'),
      this._list(this.draft.nav, {
        groupKey: 'nav',
        rowTitle: (n) => n.name || n.view || n.path || 'Button',
        rowSub: (n) => n.view ? `Ansicht: ${n.view}` : (n.path || 'Kein Ziel'),
        make: () => ({ name: '', icon: 'mdi:shield-home', path: '' }),
        fields: (n, rerender) => {
          const targetObj = { sel: n.view ? `companion:${n.view}` : (n.path?.startsWith('companion:') ? n.path : '') };
          const viewSel = this._track(new CustomDropdown({
            options: VIEW_NAV_CHOICES.map(([v, l]) => ({ value: v, label: l })),
            value: targetObj.sel,
            onChange: (val) => {
              if (val.startsWith('companion:')) {
                n.view = val.slice('companion:'.length);
                n.path = val;
              } else {
                delete n.view;
              }
              rerender();
            },
          }));
          return [
            this._text(n, 'name', 'Beschriftung (leer = Nur Icon)'),
            this._icon(n, 'icon', 'Icon'),
            this._field('Ziel-Ansicht', viewSel.el),
            ...(!targetObj.sel ? [this._text(n, 'path', 'Benutzerdefinierter Pfad', { placeholder: '/lovelace/solar oder /todo?...' })] : []),
          ];
        },
        addLabel: 'Navigations-Button hinzufügen',
      }),

      this._title('Integrierte Themen-Ansichten'),
      this._hint('• Sichtbarkeit & Zusatzoptionen pro Bereich\n• Im „Mehr“-Hub & Navigation verfügbar'),
      ...viewCards,

      this._title('Licht-Farbpresets'),
      this._hint('• Schnellauswahl bei Farblampen\n• Tipp = Farbe setzen'),
      colorWrap,
    ];
  }

  // ═══════════ TAB 4: Geräte ═══════════
  _tabDevices() {
    const wrap = h('div', { class: 'settings-devices-tab' });
    this._renderDevicesTab(wrap);
    return [
      this._title('Geräte'),
      h('div', { class: 'inline-notice' },
        icon('mdi:information-outline'),
        h('span', {}, 'Geräte- & Gruppenänderungen werden sofort gespeichert.')),
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
                class: 'btn primary', type: 'button',
                onClick: () => this.onOpenDevice?.(null),
              }, icon('mdi:plus-circle-outline'), 'Gerät einrichten'))),
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
                if (!configuredIds.length && !Object.keys(groupsMap).length) this._renderDevicesTab(wrap);
                else preserveScroll(this.body, updateList);
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

            return h('div', { class: 'device-card' },
              h('div', { class: 'd-icon', style: { color: catColor } }, icon(catIcon)),
              h('div', { class: 'd-info' },
                h('div', { class: 'd-name' }, name),
                h('div', { class: 'd-meta' },
                  mfg ? h('span', { class: 'd-mfg' }, mfg) : null,
                  h('span', { class: 'badge-tag category', style: { '--badge-cat-color': catColor } }, icon(catIcon), catName))),
              h('div', { class: 'device-card-actions' },
                h('button', {
                  class: 'btn secondary small', type: 'button', title: 'Gerät bearbeiten', 'aria-label': 'Bearbeiten',
                  onClick: () => this.onOpenDevice?.(id),
                }, icon('mdi:pencil'), h('span', {}, 'Bearbeiten')),
                h('button', {
                  class: 'icon-btn danger', type: 'button', title: 'Einrichtung aufheben', 'aria-label': 'Einrichtung aufheben',
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
                      if (!configuredIds.length && !Object.keys(groupsMap).length) this._renderDevicesTab(wrap);
                      else preserveScroll(this.body, updateList);
                    } catch (err) {
                      showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
                    }
                  },
                }, icon('mdi:delete-outline'))));
          });

          return createDeviceRoomSection(areaName, [...groupCards, ...cards], groupCards.length + cards.length);
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
          class: 'btn primary', type: 'button',
          onClick: () => this.onOpenDevice?.(null),
        }, icon('mdi:plus-circle-outline'), 'Gerät einrichten'));

      updateList();
      wrap.replaceChildren(topRow, listEl);
    } catch (err) {
      wrap.replaceChildren(h('div', { class: 'empty' }, icon('mdi:alert'), h('div', {}, `Fehler: ${err.message || err}`)));
    }
  }
}

export { resolveColor };
