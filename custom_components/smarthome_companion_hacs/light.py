import logging
import re
# pyrefly: ignore [missing-import]
from homeassistant.components.light import (
    LightEntity,
    ColorMode,
    ATTR_BRIGHTNESS,
    ATTR_RGB_COLOR,
    ATTR_COLOR_TEMP_KELVIN,
)
# pyrefly: ignore [missing-import]
from homeassistant.helpers.entity import DeviceInfo
# pyrefly: ignore [missing-import]
from homeassistant.helpers import entity_registry as er, device_registry as dr
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event
# pyrefly: ignore [missing-import]
from homeassistant.core import callback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    if not store:
        return

    added_group_ids = set()

    @callback
    def sync_group_lights(event=None):
        groups = store.get_groups()
        new_entities = []
        for group_id, g_cfg in groups.items():
            cat = g_cfg.get("category") or "leuchte"
            if cat in ("leuchte", "light") and group_id not in added_group_ids:
                new_entities.append(CompanionGroupLight(hass, store, group_id))
                added_group_ids.add(group_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    sync_group_lights()

    # Dynamic registration when groups are saved/updated
    entry.async_on_unload(
        hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_lights)
    )


class CompanionGroupLight(LightEntity):
    """Native Home Assistant Light Entity representing a SmartHome Companion Light Group."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._unsub_tracker = None
        self._update_attrs()

    def _update_attrs(self) -> None:
        g = self._store.get_groups().get(self._group_id, {})
        self._name = g.get("name") or "Lichtgruppe"
        self._area_id = g.get("area_id")
        self._attr_name = self._name
        self._attr_unique_id = f"smarthome_companion_group_light_{self._group_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"group_{self._group_id}")},
            name=self._name,
            manufacturer="SmartHome Companion",
            model="Lichtgruppe (Companion)",
            suggested_area=self._area_id,
        )
        self._attr_supported_color_modes = {ColorMode.BRIGHTNESS, ColorMode.ONOFF}
        self._attr_color_mode = ColorMode.BRIGHTNESS

    def _get_child_entities(self) -> list[str]:
        groups = self._store.get_groups()
        g = groups.get(self._group_id, {})
        ent_reg = er.async_get(self.hass)
        dev_reg = dr.async_get(self.hass)

        eids = []
        visited = {self._group_id}

        def resolve(children):
            for ref in children:
                if ref in groups and ref not in visited:
                    visited.add(ref)
                    resolve(groups[ref].get("children", []))
                elif ref.startswith("d:"):
                    parts = ref.split(":", 2)
                    if len(parts) >= 3 and self.hass.states.get(parts[2]):
                        eids.append(parts[2])
                elif self.hass.states.get(ref):
                    eids.append(ref)
                elif dev_reg.async_get(ref):
                    dev_ents = [
                        e.entity_id for e in ent_reg.entities.values()
                        if e.device_id == ref and not e.disabled_by
                        and e.domain in ("light", "switch")
                    ]
                    eids.extend(dev_ents)

        resolve(g.get("children", []))
        return list(dict.fromkeys(eids))

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

        for eid in eids:
            domain = eid.split(".")[0]
            if domain == "light":
                await self.hass.services.async_call("light", "turn_on", {"entity_id": eid, **service_data}, blocking=False)
            elif domain == "switch":
                await self.hass.services.async_call("switch", "turn_on", {"entity_id": eid}, blocking=False)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        eids = self._get_child_entities()
        for eid in eids:
            domain = eid.split(".")[0]
            await self.hass.services.async_call(domain, "turn_off", {"entity_id": eid}, blocking=False)
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self._update_tracking()

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        eids = self._get_child_entities()
        if eids:
            @callback
            def _state_changed(event):
                self.async_write_ha_state()

            self._unsub_tracker = async_track_state_change_event(self.hass, eids, _state_changed)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
