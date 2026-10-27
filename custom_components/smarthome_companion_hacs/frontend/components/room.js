// Room component: collapsible "expander" card with area header (sensors, alerts, group controls) and tiles.
import { h, icon, domainOf, isActive, numeric } from '../lib/util.js';
import { Tile } from './tile.js';

const GROUPS = [
  { domain: 'light', icon: 'mdi:lightbulb', label: 'Alle Lichter' },
  { domain: 'switch', icon: 'mdi:toggle-switch', label: 'Alle Schalter' },
  { domain: 'cover', icon: 'mdi:window-shutter', label: 'Alle Jalousien' },
];

function average(hass, ids) {
  const values = ids.map((id) => numeric(hass.states[id])).filter((v) => v !== null);
  if (!values.length) return null;
  const unit = ids.map((id) => hass.states[id]?.attributes?.unit_of_measurement).find(Boolean) || '';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return `${avg.toFixed(1).replace(/\.0$/, '')}${unit ? ` ${unit}` : ''}`.replace(' %', '%').replace(' °', '°');
}

export class Room {
  /**
   * @param {object} spec  room from backend layout
   * @param {object} ctx   {presets, openState: Map<string, boolean>}
   */
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.hass = null;
    this.tiles = spec.tiles.map((t) => new Tile(t, ctx));
    this._build();
  }

  get open() {
    if (this.spec.always_open) return true;
    const saved = this.ctx.openState.get(this.spec.area_id);
    return saved === undefined ? !!this.spec.expanded : saved;
  }

  _build() {
    const { spec } = this;

    // Group controls (all lights / switches / covers of this room)
    this.groups = GROUPS
      .map((g) => ({ ...g, ids: spec.tiles.filter((t) => domainOf(t.entity_id) === g.domain).map((t) => t.entity_id) }))
      .filter((g) => g.ids.length > 0)
      .map((g) => {
        const countEl = h('span', { class: 'count', hidden: true });
        const btn = h('button', {
          class: 'ctrl-btn', 'aria-label': g.label,
          onClick: (e) => { e.stopPropagation(); this._toggleGroup(g); },
        }, icon(g.icon), countEl);
        return { ...g, btn, countEl };
      });

    this.metaEl = h('div', { class: 'room-meta' });
    this.controlsEl = h('div', { class: 'room-controls' }, this.groups.map((g) => g.btn));

    this.head = h('div', {
      class: 'room-head', role: 'button', tabindex: '0', 'aria-expanded': String(this.open),
      onClick: () => this._toggleOpen(),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleOpen(); } },
    },
    h('div', { class: 'room-icon' }, icon(spec.icon)),
    h('div', { class: 'room-title' }, h('div', { class: 'room-name' }, spec.name), this.metaEl),
    this.controlsEl,
    icon('mdi:chevron-down', 'chevron'));

    this.grid = h('div', { class: 'tile-grid' }, this.tiles.map((t) => t.el));
    this.el = h('div', { class: 'card room' },
      this.head,
      h('div', { class: 'room-body' }, h('div', { class: 'room-body-inner' }, this.grid)));
    this._applyOpen();
  }

  _applyOpen() {
    this.el.toggleAttribute('data-open', this.open);
    this.el.toggleAttribute('data-always', !!this.spec.always_open);
    this.head.setAttribute('aria-expanded', String(this.open));
  }

  _toggleOpen() {
    if (this.spec.always_open) return;
    this.ctx.openState.set(this.spec.area_id, !this.open);
    this._applyOpen();
  }

  _toggleGroup(group) {
    const states = group.ids.map((id) => this.hass.states[id]).filter(Boolean);
    if (group.domain === 'cover') {
      const anyOpen = states.some((s) => s.state !== 'closed');
      this.hass.callService('cover', anyOpen ? 'close_cover' : 'open_cover', { entity_id: group.ids });
    } else {
      const anyOn = states.some((s) => isActive(s));
      this.hass.callService(group.domain, anyOn ? 'turn_off' : 'turn_on', { entity_id: group.ids });
    }
  }

  update(hass) {
    this.hass = hass;
    this.tiles.forEach((t) => t.update(hass));

    // Group controls
    for (const g of this.groups) {
      const states = g.ids.map((id) => hass.states[id]).filter(Boolean);
      const count = g.domain === 'cover'
        ? states.filter((s) => s.state !== 'closed').length
        : states.filter((s) => isActive(s)).length;
      g.btn.toggleAttribute('data-on', count > 0);
      g.countEl.hidden = count === 0;
      g.countEl.textContent = String(count);
    }

    // Header meta: temperature, humidity, alerts
    const { sensors } = this.spec;
    const chips = [];
    const temp = sensors.temperature?.length ? average(hass, sensors.temperature) : null;
    const hum = sensors.humidity?.length ? average(hass, sensors.humidity) : null;
    if (temp) chips.push(h('span', {}, icon('mdi:thermometer'), temp));
    if (hum) chips.push(h('span', {}, icon('mdi:water-percent'), hum));
    if ((sensors.motion || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('span', { class: 'alert' }, icon('mdi:motion-sensor'), 'Bewegung'));
    }
    if ((sensors.moisture || []).some((id) => hass.states[id]?.state === 'on')) {
      chips.push(h('span', { class: 'alert' }, icon('mdi:water-alert'), 'Feuchtigkeit'));
    }
    const key = chips.map((c) => c.textContent).join('|');
    if (key !== this._metaKey) {
      this._metaKey = key;
      this.metaEl.replaceChildren(...chips);
    }
  }
}
