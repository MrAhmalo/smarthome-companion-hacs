import logging

from homeassistant.components.sensor import SensorEntity

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    sun_manager = hass.data[DOMAIN].get("sun_manager")
    store = hass.data[DOMAIN].get("store")
    if not sun_manager:
        return

    entities = [
        FassadeSunSensor(sun_manager, "nord", "Nord"),
        FassadeSunSensor(sun_manager, "ost", "Ost"),
        FassadeSunSensor(sun_manager, "sued", "Süd"),
        FassadeSunSensor(sun_manager, "west", "West"),
    ]
    if store:
        entities.extend(
            [
                ConfiguredBlindsSensor(hass, store),
                UnconfiguredBlindsSensor(hass, store),
            ]
        )

    async_add_entities(entities)


class _BaseBlindsSensor(SensorEntity):
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store

    def _configured_blinds(self):
        blinds = self.store.get_blinds()
        return {
            entity_id: config
            for entity_id, config in blinds.items()
            if entity_id.startswith("cover.")
        }

    def _all_cover_entities(self):
        return {state.entity_id for state in self.hass.states.async_all("cover")}

    def _cover_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            return state.attributes["friendly_name"]
        return entity_id.split(".")[-1].replace("_", " ")

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()


class ConfiguredBlindsSensor(_BaseBlindsSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion eingerichtete Rollläden"
        self._attr_unique_id = "smarthome_companion_configured_blinds"
        self._attr_icon = "mdi:window-shutter-cog"

    @property
    def native_value(self):
        return len(self._configured_blinds())

    @property
    def extra_state_attributes(self):
        blinds = self._configured_blinds()
        return {
            "configured_count": len(blinds),
            "configured_blinds": [
                {
                    "entity_id": entity_id,
                    "name": self._cover_label(entity_id),
                    "enable_shading": bool(config.get("enable_shading", False)),
                    "window_azimuth": config.get("window_azimuth"),
                    "use_sunrise": bool(config.get("use_sunrise", False)),
                    "use_sunset": bool(config.get("use_sunset", False)),
                }
                for entity_id, config in sorted(blinds.items())
            ],
        }


class UnconfiguredBlindsSensor(_BaseBlindsSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion nicht eingerichtete Rollläden"
        self._attr_unique_id = "smarthome_companion_unconfigured_blinds"
        self._attr_icon = "mdi:window-shutter-alert"

    @property
    def native_value(self):
        configured = set(self._configured_blinds().keys())
        return len(self._all_cover_entities() - configured)

    @property
    def extra_state_attributes(self):
        configured = set(self._configured_blinds().keys())
        all_covers = sorted(self._all_cover_entities())
        unconfigured = [entity_id for entity_id in all_covers if entity_id not in configured]
        return {
            "unconfigured_count": len(unconfigured),
            "total_cover_entities": len(all_covers),
            "unconfigured_blinds": [
                {
                    "entity_id": entity_id,
                    "name": self._cover_label(entity_id),
                }
                for entity_id in unconfigured
            ],
        }


class FassadeSunSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:weather-sunny"

    @property
    def native_value(self):
        return round(self.sun_manager.intensities.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()