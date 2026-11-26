import asyncio
import logging
# pyrefly: ignore [missing-import]
from homeassistant.components.light import (
    LightEntity,
    ColorMode,
    ATTR_BRIGHTNESS,
    ATTR_RGB_COLOR,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_TRANSITION,
)
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
EVENT_HOMEASSISTANT_STARTED = getattr(_ha_const, "EVENT_HOMEASSISTANT_STARTED", "homeassistant_started")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
# pyrefly: ignore [missing-import]
from homeassistant.helpers import entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event
# pyrefly: ignore [missing-import]
from homeassistant.core import callback

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

    if module in ("groups", "legacy"):
        owner_entry_id = domain_data.get("_light_groups_entry_id")
        if not owner_entry_id or owner_entry_id == entry_id:
            domain_data["_light_groups_entry_id"] = entry_id

            existing_entities: dict[str, CompanionGroupLight] = {}

            @callback
            def sync_group_lights(event=None):
                groups = store.get_groups() or {}
                new_entities = []
                active_light_ids: set[str] = set()
                for group_id, g_cfg in groups.items():
                    if not isinstance(g_cfg, dict):
                        continue
                    cat = g_cfg.get("category") or "leuchte"
                    if cat in ("leuchte", "light"):
                        active_light_ids.add(group_id)
                        if group_id not in existing_entities:
                            entity = CompanionGroupLight(hass, store, group_id)
                            existing_entities[group_id] = entity
                            new_entities.append(entity)
                        else:
                            existing_entities[group_id].async_refresh_group()
                for stale_id in [gid for gid in existing_entities if gid not in active_light_ids]:
                    stale_ent = existing_entities.pop(stale_id)
                    if stale_ent._unsub_tracker:
                        stale_ent._unsub_tracker()
                        stale_ent._unsub_tracker = None
                    if stale_ent._added and stale_ent.hass and stale_ent.platform is not None:
                        hass.async_create_task(stale_ent.async_remove())
                if new_entities:
                    async_add_entities(new_entities)

            sync_group_lights()
            entry.async_on_unload(
                hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_lights)
            )
            _listen_start = getattr(hass.bus, "async_listen_once", None)
            if callable(_listen_start):
                entry.async_on_unload(
                    _listen_start(EVENT_HOMEASSISTANT_STARTED, lambda _e: sync_group_lights())
                )

            @callback
            def _cleanup_owner():
                if domain_data.get("_light_groups_entry_id") == entry_id:
                    domain_data.pop("_light_groups_entry_id", None)
                for ent in existing_entities.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_owner)

    hybrid_mgr = domain_data.get("hybrid_manager")
    if module in ("hybrids", "legacy") and hybrid_mgr:
        h_owner = domain_data.get("_hybrid_lights_entry_id")
        if not h_owner or h_owner == entry_id:
            domain_data["_hybrid_lights_entry_id"] = entry_id
            existing_hybrids: dict[tuple[str, str], HybridLight] = {}

            @callback
            def sync_hybrid_lights(event=None):
                hybrids = store.get_hybrids() or {}
                new_ents = []
                active_keys: set[tuple[str, str]] = set()
                for hid, h_cfg in hybrids.items():
                    if not isinstance(h_cfg, dict):
                        continue
                    for ch in h_cfg.get("channels") or []:
                        if not isinstance(ch, dict) or ch.get("domain") != "light":
                            continue
                        key = (hid, ch.get("channel_key", "main"))
                        active_keys.add(key)
                        if key not in existing_hybrids:
                            ent = HybridLight(hass, store, hybrid_mgr, hid, ch)
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

            sync_hybrid_lights()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_lights))

            @callback
            def _cleanup_hl():
                if domain_data.get("_hybrid_lights_entry_id") == entry_id:
                    domain_data.pop("_hybrid_lights_entry_id", None)
                for ent in existing_hybrids.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_hl)


class CompanionGroupLight(LightEntity):
    """Native Home Assistant Light Entity representing a SmartHome Companion Light Group."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._unsub_tracker = None
        self._added = False
        self._update_attrs()

    def _update_attrs(self) -> None:
        g = self._store.get_groups().get(self._group_id, {})
        self._name = g.get("name") or "Lichtgruppe"
        self._area_id = g.get("area_id")
        # ADR-0007 Entity Naming: Primary entity of device must have _attr_name = None
        # so HA names the entity after device in area without suffix duplication!
        self._attr_name = None
        self._attr_unique_id = f"smarthome_companion_group_light_{self._group_id}"
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)
        self._attr_supported_color_modes = {ColorMode.BRIGHTNESS}
        self._attr_color_mode = ColorMode.BRIGHTNESS

    @callback
    def async_refresh_group(self) -> None:
        if not self.hass:
            return
        self._update_attrs()
        self._update_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _get_child_entities(self) -> list[str]:
        return resolve_group_child_entities(self.hass, self._store, self._group_id, domains=("light", "switch"))

    @property
    def is_on(self) -> bool:
        eids = self._get_child_entities()
        for eid in eids:
            st = self.hass.states.get(eid)
            if st and st.state == "on":
                return True
        return False

    @property
    def brightness(self) -> int | None:
        eids = self._get_child_entities()
        brs = []
        for eid in eids:
            st = self.hass.states.get(eid)
            if st and st.state == "on":
                br = st.attributes.get(ATTR_BRIGHTNESS)
                if isinstance(br, int):
                    brs.append(br)
        if not brs:
            return None
        return round(sum(brs) / len(brs))

    async def async_turn_on(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if not eids:
            return
        service_data = {}
        if ATTR_BRIGHTNESS in kwargs:
            service_data[ATTR_BRIGHTNESS] = kwargs[ATTR_BRIGHTNESS]
        if ATTR_RGB_COLOR in kwargs:
            service_data[ATTR_RGB_COLOR] = kwargs[ATTR_RGB_COLOR]
        if ATTR_COLOR_TEMP_KELVIN in kwargs:
            service_data[ATTR_COLOR_TEMP_KELVIN] = kwargs[ATTR_COLOR_TEMP_KELVIN]
        if ATTR_TRANSITION in kwargs:
            service_data[ATTR_TRANSITION] = kwargs[ATTR_TRANSITION]

        light_eids = [eid for eid in eids if eid.startswith("light.")]
        switch_eids = [eid for eid in eids if eid.startswith("switch.")]
        other_eids = [eid for eid in eids if not eid.startswith(("light.", "switch."))]

        calls = []
        if light_eids:
            calls.append(
                self.hass.services.async_call(
                    "light", "turn_on", {"entity_id": light_eids, **service_data}, blocking=False
                )
            )
        if switch_eids:
            calls.append(
                self.hass.services.async_call(
                    "switch", "turn_on", {"entity_id": switch_eids}, blocking=False
                )
            )
        if other_eids:
            calls.append(
                self.hass.services.async_call(
                    "homeassistant", "turn_on", {"entity_id": other_eids}, blocking=False
                )
            )
        if calls:
            await asyncio.gather(*calls)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if not eids:
            return
        by_domain: dict[str, list[str]] = {}
        for eid in eids:
            dom = eid.split(".")[0]
            by_domain.setdefault(dom, []).append(eid)

        calls = []
        for dom, dom_eids in by_domain.items():
            payload = {"entity_id": dom_eids}
            if dom == "light" and ATTR_TRANSITION in kwargs:
                payload[ATTR_TRANSITION] = kwargs[ATTR_TRANSITION]
            calls.append(self.hass.services.async_call(dom, "turn_off", payload, blocking=False))
        if calls:
            await asyncio.gather(*calls)
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._update_tracking()
        # Self-healing: clean up duplicated suffixes like light.julian_licht_licht or
        # light.julian_lampen_rechts_lampen_rechts -> light.julian_lampen_rechts.
        cleanup_duplicated_group_entity_id(self.hass, self.entity_id)

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if not self._added or not self.hass:
            return
        eids = self._get_child_entities()
        if eids:
            @callback
            def _state_changed(event):
                if self._added and self.hass and self.entity_id and self.platform is not None:
                    self.async_write_ha_state()

            self._unsub_tracker = async_track_state_change_event(self.hass, eids, _state_changed)

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None


class HybridLight(LightEntity):
    """Master Light entity routing commands strictly to preferred transport with failover."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, channel_spec: dict) -> None:
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
        self._cached_attrs: dict = {}
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
        self._attr_name = None if len(channels) <= 1 else f"Kanal {self._channel_key}"
        self._attr_unique_id = self._ch.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_{self._channel_key}"
        self._attr_icon = h_cfg.get("icon") or None
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if self._ch.get("master_entity_id"):
            self.entity_id = self._ch["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, ch_spec: dict) -> None:
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
    def is_on(self) -> bool | None:
        if self._cached_state is None:
            return None
        return self._cached_state == "on"

    @property
    def brightness(self) -> int | None:
        br = self._cached_attrs.get(ATTR_BRIGHTNESS)
        return int(br) if isinstance(br, (int, float)) else None

    @property
    def color_temp_kelvin(self) -> int | None:
        k = self._cached_attrs.get(ATTR_COLOR_TEMP_KELVIN)
        return int(k) if isinstance(k, (int, float)) else None

    @property
    def rgb_color(self) -> tuple[int, int, int] | None:
        rgb = self._cached_attrs.get(ATTR_RGB_COLOR)
        if isinstance(rgb, (list, tuple)) and len(rgb) == 3:
            return (int(rgb[0]), int(rgb[1]), int(rgb[2]))
        return None

    @property
    def hs_color(self) -> tuple[float, float] | None:
        hs = self._cached_attrs.get("hs_color")
        if isinstance(hs, (list, tuple)) and len(hs) == 2:
            return (float(hs[0]), float(hs[1]))
        return None

    @property
    def supported_color_modes(self) -> set[ColorMode]:
        raw = self._cached_attrs.get("supported_color_modes") or []
        modes = set()
        for m in raw:
            try:
                modes.add(ColorMode(m))
            except ValueError:
                pass
        return modes or {ColorMode.ONOFF}

    @property
    def color_mode(self) -> ColorMode | None:
        cm = self._cached_attrs.get("color_mode")
        if cm:
            try:
                return ColorMode(cm)
            except ValueError:
                pass
        modes = self.supported_color_modes
        if ColorMode.BRIGHTNESS in modes:
            return ColorMode.BRIGHTNESS
        return next(iter(modes), ColorMode.ONOFF)

    @property
    def extra_state_attributes(self) -> dict:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    def _refresh_cb(self) -> None:
        self._sync_from_active()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        await self._ctrl.async_dispatch_command(
            "light",
            "turn_on",
            dict(kwargs),
            self._ch.get("sources") or {},
            on_state_refresh=self._refresh_cb,
        )
        self._refresh_cb()

    async def async_turn_off(self, **kwargs) -> None:
        await self._ctrl.async_dispatch_command(
            "light",
            "turn_off",
            dict(kwargs),
            self._ch.get("sources") or {},
            on_state_refresh=self._refresh_cb,
        )
        self._refresh_cb()

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
