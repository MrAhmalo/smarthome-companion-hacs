import { h, icon, domainOf } from '../lib/util.js';
import { EntityPicker } from './entity_picker.js';

export const DEVICE_CATEGORIES = [
  { id: 'leuchte', name: 'Leuchte', icon: 'mdi:lightbulb', color: '#f59e0b', desc: 'Lampen, Spots & LED-Streifen' },
  { id: 'steckdose', name: 'Steckdose', icon: 'mdi:power-socket-eu', color: '#10b981', desc: 'Zwischenstecker & Dosen' },
  { id: 'schalter', name: 'Gerät / Relais', icon: 'mdi:power-plug', color: '#3b82f6', desc: 'Allgemeine Schalter' },
  { id: 'jalousie', name: 'Jalousie', icon: 'mdi:window-shutter', color: '#6366f1', desc: 'Rollläden & Markisen' },
  { id: 'wasserventil', name: 'Wasserventil', icon: 'mdi:water-pump', color: '#06b6d4', desc: 'Bewässerungsventile' },
  { id: 'pumpe', name: 'Pumpe', icon: 'mdi:pump', color: '#0ea5e9', desc: 'Garten- & Wasserpumpen' },
  { id: 'klima', name: 'Klima', icon: 'mdi:thermometer', color: '#ef4444', desc: 'Thermostate & Klima' },
  { id: 'fernseher', name: 'Fernseher', icon: 'mdi:television', color: '#8b5cf6', desc: 'TVs & Mediaplayer' },
  { id: 'bewegungsmelder', name: 'Bewegungsmelder', icon: 'mdi:motion-sensor', color: '#f43f5e', desc: 'Präsenz- & Bewegung' },
  { id: 'bodenmessgeraet', name: 'Bodenmessgerät', icon: 'mdi:sprout', color: '#14b8a6', desc: 'Bodenfeuchte & Pflanzen' },
  { id: 'raummessgeraet', name: 'Raummessgerät', icon: 'mdi:thermometer-lines', color: '#f43f5e', desc: 'Raumluft- & Temperatursensoren' },
];

const CONTROLLABLE_DOMAINS = new Set(['light', 'switch', 'cover', 'valve', 'climate', 'media_player', 'fan']);

export class DeviceWizard {
  /**
   * @param {{hass:object, onClose:Function, onSaved:Function}} opts
   */
  constructor({ hass, onClose, onSaved }) {
    this.hass = hass;
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

    this._build();
    this._load();
  }

  _build() {
    this.body = h('div', { class: 'dialog-body' });
    this.stepBar = h('div', { class: 'wizard-steps' });
    this.foot = h('div', { class: 'dialog-foot' });

    this.el = h('div', { class: 'overlay', onClick: (e) => { if (e.target === this.el) this.onClose(); } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Gerät einrichten' },
        h('div', { class: 'dialog-head' },
          icon('mdi:plus-circle-outline'),
          h('h2', {}, 'Gerät einrichten'),
          h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: () => this.onClose() }, icon('mdi:close'))),
        this.stepBar,
        this.body,
        this.foot));
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
      this._render();
    } catch (err) {
      this.body.replaceChildren(h('div', { class: 'empty' }, icon('mdi:alert'), h('div', {}, `Fehler beim Laden: ${err.message || err}`)));
    }
  }

  _render() {
    this._renderSteps();
    this._renderBody();
    this._renderFoot();
  }

  _renderSteps() {
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
    const isFirst = this.step === 0;
    const isLast = this.step === this.steps.length - 1;

    const backBtn = isFirst
      ? h('button', { class: 'btn', onClick: () => this.onClose() }, 'Abbrechen')
      : h('button', { class: 'btn', onClick: () => { this.step--; this._render(); } }, icon('mdi:chevron-left'), 'Zurück');

    let nextBtn;
    if (isFirst) {
      nextBtn = h('button', {
        class: 'btn primary', disabled: !this.selectedDevice,
        onClick: () => { if (this.selectedDevice) { this._initDevice(); this.step = 1; this._render(); } },
      }, 'Weiter', icon('mdi:chevron-right'));
    } else if (!isLast) {
      nextBtn = h('button', {
        class: 'btn primary',
        onClick: () => { this.step++; this._render(); },
      }, 'Weiter', icon('mdi:chevron-right'));
    } else {
      nextBtn = h('button', {
        class: 'btn success', disabled: this._saving,
        onClick: () => this._save(),
      }, icon('mdi:check'), this._saving ? 'Wird gespeichert...' : 'Fertigstellen');
    }

    this.foot.replaceChildren(backBtn, nextBtn);
  }

  // ═══════════════ STEP 0: Gerät auswählen ═══════════════
  _renderStep0() {
    const areaMap = new Map(this.areas.map((a) => [a.area_id, a.name]));

    const searchInput = h('input', {
      type: 'text', placeholder: 'Gerät suchen (Name, Hersteller, Modell, Raum)...', value: this.searchQuery,
      onInput: (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this._updateDeviceList(); },
    });
    const searchWrap = h('div', { class: 'search-bar' }, icon('mdi:magnify'), searchInput);

    const filterChips = h('div', { class: 'filter-chips' },
      ...[
        ['unconfigured', 'Nicht eingerichtet'],
        ['all', 'Alle Geräte'],
        ['configured', 'Bereits eingerichtet'],
      ].map(([id, label]) => h('button', {
        class: 'filter-chip', ...(id === this.statusFilter ? { 'data-active': '' } : {}),
        onClick: () => { this.statusFilter = id; this._renderStep0(); },
      }, label)));

    this.deviceListEl = h('div', { class: 'device-list' });
    this._updateDeviceList();

    this.body.replaceChildren(
      h('div', { class: 'hint' }, '• Wähle das Gerät aus, das im Dashboard eingerichtet werden soll.\n• Mehrkanal-Geräte (z. B. Shelly 2PM) können separat benannt werden.'),
      searchWrap,
      filterChips,
      this.deviceListEl);
  }

  _updateDeviceList() {
    const areaMap = new Map(this.areas.map((a) => [a.area_id, a.name]));
    const q = this.searchQuery;

    const filtered = this.devices.filter((d) => {
      if (d.disabled_by) return false;
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
      icon('mdi:chevron-right', 'chevron'));
      return card;
    }));
  }

  // ═══════════════ Initialize selected device ═══════════════
  _initDevice() {
    const d = this.selectedDevice;
    if (!d) return;
    const existing = this.configuredDevices[d.id];

    this.customName = existing?.custom_name || d.name_by_user || d.name || '';
    this.selectedAreaId = d.area_id || '';

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
      const channelName = sub.custom_name || sub.name || e.name || e.original_name || (controllable.length > 1 ? `Kanal ${idx + 1}` : this.customName);
      return {
        entity_id: e.entity_id,
        unique_id: e.unique_id || '',
        enabled: sub.enabled !== undefined ? !!sub.enabled : true,
        name: channelName,
        category: sub.category || this.selectedCategory,
        power: sub.power || (idx === 0 ? powerSensor : ''),
        energy: sub.energy || (idx === 0 ? energySensor : ''),
        presence_simulation: !!sub.presence_simulation,
      };
    });

    this.primaryEntityId = existing?.entities?.primary || controllable[0]?.entity_id || '';
    this.powerEntityId = existing?.entities?.power || powerSensor;
    this.energyEntityId = existing?.entities?.energy || energySensor;
  }

  // ═══════════════ STEP 1: Details (Name, Kategorie, Raum) ═══════════════
  _renderStep1() {
    const areaOptions = [['', 'Kein Raum'], ...this.areas.map((a) => [a.area_id, a.name])];

    const nameInput = h('input', {
      type: 'text', value: this.customName, placeholder: 'Gerätename...',
      onInput: (e) => { this.customName = e.target.value; },
    });

    const areaSelect = h('select', {
      onChange: (e) => { this.selectedAreaId = e.target.value; },
    }, areaOptions.map(([id, label]) => h('option', { value: id, selected: id === this.selectedAreaId }, label)));

    const catGrid = h('div', { class: 'cat-grid' },
      ...DEVICE_CATEGORIES.map((c) => {
        const card = h('div', {
          class: 'cat-card', style: { '--cat-color': c.color },
          ...(this.selectedCategory === c.id ? { 'data-selected': '' } : {}),
          onClick: () => {
            this.selectedCategory = c.id;
            // Also update category of channels that haven't been manually diverged
            this.channels.forEach((ch) => { ch.category = c.id; });
            this._renderStep1();
          },
        },
        icon(c.icon),
        h('div', {}, c.name));
        return card;
      }));

    this.body.replaceChildren(
      h('div', { class: 'section-title' }, 'Geräteinformationen'),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, 'Anzeigename im Dashboard', nameInput),
        h('label', { class: 'field' }, 'Raum (Bereich)', areaSelect)),
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

    const catOptions = DEVICE_CATEGORIES.map((c) => [c.id, c.name]);

    const channelCards = this.channels.map((ch, idx) => {
      const enabledCheck = h('input', {
        type: 'checkbox', checked: ch.enabled,
        onChange: (e) => { ch.enabled = e.target.checked; this._renderStep2(); },
      });

      const nameInput = h('input', {
        type: 'text', value: ch.name, placeholder: `Kanal ${idx + 1} Name...`, disabled: !ch.enabled,
        onInput: (e) => { ch.name = e.target.value; },
      });

      const catSelect = h('select', {
        disabled: !ch.enabled,
        onChange: (e) => { ch.category = e.target.value; },
      }, catOptions.map(([id, label]) => h('option', { value: id, selected: id === ch.category }, label)));

      const powerPicker = new EntityPicker({
        hass: this.hass,
        value: ch.power || '',
        placeholder: 'sensor.xxx_power (optional)',
        domain: 'sensor',
        onChange: (val) => { ch.power = val; },
      });

      const simCheck = h('input', {
        type: 'checkbox', checked: ch.presence_simulation, disabled: !ch.enabled,
        onChange: (e) => { ch.presence_simulation = e.target.checked; },
      });

      return h('div', { class: 'channel-card', style: ch.enabled ? {} : { opacity: '0.6' } },
        h('div', { class: 'channel-head' },
          enabledCheck,
          h('div', { class: 'ch-title' }, ch.name || ch.entity_id),
          h('span', { class: 'badge-tag' }, ch.entity_id)),
        h('div', { class: 'fields' },
          h('label', { class: 'field' }, 'Kanal-Name', nameInput),
          h('label', { class: 'field' }, 'Kategorie', catSelect),
          h('label', { class: 'field' }, 'Leistungssensor (Watt)', powerPicker.el),
          h('label', { class: 'field check' }, simCheck, 'Anwesenheitssimulation')));
    });

    this.body.replaceChildren(
      h('div', { class: 'hint' }, isMulti
        ? '• Mehrkanal-Gerät erkannt (z. B. Shelly 2PM).\n• Jeder Kanal kann aktiviert, benannt und einer Kategorie zugeordnet werden.'
        : '• Einzel-Entität erkannt. Name und Leistungsmessung können angepasst werden.'),
      ...channelCards);
  }

  // ═══════════════ STEP 3: Zusammenfassung & Speichern ═══════════════
  _renderStep3() {
    const areaName = this.areas.find((a) => a.area_id === this.selectedAreaId)?.name || 'Kein Raum';
    const cat = DEVICE_CATEGORIES.find((c) => c.id === this.selectedCategory) || DEVICE_CATEGORIES[0];
    const activeChannels = this.channels.filter((c) => c.enabled);

    const renameCheck = h('input', {
      type: 'checkbox', checked: this.renameInHA,
      onChange: (e) => { this.renameInHA = e.target.checked; },
    });

    const summaryCard = h('div', { class: 'row-card' },
      h('div', { class: 'row-head' },
        icon(cat.icon),
        h('div', { class: 'row-title' }, this.customName || 'Gerät'),
        h('span', { class: 'badge-tag area' }, areaName),
        h('span', { class: 'badge-tag ok' }, cat.name)),
      h('div', { class: 'hint' }, `• Modell: ${this.selectedDevice?.manufacturer || ''} ${this.selectedDevice?.model || ''}\n• ${activeChannels.length} aktive(r) Kanal/Kanäle:\n${activeChannels.map((c) => `  – ${c.name} (${c.entity_id})`).join('\n')}`));

    this.body.replaceChildren(
      h('div', { class: 'section-title' }, 'Zusammenfassung'),
      summaryCard,
      h('div', { style: { marginTop: '16px' } },
        h('label', { class: 'field check' }, renameCheck, 'In Home Assistant umbenennen & Raum zuweisen'),
        h('div', { class: 'hint', style: { marginLeft: '28px' } }, 'Aktualisiert die Gerätenamen und Entitäten direkt in den Home Assistant Registries.')));
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

      this.onSaved(null);
    } catch (err) {
      this._saving = false;
      this._renderFoot();
      this.onSaved(err);
    }
  }
}
