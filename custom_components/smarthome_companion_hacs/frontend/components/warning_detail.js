// WarningDetailView: Dedicated weather warning subview for DWD / NINA alerts.
import { h, icon, numeric } from '../lib/util.js';

const LVL_NAMES = [
  'Keine Warnung',
  'Leichte Warnung',
  'Mäßige Warnung',
  'Starke Warnung',
  'Extreme Warnung',
];

const LVL_COLORS = [
  '#4caf50', // Level 0: Grün
  '#fbc02d', // Level 1: Gelb
  '#fb8c00', // Level 2: Orange
  '#e53935', // Level 3: Rot
  '#8e24aa', // Level 4: Violett
];

function parseHexRgb(color) {
  const s = String(color || '').trim();
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function contrastTextForBg(color) {
  const rgb = parseHexRgb(color);
  if (!rgb) return '#ffffff';
  const toLin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * toLin(rgb[0]) + 0.7152 * toLin(rgb[1]) + 0.0722 * toLin(rgb[2]);
  return lum > 0.26 ? '#111827' : '#ffffff';
}

function formatTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}.${month}. ${hours}:${mins}`;
}

export class WarningDetailView {
  /**
   * @param {object} cfg   config.warning {entity_id, headline_attribute}
   * @param {Function} onBack
   */
  constructor(cfg, onBack) {
    this.cfg = cfg || {};
    this.entityId = this.cfg.entity_id || '';
    this.onBack = onBack;
    this.hass = null;
    this._renderedKey = '';
    this._build();
  }

  _build() {
    this.regionEl = h('div', { style: { fontSize: '12px', color: 'var(--cd-secondary)' } });
    this.countBadge = h('div', { class: 'warning-detail-count' }, '0 Warnungen');

    this.header = h('div', { class: 'warning-detail-head' },
      h('div', { class: 'warning-detail-left' },
        h('div', { class: 'warning-detail-title-wrap' },
          h('div', { class: 'icon' }, icon('mdi:alert-decagram')),
          h('div', {},
            h('h2', { class: 'warning-detail-title' }, 'Wetterwarnungen'),
            this.regionEl))),
      this.countBadge);

    this.listEl = h('div', { class: 'warning-list' });

    this.el = h('div', { class: 'warning-detail-page' },
      this.header,
      this.listEl);
  }

  update(hass) {
    this.hass = hass;
    const st = this.entityId ? hass.states[this.entityId] : null;
    const attrs = st?.attributes || {};
    const regionName = attrs.friendly_name || this.entityId || 'Wetterdienst';
    this.regionEl.textContent = regionName;

    const count = parseInt(attrs.warning_count, 10) || (numeric(st) > 0 ? 1 : 0);
    const key = `${st?.state || ''}_${count}_${JSON.stringify(attrs)}`;
    if (key === this._renderedKey) return;
    this._renderedKey = key;

    this.countBadge.textContent = count === 1 ? '1 Warnung' : `${count} Warnungen`;
    this.countBadge.toggleAttribute('data-active', count > 0);

    if (count <= 0) {
      this.listEl.replaceChildren(
        h('div', { class: 'warning-empty' },
          h('div', { class: 'icon' }, icon('mdi:shield-check')),
          h('div', { class: 'title' }, 'Keine Warnungen'),
          h('div', { class: 'sub' }, `${regionName}: Keine Meldungen`))
      );
      return;
    }

    const cards = [];
    for (let i = 1; i <= count; i++) {
      const lvl = parseInt(attrs[`warning_${i}_level`], 10) || numeric(st) || 1;
      const lvlName = LVL_NAMES[lvl] || `Warnstufe ${lvl}`;
      const color = attrs[`warning_${i}_color`] || LVL_COLORS[lvl] || '#fb8c00';
      const badgeFg = contrastTextForBg(color);
      const hl = attrs[`warning_${i}_headline`] || attrs[this.cfg.headline_attribute] || st?.state || 'Amtliche Warnung';
      const start = formatTime(attrs[`warning_${i}_start`]);
      const end = formatTime(attrs[`warning_${i}_end`]);
      const desc = attrs[`warning_${i}_description`] || '';
      const instr = attrs[`warning_${i}_instruction`] || '';

      const topRow = h('div', { class: 'warning-top' },
        h('span', { class: 'warning-level-badge', style: { background: color, color: badgeFg } },
          `Stufe ${lvl} · ${lvlName}`),
        (start || end) ? h('span', { class: 'warning-time' },
          icon('mdi:clock-outline'),
          `Zeitraum: ${start}${end ? ` – ${end}` : ''}`) : null
      );

      const cardChildren = [
        topRow,
        h('div', { class: 'warning-hl' }, hl),
      ];

      if (desc) {
        cardChildren.push(h('div', { class: 'warning-desc' }, desc));
      }

      if (instr) {
        cardChildren.push(
          h('div', { class: 'warning-instruction' },
            h('div', { class: 'warning-instruction-title' },
              icon('mdi:information-outline'), 'Handlungsempfehlungen'),
            h('div', { class: 'warning-instruction-text' }, instr))
        );
      }

      cards.push(h('div', { class: 'warning-card', style: { '--warn-color': color } }, ...cardChildren));
    }

    this.listEl.replaceChildren(...cards);
  }
}
