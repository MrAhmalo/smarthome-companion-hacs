import logging
import asyncio
from datetime import timedelta
import homeassistant.util.dt as dt_util
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.components.weather import ATTR_FORECAST_PRECIPITATION_PROBABILITY

_LOGGER = logging.getLogger(__name__)

class IrrigationManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self.config = {}
        self.running_zones = {}
        self._timer_unsub = None

    def validate_config(self, config_dict):
        """Validate the irrigation configuration."""
        zones = config_dict.get("zones", [])
        simultaneous = config_dict.get("simultaneous", False)

        parsed_zones = []
        for zone in zones:
            name = zone.get("name", "Unbekannte Zone")
            valve = zone.get("valve_entity_id")
            if not valve:
                raise ValueError(f"Zone '{name}' hat keine Ventil-Entität zugewiesen.")

            if not simultaneous:
                time_str = zone.get("scheduled_time", "00:00")
                duration = zone.get("scheduled_duration_minutes", 0)
                weekdays = zone.get("weekday_schedule", [False]*7)
                
                # Wenn kein Wochentag aktiv ist, läuft die Zone ohnehin nicht nach Plan
                if not any(weekdays):
                    continue

                try:
                    parts = time_str.split(":")
                    start_minute = int(parts[0]) * 60 + int(parts[1])
                except Exception:
                    start_minute = 0
                
                end_minute = start_minute + duration
                
                parsed_zones.append({
                    "name": name,
                    "start": start_minute,
                    "end": end_minute,
                    "weekdays": weekdays
                })

        if not simultaneous:
            # Check for overlaps
            for i in range(len(parsed_zones)):
                for j in range(i + 1, len(parsed_zones)):
                    z1 = parsed_zones[i]
                    z2 = parsed_zones[j]
                    
                    # Check if they run on the same day
                    same_day = any(d1 and d2 for d1, d2 in zip(z1["weekdays"], z2["weekdays"]))
                    if same_day:
                        # Check time overlap (assuming no midnight wraparound for simplicity)
                        if z1["start"] < z2["end"] and z2["start"] < z1["end"]:
                            raise ValueError(
                                f"Zeitliche Überschneidung im Nacheinander-Modus: "
                                f"'{z1['name']}' und '{z2['name']}' überschneiden sich."
                            )

    async def async_setup(self):
        """Initial setup of the irrigation manager."""
        self.config = self.store.get_irrigation()
        
        # Check every minute
        self._timer_unsub = async_track_time_interval(
            self.hass, self._async_check_irrigation, timedelta(minutes=1)
        )
        _LOGGER.info("IrrigationManager setup complete.")

    async def async_reload(self):
        """Reload configuration from store."""
        self.config = self.store.get_irrigation()
        _LOGGER.debug("IrrigationManager reloaded config.")

    async def async_manual_start(self, zone_id):
        """Manually start a zone based on its configured duration."""
        # Find zone
        zones = self.config.get("zones", [])
        zone = next((z for z in zones if z.get("id") == zone_id), None)
        if not zone:
            _LOGGER.warning(f"Cannot manual start, zone {zone_id} not found.")
            return

        valve_entity = zone.get("valve_entity_id")
        duration_minutes = zone.get("scheduled_duration_minutes", 30)

        if not valve_entity:
            _LOGGER.warning(f"Zone {zone_id} has no valve entity configured.")
            return

        _LOGGER.info(f"Manually starting zone {zone_id} for {duration_minutes} minutes.")
        await self._turn_on_valve(valve_entity)
        
        # Add to running zones tracking
        self.running_zones[zone_id] = {
            "start_time": dt_util.now(),
            "duration": timedelta(minutes=duration_minutes),
            "valve_entity": valve_entity
        }

    async def async_manual_toggle(self, zone_id, state):
        """Toggle a zone indefinitely."""
        zones = self.config.get("zones", [])
        zone = next((z for z in zones if z.get("id") == zone_id), None)
        if not zone:
            return

        valve_entity = zone.get("valve_entity_id")
        if not valve_entity:
            return

        if state:
            _LOGGER.info(f"Toggling ON zone {zone_id}.")
            await self._turn_on_valve(valve_entity)
            # Optionally track it without an end time, or let HA handle it.
            # We'll just turn it on.
        else:
            _LOGGER.info(f"Toggling OFF zone {zone_id}.")
            await self._turn_off_valve(valve_entity)
            if zone_id in self.running_zones:
                del self.running_zones[zone_id]

    async def _async_check_irrigation(self, now):
        """Main loop that runs every minute to check schedules and turn off running zones."""
        # 1. Check running zones
        zones_to_stop = []
        for zone_id, data in self.running_zones.items():
            elapsed = now - data["start_time"]
            if elapsed >= data["duration"]:
                zones_to_stop.append(zone_id)
        
        for zone_id in zones_to_stop:
            valve = self.running_zones[zone_id]["valve_entity"]
            _LOGGER.info(f"Zone {zone_id} duration completed. Turning off.")
            await self._turn_off_valve(valve)
            del self.running_zones[zone_id]

        # 2. Check schedules for zones that should start
        if not self.config.get("zones"):
            return

        # Check rain forecast logic (simplified)
        global_rain_sensor = self.config.get("rain_sensor_entity_id")
        is_raining_or_forecast = False
        if global_rain_sensor:
            state = self.hass.states.get(global_rain_sensor)
            if state:
                try:
                    prob = float(state.state)
                    if prob > 50: # Threshold could be configurable
                        is_raining_or_forecast = True
                except ValueError:
                    pass

        # We will iterate and check if it's time to run
        for zone in self.config.get("zones", []):
            zone_id = zone.get("id")
            if zone_id in self.running_zones:
                continue # Already running
            
            # Here we would implement the exact time matching logic
            # checking weekdays, scheduled time, moisture sensor etc.
            # To be fully implemented in the next iteration based on exact data structures.
            pass

    async def _turn_on_valve(self, entity_id):
        domain = entity_id.split(".")[0]
        try:
            await self.hass.services.async_call(domain, "turn_on", {"entity_id": entity_id}, blocking=False)
        except Exception as e:
            _LOGGER.error(f"Failed to turn on {entity_id}: {e}")

    async def _turn_off_valve(self, entity_id):
        domain = entity_id.split(".")[0]
        try:
            await self.hass.services.async_call(domain, "turn_off", {"entity_id": entity_id}, blocking=False)
        except Exception as e:
            _LOGGER.error(f"Failed to turn off {entity_id}: {e}")
