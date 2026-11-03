import { h, icon, domainOf } from '../lib/util.js';
import { EntityPicker } from './entity_picker.js';
import { CustomDropdown } from './custom_dropdown.js';

export const DEVICE_CATEGORIES = [
  { id: 'leuchte', name: 'Leuchte', icon: 'mdi:lightbulb', color: '#ffc107', desc: 'Lampen, Spots & LED-Streifen' },
  { id: 'steckdose', name: 'Steckdose', icon: 'mdi:power-socket-eu', color: '#009688', desc: 'Zwischenstecker & Dosen' },
  { id: 'schalter', name: 'Gerät / Relais', icon: 'mdi:power-plug', color: '#2196f3', desc: 'Allgemeine Schalter' },
  { id: 'jalousie', name: 'Jalousie', icon: 'mdi:window-shutter', color: '#9c27b0', desc: 'Rollläden & Markisen' },
  { id: 'wasserventil', name: 'Wasserventil', icon: 'mdi:water-pump', color: '#00bcd4', desc: 'Bewässerungsventile' },
  { id: 'pumpe', name: 'Pumpe', icon: 'mdi:pump', color: '#03a9f4', desc: 'Garten- & Wasserpumpen' },
  { id: 'klima', name: 'Klima', icon: 'mdi:thermometer', color: '#ff9800', desc: 'Thermostate & Klima' },
  { id: 'fernseher', name: 'Fernseher', icon: 'mdi:television', color: '#03a9f4', desc: 'TVs & Mediaplayer' },
  { id: 'bewegungsmelder', name: 'Bewegungsmelder', icon: 'mdi:motion-sensor', color: '#e91e63', desc: 'Präsenz- & Bewegung' },
  { id: 'bodenmessgeraet', name: 'Bodenmessgerät', icon: 'mdi:sprout', color: '#4caf50', desc: 'Bodenfeuchte & Pflanzen' },
  { id: 'raummessgeraet', name: 'Raummessgerät', icon: 'mdi:thermometer-lines', color: '#ff5722', desc: 'Raumluft- & Temperatursensoren' },
];

const CONTROLLABLE_DOMAINS = new Set(['light', 'switch', 'cover', 'valve', 'climate', 'media_player', 'fan']);

export class DeviceWizard {
  /**
   * @param {{hass:object, initialDeviceId?:string, onClose:Function, onSaved:Function}} opts
   */
  constructor({ hass, initialDeviceId, onClose, onSaved }) {
    this.hass = hass;
    this.initialDeviceId = initialDeviceId || null;
    this.onClose = onClose;
    this.onSaved = onSaved;

    this.step = 0; // 0=Gerät, 1=Details, 2=Kanäle, 3=Übersicht
    this.steps = ['Gerät', 'Details', 'Kanäle & Messung', 'Übersicht'];

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

    // Channels / sub-entities
    this.channels = []; // [{ entity_id, enabled, name, category, power, energy, presence_simulation, unique_id }]
    this.primaryEntityId = '';
    this.powerEntityId = '';
    this.energyEntityId = '';

    this.searchQuery = '';
    this.statusFilter = 'unconfigured'; // 'unconfigured' | 'all' | 'configured'

    this.isCelebration = false;
    this._dropdowns = [];

    this._build();
    this._load();
  }

  _build() {
    this.body = h('div', { class: 'dialog-body' });
    this.stepBar = h('div', { class: 'wizard-steps' });
    this.foot = h('div', { class: 'dialog-foot' });

    this.dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Gerät einrichten' },
      h('div', { class: 'dialog-head' },
        icon('mdi:plus-circle-outline'),
        h('h2', {}, 'Gerät einrichten'),
        h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => this.onClose() }, icon('mdi:close'))),
      this.stepBar,
      this.body,
      this.foot);

    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this.onClose(); } }, this.dialog);
  }

  async _load() {
    this.body.replaceChildren(h('div', { class: 'empty' }, icon('mdi:loading'), h('div', { style: { marginTop: '8px' } }, 'Lade Geräte...')));
    try {
      const [devs, ents, areas, setup] = await Promise.all([
        this.hass.callWS({ type: 'config/device_registry/list' }),
        this.hass.callWS({ type: 'config/entity_registry/list' }),
        this.hass.callWS({ type: 'config/area_registry/list' }),
        this.hass.callWS({ type: 'smarthome_companion/devices/get' }).catch(() => ({ devices: {}, categories: {} })),
      ]);
      this.devices = devs || [];
      this.entities = ents || [];
      this.areas = areas || [];
      this.configuredDevices = setup.devices || {};
      this.categories = setup.categories || {};

      if (this.initialDeviceId) {
        const target = this.devices.find((d) => d.id === this.initialDeviceId);
        if (target) {
          this.selectedDevice = target;
          this._initDevice();
          this.step = 1;
        }
      }

      this._render();
    } catch (err) {
      this.body.replaceChildren(h('div', { class: 'empty' }, icon('mdi:alert'), h('div', {}, `Fehler beim Laden: ${err.message || err}`)));
    }
  }

  _render() {
    this._cleanupDropdowns();
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
    if (isFirst) {
      leftActions.push(h('button', { class: 'btn', onClick: () => this.onClose() }, 'Abbrechen'));
    } else {
      leftActions.push(h('button', { class: 'btn', onClick: () => { this.step--; this._render(); } }, icon('mdi:chevron-left'), 'Zurück'));
      if (isConfigured) {
        leftActions.push(h('button', {
          class: 'btn danger',
          title: 'Companion-Einrichtung für dieses Gerät aufheben',
          onClick: () => this._removeDevice(this.selectedDevice.id, this.customName),
        }, icon('mdi:delete-outline'), 'Einrichtung aufheben'));
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
      }, icon('mdi:check'), this._saving ? 'Wird gespeichert...' : 'Fertigstellen'));
    }

    const leftWrap = h('div', { class: 'dialog-foot-actions' }, ...leftActions);
    const rightWrap = h('div', { class: 'dialog-foot-actions' }, ...rightActions);
    this.foot.replaceChildren(leftWrap, rightWrap);
  }

  async _removeDevice(deviceId, name) {
    const devName = name || this.customName || 'diesem Gerät';
    const confirmed = window.confirm(
      `Soll die Companion-Einrichtung von „${devName}“ wirklich aufgehoben werden?\n\nDas Gerät bleibt in Home Assistant bestehen, wird aber nicht mehr als Companion-Gerät geführt.`
    );
    if (!confirmed) return;

    try {
      const res = await this.hass.callWS({
        type: 'smarthome_companion/devices/remove',
        device_id: deviceId,
      });
      if (res?.save_failed) throw new Error('Löschen fehlgeschlagen');

      delete this.configuredDevices[deviceId];
      if (this.selectedDevice?.id === deviceId) {
        this.selectedDevice = null;
        this.step = 0;
      }
      this._render();
      this.onSaved(null);
    } catch (err) {
      alert(`Fehler beim Aufheben der Einrichtung: ${err.message || err}`);
    }
  }

  // ═══════════════ STEP 0: Gerät auswählen ═══════════════
  _renderStep0() {
    const isCandidate = (d) => {
      if (d.disabled_by || d.entry_type === 'service') return false;
      const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
      const controllable = devEntities.filter((e) => CONTROLLABLE_DOMAINS.has(domainOf(e.entity_id)));
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
    };
    const candidates = this.devices.filter(isCandidate);
    const configuredCount = candidates.filter((d) => !!this.configuredDevices[d.id]).length;
    const unconfiguredCount = candidates.length - configuredCount;
    const allCount = candidates.length;

    const hero = h('div', { class: 'win11-hero-badge', style: { '--hero-color': '#2196F3' } }, icon('mdi:devices'));

    const searchInput = h('input', {
      type: 'text', placeholder: 'Gerät suchen (Name, Hersteller, Modell, Raum)...', value: this.searchQuery,
      onInput: (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this._updateDeviceList(); },
    });
    const searchWrap = h('div', { class: 'search-bar' }, icon('mdi:magnify'), searchInput);

    const filterChips = h('div', { class: 'filter-chips' },
      ...[
        ['unconfigured', `Nicht eingerichtet (${unconfiguredCount})`],
        ['configured', `Bereits eingerichtet (${configuredCount})`],
        ['all', `Alle Geräte (${allCount})`],
      ].map(([id, label]) => h('button', {
        class: 'filter-chip', ...(id === this.statusFilter ? { 'data-active': '' } : {}),
        onClick: () => { this.statusFilter = id; this._renderStep0(); },
      }, label)));

    this.deviceListEl = h('div', { class: 'device-list' });
    this._updateDeviceList();

    this.body.replaceChildren(
      hero,
      h('div', { class: 'hint', style: { textAlign: 'center', marginBottom: '12px' } },
        'Wähle das Gerät aus, das im Dashboard eingerichtet oder bearbeitet werden soll:'),
      searchWrap,
      filterChips,
      this.deviceListEl);
  }

  _updateDeviceList() {
    const areaMap = new Map(this.areas.map((a) => [a.area_id, a.name]));
    const q = this.searchQuery;

    const filtered = this.devices.filter((d) => {
      if (d.disabled_by) return false;
      if (d.entry_type === 'service') return false;

      const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
      const controllable = devEntities.filter((e) => CONTROLLABLE_DOMAINS.has(domainOf(e.entity_id)));
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

      const isConfigured = !!this.configuredDevices[d.id];
      if (this.statusFilter === 'unconfigured' && isConfigured) return false;
      if (this.statusFilter === 'configured' && !isConfigured) return false;

      if (!q) return true;
      const area = (areaMap.get(d.area_id) || '').toLowerCase();
      return name.includes(q) || mfg.includes(q) || model.includes(q) || area.includes(q);
    });

    if (!filtered.length) {
      this.deviceListEl.replaceChildren(h('div', { class: 'empty' }, icon('mdi:devices'), h('div', {}, 'Keine passenden Geräte gefunden')));
      return;
    }

    this.deviceListEl.replaceChildren(...filtered.map((d) => {
      const name = d.name_by_user || d.name || 'Unbenanntes Gerät';
      const mfg = [d.manufacturer, d.model].filter(Boolean).join(' · ');
      const area = areaMap.get(d.area_id);
      const isConfigured = !!this.configuredDevices[d.id];
      const cfg = this.configuredDevices[d.id];

      const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
      const controllable = devEntities.filter((e) => CONTROLLABLE_DOMAINS.has(domainOf(e.entity_id)));

      const badges = [];
      if (area) badges.push(h('span', { class: 'badge-tag area' }, icon('mdi:map-marker'), area));
      if (isConfigured) {
        const cat = DEVICE_CATEGORIES.find((c) => c.id === cfg.category);
        badges.push(h('span', { class: 'badge-tag ok' }, icon('mdi:check-circle'), `Eingerichtet (${cat?.name || cfg.category})`));
      } else if (controllable.length > 0) {
        badges.push(h('span', { class: 'badge-tag' }, `${controllable.length} steuerbar`));
      }

      const actions = [];
      if (isConfigured) {
        actions.push(
          h('button', {
            class: 'btn secondary small',
            title: 'Gerät bearbeiten',
            'aria-label': 'Bearbeiten',
            onClick: (e) => {
              e.stopPropagation();
              this.selectedDevice = d;
              this._initDevice();
              this.step = 1;
              this._render();
            },
          }, icon('mdi:pencil'), 'Bearbeiten'),
          h('button', {
            class: 'icon-btn danger',
            title: 'Companion-Einrichtung aufheben',
            'aria-label': 'Einrichtung aufheben',
            onClick: (e) => {
              e.stopPropagation();
              this._removeDevice(d.id, name);
            },
          }, icon('mdi:delete-outline'))
        );
      } else {
        actions.push(
          h('button', {
            class: 'btn primary small',
            title: 'Gerät einrichten',
            'aria-label': 'Einrichten',
            onClick: (e) => {
              e.stopPropagation();
              this.selectedDevice = d;
              this._initDevice();
              this.step = 1;
              this._render();
            },
          }, icon('mdi:plus'), 'Einrichten')
        );
      }

      const card = h('div', {
        class: 'device-card', ...(this.selectedDevice?.id === d.id ? { 'data-selected': '' } : {}),
        onClick: () => {
          this.selectedDevice = d;
          this._initDevice();
          this.step = 1;
          this._render();
        },
      },
      h('div', { class: 'd-icon' }, icon('mdi:devices')),
      h('div', { class: 'd-info' },
        h('div', { class: 'd-name' }, name),
        h('div', { class: 'd-meta' }, mfg ? h('span', {}, mfg) : null, ...badges)),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, ...actions));
      return card;
    }));
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

  // ═══════════════ Initialize selected device ═══════════════
  _initDevice() {
    const d = this.selectedDevice;
    if (!d) return;
    const existing = this.configuredDevices[d.id];

    this.selectedAreaId = d.area_id || '';
    let rawName = existing?.custom_name || d.name_by_user || d.name || '';
    if (!existing?.custom_name) {
      rawName = this._stripRoomName(rawName, this.selectedAreaId);
    }
    this.customName = rawName;

    // Related entities
    const devEntities = this.entities.filter((e) => e.device_id === d.id && !e.disabled_by);
    const controllable = devEntities.filter((e) => CONTROLLABLE_DOMAINS.has(domainOf(e.entity_id)));
    const sensors = devEntities.filter((e) => domainOf(e.entity_id) === 'sensor');

    // Auto-detect power & energy
    const powerSensor = sensors.find((s) => s.entity_id.includes('power') || s.original_name?.toLowerCase().includes('power') || s.original_name?.toLowerCase().includes('leistung'))?.entity_id || '';
    const energySensor = sensors.find((s) => s.entity_id.includes('energy') || s.original_name?.toLowerCase().includes('energy') || s.original_name?.toLowerCase().includes('energie'))?.entity_id || '';

    // Auto-detect category
    let autoCat = 'schalter';
    if (controllable.some((e) => domainOf(e.entity_id) === 'cover')) autoCat = 'jalousie';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'light')) autoCat = 'leuchte';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'valve') || (d.name || '').toLowerCase().includes('ventil')) autoCat = 'wasserventil';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'climate')) autoCat = 'klima';
    else if (controllable.some((e) => domainOf(e.entity_id) === 'media_player')) autoCat = 'fernseher';
    else if ((d.name || '').toLowerCase().includes('steckdose') || (d.model || '').toLowerCase().includes('plug')) autoCat = 'steckdose';

    this.selectedCategory = existing?.category || autoCat;

    // Sub-entities / channels
    const existingSubs = existing?.entities?.sub_entities || {};
    this.channels = controllable.map((e, idx) => {
      const sub = existingSubs[e.entity_id] || {};
      let channelName = sub.custom_name || sub.name || e.name || e.original_name || (controllable.length > 1 ? `Kanal ${idx + 1}` : this.customName);
      if (!sub.custom_name && !sub.name) {
        channelName = this._stripRoomName(channelName, this.selectedAreaId);
      }
      return {
        entity_id: e.entity_id,
        unique_id: e.unique_id || '',
        enabled: sub.enabled !== undefined ? !!sub.enabled : true,
        name: channelName,
        category: sub.category || this.selectedCategory,
        power: sub.power || (idx === 0 ? (existing?.entities?.power || powerSensor) : ''),
        energy: sub.energy || (idx === 0 ? (existing?.entities?.energy || energySensor) : ''),
        presence_simulation: !!(sub.presence_simulation || (idx === 0 && existing?.entities?.presence_simulation)),
      };
    });

    this.primaryEntityId = existing?.entities?.primary || controllable[0]?.entity_id || '';
    this.powerEntityId = existing?.entities?.power || powerSensor;
    this.energyEntityId = existing?.entities?.energy || energySensor;
  }

  // ═══════════════ STEP 1: Details (Name, Kategorie, Raum) ═══════════════
  _renderStep1() {
    const areaOptions = [
      { value: '', label: 'Kein Raum', icon: 'mdi:map-marker-off' },
      ...this.areas.map((a) => ({ value: a.area_id, label: a.name, icon: 'mdi:map-marker' })),
    ];

    const areaDropdown = new CustomDropdown({
      options: areaOptions,
      value: this.selectedAreaId,
      placeholder: 'Raum auswählen...',
      onChange: (val) => {
        this.selectedAreaId = val;
        if (this.customName) {
          const stripped = this._stripRoomName(this.customName, val);
          if (stripped && stripped !== this.customName) {
            this.customName = stripped;
            nameInput.value = stripped;
          }
        }
      },
    });
    this._dropdowns.push(areaDropdown);

    const nameInput = h('input', {
      type: 'text', value: this.customName, placeholder: 'Gerätename...',
      onInput: (e) => { this.customName = e.target.value; },
    });

    const catGrid = h('div', { class: 'cat-grid' },
      ...DEVICE_CATEGORIES.map((c) => {
        const card = h('div', {
          class: 'cat-card', style: { '--cat-color': c.color },
          ...(this.selectedCategory === c.id ? { 'data-selected': '' } : {}),
          onClick: () => {
            this.selectedCategory = c.id;
            this.channels.forEach((ch) => { ch.category = c.id; });
            this._render();
          },
        },
        icon(c.icon),
        h('div', {}, c.name));
        return card;
      }));

    const curCat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const hero = h('div', { class: 'win11-hero-badge', style: { color: curCat.color, '--hero-color': curCat.color } }, icon(curCat.icon));

    this.body.replaceChildren(
      hero,
      h('div', { class: 'section-title' }, 'Geräteinformationen'),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, 'Anzeigename im Dashboard', nameInput),
        h('div', { class: 'field' }, 'Raum (Bereich)', areaDropdown.el)),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Haupt-Kategorie'),
      h('div', { class: 'hint' }, 'Bestimmt das Standard-Icon und das Verhalten im Dashboard:'),
      catGrid);
  }

  // ═══════════════ STEP 2: Kanäle & Messung ═══════════════
  _renderStep2() {
    const isMulti = this.channels.length > 1;

    if (!this.channels.length) {
      this.body.replaceChildren(h('div', { class: 'empty' },
        icon('mdi:alert-circle-outline'),
        h('div', { style: { fontWeight: '600' } }, 'Keine steuerbaren Entitäten gefunden'),
        h('div', { class: 'hint' }, 'Dieses Gerät hat keine Schalter, Lichter oder Jalousien in Home Assistant.')));
      return;
    }

    const curCat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const hero = h('div', { class: 'win11-hero-badge', style: { color: curCat.color || 'var(--cd-accent)', '--hero-color': curCat.color || 'var(--cd-accent)' } }, icon(curCat.icon || 'mdi:tune-vertical'));

    const header = h('div', { style: { textAlign: 'center', marginBottom: '14px' } },
      h('h3', { style: { margin: '0 0 4px', fontSize: '18px', fontWeight: '700' } }, isMulti ? 'Kanäle & Messung' : 'Messung & Simulation'),
      h('div', { class: 'hint' }, isMulti
        ? 'Mehrkanal-Gerät: Kanäle separat konfigurieren und zuordnen'
        : 'Optionale Leistungsmessung (Watt) und automatische Anwesenheitssimulation'));

    if (!isMulti) {
      // SINGLE ENTITY: No duplicate channel name, no duplicate category, no confusing disable switch!
      const ch = this.channels[0];

      const powerPicker = new EntityPicker({
        hass: this.hass,
        value: ch.power || '',
        placeholder: 'sensor.xxx_power (optional)',
        domain: 'sensor',
        onChange: (val) => {
          ch.power = val;
          this.powerEntityId = val;
        },
      });

      const isAutoPower = ch.power && ch.power === this.powerEntityId;
      const powerBadge = isAutoPower
        ? h('span', { class: 'badge-tag ok auto-badge', style: { marginLeft: '8px' } }, icon('mdi:check-circle'), 'Automatisch erkannt')
        : null;

      const powerCard = h('div', { class: 'row-card', style: { padding: '16px 20px', gap: '12px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          h('div', { class: 'feature-icon', style: { color: '#ffb74d', display: 'grid', placeItems: 'center', width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,183,77,0.15)' } }, icon('mdi:flash')),
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontWeight: '600', fontSize: '15px', display: 'flex', alignItems: 'center' } },
              'Leistungssensor (Watt)', powerBadge),
            h('div', { class: 'hint', style: { marginTop: '2px' } }, 'Zeigt den aktuellen Stromverbrauch live auf der Kachel an'))),
        powerPicker.el);

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
        h('div', { class: 'feature-desc' }, 'Zufälliges automatisches Schalten bei Abwesenheit zum Einbruchschutz')),
      h('div', { class: 'switch-ui' }));

      this.body.replaceChildren(hero, header, powerCard, simCard);
      return;
    }

    // MULTI-CHANNEL DEVICE (e.g. Shelly 2PM)
    const catOptions = DEVICE_CATEGORIES.map((c) => ({
      value: c.id, label: c.name, icon: c.icon, color: c.color,
    }));

    const channelCards = this.channels.map((ch, idx) => {
      const nameInput = h('input', {
        type: 'text', value: ch.name, placeholder: `Kanal ${idx + 1} Name...`, disabled: !ch.enabled,
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
        placeholder: 'sensor.xxx_power (optional)',
        domain: 'sensor',
        onChange: (val) => { ch.power = val; },
      });

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
        h('div', { class: 'feature-desc' }, 'Zufälliges automatisches Schalten bei Abwesenheit zum Einbruchschutz')),
      h('div', { class: 'switch-ui' }));

      const isAutoPower = ch.power && ch.power === this.powerEntityId;
      const powerBadge = isAutoPower
        ? h('span', { class: 'badge-tag ok auto-badge' }, icon('mdi:check-circle'), 'Automatisch erkannt')
        : null;

      const enabledToggle = h('div', {
        class: 'switch-ui',
        style: { cursor: 'pointer' },
        onClick: (e) => {
          e.stopPropagation();
          ch.enabled = !ch.enabled;
          this._renderStep2();
        },
      });

      const headCard = h('div', {
        class: 'channel-head',
        style: { cursor: 'pointer' },
        onClick: () => { ch.enabled = !ch.enabled; this._renderStep2(); },
      },
      enabledToggle,
      h('div', { class: 'ch-title' }, ch.name || ch.entity_id),
      h('span', { class: 'badge-tag' }, ch.entity_id));

      if (ch.enabled) headCard.setAttribute('data-active', '');

      return h('div', { class: 'channel-card', style: ch.enabled ? {} : { opacity: '0.5' } },
        headCard,
        h('div', { class: 'fields' },
          h('div', { class: 'field' },
            h('div', { class: 'field-head' }, h('span', { class: 'field-label' }, 'Kanal-Name')),
            nameInput),
          h('div', { class: 'field' },
            h('div', { class: 'field-head' }, h('span', { class: 'field-label' }, 'Kategorie')),
            catDropdown.el),
          h('div', { class: 'field' },
            h('div', { class: 'field-head' },
              h('span', { class: 'field-label' }, 'Leistungssensor (Watt)'),
              powerBadge),
            powerPicker.el)),
        simCard);
    });

    this.body.replaceChildren(hero, header, ...channelCards);
  }

  // ═══════════════ STEP 3: Zusammenfassung & Speichern ═══════════════
  _renderStep3() {
    const area = this.areas.find((a) => a.area_id === this.selectedAreaId);
    const areaName = area?.name || 'Kein Raum';
    const cat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const activeChannels = this.channels.filter((c) => c.enabled);

    // Reliable Hero Badge with Category Icon and glowing ring
    const hero = h('div', { class: 'win11-hero-badge', style: { color: cat.color, '--hero-color': cat.color } }, icon(cat.icon || 'mdi:check-circle'));

    const header = h('div', { style: { textAlign: 'center', marginBottom: '14px' } },
      h('h3', { style: { margin: '0 0 4px', fontSize: '18px', fontWeight: '700' } }, 'Fast fertig!'),
      h('div', { class: 'hint' }, 'Überprüfe die Einstellungen vor dem Speichern'));

    // Live visual preview card
    const hasSim = activeChannels.some((c) => c.presence_simulation);
    const hasPower = activeChannels.some((c) => c.power);

    const previewCard = h('div', {
      class: 'win11-preview-card',
      style: { '--preview-color': cat.color },
    },
    h('div', { class: 'win11-preview-icon' }, icon(cat.icon)),
    h('div', { class: 'win11-preview-info' },
      h('div', { class: 'win11-preview-name' }, this.customName || 'Mein Gerät'),
      h('div', { class: 'win11-preview-meta' },
        h('span', { class: 'badge-tag ok' }, icon(cat.icon), cat.name),
        h('span', { class: 'badge-tag area' }, icon('mdi:map-marker'), areaName),
        hasPower ? h('span', { class: 'badge-tag', style: { color: '#ffb74d' } }, icon('mdi:flash'), 'Leistungsmessung') : null,
        hasSim ? h('span', { class: 'badge-tag', style: { color: '#ce93d8' } }, icon('mdi:home-clock'), 'Simulation') : null)));

    // Home Assistant sync card: Hidden inside collapsible <details>, default active
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
      h('div', { class: 'feature-title' }, 'In Home Assistant synchronisieren (Standard: Aktiv)'),
      h('div', { class: 'feature-desc' }, 'Aktualisiert Gerätename und Raumzuweisung direkt in den HA-Registries')),
    h('div', { class: 'switch-ui' }));

    const syncAccordion = h('details', { class: 'adv-options' },
      h('summary', {}, icon('mdi:cog-outline'), 'Erweiterte Optionen: Home Assistant Synchronisierung'),
      h('div', { class: 'adv-content' }, syncCard));

    // Channel details (only shown if multi-channel)
    const channelSummary = this.channels.length > 1
      ? h('div', { class: 'row-card', style: { marginTop: '12px' } },
        h('div', { style: { fontWeight: '600', fontSize: '13px' } }, `Kanäle (${activeChannels.length} aktiv)`),
        h('div', { class: 'hint' }, activeChannels.map((c) => {
          const cCat = DEVICE_CATEGORIES.find((catItem) => catItem.id === c.category);
          return `• ${c.name} (${c.entity_id}) – ${cCat?.name || c.category}`;
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

  // ═══════════════ POST-SAVE CELEBRATION (Windows 11 Setup Vibe) ═══════════════
  _renderCelebration() {
    this.stepBar.hidden = true;
    this.foot.hidden = true;
    this.dialog.style.setProperty('--hero-color', '#10b981');

    const cat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const area = this.areas.find((a) => a.area_id === this.selectedAreaId);
    const areaName = area?.name || 'Dashboard';

    const celebration = h('div', { class: 'win11-celebration' },
      h('div', { class: 'win11-success-badge' }, icon('mdi:check')),
      h('h2', { style: { margin: '8px 0 2px', fontSize: '22px', fontWeight: '700', color: 'var(--primary-text-color, #fff)' } }, 'Alles bereit!'),
      h('div', { class: 'hint', style: { fontSize: '15px', maxWidth: '440px', lineHeight: '1.5', color: 'rgba(255,255,255,0.85)' } },
        `Gerät „${this.customName}“ wurde erfolgreich im Raum „${areaName}“ eingerichtet.`),
      h('div', { style: { display: 'flex', gap: '12px', marginTop: '18px' } },
        h('button', {
          class: 'btn secondary',
          onClick: () => {
            this.isCelebration = false;
            this.step = 0;
            this.selectedDevice = null;
            this._render();
          },
        }, icon('mdi:plus'), 'Weiteres Gerät einrichten'),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            this.onClose();
            this.onSaved(null);
          },
        }, icon('mdi:view-dashboard'), 'Zum Dashboard')));

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
    const isMulti = this.channels.length > 1;
    const activeChannels = this.channels.filter((c) => c.enabled);

    try {
      // 1. Rename in Home Assistant if checked
      if (this.renameInHA && d) {
        try {
          await this.hass.callWS({
            type: 'config/device_registry/update',
            device_id: d.id,
            name_by_user: this.customName || undefined,
            area_id: this.selectedAreaId || undefined,
          });
        } catch (err) {
          console.warn('[wizard] device rename failed', err);
        }

        // Entity renames
        for (const ch of activeChannels) {
          try {
            await this.hass.callWS({
              type: 'config/entity_registry/update',
              entity_id: ch.entity_id,
              name: ch.name || undefined,
              area_id: this.selectedAreaId || undefined,
            });
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

      const res = await this.hass.callWS({
        type: 'smarthome_companion/devices/configure',
        device_id: d.id,
        category: this.selectedCategory,
        custom_name: this.customName,
        area_id: this.selectedAreaId || undefined,
        entities: entitiesConfig,
      });

      if (res?.save_failed) throw new Error('Speichern im Backend fehlgeschlagen');

      this._saving = false;
      this.isCelebration = true;
      this._renderCelebration();
    } catch (err) {
      this._saving = false;
      this._renderFoot();
      this.onSaved(err);
    }
  }
}
