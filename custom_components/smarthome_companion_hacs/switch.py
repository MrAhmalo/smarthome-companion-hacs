import logging
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    if not store or not blinds_manager:
        return

    added_blind_entities = set()

    def add_blind_switches(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.append(BlindRandomDelaySwitch(hass, store, blinds_manager, entity_id))
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    add_blind_switches()

    # Dynamic registration
    entry.async_on_unload(
        hass.bus.async_listen(
            "smarthome_companion_blinds_updated", add_blind_switches
        )
    )


class BlindRandomDelaySwitch(SwitchEntity):
    def __init__(self, hass, store, blinds_manager, blind_id):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._attr_name = "Zufällige Verzögerung"
        self._attr_unique_id = f"smarthome_companion_switch_random_delay_{blind_id}"
        self._attr_icon = "mdi:shuffle-variant"

    @property
    def available(self):
        return self._blind_id in self.store.get_blinds()

    @property
    def device_info(self) -> DeviceInfo:
        cover_name = self._cover_label(self._blind_id)
        return DeviceInfo(
            identifiers={(DOMAIN, self._blind_id)},
            name=cover_name,
            manufacturer="SmartHome Companion",
            model="Rollladen-Automat",
        )

    def _cover_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = entity_id.split(".")[-1].replace("_", " ").title()
        return name.replace("Eg", "EG").replace("Og", "OG").replace("Hacs", "HACS")

    @property
    def is_on(self) -> bool:
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return True
        val = config.get("enable_random_delay", True)
        return True if val is None else bool(val)

    async def async_turn_on(self, **kwargs) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["enable_random_delay"] = True
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()

    async def async_turn_off(self, **kwargs) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["enable_random_delay"] = False
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()
