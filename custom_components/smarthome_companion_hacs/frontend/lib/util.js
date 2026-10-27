// Shared helpers for the Companion dashboard (no external dependencies).

/** Tiny hyperscript helper: h('div', {class:'x', onClick: fn}, child, ...) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
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
  red: '#f44336', orange: '#ff9800', amber: '#ffc107', yellow: '#ffeb3b', lime: '#cddc39',
  green: '#4caf50', teal: '#009688', cyan: '#00bcd4', 'light-blue': '#03a9f4', blue: '#2196f3',
  indigo: '#3f51b5', purple: '#9c27b0', pink: '#e91e63', grey: '#9e9e9e',
};
export const COLOR_NAMES = Object.keys(COLORS);
export const resolveColor = (c) => (c && (COLORS[c] || c)) || '';

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

/** Best-effort icon for an entity (custom icon > entity icon > domain default). */
export function entityIcon(entityId, st, custom) {
  if (custom) return custom;
  if (st?.attributes?.icon) return st.attributes.icon;
  const domain = domainOf(entityId);
  const on = isActive(st);
  const dc = st?.attributes?.device_class;
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
