// Shared Room Configuration Form used identically by Settings ("Räume & Kacheln") and RoomEditModal (Edit Mode).
import {
  h, icon, ROOM_ICON_OPTIONS, ROOM_SENSOR_TYPES, preserveScroll,
} from '../lib/util.js';
import { IconPicker } from './icon_picker.js';
import { CustomDropdown } from './custom_dropdown.js';

export const EXPAND_OPTIONS = [
  ['collapsed', 'Eingeklappt'],
  ['expanded', 'Ausgeklappt'],
  ['always', 'Immer offen'],
];

function _roomSensorMeta(type) {
  return ROOM_SENSOR_TYPES.find((t) => t.value === type) || {
    value: type,
    label: type,
    icon: 'mdi:gauge',
    color: 'var(--cd-accent)',
  };
}

function _formatSensorLiveValue(hass, entityId) {
  const st = hass?.states?.[entityId];
  if (!st) return 'unbekannt';
  const unit = st.attributes?.unit_of_measurement;
  return unit ? `${st.state} ${unit}` : st.state;
}

function _sensorEntityLabel(hass, entityId) {
  return hass?.states?.[entityId]?.attributes?.friendly_name || entityId;
}

/**
 * Interactive selector for a sensor type with 2+ sensors in a room.
 */
export function buildSensorPrefBlock({ hass, type, entityIds, currentPref, onChange }) {
  const meta = _roomSensorMeta(type);
  const isBinary = type === 'motion' || type === 'moisture';

  let mode = currentPref?.mode === 'single' ? 'single' : 'average';
  let selected = Array.isArray(currentPref?.entities)
    ? currentPref.entities.filter((e) => entityIds.includes(e))
    : [];
  if (!selected.length) {
    selected = mode === 'single' ? [entityIds[0]] : [...entityIds];
  }

  const container = h('div', { class: 'sensor-pref-card' });

  const render = () => preserveScroll(container.closest?.('.dialog-body'), () => {
    const modeRow = h('div', { class: 'sensor-mode-tabs' },
      h('button', {
        type: 'button',
        class: `sensor-mode-tab${mode === 'single' ? ' active' : ''}`,
        onClick: () => {
          mode = 'single';
          selected = [selected[0] || entityIds[0]];
          onChange({ mode, entities: [...selected] });
          render();
        },
      }, icon('mdi:radiobox-marked'), 'Einzelner Sensor'),
      h('button', {
        type: 'button',
        class: `sensor-mode-tab${mode === 'average' ? ' active' : ''}`,
        onClick: () => {
          mode = 'average';
          if (selected.length < 2) selected = [...entityIds];
          onChange({ mode, entities: [...selected] });
          render();
        },
      }, icon(isBinary ? 'mdi:checkbox-multiple-marked' : 'mdi:chart-line'), isBinary ? 'Kombiniert' : 'Durchschnitt'));

    const rows = entityIds.map((eid) => {
      const isChecked = mode === 'single' ? selected[0] === eid : selected.includes(eid);
      const name = _sensorEntityLabel(hass, eid);
      const liveVal = _formatSensorLiveValue(hass, eid);

      return h('div', {
        class: `sensor-choice-row${isChecked ? ' selected' : ''}`,
        onClick: () => {
          if (mode === 'single') {
            selected = [eid];
          } else {
            if (selected.includes(eid)) {
              if (selected.length <= 1) return;
              selected = selected.filter((id) => id !== eid);
            } else {
              selected = [...selected, eid];
            }
          }
          onChange({ mode, entities: [...selected] });
          render();
        },
      },
      h('div', { class: 'sensor-choice-check' },
        icon(mode === 'single'
          ? (isChecked ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank')
          : (isChecked ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'))),
      h('div', { class: 'sensor-choice-info' },
        h('div', { class: 'sensor-choice-name' }, name),
        h('div', { class: 'sensor-choice-id' }, eid)),
      h('span', { class: 'badge-tag' }, liveVal));
    });

    const hintText = mode === 'single'
      ? '• Nur ausgewählter Sensor aktiv'
      : (isBinary
        ? '• Auswahl kombiniert gemeldet'
        : `• Durchschnitt aus ${selected.length} von ${entityIds.length} Sensoren`);

    container.replaceChildren(
      h('div', { class: 'sensor-pref-head' },
        h('div', { class: 'sensor-pref-title', style: { color: meta.color } },
          icon(meta.icon),
          h('span', {}, meta.label)),
        h('span', { class: 'badge-tag' }, `${entityIds.length} Sensoren`)),
      modeRow,
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, hintText),
      h('div', { class: 'sensor-choice-list' }, ...rows),
    );
  });

  render();
  return container;
}

/** Ensures `user_expanded` and legacy `expanded_users` stay synchronized. */
export function normalizeUserExpanded(roomConfig) {
  roomConfig.user_expanded = (roomConfig.user_expanded && typeof roomConfig.user_expanded === 'object')
    ? { ...roomConfig.user_expanded }
    : {};
  if (Array.isArray(roomConfig.expanded_users)) {
    for (const uid of roomConfig.expanded_users) {
      if (uid && !roomConfig.user_expanded[uid]) {
        roomConfig.user_expanded[uid] = 'expanded';
      }
    }
  }
  syncExpandedUsers(roomConfig);
}

export function syncExpandedUsers(roomConfig) {
  const ue = roomConfig.user_expanded || {};
  roomConfig.expanded_users = Object.entries(ue)
    .filter(([, mode]) => mode === 'expanded')
    .map(([uid]) => uid);
}

/**
 * Shared room configuration editor (Name, Icon, Standard-Zustand global & pro HA-Benutzer, Sichtbarkeit, Sensoren).
 */
export class RoomSettingsForm {
  /**
   * @param {{
   *   hass: object,
   *   roomSpec: object,
   *   roomConfig: object,
   *   users: Array<{id:string, name?:string}>,
   *   onChange?: Function,
   *   onNameChange?: Function,
   *   onIconChange?: Function,
   * }} opts
   */
  constructor({ hass, roomSpec, roomConfig, users = [], onChange, onNameChange, onIconChange }) {
    this.hass = hass;
    this.roomSpec = roomSpec;
    this.roomConfig = roomConfig;
    this.users = Array.isArray(users) ? users : [];
    this.onChange = onChange;
    this.onNameChange = onNameChange;
    this.onIconChange = onIconChange;
    this._pickers = [];

    this.roomConfig.expanded ||= roomSpec.mode || 'collapsed';
    this.roomConfig.visible_users = Array.isArray(this.roomConfig.visible_users) ? [...this.roomConfig.visible_users] : [];
    if (!this.roomConfig.user_expanded && roomSpec.user_expanded) {
      this.roomConfig.user_expanded = { ...roomSpec.user_expanded };
    }
    if (!this.roomConfig.expanded_users && Array.isArray(roomSpec.expanded_users)) {
      this.roomConfig.expanded_users = [...roomSpec.expanded_users];
    }
    normalizeUserExpanded(this.roomConfig);

    this.roomConfig.sensor_prefs = (this.roomConfig.sensor_prefs && typeof this.roomConfig.sensor_prefs === 'object')
      ? { ...this.roomConfig.sensor_prefs }
      : { ...(roomSpec.sensor_prefs || {}) };

    this._build();
  }

  _track(p) {
    this._pickers.push(p);
    return p;
  }

  destroy() {
    for (const p of this._pickers) {
      try { p?.destroy?.(); } catch {}
    }
    this._pickers = [];
  }

  _build() {
    const { roomSpec, roomConfig, users } = this;
    const isUnassigned = roomSpec.area_id === '__none__';

    const nameInput = h('input', {
      type: 'text',
      value: roomConfig.name ?? roomSpec.name ?? '',
      placeholder: 'z. B. Wohnzimmer',
      disabled: isUnassigned,
      onInput: (e) => {
        const v = e.target.value;
        roomConfig.name = v;
        this.onNameChange?.(v);
        this.onChange?.();
      },
    });

    const iconPicker = this._track(new IconPicker({
      hass: this.hass,
      value: roomConfig.icon || roomSpec.icon || 'mdi:home-outline',
      placeholder: 'mdi:sofa-outline',
      options: ROOM_ICON_OPTIONS,
      onChange: (ic) => {
        const nextIcon = ic || 'mdi:home-outline';
        roomConfig.icon = nextIcon;
        this.onIconChange?.(nextIcon);
        this.onChange?.();
      },
    }));

    const userExpandWrap = h('div', { class: 'user-expand-list' });
    const renderUserExpand = () => {
      const globalMode = roomConfig.expanded || 'collapsed';
      if (globalMode === 'always') {
        userExpandWrap.replaceChildren(
          h('div', { class: 'hint' }, '• Bei „Immer offen“ für alle Benutzer geöffnet'),
        );
        return;
      }
      if (!users.length) {
        userExpandWrap.replaceChildren(
          h('div', { class: 'hint' }, '• Keine Benutzer geladen'),
        );
        return;
      }
      const choices = [
        ['default', 'Global'],
        ['collapsed', 'Eingeklappt'],
        ['expanded', 'Ausgeklappt'],
      ];
      userExpandWrap.replaceChildren(...users.map((u) => {
        const uid = u.id;
        const cur = roomConfig.user_expanded?.[uid] || 'default';
        return h('div', { class: 'user-expand-row' },
          h('div', { class: 'user-expand-name' }, icon('mdi:account-outline'), h('span', {}, u.name || uid)),
          h('div', { class: 'tri-pills', role: 'group', 'aria-label': `Standard-Zustand für ${u.name || uid}` },
            ...choices.map(([val, lbl]) => h('button', {
              type: 'button',
              class: 'tri-pill',
              ...(cur === val ? { 'data-active': '' } : {}),
              onClick: () => {
                roomConfig.user_expanded ||= {};
                if (val === 'default') delete roomConfig.user_expanded[uid];
                else roomConfig.user_expanded[uid] = val;
                syncExpandedUsers(roomConfig);
                renderUserExpand();
                this.onChange?.();
              },
            }, lbl))));
      }));
    };

    const expandDropdown = this._track(new CustomDropdown({
      options: EXPAND_OPTIONS.map(([v, l]) => ({ value: v, label: l })),
      value: roomConfig.expanded || 'collapsed',
      onChange: (v) => {
        roomConfig.expanded = v;
        renderUserExpand();
        this.onChange?.();
      },
    }));
    renderUserExpand();

    // Visible users chips
    const visibleWrap = h('div', { class: 'user-chips' });
    const renderVisibleChips = () => {
      if (!users.length) {
        visibleWrap.replaceChildren(h('div', { class: 'hint' }, '• Für alle Benutzer sichtbar'));
        return;
      }
      visibleWrap.replaceChildren(...users.map((u) => {
        const active = roomConfig.visible_users.includes(u.id);
        return h('button', {
          type: 'button',
          class: 'user-chip',
          ...(active ? { 'data-on': '' } : {}),
          onClick: () => {
            const idx = roomConfig.visible_users.indexOf(u.id);
            if (idx >= 0) roomConfig.visible_users.splice(idx, 1);
            else roomConfig.visible_users.push(u.id);
            renderVisibleChips();
            this.onChange?.();
          },
        }, u.name || u.id);
      }));
    };
    renderVisibleChips();

    // Room sensors
    const allSensors = roomSpec.all_sensors || {};
    const sensorTypes = Object.keys(allSensors);
    const sensorBlocks = [];
    for (const sType of sensorTypes) {
      const eids = allSensors[sType] || [];
      if (eids.length >= 2) {
        sensorBlocks.push(buildSensorPrefBlock({
          hass: this.hass,
          type: sType,
          entityIds: eids,
          currentPref: roomConfig.sensor_prefs[sType],
          onChange: (pref) => {
            roomConfig.sensor_prefs[sType] = pref;
            this.onChange?.();
          },
        }));
      } else if (eids.length === 1) {
        const meta = _roomSensorMeta(sType);
        sensorBlocks.push(h('div', { class: 'sensor-pref-card' },
          h('div', { class: 'sensor-pref-head', style: { marginBottom: '0' } },
            h('div', { class: 'sensor-pref-title', style: { color: meta.color } },
              icon(meta.icon),
              h('span', {}, `${meta.label}: ${_sensorEntityLabel(this.hass, eids[0])}`)),
            h('span', { class: 'badge-tag' }, _formatSensorLiveValue(this.hass, eids[0])))));
      }
    }

    this.el = h('div', { class: 'room-settings-form' },
      h('div', { class: 'fields' },
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, isUnassigned ? 'Raumname (System)' : 'Raumname'),
          nameInput),
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Raum-Icon'),
          iconPicker.el)),
      h('div', { class: 'fields' },
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Standard-Zustand (Global)'),
          expandDropdown.el),
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Sichtbar für Benutzer (leer = alle)'),
          visibleWrap)),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Standard-Zustand pro Benutzer'),
        userExpandWrap),
      sensorBlocks.length ? h('div', { class: 'section-title' }, 'Raumsensoren') : null,
      ...sensorBlocks);
  }
}
