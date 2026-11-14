import { h, icon, domainOf, ROOM_ICON_OPTIONS, ROOM_SENSOR_TYPES, parseChannelKey, preserveScroll, showToast, showConfirmDialog } from '../lib/util.js';
import { EntityPicker } from './entity_picker.js';
import { CustomDropdown } from './custom_dropdown.js';
import { IconPicker } from './icon_picker.js';
import { SensorConflictModal } from './room_modals.js';
import { DEVICE_CATEGORIES, isControllableActuator, createGroupCard, createWizardDeviceElements, createDeviceRoomSection } from './device_list.js';

export class DeviceWizard {
  /**
   * @param {{hass:object, initialDeviceId?:string, onClose:Function, onSaved:Function}} opts
   */
  constructor({ hass, initialDeviceId, initialGroupId, onClose, onSaved }) {
    this.hass = hass;
    this.initialDeviceId = initialDeviceId || null;
    this.initialGroupId = initialGroupId || null;
    this.directMode = !!(this.initialDeviceId || this.initialGroupId);
    this.onClose = onClose;
    this.onSaved = onSaved;

    this.step = 0; // 0=Gerät, 1=Details, 2=Kanäle, 3=Prüfen
    this.steps = ['Gerät', 'Details', 'Kanäle', 'Prüfen'];

    this.devices = [];
    this.entities = [];
    this.areas = [];
    this.configuredDevices = {};
    this.categories = {};

    this.selectedDevice = null;
    this.customName = '';
    this.selectedAreaId = '';
    this.selectedCategory = 'schalter';
    this.renameInHA = true;
    this.forceOwnRow = false;

    // Channels / sub-entities
    this.channels = []; // [{ entity_id, enabled, name, category, power, energy, presence_simulation, unique_id }]
    this.primaryEntityId = '';
    this.powerEntityId = '';
    this.energyEntityId = '';

    this.searchQuery = '';
    this.statusFilter = 'unconfigured'; // 'unconfigured' | 'all' | 'configured'
    this.selectedDevices = new Set();
    this._expandedDeviceChannels = new Set();
    this.groups = {};

    this.isCelebration = false;
    this._dropdowns = [];

    this._build();
    this._load();
  }

  destroy() {
    this._cleanupDropdowns();
    this.el?.remove();
  }

  _closeWizard() {
    this._cleanupDropdowns();
    this.onClose?.();
  }

  _build() {
    this.body = h('div', { class: 'dialog-body' });
    this.stepBar = h('div', { class: 'wizard-steps' });
    this.selectionSlot = h('div', { class: 'wizard-selection-slot' });
    this.foot = h('div', { class: 'dialog-foot' });

    this.dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Gerät einrichten', hidden: !!this.initialGroupId },
      h('div', { class: 'dialog-head' },
        icon('mdi:plus-circle-outline'),
        h('h2', {}, 'Gerät einrichten'),
        h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => this._closeWizard() }, icon('mdi:close'))),
      this.stepBar,
      this.body,
      this.selectionSlot,
      this.foot);

    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this._closeWizard(); } }, this.dialog);
  }

  async _load() {
    this.body.replaceChildren(h('div', { class: 'empty' }, icon('mdi:loading'), h('div', { style: { marginTop: '8px' } }, 'Lade Geräte')));
    try {
      const [devs, ents, areas, setup, dash] = await Promise.all([
        this.hass.callWS({ type: 'config/device_registry/list' }),
        this.hass.callWS({ type: 'config/entity_registry/list' }),
        this.hass.callWS({ type: 'config/area_registry/list' }),
        this.hass.callWS({ type: 'smarthome_companion/devices/get' }).catch(() => ({ devices: {}, categories: {} })),
        this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true }).catch(() => null),
      ]);
      this.devices = devs || [];
      this.entities = ents || [];
      this.areas = areas || [];
      this.configuredDevices = setup.devices || {};
      this.categories = setup.categories || {};
      this.groups = setup.groups || {};
      this._dashboardRooms = dash?.layout?.rooms || [];
      this._dashboardConfig = dash?.config || {};

      if (this.initialDeviceId) {
        const parsed = parseChannelKey(this.initialDeviceId);
        const lookupId = parsed.deviceId || parsed.entityId || this.initialDeviceId;
        let target = this.devices.find((d) => d.id === lookupId);
        if (!target && parsed.entityId) {
          const ent = this.entities.find((e) => e.entity_id === parsed.entityId);
          if (ent?.device_id) {
            target = this.devices.find((d) => d.id === ent.device_id);
          }
        }
        if (!target) {
          const ent = this.entities.find((e) => e.entity_id === lookupId);
          if (ent?.device_id) {
            target = this.devices.find((d) => d.id === ent.device_id);
          }
        }
        if (target) {
          this.selectedDevice = target;
          this._initDevice();
          this.step = 1;
        }
      }

      if (this.initialGroupId && this.groups?.[this.initialGroupId]) {
        this.dialog.hidden = true;
        this._openGroupModal(this.groups[this.initialGroupId], true);
        return;
      }

      this._render();
    } catch (err) {
      this.body.replaceChildren(h('div', { class: 'empty' }, icon('mdi:alert'), h('div', {}, `Ladefehler: ${err.message || err}`)));
    }
  }

  _render() {
    this._cleanupDropdowns();
    this.selectionSlot.replaceChildren();
    if (this.body) this.body.scrollTop = 0;
    if (this.isCelebration) {
      this._renderCelebration();
      return;
    }
    const curCat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const catColor = (this.step > 0 && curCat?.color) ? curCat.color : '#2196F3';
    this.dialog.style.setProperty('--hero-color', catColor);

    this._renderSteps();
    this._renderBody();
    this._renderFoot();
  }

  _cleanupDropdowns() {
    this._dropdowns.forEach((d) => d.destroy?.());
    this._dropdowns = [];
  }

  _renderSteps() {
    this.stepBar.hidden = false;
    this.stepBar.replaceChildren(...this.steps.map((name, i) => {
      const el = h('div', { class: 'wizard-step' },
        h('div', {}, `${i + 1}. ${name}`),
        h('div', { class: 'wizard-bar' }));
      if (i === this.step) el.dataset.active = '';
      else if (i < this.step) el.dataset.done = '';
      return el;
    }));
  }

  _renderFoot() {
    this.foot.hidden = false;
    const isFirst = this.step === 0;
    const isLast = this.step === this.steps.length - 1;
    const isConfigured = !!(this.selectedDevice && this.configuredDevices[this.selectedDevice.id]);

    const leftActions = [];
    if (isFirst || (this.initialDeviceId && this.step === 1)) {
      leftActions.push(h('button', { class: 'btn', onClick: () => this._closeWizard() }, 'Abbrechen'));
      if (!isFirst && isConfigured) {
        leftActions.push(h('button', {
          class: 'btn danger',
          title: 'Einrichtung aufheben',
          onClick: () => this._removeDevice(this.selectedDevice.id, this.customName),
        }, icon('mdi:delete-outline'), 'Entfernen'));
      }
    } else {
      leftActions.push(h('button', { class: 'btn', onClick: () => { this.step--; this._render(); } }, icon('mdi:chevron-left'), 'Zurück'));
      if (isConfigured) {
        leftActions.push(h('button', {
          class: 'btn danger',
          title: 'Einrichtung aufheben',
          onClick: () => this._removeDevice(this.selectedDevice.id, this.customName),
        }, icon('mdi:delete-outline'), 'Entfernen'));
      }
    }

    const rightActions = [];
    if (isFirst) {
      rightActions.push(h('button', {
        class: 'btn primary', disabled: !this.selectedDevice,
        onClick: () => { if (this.selectedDevice) { this._initDevice(); this.step = 1; this._render(); } },
      }, 'Weiter', icon('mdi:chevron-right')));
    } else if (!isLast) {
      rightActions.push(h('button', {
        class: 'btn primary',
        onClick: () => { this.step++; this._render(); },
      }, 'Weiter', icon('mdi:chevron-right')));
    } else {
      rightActions.push(h('button', {
        class: 'btn success', disabled: this._saving,
        onClick: () => this._save(),
      }, icon('mdi:check'), this._saving ? 'Speichert...' : 'Speichern'));
    }

    const leftWrap = h('div', { class: 'dialog-foot-actions' }, ...leftActions);
    const rightWrap = h('div', { class: 'dialog-foot-actions' }, ...rightActions);
    this.foot.replaceChildren(leftWrap, rightWrap);
  }

  async _removeDevice(deviceId, name) {
    const devName = name || this.customName || 'Gerät';
    const confirmed = await showConfirmDialog(this.el, {
      title: 'Einrichtung aufheben',
      message: `„${devName}“ entfernen? HA-Gerät bleibt bestehen.`,
      confirmLabel: 'Entfernen',
      cancelLabel: 'Abbrechen',
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await this.hass.callWS({
        type: 'smarthome_companion/devices/remove',
        device_id: deviceId,
      });
      if (res?.save_failed) throw new Error('Löschen fehlgeschlagen');

      delete this.configuredDevices[deviceId];
      if (this.directMode) {
        this._cleanupDropdowns();
        this.onSaved(null);
        return;
      }
      if (this.selectedDevice?.id === deviceId) {
        this.selectedDevice = null;
        this.step = 0;
      }

      this._render();
      this.onSaved(null);
    } catch (err) {
      showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
    }
  }

  _isCandidateDevice(d) {
    if (d.disabled_by || d.entry_type === 'service') return false;
    const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
    const controllable = devEntities.filter(isControllableActuator);
    const sensors = devEntities.filter((e) => ['sensor', 'binary_sensor'].includes(domainOf(e.entity_id)));
    if (!controllable.length && !sensors.length) return false;
    const name = (d.name_by_user || d.name || '').toLowerCase();
    const mfg = (d.manufacturer || '').toLowerCase();
    const model = (d.model || '').toLowerCase();
    const isSystem = (
      name.includes('hacs') || mfg.includes('hacs') ||
      name.includes('forecast') || mfg.includes('met.no') ||
      name.includes('bluetooth') || mfg.includes('bluetooth') || name.startsWith('hci') ||
      name.includes('plugin') || model.includes('plugin') ||
      mfg.includes('integration') || model.includes('integration') ||
      name === 'sun'
    );
    if (isSystem && !controllable.length) return false;
    return true;
  }

  // ═══════════════ STEP 0: Gerät auswählen ═══════════════
  _renderStep0() {
    const candidates = this.devices.filter((d) => this._isCandidateDevice(d));
    const configuredCount = candidates.filter((d) => !!this.configuredDevices[d.id]).length;
    const unconfiguredCount = candidates.length - configuredCount;
    const allCount = candidates.length;

    const searchInput = h('input', {
      type: 'text', placeholder: 'Gerät oder Raum suchen', value: this.searchQuery,
      onInput: (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this._updateDeviceList(); },
    });
    const searchWrap = h('div', { class: 'search-bar' }, icon('mdi:magnify'), searchInput);

    const filterChips = h('div', { class: 'filter-chips' },
      ...[
        ['unconfigured', `Offen (${unconfiguredCount})`],
        ['configured', `Eingerichtet (${configuredCount})`],
        ['all', `Alle (${allCount})`],
      ].map(([id, label]) => h('button', {
        class: 'filter-chip', ...(id === this.statusFilter ? { 'data-active': '' } : {}),
        onClick: () => { this.statusFilter = id; this._renderStep0(); },
      }, label)));

    this.deviceListEl = h('div', { class: 'device-list' });
    this._updateDeviceList();

    this.body.replaceChildren(
      searchWrap,
      filterChips,
      this.deviceListEl);
  }

  _updateDeviceList() {
    const areaMap = new Map(this.areas.map((a) => [a.area_id, a.name]));
    const q = this.searchQuery;

    const filtered = this.devices.filter((d) => {
      if (!this._isCandidateDevice(d)) return false;

      const isConfigured = !!this.configuredDevices[d.id];
      if (this.statusFilter === 'unconfigured' && isConfigured) return false;
      if (this.statusFilter === 'configured' && !isConfigured) return false;

      if (!q) return true;
      const name = (d.name_by_user || d.name || '').toLowerCase();
      const mfg = (d.manufacturer || '').toLowerCase();
      const model = (d.model || '').toLowerCase();
      const area = (areaMap.get(d.area_id) || '').toLowerCase();
      return name.includes(q) || mfg.includes(q) || model.includes(q) || area.includes(q);
    });

    if (!filtered.length) {
      this.deviceListEl.replaceChildren(h('div', { class: 'empty' }, icon('mdi:devices'), h('div', {}, 'Keine Geräte')));
      this.selectionSlot.replaceChildren();
      return;
    }

    const groups = new Map();
    for (const d of filtered) {
      const areaName = areaMap.get(d.area_id) || 'Ohne Raum';
      if (!groups.has(areaName)) groups.set(areaName, []);
      groups.get(areaName).push(d);
    }

    // Also include rooms from groups (when filter shows configured/all and matches or no query)
    for (const g of Object.values(this.groups)) {
      if (q && !(g.name || '').toLowerCase().includes(q) && !(areaMap.get(g.area_id) || '').toLowerCase().includes(q)) continue;
      if (this.statusFilter === 'unconfigured') continue;
      const areaName = areaMap.get(g.area_id) || 'Ohne Raum';
      if (!groups.has(areaName)) groups.set(areaName, []);
    }

    const sortedGroupNames = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'Ohne Raum') return 1;
      if (b === 'Ohne Raum') return -1;
      return a.localeCompare(b);
    });

    const toggleSelectId = (id) => {
      preserveScroll(this.body, () => {
        if (this.selectedDevices.has(id)) this.selectedDevices.delete(id);
        else this.selectedDevices.add(id);
        this._updateDeviceList();
      });
    };

    const sections = sortedGroupNames.map((areaName) => {
      const devs = groups.get(areaName) || [];
      devs.sort((a, b) => {
        const nameA = (a.name_by_user || a.name || '').toLowerCase();
        const nameB = (b.name_by_user || b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      const roomGroups = Object.values(this.groups).filter((g) => {
        if (q && !(g.name || '').toLowerCase().includes(q) && !(areaMap.get(g.area_id) || '').toLowerCase().includes(q)) return false;
        const aName = areaMap.get(g.area_id) || 'Ohne Raum';
        return aName === areaName;
      });

      const groupCards = roomGroups.map((g) => createGroupCard({
        group: g,
        selectable: true,
        isSelected: this.selectedDevices.has(g.id),
        onToggleSelect: () => toggleSelectId(g.id),
        onCardClick: () => toggleSelectId(g.id),
        onEdit: () => this._openGroupModal(g),
        onDelete: () => this._removeGroup(g.id, g.name),
      }));

      const devCards = devs.flatMap((d) => {
        const name = d.name_by_user || d.name || 'Gerät';
        return createWizardDeviceElements({
          device: d,
          entities: this.entities,
          configuredCfg: this.configuredDevices[d.id],
          isSelected: this.selectedDevices.has(d.id),
          isExpanded: this._expandedDeviceChannels.has(d.id),
          selectedIds: this.selectedDevices,
          onToggleSelect: () => toggleSelectId(d.id),
          onToggleChannelSelect: (chKey) => toggleSelectId(chKey),
          onToggleExpand: () => {
            preserveScroll(this.body, () => {
              if (this._expandedDeviceChannels.has(d.id)) this._expandedDeviceChannels.delete(d.id);
              else this._expandedDeviceChannels.add(d.id);
              this._updateDeviceList();
            });
          },
          onConfigure: () => {
            this.selectedDevice = d;
            this._initDevice();
            this.step = 1;
            this._render();
          },
          onRemove: () => this._removeDevice(d.id, name),
          onCardClick: () => {
            if (this.selectedDevices.size > 0) {
              toggleSelectId(d.id);
              return;
            }
            this.selectedDevice = d;
            this._initDevice();
            this.step = 1;
            this._render();
          },
        });
      });

      const totalCount = groupCards.length + devs.length;
      const roomArea = this.areas.find((a) => a.name === areaName);
      const roomIcon = roomArea ? this._getRoomIcon(roomArea) : null;
      return createDeviceRoomSection(areaName, [...groupCards, ...devCards], totalCount, roomIcon);
    });

    this.deviceListEl.replaceChildren(...sections);

    if (this.selectedDevices.size > 0) {
      const selectedList = Array.from(this.selectedDevices);
      const names = selectedList.map((id) => {
        if (this.groups[id]) return this.groups[id].name;
        if (id.startsWith('d:')) {
          const parsed = parseChannelKey(id);
          const ent = this.entities.find((e) => e.entity_id === parsed.entityId);
          return ent?.name || ent?.original_name || parsed.entityId || id;
        }
        const d = this.devices.find((dev) => dev.id === id);
        return d?.name_by_user || d?.name || id;
      }).join(', ');

      const isSingle = selectedList.length === 1;
      const singleId = selectedList[0];
      const isSingleGroup = isSingle && !!this.groups[singleId];
      const allGroups = selectedList.length >= 2 && selectedList.every((id) => !!this.groups[id]);
      const hasExistingGroups = Object.keys(this.groups).length > 0;

      const buttons = [
        h('button', {
          class: 'btn secondary small',
          type: 'button',
          onClick: () => {
            preserveScroll(this.body, () => {
              this.selectedDevices.clear();
              this._updateDeviceList();
            });
          },
        }, 'Abbrechen'),
      ];

      if (isSingleGroup) {
        buttons.push(
          h('button', {
            class: 'btn secondary small',
            type: 'button',
            onClick: () => this._openGroupModal(this.groups[singleId]),
          }, icon('mdi:pencil'), 'Bearbeiten'),
          h('button', {
            class: 'btn danger small',
            type: 'button',
            onClick: () => this._removeGroup(singleId, this.groups[singleId].name),
          }, icon('mdi:delete-outline'), 'Auflösen')
        );
      } else if (isSingle) {
        if (hasExistingGroups) {
          buttons.push(
            h('button', {
              class: 'btn primary small',
              type: 'button',
              onClick: () => this._openAddToGroupModal(selectedList),
            }, icon('mdi:plus-box-multiple'), '+ Gruppe')
          );
        }
        buttons.push(
          h('button', {
            class: 'btn primary small',
            type: 'button',
            disabled: true,
            title: 'Mind. 2 Elemente wählen',
            style: { opacity: '0.45', cursor: 'not-allowed' },
          }, icon('mdi:lightbulb-group'), 'Gruppe (ab 2)')
        );
      } else {
        buttons.push(
          h('button', {
            class: 'btn primary small',
            type: 'button',
            onClick: () => this._openGroupModal(),
          }, icon(allGroups ? 'mdi:folder-multiple' : 'mdi:lightbulb-group'),
            h('span', { class: 'btn-label-desktop' }, allGroups ? 'Hauptgruppe' : 'Gruppieren'),
            h('span', { class: 'btn-label-mobile' }, allGroups ? 'Hauptgruppe' : 'Gruppe'))
        );
        if (hasExistingGroups && !allGroups) {
          buttons.push(
            h('button', {
              class: 'btn secondary small',
              type: 'button',
              onClick: () => this._openAddToGroupModal(selectedList),
            }, icon('mdi:plus-box-multiple'),
              h('span', { class: 'btn-label-desktop' }, '+ Gruppe'),
              h('span', { class: 'btn-label-mobile' }, '+ Gruppe'))
          );
        }
      }

      this.selectionSlot.replaceChildren(
        h('div', { class: 'selection-action-bar' },
          h('div', { class: 'sel-info' },
            h('span', { class: 'sel-count' }, `${selectedList.length} ausgewählt`),
            h('span', { class: 'sel-names' }, names)),
          h('div', { class: 'sel-buttons' }, ...buttons))
      );
    } else {
      this.selectionSlot.replaceChildren();
    }
  }

  _openAddToGroupModal(selectedIds) {
    const existingGroups = Object.values(this.groups);
    if (!existingGroups.length) return;

    const overlay = h('div', { class: 'overlay', style: { zIndex: '1200' } });
    const groupCards = existingGroups.map((g) => {
      const cat = DEVICE_CATEGORIES.find((c) => c.id === g.category);
      const catColor = cat?.color || '#ffc107';
      const a = this.areas.find((ar) => ar.area_id === g.area_id);
      const roomTxt = a ? ` · ${a.name}` : '';
      return h('div', {
        class: 'device-card group-card',
        style: { marginBottom: '8px' },
        onClick: async () => {
          const currentChildren = g.children || [];
          const updatedChildren = Array.from(new Set([...currentChildren, ...selectedIds]));
          try {
            await this.hass.callWS({
              type: 'smarthome_companion/groups/save',
              group: {
                ...g,
                children: updatedChildren,
              },
            });
            overlay.remove();
            this.selectedDevices.clear();
            this._load();
            this.onSaved?.(null);
          } catch (err) {
            showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
          }
        },
      },
      h('div', { class: 'd-icon', style: { color: catColor } }, icon(g.icon || 'mdi:lightbulb-group')),
      h('div', { class: 'd-info' },
        h('div', { class: 'd-name' }, g.name),
        h('div', { class: 'd-meta' },
          h('span', { class: 'badge-tag category', style: { '--badge-cat-color': catColor } },
            icon('mdi:lightbulb-group'), `Gruppe (${g.children?.length || 0})${roomTxt}`))),
      h('div', { style: { display: 'flex', alignItems: 'center' } }, icon('mdi:chevron-right')));
    });

    const dialog = h('div', { class: 'dialog group-modal-dialog' },
      h('div', { class: 'dialog-head' },
        icon('mdi:plus-box-multiple'),
        h('h2', {}, 'Zu Gruppe'),
        h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => overlay.remove() }, icon('mdi:close'))),
      h('div', { class: 'dialog-body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { class: 'hint' }, `${selectedIds.length} Element(e) hinzufügen`),
        ...groupCards),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'dialog-foot-actions' },
          h('button', { class: 'btn', onClick: () => overlay.remove() }, 'Abbrechen')))
    );
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.appendChild(dialog);
    this.el.appendChild(overlay);
  }

  _openGroupModal(existingGroup = null, isDirect = false) {
    let selectedIds = existingGroup ? [...(existingGroup.children || [])] : Array.from(this.selectedDevices);
    if (!existingGroup && selectedIds.length < 2) return;
    const isMultiGroup = !existingGroup && selectedIds.some((id) => !!this.groups[id]);

    let groupName = existingGroup ? existingGroup.name : (isMultiGroup ? 'Hauptgruppe' : 'Lichtgruppe');
    let defaultArea = existingGroup ? (existingGroup.area_id || '') : '';
    let detectedCat = existingGroup ? (existingGroup.category || 'leuchte') : 'leuchte';

    if (!existingGroup) {
      for (const id of selectedIds) {
        if (this.groups[id]?.area_id) { defaultArea = this.groups[id].area_id; }
        else if (id.startsWith('d:')) {
          const parsed = parseChannelKey(id);
          const dev = this.devices.find((d) => d.id === parsed.deviceId);
          if (dev?.area_id) defaultArea = dev.area_id;
        } else {
          const dev = this.devices.find((d) => d.id === id);
          if (dev?.area_id) defaultArea = dev.area_id;
          else {
            const ent = this.entities.find((e) => (e.device_id === id || e.entity_id === id) && e.area_id);
            if (ent?.area_id) defaultArea = ent.area_id;
          }
        }
        if (defaultArea) break;
      }

      for (const id of selectedIds) {
        if (this.groups[id]?.category) { detectedCat = this.groups[id].category; break; }
        const cfg = this.configuredDevices[id];
        if (cfg?.category) { detectedCat = cfg.category; break; }
      }
    }

    let selectedArea = defaultArea;
    let selectedCat = detectedCat;

    const overlay = h('div', { class: 'overlay', style: { zIndex: '1200' } });
    const nameInput = h('input', {
      type: 'text',
      class: 'dialog-input',
      value: groupName,
      placeholder: 'Gruppenname',
      style: { width: '100%', minHeight: '42px', padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(128,128,128,.3)', background: 'var(--cd-tile-bg)', color: 'var(--primary-text-color, inherit)', font: 'inherit', boxSizing: 'border-box' },
      onInput: (e) => { groupName = e.target.value.trim(); },
    });

    const areaOptions = [
      { value: '', label: 'Ohne Raum', icon: 'mdi:home-outline' },
      ...this.areas.map((a) => ({ value: a.area_id, label: a.name, icon: this._getRoomIcon(a) })),
    ];
    const catOptions = DEVICE_CATEGORIES.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color }));

    let selectedIcon = existingGroup?.icon || (selectedCat === 'leuchte' ? 'mdi:lightbulb-group' : 'mdi:power-plug');
    let isCustomIcon = !!existingGroup?.icon;

    const iconPicker = new IconPicker({
      hass: this.hass,
      value: selectedIcon,
      placeholder: 'Icon suchen',
      onChange: (v) => {
        selectedIcon = v;
        isCustomIcon = true;
      },
    });

    const areaDd = new CustomDropdown({
      options: areaOptions,
      value: selectedArea,
      placeholder: 'Raum',
      onChange: (v) => { selectedArea = v; },
    });

    const catDd = new CustomDropdown({
      options: catOptions,
      value: selectedCat,
      placeholder: 'Kategorie',
      onChange: (v) => {
        selectedCat = v;
        if (!isCustomIcon) {
          const catObj = DEVICE_CATEGORIES.find((c) => c.id === v);
          const defIcon = v === 'leuchte' ? 'mdi:lightbulb-group' : (catObj?.icon || 'mdi:power-plug');
          selectedIcon = defIcon;
          iconPicker._setValue(defIcon);
          isCustomIcon = false;
        }
      },
    });

    const getLabelForId = (id) => {
      if (this.groups[id]) return `${this.groups[id].name} (Gruppe)`;
      if (id.startsWith('d:')) {
        const parsed = parseChannelKey(id);
        const ent = this.entities.find((e) => e.entity_id === parsed.entityId);
        return ent?.name || ent?.original_name || parsed.entityId || id;
      }
      const dev = this.devices.find((d) => d.id === id);
      return dev?.name_by_user || dev?.name || id;
    };

    const countHeader = h('div', { class: 'field-label', style: { marginBottom: '6px' } }, `Elemente (${selectedIds.length})`);
    const tagsContainer = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });

    const renderTags = () => {
      const tags = selectedIds.map((id) => {
        const isG = !!this.groups[id];
        const label = getLabelForId(id);
        return h('span', { class: 'group-member-tag' },
          icon(isG ? 'mdi:folder-multiple' : 'mdi:lightbulb'),
          h('span', {}, label),
          h('button', {
            type: 'button',
            class: 'remove-btn',
            title: `${label} entfernen`,
            onClick: () => {
              selectedIds = selectedIds.filter((x) => x !== id);
              renderTags();
            },
          }, icon('mdi:close'))
        );
      });
      tagsContainer.replaceChildren(...tags);
      countHeader.textContent = `Elemente (${selectedIds.length})`;
    };
    renderTags();

    const availableToAdd = [];
    for (const [gid, g] of Object.entries(this.groups)) {
      if (existingGroup && gid === existingGroup.id) continue;
      if (!selectedIds.includes(gid)) {
        availableToAdd.push({ value: gid, label: `${g.name} (Gruppe)`, icon: 'mdi:folder-multiple' });
      }
    }
    for (const d of this.devices) {
      if (!selectedIds.includes(d.id)) {
        const dName = d.name_by_user || d.name || d.id;
        availableToAdd.push({ value: d.id, label: dName, icon: 'mdi:devices' });
      }
    }

    let addDropdownWrap = null;
    let addDd = null;
    if (availableToAdd.length > 0) {
      addDd = new CustomDropdown({
        options: availableToAdd,
        value: '',
        placeholder: '+ Element hinzufügen',
        onChange: (val) => {
          if (val && !selectedIds.includes(val)) {
            selectedIds.push(val);
            renderTags();
            addDd.setValue('');
          }
        },
      });
      addDropdownWrap = h('div', { style: { marginTop: '6px' } }, addDd.el);
    }

    const destroyPickers = () => {
      areaDd.destroy();
      catDd.destroy();
      addDd?.destroy();
      iconPicker.destroy();
    };

    const closeGroupModal = () => {
      overlay.remove();
      destroyPickers();
      if (isDirect) this._closeWizard();
    };
    if (isDirect) {
      overlay.style.background = 'transparent';
      overlay.style.backdropFilter = 'none';
      overlay.style.webkitBackdropFilter = 'none';
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeGroupModal();
    });

    const dialog = h('div', { class: 'dialog group-modal-dialog' },
      h('div', { class: 'dialog-head' },
        icon(isMultiGroup ? 'mdi:folder-multiple' : 'mdi:lightbulb-group'),
        h('h2', {}, existingGroup ? 'Gruppe bearbeiten' : (isMultiGroup ? 'Hauptgruppe' : 'Neue Gruppe')),
        h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: closeGroupModal }, icon('mdi:close'))),
      h('div', { class: 'dialog-body', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('div', { class: 'field' }, 'Gruppenname', nameInput),
        h('div', { class: 'field' }, 'Raum', areaDd.el),
        h('div', { class: 'field' }, 'Kategorie', catDd.el),
        h('div', { class: 'field' }, 'Icon', iconPicker.el),
        h('div', {},
          countHeader,
          tagsContainer,
          addDropdownWrap)),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'dialog-foot-actions' },
          h('button', { class: 'btn', onClick: closeGroupModal }, 'Abbrechen'),
          existingGroup ? h('button', {
            class: 'btn danger',
            type: 'button',
            onClick: async () => {
              const removed = await this._removeGroup(existingGroup.id, existingGroup.name, true);
              if (removed) {
                overlay.remove();
                destroyPickers();
                if (isDirect) this.onSaved?.(null);
                else this._load();
              }
            },
          }, icon('mdi:delete-outline'), 'Auflösen') : null),
        h('div', { class: 'dialog-foot-actions' },
          h('button', {
            class: 'btn primary',
            onClick: async () => {
              if (!groupName) { showToast(this.el, 'Name fehlt', { error: true }); return; }
              if (selectedIds.length === 0) { showToast(this.el, 'Mind. 1 Element wählen', { error: true }); return; }
              try {
                await this.hass.callWS({
                  type: 'smarthome_companion/groups/save',
                  group: {
                    ...(existingGroup ? { id: existingGroup.id } : {}),
                    name: groupName,
                    area_id: selectedArea,
                    category: selectedCat,
                    icon: selectedIcon || (selectedCat === 'leuchte' ? 'mdi:lightbulb-group' : 'mdi:power-plug'),
                    children: selectedIds,
                  },
                });
                overlay.remove();
                destroyPickers();
                this.selectedDevices.clear();
                if (isDirect) this.onSaved?.(null);
                else this._load();
              } catch (err) {
                showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
              }
            },
          }, icon('mdi:check'), 'Speichern')))
    );

    overlay.appendChild(dialog);
    this.el.appendChild(overlay);
  }

  async _removeGroup(groupId, groupName, skipReload = false) {
    const conf = await showConfirmDialog(this.el, {
      title: 'Gruppe auflösen',
      message: `Gruppe „${groupName}“ auflösen? Geräte bleiben erhalten.`,
      confirmLabel: 'Auflösen',
      cancelLabel: 'Abbrechen',
      danger: true,
    });
    if (!conf) return false;
    try {
      await this.hass.callWS({ type: 'smarthome_companion/groups/delete', group_id: groupId });
      delete this.groups[groupId];
      this.selectedDevices.delete(groupId);
      if (!skipReload) {
        this._load();
      }
      return true;
    } catch (err) {
      showToast(this.el, `Fehler: ${err.message || err}`, { error: true });
      return false;
    }
  }

  // ═══════════════ Strip Room Name Helper ═══════════════
  _stripRoomName(rawName, preferredAreaId) {
    if (!rawName) return '';
    let name = rawName;

    const candidateAreas = [];
    if (preferredAreaId) {
      const a = this.areas.find((ar) => ar.area_id === preferredAreaId);
      if (a) candidateAreas.push(a);
    }
    for (const a of this.areas) {
      if (!candidateAreas.includes(a)) candidateAreas.push(a);
    }

    for (const a of candidateAreas) {
      if (!a?.name) continue;
      const aName = a.name.trim();
      if (!aName || aName.length < 2) continue;

      const escaped = aName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixRegex = new RegExp(`^${escaped}\\s*[-_–—:]*\\s*`, 'i');
      const compoundPrefixRegex = new RegExp(`^${escaped}(?=[A-ZÄÖÜa-zäöü])`, 'i');
      const suffixRegex = new RegExp(`\\s*[-_–—:]*\\s*${escaped}$`, 'i');
      const midRegex = new RegExp(`\\s+[-_–—:]*\\s*${escaped}\\s*[-_–—:]*\\s+`, 'i');
      const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');

      let stripped = name;
      if (prefixRegex.test(stripped)) {
        stripped = stripped.replace(prefixRegex, '');
      } else if (compoundPrefixRegex.test(stripped)) {
        stripped = stripped.replace(compoundPrefixRegex, '');
      } else if (suffixRegex.test(stripped)) {
        stripped = stripped.replace(suffixRegex, '');
      } else if (midRegex.test(stripped)) {
        stripped = stripped.replace(midRegex, ' ');
      } else if (wordRegex.test(stripped)) {
        stripped = stripped.replace(wordRegex, '');
      }

      stripped = stripped.trim().replace(/\s{2,}/g, ' ').replace(/^[-_–—:\s]+|[-_–—:\s]+$/g, '');
      if (stripped.length > 0 && stripped.length < name.length) {
        name = stripped;
        if (!this.selectedAreaId) {
          this.selectedAreaId = a.area_id;
        }
        break;
      }
    }

    if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
    return name;
  }

  _detectSensorType(entity) {
    if (!entity || entity.entity_category === 'diagnostic' || entity.entity_category === 'config') {
      return 'ignore';
    }
    const st = this.hass?.states?.[entity.entity_id];
    const dc = st?.attributes?.device_class || entity.device_class || entity.original_device_class || '';
    const unit = st?.attributes?.unit_of_measurement || '';
    const dom = domainOf(entity.entity_id);
    if (dom === 'sensor') {
      if (dc === 'temperature' || unit === '°C' || unit === '°F') return 'temperature';
      if (dc === 'humidity') return 'humidity';
      return 'ignore';
    }
    if (dom === 'binary_sensor') {
      if (['motion', 'occupancy', 'presence'].includes(dc)) return 'motion';
      if (dc === 'moisture') return 'moisture';
      return 'ignore';
    }
    return 'ignore';
  }

  _isNewRoomForDevice(areaId) {
    if (!areaId) return false;
    const room = (this._dashboardRooms || []).find((r) => r.area_id === areaId);
    if (!room) return true;
    const hasTiles = Array.isArray(room.tiles) && room.tiles.length > 0;
    const hasSensors = room.all_sensors && Object.values(room.all_sensors).some((arr) => Array.isArray(arr) && arr.length > 0);
    return !hasTiles && !hasSensors;
  }

  _getRoomIcon(areaOrId) {
    if (!areaOrId) return 'mdi:home-outline';
    const areaId = typeof areaOrId === 'string' ? areaOrId : areaOrId.area_id;
    const areaObj = typeof areaOrId === 'object' ? areaOrId : this.areas?.find((a) => a.area_id === areaId);
    const cfgIcon = areaId ? this._dashboardConfig?.rooms?.[areaId]?.icon : '';
    const dashIcon = areaId ? this._dashboardRooms?.find((r) => r.area_id === areaId)?.icon : '';
    return cfgIcon || dashIcon || areaObj?.icon || 'mdi:home-outline';
  }

  _extractChannelMatchTokens(channelEntity) {
    if (!channelEntity) return [];
    const tokens = [];
    const eid = (channelEntity.entity_id || '').toLowerCase();
    const numMatches = eid.match(/(?:_|ch|channel|l|switch|light|plug|outlet|socket)(\d+)(?:$|_)/g) || [];
    for (const m of numMatches) {
      const digits = m.match(/\d+/);
      if (digits) tokens.push(digits[0]);
    }
    const rawName = (channelEntity.name || channelEntity.original_name || '').toLowerCase();
    for (const part of rawName.split(/[^a-z0-9äöüß]+/)) {
      if (part.length >= 2) tokens.push(part);
    }
    return [...new Set(tokens)];
  }

  _sensorChannelMatchScore(sensor, channelEntity) {
    if (!channelEntity) return 0;
    const tokens = this._extractChannelMatchTokens(channelEntity);
    if (!tokens.length) return 0;
    const hay = `${sensor.entity_id || ''} ${sensor.name || ''} ${sensor.original_name || ''}`.toLowerCase();
    let hits = 0;
    for (const t of tokens) {
      if (/^\d+$/.test(t)) {
        const re = new RegExp(`(?:_|ch|channel|l|switch|outlet|socket)${t}(?:$|_|\\b)`);
        if (re.test(hay)) hits += 2;
      } else if (hay.includes(t)) {
        hits += 1;
      }
    }
    return hits;
  }

  _detectPowerSensor(sensors, channelEntity = null, excludeIds = null) {
    const candidates = [];
    for (const s of sensors) {
      if (!s || s.entity_category === 'config' || excludeIds?.has(s.entity_id)) continue;
      const st = this.hass?.states?.[s.entity_id];
      const dc = (st?.attributes?.device_class || s.device_class || s.original_device_class || '').toLowerCase();
      const unit = (st?.attributes?.unit_of_measurement || s.unit_of_measurement || '').trim().toLowerCase();
      const nameStr = `${s.entity_id} ${s.original_name || ''} ${s.name || ''} ${st?.attributes?.friendly_name || ''}`.toLowerCase();
      if (dc && !['power', 'apparent_power', 'reactive_power'].includes(dc)) continue;
      if (unit && !['w', 'kw', 'mw'].includes(unit)) continue;
      const isPower = dc === 'power'
        || ['w', 'kw', 'mw'].includes(unit)
        || (nameStr.includes('power') && !nameStr.includes('power_factor') && !nameStr.includes('energy'))
        || nameStr.includes('leistung');
      if (!isPower) continue;
      let score = 0;
      if (dc === 'power') score += 100;
      if (['w', 'kw', 'mw'].includes(unit)) score += 60;
      if (s.entity_category === 'diagnostic') score -= 15;
      score += this._sensorChannelMatchScore(s, channelEntity) * 35;
      candidates.push({ entity_id: s.entity_id, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.entity_id || '';
  }

  _detectEnergySensor(sensors, channelEntity = null, excludeIds = null) {
    const NON_ENERGY_CLASSES = new Set([
      'power', 'apparent_power', 'reactive_power', 'water', 'gas', 'volume',
      'monetary', 'duration', 'voltage', 'current', 'frequency', 'power_factor',
      'temperature', 'humidity', 'battery', 'illuminance', 'pressure', 'signal_strength',
      'data_size', 'data_rate', 'timestamp', 'enum',
    ]);
    const ENERGY_UNITS = new Set(['kwh', 'wh', 'mwh']);
    const NON_ENERGY_UNITS = new Set(['w', 'kw', 'mw', 'va', 'var', 'v', 'a', 'ma', 'hz', 'l', 'm³', 'm3', 'eur', 'usd', 's', 'min', 'h', '°c', '°f', '%']);
    const candidates = [];
    for (const s of sensors) {
      if (!s || s.entity_category === 'config' || excludeIds?.has(s.entity_id)) continue;
      const st = this.hass?.states?.[s.entity_id];
      const dc = (st?.attributes?.device_class || s.device_class || s.original_device_class || '').toLowerCase();
      const sc = (st?.attributes?.state_class || s.capabilities?.state_class || '').toLowerCase();
      const unit = (st?.attributes?.unit_of_measurement || s.unit_of_measurement || '').trim().toLowerCase();
      const nameStr = `${s.entity_id} ${s.original_name || ''} ${s.name || ''} ${st?.attributes?.friendly_name || ''}`.toLowerCase();

      if (dc && dc !== 'energy' && NON_ENERGY_CLASSES.has(dc)) continue;
      if (unit && !ENERGY_UNITS.has(unit) && NON_ENERGY_UNITS.has(unit)) continue;

      const hasEnergyUnit = ENERGY_UNITS.has(unit);
      const hasTotalStateClass = sc === 'total' || sc === 'total_increasing';
      const hasEnergyKeyword = /(energy|energie|verbrauch|consumption|summation|kwh|mwh|\bwh\b)/.test(nameStr);
      const matches = dc === 'energy'
        || hasEnergyUnit
        || (hasTotalStateClass && !dc && !unit && hasEnergyKeyword)
        || (!dc && !unit && hasEnergyKeyword);
      if (!matches) continue;

      let score = 0;
      if (dc === 'energy') score += 100;
      if (hasEnergyUnit) score += 60;
      if (hasTotalStateClass) score += 40;
      if (hasEnergyKeyword) score += 20;
      if (/(today|daily|yesterday|month|monthly|week|weekly|year|annual|hour|hourly|returned|export|feed_in|tages|heute|gestern|woche|monat|jahr|einspeisung|rueckspeisung|rückspeisung)/.test(nameStr)) {
        score -= 25;
      }
      if (s.entity_category === 'diagnostic') score -= 15;
      const chScore = this._sensorChannelMatchScore(s, channelEntity);
      score += chScore * 35;
      candidates.push({ entity_id: s.entity_id, score, chScore });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  // ═══════════════ Initialize selected device ═══════════════
  _initDevice() {
    const d = this.selectedDevice;
    if (!d) return;
    const existing = this.configuredDevices[d.id];

    this.selectedAreaId = d.area_id || '';
    this.roomIcon = this._isNewRoomForDevice(this.selectedAreaId) ? this._getRoomIcon(this.selectedAreaId) : '';
    this.customIcon = existing?.icon || '';
    this.forceOwnRow = !!existing?.options?.force_own_row;
    let rawName = existing?.custom_name || d.name_by_user || d.name || '';
    if (!existing?.custom_name) {
      rawName = this._stripRoomName(rawName, this.selectedAreaId);
    }
    this.customName = rawName;

    // Related entities
    const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
    const validActuators = devEntities.filter(isControllableActuator);
    const controllable = validActuators.length ? validActuators : devEntities.filter((e) => CONTROLLABLE_DOMAINS.has(domainOf(e.entity_id)) && e.entity_category !== 'diagnostic');
    const sensors = devEntities.filter((e) => domainOf(e.entity_id) === 'sensor');

    const existingSensors = existing?.entities?.room_sensors || {};
    const rawRoomSensors = devEntities.filter((e) => ['sensor', 'binary_sensor'].includes(domainOf(e.entity_id)));
    this.sensorEntities = rawRoomSensors.map((e) => {
      const saved = existingSensors[e.entity_id] || (e.unique_id
        ? Object.values(existingSensors).find((s) => s?.unique_id === e.unique_id)
        : null);
      const detectedType = this._detectSensorType(e);
      const type = saved?.type || (saved?.enabled === false ? 'ignore' : detectedType);
      return {
        entity_id: e.entity_id,
        unique_id: e.unique_id || '',
        name: e.name || e.original_name || this.hass?.states?.[e.entity_id]?.attributes?.friendly_name || e.entity_id,
        detectedType,
        type,
      };
    });

    // Auto-detect power & energy
    const powerSensor = this._detectPowerSensor(sensors);
    const energySensor = this._detectEnergySensor(sensors)?.entity_id || '';

    // Auto-detect category
    let autoCat = 'schalter';
    if (controllable.some((e) => domainOf(e.entity_id) === 'cover')) autoCat = 'jalousie';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'light')) autoCat = 'leuchte';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'valve') || (d.name || '').toLowerCase().includes('ventil')) autoCat = 'wasserventil';
    else if ((d.name || '').toLowerCase().includes('pumpe') || (d.model || '').toLowerCase().includes('pump')) autoCat = 'pumpe';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'climate')) autoCat = 'klima';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'media_player')) autoCat = 'fernseher';
    else if ((d.name || '').toLowerCase().includes('steckdose') || (d.model || '').toLowerCase().includes('plug')) autoCat = 'steckdose';
    else if (!controllable.length && this.sensorEntities.some((s) => s.detectedType === 'motion')) autoCat = 'bewegungsmelder';
    else if (!controllable.length && this.sensorEntities.some((s) => s.detectedType === 'temperature' || s.detectedType === 'humidity')) autoCat = 'raummessgeraet';

    this.selectedCategory = existing?.category || autoCat;

    // Sub-entities / channels
    const existingSubs = existing?.entities?.sub_entities || {};
    const assignedEnergy = new Set();
    const assignedPower = new Set();
    this.channels = controllable.map((e, idx) => {
      const sub = existingSubs[e.entity_id] || (e.unique_id
        ? Object.values(existingSubs).find((s) => s?.unique_id === e.unique_id)
        : null) || {};
      let channelName = sub.custom_name || sub.name || e.name || e.original_name || (controllable.length > 1 ? `Kanal ${idx + 1}` : this.customName);
      if (!sub.custom_name && !sub.name) {
        channelName = this._stripRoomName(channelName, this.selectedAreaId);
      }
      let chPower = sub.power || '';
      let autoChPower = '';
      if (!chPower) {
        if (controllable.length > 1) {
          const matchedPower = this._detectPowerSensor(sensors, e, assignedPower);
          chPower = matchedPower || (idx === 0 ? (existing?.entities?.power || powerSensor) : '');
          if (chPower) assignedPower.add(chPower);
          autoChPower = chPower;
        } else {
          chPower = existing?.entities?.power || powerSensor;
          autoChPower = powerSensor;
        }
      }
      let chEnergy = sub.energy || '';
      let autoChEnergy = '';
      if (!chEnergy) {
        if (controllable.length > 1) {
          const match = this._detectEnergySensor(sensors, e, assignedEnergy);
          if (match && (match.chScore > 0 || idx === 0)) {
            chEnergy = match.entity_id;
          } else if (idx === 0) {
            chEnergy = existing?.entities?.energy || energySensor;
          }
          if (chEnergy) assignedEnergy.add(chEnergy);
          autoChEnergy = chEnergy;
        } else {
          chEnergy = existing?.entities?.energy || energySensor;
          autoChEnergy = energySensor;
        }
      }
      return {
        entity_id: e.entity_id,
        unique_id: e.unique_id || '',
        enabled: sub.enabled !== undefined ? !!sub.enabled : true,
        name: channelName,
        category: sub.category || this.selectedCategory,
        power: chPower,
        energy: chEnergy,
        _autoPower: autoChPower,
        _autoEnergy: autoChEnergy,
        presence_simulation: !!(sub.presence_simulation || (idx === 0 && existing?.entities?.presence_simulation)),
        force_own_row: sub.force_own_row !== undefined ? !!sub.force_own_row : !!existing?.options?.force_own_row,
      };
    });

    this.primaryEntityId = existing?.entities?.primary || controllable[0]?.entity_id || '';
    this.powerEntityId = existing?.entities?.power || powerSensor;
    this.energyEntityId = existing?.entities?.energy || energySensor;
  }

  // ═══════════════ STEP 1: Details (Name, Kategorie, Raum) ═══════════════
  _renderStep1() {
    this._cleanupDropdowns();
    const areaOptions = [
      { value: '', label: 'Kein Raum', icon: 'mdi:map-marker-off' },
      ...this.areas.map((a) => ({ value: a.area_id, label: a.name, icon: this._getRoomIcon(a) })),
    ];

    const areaDropdown = new CustomDropdown({
      options: areaOptions,
      value: this.selectedAreaId,
      placeholder: 'Raum',
      onChange: (val) => {
        this.selectedAreaId = val;
        if (this._isNewRoomForDevice(val)) {
          this.roomIcon = this._getRoomIcon(val);
        } else {
          this.roomIcon = '';
        }
        if (this.customName) {
          const stripped = this._stripRoomName(this.customName, val);
          if (stripped && stripped !== this.customName) {
            this.customName = stripped;
          }
        }
        preserveScroll(this.body, () => this._renderStep1());
      },
    });
    this._dropdowns.push(areaDropdown);

    const isNewRoom = this._isNewRoomForDevice(this.selectedAreaId);
    let roomIconField = null;
    if (isNewRoom) {
      const roomIconPicker = new IconPicker({
        hass: this.hass,
        value: this.roomIcon || 'mdi:home-outline',
        priorityIcons: ROOM_ICON_OPTIONS,
        placeholder: 'Raum-Icon suchen',
        onChange: (val) => { this.roomIcon = val || 'mdi:home-outline'; },
      });
      this._dropdowns.push(roomIconPicker);
      roomIconField = h('div', { class: 'field' }, 'Raum-Icon', roomIconPicker.el);
    }

    const nameInput = h('input', {
      type: 'text', value: this.customName, placeholder: 'Gerätename',
      onInput: (e) => { this.customName = e.target.value; },
    });

    const curCat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const devIconPicker = new IconPicker({
      hass: this.hass,
      value: this.customIcon || curCat.icon,
      placeholder: 'Icon suchen',
      onChange: (val) => {
        this.customIcon = val;
      },
    });
    this._dropdowns.push(devIconPicker);

    const catGrid = h('div', { class: 'cat-grid' },
      ...DEVICE_CATEGORIES.map((c) => {
        const card = h('div', {
          class: 'cat-card', style: { '--cat-color': c.color },
          ...(this.selectedCategory === c.id ? { 'data-selected': '' } : {}),
          onClick: () => {
            this.selectedCategory = c.id;
            this.channels.forEach((ch) => { ch.category = c.id; });
            if (!this.customIcon) {
              devIconPicker._setValue(c.icon);
            }
            preserveScroll(this.body, () => this._render());
          },
        },
        icon(c.icon),
        h('div', {}, c.name));
        return card;
      }));

    const hero = h('div', { class: 'win11-hero-badge', style: { color: curCat.color, '--hero-color': curCat.color } }, icon(this.customIcon || curCat.icon));

    const ownRowCard = h('div', {
      class: `feature-card${this.forceOwnRow ? ' active' : ''}`,
      style: { '--feat-color': 'var(--cd-accent, #29b6f6)', cursor: 'pointer', marginTop: '10px' },
      ...(this.forceOwnRow ? { 'data-active': '' } : {}),
      onClick: () => {
        this.forceOwnRow = !this.forceOwnRow;
        this.channels.forEach((ch) => { ch.force_own_row = this.forceOwnRow; });
        ownRowCard.toggleAttribute('data-active', this.forceOwnRow);
        ownRowCard.classList.toggle('active', this.forceOwnRow);
      },
    },
    h('div', { class: 'feature-icon' }, icon('mdi:view-agenda-outline')),
    h('div', { class: 'feature-info' },
      h('div', { class: 'feature-title' }, 'Eigene Zeile erzwingen'),
      h('div', { class: 'feature-desc' }, 'Nicht kompakt gruppieren · Volle Breite')),
    h('div', { class: 'switch-ui' }));

    this.body.replaceChildren(
      hero,
      h('div', { class: 'section-title' }, 'Details'),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, 'Name', nameInput),
        h('div', { class: 'field' }, 'Raum', areaDropdown.el),
        roomIconField,
        h('div', { class: 'field' }, 'Icon', devIconPicker.el)),
      ownRowCard,
      h('div', { class: 'section-title', style: { marginTop: '12px' } }, 'Kategorie'),
      catGrid);
  }

  _buildSensorSection() {
    if (!this.sensorEntities || !this.sensorEntities.length) return null;

    const cards = this.sensorEntities.map((s) => {
      const st = this.hass?.states?.[s.entity_id];
      const liveVal = st
        ? (st.attributes?.unit_of_measurement ? `${st.state} ${st.attributes.unit_of_measurement}` : st.state)
        : '—';

      const card = h('div', {
        class: 'channel-card',
        style: s.type === 'ignore' ? { opacity: '0.55' } : {},
      });

      const autoBadge = (s.type === s.detectedType && s.type !== 'ignore')
        ? h('span', { class: 'badge-tag ok auto-badge' }, icon('mdi:check-circle'), 'Auto')
        : null;

      const typeDd = new CustomDropdown({
        options: ROOM_SENSOR_TYPES,
        value: s.type,
        onChange: (val) => {
          s.type = val;
          card.style.opacity = val === 'ignore' ? '0.55' : '';
          if (autoBadge) {
            autoBadge.hidden = val !== s.detectedType || val === 'ignore';
          }
        },
      });
      this._dropdowns.push(typeDd);

      card.append(
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' } },
          h('div', { style: { minWidth: '0', flex: '1' } },
            h('div', { style: { fontWeight: '600', fontSize: '14px' } }, s.name),
            h('div', { class: 'hint', style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.entity_id)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            autoBadge,
            h('span', { class: 'badge-tag' }, liveVal))),
        h('div', { class: 'field' },
          h('div', { class: 'field-head' }, h('span', { class: 'field-label' }, 'Typ auf Raumkachel')),
          typeDd.el));

      return card;
    });

    return h('div', { style: { marginTop: '14px' } },
      h('div', { class: 'section-title' }, 'Raumsensoren'),
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Werte für Raumkachel wählen'),
      ...cards);
  }

  // ═══════════════ STEP 2: Kanäle & Messung ═══════════════
  _renderStep2() {
    this._cleanupDropdowns();
    const isMulti = this.channels.length > 1;
    const sensorSection = this._buildSensorSection();

    if (!this.channels.length && !sensorSection) {
      this.body.replaceChildren(h('div', { class: 'empty' },
        icon('mdi:alert-circle-outline'),
        h('div', { style: { fontWeight: '600' } }, 'Keine Entitäten'),
        h('div', { class: 'hint' }, 'Keine passenden Kanäle/Sensoren')));
      return;
    }

    const curCat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const hero = h('div', { class: 'win11-hero-badge', style: { color: curCat.color || 'var(--cd-accent)', '--hero-color': curCat.color || 'var(--cd-accent)' } }, icon(curCat.icon || 'mdi:tune-vertical'));

    const header = h('div', { style: { textAlign: 'center', marginBottom: '8px' } },
      h('h3', { style: { margin: '0 0 2px', fontSize: '17px', fontWeight: '700' } },
        !this.channels.length ? 'Raumsensoren' : (isMulti ? 'Kanäle & Messung' : 'Messung & Simulation')),
      h('div', { class: 'hint' },
        !this.channels.length
          ? 'Sensortyp für Raumkachel'
          : (isMulti ? 'Kanäle einzeln zuordnen' : 'Leistung, Energie & Simulation')));

    if (!this.channels.length) {
      this.body.replaceChildren(hero, header, sensorSection);
      return;
    }

    if (!isMulti) {
      const ch = this.channels[0];

      const powerPicker = new EntityPicker({
        hass: this.hass,
        value: ch.power || '',
        placeholder: 'Watt-Sensor (optional)',
        domain: 'sensor',
        onChange: (val) => {
          ch.power = val;
          this.powerEntityId = val;
        },
      });
      this._dropdowns.push(powerPicker);

      const isAutoPower = ch.power && ch.power === this.powerEntityId;
      const powerBadge = isAutoPower
        ? h('span', { class: 'badge-tag ok auto-badge', style: { marginLeft: '8px' } }, icon('mdi:check-circle'), 'Auto')
        : null;

      const powerCard = h('div', { class: 'row-card', style: { padding: '14px 16px', gap: '10px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { class: 'feature-icon', style: { color: '#ffb74d', display: 'grid', placeItems: 'center', width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,183,77,0.15)', flex: 'none' } }, icon('mdi:flash')),
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' } },
              'Leistung (Watt)', powerBadge),
            h('div', { class: 'hint', style: { marginTop: '2px' } }, 'Live-Verbrauch auf Kachel'))),
        powerPicker.el);

      const energyPicker = new EntityPicker({
        hass: this.hass,
        value: ch.energy || '',
        placeholder: 'kWh-Sensor (optional)',
        domain: 'sensor',
        onChange: (val) => {
          ch.energy = val;
          this.energyEntityId = val;
        },
      });
      this._dropdowns.push(energyPicker);

      const isAutoEnergy = ch.energy && ch.energy === this.energyEntityId;
      const energyBadge = isAutoEnergy
        ? h('span', { class: 'badge-tag ok auto-badge', style: { marginLeft: '8px' } }, icon('mdi:check-circle'), 'Auto')
        : null;

      const energyCard = h('div', { class: 'row-card', style: { padding: '14px 16px', gap: '10px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { class: 'feature-icon', style: { color: '#66bb6a', display: 'grid', placeItems: 'center', width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(102,187,106,0.15)', flex: 'none' } }, icon('mdi:lightning-bolt')),
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' } },
              'Energie (kWh)', energyBadge),
            h('div', { class: 'hint', style: { marginTop: '2px' } }, 'Gesamtverbrauch (kWh / Wh)'))),
        energyPicker.el);

      const simCard = h('div', {
        class: `feature-card${ch.presence_simulation ? ' active' : ''}`,
        style: { '--feat-color': '#ba68c8', cursor: 'pointer' },
        ...(ch.presence_simulation ? { 'data-active': '' } : {}),
        onClick: () => {
          ch.presence_simulation = !ch.presence_simulation;
          simCard.toggleAttribute('data-active', ch.presence_simulation);
          simCard.classList.toggle('active', ch.presence_simulation);
        },
      },
      h('div', { class: 'feature-icon' }, icon('mdi:home-clock')),
      h('div', { class: 'feature-info' },
        h('div', { class: 'feature-title' }, 'Anwesenheitssimulation'),
        h('div', { class: 'feature-desc' }, 'Zufallsschalten bei Abwesenheit')),
      h('div', { class: 'switch-ui' }));

      this.body.replaceChildren(...[hero, header, powerCard, energyCard, simCard, sensorSection].filter(Boolean));
      return;
    }

    // MULTI-CHANNEL DEVICE (e.g. Shelly 2PM)
    const catOptions = DEVICE_CATEGORIES.map((c) => ({
      value: c.id, label: c.name, icon: c.icon, color: c.color,
    }));

    const channelCards = this.channels.map((ch, idx) => {
      const nameInput = h('input', {
        type: 'text', value: ch.name, placeholder: `Kanal ${idx + 1}`, disabled: !ch.enabled,
        onInput: (e) => { ch.name = e.target.value; },
      });

      const catDropdown = new CustomDropdown({
        options: catOptions,
        value: ch.category,
        disabled: !ch.enabled,
        onChange: (val) => { ch.category = val; },
      });
      this._dropdowns.push(catDropdown);

      const powerPicker = new EntityPicker({
        hass: this.hass,
        value: ch.power || '',
        placeholder: 'Watt-Sensor (optional)',
        domain: 'sensor',
        onChange: (val) => { ch.power = val; },
      });
      this._dropdowns.push(powerPicker);

      const energyPicker = new EntityPicker({
        hass: this.hass,
        value: ch.energy || '',
        placeholder: 'kWh-Sensor (optional)',
        domain: 'sensor',
        onChange: (val) => { ch.energy = val; },
      });
      this._dropdowns.push(energyPicker);

      const simCard = h('div', {
        class: `feature-card${ch.presence_simulation && ch.enabled ? ' active' : ''}`,
        style: { '--feat-color': '#ba68c8', cursor: ch.enabled ? 'pointer' : 'default' },
        ...(ch.presence_simulation && ch.enabled ? { 'data-active': '' } : {}),
        onClick: () => {
          if (!ch.enabled) return;
          ch.presence_simulation = !ch.presence_simulation;
          simCard.toggleAttribute('data-active', ch.presence_simulation);
          simCard.classList.toggle('active', ch.presence_simulation);
        },
      },
      h('div', { class: 'feature-icon' }, icon('mdi:home-clock')),
      h('div', { class: 'feature-info' },
        h('div', { class: 'feature-title' }, 'Anwesenheitssimulation'),
        h('div', { class: 'feature-desc' }, 'Zufallsschalten bei Abwesenheit')),
      h('div', { class: 'switch-ui' }));

      const isAutoPower = ch.power && (ch.power === this.powerEntityId || ch.power === ch._autoPower);
      const powerBadge = isAutoPower
        ? h('span', { class: 'badge-tag ok auto-badge' }, icon('mdi:check-circle'), 'Auto')
        : null;

      const isAutoEnergy = ch.energy && (ch.energy === this.energyEntityId || ch.energy === ch._autoEnergy);
      const energyBadge = isAutoEnergy
        ? h('span', { class: 'badge-tag ok auto-badge' }, icon('mdi:check-circle'), 'Auto')
        : null;

      const enabledToggle = h('div', {
        class: 'switch-ui',
        style: { cursor: 'pointer' },
        onClick: (e) => {
          e.stopPropagation();
          ch.enabled = !ch.enabled;
          preserveScroll(this.body, () => this._renderStep2());
        },
      });

      const headCard = h('div', {
        class: 'channel-head',
        style: { cursor: 'pointer' },
        onClick: () => {
          ch.enabled = !ch.enabled;
          preserveScroll(this.body, () => this._renderStep2());
        },
      },
      enabledToggle,
      h('div', { class: 'ch-title' }, ch.name || ch.entity_id),
      h('span', { class: 'badge-tag' }, ch.entity_id));

      if (ch.enabled) headCard.setAttribute('data-active', '');

      return h('div', { class: 'channel-card', style: ch.enabled ? {} : { opacity: '0.5' } },
        headCard,
        h('div', { class: 'fields' },
          h('div', { class: 'field' },
            h('div', { class: 'field-head' }, h('span', { class: 'field-label' }, 'Kanalname')),
            nameInput),
          h('div', { class: 'field' },
            h('div', { class: 'field-head' }, h('span', { class: 'field-label' }, 'Kategorie')),
            catDropdown.el),
          h('div', { class: 'field' },
            h('div', { class: 'field-head' },
              h('span', { class: 'field-label' }, 'Leistung (Watt)'),
              powerBadge),
            powerPicker.el),
          h('div', { class: 'field' },
            h('div', { class: 'field-head' },
              h('span', { class: 'field-label' }, 'Energie (kWh)'),
              energyBadge),
            energyPicker.el)),
        simCard);
    });

    this.body.replaceChildren(...[hero, header, ...channelCards, sensorSection].filter(Boolean));
  }

  // ═══════════════ STEP 3: Prüfen & Speichern ═══════════════
  _renderStep3() {
    const area = this.areas.find((a) => a.area_id === this.selectedAreaId);
    const areaName = area?.name || 'Kein Raum';
    const cat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const activeChannels = this.channels.filter((c) => c.enabled);

    const hero = h('div', { class: 'win11-hero-badge', style: { color: cat.color, '--hero-color': cat.color } }, icon(cat.icon || 'mdi:check-circle'));

    const header = h('div', { style: { textAlign: 'center', marginBottom: '10px' } },
      h('h3', { style: { margin: '0 0 2px', fontSize: '17px', fontWeight: '700' } }, 'Prüfen'),
      h('div', { class: 'hint' }, 'Auswahl kontrollieren & speichern'));

    const hasSim = activeChannels.some((c) => c.presence_simulation);
    const hasPower = activeChannels.some((c) => c.power);
    const hasEnergy = activeChannels.some((c) => c.energy);
    const areaBadgeIcon = this.selectedAreaId ? this._getRoomIcon(this.selectedAreaId) : 'mdi:map-marker-off';

    const previewCard = h('div', {
      class: 'win11-preview-card',
      style: { '--preview-color': cat.color },
    },
    h('div', { class: 'win11-preview-icon' }, icon(this.customIcon || cat.icon)),
    h('div', { class: 'win11-preview-info' },
      h('div', { class: 'win11-preview-name' }, this.customName || 'Gerät'),
      h('div', { class: 'win11-preview-meta' },
        h('span', { class: 'badge-tag category', style: { '--badge-cat-color': cat.color } }, icon(cat.icon), cat.name),
        h('span', { class: 'badge-tag area' }, icon(areaBadgeIcon), areaName),
        hasPower ? h('span', { class: 'badge-tag', style: { color: '#ffb74d' } }, icon('mdi:flash'), 'Leistung') : null,
        hasEnergy ? h('span', { class: 'badge-tag', style: { color: '#66bb6a' } }, icon('mdi:lightning-bolt'), 'Energie') : null,
        this.forceOwnRow ? h('span', { class: 'badge-tag' }, icon('mdi:view-agenda-outline'), 'Eigene Zeile') : null,
        hasSim ? h('span', { class: 'badge-tag', style: { color: '#ce93d8' } }, icon('mdi:home-clock'), 'Simulation') : null)));

    const syncCard = h('div', {
      class: `feature-card${this.renameInHA ? ' active' : ''}`,
      style: { '--feat-color': '#2196f3', cursor: 'pointer' },
      ...(this.renameInHA ? { 'data-active': '' } : {}),
      onClick: () => {
        this.renameInHA = !this.renameInHA;
        syncCard.toggleAttribute('data-active', this.renameInHA);
        syncCard.classList.toggle('active', this.renameInHA);
      },
    },
    h('div', { class: 'feature-icon' }, icon('mdi:home-assistant')),
    h('div', { class: 'feature-info' },
      h('div', { class: 'feature-title' }, 'HA-Synchronisierung'),
      h('div', { class: 'feature-desc' }, 'Name & Raum in HA übernehmen')),
    h('div', { class: 'switch-ui' }));

    const syncAccordion = h('details', { class: 'adv-options' },
      h('summary', {}, icon('mdi:cog-outline'), 'Optionen: HA-Sync'),
      h('div', { class: 'adv-content' }, syncCard));

    const channelSummary = this.channels.length > 1
      ? h('div', { class: 'row-card', style: { marginTop: '8px' } },
        h('div', { style: { fontWeight: '600', fontSize: '13px' } }, `Kanäle (${activeChannels.length})`),
        h('div', { class: 'hint' }, activeChannels.map((c) => {
          const cCat = DEVICE_CATEGORIES.find((catItem) => catItem.id === c.category);
          return `• ${c.name} (${cCat?.name || c.category})`;
        }).join('\n')))
      : null;

    const items = [
      hero,
      header,
      previewCard,
      channelSummary,
      syncAccordion,
    ].filter(Boolean);

    this.body.replaceChildren(...items);
  }

  // ═══════════════ POST-SAVE CELEBRATION ═══════════════
  _renderCelebration() {
    this._cleanupDropdowns();
    this.selectionSlot.replaceChildren();
    this.stepBar.hidden = true;
    this.foot.hidden = true;
    this.dialog.style.setProperty('--hero-color', '#10b981');

    const area = this.areas.find((a) => a.area_id === this.selectedAreaId);
    const areaName = area?.name || 'Dashboard';

    const celebration = h('div', { class: 'win11-celebration' },
      h('div', { class: 'win11-success-badge' }, icon('mdi:check')),
      h('h2', { style: { margin: '6px 0 2px', fontSize: '20px', fontWeight: '700', color: 'var(--primary-text-color, inherit)' } }, 'Fertig'),
      h('div', { class: 'hint', style: { fontSize: '14px', maxWidth: '400px' } },
        `„${this.customName}“ · ${areaName}`),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap', justifyContent: 'center' } },
        this.directMode ? null : h('button', {
          class: 'btn secondary',
          onClick: () => {
            this.isCelebration = false;
            this.step = 0;
            this.selectedDevice = null;
            this._render();
          },
        }, icon('mdi:plus'), 'Weiteres Gerät'),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            this._closeWizard();
            this.onSaved(null);
          },
        }, icon(this.directMode ? 'mdi:check' : 'mdi:view-dashboard'), this.directMode ? 'Fertig' : 'Dashboard')));

    this.body.replaceChildren(celebration);
  }

  _renderBody() {
    switch (this.step) {
      case 0: return this._renderStep0();
      case 1: return this._renderStep1();
      case 2: return this._renderStep2();
      case 3: return this._renderStep3();
      default: return null;
    }
  }

  // ═══════════════ Speichern ═══════════════
  async _save() {
    if (this._saving) return;
    this._saving = true;
    this._renderFoot();

    const d = this.selectedDevice;
    const activeChannels = this.channels.filter((c) => c.enabled);
    const isMulti = activeChannels.length > 1;

    try {
      // 1. Rename in Home Assistant if checked
      if (this.renameInHA && d) {
        try {
          await this.hass.callWS({
            type: 'config/device_registry/update',
            device_id: d.id,
            name_by_user: this.customName || undefined,
            area_id: this.selectedAreaId || null,
          });
        } catch (err) {
          console.warn('[wizard] device rename failed', err);
        }

        // Entity renames (only set name for multi-channel entities; keep single-channel Friendly Name intact)
        for (const ch of activeChannels) {
          try {
            const payload = {
              type: 'config/entity_registry/update',
              entity_id: ch.entity_id,
              area_id: this.selectedAreaId || null,
            };
            if (isMulti && ch.name) {
              payload.name = ch.name;
            }
            await this.hass.callWS(payload);
          } catch (err) {
            console.warn('[wizard] entity rename failed', err);
          }
        }
      }

      // 2. Configure in Companion Store
      let entitiesConfig = {};
      if (isMulti) {
        const sub_entities = {};
        let firstId = null;
        for (const ch of activeChannels) {
          firstId ||= ch.entity_id;
          sub_entities[ch.entity_id] = {
            category: ch.category,
            custom_name: ch.name,
            name: ch.name,
            icon: DEVICE_CATEGORIES.find((cat) => cat.id === ch.category)?.icon || 'mdi:power-plug',
            original_id: ch.entity_id,
            unique_id: ch.unique_id,
            power: ch.power || undefined,
            energy: ch.energy || undefined,
            presence_simulation: ch.presence_simulation || false,
            force_own_row: !!this.forceOwnRow,
          };
        }
        entitiesConfig = {
          primary: firstId,
          primary_unique_id: activeChannels[0]?.unique_id,
          sub_entities,
        };
      } else {
        const primary = activeChannels[0] || this.channels[0];
        entitiesConfig = {
          primary: primary?.entity_id,
          primary_unique_id: primary?.unique_id,
          power: primary?.power || undefined,
          energy: primary?.energy || undefined,
          presence_simulation: primary?.presence_simulation || false,
        };
      }

      const room_sensors = {};
      for (const s of (this.sensorEntities || [])) {
        room_sensors[s.entity_id] = {
          entity_id: s.entity_id,
          unique_id: s.unique_id || undefined,
          original_id: s.entity_id,
          type: s.type,
          enabled: s.type !== 'ignore',
        };
      }
      entitiesConfig.room_sensors = room_sensors;

      const existingOpts = this.configuredDevices?.[d.id]?.options || {};
      const res = await this.hass.callWS({
        type: 'smarthome_companion/devices/configure',
        device_id: d.id,
        category: this.selectedCategory,
        custom_name: this.customName,
        area_id: this.selectedAreaId || '',
        icon: this.customIcon || undefined,
        options: {
          ...existingOpts,
          force_own_row: !!this.forceOwnRow,
        },
        entities: entitiesConfig,
      });

      if (res?.save_failed) throw new Error('Speichern im Backend fehlgeschlagen');

      // Save room icon for newly populated room if selected
      if (this.selectedAreaId && this.roomIcon && this._isNewRoomForDevice(this.selectedAreaId)) {
        try {
          await this.hass.callWS({
            type: 'config/area_registry/update',
            area_id: this.selectedAreaId,
            icon: this.roomIcon,
          });
        } catch (_) { /* non-fatal in mock/dev mode */ }
        try {
          const dashData = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
          const cfg = dashData?.config || {};
          cfg.rooms ||= {};
          cfg.rooms[this.selectedAreaId] ||= {};
          cfg.rooms[this.selectedAreaId].icon = this.roomIcon;
          await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config: cfg });
        } catch (_) { /* non-fatal */ }
      }

      // Check for dynamic sensor conflicts in the target room
      const activeTypes = [...new Set((this.sensorEntities || [])
        .filter((s) => s.type && s.type !== 'ignore')
        .map((s) => s.type))];

      if (this.selectedAreaId && activeTypes.length > 0) {
        try {
          const updatedDash = await this.hass.callWS({ type: 'smarthome_companion/dashboard/get', edit: true });
          const room = updatedDash?.layout?.rooms?.find((r) => r.area_id === this.selectedAreaId);
          const conflicts = activeTypes
            .map((t) => ({ type: t, entityIds: room?.all_sensors?.[t] || [] }))
            .filter((c) => c.entityIds.length > 1);

          if (conflicts.length > 0) {
            this._saving = false;
            this.dialog.hidden = true;
            const conflictModal = new SensorConflictModal({
              hass: this.hass,
              areaName: room?.name || 'Raum',
              conflicts,
              currentPrefs: room?.sensor_prefs || {},
              onSave: async (prefs) => {
                const cfg = updatedDash?.config || {};
                cfg.rooms ||= {};
                cfg.rooms[this.selectedAreaId] ||= {};
                cfg.rooms[this.selectedAreaId].sensor_prefs = prefs;
                await this.hass.callWS({ type: 'smarthome_companion/dashboard/save', config: cfg });
                if (this.directMode) {
                  this.onClose();
                  this.onSaved(null);
                } else {
                  this.dialog.hidden = false;
                  this.isCelebration = true;
                  this._renderCelebration();
                }
              },
              onCancel: () => {
                if (this.directMode) {
                  this.onClose();
                  this.onSaved(null);
                } else {
                  this.dialog.hidden = false;
                  this.isCelebration = true;
                  this._renderCelebration();
                }
              },
            });
            this.el.append(conflictModal.el);
            return;
          }
        } catch (err) {
          console.warn('[wizard] conflict check failed', err);
        }
      }

      this._saving = false;
      if (this.directMode) {
        this.onClose();
        this.onSaved(null);
      } else {
        this.isCelebration = true;
        this._renderCelebration();
      }
    } catch (err) {
      this._saving = false;
      this._renderFoot();
      this.onSaved(err);
    }
  }
}
