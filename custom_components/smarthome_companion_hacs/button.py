import logging
from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    if not store or not blinds_manager:
        return

    added_blind_entities = set()

    def add_blind_buttons(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if entity_id not in added_blind_entities:
                new_entities.append(BlindWatchdogButton(hass, store, blinds_manager, entity_id))
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial registration
    add_blind_buttons()

    # Dynamic registration
    entry.async_on_unload(
        hass.bus.async_listen(
            "smarthome_companion_blinds_updated", add_blind_buttons
        )
    )


class BlindWatchdogButton(ButtonEntity):
    def __init__(self, hass, store, blinds_manager, blind_id):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._attr_name = "Watchdog ausführen"
        self._attr_unique_id = f"smarthome_companion_button_watchdog_{blind_id}"
        self._attr_icon = "mdi:shield-search"

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
            return state.attributes["friendly_name"]
        return entity_id.split(".")[-1].replace("_", " ")

    async def async_press(self) -> None:
        """Handle button press to execute watchdog on this specific blind."""
        _LOGGER.info("Executing manual target watchdog check for cover: %s", self._blind_id)
        blinds = self.store.get_blinds()
        config = blinds.get(self._blind_id)
        if config:
            await self.blinds_manager._evaluate_blind(
                self._blind_id, config, is_watchdog_check=True
            )
            # Instantly fire refresh event so that tracing logs or time sensors on other entities update
            self.hass.bus.async_fire("smarthome_companion_blinds_updated")
