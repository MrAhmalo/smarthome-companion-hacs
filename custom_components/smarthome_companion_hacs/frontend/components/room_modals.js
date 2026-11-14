// Shared modals for Room Editing (Edit Mode) and Dynamic Sensor Conflict Resolution.
import {
  h, icon, ROOM_ICON_OPTIONS, ROOM_SENSOR_TYPES,
} from '../lib/util.js';
import { CustomDropdown } from './custom_dropdown.js';

function _sensorMeta(type) {
  return ROOM_SENSOR_TYPES.find((t) => t.value === type) || {
    value: type,
    label: type,
    icon: 'mdi:gauge',
    color: 'var(--cd-accent)',
  };
}

function _formatLiveValue(hass, entityId) {
  const st = hass?.states?.[entityId];
  if (!st) return 'unbekannt';
  const unit = st.attributes?.unit_of_measurement;
  return unit ? `${st.state} ${unit}` : st.state;
}

function _entityLabel(hass, entityId) {
  return hass?.states?.[entityId]?.attributes?.friendly_name || entityId;
}

/**
 * Renders an interactive selector for a sensor type with 2+ sensors in a room:
 * Mode A: Exclusive single sensor
 * Mode B: Average (or combined) of selected sensors via checkboxes
 */
export function buildSensorPrefBlock({ hass, type, entityIds, currentPref, onChange }) {
  const meta = _sensorMeta(type);
  const isBinary = type === 'motion' || type === 'moisture';

  let mode = currentPref?.mode === 'single' ? 'single' : 'average';
  let selected = Array.isArray(currentPref?.entities)
    ? currentPref.entities.filter((e) => entityIds.includes(e))
    : [];
  if (!selected.length) {
    selected = mode === 'single' ? [entityIds[0]] : [...entityIds];
  }

  const container = h('div', { class: 'sensor-pref-card' });

  const render = () => {
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
      const name = _entityLabel(hass, eid);
      const liveVal = _formatLiveValue(hass, eid);

      return h('div', {
        class: `sensor-choice-row${isChecked ? ' selected' : ''}`,
        onClick: () => {
          if (mode === 'single') {
            selected = [eid];
          } else {
            if (selected.includes(eid)) {
              if (selected.length <= 1) return; // keep at least 1 selected
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
      ? 'Nur der ausgewählte Sensor wird in der Raumkachel angezeigt.'
      : (isBinary
        ? 'Ausgewählte Sensoren werden gemeinsam für die Meldung berücksichtigt.'
        : `${selected.length} von ${entityIds.length} Sensoren fließen in den Durchschnittswert ein.`);

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
  };

  render();
  return container;
}

/**
 * Dynamic conflict resolution modal when adding a sensor of a type that already exists in the room.
 */
export class SensorConflictModal {
  constructor({ hass, areaName, conflicts, currentPrefs = {}, onSave, onCancel }) {
    this.hass = hass;
    this.areaName = areaName;
    this.conflicts = conflicts;
    this.prefs = { ...currentPrefs };
    this.onSave = onSave;
    this.onCancel = onCancel;
    this._saving = false;

    for (const c of conflicts) {
      if (!this.prefs[c.type]) {
        this.prefs[c.type] = { mode: 'average', entities: [...c.entityIds] };
      }
    }

    this._build();
  }

  _build() {
    const blocks = this.conflicts.map((c) => buildSensorPrefBlock({
      hass: this.hass,
      type: c.type,
      entityIds: c.entityIds,
      currentPref: this.prefs[c.type],
      onChange: (pref) => { this.prefs[c.type] = pref; },
    }));

    this.saveBtn = h('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => this._submit(),
    }, icon('mdi:check'), 'Auswahl übernehmen');

    this.el = h('div', { class: 'overlay', style: { zIndex: '1010' } },
      h('div', { class: 'dialog room-modal-dialog' },
        h('div', { class: 'dialog-head' },
          icon('mdi:tune-variant'),
          h('h2', {}, `Mehrere Sensoren in „${this.areaName}“`)),
        h('div', { class: 'dialog-body' },
          h('div', { class: 'hint', style: { marginBottom: '10px' } },
            'In diesem Raum sind mehrere Sensoren desselben Typs vorhanden. Wähle aus, ob ein einzelner Sensor exklusiv oder ein Durchschnitt ausgewählter Sensoren angezeigt werden soll.'),
          ...blocks),
        h('div', { class: 'dialog-foot', style: { justifyContent: 'flex-end' } },
          h('div', { class: 'dialog-foot-actions' },
            h('button', {
              type: 'button',
              class: 'btn',
              onClick: () => { this.el.remove(); this.onCancel?.(); },
            }, 'Standard (Alle)'),
            this.saveBtn))));
  }

  async _submit() {
    if (this._saving) return;
    this._saving = true;
    this.saveBtn.disabled = true;
    try {
      await this.onSave?.(this.prefs);
      this.el.remove();
    } catch (_) {
      this._saving = false;
      this.saveBtn.disabled = false;
    }
  }
}

/**
 * Room Edit Modal opened when clicking a room header in Dashboard Edit Mode.
 * Allows changing the room icon (via existing CustomDropdown) and sensor conflict/average preferences.
 */
export class RoomEditModal {
  constructor({ hass, roomSpec, onSaved, onClose }) {
    this.hass = hass;
    this.roomSpec = roomSpec;
    this.onSaved = onSaved;
    this.onClose = onClose;
    this.roomName = roomSpec.name || '';
    this.selectedIcon = roomSpec.icon || 'mdi:home-outline';
    this.sensorPrefs = JSON.parse(JSON.stringify(roomSpec.sensor_prefs || {}));
    this._saving = false;
    this._build();
  }

  _build() {
    const isUnassigned = this.roomSpec.area_id === '__none__';
    this.nameInput = h('input', {
      type: 'text',
      value: this.roomName,
      disabled: isUnassigned,
      placeholder: 'Raumname...',
      onInput: (e) => { this.roomName = e.target.value; },
    });

    const iconOptions = ROOM_ICON_OPTIONS.some((o) => o.value === this.selectedIcon)
      ? ROOM_ICON_OPTIONS
      : [{ value: this.selectedIcon, label: `Aktuell (${this.selectedIcon})`, icon: this.selectedIcon }, ...ROOM_ICON_OPTIONS];

    this.iconDropdown = new CustomDropdown({
      options: iconOptions,
      value: this.selectedIcon,
      searchable: true,
      placeholder: 'Raum-Icon wählen...',
      onChange: (val) => { this.selectedIcon = val; },
    });

    const allSensors = this.roomSpec.all_sensors || {};
    const sensorEntries = Object.entries(allSensors).filter(([, eids]) => Array.isArray(eids) && eids.length > 0);

    const sensorBlocks = sensorEntries.length
      ? sensorEntries.map(([type, eids]) => {
          if (eids.length > 1) {
            return buildSensorPrefBlock({
              hass: this.hass,
              type,
              entityIds: eids,
              currentPref: this.sensorPrefs[type],
              onChange: (pref) => { this.sensorPrefs[type] = pref; },
            });
          }
          const meta = _sensorMeta(type);
          const eid = eids[0];
          return h('div', { class: 'sensor-pref-card' },
            h('div', { class: 'sensor-pref-head' },
              h('div', { class: 'sensor-pref-title', style: { color: meta.color } },
                icon(meta.icon),
                h('span', {}, meta.label)),
              h('span', { class: 'badge-tag' }, _formatLiveValue(this.hass, eid))),
            h('div', { class: 'sensor-choice-row selected', style: { cursor: 'default' } },
              h('div', { class: 'sensor-choice-info' },
                h('div', { class: 'sensor-choice-name' }, _entityLabel(this.hass, eid)),
                h('div', { class: 'sensor-choice-id' }, eid))));
        })
      : [h('div', { class: 'hint' }, 'Diesem Raum sind aktuell keine Raumsensoren zugewiesen. Sensoren können über „Gerät hinzufügen“ eingerichtet werden.')];

    this.saveBtn = h('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => this._save(),
    }, icon('mdi:content-save'), 'Speichern');

    const deleteBtn = !isUnassigned ? h('button', {
      type: 'button',
      class: 'btn danger',
      onClick: () => this._confirmDelete(),
    }, icon('mdi:delete-outline'), 'Raum löschen') : null;

    this.el = h('div', {
      class: 'overlay',
      style: { zIndex: '1010' },
      onClick: (e) => { if (e.target === this.el) this._close(); },
    },
    h('div', { class: 'dialog room-modal-dialog' },
      h('div', { class: 'dialog-head' },
        icon(this.selectedIcon),
        h('h2', {}, `Raum bearbeiten: ${this.roomSpec.name}`),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': 'Schließen',
          onClick: () => this._close(),
        }, icon('mdi:close'))),
      h('div', { class: 'dialog-body' },
        isUnassigned ? null : h('div', { class: 'section-title' }, 'Raumname'),
        isUnassigned ? null : h('div', { class: 'field', style: { marginBottom: '10px' } }, this.nameInput),
        h('div', { class: 'section-title' }, 'Raum-Icon'),
        h('div', { class: 'field', style: { marginBottom: '10px', zIndex: '20' } }, this.iconDropdown.el),
        h('div', { class: 'section-title' }, 'Raumsensoren & Durchschnitt'),
        ...sensorBlocks),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'dialog-foot-actions' }, deleteBtn),
        h('div', { class: 'dialog-foot-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => this._close() }, 'Abbrechen'),
          this.saveBtn))));
  }

  _close() {
    this.iconDropdown?.destroy();
    this.el.remove();
    this.onClose?.();
  }

  _confirmDelete() {
    const confirmOverlay = h('div', {
      class: 'overlay',
      style: { zIndex: '1020' },
      onClick: (e) => { if (e.target === confirmOverlay) confirmOverlay.remove(); },
    },
    h('div', { class: 'dialog room-modal-dialog', style: { maxWidth: '440px' } },
      h('div', { class: 'dialog-head' },
        icon('mdi:alert-outline'),
        h('h2', {}, 'Raum löschen?')),
      h('div', { class: 'dialog-body' },
        h('div', { class: 'hint', style: { fontSize: '14px', color: 'var(--primary-text-color, #fff)', lineHeight: '1.5' } },
          `Möchtest du den Raum „${this.roomSpec.name}“ wirklich löschen?\n\nDer Raum wird entfernt, alle zugeordneten Geräte und Sensoren bleiben erhalten und werden automatisch nach „Nicht zugeordnet“ verschoben.`)),
      h('div', { class: 'dialog-foot', style: { justifyContent: 'flex-end' } },
        h('div', { class: 'dialog-foot-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => confirmOverlay.remove() }, 'Abbrechen'),
          h('button', {
            type: 'button',
            class: 'btn danger',
            onClick: async () => {
              confirmOverlay.remove();
              await this._deleteRoom();
            },
          }, icon('mdi:delete-outline'), 'Endgültig löschen')))));
    this.el.append(confirmOverlay);
  }

  async _deleteRoom() {
    if (this._saving) return;
    this._saving = true;
    const areaId = this.roomSpec.area_id;
    try {
      if (areaId && areaId !== '__none__') {
        await this.hass.callWS({
          type: 'config/area_registry/delete',
          area_id: areaId,
        });
      }

      const data = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
      const config = data?.config || {};
      if (config.rooms && areaId in config.rooms) {
        delete config.rooms[areaId];
      }
      if (Array.isArray(config.room_order)) {
        config.room_order = config.room_order.filter((id) => id !== areaId);
      }
      if (config.tile_order && areaId in config.tile_order) {
        delete config.tile_order[areaId];
      }
      await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config });

      this.iconDropdown?.destroy();
      this.el.remove();
      this.onSaved?.();
    } catch (err) {
      this._saving = false;
      console.error('[RoomEditModal] delete failed', err);
    }
  }

  async _save() {
    if (this._saving) return;
    this._saving = true;
    this.saveBtn.disabled = true;
    const areaId = this.roomSpec.area_id;
    const trimmedName = (this.roomName || '').trim();
    try {
      if (areaId && areaId !== '__none__') {
        try {
          const areaUpdate = {
            type: 'config/area_registry/update',
            area_id: areaId,
            icon: this.selectedIcon,
          };
          if (trimmedName && trimmedName !== this.roomSpec.name) {
            areaUpdate.name = trimmedName;
          }
          await this.hass.callWS(areaUpdate);
        } catch (_) {
          // Non-fatal in mock/dev mode
        }
      }

      const data = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
      const config = data?.config || {};
      config.rooms ||= {};
      config.rooms[areaId] ||= {};
      config.rooms[areaId].icon = this.selectedIcon;
      config.rooms[areaId].sensor_prefs = this.sensorPrefs;

      const res = await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config });
      if (res?.save_failed) throw new Error('Speichern fehlgeschlagen');

      this.iconDropdown?.destroy();
      this.el.remove();
      this.onSaved?.();
    } catch (err) {
      this._saving = false;
      this.saveBtn.disabled = false;
      console.error('[RoomEditModal] save failed', err);
    }
  }
}
