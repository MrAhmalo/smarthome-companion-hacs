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
  bodenmessgeraet: '#4caf50', // Grün
  raummessgeraet: '#ff5722', // Deep Orange
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

/** Best-effort icon for an entity (category > custom icon > entity icon > domain default). */
export function entityIcon(entityId, st, custom, category) {
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
  if (category === 'bodenmessgeraet') return 'mdi:sprout';
  if (category === 'raummessgeraet') return 'mdi:thermometer-lines';

  if (custom) return custom;

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
 * so the colored fill matches the right edge of the 6px rounded thumb pill
 * at every percentage from 0% to 100%.
 */
export function setSliderVal(slider, val) {
  if (!slider) return;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const v = Math.max(min, Math.min(max, Number(val)));
  slider.value = String(v);
  if (min === 0 && v <= 0) {
    slider.style.setProperty('--val', '0%');
    return;
  }
  const p = max > min ? (v - min) / (max - min) : 0;
  const pct = (p * 100).toFixed(2);
  const offsetPx = ((1 - p) * 6).toFixed(2);
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
