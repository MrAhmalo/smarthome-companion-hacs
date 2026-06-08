import logging
import re
from homeassistant.components.text import TextEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    if not store or not blinds_manager:
        return

    # Global text settings for temperature and cloud/sun detection
    async_add_entities([
        HubTextSetting(
            hass, store, blinds_manager,
            key="temp_sensor",
            name="Sonnenerkennung Temperatursensor",
            unique_id="smarthome_companion_text_temp_sensor",
            icon="mdi:thermometer",
            default_value="weather.forecast_home"
        ),
        HubTextSetting(
            hass, store, blinds_manager,
            key="cloud_sensor",
            name="Sonnenerkennung Bewölkungssensor",
            unique_id="smarthome_companion_text_cloud_sensor",
            icon="mdi:weather-partly-cloudy",
            default_value="weather.forecast_home"
        ),
    ])

    added_blind_entities = set()

    def add_blind_texts(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.extend([
                    BlindTimeText(hass, store, blinds_manager, entity_id, "fixed_open_time", "Feste Öffnungszeit", "smarthome_companion_text_fixed_open_time", "mdi:clock-outline", "07:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "fixed_close_time", "Feste Schließzeit", "smarthome_companion_text_fixed_close_time", "mdi:clock-outline", "22:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "earliest_open_time", "Früheste Öffnungszeit", "smarthome_companion_text_earliest_open_time", "mdi:clock-start", "06:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "latest_open_time", "Späteste Öffnungszeit", "smarthome_companion_text_latest_open_time", "mdi:clock-end", "09:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "earliest_close_time", "Früheste Schließzeit", "smarthome_companion_text_earliest_close_time", "mdi:clock-start", "18:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "latest_close_time", "Späteste Schließzeit", "smarthome_companion_text_latest_close_time", "mdi:clock-end", "23:00"),
                    BlindTimeText(hass, store, blinds_manager, entity_id, "ventilation_until", "Lüftung bis Uhrzeit", "smarthome_companion_text_ventilation_until", "mdi:clock-end", "10:00"),
                ])
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    add_blind_texts()

    # Dynamic registration
    entry.async_on_unload(
        hass.bus.async_listen(
            "smarthome_companion_blinds_updated", add_blind_texts
        )
    )


class BlindTimeText(TextEntity):
    def __init__(self, hass, store, blinds_manager, blind_id, key, name, unique_id_prefix, icon, default_value):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{unique_id_prefix}_{blind_id}"
        self._attr_icon = icon
        self._default_value = default_value
        self._attr_native_min = 5
        self._attr_native_max = 5
        # Enforce HH:MM pattern
        self._attr_pattern = r"^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$"

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
        val = config.get(self._key, self._default_value)
        if val is None or val == "":
            return self._default_value
        return str(val)

    async def async_set_value(self, value: str) -> None:
        """Set the text value."""
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            # Validate format HH:MM
            if re.match(r"^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$", value):
                blinds[self._blind_id][self._key] = value
                await self.store.async_save(self.store.data)
                await self.blinds_manager.async_reload()
            else:
                _LOGGER.warning("Invalid time format submitted: %s (Must be HH:MM)", value)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()


class HubTextSetting(TextEntity):
    def __init__(self, hass, store, blinds_manager, key, name, unique_id, icon, default_value):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._key = key
        self._attr_name = name
        self._attr_unique_id = unique_id
        self._attr_icon = icon
        self._default_value = default_value

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
        val = settings.get(self._key, self._default_value)
        if val is None or val == "":
            return self._default_value
        return str(val)

    async def async_set_value(self, value: str) -> None:
        """Set the text value."""
        if "settings" not in self.store.data:
            self.store.data["settings"] = {}
        self.store.data["settings"][self._key] = value
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
