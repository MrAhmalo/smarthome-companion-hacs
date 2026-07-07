import logging
# pyrefly: ignore [missing-import]
from homeassistant.components.number import NumberEntity
# pyrefly: ignore [missing-import]
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    
    module = entry.data.get("module", "legacy")

    if module in ("blinds", "legacy") and store and blinds_manager:
        # Add global watchdog interval setting and global blinds settings
        global_entities = [
            WatchdogIntervalNumber(hass, store, blinds_manager),
            BlindsPositionThresholdNumber(hass, store, blinds_manager),
        ]
        async_add_entities(global_entities)

    added_blind_entities = set()

    def _add_blind_numbers_sync(event=None):
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
                    _BlindBaseGenericNumber(hass, store, blinds_manager, entity_id, "sunrise_offset", "Öffnen - Sonnenaufgang: Offset", "smarthome_companion_number_sunrise_offset", "mdi:clock-fast", -120, 120, 1, "min", 0),
                    _BlindBaseGenericNumber(hass, store, blinds_manager, entity_id, "sunset_offset", "Schließen - Sonnenuntergang: Offset", "smarthome_companion_number_sunset_offset", "mdi:clock-fast", -120, 120, 1, "min", 0),
                    _BlindBaseGenericNumber(hass, store, blinds_manager, entity_id, "ventilation_position", "Lüftung: Position", "smarthome_companion_number_ventilation_position", "mdi:window-shutter-open", 0, 100, 1, "%", 59),
                    _BlindBaseGenericNumber(hass, store, blinds_manager, entity_id, "shading_position", "Beschattung: Position", "smarthome_companion_number_shading_position", "mdi:window-shutter", 0, 100, 1, "%", 30),
                ])
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    async def add_blind_numbers(event=None):
        _add_blind_numbers_sync(event)

    if module in ("blinds", "legacy"):
        # Initial register
        _add_blind_numbers_sync()

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
        self._attr_mode = "box"

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


class BlindsPositionThresholdNumber(NumberEntity):
    def __init__(self, hass, store, blinds_manager):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._attr_name = "SmartHome Companion Positions-Schwellenwert"
        self._attr_unique_id = "smarthome_companion_number_position_threshold"
        self._attr_icon = "mdi:angle-acute"
        self._attr_native_min_value = 0
        self._attr_native_max_value = 25
        self._attr_native_step = 1
        self._attr_native_unit_of_measurement = "%"
        self._attr_mode = "box"

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
        return int(settings.get("position_threshold", 5))

    async def async_set_native_value(self, value: float) -> None:
        """Update settings with new value."""
        _LOGGER.info("Updating blinds position threshold to %s percent", int(value))
        
        # Ensure 'settings' exists
        if "settings" not in self.store.data:
            self.store.data["settings"] = {}
        
        self.store.data["settings"]["position_threshold"] = int(value)
        await self.store.async_save(self.store.data)
        
        # Reload blinds manager
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
        self._attr_name = "Verzögerung: Maximale Dauer vorher"
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
        self._attr_name = "Verzögerung: Maximale Dauer nachher"
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


class _BlindBaseGenericNumber(NumberEntity):
    def __init__(self, hass, store, blinds_manager, blind_id, key, name, unique_id_prefix, icon, min_val, max_val, step, unit, default_value, mode="box"):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{unique_id_prefix}_{blind_id}"
        self._attr_icon = icon
        self._attr_native_min_value = min_val
        self._attr_native_max_value = max_val
        self._attr_native_step = step
        self._attr_native_unit_of_measurement = unit
        self._attr_mode = mode
        self._default_value = default_value

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
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return self._default_value
        try:
            val = config.get(self._key, self._default_value)
            if val is None or val == "":
                return self._default_value
            return float(val)
        except (ValueError, TypeError):
            return self._default_value

    async def async_set_native_value(self, value: float) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            # save as int if the default is int
            if isinstance(self._default_value, int):
                blinds[self._blind_id][self._key] = int(value)
            else:
                blinds[self._blind_id][self._key] = float(value)
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


