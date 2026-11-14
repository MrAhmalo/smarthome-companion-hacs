import { h, icon, domainOf } from '../lib/util.js';

export const DEVICE_CATEGORIES = [
  { id: 'leuchte', name: 'Leuchte', icon: 'mdi:lightbulb', color: '#ffc107', desc: 'Lampen, Spots & LED' },
  { id: 'steckdose', name: 'Steckdose', icon: 'mdi:power-socket-eu', color: '#009688', desc: 'Zwischenstecker & Dosen' },
  { id: 'schalter', name: 'Gerät / Relais', icon: 'mdi:power-plug', color: '#2196f3', desc: 'Schalter & Relais' },
  { id: 'jalousie', name: 'Jalousie', icon: 'mdi:window-shutter', color: '#9c27b0', desc: 'Rollläden & Markisen' },
  { id: 'wasserventil', name: 'Wasserventil', icon: 'mdi:water-pump', color: '#00bcd4', desc: 'Bewässerungsventile' },
  { id: 'pumpe', name: 'Pumpe', icon: 'mdi:pump', color: '#03a9f4', desc: 'Wasserpumpen' },
  { id: 'klima', name: 'Klima', icon: 'mdi:thermometer', color: '#ff9800', desc: 'Thermostate & Klima' },
  { id: 'fernseher', name: 'Fernseher', icon: 'mdi:television', color: '#03a9f4', desc: 'TVs & Mediaplayer' },
  { id: 'bewegungsmelder', name: 'Bewegungsmelder', icon: 'mdi:motion-sensor', color: '#e91e63', desc: 'Präsenz & Bewegung' },
  { id: 'rauchmelder', name: 'Rauchmelder', icon: 'mdi:smoke-detector', color: '#ef4444', desc: 'Rauch & Brandmelder' },
  { id: 'bodenmessgeraet', name: 'Bodenmessgerät', icon: 'mdi:sprout', color: '#4caf50', desc: 'Bodenfeuchte & Pflanzen' },
  { id: 'raummessgeraet', name: 'Raummessgerät', icon: 'mdi:thermometer-lines', color: '#ff5722', desc: 'Temperatur & Klima' },
];

const CONTROLLABLE_DOMAINS = new Set([
  'light', 'switch', 'cover', 'valve', 'climate', 'media_player', 'fan',
]);

/** Returns true if an entity belongs to SmartHome Companion's own internal integration. */
export function isOwnIntegrationEntity(e) {
  if (!e) return false;
  if (e.platform === 'smarthome_companion_hacs') return true;
  if (typeof e.unique_id === 'string' && e.unique_id.startsWith('smarthome_companion_')) return true;
  return false;
}

/** Returns true if a device belongs to SmartHome Companion's own internal entities/groups. */
export function isOwnIntegrationDevice(d, entities = []) {
  if (!d) return false;
  if (d.manufacturer === 'SmartHome Companion') return true;
  if (Array.isArray(d.identifiers) && d.identifiers.some((pair) => Array.isArray(pair) && pair[0] === 'smarthome_companion_hacs')) {
    return true;
  }
  const devEnts = entities.filter((e) => e.device_id === d.id);
  if (devEnts.length > 0 && devEnts.every(isOwnIntegrationEntity)) return true;
  return false;
}

/**
 * Compute actuator channels of a configured device that were explicitly left
 * unconfigured (enabled === false) or newly added in HA since setup.
 */
export function getPendingChannelsForDevice(device, entities, configuredCfg) {
  if (!configuredCfg || !device) return [];
  if (device.isVirtualEntity) return [];
  const devEntities = entities.filter((e) => e.device_id === device.id && !e.disabled_by && !e.hidden_by);
  const controllable = devEntities.filter(isControllableActuator);
  if (!controllable.length) return [];

  const subs = configuredCfg.entities?.sub_entities;
  if (subs && typeof subs === 'object' && Object.keys(subs).length > 0) {
    const subsList = Object.entries(subs);
    return controllable.filter((e) => {
      let entry = subs[e.entity_id];
      if (!entry && e.unique_id) {
        const found = subsList.find(([, s]) => s && s.unique_id === e.unique_id);
        entry = found ? found[1] : null;
      }
      if (!entry) return controllable.length > 1;
      return entry.enabled === false;
    });
  }
  return [];
}

/**
 * Filter out configuration, diagnostic, and internal utility switches.
 * Only genuine controllable actuators are treated as device channels.
 */
export function isControllableActuator(e) {
  if (!e || !e.entity_id) return false;
  if (e.disabled_by || e.hidden_by) return false;
  if (isOwnIntegrationEntity(e)) return false;
  if (e.entity_category === 'config' || e.entity_category === 'diagnostic') return false;

  const domain = domainOf(e.entity_id);
  if (!CONTROLLABLE_DOMAINS.has(domain)) return false;

  const id = (e.entity_id || '').toLowerCase();
  const name = (e.name || e.original_name || '').toLowerCase();
  const configPattern = /(?:overcharge|protection|kindersicherung|child_?lock|indicator|led_?mode|backlight|status_?led|restart|reboot|update|firmware|start_?zustand|start_?state|auto_?off|inching|pairing|identify|interlock|relay_mode|power_on_state)/;
  if (configPattern.test(id) || configPattern.test(name)) return false;

  return true;
}

/** Build a group card shared by DeviceWizard and Settings. */
export function createGroupCard({
  group,
  isSelected = false,
  selectable = false,
  subtitle = null,
  onToggleSelect = null,
  onCardClick = null,
  onEdit = null,
  onDelete = null,
}) {
  const cat = DEVICE_CATEGORIES.find((c) => c.id === group.category);
  const catColor = cat?.color || '#ffc107';

  const chk = selectable
    ? h('button', {
      class: 'sel-checkbox',
      ...(isSelected ? { 'data-checked': '' } : {}),
      type: 'button',
      'aria-label': `${group.name} auswählen`,
      onClick: (e) => { e.stopPropagation(); onToggleSelect?.(); },
    }, isSelected ? icon('mdi:check') : null)
    : null;

  return h('div', {
    class: 'device-card group-card',
    ...(isSelected ? { 'data-selected': '' } : {}),
    onClick: () => (onCardClick || onEdit)?.(),
  },
  chk,
  h('div', { class: 'd-icon', style: { color: catColor } }, icon(group.icon || 'mdi:lightbulb-group')),
  h('div', { class: 'd-info' },
    h('div', { class: 'd-name' }, group.name || 'Gruppe'),
    h('div', { class: 'd-meta' },
      h('span', { class: 'badge-tag category', style: { '--badge-cat-color': catColor } },
        icon('mdi:lightbulb-group'),
        `Gruppe (${group.children?.length || 0})`),
      subtitle ? h('span', {}, subtitle) : null)),
  h('div', { class: 'device-card-actions' },
    onEdit ? h('button', {
      type: 'button',
      class: 'btn secondary small',
      title: 'Gruppe bearbeiten',
      'aria-label': 'Bearbeiten',
      onClick: (e) => { e.stopPropagation(); onEdit(); },
    }, icon('mdi:pencil'), h('span', {}, 'Bearbeiten')) : null,
    onDelete ? h('button', {
      type: 'button',
      class: 'icon-btn danger',
      title: 'Gruppe auflösen',
      'aria-label': 'Gruppe auflösen',
      onClick: (e) => { e.stopPropagation(); onDelete(); },
    }, icon('mdi:delete-outline')) : null));
}

/** Build a device card (+ expandable channel list) for Step 0 wizard view. */
export function createWizardDeviceElements({
  device,
  entities,
  configuredCfg,
  isSelected = false,
  isExpanded = false,
  selectedIds = null,
  onToggleSelect,
  onToggleChannelSelect,
  onToggleExpand,
  onConfigure,
  onRemove,
  onCardClick,
}) {
  const name = device.name_by_user || device.name || 'Gerät';
  const mfg = device.isVirtualEntity
    ? `Zigbee / Lichtgruppe · ${device.entity_id}`
    : [device.manufacturer, device.model].filter(Boolean).join(' · ');
  const isConfigured = !!configuredCfg;

  const devEntities = device.isVirtualEntity
    ? entities.filter((e) => e.entity_id === device.entity_id && !e.disabled_by)
    : entities.filter((e) => e.device_id === device.id && !e.disabled_by && !e.hidden_by && !isOwnIntegrationEntity(e));
  const controllable = devEntities.filter(isControllableActuator);
  const pendingChannels = isConfigured ? getPendingChannelsForDevice(device, entities, configuredCfg) : [];

  const chk = h('button', {
    class: 'sel-checkbox',
    ...(isSelected ? { 'data-checked': '' } : {}),
    type: 'button',
    'aria-label': `${name} auswählen`,
    onClick: (e) => { e.stopPropagation(); onToggleSelect?.(); },
  }, isSelected ? icon('mdi:check') : null);

  const badges = [];
  if (isConfigured) {
    const cat = DEVICE_CATEGORIES.find((c) => c.id === configuredCfg.category);
    const catColor = cat?.color || 'var(--cd-accent)';
    badges.push(h('span', {
      class: 'badge-tag category',
      style: { '--badge-cat-color': catColor },
    }, icon(cat?.icon || 'mdi:check-circle'), cat?.name || configuredCfg.category));
    if (pendingChannels.length > 0) {
      badges.push(h('span', {
        class: 'badge-tag pending-channels',
      }, icon('mdi:alert-circle-outline'), `${pendingChannels.length} ${pendingChannels.length === 1 ? 'Kanal' : 'Kanäle'} offen`));
    }
  } else if (device.isVirtualEntity) {
    badges.push(h('span', { class: 'badge-tag' }, icon('mdi:lightbulb-group-outline'), 'Lichtgruppe'));
  } else if (controllable.length > 1) {
    badges.push(h('button', {
      class: 'btn-channels-toggle',
      type: 'button',
      title: isExpanded ? 'Kanäle einklappen' : 'Kanäle anzeigen',
      onClick: (e) => { e.stopPropagation(); onToggleExpand?.(); },
    }, icon(isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'), `${controllable.length} Kanäle`));
  } else if (controllable.length === 1) {
    badges.push(h('span', { class: 'badge-tag' }, '1 Kanal'));
  }

  const actions = isConfigured
    ? [
      h('button', {
        type: 'button',
        class: `btn ${pendingChannels.length > 0 ? 'primary' : 'secondary'} small`,
        title: pendingChannels.length > 0 ? 'Offene Kanäle einrichten' : 'Gerät bearbeiten',
        'aria-label': 'Bearbeiten',
        onClick: (e) => { e.stopPropagation(); onConfigure?.(); },
      }, icon('mdi:pencil'), h('span', {}, pendingChannels.length > 0 ? 'Kanäle einrichten' : 'Bearbeiten')),
      h('button', {
        type: 'button',
        class: 'icon-btn danger',
        title: 'Einrichtung aufheben',
        'aria-label': 'Einrichtung aufheben',
        onClick: (e) => { e.stopPropagation(); onRemove?.(); },
      }, icon('mdi:delete-outline')),
    ]
    : [
      h('button', {
        type: 'button',
        class: 'btn primary small',
        title: 'Gerät einrichten',
        'aria-label': 'Einrichten',
        onClick: (e) => { e.stopPropagation(); onConfigure?.(); },
      }, icon('mdi:plus'), h('span', {}, 'Einrichten')),
    ];

  const mainCard = h('div', {
    class: 'device-card',
    ...(isSelected ? { 'data-selected': '' } : {}),
    onClick: () => (onCardClick || onConfigure)?.(),
  },
  chk,
  h('div', { class: 'd-icon' }, icon(device.isVirtualEntity ? 'mdi:lightbulb-group-outline' : 'mdi:devices')),
  h('div', { class: 'd-info' },
    h('div', { class: 'd-name' }, name),
    h('div', { class: 'd-meta' }, mfg ? h('span', { class: 'd-mfg' }, mfg) : null, ...badges)),
  h('div', { class: 'device-card-actions' }, ...actions));

  if (isExpanded && controllable.length > 1) {
    const channelRows = controllable.map((e) => {
      const chKey = `d:${device.id}:${e.entity_id}`;
      const isChChecked = !!selectedIds?.has(chKey);
      const chName = e.name || e.original_name || e.entity_id;
      const isLight = domainOf(e.entity_id) === 'light';
      return h('div', {
        class: 'device-channel-row',
        ...(isChChecked ? { 'data-selected': '' } : {}),
        onClick: (ev) => { ev.stopPropagation(); onToggleChannelSelect?.(chKey); },
      },
      h('button', {
        class: 'sel-checkbox',
        ...(isChChecked ? { 'data-checked': '' } : {}),
        type: 'button',
        'aria-label': `${chName} auswählen`,
        onClick: (ev) => { ev.stopPropagation(); onToggleChannelSelect?.(chKey); },
      }, isChChecked ? icon('mdi:check') : null),
      icon(isLight ? 'mdi:lightbulb' : 'mdi:power-plug'),
      h('div', { class: 'device-channel-info' },
        h('div', { class: 'device-channel-name' }, chName),
        h('div', { class: 'device-channel-meta' }, e.entity_id)));
    });
    return [mainCard, h('div', { class: 'device-channels-wrap' }, ...channelRows)];
  }

  return [mainCard];
}

/** Build a room section wrapping `.device-cards` without creating a nested scrollbox. */
export function createDeviceRoomSection(areaName, cardElements, itemCount = cardElements.length, roomIcon = null) {
  const iconName = areaName === 'Ohne Raum' ? 'mdi:help-circle-outline' : (roomIcon || 'mdi:home-outline');
  return h('div', { class: 'device-room-section' },
    h('div', { class: 'device-room-header' },
      icon(iconName),
      h('span', {}, areaName),
      h('span', { class: 'room-count' }, `(${itemCount})`)),
    h('div', { class: 'device-cards' }, ...cardElements));
}
