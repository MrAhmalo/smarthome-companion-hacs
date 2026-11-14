// Shared modals for Room Editing (Edit Mode) and Dynamic Sensor Conflict Resolution.
import {
  h, icon, showConfirmDialog, showToast,
} from '../lib/util.js';
import { RoomSettingsForm, buildSensorPrefBlock, syncExpandedUsers } from './room_settings_form.js';

export { buildSensorPrefBlock };

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

  destroy() {
    this.el?.remove();
    this.el = null;
  }

  _build() {
    const blocks = this.conflicts.map((c) => buildSensorPrefBlock({
      hass: this.hass,
      type: c.type,
      entityIds: c.entityIds,
      currentPref: this.prefs[c.type],
      onChange: (next) => { this.prefs[c.type] = next; },
    }));

    const saveBtn = h('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => {
        if (this._saving) return;
        this._saving = true;
        saveBtn.disabled = true;
        this.destroy();
        this.onSave?.(this.prefs);
      },
    }, icon('mdi:check'), 'Übernehmen');

    this.el = h('div', {
      class: 'overlay',
      onClick: (e) => {
        if (e.target === this.el) {
          this.destroy();
          this.onCancel?.();
        }
      },
    },
    h('div', { class: 'dialog room-modal-dialog', role: 'dialog', 'aria-label': 'Mehrere Raumsensoren erkannt' },
      h('div', { class: 'dialog-head' },
        icon('mdi:thermometer-lines'),
        h('h2', {}, `Sensoren in „${this.areaName}“`),
        h('button', {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Schließen',
          onClick: () => {
            this.destroy();
            this.onCancel?.();
          },
        }, icon('mdi:close'))),
      h('div', { class: 'dialog-body' },
        h('div', { class: 'hint', style: { marginBottom: '12px' } },
          '• Mehrere Sensoren gleichen Typs erkannt\n• Einzelauswahl oder Durchschnitt festlegen'),
        ...blocks),
      h('div', { class: 'dialog-foot' },
        h('button', {
          type: 'button',
          class: 'btn',
          onClick: () => {
            this.destroy();
            this.onCancel?.();
          },
        }, 'Abbrechen'),
        saveBtn)));
  }
}

/**
 * Full Room Edit Modal triggered by clicking a room header in Edit Mode.
 * Shares RoomSettingsForm identically with Settings -> "Räume & Kacheln".
 */
export class RoomEditModal {
  constructor({ hass, roomSpec, users = [], onClose, onSaved }) {
    this.hass = hass;
    this.roomSpec = roomSpec;
    this.users = users;
    this.onClose = onClose;
    this.onSaved = onSaved;
    this._saving = false;

    this.roomConfig = {
      name: roomSpec.name || '',
      icon: roomSpec.icon || 'mdi:home-outline',
      expanded: roomSpec.mode || 'collapsed',
      visible_users: Array.isArray(roomSpec.visible_users) ? [...roomSpec.visible_users] : [],
      expanded_users: Array.isArray(roomSpec.expanded_users) ? [...roomSpec.expanded_users] : [],
      user_expanded: (roomSpec.user_expanded && typeof roomSpec.user_expanded === 'object') ? { ...roomSpec.user_expanded } : {},
      sensor_prefs: (roomSpec.sensor_prefs && typeof roomSpec.sensor_prefs === 'object') ? { ...roomSpec.sensor_prefs } : {},
    };
    this._build();
  }

  destroy() {
    this.form?.destroy?.();
    this.form = null;
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    this.el?.remove();
    this.el = null;
  }

  _build() {
    const isUnassigned = this.roomSpec.area_id === '__none__';

    this.form = new RoomSettingsForm({
      hass: this.hass,
      roomSpec: this.roomSpec,
      roomConfig: this.roomConfig,
      users: this.users,
    });

    const deleteBtn = !isUnassigned ? h('button', {
      type: 'button',
      class: 'btn danger',
      onClick: () => this._confirmDelete(),
    }, icon('mdi:delete-outline'), 'Raum löschen') : null;

    this.saveBtn = h('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => this._save(),
    }, icon('mdi:content-save'), 'Speichern');

    this.el = h('div', {
      class: 'overlay',
      onClick: (e) => { if (e.target === this.el) this._close(); },
    },
    h('div', { class: 'dialog room-modal-dialog', role: 'dialog', 'aria-label': `Raum bearbeiten: ${this.roomSpec.name}` },
      h('div', { class: 'dialog-head' },
        icon(this.roomConfig.icon || 'mdi:home-outline'),
        h('h2', {}, `Raum „${this.roomSpec.name}“`),
        h('button', {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Schließen',
          onClick: () => this._close(),
        }, icon('mdi:close'))),
      h('div', { class: 'dialog-body' },
        this.form.el),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'dialog-foot-actions' }, deleteBtn),
        h('div', { class: 'dialog-foot-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => this._close() }, 'Abbrechen'),
          this.saveBtn))));

    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this._close();
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  _close() {
    this.destroy();
    this.onClose?.();
  }

  async _confirmDelete() {
    const conf = await showConfirmDialog(this.el, {
      title: 'Raum löschen?',
      message: `Raum „${this.roomSpec.name}“ löschen?\n• Zugewiesene Geräte bleiben erhalten\n• Verschiebung nach „Nicht zugeordnet“`,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!conf) return;
    await this._deleteRoom();
  }

  async _deleteRoom() {
    if (this._saving) return;
    this._saving = true;
    const areaId = this.roomSpec.area_id;
    try {
      try {
        const res = await this.hass.callWS({
          type: 'smarthome_companion/dashboard/room_delete',
          area_id: areaId,
        });
        if (res?.save_failed) throw new Error('Löschen fehlgeschlagen');
      } catch (wsErr) {
        if (!/unknown_command|not found|unknown command/i.test(String(wsErr?.code || wsErr?.message || wsErr))) {
          throw wsErr;
        }
        if (areaId && areaId !== '__none__') {
          await this.hass.callWS({ type: 'config/area_registry/delete', area_id: areaId });
        }
        const data = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
        const config = data?.config || {};
        if (config.rooms && areaId in config.rooms) delete config.rooms[areaId];
        if (Array.isArray(config.room_order)) config.room_order = config.room_order.filter((id) => id !== areaId);
        if (config.tile_order && areaId in config.tile_order) delete config.tile_order[areaId];
        await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config });
      }

      this.destroy();
      this.onSaved?.();
    } catch (err) {
      this._saving = false;
      console.error('[RoomEditModal] delete failed', err);
      showToast(this.el, `Fehler: ${err?.message || err}`, { error: true });
    }
  }

  async _save() {
    if (this._saving) return;
    this._saving = true;
    this.saveBtn.disabled = true;
    const areaId = this.roomSpec.area_id;
    const trimmedName = (this.roomConfig.name || '').trim();
    const isUnassigned = areaId === '__none__';
    syncExpandedUsers(this.roomConfig);

    try {
      try {
        const payload = {
          type: 'smarthome_companion/dashboard/room_update',
          area_id: areaId,
          icon: this.roomConfig.icon,
          sensor_prefs: this.roomConfig.sensor_prefs,
          expanded: this.roomConfig.expanded,
          expanded_users: this.roomConfig.expanded_users,
          user_expanded: this.roomConfig.user_expanded,
          visible_users: this.roomConfig.visible_users,
        };
        if (!isUnassigned && trimmedName) {
          payload.name = trimmedName;
        }
        const res = await this.hass.callWS(payload);
        if (res?.save_failed) throw new Error('Speichern fehlgeschlagen');
      } catch (wsErr) {
        if (!/unknown_command|not found|unknown command/i.test(String(wsErr?.code || wsErr?.message || wsErr))) {
          throw wsErr;
        }
        if (areaId && !isUnassigned) {
          try {
            const areaUpdate = {
              type: 'config/area_registry/update',
              area_id: areaId,
              icon: this.roomConfig.icon,
            };
            if (trimmedName && trimmedName !== this.roomSpec.name) {
              areaUpdate.name = trimmedName;
            }
            await this.hass.callWS(areaUpdate);
          } catch (_) { /* non-fatal in dev mode */ }
        }
        const data = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
        const config = data?.config || {};
        config.rooms ||= {};
        config.rooms[areaId] = {
          ...(config.rooms[areaId] || {}),
          icon: this.roomConfig.icon,
          sensor_prefs: this.roomConfig.sensor_prefs,
          expanded: this.roomConfig.expanded,
          expanded_users: this.roomConfig.expanded_users,
          user_expanded: this.roomConfig.user_expanded,
          visible_users: this.roomConfig.visible_users,
        };
        const res = await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config });
        if (res?.save_failed) throw new Error('Speichern fehlgeschlagen');
      }

      this.destroy();
      this.onSaved?.();
    } catch (err) {
      this._saving = false;
      this.saveBtn.disabled = false;
      console.error('[RoomEditModal] save failed', err);
      showToast(this.el, `Fehler: ${err?.message || err}`, { error: true });
    }
  }
}
