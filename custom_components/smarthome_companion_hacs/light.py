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
from homeassistant.helpers import entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event
# pyrefly: ignore [missing-import]
from homeassistant.core import callback

from .const import DOMAIN
from .device_helpers import (
    build_group_device_info,
    cleanup_duplicated_group_entity_id,
    resolve_group_child_entities,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store:
        return

    module = (getattr(entry, "data", None) or {}).get("module", "legacy")
    if module not in ("groups", "legacy"):
        return

    entry_id = getattr(entry, "entry_id", "default")
    domain_data = hass.data.setdefault(DOMAIN, {})
    owner_entry_id = domain_data.get("_light_groups_entry_id")
    if owner_entry_id and owner_entry_id != entry_id:
        return
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
        # Clean up deleted or recategorized groups so stale entities don't throw on refresh
        for stale_id in [gid for gid in existing_entities if gid not in active_light_ids]:
            stale_ent = existing_entities.pop(stale_id)
            if stale_ent._unsub_tracker:
                stale_ent._unsub_tracker()
                stale_ent._unsub_tracker = None
            if stale_ent._added and stale_ent.hass and stale_ent.platform is not None:
                hass.async_create_task(stale_ent.async_remove())
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    sync_group_lights()

    # Dynamic registration when groups are saved/updated
    entry.async_on_unload(
        hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_lights)
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
