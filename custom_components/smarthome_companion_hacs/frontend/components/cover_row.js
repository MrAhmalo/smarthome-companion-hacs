// Shared Cover Row Builder used by RoomDetailView and BlindsView.
import {
  h, icon, domainOf, isUnavailable, entityIcon, setSliderVal, parseChannelKey, editBorder,
} from '../lib/util.js';

export function coverRowService(getHass, spec, svc) {
  const hass = getHass();
  if (!hass) return;
  const rawDom = domainOf(spec.entity_id);
  if (rawDom === 'cover') {
    hass.callService('cover', svc, { entity_id: spec.entity_id });
  } else {
    const turnOn = svc === 'open_cover';
    hass.callService(rawDom, turnOn ? 'turn_on' : 'turn_off', { entity_id: spec.entity_id });
  }
}

export function createCoverRow(spec, { getHass, ctx } = {}) {
  const iconEl = icon('mdi:window-shutter');
  const nameEl = h('div', { class: 'cover-detail-name' }, spec.name || spec.entity_id);
  const stateEl = h('div', { class: 'cover-detail-state' }, 'Laden...');

  const mkBtn = (ic, lbl, fn) => h('button', {
    class: 'mini-btn', type: 'button', 'aria-label': lbl,
    onClick: (e) => { e.stopPropagation(); fn(); },
  }, icon(ic));

  const btnUp = mkBtn('mdi:arrow-up', 'Öffnen', () => coverRowService(getHass, spec, 'open_cover'));
  const btnStop = mkBtn('mdi:stop', 'Stopp', () => coverRowService(getHass, spec, 'stop_cover'));
  const btnDown = mkBtn('mdi:arrow-down', 'Schließen', () => coverRowService(getHass, spec, 'close_cover'));

  const slider = h('input', {
    type: 'range', class: 'slider', min: '0', max: '100', step: '1',
    'aria-label': `${spec.name || spec.entity_id} Position`,
    style: { touchAction: 'none', '--tile-color': '#9c27b0' },
  });
  slider.addEventListener('pointerdown', (e) => e.stopPropagation());
  slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  slider.addEventListener('click', (e) => e.stopPropagation());

  let dragging = false;
  slider.addEventListener('input', () => {
    dragging = true;
    setSliderVal(slider, slider.value);
    stateEl.textContent = `Position: ${slider.value}%`;
  });
  slider.addEventListener('change', () => {
    dragging = false;
    const hass = getHass();
    if (!hass) return;
    const rawDom = domainOf(spec.entity_id);
    if (rawDom === 'cover') {
      hass.callService('cover', 'set_cover_position', {
        entity_id: spec.entity_id,
        position: Number(slider.value),
      });
    } else {
      hass.callService(rawDom, Number(slider.value) > 0 ? 'turn_on' : 'turn_off', {
        entity_id: spec.entity_id,
      });
    }
  });

  const sliderWrap = h('div', { class: 'cover-slider-wrap' },
    h('span', { class: 'cover-slider-label' }, '0%'),
    slider,
    h('span', { class: 'cover-slider-label' }, '100%'));

  const openEditDevice = () => {
    const devId = spec.device_id || parseChannelKey(spec.key).deviceId || spec.entity_id;
    if (devId && ctx?.onOpenDevice) ctx.onOpenDevice(devId);
  };

  const row = h('div', { class: 'cover-detail-row' },
    h('div', { class: 'cover-detail-top' },
      h('div', {
        class: 'cover-detail-info',
        onClick: () => { if (ctx?.isEditMode?.()) openEditDevice(); },
      },
        h('div', { class: 'cover-detail-icon' }, iconEl),
        h('div', { class: 'cover-detail-texts' }, nameEl, stateEl)),
      h('div', { class: 'tile-btns' }, btnUp, btnStop, btnDown)),
    sliderWrap,
    ctx ? editBorder(10) : null);

  if (ctx) {
    row.addEventListener('pointerdown', (e) => {
      if (ctx.isEditMode?.()) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    row.addEventListener('click', (e) => {
      if (ctx.isEditMode?.()) { e.stopPropagation(); e.preventDefault(); openEditDevice(); }
    }, true);
  }

  return {
    spec, row, iconEl, stateEl, slider, btnUp, btnStop, btnDown,
    get dragging() { return dragging; },
  };
}

export function updateCoverRow(cr, hass) {
  const st = hass?.states?.[cr.spec.entity_id];
  const unav = isUnavailable(st);
  cr.row.toggleAttribute('data-unavailable', unav);
  cr.iconEl.setAttribute('icon', entityIcon(cr.spec.entity_id, st, cr.spec.icon, cr.spec.category));
  cr.btnUp.disabled = unav;
  cr.btnStop.disabled = unav;
  cr.btnDown.disabled = unav;
  cr.slider.disabled = unav;

  if (unav) {
    cr.stateEl.textContent = 'Nicht verfügbar';
    return;
  }

  const pos = st?.attributes?.current_position != null ? Number(st.attributes.current_position) : null;
  const state = st?.state;
  const moving = state === 'opening' || state === 'closing';

  if (moving) {
    cr.stateEl.textContent = state === 'opening' ? 'Öffnet...' : 'Schließt...';
    cr.btnStop.style.color = '#9c27b0';
  } else {
    cr.btnStop.style.color = '';
    const posTxt = pos != null ? ` · ${pos}%` : '';
    cr.stateEl.textContent = (state === 'closed' ? 'Geschlossen' : 'Geöffnet') + posTxt;
  }

  if (!cr.dragging) {
    const effectivePos = pos != null ? pos : (state === 'closed' ? 0 : 100);
    setSliderVal(cr.slider, effectivePos);
  }
}
