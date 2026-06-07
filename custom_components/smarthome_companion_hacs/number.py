import logging
from homeassistant.components.number import NumberEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    if not store or not blinds_manager:
        return

    # Add global watchdog interval setting
    async_add_entities([WatchdogIntervalNumber(hass, store, blinds_manager)])

    added_blind_entities = set()

    def add_blind_numbers(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.extend([
                    BlindRandomDelayPrevNumber(hass, store, blinds_manager, entity_id),
                    BlindRandomDelayPostNumber(hass, store, blinds_manager, entity_id),
                ])
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    add_blind_numbers()

    # Dynamic registration
    entry.async_on_unload(
        hass.bus.async_listen(
            "smarthome_companion_blinds_updated", add_blind_numbers
        )
    )


class WatchdogIntervalNumber(NumberEntity):
    def __init__(self, hass, store, blinds_manager):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._attr_name = "SmartHome Companion Watchdog Intervall"
        self._attr_unique_id = "smarthome_companion_number_watchdog_interval"
        self._attr_icon = "mdi:clock-fast"
        self._attr_native_min_value = 1
        self._attr_native_max_value = 60
        self._attr_native_step = 1
        self._attr_native_unit_of_measurement = "min"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "hub")},
            name="SmartHome Companion",
            manufacturer="SmartHome Companion",
            model="Hub & Einstellungen",
        )

    @property
    def native_value(self):
        settings = self.store.data.get("settings", {})
        return int(settings.get("watchdog_interval", 15))

    async def async_set_native_value(self, value: float) -> None:
        """Update settings with new value."""
        _LOGGER.info("Updating watchdog interval to %s minutes", int(value))
        
        # Ensure 'settings' exists
        if "settings" not in self.store.data:
            self.store.data["settings"] = {}
        
        self.store.data["settings"]["watchdog_interval"] = int(value)
        await self.store.async_save(self.store.data)
        
        # Reload schedulers
        await self.blinds_manager.async_reload()

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()


class _BlindBaseNumber(NumberEntity):
    def __init__(self, hass, store, blinds_manager, blind_id):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id

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

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()


class BlindRandomDelayPrevNumber(_BlindBaseNumber):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id)
        self._attr_name = "Zufällige Verzögerung vorher"
        self._attr_unique_id = f"smarthome_companion_number_random_delay_prev_{blind_id}"
        self._attr_icon = "mdi:minus"
        self._attr_native_min_value = 0
        self._attr_native_max_value = 120
        self._attr_native_step = 1
        self._attr_native_unit_of_measurement = "min"
        self._attr_mode = "box"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return 10
        return int(config.get("random_delay_prev", 10))

    async def async_set_native_value(self, value: float) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["random_delay_prev"] = int(value)
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()


class BlindRandomDelayPostNumber(_BlindBaseNumber):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id)
        self._attr_name = "Zufällige Verzögerung nachher"
        self._attr_unique_id = f"smarthome_companion_number_random_delay_post_{blind_id}"
        self._attr_icon = "mdi:plus"
        self._attr_native_min_value = 0
        self._attr_native_max_value = 120
        self._attr_native_step = 1
        self._attr_native_unit_of_measurement = "min"
        self._attr_mode = "box"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return 10
        return int(config.get("random_delay_post", 10))

    async def async_set_native_value(self, value: float) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["random_delay_post"] = int(value)
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()
