"""Event platform for SmartHome Companion Hybrid Multi-Protocol button/press debouncing."""
from __future__ import annotations

import logging
import time
from typing import Any

# pyrefly: ignore [missing-import]
from homeassistant.components.event import EventEntity
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import build_hybrid_device_info
from .entity_sync import PROTOCOL_LABELS
from .hybrid_manager import CANONICAL_EVENT_TYPES, HybridEventDebouncer, resolve_source_entity_id

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data.get(DOMAIN, {}).get("store")
    hybrid_mgr = hass.data.get(DOMAIN, {}).get("hybrid_manager")
    if not store or not hybrid_mgr:
        return

    module = (getattr(entry, "data", None) or {}).get("module", "legacy")
    if module not in ("hybrids", "legacy"):
        return

    entry_id = getattr(entry, "entry_id", "default")
    domain_data = hass.data.setdefault(DOMAIN, {})
    owner = domain_data.get("_hybrid_events_entry_id")
    if owner and owner != entry_id:
        return
    domain_data["_hybrid_events_entry_id"] = entry_id

    existing_events: dict[tuple[str, str], HybridEventEntity] = {}

    @callback
    def sync_hybrid_events(event=None):
        hybrids = store.get_hybrids() or {}
        active_keys: set[tuple[str, str]] = set()
        new_ents: list[HybridEventEntity] = []
        for hid, h_cfg in hybrids.items():
            if not isinstance(h_cfg, dict):
                continue
            for ev_spec in h_cfg.get("events") or []:
                if not isinstance(ev_spec, dict):
                    continue
                key = (hid, ev_spec.get("event_key", "main"))
                active_keys.add(key)
                if key not in existing_events:
                    ent = HybridEventEntity(hass, store, hybrid_mgr, hid, ev_spec)
                    existing_events[key] = ent
                    new_ents.append(ent)
                else:
                    existing_events[key].async_refresh_hybrid(ev_spec)

        for stale_key in [k for k in existing_events if k not in active_keys]:
            st_ent = existing_events.pop(stale_key)
            st_ent._clear_listeners()
            if st_ent._added and st_ent.hass and st_ent.platform is not None:
                hass.async_create_task(st_ent.async_remove())

        if new_ents:
            async_add_entities(new_ents)

    sync_hybrid_events()
    entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_events))

    @callback
    def _cleanup():
        if domain_data.get("_hybrid_events_entry_id") == entry_id:
            domain_data.pop("_hybrid_events_entry_id", None)
        for ent in existing_events.values():
            ent._clear_listeners()

    entry.async_on_unload(_cleanup)


class HybridEventEntity(EventEntity):
    """Unified, debounced EventEntity merging `event.*`, `zha_event`, `shelly.click`, and Matter events."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_event_types = CANONICAL_EVENT_TYPES

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, spec: dict[str, Any]) -> None:
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._spec = dict(spec)
        self._event_key = self._spec.get("event_key", "main")
        self._debouncer: HybridEventDebouncer = hybrid_mgr.get_debouncer(hybrid_id)
        self._unsubs: list = []
        self._added = False
        self._update_meta()

    def _update_meta(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        self._attr_name = "Taster"
        self._attr_unique_id = self._spec.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_event_{self._event_key}"
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if not self._added and self._spec.get("master_entity_id"):
            self.entity_id = self._spec["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, spec: dict[str, Any]) -> None:
        self._spec = dict(spec)
        self._debouncer = self._hybrid_mgr.get_debouncer(self._hybrid_id)
        self._update_meta()
        if self._added:
            self._bind_listeners()

    def _emit_debounced(self, raw_action: Any, proto: str, extra: dict[str, Any] | None = None) -> None:
        accepted, canon_action = self._debouncer.should_emit(self._event_key, raw_action, proto, now=time.monotonic())
        if not accepted:
            return
        if canon_action not in self._attr_event_types:
            canon_action = "other"
        attrs = dict(extra or {})
        attrs["active_transport"] = PROTOCOL_LABELS.get(proto, proto)
        self._trigger_event(canon_action, attrs)
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _clear_listeners(self) -> None:
        for u in self._unsubs:
            try:
                u()
            except Exception:  # noqa: BLE001
                pass
        self._unsubs.clear()

    def _bind_listeners(self) -> None:
        self._clear_listeners()
        if not self._added or not self.hass:
            return

        ent_to_proto: dict[str, str] = {}
        bus_listeners: dict[str, list[tuple[str, dict[str, Any]]]] = {}

        for src in self._spec.get("sources") or []:
            if not isinstance(src, dict):
                continue
            proto = str(src.get("protocol") or "wlan")
            kind = src.get("kind")
            if kind == "entity":
                eid = resolve_source_entity_id(self.hass, src)
                if eid:
                    ent_to_proto[eid] = proto
            elif kind == "bus_event" and src.get("event_name"):
                bus_listeners.setdefault(src["event_name"], []).append((proto, src.get("match") or {}))

        if ent_to_proto:
            @callback
            def _on_entity_event(event) -> None:
                eid = event.data.get("entity_id")
                old_st = event.data.get("old_state")
                new_st = event.data.get("new_state")
                if not HybridEventDebouncer.is_fresh_event_entity_state(old_st, new_st):
                    return
                proto = ent_to_proto.get(eid or "")
                if not proto:
                    return
                raw_type = (new_st.attributes or {}).get("event_type") or "single_press"
                self._emit_debounced(raw_type, proto, {"source_entity_id": eid})

            self._unsubs.append(async_track_state_change_event(self.hass, list(ent_to_proto.keys()), _on_entity_event))

        for ev_name, matchers in bus_listeners.items():
            @callback
            def _on_bus_event(event, _ev_name=ev_name, _matchers=matchers) -> None:
                data = event.data or {}
                for proto, match_cfg in _matchers:
                    dev_id = match_cfg.get("device_id")
                    ieee = match_cfg.get("device_ieee")
                    if dev_id and data.get("device_id") == dev_id:
                        raw_act = data.get("click_type") or data.get("command") or data.get("action") or "single_press"
                        self._emit_debounced(raw_act, proto, {"bus_event": _ev_name})
                        return
                    if ieee and str(data.get("device_ieee") or "").lower() == str(ieee).lower():
                        raw_act = data.get("command") or data.get("args") or "single_press"
                        self._emit_debounced(raw_act, proto, {"bus_event": _ev_name})
                        return

            self._unsubs.append(self.hass.bus.async_listen(ev_name, _on_bus_event))

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._bind_listeners()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        self._clear_listeners()
