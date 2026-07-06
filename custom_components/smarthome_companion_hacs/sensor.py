import logging
from datetime import timedelta
import homeassistant.util.dt as dt_util

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    sun_manager = hass.data[DOMAIN].get("sun_manager")
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    irrigation_manager = hass.data[DOMAIN].get("irrigation_manager")
    
    module = entry.data.get("module", "legacy")

    entities = []
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

    def add_blind_sensors(event=None):
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

    if module in ("blinds", "legacy"):
        # Initial register
        add_blind_sensors()

        # Dynamic registration upon config reloads/updates
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_blinds_updated", add_blind_sensors
            )
        )

    added_irrigation_zones = set()

    def add_irrigation_sensors(event=None):
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
            if zone_id not in added_irrigation_zones:
                new_entities.extend([
                    IrrigationZoneLastWateredSensor(hass, store, irrigation_manager, zone_id),
                    IrrigationZoneNextRunSensor(hass, store, irrigation_manager, zone_id),
                    IrrigationZoneStatusSensor(hass, store, irrigation_manager, zone_id),
                    IrrigationZoneDurationSensor(hass, store, irrigation_manager, zone_id),
                    IrrigationZoneProgressSensor(hass, store, irrigation_manager, zone_id),
                ])
                if zone.get("soil_sensor_entity_id"):
                    new_entities.append(IrrigationZoneTargetMoistureSensor(hass, store, irrigation_manager, zone_id))
                added_irrigation_zones.add(zone_id)

        if new_entities:
            async_add_entities(new_entities)

    def update_irrigation_sensors(event=None):
        add_irrigation_sensors()
        for entity in entities:
            if isinstance(entity, (ConfiguredIrrigationSensor, UnconfiguredIrrigationSensor, IrrigationMaxManualRuntimeSensor, IrrigationSimultaneousModeSensor)):
                entity.async_write_ha_state()

    if module in ("irrigation", "legacy"):
        add_irrigation_sensors()
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
        self._attr_name = "Nächste Aktion"
        self._attr_unique_id = f"smarthome_companion_sensor_next_action_{blind_id}"
        self._attr_icon = "mdi:clock-check-outline"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        open_time = times_today.get("open_time")
        close_time = times_today.get("close_time")
        
        if not open_time or not close_time:
            return None
            
        next_open = open_time
        if next_open <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            next_open = times_tomorrow.get("open_time")
            
        next_close = close_time
        if next_close <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            next_close = times_tomorrow.get("close_time")
            
        if not next_open or not next_close:
            return None
            
        if next_open < next_close:
            return f"Öffnen um {next_open.strftime('%H:%M')}"
        else:
            return f"Schließen um {next_close.strftime('%H:%M')}"

    @property
    def extra_state_attributes(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return {}
        
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        open_time = times_today.get("open_time")
        close_time = times_today.get("close_time")
        
        if not open_time or not close_time:
            return {}
            
        next_open = open_time
        if next_open <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            next_open = times_tomorrow.get("open_time")
            open_offset = times_tomorrow.get("open_offset", 0)
        else:
            open_offset = times_today.get("open_offset", 0)
            
        next_close = close_time
        if next_close <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            next_close = times_tomorrow.get("close_time")
            close_offset = times_tomorrow.get("close_offset", 0)
        else:
            close_offset = times_today.get("close_offset", 0)
            
        if next_open < next_close:
            action = "Öffnen"
            next_dt = next_open
            offset = open_offset
        else:
            action = "Schließen"
            next_dt = next_close
            offset = close_offset
            
        return {
            "next_action": action,
            "next_time": next_dt.strftime("%H:%M"),
            "next_datetime": next_dt.isoformat(),
            "offset_minutes": offset,
        }

class BlindShadingPredictionTodaySensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_today")
        self._attr_name = "Beschattungs-Prognose (Heute)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_today_{blind_id}"
        self._attr_icon = "mdi:shield-sun"

    def _calculate_prediction(self, is_tomorrow=False):
        config = self.store.get_blinds().get(self._blind_id)
        if not config or not config.get("enable_shading", False):
            return "Deaktiviert", {}
            
        direction_map = {"norden": "nord", "osten": "ost", "sueden": "sued", "westen": "west"}
        card_dir = config.get("cardinal_direction", "sueden").lower()
        if card_dir == "genau" or card_dir == "genaue angabe":
            card_dir = "sueden"
        direction = direction_map.get(card_dir, "sued")
        
        sun_manager = self.hass.data[DOMAIN].get("sun_manager")
        if not sun_manager: return "Unbekannt", {}
        
        forecast_peak = sun_manager.forecast_max_intensities_tomorrow.get(direction, 0.0) if is_tomorrow else sun_manager.forecast_max_intensities.get(direction, 0.0)
        
        shading_int = config.get("shading_intensity_threshold")
        if shading_int is None:
            shading_int = float(self.store.get_blinds().get(f"_global_shading_intensity_{card_dir}", 600.0))
        else:
            shading_int = float(shading_int)
            
        shading_start_temp = float(self.store.get_blinds().get("_global_shading_start_temp", 24.0))
        shading_max_temp = float(self.store.get_blinds().get("_global_shading_max_temp", 30.0))
        
        # Get forecast max temp
        # Since weather_manager only stores today_max_temp right now we will use that for both
        # A more advanced version would also fetch tomorrow max temp, but for now we use _today_max_temp
        today_max = getattr(self.blinds_manager, "_today_max_temp", None)
        
        enable_solar_int = config.get("enable_solar_intensity_check", False)
        if enable_solar_int and forecast_peak < shading_int:
            return "Inaktiv (Zu wenig Sonne)", {
                "forecast_peak": round(forecast_peak, 1),
                "required_intensity": shading_int
            }
            
        if today_max is None:
            return "Wartet auf Wetterdaten", {
                "forecast_peak": round(forecast_peak, 1),
                "required_intensity": shading_int if enable_solar_int else "Aus"
            }
            
        trigger_temp = shading_start_temp
        if today_max > shading_start_temp:
            trigger_temp = shading_start_temp - (today_max - shading_start_temp) * 0.5
            trigger_temp = max(shading_start_temp - 5.0, trigger_temp)
            
        if today_max < trigger_temp:
            return "Inaktiv (Zu kühl)", {
                "forecast_peak": round(forecast_peak, 1),
                "required_intensity": shading_int if enable_solar_int else "Aus",
                "forecast_max_temp": round(today_max, 1),
                "trigger_temp": round(trigger_temp, 1)
            }
            
        t_factor = (today_max - shading_start_temp) / max(0.1, shading_max_temp - shading_start_temp)
        t_factor = max(0.0, min(1.0, t_factor))
        
        start_pos = float(config.get("shading_start_position", 40.0))
        target_pos = float(config.get("shading_target_position", 0.0))
        
        target_position = int(start_pos + t_factor * (target_pos - start_pos))
        
        return f"Geplant: {target_position}%", {
            "forecast_peak": round(forecast_peak, 1),
            "required_intensity": shading_int if enable_solar_int else "Aus",
            "forecast_max_temp": round(today_max, 1),
            "trigger_temp": round(trigger_temp, 1),
            "calculated_target_position": target_position
        }

    @property
    def native_value(self):
        val, _ = self._calculate_prediction(is_tomorrow=False)
        return val

    @property
    def extra_state_attributes(self):
        _, attr = self._calculate_prediction(is_tomorrow=False)
        return attr

class BlindShadingPredictionTomorrowSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_tomorrow")
        self._attr_name = "Beschattungs-Prognose (Morgen)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_tomorrow_{blind_id}"
        self._attr_icon = "mdi:shield-sun-outline"

    @property
    def native_value(self):
        # We use today's temperature forecast logic until tomorrow is explicitly fetched in blinds_manager
        today_sensor = BlindShadingPredictionTodaySensor(self.hass, self.store, self.blinds_manager, self._blind_id)
        val, _ = today_sensor._calculate_prediction(is_tomorrow=True)
        return val

    @property
    def extra_state_attributes(self):
        today_sensor = BlindShadingPredictionTodaySensor(self.hass, self.store, self.blinds_manager, self._blind_id)
        _, attr = today_sensor._calculate_prediction(is_tomorrow=True)
        return attr

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
