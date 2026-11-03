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
  fan: '#00bcd4', // Cyan
  luefter: '#00bcd4',
  valve: '#00bcd4',
  wasserventil: '#00bcd4',
  lock: '#4caf50',
  sensor: '#2196f3',
};

export function effectiveCategory(t) {
  if (!t) return '';
  const cat = t.category || t.spec?.category;
  if (cat === 'leuchte' || cat === 'light') return 'light';
  if (cat === 'jalousie' || cat === 'cover') return 'cover';
  if (cat === 'steckdose' || cat === 'outlet') return 'outlet';
  if (cat === 'fernseher' || cat === 'medien' || cat === 'media_player') return 'media_player';
  if (cat === 'klima' || cat === 'climate') return 'climate';
  if (cat === 'schalter' || cat === 'switch') return 'switch';
  if (cat === 'pumpe' || cat === 'wasserventil' || cat === 'valve') return 'switch';
  const d = domainOf(t.entity_id || t.entityId);
  if (d === 'light') return 'light';
  if (d === 'cover') return 'cover';
  if (d === 'switch') return 'switch';
  if (d === 'media_player') return 'media_player';
  if (d === 'climate') return 'climate';
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

export function stateLabel(hass, st) {
  if (!st) return '';
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
  if (category === 'steckdose') return on ? 'mdi:power-socket-eu' : 'mdi:power-socket-eu';
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
