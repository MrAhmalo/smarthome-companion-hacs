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
        self._last_checked_date = None
        await self._async_check_irrigation(dt_util.now())
        self.hass.bus.async_fire("smarthome_companion_irrigation_updated")
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
            if data.get("soil_sensor_entity_id") == entity_id:
                try:
                    target = float(data.get("target_moisture_percent", 100))
                except (ValueError, TypeError):
                    target = 100.0
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
        self._last_checked_date = None
        await self._async_check_irrigation(dt_util.now())
        self.hass.bus.async_fire("smarthome_companion_irrigation_updated")

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

    def _is_raining(self):
        """Check the global rain sensor. Returns True if rain is detected."""
        global_rain_sensor = self.config.get("global_rain_sensor")
        if not global_rain_sensor:
            return False
        state = self.hass.states.get(global_rain_sensor)
        if not state:
            return False
        if state.domain == "binary_sensor":
            return state.state == "on"
        try:
            prob = float(state.state)
            return prob > 50
        except (ValueError, TypeError):
            pass
        # Weather entity state strings
        rainy_conditions = {"rainy", "pouring", "lightning-rainy", "snowy-rainy"}
        return state.state.lower() in rainy_conditions

    async def _fetch_daily_max_temp(self, now):
        """Fetch today's forecast max temperature. Returns float or None."""
        # 1. Check custom temp sensor
        temp_sensor = self.config.get("global_temp_sensor")
        if temp_sensor and not temp_sensor.startswith("weather."):
            state = self.hass.states.get(temp_sensor)
            if state:
                try:
                    temp = float(state.state)
                    self._last_forecast_temperature = temp
                    return temp
                except ValueError:
                    pass
            # If temp_sensor is configured but invalid, fallback to weather
            
        global_rain_sensor = self.config.get("global_rain_sensor", "")
        weather_entity = (
            temp_sensor if temp_sensor and temp_sensor.startswith("weather.")
            else global_rain_sensor if global_rain_sensor.startswith("weather.")
            else "weather.forecast_home"
        )
        try:
            response = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"entity_id": weather_entity, "type": "daily"},
                blocking=True,
                return_response=True,
            )
            if response and weather_entity in response:
                forecasts = response[weather_entity].get("forecast", [])
                for f in forecasts:
                    dt_str = f.get("datetime")
                    if dt_str:
                        f_dt = dt_util.parse_datetime(dt_str)
                        if f_dt and dt_util.as_local(f_dt).date() == now.date():
                            temp = float(f.get("temperature", 0))
                            self._last_forecast_temperature = temp
                            return temp
        except Exception as e:
            _LOGGER.warning(f"Could not fetch weather forecast: {e}")
        return None

    async def _async_check_irrigation(self, now):
        """Main loop every minute: check timeouts, then start zones if conditions are met."""
        now = dt_util.as_local(now)

        # ── 1. Stop zones that timed out or reached target moisture ──────────
        zones_to_stop = []
        for zone_id, data in self.running_zones.items():
            if now - data["start_time"] >= data["duration"]:
                zones_to_stop.append((zone_id, "Maximale Laufzeit erreicht"))
            elif data.get("soil_sensor_entity_id"):
                sensor_id = data.get("soil_sensor_entity_id")
                state = self.hass.states.get(sensor_id)
                if state:
                    try:
                        moisture = float(state.state)
                        try:
                            target = float(data.get("target_moisture_percent", 100.0))
                        except (ValueError, TypeError):
                            target = 100.0
                        if moisture >= target:
                            zones_to_stop.append((zone_id, "Ziel-Feuchtigkeit erreicht"))
                    except (ValueError, TypeError):
                        pass

        if zones_to_stop:
            await self._stop_zones(zones_to_stop)

        if not self.config.get("zones"):
            return

        # ── 2. Once-per-day: fetch heat override temperature ─────────────────
        if self._last_checked_date != now.date():
            self._heat_override_active_yesterday = self._heat_override_active_today
            self._heat_override_active_today = False
            self._last_checked_date = now.date()

            any_heat = any(
                z.get("enable_heat_override") for z in self.config.get("zones", [])
            )
            if any_heat:
                temp = await self._fetch_daily_max_temp(now)
                if temp is not None:
                    threshold = float(self.config.get("heat_override_threshold", 30.0))
                    if temp > threshold:
                        self._heat_override_active_today = True
                        _LOGGER.info(f"Heat override ACTIVE: {temp}°C > {threshold}°C")

        # ── 3. Global rain check ─────────────────────────────────────────────
        is_raining = self._is_raining()

        # ── 4. Per-zone logic ────────────────────────────────────────────────
        config_changed = False

        for zone in self.config.get("zones", []):
            zone_id = zone.get("id")
            valve_entity = zone.get("valve_entity_id")
            name = zone.get("name", zone_id)

            # Detect externally-toggled manual run
            if valve_entity and zone_id not in self.running_zones:
                valve_state = self.hass.states.get(valve_entity)
                if valve_state and valve_state.state == "on":
                    _LOGGER.info(f"Detected external manual turn-on for '{name}'.")
                    max_runtime = self.config.get("max_manual_runtime_minutes", 60)
                    self.running_zones[zone_id] = {
                        "start_time": now,
                        "duration": timedelta(minutes=max_runtime),
                        "valve_entity": valve_entity,
                        "soil_sensor_entity_id": zone.get("soil_sensor_entity_id"),
                        "target_moisture_percent": zone.get("target_moisture_percent", 100),
                        "is_manual": True,
                    }

            if zone_id in self.running_zones:
                continue

            # Check if it's the scheduled time
            time_str = zone.get("scheduled_time", "00:00")
            try:
                parts = time_str.split(":")
                sched_h, sched_m = int(parts[0]), int(parts[1])
            except Exception:
                continue

            if now.hour != sched_h or now.minute != sched_m:
                continue

            # ── Rain pre-check (both modes) ───────────────────────────────────
            if is_raining:
                _LOGGER.info(f"Skipping '{name}': rain detected.")
                zone["last_skipped_at"] = now.isoformat()
                zone["last_skipped_reason"] = "Regen"
                config_changed = True
                continue

            # ── Determine heat override for this zone ─────────────────────────
            enable_heat = zone.get("enable_heat_override", False)
            heat_override = enable_heat and self.is_heat_override_today(zone)

            soil_sensor = zone.get("soil_sensor_entity_id")
            has_sensor = bool(soil_sensor)

            if has_sensor:
                # ════ SMART MODE ═════════════════════════════════════════════
                weekday_schedule = zone.get("weekday_schedule", [True]*7)
                if now.weekday() < len(weekday_schedule) and not weekday_schedule[now.weekday()] and not heat_override:
                    _LOGGER.debug(f"Skipping '{name}': day disabled in schedule.")
                    continue

                min_rest_days = int(zone.get("min_rest_days", 2))

                # Check minimum rest days (heat override bypasses this)
                last_watered_str = zone.get("last_watered_at")
                if last_watered_str and not heat_override:
                    try:
                        lw = dt_util.parse_datetime(last_watered_str)
                        if lw:
                            days_since = (now.date() - dt_util.as_local(lw).date()).days
                            if days_since <= min_rest_days:
                                _LOGGER.debug(
                                    f"Skipping '{name}': only {days_since}d since last water "
                                    f"(min rest: {min_rest_days}d)."
                                )
                                zone["last_skipped_at"] = now.isoformat()
                                zone["last_skipped_reason"] = "Mindestpause"
                                config_changed = True
                                continue
                    except Exception:
                        pass

                # Check soil moisture
                start_threshold = float(zone.get("start_moisture_percent", 35))
                moisture = None
                s_state = self.hass.states.get(soil_sensor)
                if s_state:
                    try:
                        moisture = float(s_state.state)
                    except (ValueError, TypeError):
                        pass

                if moisture is not None and moisture >= start_threshold:
                    _LOGGER.info(f"Skipping '{name}': moisture {moisture}% >= threshold {start_threshold}%.")
                    zone["last_skipped_at"] = now.isoformat()
                    zone["last_skipped_reason"] = "Noch feucht"
                    config_changed = True
                    continue

                # All checks passed → start (safety timeout = scheduledDurationMinutes)
                duration = int(zone.get("scheduled_duration_minutes", 30))

            else:
                # ════ SCHEDULE MODE ══════════════════════════════════════════
                weekdays = zone.get("weekday_schedule", [False] * 7)
                today_idx = now.weekday()  # 0=Mon, 6=Sun
                is_scheduled_today = (
                    today_idx < len(weekdays) and weekdays[today_idx]
                )
                if not is_scheduled_today and not heat_override:
                    continue

                duration = int(zone.get("scheduled_duration_minutes", 30))

            # ── Start the zone ────────────────────────────────────────────────
            if valve_entity:
                _LOGGER.info(
                    f"Starting zone '{name}' for {duration} min"
                    f"{' [heat override]' if heat_override else ''}."
                )
                await self._turn_on_valve(valve_entity)
                self.running_zones[zone_id] = {
                    "start_time": now,
                    "duration": timedelta(minutes=duration),
                    "valve_entity": valve_entity,
                    "soil_sensor_entity_id": soil_sensor,
                    "target_moisture_percent": float(zone.get("target_moisture_percent", 100)),
                    "is_manual": False,
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
            await self.hass.services.async_call(
                domain, "turn_on", {"entity_id": entity_id}, blocking=False
            )
        except Exception as e:
            _LOGGER.error(f"Failed to turn on {entity_id}: {e}")

    async def _turn_off_valve(self, entity_id):
        domain = entity_id.split(".")[0]
        try:
            await self.hass.services.async_call(
                domain, "turn_off", {"entity_id": entity_id}, blocking=False
            )
        except Exception as e:
            _LOGGER.error(f"Failed to turn off {entity_id}: {e}")



