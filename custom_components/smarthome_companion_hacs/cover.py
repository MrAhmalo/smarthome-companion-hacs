"""Cover platform for SmartHome Companion: Hybrid Multi-Protocol Covers & Group Covers."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

# pyrefly: ignore [missing-import]
from homeassistant.components.cover import (
    ATTR_POSITION,
    ATTR_TILT_POSITION,
    CoverEntity,
    CoverEntityFeature,
)
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
EVENT_HOMEASSISTANT_STARTED = getattr(_ha_const, "EVENT_HOMEASSISTANT_STARTED", "homeassistant_started")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers import entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import (
    build_group_device_info,
    build_hybrid_device_info,
    cleanup_duplicated_group_entity_id,
    resolve_group_child_entities,
)
from .entity_sync import PROTOCOL_LABELS
from .hybrid_manager import resolve_source_entity_id

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store:
        return

    module = (getattr(entry, "data", None) or {}).get("module", "legacy")
    entry_id = getattr(entry, "entry_id", "default")
    domain_data = hass.data.setdefault(DOMAIN, {})

    # 1. Group Covers (module in groups/legacy)
    if module in ("groups", "legacy"):
        owner = domain_data.get("_cover_groups_entry_id")
        if not owner or owner == entry_id:
            domain_data["_cover_groups_entry_id"] = entry_id
            existing_group_covers: dict[str, CompanionGroupCover] = {}

            @callback
            def sync_group_covers(event=None):
                groups = store.get_groups() or {}
                new_ents = []
                active_ids: set[str] = set()
                for gid, g_cfg in groups.items():
                    if not isinstance(g_cfg, dict):
                        continue
                    cat = (g_cfg.get("category") or "").strip()
                    if cat not in ("jalousie", "cover"):
                        continue
                    active_ids.add(gid)
                    if gid not in existing_group_covers:
                        ent = CompanionGroupCover(hass, store, gid)
                        existing_group_covers[gid] = ent
                        new_ents.append(ent)
                    else:
                        existing_group_covers[gid].async_refresh_group()
                for stale_id in [k for k in existing_group_covers if k not in active_ids]:
                    st_ent = existing_group_covers.pop(stale_id)
                    if st_ent._unsub_tracker:
                        st_ent._unsub_tracker()
                        st_ent._unsub_tracker = None
                    if st_ent._added and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())
                if new_ents:
                    async_add_entities(new_ents)

            sync_group_covers()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_covers))

            @callback
            def _cleanup_gc():
                if domain_data.get("_cover_groups_entry_id") == entry_id:
                    domain_data.pop("_cover_groups_entry_id", None)
                for ent in existing_group_covers.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_gc)

    # 2. Hybrid Multi-Protocol Covers (module in hybrids/legacy)
    hybrid_mgr = domain_data.get("hybrid_manager")
    if module in ("hybrids", "legacy") and hybrid_mgr:
        h_owner = domain_data.get("_hybrid_covers_entry_id")
        if not h_owner or h_owner == entry_id:
            domain_data["_hybrid_covers_entry_id"] = entry_id
            existing_hybrids: dict[tuple[str, str], HybridCover] = {}

            @callback
            def sync_hybrid_covers(event=None):
                hybrids = store.get_hybrids() or {}
                new_ents = []
                active_keys: set[tuple[str, str]] = set()
                for hid, h_cfg in hybrids.items():
                    if not isinstance(h_cfg, dict):
                        continue
                    for ch in h_cfg.get("channels") or []:
                        if not isinstance(ch, dict) or ch.get("domain") != "cover":
                            continue
                        key = (hid, ch.get("channel_key", "main"))
                        active_keys.add(key)
                        if key not in existing_hybrids:
                            ent = HybridCover(hass, store, hybrid_mgr, hid, ch)
                            existing_hybrids[key] = ent
                            new_ents.append(ent)
                        else:
                            existing_hybrids[key].async_refresh_hybrid(ch)
                for stale_key in [k for k in existing_hybrids if k not in active_keys]:
                    st_ent = existing_hybrids.pop(stale_key)
                    if st_ent._unsub_tracker:
                        st_ent._unsub_tracker()
                        st_ent._unsub_tracker = None
                    if st_ent._added and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())
                if new_ents:
                    async_add_entities(new_ents)

            sync_hybrid_covers()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_covers))

            @callback
            def _cleanup_hc():
                if domain_data.get("_hybrid_covers_entry_id") == entry_id:
                    domain_data.pop("_hybrid_covers_entry_id", None)
                for ent in existing_hybrids.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_hc)


class CompanionGroupCover(CoverEntity):
    """Native HA Cover Entity for Jalousie/Cover groups."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._unsub_tracker = None
        self._unsub_start = None
        self._added = False
        self._update_attrs()

    def _update_attrs(self) -> None:
        g = (self._store.get_groups() or {}).get(self._group_id, {})
        self._attr_name = None
        self._attr_unique_id = f"smarthome_companion_group_cover_{self._group_id}"
        self._attr_icon = g.get("icon") or "mdi:window-shutter"
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)
        self._attr_supported_features = (
            CoverEntityFeature.OPEN
            | CoverEntityFeature.CLOSE
            | CoverEntityFeature.STOP
            | CoverEntityFeature.SET_POSITION
        )

    def _get_child_entities(self) -> list[str]:
        return resolve_group_child_entities(self.hass, self._store, self._group_id, domains=("cover",))

    @callback
    def async_refresh_group(self) -> None:
        self._update_attrs()
        self._update_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    @property
    def current_cover_position(self) -> int | None:
        positions = []
        for eid in self._get_child_entities():
            st = self.hass.states.get(eid)
            if st and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                pos = st.attributes.get("current_position")
                if isinstance(pos, (int, float)):
                    positions.append(float(pos))
        return round(sum(positions) / len(positions)) if positions else None

    @property
    def is_closed(self) -> bool | None:
        states = [self.hass.states.get(eid) for eid in self._get_child_entities()]
        valid = [s for s in states if s and s.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)]
        if not valid:
            return None
        return all(s.state == "closed" for s in valid)

    @property
    def is_opening(self) -> bool:
        return any(
            (st := self.hass.states.get(eid)) is not None and st.state == "opening"
            for eid in self._get_child_entities()
        )

    @property
    def is_closing(self) -> bool:
        return any(
            (st := self.hass.states.get(eid)) is not None and st.state == "closing"
            for eid in self._get_child_entities()
        )

    async def async_open_cover(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if eids:
            await self.hass.services.async_call("cover", "open_cover", {"entity_id": eids}, blocking=False)

    async def async_close_cover(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if eids:
            await self.hass.services.async_call("cover", "close_cover", {"entity_id": eids}, blocking=False)

    async def async_stop_cover(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if eids:
            await self.hass.services.async_call("cover", "stop_cover", {"entity_id": eids}, blocking=False)

    async def async_set_cover_position(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if eids and ATTR_POSITION in kwargs:
            await self.hass.services.async_call(
                "cover", "set_cover_position", {"entity_id": eids, ATTR_POSITION: kwargs[ATTR_POSITION]}, blocking=False
            )

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if not self._added or not self.hass:
            return
        eids = self._get_child_entities()
        if eids:
            @callback
            def _changed(event):
                if self._added and self.hass and self.entity_id and self.platform is not None:
                    self.async_write_ha_state()

            self._unsub_tracker = async_track_state_change_event(self.hass, eids, _changed)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._update_tracking()
        _listen_start = getattr(self.hass.bus, "async_listen_once", None)
        self._unsub_start = _listen_start(EVENT_HOMEASSISTANT_STARTED, lambda _e: self._update_tracking()) if callable(_listen_start) else None
        cleanup_duplicated_group_entity_id(self.hass, self.entity_id)

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if self._unsub_start:
            self._unsub_start()
            self._unsub_start = None


class HybridCover(CoverEntity):
    """Master Cover entity routing commands strictly to one preferred transport with failover."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, channel_spec: dict[str, Any]) -> None:
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._ch = dict(channel_spec)
        self._channel_key = self._ch.get("channel_key", "main")
        self._ctrl = hybrid_mgr.get_controller(hybrid_id, self._channel_key)
        self._unsub_tracker = None
        self._added = False
        self._active_proto: str | None = None
        self._cached_state: str | None = None
        self._cached_attrs: dict[str, Any] = {}
        self._seed_initial_snapshot()
        self._update_attrs()

    def _seed_initial_snapshot(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        snap = (h_cfg.get("initial_channel_states") or {}).get("0")
        if isinstance(snap, dict):
            self._cached_state = snap.get("state")
            self._cached_attrs = dict(snap.get("attributes") or {})

    def _update_attrs(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        channels = h_cfg.get("channels") or []
        ch_disp = self._ch.get("name") or f"Kanal {self._channel_key.replace('ch_', '')}"
        self._attr_name = None if len(channels) <= 1 else ch_disp
        self._attr_unique_id = self._ch.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_{self._channel_key}"
        self._attr_icon = h_cfg.get("icon") or "mdi:window-shutter"
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if not self._added and self._ch.get("master_entity_id"):
            self.entity_id = self._ch["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, ch_spec: dict[str, Any]) -> None:
        self._ch = dict(ch_spec)
        self._update_attrs()
        self._sync_from_active()
        self._update_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _sync_from_active(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        proto, eid = self._ctrl.select_active_protocol(self._ch.get("sources") or {}, h_cfg)
        self._active_proto = proto
        st = self.hass.states.get(eid) if (eid and self.hass) else None
        if st and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._cached_state = st.state
            self._cached_attrs = dict(st.attributes or {})

    @property
    def available(self) -> bool:
        return self._active_proto is not None

    @property
    def supported_features(self) -> CoverEntityFeature:
        feats = self._cached_attrs.get("supported_features")
        if isinstance(feats, int) and feats > 0:
            return CoverEntityFeature(feats)
        return CoverEntityFeature.OPEN | CoverEntityFeature.CLOSE | CoverEntityFeature.STOP | CoverEntityFeature.SET_POSITION

    @property
    def current_cover_position(self) -> int | None:
        pos = self._cached_attrs.get("current_position")
        return int(pos) if isinstance(pos, (int, float)) else None

    @property
    def current_cover_tilt_position(self) -> int | None:
        pos = self._cached_attrs.get("current_tilt_position")
        return int(pos) if isinstance(pos, (int, float)) else None

    @property
    def is_closed(self) -> bool | None:
        if self._cached_state == "closed":
            return True
        if self._cached_state in ("open", "opening", "closing"):
            return False
        pos = self.current_cover_position
        return (pos == 0) if pos is not None else None

    @property
    def is_opening(self) -> bool:
        return self._cached_state == "opening"

    @property
    def is_closing(self) -> bool:
        return self._cached_state == "closing"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    def _refresh_cb(self) -> None:
        self._sync_from_active()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    async def _dispatch(self, service: str, data: dict[str, Any]) -> None:
        await self._ctrl.async_dispatch_command(
            "cover",
            service,
            data,
            self._ch.get("sources") or {},
            on_state_refresh=self._refresh_cb,
        )
        self._refresh_cb()

    async def async_open_cover(self, **kwargs) -> None:
        await self._dispatch("open_cover", {})

    async def async_close_cover(self, **kwargs) -> None:
        await self._dispatch("close_cover", {})

    async def async_stop_cover(self, **kwargs) -> None:
        await self._dispatch("stop_cover", {})

    async def async_set_cover_position(self, **kwargs) -> None:
        if ATTR_POSITION in kwargs:
            await self._dispatch("set_cover_position", {ATTR_POSITION: kwargs[ATTR_POSITION]})

    async def async_set_cover_tilt_position(self, **kwargs) -> None:
        if ATTR_TILT_POSITION in kwargs:
            await self._dispatch("set_cover_tilt_position", {ATTR_TILT_POSITION: kwargs[ATTR_TILT_POSITION]})

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if not self._added or not self.hass:
            return
        eid_to_proto: dict[str, str] = {}
        for proto, src in (self._ch.get("sources") or {}).items():
            eid = resolve_source_entity_id(self.hass, src)
            if eid:
                eid_to_proto[eid] = proto
        if not eid_to_proto:
            return

        @callback
        def _on_src_change(event) -> None:
            eid = event.data.get("entity_id")
            proto = eid_to_proto.get(eid or "")
            if not proto:
                return
            if not self._ctrl.should_accept_state_event(proto, event.data.get("old_state"), event.data.get("new_state")):
                return
            self._refresh_cb()

        self._unsub_tracker = async_track_state_change_event(self.hass, list(eid_to_proto.keys()), _on_src_change)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._sync_from_active()
        self._update_tracking()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
