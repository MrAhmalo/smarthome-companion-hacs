// Shared helpers for the Companion dashboard (no external dependencies).

/** Tiny hyperscript helper: h('div', {class:'x', onClick: fn}, child, ...) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') {
      if (typeof value === 'object') {
        for (const [sKey, sVal] of Object.entries(value)) {
          if (sKey.startsWith('--')) el.style.setProperty(sKey, sVal);
          else el.style[sKey] = sVal;
        }
      } else if (typeof value === 'string') {
        el.style.cssText = value;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(key)) el[key] = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const icon = (name, cls = '') => h('ha-icon', { icon: name, class: cls });

/** Reusable SVG marching-ants dashed overlay rect rendered in Edit Mode. */
export function editBorder(rx = 10) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'edit-march-svg');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('width', '100%');
  rect.setAttribute('height', '100%');
  rect.setAttribute('rx', String(rx));
  rect.setAttribute('ry', String(rx));
  svg.appendChild(rect);
  return svg;
}

export const domainOf = (entityId) => (entityId || '').split('.')[0];

/** Replace all children of `el`. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
}

// ── Colours ──
export const COLORS = {
  red: '#f44336', orange: '#ff9800', amber: '#ffc107', yellow: '#ffeb3b', lime: '#8bc34a',
  green: '#4caf50', teal: '#009688', cyan: '#00bcd4', 'light-blue': '#03a9f4', blue: '#2196f3',
  indigo: '#3f51b5', purple: '#9c27b0', pink: '#e91e63', brown: '#8d5524', grey: '#64748b', black: '#334155',
};
export const COLOR_NAMES = Object.keys(COLORS);
export const COLOR_LABELS_DE = {
  '': 'Automatisch',
  red: 'Rot',
  orange: 'Orange',
  amber: 'Gelb / Bernstein',
  yellow: 'Hellgelb',
  lime: 'Hellgrün / Limette',
  green: 'Grün',
  teal: 'Türkis',
  cyan: 'Cyan',
  'light-blue': 'Hellblau',
  blue: 'Blau (Papier)',
  indigo: 'Indigo',
  purple: 'Lila',
  pink: 'Pink',
  brown: 'Braun (Bio)',
  grey: 'Grau (Restmüll)',
  black: 'Schwarz / Anthrazit',
};
export const resolveColor = (c) => (c && (COLORS[c] || c)) || '';

export const DOMAIN_COLORS = {
  cover: '#9c27b0', // Lila (Home Assistant / Mushroom standard)
  jalousie: '#9c27b0',
  light: '#ffc107', // Amber
  leuchte: '#ffc107',
  switch: '#2196f3', // Blau
  schalter: '#2196f3',
  steckdose: '#009688', // Türkis
  outlet: '#009688',
  climate: '#ff9800', // Orange (heat)
  klima: '#ff9800',
  media_player: '#03a9f4', // Hellblau
  fernseher: '#03a9f4',
  medien: '#03a9f4',
  fan: '#00bcd4', // Cyan
  luefter: '#00bcd4',
  valve: '#00bcd4',
  wasserventil: '#00bcd4', // Cyan
  pumpe: '#03a9f4', // Hellblau / Wasser
  bewegungsmelder: '#e91e63', // Pink
  rauchmelder: '#ef4444', // Signalrot
  bodenmessgeraet: '#4caf50', // Grün
  raummessgeraet: '#ff5722', // Deep Orange
  lock: '#4caf50',
  sensor: '#2196f3',
};

export function effectiveCategory(t) {
  if (!t) return '';
  const cat = t.category || t.spec?.category;
  if (cat === 'rauchmelder' || cat === 'smoke') return 'rauchmelder';
  if (cat === 'leuchte' || cat === 'light') return 'light';
  if (cat === 'jalousie' || cat === 'cover') return 'cover';
  if (cat === 'steckdose' || cat === 'outlet') return 'outlet';
  if (cat === 'fernseher' || cat === 'medien' || cat === 'media_player') return 'media_player';
  if (cat === 'klima' || cat === 'climate') return 'climate';
  if (cat === 'wasserventil' || cat === 'valve') return 'valve';
  if (cat === 'pumpe') return 'pumpe';
  if (cat === 'bewegungsmelder') return 'motion';
  if (cat === 'bodenmessgeraet' || cat === 'raummessgeraet') return 'sensor';
  if (cat === 'schalter' || cat === 'switch') return 'switch';
  const d = domainOf(t.entity_id || t.entityId);
  if (d === 'light') return 'light';
  if (d === 'cover') return 'cover';
  if (d === 'switch') return 'switch';
  if (d === 'media_player') return 'media_player';
  if (d === 'climate') return 'climate';
  if (d === 'valve') return 'valve';
  if (d === 'binary_sensor') return 'motion';
  if (d === 'sensor') return 'sensor';
  return d;
}

export function getEntityColor(entityId, st, category, specColor) {
  const cat = category || '';
  if (cat === 'jalousie' || cat === 'cover') return DOMAIN_COLORS.cover;
  if (cat === 'leuchte' || cat === 'light') {
    if (Array.isArray(st?.attributes?.rgb_color)) return `rgb(${st.attributes.rgb_color.join(',')})`;
    return DOMAIN_COLORS.light;
  }
  if (cat === 'steckdose' || cat === 'outlet') return DOMAIN_COLORS.steckdose;
  if (cat === 'fernseher' || cat === 'medien' || cat === 'media_player') return DOMAIN_COLORS.media_player;
  if (cat === 'klima' || cat === 'climate') {
    return st?.attributes?.hvac_action === 'cooling' ? '#00bcd4' : '#ff9800';
  }
  if (cat === 'wasserventil' || cat === 'valve') return DOMAIN_COLORS.wasserventil;
  if (cat === 'pumpe') return DOMAIN_COLORS.pumpe;
  if (cat === 'bewegungsmelder') return DOMAIN_COLORS.bewegungsmelder;
  if (cat === 'rauchmelder' || st?.attributes?.device_class === 'smoke') {
    return ['on', 'detected', 'smoke'].includes(st?.state) ? '#ef4444' : '#22c55e';
  }
  if (cat === 'bodenmessgeraet') return DOMAIN_COLORS.bodenmessgeraet;
  if (cat === 'raummessgeraet') return DOMAIN_COLORS.raummessgeraet;
  if (cat === 'schalter' || cat === 'switch') return DOMAIN_COLORS.switch;
  if (specColor) return resolveColor(specColor) || specColor;
  const domain = domainOf(entityId);
  const dc = st?.attributes?.device_class;
  if (domain === 'cover') return DOMAIN_COLORS.cover;
  if (domain === 'light') {
    if (Array.isArray(st?.attributes?.rgb_color)) return `rgb(${st.attributes.rgb_color.join(',')})`;
    return DOMAIN_COLORS.light;
  }
  if (domain === 'switch') {
    if (dc === 'outlet') return DOMAIN_COLORS.steckdose;
    return DOMAIN_COLORS.switch;
  }
  if (domain === 'climate') {
    return st?.attributes?.hvac_action === 'cooling' ? '#00bcd4' : '#ff9800';
  }
  if (domain === 'media_player') return DOMAIN_COLORS.media_player;
  if (domain === 'fan') return DOMAIN_COLORS.fan;
  if (domain === 'valve') return DOMAIN_COLORS.valve;
  return DOMAIN_COLORS[domain] || '#2196f3';
}

/**
 * Generates a crisp, detailed 3D wheelie bin (Mülltonne) vector SVG.
 * Ensures consistent, high-fidelity rendering on any screen without broken images.
 */
export function renderTrashBin(color = '#ffc107', size = 44) {
  const hex = resolveColor(color) || color || '#ffc107';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.display = 'block';
  svg.style.flexShrink = '0';
  svg.innerHTML = `
    <ellipse cx="28" cy="53" rx="18" ry="2.5" fill="rgba(0,0,0,0.35)"/>
    <!-- Wheels -->
    <circle cx="15" cy="48" r="5" fill="#1e293b"/>
    <circle cx="15" cy="48" r="2.2" fill="#94a3b8"/>
    <circle cx="41" cy="48" r="5" fill="#1e293b"/>
    <circle cx="41" cy="48" r="2.2" fill="#94a3b8"/>
    <!-- Body -->
    <path d="M15 16 L41 16 L38 49 C38 50.8 36.5 52 34.5 52 L21.5 52 C19.5 52 18 50.8 18 49 Z" fill="${hex}"/>
    <!-- Body 3D shading -->
    <path d="M15 16 L28 16 L28 52 L21.5 52 C19.5 52 18 50.8 18 49 Z" fill="rgba(255,255,255,0.14)"/>
    <path d="M28 16 L41 16 L38 49 C38 50.8 36.5 52 34.5 52 L28 52 Z" fill="rgba(0,0,0,0.18)"/>
    <!-- Body Ribs -->
    <rect x="22" y="22" width="2.4" height="23" rx="1.2" fill="rgba(0,0,0,0.2)"/>
    <rect x="22" y="22" width="1.2" height="23" rx="0.6" fill="rgba(255,255,255,0.15)"/>
    <rect x="26.8" y="22" width="2.4" height="23" rx="1.2" fill="rgba(0,0,0,0.2)"/>
    <rect x="26.8" y="22" width="1.2" height="23" rx="0.6" fill="rgba(255,255,255,0.15)"/>
    <rect x="31.6" y="22" width="2.4" height="23" rx="1.2" fill="rgba(0,0,0,0.2)"/>
    <rect x="31.6" y="22" width="1.2" height="23" rx="0.6" fill="rgba(255,255,255,0.15)"/>
    <!-- Lid Handle -->
    <rect x="21" y="5.5" width="14" height="3" rx="1.5" fill="${hex}"/>
    <rect x="21" y="5.5" width="14" height="1.5" rx="0.75" fill="rgba(255,255,255,0.2)"/>
    <!-- Lid Body -->
    <path d="M12 11 C12 9.5 13.5 8.5 15 8.5 L41 8.5 C42.5 8.5 44 9.5 44 11 L42.5 16 L13.5 16 Z" fill="${hex}"/>
    <path d="M12 11 C12 9.5 13.5 8.5 15 8.5 L28 8.5 L28 16 L13.5 16 Z" fill="rgba(255,255,255,0.15)"/>
    <path d="M28 8.5 L41 8.5 C42.5 8.5 44 9.5 44 11 L42.5 16 L28 16 Z" fill="rgba(0,0,0,0.15)"/>
    <!-- Lid Rim -->
    <rect x="11" y="14" width="34" height="3" rx="1.5" fill="${hex}"/>
    <rect x="11" y="14" width="34" height="1.2" rx="0.6" fill="rgba(255,255,255,0.25)"/>
    <rect x="11" y="15.8" width="34" height="1.2" rx="0.6" fill="rgba(0,0,0,0.2)"/>
  `;
  return svg;
}

export const POPULAR_ICONS = [
  { icon: 'mdi:lightbulb', name: 'Lampe', cat: 'Licht' },
  { icon: 'mdi:ceiling-light', name: 'Decke', cat: 'Licht' },
  { icon: 'mdi:floor-lamp', name: 'Stehlampe', cat: 'Licht' },
  { icon: 'mdi:lamp', name: 'Tischlampe', cat: 'Licht' },
  { icon: 'mdi:led-strip', name: 'LED-Streifen', cat: 'Licht' },
  { icon: 'mdi:power-socket-eu', name: 'Steckdose', cat: 'Schalter' },
  { icon: 'mdi:power-plug', name: 'Stecker', cat: 'Schalter' },
  { icon: 'mdi:toggle-switch', name: 'Schalter', cat: 'Schalter' },
  { icon: 'mdi:router-wireless', name: 'WLAN', cat: 'Geräte' },
  { icon: 'mdi:desktop-tower', name: 'PC', cat: 'Geräte' },
  { icon: 'mdi:printer', name: 'Drucker', cat: 'Geräte' },
  { icon: 'mdi:television', name: 'TV', cat: 'Medien' },
  { icon: 'mdi:speaker', name: 'Audio', cat: 'Medien' },
  { icon: 'mdi:window-shutter', name: 'Jalousie', cat: 'Jalousie' },
  { icon: 'mdi:window-shutter-open', name: 'Jalousie Auf', cat: 'Jalousie' },
  { icon: 'mdi:blinds', name: 'Rollo', cat: 'Jalousie' },
  { icon: 'mdi:garage', name: 'Garage', cat: 'Jalousie' },
  { icon: 'mdi:thermometer', name: 'Temperatur', cat: 'Klima' },
  { icon: 'mdi:thermostat', name: 'Klima', cat: 'Klima' },
  { icon: 'mdi:fan', name: 'Lüfter', cat: 'Klima' },
  { icon: 'mdi:air-conditioner', name: 'Klimaanlage', cat: 'Klima' },
  { icon: 'mdi:motion-sensor', name: 'Bewegung', cat: 'Sensoren' },
  { icon: 'mdi:smoke-detector', name: 'Rauchmelder', cat: 'Sensoren' },
  { icon: 'mdi:water-alert', name: 'Wasser', cat: 'Sensoren' },
  { icon: 'mdi:water-percent', name: 'Feuchte', cat: 'Sensoren' },
  { icon: 'mdi:solar-power-variant', name: 'Solar', cat: 'Energie' },
  { icon: 'mdi:home-lightning-bolt-outline', name: 'Strom', cat: 'Energie' },
  { icon: 'mdi:flash', name: 'Leistung', cat: 'Energie' },
  { icon: 'mdi:door', name: 'Tür', cat: 'Sicherheit' },
  { icon: 'mdi:door-closed', name: 'Tür Zu', cat: 'Sicherheit' },
  { icon: 'mdi:window-closed', name: 'Fenster Zu', cat: 'Sicherheit' },
  { icon: 'mdi:window-open', name: 'Fenster Auf', cat: 'Sicherheit' },
  { icon: 'mdi:lock', name: 'Schloss', cat: 'Sicherheit' },
  { icon: 'mdi:shield-home', name: 'Sicherheit', cat: 'Sicherheit' },
  { icon: 'mdi:sofa', name: 'Wohnzimmer', cat: 'Räume' },
  { icon: 'mdi:bed', name: 'Schlafzimmer', cat: 'Räume' },
  { icon: 'mdi:flower', name: 'Garten', cat: 'Räume' },
  { icon: 'mdi:pump', name: 'Pumpe', cat: 'Räume' },
  { icon: 'mdi:home', name: 'Haus', cat: 'Räume' },
  { icon: 'mdi:trash-can-outline', name: 'Mülltonne', cat: 'Info' },
  { icon: 'mdi:recycle-variant', name: 'Wertstoff', cat: 'Info' },
  { icon: 'mdi:newspaper', name: 'Papier', cat: 'Info' },
  { icon: 'mdi:cart', name: 'Einkauf', cat: 'Info' },
  { icon: 'mdi:bullhorn', name: 'Ankündigung', cat: 'Info' },
  { icon: 'mdi:cloud-off', name: 'Offline', cat: 'Info' },
  { icon: 'mdi:weather-partly-cloudy', name: 'Wetter', cat: 'Info' }
];

// ── State helpers ──
const ACTIVE_STATES = new Set([
  'on', 'open', 'opening', 'closing', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only',
  'home', 'unlocked', 'active', 'buffering',
]);
export const isUnavailable = (st) => !st || st.state === 'unavailable' || st.state === 'unknown';
export const isActive = (st) => !!st && ACTIVE_STATES.has(st.state);

const STATE_DE = {
  on: 'An', off: 'Aus', open: 'Offen', closed: 'Geschlossen', opening: 'Öffnet', closing: 'Schließt',
  unavailable: 'Nicht verfügbar', unknown: 'Unbekannt', playing: 'Wiedergabe', paused: 'Pausiert',
  idle: 'Inaktiv', standby: 'Standby', buffering: 'Lädt', heat: 'Heizen', cool: 'Kühlen', auto: 'Automatisch',
  heat_cool: 'Heizen/Kühlen', dry: 'Entfeuchten', fan_only: 'Lüfter', home: 'Zuhause', not_home: 'Unterwegs',
  locked: 'Verriegelt', unlocked: 'Entriegelt', heating: 'Heizt', cooling: 'Kühlt',
};

export function stateLabel(hass, st, category) {
  if (!st) return '';
  if (category === 'wasserventil') {
    return (st.state === 'on' || st.state === 'open') ? 'Geöffnet' : 'Geschlossen';
  }
  if (category === 'pumpe') {
    return (st.state === 'on') ? 'Läuft' : 'Aus';
  }
  if (category === 'bewegungsmelder') {
    return (st.state === 'on') ? 'Bewegung' : 'Keine Bewegung';
  }
  if (category === 'rauchmelder' || st.attributes?.device_class === 'smoke') {
    return ['on', 'detected', 'smoke'].includes(st.state) ? 'RAUCH ERKANNT!' : 'OK · Kein Rauch';
  }
  try {
    if (typeof hass.formatEntityState === 'function') return hass.formatEntityState(st);
  } catch (_) { /* fall through */ }
  const unit = st.attributes?.unit_of_measurement;
  if (unit && !Number.isNaN(Number(st.state))) return `${st.state} ${unit}`;
  return STATE_DE[st.state] || st.state;
}

export function numeric(st) {
  if (!st) return null;
  const n = Number(st.state);
  return Number.isFinite(n) ? n : null;
}

export const formatState = (st, hass = null) => stateLabel(hass || {}, st);

export function areaIdForEntity(hass, entityId) {
  if (!hass || !entityId) return '';
  const ent = hass.entities?.[entityId];
  if (!ent) return '';
  if (ent.area_id) return ent.area_id;
  if (ent.device_id && hass.devices?.[ent.device_id]?.area_id) {
    return hass.devices[ent.device_id].area_id;
  }
  return '';
}

const DEVICE_CLASS_ICON = {
  temperature: 'mdi:thermometer', humidity: 'mdi:water-percent', power: 'mdi:flash', energy: 'mdi:lightning-bolt',
  battery: 'mdi:battery', illuminance: 'mdi:brightness-5', motion: 'mdi:motion-sensor', moisture: 'mdi:water-alert',
  smoke: 'mdi:smoke-detector', door: 'mdi:door', window: 'mdi:window-open', pressure: 'mdi:gauge',
  voltage: 'mdi:sine-wave', current: 'mdi:current-ac', carbon_dioxide: 'mdi:molecule-co2', timestamp: 'mdi:clock-outline',
};

const COVER_ICON = {
  shutter: ['mdi:window-shutter', 'mdi:window-shutter-open'], blind: ['mdi:blinds', 'mdi:blinds-open'],
  garage: ['mdi:garage', 'mdi:garage-open'], door: ['mdi:door-closed', 'mdi:door-open'],
  window: ['mdi:window-closed', 'mdi:window-open'], curtain: ['mdi:curtains-closed', 'mdi:curtains'],
  awning: ['mdi:awning-outline', 'mdi:awning-outline'],
};

/** Best-effort icon for an entity (custom icon > category > entity icon > domain default). */
export function entityIcon(entityId, st, custom, category) {
  if (custom) return custom;
  const on = isActive(st);
  const dc = st?.attributes?.device_class;
  if (category === 'leuchte') return on ? 'mdi:lightbulb' : 'mdi:lightbulb-outline';
  if (category === 'steckdose') return 'mdi:power-socket-eu';
  if (category === 'jalousie') {
    const pair = COVER_ICON[dc] || COVER_ICON.shutter;
    return st?.state === 'closed' ? pair[0] : pair[1];
  }
  if (category === 'fernseher' || category === 'medien') return 'mdi:television';
  if (category === 'schalter') return on ? 'mdi:power-plug' : 'mdi:power-plug-off';
  if (category === 'klima') return 'mdi:thermostat';
  if (category === 'pumpe') return 'mdi:pump';
  if (category === 'wasserventil') return on ? 'mdi:valve-open' : 'mdi:valve-closed';
  if (category === 'bewegungsmelder') return 'mdi:motion-sensor';
  if (category === 'rauchmelder' || dc === 'smoke') {
    return ['on', 'detected', 'smoke'].includes(st?.state) ? 'mdi:smoke-detector-alert' : 'mdi:smoke-detector';
  }
  if (category === 'bodenmessgeraet') return 'mdi:sprout';
  if (category === 'raummessgeraet') return 'mdi:thermometer-lines';

  if (st?.attributes?.icon) return st.attributes.icon;
  const domain = domainOf(entityId);
  switch (domain) {
    case 'light': return on ? 'mdi:lightbulb' : 'mdi:lightbulb-outline';
    case 'switch': return dc === 'outlet' ? (on ? 'mdi:power-plug' : 'mdi:power-plug-off') : (on ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off');
    case 'input_boolean': return on ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off';
    case 'cover': {
      const pair = COVER_ICON[dc] || COVER_ICON.shutter;
      return st?.state === 'closed' ? pair[0] : pair[1];
    }
    case 'climate': return 'mdi:thermostat';
    case 'media_player': return dc === 'tv' ? 'mdi:television' : dc === 'speaker' ? 'mdi:speaker' : 'mdi:cast';
    case 'fan': return 'mdi:fan';
    case 'valve': return on ? 'mdi:valve-open' : 'mdi:valve-closed';
    case 'script': return 'mdi:script-text-outline';
    case 'button': return 'mdi:gesture-tap-button';
    case 'lock': return on ? 'mdi:lock-open' : 'mdi:lock';
    case 'person': case 'device_tracker': return 'mdi:account';
    case 'weather': return 'mdi:weather-partly-cloudy';
    case 'binary_sensor': return DEVICE_CLASS_ICON[dc] || (on ? 'mdi:checkbox-marked-circle' : 'mdi:radiobox-blank');
    case 'sensor': return DEVICE_CLASS_ICON[dc] || 'mdi:eye';
    default: return 'mdi:bookmark';
  }
}

// ── Interaction ──
export function moreInfo(el, entityId) {
  el.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
}

export function navigate(path) {
  if (!path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}

/** Toggle an entity the way the HA tile card does. */
export function toggleEntity(hass, entityId) {
  const domain = domainOf(entityId);
  const st = hass.states[entityId];
  switch (domain) {
    case 'light': case 'switch': case 'input_boolean': case 'fan': case 'automation':
      return hass.callService(domain, 'toggle', { entity_id: entityId });
    case 'cover':
      return hass.callService('cover', 'toggle', { entity_id: entityId });
    case 'valve':
      return hass.callService('valve', 'toggle', { entity_id: entityId });
    case 'script': return hass.callService('script', 'turn_on', { entity_id: entityId });
    case 'button': return hass.callService('button', 'press', { entity_id: entityId });
    case 'lock':
      return hass.callService('lock', st?.state === 'locked' ? 'unlock' : 'lock', { entity_id: entityId });
    case 'media_player': return hass.callService('media_player', 'media_play_pause', { entity_id: entityId });
    case 'climate':
      return hass.callService('climate', st?.state === 'off' ? 'turn_on' : 'turn_off', { entity_id: entityId });
    default: return undefined;
  }
}

export const isToggleable = (entityId) =>
  ['light', 'switch', 'input_boolean', 'fan', 'automation', 'cover', 'valve', 'script', 'button', 'lock', 'media_player', 'climate']
    .includes(domainOf(entityId));

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Sets a range slider's value and computes the exact CSS `--val` gradient stop
 * aligned to the geometric center of the 6px thumb inside a 5px-padded track.
 */
export function setSliderVal(slider, val) {
  if (!slider) return;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const num = Number(val);
  const v = Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : min;
  slider.value = String(v);
  if (min === 0 && v <= 0) {
    slider.style.setProperty('--val', '0%');
    return;
  }
  const p = max > min ? (v - min) / (max - min) : 0;
  if (p >= 1) {
    slider.style.setProperty('--val', '100%');
    return;
  }
  const pct = (p * 100).toFixed(2);
  const offsetPx = ((0.5 - p) * 16).toFixed(2);
  slider.style.setProperty('--val', `calc(${pct}% + ${offsetPx}px)`);
}

export const ROOM_ICON_OPTIONS = [
  { value: 'mdi:home-outline', label: 'Standard (Haus)', icon: 'mdi:home-outline' },
  { value: 'mdi:sofa', label: 'Wohnzimmer', icon: 'mdi:sofa' },
  { value: 'mdi:bed', label: 'Schlafzimmer', icon: 'mdi:bed' },
  { value: 'mdi:silverware-fork-knife', label: 'Küche', icon: 'mdi:silverware-fork-knife' },
  { value: 'mdi:table-furniture', label: 'Esszimmer', icon: 'mdi:table-furniture' },
  { value: 'mdi:shower', label: 'Badezimmer', icon: 'mdi:shower' },
  { value: 'mdi:toilet', label: 'Gäste-WC', icon: 'mdi:toilet' },
  { value: 'mdi:desk', label: 'Büro / Arbeitszimmer', icon: 'mdi:desk' },
  { value: 'mdi:door-open', label: 'Flur / Diele', icon: 'mdi:door-open' },
  { value: 'mdi:teddy-bear', label: 'Kinderzimmer', icon: 'mdi:teddy-bear' },
  { value: 'mdi:washing-machine', label: 'Hauswirtschaftsraum', icon: 'mdi:washing-machine' },
  { value: 'mdi:stairs-down', label: 'Keller', icon: 'mdi:stairs-down' },
  { value: 'mdi:home-roof', label: 'Dachboden', icon: 'mdi:home-roof' },
  { value: 'mdi:balcony', label: 'Balkon / Terrasse', icon: 'mdi:balcony' },
  { value: 'mdi:flower', label: 'Garten', icon: 'mdi:flower' },
  { value: 'mdi:garage', label: 'Garage', icon: 'mdi:garage' },
  { value: 'mdi:car', label: 'Carport / Einfahrt', icon: 'mdi:car' },
  { value: 'mdi:server', label: 'Technikraum', icon: 'mdi:server' },
  { value: 'mdi:television', label: 'Heimkino', icon: 'mdi:television' },
  { value: 'mdi:dumbbell', label: 'Fitnessraum', icon: 'mdi:dumbbell' },
];

export const ROOM_SENSOR_TYPES = [
  { value: 'temperature', label: 'Temperatur', icon: 'mdi:thermometer', color: '#ff7043' },
  { value: 'humidity', label: 'Luftfeuchtigkeit', icon: 'mdi:water-percent', color: '#29b6f6' },
  { value: 'motion', label: 'Anwesenheit', icon: 'mdi:motion-sensor', color: '#e91e63' },
  { value: 'moisture', label: 'Feuchtigkeit', icon: 'mdi:water-alert', color: '#26c6da' },
  { value: 'ignore', label: 'Ignorieren', icon: 'mdi:eye-off-outline', color: '#9e9e9e' },
];

/**
 * Parse a dashboard spec/channel key cleanly:
 * - "d:<deviceId>:<entityId>" -> { prefix: 'd', deviceId, entityId, groupId: '' }
 * - "e:<entityId>" / "l:<entityId>" -> { prefix, deviceId: '', entityId, groupId: '' }
 * - "g:<groupId>" -> { prefix: 'g', deviceId: '', entityId: '', groupId }
 * - "<deviceId>:<entityId>" -> { prefix: '', deviceId, entityId, groupId: '' }
 * - "<entityId>" -> { prefix: '', deviceId: '', entityId: key, groupId: '' }
 */
export function parseChannelKey(key) {
  if (!key || typeof key !== 'string') {
    return { prefix: '', deviceId: '', entityId: '', groupId: '' };
  }
  const parts = key.split(':');
  const first = parts[0];
  if (first === 'd') {
    return { prefix: 'd', deviceId: parts[1] || '', entityId: parts.slice(2).join(':'), groupId: '' };
  }
  if (first === 'e' || first === 'l') {
    return { prefix: first, deviceId: '', entityId: parts.slice(1).join(':'), groupId: '' };
  }
  if (first === 'g') {
    return { prefix: 'g', deviceId: '', entityId: '', groupId: parts.slice(1).join(':') };
  }
  if (parts.length >= 2) {
    return { prefix: '', deviceId: first, entityId: parts.slice(1).join(':'), groupId: '' };
  }
  return { prefix: '', deviceId: '', entityId: key, groupId: '' };
}

/** Preserve scroll position of a scroll container across synchronous DOM replacements. */
export function preserveScroll(scrollEl, fn) {
  const top = scrollEl ? scrollEl.scrollTop : 0;
  fn?.();
  if (scrollEl && top > 0) {
    scrollEl.scrollTop = top;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (scrollEl.isConnected) scrollEl.scrollTop = top;
      });
    }
  }
}

/**
 * Portal and position a floating menu inside the nearest `.overlay` or shadowRoot
 * using `visualViewport` bounds and auto flip-above when space below is tight.
 * Returns a cleanup callback to restore `menuEl` and detach listeners.
 */
export function positionFloatingMenu(anchorEl, menuEl, opts = {}) {
  if (!anchorEl || !menuEl) return () => {};
  const {
    minWidth = 0,
    maxWidth = null,
    maxHeight = 280,
    matchWidth = true,
    alignRight = false,
  } = opts;

  const originalParent = menuEl.parentNode;
  const originalNextSibling = menuEl.nextSibling;
  const portalHost = anchorEl.closest?.('.overlay') || anchorEl.getRootNode?.() || originalParent;

  menuEl.classList.add('cd-portal-menu');
  if (portalHost && portalHost.appendChild && menuEl.parentNode !== portalHost) {
    portalHost.appendChild(menuEl);
  }

  let closed = false;
  const update = () => {
    if (closed) return;
    if (!anchorEl.isConnected || !menuEl.isConnected) return;

    const rect = anchorEl.getBoundingClientRect();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const layoutW = (typeof document !== 'undefined' && document.documentElement?.clientWidth)
      || (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const layoutH = (typeof document !== 'undefined' && document.documentElement?.clientHeight)
      || (typeof window !== 'undefined' ? window.innerHeight : 768);

    const visLeft = vv ? vv.offsetLeft : 0;
    const visTop = vv ? vv.offsetTop : 0;
    const visW = vv ? vv.width : layoutW;
    const visH = vv ? vv.height : layoutH;
    const visBottom = visTop + visH;

    const spaceBelow = Math.max(0, visBottom - rect.bottom - 10);
    const spaceAbove = Math.max(0, rect.top - visTop - 10);
    const openUp = spaceBelow < Math.min(200, maxHeight) && spaceAbove > spaceBelow;
    const availH = Math.max(120, Math.min(maxHeight, openUp ? spaceAbove : spaceBelow));

    const targetW = matchWidth
      ? Math.max(rect.width, minWidth || 0)
      : Math.max(minWidth || 200, rect.width);
    const clampedW = Math.max(160, Math.min(targetW, visW - 16, maxWidth || (visW - 16)));
    const desiredLeft = alignRight ? (rect.right - clampedW) : rect.left;
    const clampedLeft = Math.max(visLeft + 8, Math.min(desiredLeft, visLeft + visW - clampedW - 8));

    menuEl.style.position = 'fixed';
    menuEl.style.zIndex = '1500';
    menuEl.style.left = `${Math.round(clampedLeft)}px`;
    menuEl.style.right = 'auto';
    menuEl.style.width = `${Math.round(clampedW)}px`;
    menuEl.style.maxWidth = `${Math.round(visW - 16)}px`;
    menuEl.style.maxHeight = `${Math.round(availH)}px`;

    if (openUp) {
      menuEl.style.top = 'auto';
      menuEl.style.bottom = `${Math.max(8, Math.round(layoutH - rect.top + 6))}px`;
      menuEl.dataset.placement = 'top';
    } else {
      menuEl.style.bottom = 'auto';
      menuEl.style.top = `${Math.round(rect.bottom + 6)}px`;
      menuEl.dataset.placement = 'bottom';
    }
  };

  update();

  const onViewportChange = () => update();
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
    window.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });
  }

  return () => {
    if (closed) return;
    closed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', onViewportChange, { capture: true });
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
    }
    menuEl.classList.remove('cd-portal-menu');
    menuEl.style.position = '';
    menuEl.style.zIndex = '';
    menuEl.style.left = '';
    menuEl.style.right = '';
    menuEl.style.top = '';
    menuEl.style.bottom = '';
    menuEl.style.width = '';
    menuEl.style.maxWidth = '';
    menuEl.style.maxHeight = '';
    delete menuEl.dataset.placement;
    if (originalParent && originalParent.isConnected) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(menuEl, originalNextSibling);
      } else {
        originalParent.appendChild(menuEl);
      }
    } else if (menuEl.parentNode) {
      menuEl.remove();
    }
  };
}

/** Display a toast inside ShadowRoot above modal overlays and safe areas. */
export function showToast(anchorOrRoot, message, opts = {}) {
  const { error = false, duration = 2600 } = opts;
  const root = anchorOrRoot?.getRootNode?.() || anchorOrRoot;
  if (!root || !root.appendChild) return;
  try {
    root.querySelectorAll?.('.toast').forEach((n) => n.remove());
  } catch (_) { /* ignore */ }
  const el = h('div', {
    class: `toast${error ? ' error' : ''}`,
    role: error ? 'alert' : 'status',
  }, String(message || ''));
  root.appendChild(el);
  if (typeof setTimeout === 'function') {
    setTimeout(() => { if (el.isConnected) el.remove(); }, duration);
  }
  return el;
}

/**
 * In-DOM ShadowRoot confirmation dialog replacing native window.confirm().
 * Resolves to true when confirmed, false when cancelled.
 */
export function showConfirmDialog(anchorOrRoot, opts = {}) {
  const {
    title = 'Bestätigen',
    message = '',
    confirmLabel = 'Bestätigen',
    cancelLabel = 'Abbrechen',
    danger = true,
  } = opts;
  const root = anchorOrRoot?.getRootNode?.() || anchorOrRoot;
  if (!root || !root.appendChild) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let overlayEl = null;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown, true);
      }
      overlayEl?.remove();
      resolve(val);
    };

    const confirmBtn = h('button', {
      type: 'button',
      class: `btn ${danger ? 'danger' : 'primary'}`,
      onClick: () => finish(true),
    }, confirmLabel);

    const cancelBtn = h('button', {
      type: 'button',
      class: 'btn secondary',
      onClick: () => finish(false),
    }, cancelLabel);

    const dialogEl = h('div', {
      class: 'dialog confirm-modal-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    h('div', { class: 'dialog-head' },
      icon(danger ? 'mdi:alert-outline' : 'mdi:help-circle-outline'),
      h('h2', {}, title),
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Schließen',
        onClick: () => finish(false),
      }, icon('mdi:close'))),
    message ? h('div', { class: 'dialog-body confirm-modal-body' },
      h('p', { class: 'confirm-modal-msg' }, message)) : null,
    h('div', { class: 'dialog-foot' },
      h('div', { class: 'dialog-foot-actions' }, cancelBtn, confirmBtn)));

    overlayEl = h('div', {
      class: 'overlay confirm-overlay',
      onClick: (e) => { if (e.target === overlayEl) finish(false); },
    }, dialogEl);

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKeyDown, true);
    }
    root.appendChild(overlayEl);
  });
}

// ── Internal Subview Registry & Hybrid Navigation ──
export const BUILTIN_VIEWS = [
  { id: 'overview', label: 'Übersicht', icon: 'mdi:view-dashboard', color: '#03a9f4', desc: 'Räume & Startseite' },
  { id: 'security', label: 'Sicherheit', icon: 'mdi:shield-home', color: '#ef4444', desc: 'Alarm, Rauchmelder, Kameras' },
  { id: 'solar', label: 'Solar', icon: 'mdi:solar-power-variant', color: '#f59e0b', desc: 'PV-Ertrag, Batterie, Prognose' },
  { id: 'blinds', label: 'Rollläden', icon: 'mdi:window-shutter-cog', color: '#9c27b0', desc: 'Steuerung, Verlauf, Sonne' },
  { id: 'auto', label: 'Auto', icon: 'mdi:car-connected', color: '#0ea5e9', desc: 'BMW & Fahrzeugstatus' },
  { id: 'printer3d', label: '3D-Druck', icon: 'mdi:printer-3d', color: '#10b981', desc: 'A1 Mini Status & Steuerung' },
  { id: 'more', label: 'Mehr', icon: 'mdi:apps', color: '#6366f1', desc: 'Alle Bereiche & Helfer' },
];

export const LEGACY_VIEW_ALIASES = {
  '/lovelace/overview': 'overview',
  '/lovelace/ubersicht': 'overview',
  '/lovelace/sicherheit': 'security',
  '/lovelace/solar': 'solar',
  '/lovelace/auto': 'auto',
  '/lovelace/jalousien': 'blinds',
  '/lovelace/3d-drucker': 'printer3d',
  '/lovelace/mehr': 'more',
  '/dashboard-warnungen/dash-warnungen': 'warning',
};

export function resolveInternalView(itemOrPath) {
  if (!itemOrPath) return null;
  if (typeof itemOrPath === 'object') {
    if (itemOrPath.view && BUILTIN_VIEWS.some((v) => v.id === itemOrPath.view)) return itemOrPath.view;
    return resolveInternalView(itemOrPath.path);
  }
  const raw = String(itemOrPath).trim();
  if (!raw) return null;
  if (BUILTIN_VIEWS.some((v) => v.id === raw)) return raw;
  if (raw.startsWith('companion:')) {
    const sub = raw.slice('companion:'.length);
    if (BUILTIN_VIEWS.some((v) => v.id === sub) || sub === 'warning') return sub;
  }
  const normalized = raw.split('?')[0].replace(/\/+$/, '') || '/';
  return LEGACY_VIEW_ALIASES[normalized] || null;
}

/**
 * Enables touch + mouse pointer drag-and-drop reordering on a list container.
 * Uses pointer capture exclusively on `handleSelector` so vertical scrolling stays smooth.
 */
export function enablePointerReorder(listEl, { itemSelector = '[data-reorder-item]', handleSelector = '.drag-handle', onMove }) {
  if (!listEl || typeof onMove !== 'function') return () => {};
  let active = null;

  const onPointerDown = (e) => {
    if (e.button && e.button !== 0) return;
    const handle = e.target.closest?.(handleSelector);
    if (!handle || !listEl.contains(handle)) return;
    const item = handle.closest?.(itemSelector);
    if (!item || item.parentElement !== listEl) return;

    e.preventDefault();
    e.stopPropagation();
    const items = [...listEl.children].filter((c) => c.matches?.(itemSelector));
    const startIdx = items.indexOf(item);
    if (startIdx < 0) return;

    const rects = items.map((el) => el.getBoundingClientRect());
    const scrollEl = listEl.closest?.('.dialog-body') || null;
    item.setAttribute('data-dragging', '');
    try { handle.setPointerCapture?.(e.pointerId); } catch {}

    active = {
      pointerId: e.pointerId,
      handle,
      item,
      items,
      rects,
      startIdx,
      currentIdx: startIdx,
      startY: e.clientY,
      lastY: e.clientY,
      scrollEl,
      raf: 0,
    };

    const tickScroll = () => {
      if (!active || !active.scrollEl) return;
      const box = active.scrollEl.getBoundingClientRect();
      const dyTop = active.lastY - box.top;
      const dyBot = box.bottom - active.lastY;
      if (dyTop < 48) active.scrollEl.scrollTop -= Math.max(4, Math.round((48 - dyTop) * 0.35));
      else if (dyBot < 48) active.scrollEl.scrollTop += Math.max(4, Math.round((48 - dyBot) * 0.35));
      active.raf = requestAnimationFrame(tickScroll);
    };
    if (scrollEl) active.raf = requestAnimationFrame(tickScroll);
  };

  const onPointerMove = (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    e.preventDefault();
    active.lastY = e.clientY;
    const dy = e.clientY - active.startY;
    active.item.style.transform = `translate3d(0, ${Math.round(dy)}px, 0)`;

    const itemRect = active.rects[active.startIdx];
    const center = itemRect.top + itemRect.height / 2 + dy;
    let targetIdx = active.startIdx;
    for (let i = 0; i < active.rects.length; i++) {
      const r = active.rects[i];
      if (center > r.top + r.height / 2) targetIdx = i;
    }
    if (dy < 0) {
      targetIdx = active.startIdx;
      for (let i = active.rects.length - 1; i >= 0; i--) {
        const r = active.rects[i];
        if (center < r.top + r.height / 2) targetIdx = i;
      }
    }
    active.currentIdx = targetIdx;
    active.items.forEach((el, idx) => {
      if (el === active.item) return;
      el.toggleAttribute('data-drop-before', idx === targetIdx && targetIdx < active.startIdx);
      el.toggleAttribute('data-drop-after', idx === targetIdx && targetIdx > active.startIdx);
    });
  };

  const cleanup = (commit) => {
    if (!active) return;
    if (active.raf) cancelAnimationFrame(active.raf);
    try { active.handle.releasePointerCapture?.(active.pointerId); } catch {}
    active.item.removeAttribute('data-dragging');
    active.item.style.transform = '';
    active.items.forEach((el) => {
      el.removeAttribute('data-drop-before');
      el.removeAttribute('data-drop-after');
    });
    const from = active.startIdx;
    const to = active.currentIdx;
    active = null;
    if (commit && from !== to) onMove(from, to);
  };

  const onPointerUp = (e) => { if (active && e.pointerId === active.pointerId) cleanup(true); };
  const onPointerCancel = (e) => { if (active && e.pointerId === active.pointerId) cleanup(false); };

  listEl.addEventListener('pointerdown', onPointerDown);
  listEl.addEventListener('pointermove', onPointerMove);
  listEl.addEventListener('pointerup', onPointerUp);
  listEl.addEventListener('pointercancel', onPointerCancel);
  return () => {
    cleanup(false);
    listEl.removeEventListener('pointerdown', onPointerDown);
    listEl.removeEventListener('pointermove', onPointerMove);
    listEl.removeEventListener('pointerup', onPointerUp);
    listEl.removeEventListener('pointercancel', onPointerCancel);
  };
}

/**
 * Pointer-based 2D grid drag-and-drop reordering for desktop & touch/mobile.
 * Cross-room & within-grid drag-and-drop reordering in Edit Mode.
 * Supports:
 * - Immediate drag from handle OR press-and-hold anywhere on a tile (~180ms mouse / ~220ms touch)
 * - Floating ghost attached outside container-query ancestors (ShadowRoot) so fixed coords stay exact
 * - Live FLIP reflow preview, including horizontal left/right 2-column compact pairing
 * - Cross-room dragging (auto-expanding collapsed target rooms on brief hover) & edge auto-scroll
 */
export function enableGridPointerReorder(gridEl, {
  itemSelector = '.tile',
  handleSelector = '.tile-drag-handle',
  roomSelector = '.room[data-area-id]',
  roomGridSelector = '.tile-grid',
  isEnabled,
  onDragStart,
  onPreview,
  onCancel,
  onReorder,
} = {}) {
  if (!gridEl || typeof onReorder !== 'function') return () => {};
  let active = null;
  let suppressClickUntil = 0;

  const getItems = (g = active?.currentGrid || gridEl) =>
    Array.from(g.children).filter((el) => el.matches(itemSelector));

  const findTopTile = (el, g = gridEl) => {
    let item = el?.closest?.(itemSelector);
    while (item && item.parentElement !== g) {
      item = item.parentElement?.closest(itemSelector) || null;
    }
    return item && item.parentElement === g ? item : null;
  };

  const getRootScope = () => {
    const root = gridEl.getRootNode?.();
    return root && typeof root.querySelectorAll === 'function' ? root : document;
  };

  const flipAnimate = (targetGrid, beforeRects, mutateFn) => {
    mutateFn();
    const afterItems = getItems(targetGrid);
    for (const el of afterItems) {
      if (active && el === active.item) continue;
      const oldRect = beforeRects.get(el);
      if (!oldRect) continue;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        el.style.transition = 'none';
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        el.getBoundingClientRect(); // force reflow
        el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        el.style.transform = '';
      }
    }
  };

  const computeDropTarget = (x, y, targetGrid, draggedItem) => {
    const items = getItems(targetGrid);
    const currentIdx = items.indexOf(draggedItem);
    if (!items.length) {
      return { currentIdx, toIdx: 0, intent: 'auto', partnerEl: null, noop: false };
    }

    const slotEl = currentIdx >= 0 ? items[currentIdx] : null;
    if (slotEl) {
      const sr = slotEl.getBoundingClientRect();
      if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom) {
        return { currentIdx, toIdx: currentIdx, intent: null, partnerEl: null, noop: true };
      }
    }

    // 1. Direct bounding-box hit on another tile
    let hitIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (i === currentIdx) continue;
      const r = items[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        hitIdx = i;
        break;
      }
    }

    // 2. Fallback: closest bounding box distance (tiebreak: center distance)
    if (hitIdx < 0) {
      let bestBoxDist = Infinity;
      let bestCenterDist = Infinity;
      for (let i = 0; i < items.length; i++) {
        if (i === currentIdx) continue;
        const r = items[i].getBoundingClientRect();
        const bx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
        const by = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
        const bd = bx * bx + by * by;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const cd = (x - cx) ** 2 + (y - cy) ** 2;
        if (bd < bestBoxDist - 0.5 || (Math.abs(bd - bestBoxDist) <= 0.5 && cd < bestCenterDist)) {
          bestBoxDist = bd;
          bestCenterDist = cd;
          hitIdx = i;
        }
      }
    }

    if (hitIdx < 0) {
      return { currentIdx, toIdx: Math.max(0, currentIdx), intent: null, partnerEl: null, noop: true };
    }

    const hitEl = items[hitIdx];
    const r = hitEl.getBoundingClientRect();
    const relX = (x - r.left) / Math.max(1, r.width);
    const relY = (y - r.top) / Math.max(1, r.height);
    const draggedHardWide = draggedItem.classList.contains('group') || draggedItem.classList.contains('grouped-cover');
    const hitHardWide = hitEl.classList.contains('group') || hitEl.classList.contains('grouped-cover');

    let placeAfter = false;
    let intent = 'auto';
    let partnerEl = null;

    const firstOtherIdx = currentIdx === 0 ? 1 : 0;
    const lastOtherIdx = currentIdx === items.length - 1 ? items.length - 2 : items.length - 1;

    if (hitIdx === firstOtherIdx && y < r.top - 4) {
      placeAfter = false;
      intent = 'wide';
    } else if (hitIdx === lastOtherIdx && y > r.bottom + 4) {
      placeAfter = true;
      intent = 'wide';
    } else if (draggedHardWide || hitHardWide) {
      placeAfter = relY >= 0.5;
      intent = 'wide';
    } else if (hitEl.classList.contains('wide')) {
      if (relY < 0.22) {
        placeAfter = false;
        intent = 'wide';
      } else if (relY > 0.78) {
        placeAfter = true;
        intent = 'wide';
      } else {
        placeAfter = relX >= 0.5;
        intent = 'compact';
        partnerEl = hitEl;
      }
    } else {
      // Hit tile is already compact (1-column): insert to its left or right cleanly
      placeAfter = relX >= 0.5;
      intent = 'compact';
      partnerEl = hitEl;
    }

    let toIdx;
    if (currentIdx >= 0) {
      toIdx = placeAfter
        ? (currentIdx < hitIdx ? hitIdx : hitIdx + 1)
        : (currentIdx < hitIdx ? hitIdx - 1 : hitIdx);
      toIdx = Math.max(0, Math.min(items.length - 1, toIdx));
    } else {
      toIdx = placeAfter ? hitIdx + 1 : hitIdx;
      toIdx = Math.max(0, Math.min(items.length, toIdx));
    }

    return { currentIdx, toIdx, intent, partnerEl, noop: false };
  };

  const createGhost = (item) => {
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('tile-drag-ghost');
    ghost.removeAttribute('data-dragging');
    ghost.classList.remove('tile-drag-slot');
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    const root = gridEl.getRootNode?.();
    const host = (root && root !== document) ? root : document.body;
    host.appendChild(ghost);
    // Compensate for any containing block offset on host/shadow-host so ghost sits at exact rect
    const gr = ghost.getBoundingClientRect();
    ghost.style.left = `${rect.left - gr.left}px`;
    ghost.style.top = `${rect.top - gr.top}px`;
    return ghost;
  };

  const clearRoomHighlight = () => {
    const scope = getRootScope();
    for (const el of scope.querySelectorAll(`${roomSelector}[data-drop-room]`)) {
      el.removeAttribute('data-drop-room');
    }
  };

  const stopAutoScroll = () => {
    if (active?.scrollInterval) {
      clearInterval(active.scrollInterval);
      active.scrollInterval = 0;
    }
  };

  const updateAutoScroll = (y) => {
    if (!active || !active.started) return;
    const edge = 76;
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    let delta = 0;
    if (y < edge) delta = -Math.max(4, Math.round(((edge - y) / edge) * 14));
    else if (y > vh - edge) delta = Math.max(4, Math.round(((y - (vh - edge)) / edge) * 14));
    active.scrollDelta = delta;
    if (delta !== 0 && !active.scrollInterval) {
      active.scrollInterval = setInterval(() => {
        if (!active || !active.started || !active.scrollDelta) return;
        window.scrollBy(0, active.scrollDelta);
      }, 16);
    } else if (delta === 0 && active.scrollInterval) {
      clearInterval(active.scrollInterval);
      active.scrollInterval = 0;
    }
  };

  const findRoomUnderPointer = (x, y) => {
    const scope = getRootScope();
    const rooms = Array.from(scope.querySelectorAll(roomSelector));
    for (const rm of rooms) {
      const rr = rm.getBoundingClientRect();
      if (rr.width > 0 && rr.height > 0 && x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) {
        return rm;
      }
    }
    return null;
  };

  const activateDrag = () => {
    if (!active || active.started) return;
    active.started = true;
    active.moved = true;
    if (active.holdTimer) { clearTimeout(active.holdTimer); active.holdTimer = 0; }
    try { active.captureTarget.setPointerCapture?.(active.pointerId); } catch {}
    onDragStart?.({ itemEl: active.item, sourceGrid: active.sourceGrid });
    active.ghost = createGhost(active.item);
    active.item.setAttribute('data-dragging', '');
    active.item.classList.add('tile-drag-slot');
    updateDrag();
  };

  const onPointerDown = (e) => {
    if (isEnabled && !isEnabled()) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest?.('.chevron-btn')) return;

    const handle = e.target.closest?.(handleSelector);
    const isHandle = !!(handle && gridEl.contains(handle));
    const item = findTopTile(isHandle ? handle : e.target);
    if (!item) return;

    // Don't hijack clicks on nested sub-tiles inside an expanded GroupTile
    if (!isHandle && e.target.closest?.('.sub-body .tile')) return;

    const items = getItems(gridEl);
    if (!items.length) return;
    const startIdx = items.indexOf(item);
    if (startIdx < 0) return;

    if (isHandle) {
      e.preventDefault();
      e.stopPropagation();
    }

    active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      isHandle,
      captureTarget: isHandle ? handle : item,
      item,
      ghost: null,
      sourceGrid: gridEl,
      currentGrid: gridEl,
      startIdx,
      currentIdx: startIdx,
      lastIntent: 'auto',
      lastPartnerEl: null,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      started: false,
      moved: false,
      holdTimer: 0,
      raf: 0,
      lastSwapAt: 0,
      scrollInterval: 0,
      scrollDelta: 0,
      pendingExpandRoom: null,
      expandTimer: 0,
    };

    if (isHandle) {
      activateDrag();
    } else {
      const holdMs = active.pointerType === 'mouse' ? 180 : 220;
      active.holdTimer = setTimeout(() => {
        activateDrag();
      }, holdMs);
    }
  };

  const updateDrag = (force = false) => {
    if (!active || !active.started) return;
    active.raf = 0;
    const dx = active.lastX - active.startX;
    const dy = active.lastY - active.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) active.moved = true;
    if (active.ghost) {
      active.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.02)`;
    }
    updateAutoScroll(active.lastY);

    const now = Date.now();
    const hoverRoom = findRoomUnderPointer(active.lastX, active.lastY);

    // Highlight destination room if dragging outside source room
    clearRoomHighlight();
    const srcRoomEl = active.sourceGrid.closest(roomSelector);
    if (hoverRoom && hoverRoom !== srcRoomEl) {
      hoverRoom.setAttribute('data-drop-room', '');
    }

    // Auto-expand collapsed room after brief hover (~180ms), or immediately on forced drop
    if (hoverRoom && !hoverRoom.hasAttribute('data-open')) {
      if (force) {
        if (active.expandTimer) { clearTimeout(active.expandTimer); active.expandTimer = 0; }
        active.pendingExpandRoom = null;
        hoverRoom.__roomInstance?.setOpen?.(true);
      } else {
        if (active.pendingExpandRoom !== hoverRoom) {
          if (active.expandTimer) clearTimeout(active.expandTimer);
          active.pendingExpandRoom = hoverRoom;
          active.expandTimer = setTimeout(() => {
            if (!active || !active.started) return;
            hoverRoom.__roomInstance?.setOpen?.(true);
            active.pendingExpandRoom = null;
            active.expandTimer = 0;
            active.lastSwapAt = 0;
            updateDrag(true);
          }, 180);
        }
        return;
      }
    }
    if (active.expandTimer) {
      clearTimeout(active.expandTimer);
      active.expandTimer = 0;
    }
    active.pendingExpandRoom = null;

    if (!force && now - active.lastSwapAt < 85) return;

    let targetGrid = active.currentGrid;
    if (hoverRoom) {
      const candidateGrid = hoverRoom.querySelector(roomGridSelector);
      if (candidateGrid) targetGrid = candidateGrid;
    }

    const fromGrid = active.currentGrid;
    const isCrossRoom = targetGrid !== fromGrid;
    const targetDrop = computeDropTarget(active.lastX, active.lastY, targetGrid, active.item);
    if (!isCrossRoom && targetDrop.noop) return;

    const intentKey = `${targetGrid.dataset.areaId || ''}|${targetDrop.toIdx}|${targetDrop.intent}|${targetDrop.partnerEl?.dataset?.key || ''}`;
    const changed = isCrossRoom
      || targetDrop.toIdx !== targetDrop.currentIdx
      || (targetDrop.intent && targetDrop.intent !== 'auto' && intentKey !== active.lastPreviewKey);

    if (!changed) return;

    active.lastSwapAt = now;
    active.lastPreviewKey = intentKey;

    const beforeRects = new Map();
    for (const el of getItems(targetGrid)) {
      beforeRects.set(el, el.getBoundingClientRect());
    }

    flipAnimate(targetGrid, beforeRects, () => {
      if (typeof onPreview === 'function') {
        onPreview({
          itemEl: active.item,
          fromGrid,
          targetGrid,
          toIdx: targetDrop.toIdx,
          intent: targetDrop.intent || 'auto',
          partnerEl: targetDrop.partnerEl,
        });
      } else {
        const curItems = getItems(targetGrid);
        const ref = curItems[Math.min(targetDrop.toIdx, curItems.length - 1)];
        if (!ref) targetGrid.appendChild(active.item);
        else if (!isCrossRoom && targetDrop.currentIdx < targetDrop.toIdx) ref.after(active.item);
        else ref.before(active.item);
      }
    });

    active.currentGrid = targetGrid;
    active.currentIdx = getItems(targetGrid).indexOf(active.item);
    if (targetDrop.intent) active.lastIntent = targetDrop.intent;
    active.lastPartnerEl = targetDrop.partnerEl;
  };

  const onPointerMove = (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    active.lastX = e.clientX;
    active.lastY = e.clientY;
    const dx = active.lastX - active.startX;
    const dy = active.lastY - active.startY;
    const dist = Math.hypot(dx, dy);

    if (!active.started) {
      if (active.pointerType === 'mouse') {
        if (dist > 6) activateDrag();
      } else if (dist > 8) {
        cleanup(false);
        return;
      }
      if (!active.started) return;
    }

    e.preventDefault();
    if (!active.raf) {
      updateDrag(false);
      active.raf = requestAnimationFrame(() => updateDrag(false));
    }
  };

  const onTouchMove = (e) => {
    if (active && active.started) {
      e.preventDefault();
    }
  };

  const cleanup = (commit) => {
    if (!active) return;
    if (active.holdTimer) clearTimeout(active.holdTimer);
    if (active.expandTimer) clearTimeout(active.expandTimer);
    if (active.raf) cancelAnimationFrame(active.raf);
    if (commit && active.started) {
      updateDrag(true);
    }
    stopAutoScroll();
    clearRoomHighlight();
    const wasStarted = active.started;
    const moved = active.moved;
    const itemEl = active.item;
    const sourceGrid = active.sourceGrid;
    const targetGrid = active.currentGrid;
    const from = active.startIdx;
    const to = active.currentIdx;
    const intent = active.lastIntent;
    const partnerEl = active.lastPartnerEl;
    if (wasStarted) {
      try { active.captureTarget.releasePointerCapture?.(active.pointerId); } catch {}
      active.item.removeAttribute('data-dragging');
      active.item.classList.remove('tile-drag-slot');
      active.ghost?.remove();
      const scope = getRootScope();
      scope.querySelectorAll(itemSelector).forEach((el) => {
        el.removeAttribute('data-drop-target');
        el.style.transition = '';
        el.style.transform = '';
      });
    }
    if (wasStarted || moved) suppressClickUntil = Date.now() + 300;
    active = null;
    if (wasStarted) {
      if (!commit) {
        onCancel?.({ itemEl, sourceGrid, currentGrid: targetGrid, startIdx: from });
      } else if (sourceGrid !== targetGrid || from !== to || moved) {
        onReorder({ itemEl, sourceGrid, targetGrid, fromIdx: from, toIdx: to, intent, partnerEl });
      }
    }
  };

  const onPointerUp = (e) => {
    if (active && e.pointerId === active.pointerId) {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        active.lastX = e.clientX;
        active.lastY = e.clientY;
      }
      cleanup(true);
    }
  };
  const onPointerCancel = (e) => { if (active && e.pointerId === active.pointerId) cleanup(false); };
  const onSuppressClick = (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  gridEl.addEventListener('pointerdown', onPointerDown);
  gridEl.addEventListener('touchmove', onTouchMove, { passive: false });
  gridEl.addEventListener('click', onSuppressClick, true);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  return () => {
    cleanup(false);
    gridEl.removeEventListener('pointerdown', onPointerDown);
    gridEl.removeEventListener('touchmove', onTouchMove);
    gridEl.removeEventListener('click', onSuppressClick, true);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };
}

/** Formats countdown milliseconds cleanly as mm:ss or hh:mm:ss. */
export function formatCountdownMs(ms) {
  const totalSec = Math.max(0, Math.ceil((ms || 0) / 1000));
  const hPart = Math.floor(totalSec / 3600);
  const mPart = Math.floor((totalSec % 3600) / 60);
  const sPart = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hPart > 0 ? `${hPart}:${pad(mPart)}:${pad(sPart)}` : `${pad(mPart)}:${pad(sPart)}`;
}
