// WarningDetailView: Dedicated weather warning subview for DWD / NINA alerts.
import { h, icon, numeric } from '../lib/util.js?v=2.8.23';

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
    this.backBtn = h('button', {
      class: 'warning-detail-back',
      'aria-label': 'Zurück zum Dashboard',
      onClick: () => this.onBack?.(),
    }, icon('mdi:arrow-left'), 'Zurück');

    this.regionEl = h('div', { style: { fontSize: '12px', color: 'var(--cd-secondary)' } });
    this.countBadge = h('div', { class: 'warning-detail-count' }, '0 Warnungen');

    this.header = h('div', { class: 'warning-detail-head' },
      h('div', { class: 'warning-detail-left' },
        this.backBtn,
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

    this.countBadge.textContent = count === 1 ? '1 aktive Warnung' : `${count} aktive Warnungen`;
    this.countBadge.style.color = count > 0 ? '#ff9800' : 'var(--primary-text-color, #fff)';

    if (count <= 0) {
      this.listEl.replaceChildren(
        h('div', { class: 'warning-empty' },
          h('div', { class: 'icon' }, icon('mdi:shield-check')),
          h('div', { class: 'title' }, 'Keine aktuellen Warnungen'),
          h('div', { class: 'sub' }, `Für ${regionName} liegen derzeit keine amtlichen Wetterwarnungen vor.`))
      );
      return;
    }

    const cards = [];
    for (let i = 1; i <= count; i++) {
      const lvl = parseInt(attrs[`warning_${i}_level`], 10) || numeric(st) || 1;
      const lvlName = LVL_NAMES[lvl] || `Warnstufe ${lvl}`;
      const color = attrs[`warning_${i}_color`] || LVL_COLORS[lvl] || '#fb8c00';
      const hl = attrs[`warning_${i}_headline`] || attrs[this.cfg.headline_attribute] || st?.state || 'Amtliche Warnung';
      const start = formatTime(attrs[`warning_${i}_start`]);
      const end = formatTime(attrs[`warning_${i}_end`]);
      const desc = attrs[`warning_${i}_description`] || '';
      const instr = attrs[`warning_${i}_instruction`] || '';

      const topRow = h('div', { class: 'warning-top' },
        h('span', { class: 'warning-level-badge', style: { background: color } },
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
            h('div', { class: 'warning-instruction-title', style: { color } },
              icon('mdi:information-outline'), 'Handlungsempfehlungen'),
            h('div', { class: 'warning-instruction-text' }, instr))
        );
      }

      cards.push(h('div', { class: 'warning-card' }, ...cardChildren));
    }

    this.listEl.replaceChildren(...cards);
  }
}
