import logging
import asyncio
from datetime import timedelta
import homeassistant.util.dt as dt_util
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
from homeassistant.components.weather import ATTR_FORECAST_PRECIPITATION_PROBABILITY

_LOGGER = logging.getLogger(__name__)

class IrrigationManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self.config = {}
        self.running_zones = {}
        self.sensor_history = {}
        self._sensor_unsub = None
        self._fast_timer_unsub = None
        self._last_checked_date = None
        self._heat_override_active_yesterday = False
        self._heat_override_active_today = False
        self._last_forecast_temperature = None

    def is_heat_override_today(self, zone):
        if not (zone.get("enableHeatOverride") or zone.get("enable_heat_override")):
            return False
            
        time_str = zone.get("scheduled_time", "00:00")
        try:
            h = int(time_str.split(":")[0])
        except:
            h = 0
            
        if h < 12:
            return self._heat_override_active_yesterday or self._heat_override_active_today
        return self._heat_override_active_today

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
        
        self._timer_unsub = async_track_time_interval(
            self.hass, self._async_check_irrigation, timedelta(minutes=1)
        )
        self._fast_timer_unsub = async_track_time_interval(
            self.hass, self._async_fast_update, timedelta(seconds=15)
        )
        self._update_sensor_listeners()
        _LOGGER.info("IrrigationManager setup complete.")

    async def _async_fast_update(self, now):
        """Fast update loop for progress sensors."""
        if self.running_zones:
            self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

    async def async_reload(self):
        """Reload configuration from store."""
        self.config = self.store.get_irrigation()
        self._update_sensor_listeners()
        _LOGGER.info("Irrigation configuration reloaded.")

    def _update_sensor_listeners(self):
        if self._sensor_unsub:
            self._sensor_unsub()
            self._sensor_unsub = None

        sensor_ids = set()
        for zone in self.config.get("zones", []):
            sensor_id = zone.get("soil_sensor_entity_id")
            if sensor_id:
                sensor_ids.add(sensor_id)

        if sensor_ids:
            self._sensor_unsub = async_track_state_change_event(
                self.hass, list(sensor_ids), self._async_sensor_changed
            )

    async def _async_sensor_changed(self, event):
        """Handle soil sensor state changes."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        
        if not new_state:
            return
            
        try:
            moisture = float(new_state.state)
        except ValueError:
            return
            
        zones_to_stop = []
        for zone_id, data in self.running_zones.items():
            if data.get("soil_sensor_entity_id") == entity_id and not data.get("is_manual", False):
                target = data.get("target_moisture_percent", 100)
                if moisture >= target:
                    zones_to_stop.append((zone_id, "Ziel-Feuchtigkeit erreicht"))
                    
        if zones_to_stop:
            await self._stop_zones(zones_to_stop)
            
        # Fire event so UI/sensors update with the new soil moisture immediately
        self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

    async def _stop_zones(self, zones_to_stop):
        config_changed = False
        for zone_id, reason in zones_to_stop:
            if zone_id not in self.running_zones:
                continue
            valve = self.running_zones[zone_id]["valve_entity"]
            _LOGGER.info(f"Zone {zone_id} stopped. Reason: {reason}.")
            await self._turn_off_valve(valve)
            del self.running_zones[zone_id]
            
            # Update last_watered_at etc could be done here if needed
        
        if config_changed:
            await self.store.save_irrigation(self.config)
            
        self.hass.bus.async_fire("smarthome_companion_irrigation_updated")
        
    async def async_force_check(self):
        """Force an immediate check of the irrigation logic."""
        _LOGGER.info("Forcing immediate irrigation check.")
        await self._async_check_irrigation(dt_util.now())

    async def async_manual_start(self, zone_id, duration_minutes=None):
        """Manually start a zone based on its configured or specified duration."""
        # Find zone
        zones = self.config.get("zones", [])
        zone = next((z for z in zones if z.get("id") == zone_id), None)
        if not zone:
            _LOGGER.warning(f"Cannot manual start, zone {zone_id} not found.")
            return

        valve_entity = zone.get("valve_entity_id")
        if duration_minutes is None:
            # If no specific duration given, default to the max global runtime
            duration_minutes = self.config.get("max_manual_runtime_minutes", 60)
            
        # Ensure it does not exceed the global max manual runtime
        max_runtime = self.config.get("max_manual_runtime_minutes", 60)
        if duration_minutes > max_runtime:
            duration_minutes = max_runtime

        if not valve_entity:
            _LOGGER.warning(f"Zone {zone_id} has no valve entity configured.")
            return

        _LOGGER.info(f"Manually starting zone {zone_id} for {duration_minutes} minutes.")
        await self._turn_on_valve(valve_entity)
        
        # Add to running zones tracking
        self.running_zones[zone_id] = {
            "start_time": dt_util.now(),
            "duration": timedelta(minutes=duration_minutes),
            "valve_entity": valve_entity,
            "soil_sensor_entity_id": zone.get("soil_sensor_entity_id"),
            "target_moisture_percent": zone.get("target_moisture_percent", 100),
            "is_manual": True
        }
        self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

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
            
            # Apply global max manual runtime as timeout
            max_runtime = self.config.get("max_manual_runtime_minutes", 60)
            self.running_zones[zone_id] = {
                "start_time": dt_util.now(),
                "duration": timedelta(minutes=max_runtime),
                "valve_entity": valve_entity,
                "soil_sensor_entity_id": zone.get("soil_sensor_entity_id"),
                "target_moisture_percent": zone.get("target_moisture_percent", 100),
                "is_manual": True
            }
            self.hass.bus.async_fire("smarthome_companion_irrigation_updated")
        else:
            _LOGGER.info(f"Toggling OFF zone {zone_id}.")
            await self._turn_off_valve(valve_entity)
            if zone_id in self.running_zones:
                del self.running_zones[zone_id]
            self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

    async def _async_check_irrigation(self, now):
        """Main loop that runs every minute to check schedules and turn off running zones."""
        now = dt_util.as_local(now) # Fix timezone issue (UTC vs Local)
        
        # 1. Check running zones
        zones_to_stop = []
        for zone_id, data in self.running_zones.items():
            elapsed = now - data["start_time"]
            stop_reason = None
            
            if elapsed >= data["duration"]:
                stop_reason = "Zeit abgelaufen (Timeout)"
                        
            if stop_reason:
                zones_to_stop.append((zone_id, stop_reason))
        
        if zones_to_stop:
            await self._stop_zones(zones_to_stop)
        
        config_changed = False

        # 2. Check schedules for zones that should start
        if not self.config.get("zones"):
            return

        # Check rain forecast logic (simplified)
        global_rain_sensor = self.config.get("global_rain_sensor")
        is_raining_or_forecast = False
        if global_rain_sensor:
            state = self.hass.states.get(global_rain_sensor)
            if state:
                if state.domain == "binary_sensor" and state.state == "on":
                    is_raining_or_forecast = True
                else:
                    try:
                        prob = float(state.state)
                        if prob > 50: # Threshold could be configurable
                            is_raining_or_forecast = True
                    except ValueError:
                        pass

        # Fetch weather forecast for heat override
        if self._last_checked_date != now.date():
            self._heat_override_active_yesterday = self._heat_override_active_today
            self._heat_override_active_today = False
            self._last_checked_date = now.date()
            
        heat_override_active = False
        any_heat_override = any(z.get("enableHeatOverride") or z.get("enable_heat_override") for z in self.config.get("zones", []))
        weather_entity = global_rain_sensor if global_rain_sensor and global_rain_sensor.startswith("weather.") else "weather.forecast_home"
        
        if any_heat_override:
            try:
                # Need to use return_response=True for modern HA service calls
                response = await self.hass.services.async_call(
                    "weather",
                    "get_forecasts",
                    {"entity_id": weather_entity, "type": "daily"},
                    blocking=True,
                    return_response=True
                )
                if response and weather_entity in response:
                    forecasts = response[weather_entity].get("forecast", [])
                    for f in forecasts:
                        dt_str = f.get("datetime")
                        if dt_str:
                            f_dt = dt_util.parse_datetime(dt_str)
                            if f_dt and f_dt.date() == now.date():
                                max_temp = float(f.get("temperature", 0))
                                self._last_forecast_temperature = max_temp
                                threshold = self.config.get("heat_override_threshold", 30.0)
                                if max_temp > threshold:
                                    heat_override_active = True
                                    self._heat_override_active_today = True
                                break
            except Exception as e:
                _LOGGER.error(f"Failed to fetch weather forecast for heat override: {e}")

        # We will iterate and check if it's time to run
        for zone in self.config.get("zones", []):
            zone_id = zone.get("id")
            valve_entity = zone.get("valve_entity_id")
            
            # Detect manual turn on outside of the automation
            if valve_entity and zone_id not in self.running_zones:
                valve_state = self.hass.states.get(valve_entity)
                if valve_state and valve_state.state == "on":
                    _LOGGER.info(f"Detected manual turn on for {zone.get('name')}. Tracking it now.")
                    max_runtime = self.config.get("max_manual_runtime_minutes", 60)
                    self.running_zones[zone_id] = {
                        "start_time": now,
                        "duration": timedelta(minutes=max_runtime),
                        "valve_entity": valve_entity,
                        "soil_sensor_entity_id": zone.get("soil_sensor_entity_id"),
                        "target_moisture_percent": zone.get("target_moisture_percent", 100)
                    }

            if zone_id in self.running_zones:
                continue # Already running
            
            weekdays = zone.get("weekday_schedule", [False]*7)
            is_heat_override = self.is_heat_override_today(zone)
            
            # now.weekday() returns 0 for Monday, 6 for Sunday, which perfectly matches our UI array
            if not weekdays[now.weekday()] and not is_heat_override:
                continue
                
            time_str = zone.get("scheduled_time", "00:00")
            try:
                parts = time_str.split(":")
                sched_h = int(parts[0])
                sched_m = int(parts[1])
            except Exception:
                continue
                
            if now.hour == sched_h and now.minute == sched_m:
                # It's time to run!
                name = zone.get("name", "Unknown")
                
                # Check Global Rain Override
                if is_raining_or_forecast:
                    _LOGGER.info(f"Skipping scheduled zone {name} due to global rain sensor.")
                    zone["last_skipped_at"] = now.isoformat()
                    zone["last_skipped_reason"] = "Regen"
                    config_changed = True
                    continue
                    
                # Check Soil Moisture Override
                soil_sensor = zone.get("soil_sensor_entity_id")
                target_moisture = zone.get("target_moisture_percent", 100)
                start_moisture = zone.get("start_moisture_percent", target_moisture - 5)
                
                moisture = None
                if soil_sensor:
                    s_state = self.hass.states.get(soil_sensor)
                    if s_state:
                        try:
                            moisture = float(s_state.state)
                        except ValueError:
                            pass
                            
                if moisture is not None and moisture >= start_moisture:
                    _LOGGER.info(f"Skipping scheduled zone {name} due to soil moisture {moisture}% >= start threshold {start_moisture}%.")
                    zone["last_skipped_at"] = now.isoformat()
                    zone["last_skipped_reason"] = "Noch feucht genug"
                    config_changed = True
                    continue
                
                # Start zone
                valve_entity = zone.get("valve_entity_id")
                duration = zone.get("scheduled_duration_minutes", 30)
                if valve_entity:
                    _LOGGER.info(f"Starting scheduled zone {name} for {duration} minutes.")
                    await self._turn_on_valve(valve_entity)
                    self.running_zones[zone_id] = {
                        "start_time": now,
                        "duration": timedelta(minutes=duration),
                        "valve_entity": valve_entity,
                        "soil_sensor_entity_id": soil_sensor,
                        "target_moisture_percent": target_moisture
                    }
                    
                    zone["last_watered_at"] = now.isoformat()
                    zone["last_skipped_reason"] = None
                    config_changed = True

        if config_changed:
            await self.store.save_irrigation(self.config)
            
        if self.running_zones:
            self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

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
