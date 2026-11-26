"""Binary-Sensor platform for SmartHome Companion: Hybrid Masters & Group OR Aggregators."""
from __future__ import annotations

import logging
from typing import Any

# pyrefly: ignore [missing-import]
from homeassistant.components.binary_sensor import BinarySensorEntity
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
EVENT_HOMEASSISTANT_STARTED = getattr(_ha_const, "EVENT_HOMEASSISTANT_STARTED", "homeassistant_started")
STATE_ON = getattr(_ha_const, "STATE_ON", "on")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers import entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import build_group_device_info, build_hybrid_device_info
from .entity_sync import PROTOCOL_LABELS
from .group_sensors import (
    GROUP_BINARY_CLASSES,
    evaluate_group_binary_or,
    resolve_group_leaf_sensors,
)
from .hybrid_manager import resolve_source_entity_id

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store:
        return

    module = (getattr(entry, "data", None) or {}).get("module", "legacy")
    entry_id = getattr(entry, "entry_id", "default")
    domain_data = hass.data.setdefault(DOMAIN, {})

    # 1. Group Logical-OR Binary Sensors (module in groups/legacy)
    if module in ("groups", "legacy"):
        g_owner = domain_data.get("_group_binary_sensors_entry_id")
        if not g_owner or g_owner == entry_id:
            domain_data["_group_binary_sensors_entry_id"] = entry_id
            group_bins: dict[tuple[str, str], CompanionGroupBinarySensor] = {}

            @callback
            def sync_group_binary_sensors(event=None):
                groups = store.get_groups() or {}
                active_keys: set[tuple[str, str]] = set()
                new_ents: list[CompanionGroupBinarySensor] = []

                for gid in list(groups.keys()):
                    buckets = resolve_group_leaf_sensors(hass, store, gid)
                    for (dom, dc), member_eids in buckets.items():
                        if dom != "binary_sensor" or dc not in GROUP_BINARY_CLASSES or not member_eids:
                            continue
                        key = (gid, dc)
                        active_keys.add(key)
                        if key not in group_bins:
                            ent = CompanionGroupBinarySensor(hass, store, gid, dc)
                            ent.set_members(member_eids)
                            group_bins[key] = ent
                            new_ents.append(ent)
                        else:
                            group_bins[key].set_members(member_eids)

                ent_reg = er.async_get(hass)
                for stale_key in [k for k in group_bins if k not in active_keys]:
                    st_ent = group_bins.pop(stale_key)
                    if st_ent._unsub:
                        st_ent._unsub()
                        st_ent._unsub = None
                    if st_ent._added and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())
                    uid = st_ent.unique_id
                    if uid:
                        reg_eid = ent_reg.async_get_entity_id("binary_sensor", DOMAIN, uid)
                        if reg_eid:
                            try:
                                ent_reg.async_remove(reg_eid)
                            except Exception:  # noqa: BLE001
                                pass

                if new_ents:
                    async_add_entities(new_ents)

            sync_group_binary_sensors()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_binary_sensors))
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_group_binary_sensors))
            _listen_start = getattr(hass.bus, "async_listen_once", None)
            if callable(_listen_start):
                entry.async_on_unload(_listen_start(EVENT_HOMEASSISTANT_STARTED, sync_group_binary_sensors))

            @callback
            def _cleanup_gb():
                if domain_data.get("_group_binary_sensors_entry_id") == entry_id:
                    domain_data.pop("_group_binary_sensors_entry_id", None)
                for ent in group_bins.values():
                    if ent._unsub:
                        ent._unsub()
                        ent._unsub = None

            entry.async_on_unload(_cleanup_gb)

    # 2. Hybrid Fallback Binary Sensors (module in hybrids/legacy)
    hybrid_mgr = domain_data.get("hybrid_manager")
    if module in ("hybrids", "legacy") and hybrid_mgr:
        h_owner = domain_data.get("_hybrid_binary_sensors_entry_id")
        if not h_owner or h_owner == entry_id:
            domain_data["_hybrid_binary_sensors_entry_id"] = entry_id
            hybrid_bins: dict[tuple[str, str], HybridBinarySensor] = {}

            @callback
            def sync_hybrid_binary_sensors(event=None):
                hybrids = store.get_hybrids() or {}
                active_keys: set[tuple[str, str]] = set()
                new_ents: list[HybridBinarySensor] = []

                for hid, h_cfg in hybrids.items():
                    if not isinstance(h_cfg, dict):
                        continue
                    for s_spec in h_cfg.get("sensors") or []:
                        if not isinstance(s_spec, dict) or s_spec.get("domain") != "binary_sensor":
                            continue
                        key = (hid, s_spec.get("sensor_key", ""))
                        active_keys.add(key)
                        if key not in hybrid_bins:
                            ent = HybridBinarySensor(hass, store, hybrid_mgr, hid, s_spec)
                            hybrid_bins[key] = ent
                            new_ents.append(ent)
                        else:
                            hybrid_bins[key].async_refresh_hybrid(s_spec)

                for stale_key in [k for k in hybrid_bins if k not in active_keys]:
                    st_ent = hybrid_bins.pop(stale_key)
                    if st_ent._unsub:
                        st_ent._unsub()
                        st_ent._unsub = None
                    if st_ent._added and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())

                if new_ents:
                    async_add_entities(new_ents)

            sync_hybrid_binary_sensors()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_binary_sensors))

            @callback
            def _cleanup_hb():
                if domain_data.get("_hybrid_binary_sensors_entry_id") == entry_id:
                    domain_data.pop("_hybrid_binary_sensors_entry_id", None)
                for ent in hybrid_bins.values():
                    if ent._unsub:
                        ent._unsub()
                        ent._unsub = None

            entry.async_on_unload(_cleanup_hb)


class CompanionGroupBinarySensor(BinarySensorEntity):
    """Zero-latency logical-OR binary sensor for a Companion Group."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str, dc_key: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._dc = dc_key
        label, ha_dc = GROUP_BINARY_CLASSES[dc_key]
        self._label = label
        self._ha_dc = ha_dc
        self._member_eids: list[str] = []
        self._unsub = None
        self._added = False
        self._is_on: bool | None = False
        self._available = False
        self._active_on: list[str] = []
        self._unavail: list[str] = []
        self._update_meta()

    def _update_meta(self) -> None:
        g = (self._store.get_groups() or {}).get(self._group_id, {})
        self._attr_name = self._label
        self._attr_unique_id = f"smarthome_companion_group_binary_sensor_{self._group_id}_{self._dc}"
        self._attr_device_class = self._ha_dc
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)

    def set_members(self, member_eids: list[str]) -> None:
        new_members = list(dict.fromkeys(member_eids))
        changed = new_members != self._member_eids
        self._member_eids = new_members
        self._update_meta()
        self._recompute()
        if changed and self._added:
            self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _recompute(self) -> None:
        is_on, avail, active_on, unavail = evaluate_group_binary_or(self.hass, self._member_eids)
        self._is_on = is_on
        self._available = avail
        self._active_on = active_on
        self._unavail = unavail

    @property
    def available(self) -> bool:
        return self._available

    @property
    def is_on(self) -> bool | None:
        return self._is_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "member_count": len(self._member_eids),
            "active_members": list(self._active_on),
            "unavailable_members": list(self._unavail),
        }

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass or not self._member_eids:
            return

        @callback
        def _changed(event) -> None:
            self._recompute()
            if self._added and self.hass and self.entity_id and self.platform is not None:
                self.async_write_ha_state()

        self._unsub = async_track_state_change_event(self.hass, self._member_eids, _changed)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._recompute()
        self._rebind_tracking()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub:
            self._unsub()
            self._unsub = None


class HybridBinarySensor(BinarySensorEntity):
    """Per-sensor fallback BinarySensor for a Hybrid Multi-Protocol device."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, spec: dict[str, Any]) -> None:
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._spec = dict(spec)
        self._sensor_key = self._spec.get("sensor_key", "")
        self._ctrl = hybrid_mgr.get_controller(hybrid_id, "main")
        self._unsub = None
        self._added = False
        self._active_proto: str | None = None
        self._is_on: bool | None = None
        self._available = False
        self._update_meta()

    def _update_meta(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        dc = str(self._spec.get("device_class") or "").strip().lower()
        self._attr_name = dc.replace("_", " ").title() or self._sensor_key
        self._attr_unique_id = self._spec.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_binary_sensor_{self._sensor_key}"
        if dc in GROUP_BINARY_CLASSES:
            self._attr_device_class = GROUP_BINARY_CLASSES[dc][1]
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if self._spec.get("master_entity_id"):
            self.entity_id = self._spec["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, spec: dict[str, Any]) -> None:
        self._spec = dict(spec)
        self._update_meta()
        self._recompute()
        self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _recompute(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        sources = self._spec.get("sources") or {}
        for proto in self._ctrl.get_protocol_order(h_cfg):
            src = sources.get(proto)
            eid = resolve_source_entity_id(self.hass, src)
            if not eid:
                continue
            st = self.hass.states.get(eid) if self.hass else None
            if st is not None and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._active_proto = proto
                self._is_on = (st.state == STATE_ON)
                self._available = True
                return
        self._active_proto = None
        self._available = False

    @property
    def available(self) -> bool:
        return self._available

    @property
    def is_on(self) -> bool | None:
        return self._is_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass:
            return
        eids = [
            eid
            for src in (self._spec.get("sources") or {}).values()
            if (eid := resolve_source_entity_id(self.hass, src))
        ]
        if not eids:
            return

        @callback
        def _changed(event) -> None:
            self._recompute()
            if self._added and self.hass and self.entity_id and self.platform is not None:
                self.async_write_ha_state()

        self._unsub = async_track_state_change_event(self.hass, list(dict.fromkeys(eids)), _changed)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._recompute()
        self._rebind_tracking()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub:
            self._unsub()
            self._unsub = None
