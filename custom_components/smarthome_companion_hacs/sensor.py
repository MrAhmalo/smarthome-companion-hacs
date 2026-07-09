import logging
import os
import json
from datetime import timedelta, time, datetime
# pyrefly: ignore [missing-import]
import homeassistant.util.dt as dt_util

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class IntegrationInfoSensor(SensorEntity):
    def __init__(self, hass):
        self.hass = hass
        self._attr_name = "SmartHome Companion"
        self._attr_unique_id = "smarthome_companion_integration_info"
        self._attr_icon = "mdi:home-assistant"
        
        self._version = "Unbekannt"
        try:
            manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
                self._version = manifest.get("version", "Unbekannt")
        except Exception as e:
            _LOGGER.error(f"Fehler beim Lesen der manifest.json: {e}")

    @property
    def native_value(self):
        return self._version

    @property
    def extra_state_attributes(self):
        return {
            "integration": "SmartHome Companion HACS Backend",
            "author": "Julian & Antigravity"
        }

async def async_setup_entry(hass, entry, async_add_entities):
    sun_manager = hass.data[DOMAIN].get("sun_manager")
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    irrigation_manager = hass.data[DOMAIN].get("irrigation_manager")
    
    module = entry.data.get("module", "legacy")

    entities = [IntegrationInfoSensor(hass)]
    if module in ("blinds", "legacy") and sun_manager:
        entities.extend([
            FassadeSunSensor(sun_manager, "nord", "Nord"),
            FassadeSunSensor(sun_manager, "ost", "Ost"),
            FassadeSunSensor(sun_manager, "sued", "Süd"),
            FassadeSunSensor(sun_manager, "west", "West"),
            FassadeSunForecastSensor(sun_manager, "nord", "Nord"),
            FassadeSunForecastSensor(sun_manager, "ost", "Ost"),
            FassadeSunForecastSensor(sun_manager, "sued", "Süd"),
            FassadeSunForecastSensor(sun_manager, "west", "West"),
            FassadeSunForecastTomorrowSensor(sun_manager, "nord", "Nord"),
            FassadeSunForecastTomorrowSensor(sun_manager, "ost", "Ost"),
            FassadeSunForecastTomorrowSensor(sun_manager, "sued", "Süd"),
            FassadeSunForecastTomorrowSensor(sun_manager, "west", "West"),
            GlobalShadingNeededSensor(sun_manager),
            GlobalShadingNeededTomorrowSensor(sun_manager),
        ])
        if store:
            entities.extend([
                ConfiguredBlindsSensor(hass, store),
                UnconfiguredBlindsSensor(hass, store),
            ])
            
    if module in ("irrigation", "legacy") and store:
        entities.extend([
            ConfiguredIrrigationSensor(hass, store),
            UnconfiguredIrrigationSensor(hass, store),
            IrrigationMaxManualRuntimeSensor(hass, store),
            IrrigationSimultaneousModeSensor(hass, store),
        ])

    if entities:
        async_add_entities(entities)

    # Track dynamically added blind unique IDs
    added_blind_entities = set()

    def _add_blind_sensors_sync(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.extend(
                    [
                        BlindOpenTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindCloseTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindSunriseOpenTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindSunsetCloseTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindNextActionSensor(hass, store, blinds_manager, entity_id),
                        BlindShadingPredictionTodaySensor(hass, store, blinds_manager, entity_id),
                        BlindShadingPredictionTomorrowSensor(hass, store, blinds_manager, entity_id),
                    ]
                )
                added_blind_entities.add(entity_id)

        if new_entities:
            async_add_entities(new_entities)

    async def add_blind_sensors(event=None):
        _add_blind_sensors_sync(event)

    if module in ("blinds", "legacy"):
        # Initial register
        _add_blind_sensors_sync()

        # Dynamic registration upon config reloads/updates
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_blinds_updated", add_blind_sensors
            )
        )

    added_irrigation_entities = set()

    def _add_irrigation_sensors_sync(event=None):
        if not store or not irrigation_manager:
            return
        irrigation_data = store.get_irrigation()
        if not irrigation_data:
            return
        zones = irrigation_data.get("zones", [])
        new_entities = []
        for zone in zones:
            zone_id = zone.get("id")
            if not zone_id:
                continue
                
            base_sensors = [
                ("last_watered", IrrigationZoneLastWateredSensor),
                ("next_planned", IrrigationZoneNextRunSensor),
                ("status", IrrigationZoneStatusSensor),
                ("duration", IrrigationZoneDurationSensor),
                ("progress", IrrigationZoneProgressSensor),
            ]
            
            for sensor_key, sensor_class in base_sensors:
                unique_id = f"{zone_id}_{sensor_key}"
                if unique_id not in added_irrigation_entities:
                    new_entities.append(sensor_class(hass, store, irrigation_manager, zone_id))
                    added_irrigation_entities.add(unique_id)
                    
            if zone.get("soil_sensor_entity_id"):
                unique_id = f"{zone_id}_target_moisture"
                if unique_id not in added_irrigation_entities:
                    new_entities.append(IrrigationZoneTargetMoistureSensor(hass, store, irrigation_manager, zone_id))
                    added_irrigation_entities.add(unique_id)

        if new_entities:
            async_add_entities(new_entities)

    async def update_irrigation_sensors(event=None):
        _add_irrigation_sensors_sync()
        for entity in entities:
            if isinstance(entity, (ConfiguredIrrigationSensor, UnconfiguredIrrigationSensor, IrrigationMaxManualRuntimeSensor, IrrigationSimultaneousModeSensor)):
                entity.async_write_ha_state()

    if module in ("irrigation", "legacy"):
        _add_irrigation_sensors_sync()
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", update_irrigation_sensors
            )
        )


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


class ConfiguredBlindsSensor(_BaseBlindsSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion eingerichtete Rollläden"
        self._attr_unique_id = "smarthome_companion_configured_blinds"
        self._attr_icon = "mdi:window-shutter-cog"

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
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "hub")},
            name="SmartHome Companion",
            manufacturer="SmartHome Companion",
            model="Hub & Einstellungen",
        )

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


class _BaseIrrigationSensor(SensorEntity):
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store

    def _get_zones(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return []
        return irrigation_data.get("zones", [])

    def _all_valve_entities(self):
        return {state.entity_id for state in self.hass.states.async_all("valve")}

    def _valve_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = entity_id.split(".")[-1].replace("_", " ").title()
        return name

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()


class ConfiguredIrrigationSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion eingerichtete Bewässerungszonen"
        self._attr_unique_id = "smarthome_companion_configured_irrigation_zones"
        self._attr_icon = "mdi:sprinkler-variant"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerungssystem",
        )

    @property
    def native_value(self):
        return len(self._get_zones())

    @property
    def extra_state_attributes(self):
        zones = self._get_zones()
        return {
            "configured_count": len(zones),
            "configured_zones": [
                {
                    "id": zone.get("id"),
                    "name": zone.get("name"),
                    "valve": zone.get("valve_entity_id"),
                }
                for zone in zones
            ],
        }


class UnconfiguredIrrigationSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion nicht eingerichtete Ventile"
        self._attr_unique_id = "smarthome_companion_unconfigured_irrigation_valves"
        self._attr_icon = "mdi:valve-closed"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerungssystem",
        )

    @property
    def native_value(self):
        zones = self._get_zones()
        configured_valves = {z.get("valve_entity_id") for z in zones if z.get("valve_entity_id")}
        return len(self._all_valve_entities() - configured_valves)

    @property
    def extra_state_attributes(self):
        zones = self._get_zones()
        configured_valves = {z.get("valve_entity_id") for z in zones if z.get("valve_entity_id")}
        all_valves = sorted(self._all_valve_entities())
        unconfigured = [entity_id for entity_id in all_valves if entity_id not in configured_valves]
        return {
            "unconfigured_count": len(unconfigured),
            "total_valve_entities": len(all_valves),
            "unconfigured_valves": [
                {
                    "entity_id": entity_id,
                    "name": self._valve_label(entity_id),
                }
                for entity_id in unconfigured
            ],
        }

class IrrigationMaxManualRuntimeSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Maximale manuelle Laufzeit"
        self._attr_unique_id = "smarthome_companion_irrigation_max_manual_runtime"
        self._attr_icon = "mdi:timer-sand"
        self._attr_native_unit_of_measurement = "min"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerungssystem",
        )

    @property
    def native_value(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return 60
        return irrigation_data.get("max_manual_runtime_minutes", 60)

class IrrigationSimultaneousModeSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Bewässerungsmodus (Gleichzeitig)"
        self._attr_unique_id = "smarthome_companion_irrigation_simultaneous_mode"
        self._attr_icon = "mdi:water-pump"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerungssystem",
        )

    @property
    def native_value(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return "Nacheinander"
        return "Gleichzeitig" if irrigation_data.get("simultaneous", False) else "Nacheinander"



class FassadeSunSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:weather-sunny"

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
        return round(self.sun_manager.intensities.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()

class FassadeSunForecastSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit (Max Heute)"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_forecast_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:sun-wireless"

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
        return round(self.sun_manager.forecast_max_intensities.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()

class GlobalShadingNeededSensor(SensorEntity):
    def __init__(self, sun_manager):
        self.sun_manager = sun_manager
        self._attr_name = "Beschattung heute erforderlich"
        self._attr_unique_id = "smarthome_companion_global_shading_needed"
        self._attr_icon = "mdi:shield-sun"

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
        return "Ja" if self.sun_manager.global_shading_needed else "Nein"

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()

class FassadeSunForecastTomorrowSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit (Max Morgen)"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_forecast_tomorrow_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:sun-wireless"

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
        return round(self.sun_manager.forecast_max_intensities_tomorrow.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()

class GlobalShadingNeededTomorrowSensor(SensorEntity):
    def __init__(self, sun_manager):
        self.sun_manager = sun_manager
        self._attr_name = "Beschattung morgen erforderlich"
        self._attr_unique_id = "smarthome_companion_global_shading_needed_tomorrow"
        self._attr_icon = "mdi:shield-sun"

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
        return "Ja" if self.sun_manager.global_shading_needed_tomorrow else "Nein"

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()

class _BlindBaseSensor(SensorEntity):
    def __init__(self, hass, store, blinds_manager, blind_id, sensor_type):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._sensor_type = sensor_type

    @property
    def extra_state_attributes(self):
        return {
            "blind_id": self._blind_id,
            "sensor_type": self._sensor_type,
        }

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
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )
        self.async_write_ha_state()

    async def _handle_update(self, event):
        self.async_write_ha_state()


class BlindOpenTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "open_time")
        self._attr_name = "Geplante Öffnungszeit"
        self._attr_unique_id = f"smarthome_companion_sensor_open_time_{blind_id}"
        self._attr_icon = "mdi:clock-start"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        open_time = times_today.get("open_time")
        if open_time and open_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            open_time = times_tomorrow.get("open_time")
        if open_time:
            return open_time.strftime("%H:%M")
        return None


class BlindCloseTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "close_time")
        self._attr_name = "Geplante Schließzeit"
        self._attr_unique_id = f"smarthome_companion_sensor_close_time_{blind_id}"
        self._attr_icon = "mdi:clock-end"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        close_time = times_today.get("close_time")
        if close_time and close_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            close_time = times_tomorrow.get("close_time")
        if close_time:
            return close_time.strftime("%H:%M")
        return None


class BlindSunriseOpenTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "sunrise_time")
        self._attr_name = "Sonnenaufgangs-Öffnungszeit"
        self._attr_unique_id = f"smarthome_companion_sensor_sunrise_open_time_{blind_id}"
        self._attr_icon = "mdi:weather-sunset-up"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_sunrise", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        sunrise_time = times_today.get("sunrise_time")
        if sunrise_time and sunrise_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            sunrise_time = times_tomorrow.get("sunrise_time")
        if sunrise_time:
            return sunrise_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindSunsetCloseTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "sunset_time")
        self._attr_name = "Sonnenuntergangs-Schließzeit"
        self._attr_unique_id = f"smarthome_companion_sensor_sunset_close_time_{blind_id}"
        self._attr_icon = "mdi:weather-sunset-down"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_sunset", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        sunset_time = times_today.get("sunset_time")
        if sunset_time and sunset_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            sunset_time = times_tomorrow.get("sunset_time")
        if sunset_time:
            return sunset_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindNextActionSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "next_action")
        self._attr_name = "Nächste Aktion(en)"
        self._attr_unique_id = f"smarthome_companion_sensor_next_action_{blind_id}"
        self._attr_icon = "mdi:clock-check-outline"

    def _get_events(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return []
            
        now = dt_util.now()
        events = []
        
        for day_offset in [0, 1]:
            d = now.date() + timedelta(days=day_offset)
            times = self.blinds_manager.calculate_times(self._blind_id, config, d)
            open_dt = times.get("open_time")
            close_dt = times.get("close_time")
            
            if open_dt:
                vent_until = self.blinds_manager._parse_time(config.get("ventilation_until"), time(10, 0))
                has_vent = config.get("enable_ventilation", False) and open_dt.time() <= vent_until
                
                plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {}) if day_offset == 0 else {}
                action = "Lüften" if has_vent else "Öffnen"
                
                if day_offset == 0 and plan.get("shading_active"):
                    s_time = dt_util.parse_datetime(plan.get("start_time"))
                    if s_time and s_time <= open_dt:
                        target_pos = plan.get("target_position", 0)
                        vent_pos = int(config.get("ventilation_position", 59))
                        if has_vent and vent_pos < target_pos:
                            action = "Lüften"
                        else:
                            action = "Beschattung"
                            
                events.append((open_dt, action))
                
            if close_dt:
                events.append((close_dt, "Schließen"))
                
            if day_offset == 0:
                plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
                if plan.get("shading_active"):
                    s_time = dt_util.parse_datetime(plan.get("start_time"))
                    e_time = dt_util.parse_datetime(plan.get("end_time"))
                    if s_time and s_time > open_dt:
                        events.append((s_time, "Beschattung"))
                    if e_time and e_time < close_dt:
                        events.append((e_time, "Öffnen"))
                        
        events.sort(key=lambda x: x[0])
        return events

    @property
    def native_value(self):
        events = self._get_events()
        now = dt_util.now()
        future_events = [f"{act} ({dt.strftime('%H:%M')})" for dt, act in events if dt > now]
        if not future_events:
            return "Keine Aktionen"
        return " ➔ ".join(future_events[:3])

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        events = self._get_events()
        now = dt_util.now()
        future = [e for e in events if e[0] > now]
        if not future:
            return attrs
        dt, act = future[0]
        attrs.update({
            "next_action": act,
            "next_time": dt.strftime("%H:%M"),
            "next_datetime": dt.isoformat(),
        })
        return attrs

class BlindShadingPredictionTodaySensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_today")
        self._attr_name = "Beschattungs-Prognose (Heute)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_today_{blind_id}"
        self._attr_icon = "mdi:shield-sun"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config or not config.get("enable_shading", False):
            return "Deaktiviert"
            
        plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
        if not plan:
            return "Wartet auf Planung..."
            
        if not plan.get("shading_active"):
            return "Inaktiv heute"
            
        pos = plan.get("target_position", 0)
        s_time_str = plan.get("start_time")
        e_time_str = plan.get("end_time")
        if s_time_str and e_time_str:
            s_dt = dt_util.parse_datetime(s_time_str)
            e_dt = dt_util.parse_datetime(e_time_str)
            if s_dt and e_dt:
                return f"Geplant: {pos}% ({s_dt.strftime('%H:%M')} - {e_dt.strftime('%H:%M')})"
        return f"Geplant: {pos}%"

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
        if not plan:
            return attrs
        
        attrs.update({
            "shading_active": plan.get("shading_active"),
            "target_position": plan.get("target_position"),
            "start_time": plan.get("start_time"),
            "end_time": plan.get("end_time"),
            "trigger_temp": plan.get("trigger_temp"),
            "forecast_max_temp": plan.get("today_max"),
            "forecast_peak_intensity": plan.get("max_intensity")
        })
        return attrs

class BlindShadingPredictionTomorrowSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_tomorrow")
        self._attr_name = "Beschattungs-Prognose (Morgen)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_tomorrow_{blind_id}"
        self._attr_icon = "mdi:shield-sun-outline"

    @property
    def native_value(self):
        return "Berechnung am Morgen"

    @property
    def extra_state_attributes(self):
        return super().extra_state_attributes

class _IrrigationZoneBaseSensor(SensorEntity):
    def __init__(self, hass, store, irrigation_manager, zone_id, sensor_type):
        self.hass = hass
        self.store = store
        self.irrigation_manager = irrigation_manager
        self._zone_id = zone_id
        self._sensor_type = sensor_type

    def _get_zone(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data: return None
        for z in irrigation_data.get("zones", []):
            if z.get("id") == self._zone_id:
                return z
        return None

    @property
    def available(self):
        return self._get_zone() is not None

    @property
    def device_info(self) -> DeviceInfo:
        zone = self._get_zone()
        name = zone.get("name", "Unbekannte Zone") if zone else "Bewässerungszone"
        return DeviceInfo(
            identifiers={(DOMAIN, f"irrigation_zone_{self._zone_id}")},
            name=f"Bewässerung {name}",
            manufacturer="SmartHome Companion",
            model="Bewässerungskreis",
            via_device=(DOMAIN, "irrigation_hub")
        )

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", self._handle_update
            )
        )
        self.async_write_ha_state()

    async def _handle_update(self, event):
        self.async_write_ha_state()

class IrrigationZoneLastWateredSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "last_watered")
        self._attr_name = "Zuletzt bewässert"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_last_watered_{zone_id}"
        self._attr_icon = "mdi:water-check"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone or not zone.get("last_watered_at"):
            return "Nie"
        try:
            dt = dt_util.parse_datetime(zone.get("last_watered_at"))
            return dt.strftime("%d.%m.%Y %H:%M") if dt else "Nie"
        except:
            return "Nie"

class IrrigationZoneNextRunSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "next_planned")
        self._attr_name = "Nächste Bewässerung"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_next_planned_{zone_id}"
        self._attr_icon = "mdi:calendar-clock"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return "Keine"
        
        now = dt_util.now()
        time_str = zone.get("scheduled_time", "00:00")
        try:
            parts = time_str.split(":")
            candidate = now.replace(hour=int(parts[0]), minute=int(parts[1]), second=0, microsecond=0)
        except Exception:
            return "Keine"
            
        if candidate < now:
            candidate += timedelta(days=1)
            
        schedule = zone.get("weekday_schedule", [True]*7)
        for i in range(14):
            weekday = candidate.weekday()
            heat_active = self.irrigation_manager.is_heat_override_today(zone) if hasattr(self.irrigation_manager, "is_heat_override_today") else False
            
            if (weekday < len(schedule) and schedule[weekday]) or heat_active:
                if candidate.date() == now.date():
                    return f"Heute {candidate.strftime('%H:%M')}"
                elif candidate.date() == (now + timedelta(days=1)).date():
                    return f"Morgen {candidate.strftime('%H:%M')}"
                else:
                    return candidate.strftime("%d.%m. %H:%M")
            candidate += timedelta(days=1)
            
        return "Keine"

    @property
    def extra_state_attributes(self):
        zone = self._get_zone()
        if not zone: return {}
        
        now = dt_util.now()
        time_str = zone.get("scheduled_time", "00:00")
        try:
            parts = time_str.split(":")
            candidate = now.replace(hour=int(parts[0]), minute=int(parts[1]), second=0, microsecond=0)
        except Exception:
            return {}
            
        if candidate < now:
            candidate += timedelta(days=1)
            
        schedule = zone.get("weekday_schedule", [True]*7)
        extra_days = []
        heat_active = self.irrigation_manager.is_heat_override_today(zone) if hasattr(self.irrigation_manager, "is_heat_override_today") else False
        if heat_active:
            extra_days.append(now.weekday())
            
        next_dt = None
        for i in range(14):
            weekday = candidate.weekday()
            
            if (weekday < len(schedule) and schedule[weekday]) or (candidate.date() == now.date() and heat_active):
                if not next_dt:
                    next_dt = candidate.isoformat()
            candidate += timedelta(days=1)
            
        return {
            "next_datetime": next_dt,
            "extra_active_days": extra_days,
            "last_forecast_temperature": getattr(self.irrigation_manager, "_last_forecast_temperature", None)
        }

class IrrigationZoneStatusSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "status")
        self._attr_name = "Aktueller Status"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_status_{zone_id}"
        self._attr_icon = "mdi:information-outline"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return "Unbekannt"
        
        if zone.get("id") in self.irrigation_manager.running_zones:
            return "Bewässert aktuell"
            
        heat_active = self.irrigation_manager.is_heat_override_today(zone) if hasattr(self.irrigation_manager, "is_heat_override_today") else False
        if heat_active:
            return "Hitze-Automatik aktiv"
            
        last_skip = zone.get("last_skipped_at")
        last_run = zone.get("last_watered_at")
        
        if last_skip:
            try:
                dt_skip = dt_util.parse_datetime(last_skip)
                dt_run = dt_util.parse_datetime(last_run) if last_run else None
                if dt_run is None or dt_skip > dt_run:
                    reason = zone.get("last_skipped_reason", "")
                    return f"Pausiert ({reason})"
            except:
                pass
                
        return "Wartet"

    @property
    def extra_state_attributes(self):
        zone = self._get_zone()
        if not zone: return {}
        attrs = {}
        if zone.get("id") in self.irrigation_manager.running_zones:
            run_data = self.irrigation_manager.running_zones[zone.get("id")]
            attrs["is_manual"] = run_data.get("is_manual", False)
            if run_data.get("duration"):
                attrs["duration_minutes"] = run_data["duration"].total_seconds() / 60
            if run_data.get("start_time"):
                attrs["start_time"] = run_data["start_time"].isoformat()
        return attrs

class IrrigationZoneDurationSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "duration")
        zone = self._get_zone()
        if zone and zone.get("soil_sensor_entity_id"):
            self._attr_name = "Maximale Länge"
        else:
            self._attr_name = "Eingestellte Zeit"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_duration_{zone_id}"
        self._attr_icon = "mdi:timer-sand"
        self._attr_native_unit_of_measurement = "min"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return 0
        return zone.get("scheduled_duration_minutes", 30)

class IrrigationZoneTargetMoistureSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "target_moisture")
        self._attr_name = "Zielfeuchtigkeit"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_target_moisture_{zone_id}"
        self._attr_icon = "mdi:water-percent"
        self._attr_native_unit_of_measurement = "%"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return 0
        return zone.get("target_moisture_percent", 40.0)

class IrrigationZoneProgressSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "progress")
        self._attr_name = "Fortschritt"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_progress_{zone_id}"
        self._attr_icon = "mdi:progress-clock"
        self._attr_native_unit_of_measurement = "%"

    @property
    def native_value(self):
        if not self.irrigation_manager or self._zone_id not in self.irrigation_manager.running_zones:
            return 0
            
        data = self.irrigation_manager.running_zones[self._zone_id]
        start_time = data.get("start_time")
        duration = data.get("duration")
        
        if not start_time or not duration or duration.total_seconds() == 0:
            return 0
            
        now = dt_util.now()
        elapsed = (now - start_time).total_seconds()
        total = duration.total_seconds()
        
        progress = (elapsed / total) * 100
        return round(max(0, min(100, progress)))
