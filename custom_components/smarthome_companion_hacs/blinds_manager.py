import logging
from datetime import timedelta, datetime, time
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
# pyrefly: ignore [missing-import]
from homeassistant.core import Context
# pyrefly: ignore [missing-import]
import homeassistant.util.dt as dt_util
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class BlindsManager:
    def __init__(self, hass, store, sun_manager):
        self.hass = hass
        self.store = store
        self.sun_manager = sun_manager
        self._watchdog_unsub = None
        self._regular_unsub = None
        self._state_change_unsub = None
        self._traces = {}
        self._started_at = dt_util.now()
        self._last_holiday_update_hour = -1
        self._today_max_temp = None
        self._today_max_temp_date = None
        self._last_weather_update_hour = -1
        
        if "states" not in self.store.data:
            self.store.data["states"] = {}
        self._states = self.store.data["states"]

    def get_traces(self, entity_id):
        return self._traces.get(entity_id, [])

    def _add_trace(self, entity_id, reason, target_position, state="Aktion ausgeführt"):
        if entity_id not in self._traces:
            self._traces[entity_id] = []
        now_str = dt_util.now().isoformat()
        self._traces[entity_id].insert(0, {
            "timestamp": now_str,
            "reason": reason,
            "target": target_position,
            "state": state
        })
        # Keep last 20
        self._traces[entity_id] = self._traces[entity_id][:20]

    async def _log_to_logbook(self, entity_id, message):
        try:
            await self.hass.services.async_call(
                "logbook",
                "log",
                {
                    "name": "SmartHome Companion",
                    "message": message,
                    "entity_id": entity_id,
                    "domain": "cover"
                },
                blocking=False
            )
        except Exception as e:
            _LOGGER.warning("Failed to call logbook service for %s: %s", entity_id, e)

    async def _log_action(self, entity_id, action_type, target_position, is_watchdog_check):
        suffix = " (durch Watchdog korrigiert)" if is_watchdog_check else ""
        mem = self._states.get(entity_id, {})
        now = dt_util.now()

        if action_type == "open":
            msg = f"geöffnet von der Integration um der Öffnungszeit nachzugehen{suffix}."
        elif action_type == "close":
            msg = f"geschlossen von der Integration um der Schließzeit nachzugehen{suffix}."
        elif action_type == "shading":
            details = mem.get("shading_log_details", {})
            if details:
                mx = details.get("Temperatur Max Heute", "?")
                intensity = details.get("Sonnenintensität", "?")
                msg = f"Hitzeschutz aktiviert gemäß Tagesplan: Fährt auf {target_position}% (Heutiges Maximum: {mx}, Sonne: {intensity}){suffix}."
            else:
                msg = f"von der Integration auf Beschattungsposition ({target_position}%) gefahren{suffix}."
        elif action_type == "ventilation":
            if mem.get("ventilation_logged_today") == now.date().isoformat():
                return
            mem["ventilation_logged_today"] = now.date().isoformat()
            msg = f"Der Rollladen wird zum Lüften auf {target_position}% gefahren."
        elif action_type == "cloud_pause":
            msg = f"Hitzeschutz aufgrund von Bewölkung pausiert. Fährt auf {target_position}%{suffix}."
        else:
            msg = f"von der Integration gesteuert auf {target_position}%{suffix}."
        
        await self._log_to_logbook(entity_id, msg)

    def _parse_time(self, t_str, default):
        if not t_str:
            return default
        try:
            parts = str(t_str).split(':')
            return time(int(parts[0]), int(parts[1]))
        except Exception:
            return default

    def calculate_times(self, entity_id, config, date_val=None):
        import random
        now = dt_util.now()
        if date_val is None:
            date_val = now.date()
        date_str = date_val.isoformat()
        
        def get_dt(t):
            return datetime.combine(date_val, t, now.tzinfo)

        settings = self.store.data.get("settings", {})
        eot = self._parse_time(settings.get("earliest_open_time"), time(6, 0))
        ect = self._parse_time(settings.get("earliest_close_time"), time(18, 0))

        def clamp_earliest_time(dt_val, e_t):
            if e_t:
                edt = get_dt(e_t)
                if dt_val < edt: dt_val = edt
            return dt_val

        # 1. Basis-Öffnungszeit kalkulieren
        base_open_time_dt = None
        sunrise_time_dt = None
        fixed_open_dt = None

        if config.get("use_fixed_open_time", False):
            fixed_open_dt = get_dt(self._parse_time(config.get("fixed_open_time"), time(7, 0)))
            
        if config.get("use_sunrise", False):
            sun_sun = self.hass.states.get("sun.sun")
            sun_next_rising = sun_sun.attributes.get("next_rising") if sun_sun else None
            if sun_next_rising:
                rt = dt_util.parse_datetime(sun_next_rising)
                if rt:
                    rt_local = dt_util.as_local(rt)
                    sunrise_time_dt = datetime.combine(date_val, rt_local.time(), now.tzinfo)
                    sunrise_time_dt += timedelta(minutes=config.get("sunrise_offset", 0))
                    sunrise_time_dt = clamp_earliest_time(sunrise_time_dt, eot)

        if fixed_open_dt and sunrise_time_dt:
            base_open_time_dt = max(fixed_open_dt, sunrise_time_dt)
        elif fixed_open_dt:
            base_open_time_dt = fixed_open_dt
        elif sunrise_time_dt:
            base_open_time_dt = sunrise_time_dt

        # Weekend override
        is_weekend_or_holiday = False
        if date_val.weekday() >= 5:
            is_weekend_or_holiday = True
        else:
            settings = self.store.data.get("settings", {})
            holiday_sensor_id = settings.get("holiday_sensor", "binary_sensor.workday_sensor")
            if holiday_sensor_id:
                sensor_state = self.hass.states.get(holiday_sensor_id)
                if sensor_state:
                    state_val = sensor_state.state.lower()
                    if holiday_sensor_id.startswith("calendar."):
                        if state_val == "on":
                            is_weekend_or_holiday = True
                    elif "workday" in holiday_sensor_id.lower():
                        if state_val == "off":
                            is_weekend_or_holiday = True
                    else:
                        # Fallback for other holiday binary sensors where 'on' means holiday
                        if state_val == "on":
                            is_weekend_or_holiday = True

        if config.get("enable_weekend_open", False) and is_weekend_or_holiday:
            weekend_dt = get_dt(self._parse_time(config.get("weekend_open_time"), time(9, 0)))
            if base_open_time_dt:
                base_open_time_dt = max(base_open_time_dt, weekend_dt)
            else:
                base_open_time_dt = weekend_dt

        sleep_in_date_str = config.get("sleep_in_date")
        if sleep_in_date_str and sleep_in_date_str == date_val.isoformat():
            weekend_dt = get_dt(self._parse_time(config.get("weekend_open_time"), time(9, 0)))
            if base_open_time_dt:
                base_open_time_dt = max(base_open_time_dt, weekend_dt)
            else:
                base_open_time_dt = weekend_dt

        if not base_open_time_dt:
            base_open_time_dt = get_dt(self._parse_time(config.get("fixed_open_time"), time(7, 0)))

        # 2. Basis-Schließzeit kalkulieren
        base_close_time_dt = None
        sunset_time_dt = None
        fixed_close_dt = None

        if config.get("use_fixed_close_time", False):
            fixed_close_dt = get_dt(self._parse_time(config.get("fixed_close_time"), time(22, 0)))

        if config.get("use_sunset", False):
            sun_sun = self.hass.states.get("sun.sun")
            sun_next_setting = sun_sun.attributes.get("next_setting") if sun_sun else None
            if sun_next_setting:
                st = dt_util.parse_datetime(sun_next_setting)
                if st:
                    st_local = dt_util.as_local(st)
                    sunset_time_dt = datetime.combine(date_val, st_local.time(), now.tzinfo)
                    sunset_time_dt += timedelta(minutes=config.get("sunset_offset", 0))
                    sunset_time_dt = clamp_earliest_time(sunset_time_dt, ect)

        if fixed_close_dt and sunset_time_dt:
            base_close_time_dt = min(fixed_close_dt, sunset_time_dt)
        elif fixed_close_dt:
            base_close_time_dt = fixed_close_dt
        elif sunset_time_dt:
            base_close_time_dt = sunset_time_dt

        if not base_close_time_dt:
            base_close_time_dt = get_dt(self._parse_time(config.get("fixed_close_time"), time(22, 0)))

        # 3. Zufall anwenden (standardmäßig aktiviert!)
        enable_random_delay = config.get("enable_random_delay", True)
        if enable_random_delay is None:
            enable_random_delay = True
            
        random_delay_prev = config.get("random_delay_prev", 10)
        random_delay_post = config.get("random_delay_post", 10)
        
        try:
            random_delay_prev = int(random_delay_prev)
        except Exception:
            random_delay_prev = 10
            
        try:
            random_delay_post = int(random_delay_post)
        except Exception:
            random_delay_post = 10

        actual_open_time_dt = base_open_time_dt
        actual_close_time_dt = base_close_time_dt
        open_offset = 0
        close_offset = 0

        if enable_random_delay:
            # Deterministic seed for today to keep it stable
            open_seed = f"{entity_id}-{date_str}-open"
            close_seed = f"{entity_id}-{date_str}-close"
            
            r_open = random.Random(open_seed)
            open_offset = r_open.randint(-random_delay_prev, random_delay_post)
            actual_open_time_dt = base_open_time_dt + timedelta(minutes=open_offset)
            
            r_close = random.Random(close_seed)
            close_offset = r_close.randint(-random_delay_prev, random_delay_post)
            actual_close_time_dt = base_close_time_dt + timedelta(minutes=close_offset)

        return {
            "open_time": actual_open_time_dt,
            "close_time": actual_close_time_dt,
            "sunrise_time": sunrise_time_dt,
            "sunset_time": sunset_time_dt,
            "base_open_time": base_open_time_dt,
            "base_close_time": base_close_time_dt,
            "open_offset": open_offset,
            "close_offset": close_offset,
        }

    async def async_setup(self):
        await self._async_setup_schedulers()

    async def async_reload(self):
        _LOGGER.info("Blinds Manager reloading config...")
        
        # Re-sync _states reference in case store.data was replaced
        if "states" not in self.store.data:
            self.store.data["states"] = {}
        self._states = self.store.data["states"]
        
        await self._async_setup_schedulers()
        
        # Trigger immediate sun manager update in case cloud sensor updated
        try:
            await self.sun_manager._update_calculations()
        except Exception as e:
            _LOGGER.warning("Could not instantly recalculate sun intensities: %s", e)
            
        await self._update_holidays()
        await self._update_weather_forecast()
        
        # Will be called when new config comes from UI
        self.hass.bus.async_fire("smarthome_companion_blinds_updated")
        await self._evaluate_all(is_watchdog_check=False)

    async def _async_setup_schedulers(self):
        settings = self.store.data.get("settings", {})
        interval_min = int(settings.get("watchdog_interval", 15))
        if interval_min < 1:
            interval_min = 1
            
        if self._watchdog_unsub:
            self._watchdog_unsub()
            self._watchdog_unsub = None
            
        if self._regular_unsub:
            self._regular_unsub()
            self._regular_unsub = None
            
        if self._state_change_unsub:
            self._state_change_unsub()
            self._state_change_unsub = None
            
        # Register a 1-minute regular ticker for precise scheduled automation runs
        self._regular_unsub = async_track_time_interval(
            self.hass, self._regular_loop, timedelta(minutes=1)
        )
        
        # Register watchdog based on the configured watchdog interval (fallback check)
        self._watchdog_unsub = async_track_time_interval(
            self.hass, self._watchdog_loop, timedelta(minutes=interval_min)
        )
        
        # Subscribe to immediate state changes of all configured cover entities
        cover_ids = [entity_id for entity_id in self.store.get_blinds().keys() if entity_id.startswith("cover.")]
        if cover_ids:
            self._state_change_unsub = async_track_state_change_event(
                self.hass, cover_ids, self._async_state_changed
            )
            
        # Initial call for holiday evaluation
        self.hass.async_create_task(self._update_holidays())

    async def _update_holidays(self):
        now = dt_util.now()
        
        for day_offset in (0, 1):
            target_date = now.date() + timedelta(days=day_offset)
            is_holiday = False
            
            if target_date.weekday() >= 5:
                is_holiday = True
            else:
                settings = self.store.data.get("settings", {})
                holiday_sensor_id = settings.get("holiday_sensor", "")
                if holiday_sensor_id.startswith("calendar."):
                    start = datetime.combine(target_date, time(0, 0), now.tzinfo)
                    end = datetime.combine(target_date, time(23, 59, 59), now.tzinfo)
                    try:
                        response = await self.hass.services.async_call(
                            "calendar",
                            "get_events",
                            {
                                "entity_id": holiday_sensor_id,
                                "start_date_time": start.isoformat(),
                                "end_date_time": end.isoformat(),
                            },
                            blocking=True,
                            return_response=True,
                        )
                        if response and holiday_sensor_id in response:
                            events = response[holiday_sensor_id].get("events", [])
                            for ev in events:
                                ev_end = ev.get("end", "")
                                # Home Assistant all-day events end at 00:00:00 of the next day (e.g. YYYY-MM-DD)
                                if len(ev_end) == 10 and ev_end == target_date.isoformat():
                                    continue
                                is_holiday = True
                                break
                    except Exception as e:
                        pass
                elif "workday" in holiday_sensor_id.lower():
                    if target_date == now.date():
                        sensor_state = self.hass.states.get(holiday_sensor_id)
                        if sensor_state and sensor_state.state.lower() == "off":
                            is_holiday = True
                elif holiday_sensor_id:
                    if target_date == now.date():
                        sensor_state = self.hass.states.get(holiday_sensor_id)
                        if sensor_state and sensor_state.state.lower() == "on":
                            is_holiday = True
                            
            if day_offset == 0:
                self.store.data["today_is_holiday"] = is_holiday
            else:
                self.store.data["tomorrow_is_holiday"] = is_holiday

        self.hass.bus.async_fire("smarthome_companion_blinds_updated")

    async def _update_weather_forecast(self):
        settings = self.store.data.get("settings", {})
        weather_entity = settings.get("irrigation_weather_entity", "weather.forecast_home")
        now = dt_util.now()
        
        if getattr(self, "_last_weather_update_hour", None) == now.hour:
            return
            
        try:
            response = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"entity_id": weather_entity, "type": "hourly"},
                blocking=True,
                return_response=True,
            )

            if response and weather_entity in response:
                forecasts = response[weather_entity].get("forecast", [])
                if forecasts:
                    today_temps = []
                    today_hourly = []
                    for f in forecasts:
                        dt_str = f.get("datetime")
                        if dt_str:
                            try:
                                f_dt = dt_util.parse_datetime(dt_str)
                                f_date = f_dt.date()
                                if f_date == now.date() or f_date == (now + timedelta(days=1)).date():
                                    cloud_cov = float(f.get("cloud_coverage", 0))
                                    for t_key in ["temperature", "max_temp", "native_temperature"]:
                                        if t_key in f and f[t_key] is not None:
                                            val = float(f[t_key])
                                            today_hourly.append({"time": f_dt, "temp": val, "cloud": cloud_cov})
                                            if f_date == now.date():
                                                today_temps.append(val)
                                            break
                            except Exception:
                                pass
                    
                    if today_temps:
                        self._today_max_temp = max(today_temps)
                        self._today_max_temp_date = now.date()
                    if today_hourly:
                        self._today_hourly_forecast = today_hourly
                        self._today_hourly_forecast_date = now.date()
                        
                    self._last_weather_update_hour = now.hour
        except Exception as e:
            _LOGGER.warning("Could not fetch weather forecast for blinds heat protection: %s", e)

    async def _regular_loop(self, now):
        # Aktualisiere die Wochenend-/Feiertagslogik zuverlässig während der Stunden 0 und 12
        if now.hour in (0, 12) and self._last_holiday_update_hour != now.hour:
            self._last_holiday_update_hour = now.hour
            await self._update_holidays()
        await self._update_weather_forecast()
        await self._generate_daily_plan(now)
        await self._evaluate_all(is_watchdog_check=False)

    async def _generate_daily_plan(self, now):
        if "blinds_daily_plan" not in self.store.data:
            self.store.data["blinds_daily_plan"] = {}
            
        plan_date = now.date().isoformat()
        if self.store.data.get("blinds_daily_plan_date") == plan_date and not getattr(self, "_force_plan_regeneration", False):
            return
            
        _LOGGER.info("Generating daily shading plan for %s", plan_date)
        
        self.store.data["blinds_daily_plan_date"] = plan_date
        self.store.data["blinds_daily_plan"] = {}
        
        blinds = self.store.get_blinds()
        today_max = getattr(self, "_today_max_temp", None)
        today_hourly = getattr(self, "_today_hourly_forecast", [])
        
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover.") or not config.get("enable_shading", False):
                continue
                
            plan = self._generate_shading_plan(entity_id, config, now.date())
            self.store.data["blinds_daily_plan"][entity_id] = plan
                
        self._force_plan_regeneration = False
        self.hass.async_create_task(self.store.async_save())
        self.hass.bus.async_fire("smarthome_companion_blinds_updated")

    def _generate_shading_plan(self, entity_id, config, plan_date):
        today_hourly = getattr(self, "_today_hourly_forecast", [])
        
        plan_max = None
        plan_hourly = []
        for h in today_hourly:
            if h["time"].date() == plan_date:
                plan_hourly.append(h)
                if plan_max is None or h["temp"] > plan_max:
                    plan_max = h["temp"]
                    
        shading_start_temp = float(self.store.get_blinds().get("_global_shading_start_temp", 24.0))
        shading_max_temp = float(self.store.get_blinds().get("_global_shading_max_temp", 30.0))
        
        trigger_temp = shading_start_temp
        if plan_max is not None and plan_max > shading_start_temp:
            trigger_temp = shading_start_temp - (plan_max - shading_start_temp) * 0.5
            trigger_temp = max(shading_start_temp - 5.0, trigger_temp)
            
        time_temp_exceeds = None
        if plan_hourly:
            for i in range(len(plan_hourly) - 1):
                t1, temp1 = plan_hourly[i]["time"], plan_hourly[i]["temp"]
                t2, temp2 = plan_hourly[i+1]["time"], plan_hourly[i+1]["temp"]
                if temp1 < trigger_temp and temp2 >= trigger_temp:
                    if temp1 == temp2:
                        time_temp_exceeds = t1
                    else:
                        factor = (trigger_temp - temp1) / (max(0.1, temp2 - temp1))
                        diff = t2 - t1
                        time_temp_exceeds = t1 + timedelta(seconds=diff.total_seconds() * factor)
                    break
                elif temp1 >= trigger_temp:
                    time_temp_exceeds = t1
                    break
                    
        cloud_ok = True
        if self.store.get_blinds().get("_global_enable_cloud_check", False) and plan_hourly:
            cloud_sum = 0.0
            cloud_count = 0
            for hour_data in plan_hourly:
                dt = hour_data["time"]
                if 8 <= dt.hour <= 18:
                    cloud_sum += hour_data["cloud"]
                    cloud_count += 1
            if cloud_count > 0:
                avg_cloud = cloud_sum / cloud_count
                max_cloud = float(self.store.get_blinds().get("_global_max_cloud_coverage", 70.0))
                if avg_cloud > max_cloud:
                    cloud_ok = False
                    
        card_dir = config.get("direction", "sueden")
        direction_map = {"norden": "nord", "osten": "ost", "sueden": "sued", "westen": "west"}
        direction = direction_map.get(card_dir, "sued")
        
        sun_intensity = self.sun_manager.forecast_max_intensities.get(direction, 0.0)
        shading_int = config.get("shading_intensity_threshold")
        if shading_int is None:
            shading_int = float(self.store.get_blinds().get(f"_global_shading_intensity_{card_dir}", 600.0))
        else:
            shading_int = float(shading_int)
            
        enters = self.sun_manager.facade_times.get("today", {}).get(direction, {}).get("enters")
        leaves = self.sun_manager.facade_times.get("today", {}).get(direction, {}).get("leaves")
        
        if enters and plan_date > enters.date():
            enters = enters + timedelta(days=(plan_date - enters.date()).days)
            leaves = leaves + timedelta(days=(plan_date - leaves.date()).days)
            
        is_shading = False
        target_position = None
        start_time = None
        end_time = None
        
        if plan_max is not None and plan_max >= shading_start_temp and time_temp_exceeds and enters and leaves and cloud_ok:
            if not self.store.get_blinds().get("_global_enable_solar_intensity_check", False) or sun_intensity >= shading_int:
                start_time = max(enters, time_temp_exceeds)
                if start_time < leaves:
                    is_shading = True
                    end_time = leaves
                    
                    t_factor = (plan_max - shading_start_temp) / max(0.1, shading_max_temp - shading_start_temp)
                    t_factor = max(0.0, min(1.0, t_factor))
                    
                    start_pos = float(config.get("shading_start_position", 40.0))
                    target_pos = float(config.get("shading_target_position", 0.0))
                    target_position = int(start_pos + t_factor * (target_pos - start_pos))
                    
        if is_shading:
            return {
                "shading_active": True,
                "target_position": target_position,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "trigger_temp": trigger_temp,
                "today_max": plan_max,
                "max_intensity": sun_intensity
            }
        else:
            return {
                "shading_active": False,
                "today_max": plan_max,
                "max_intensity": sun_intensity
            }
                
        self._force_plan_regeneration = False
        self.hass.async_create_task(self.store.async_save())
        self.hass.bus.async_fire("smarthome_companion_blinds_updated")

    async def _watchdog_loop(self, now):
        await self._evaluate_all(is_watchdog_check=True)

    async def _async_state_changed(self, event):
        if hasattr(event, "data"):
            data = event.data
        else:
            data = event
            
        entity_id = data.get("entity_id")
        new_state = data.get("new_state")
        if not entity_id or not new_state:
            return
            
        blinds = self.store.get_blinds()
        if entity_id in blinds:
            # We evaluate on cover state changes to instantly intercept ventilation positioning
            await self._evaluate_blind(entity_id, blinds[entity_id], is_watchdog_check=False, is_state_change=True)
            try:
                await self.store.async_save()
            except Exception as e:
                _LOGGER.error("Error saving store after state change for %s: %s", entity_id, e)

    async def _evaluate_all(self, is_watchdog_check=False, force_correction=False):
        blinds = self.store.get_blinds()
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            await self._evaluate_blind(entity_id, config, is_watchdog_check, force_correction=force_correction)
        
        # Save states once after evaluating all blinds (not per-blind)
        try:
            await self.store.async_save()
        except Exception as e:
            _LOGGER.error("Error saving store data after evaluate_all: %s", e)

    async def _evaluate_blind(self, entity_id, config, is_watchdog_check=False, is_state_change=False, force_correction=False):
        """
        Gleiche die konfigurierten UI-Parameter mit dem aktuellen Stand ab und 
        sende Service-Calls an die Rolladen-Aktorik.
        Enthält:
        - Feste / Sonnen-basierte Zeiten
        - Hitzeschutz/Beschattung
        - Lüftungsposition am Morgen
        - Manueller-Überschreibungs-Watchdog
        """
        if entity_id not in self._states:
            self._states[entity_id] = {
                "last_managed_position": None,
                "last_target_position": None,
                "last_known_position": None,
                "ventilation_stopped_today": None,
                "ventilation_initiated_today": None,
                "automatic_transit": False,
                "manual_override_today": None,
                "last_command_time": None,
                "was_offline": False
            }
            
        mem = self._states[entity_id]

        state_obj = self.hass.states.get(entity_id)
        if not state_obj or state_obj.state in ["unavailable", "unknown"]:
            mem["was_offline"] = True
            return
            
        current_position = state_obj.attributes.get("current_position")
        if current_position is None:
            mem["was_offline"] = True
            return
        
        try:
            current_position = int(current_position)
        except ValueError:
            mem["was_offline"] = True
            return
            
        if mem.get("last_known_position") is None:
            mem["last_known_position"] = current_position
        if mem.get("last_managed_position") is None:
            mem["last_managed_position"] = current_position
            
        shutter_was_offline = mem.get("was_offline", False)
        mem["was_offline"] = False
        
        ha_recovering = (dt_util.now() - self._started_at) < timedelta(minutes=15)
        if is_watchdog_check and not (ha_recovering or shutter_was_offline or force_correction):
            return

        now = dt_util.now()
        cover_state = state_obj.state
        
        # Reset manual override if the day has changed
        if mem.get("manual_override_today") and mem.get("manual_override_today") != now.date().isoformat():
            mem["manual_override_today"] = None
            _LOGGER.info("Resetting daily manual override for %s", entity_id)

        # Retrieve manual override configurations (enable_manual_pause is removed and always True)
        enable_manual_pause = True

        override_allow_scheduled = config.get("manual_override_allow_scheduled")
        if override_allow_scheduled is None:
            override_allow_scheduled = self.store.get_blinds().get("_global_manual_override_allow_scheduled", True)
        override_allow_scheduled = bool(override_allow_scheduled)

        override_allow_shading = config.get("manual_override_allow_shading")
        if override_allow_shading is None:
            override_allow_shading = self.store.get_blinds().get("_global_manual_override_allow_shading", True)
        override_allow_shading = bool(override_allow_shading)

        override_allow_watchdog = config.get("manual_override_allow_watchdog")
        if override_allow_watchdog is None:
            override_allow_watchdog = self.store.get_blinds().get("_global_manual_override_allow_watchdog", True)
        override_allow_watchdog = bool(override_allow_watchdog)

        # Handle automatic transit timeout
        last_cmd_time_str = mem.get("last_command_time")
        if last_cmd_time_str and mem.get("automatic_transit", False):
            try:
                last_cmd_time = dt_util.parse_datetime(last_cmd_time_str)
                if last_cmd_time and now - last_cmd_time > timedelta(minutes=3):
                    mem["automatic_transit"] = False
                    _LOGGER.info("Automatic transit timeout for %s, reset transit flag", entity_id)
            except Exception:
                mem["automatic_transit"] = False

        # Idle state position and manual action tracking
        if cover_state not in ["opening", "closing"]:
            if mem.get("automatic_transit", False):
                last_managed = mem.get("last_managed_position", current_position)
                if abs(current_position - last_managed) <= 5:
                    mem["automatic_transit"] = False
                    mem["last_known_position"] = current_position
            else:
                last_known = mem.get("last_known_position")
                if last_known is None:
                    last_known = current_position
                    mem["last_known_position"] = current_position
                
                if abs(current_position - last_known) > 5:
                    if enable_manual_pause:
                        is_opening = current_position > last_known
                        is_manual_ventilation_shading_trigger = False
                        
                        # Custom Logic: If manually opening and shading plan is active and position is 0%
                        plan = self.store.data.get("blinds_daily_plan", {}).get(entity_id, {})
                        if plan.get("shading_active"):
                            s_time_str = plan.get("start_time")
                            if s_time_str:
                                s_time = dt_util.parse_datetime(s_time_str)
                                if s_time and now >= s_time and plan.get("target_position") == 0:
                                    if is_opening and mem.get("ventilation_stopped_today") != now.date().isoformat():
                                        _LOGGER.info("Manual opening during 0%% heat protection detected for %s. Executing ventilation instead of manual override.", entity_id)
                                        is_manual_ventilation_shading_trigger = True
                                        mem["ventilation_initiated_today"] = now.date().isoformat()
                                        ventilation_position = int(config.get("ventilation_position", 59))
                                        self._add_trace(entity_id, "Lüftungsposition gesendet (Manuell)", ventilation_position)
                                        mem["last_managed_position"] = ventilation_position
                                        mem["automatic_transit"] = True
                                        mem["last_command_time"] = now.isoformat()
                                        await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": ventilation_position}, blocking=False, context=Context())
                        
                        if not is_manual_ventilation_shading_trigger:
                            is_morning_ventilation = config.get("enable_ventilation", False) and now.time() <= self._parse_time(config.get("ventilation_until"), time(10, 0))
                            
                            if is_morning_ventilation and is_opening and mem.get("ventilation_stopped_today") != now.date().isoformat():
                                _LOGGER.info("Manual opening during morning ventilation timeframe detected for %s. Not setting manual override.", entity_id)
                            else:
                                mem["manual_override_today"] = now.date().isoformat()
                                _LOGGER.info("Manual override detected for %s. Active for the rest of today", entity_id)
                    mem["last_known_position"] = current_position
        
        last_known_pos = mem.get("last_known_position", current_position)

        # 1. Lüftungsstopp bei manueller oder automatischer Fahrt am Morgen (beim ersten Mal heute)
        vent_until = self._parse_time(config.get("ventilation_until"), time(10, 0))
        is_morning_ventilation_time = config.get("enable_ventilation", False) and now.time() <= vent_until
        ventilation_position = int(config.get("ventilation_position", 59))

        # Backup-Sicherheit: Wenn zum ersten Mal am Morgen ein Öffnungsversuch erkannt wird,
        # senden wir direkt den Befehl, gezielt auf die Lüftungsposition zu fahren.
        if is_morning_ventilation_time and mem.get("ventilation_initiated_today") != now.date().isoformat():
            is_opening_detected = False
            if cover_state == "opening":
                is_opening_detected = True
            elif last_known_pos is not None and current_position > last_known_pos:
                is_opening_detected = True
                
            if is_opening_detected and current_position < ventilation_position:
                mem["ventilation_initiated_today"] = now.date().isoformat()
                self._add_trace(entity_id, "Lüftungsposition gesendet (Präventiv)", ventilation_position)
                if mem.get("ventilation_logged_today") != now.date().isoformat():
                    await self._log_to_logbook(entity_id, "Der Rollladen wird gelüftet.")
                    mem["ventilation_logged_today"] = now.date().isoformat()
                mem["last_managed_position"] = ventilation_position
                mem["automatic_transit"] = True
                mem["last_command_time"] = now.isoformat()
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": ventilation_position}, blocking=False, context=Context())

        if is_morning_ventilation_time and mem.get("ventilation_stopped_today") != now.date().isoformat():
            is_crossing = False
            if cover_state == "opening" and current_position >= (ventilation_position - 3):
                is_crossing = True
            elif last_known_pos is not None and last_known_pos < ventilation_position and current_position >= ventilation_position:
                is_crossing = True

            if is_crossing:
                is_manual = cover_state != "opening" and abs(mem.get("last_managed_position", current_position) - current_position) > 5
                reason = "Lüftungsstopp (manuell)" if is_manual else "Lüftungsstopp"
                
                self._add_trace(entity_id, reason, ventilation_position)
                mem["last_managed_position"] = ventilation_position
                mem["ventilation_stopped_today"] = now.date().isoformat()
                
                if mem.get("ventilation_logged_today") != now.date().isoformat():
                    await self._log_to_logbook(entity_id, "Der Rollladen wird gelüftet.")
                    mem["ventilation_logged_today"] = now.date().isoformat()
                mem["automatic_transit"] = False
                mem["last_known_position"] = current_position
                await self.hass.services.async_call("cover", "stop_cover", {"entity_id": entity_id}, blocking=False, context=Context())
                return

        has_active_override = mem.get("manual_override_today") == now.date().isoformat()

        times = self.calculate_times(entity_id, config)
        open_time_dt = times["open_time"]
        close_time_dt = times["close_time"]

        target_position = 100
        action_type = "open"
        
        is_night = False
        if open_time_dt <= close_time_dt:
            if now < open_time_dt or now >= close_time_dt:
                is_night = True
        else:
            if now >= close_time_dt and now < open_time_dt:
                is_night = True
                
        if is_night:
            target_position = 0
            action_type = "close"
        else:
            # Daytime Logic
            plan = self.store.data.get("blinds_daily_plan", {}).get(entity_id, {})
            is_shading = plan.get("shading_active", False)
            shading_target = plan.get("target_position", 0)
            shading_start = None
            shading_end = None
            if is_shading:
                shading_start = dt_util.parse_datetime(plan.get("start_time"))
                shading_end = dt_util.parse_datetime(plan.get("end_time"))
            
            is_shading_time = is_shading and shading_start and shading_end and shading_start <= now < shading_end
            
            # Lüftung Morgens
            vent_until = self._parse_time(config.get("ventilation_until"), time(10, 0))
            is_morning_ventilation = config.get("enable_ventilation", False) and now.time() <= vent_until
            
            if is_morning_ventilation:
                ventilation_pos = int(config.get("ventilation_position", 59))
                # Fall B: Hitze ist schon da
                if is_shading_time:
                    if ventilation_pos < shading_target:
                        # Lüftung ist weiter ZU als Hitzeschutz: Erst lüften
                        target_position = ventilation_pos
                        action_type = "ventilation"
                    else:
                        # Lüftung ist weiter AUF als Hitzeschutz: Überspringen
                        target_position = shading_target
                        action_type = "shading"
                        mem["shading_log_details"] = {
                            "Temperatur Max Heute": f"{plan.get('today_max')} °C",
                            "Sonnenintensität": f"{plan.get('max_intensity'):.0f} W/m²"
                        }
                else:
                    target_position = ventilation_pos
                    action_type = "ventilation"
            else:
                if is_shading_time:
                    target_position = shading_target
                    action_type = "shading"
                    mem["shading_log_details"] = {
                        "Temperatur Max Heute": f"{plan.get('today_max')} °C",
                        "Sonnenintensität": f"{plan.get('max_intensity'):.0f} W/m²"
                    }
                else:
                    target_position = 100
                    action_type = "open"

        last_target_pos = mem.get("last_target_position")
        mem["last_target_position"] = target_position
        
        is_transition = last_target_pos is not None and last_target_pos != target_position
        
        # Evaluate manual override exceptions
        if has_active_override:
            allow_bypass = False
            
            # Exception 1: Scheduled closing times
            if is_transition and action_type in ["open", "close", "ventilation", "heat_protection_close"]:
                if override_allow_scheduled:
                    # Only bypass manual overrides when the schedule says to close (night time or heat protection close).
                    if action_type in ["close", "heat_protection_close"]:
                        allow_bypass = True
                        mem["manual_override_today"] = None
                        _LOGGER.info("Bypassing manual override for scheduled close action on %s", entity_id)
                    
            # Exception 2: Shading activated or deactivated (transition to or from shading)
            elif is_transition and (action_type == "shading" or last_target_pos == int(config.get("shading_position", 30))):
                if override_allow_shading:
                    allow_bypass = True
                    mem["manual_override_today"] = None
                    _LOGGER.info("Bypassing manual override for shading action on %s", entity_id)
                    
            # Exception 3: Watchdog error correction (when offline/recovering etc.)
            elif is_watchdog_check and override_allow_watchdog:
                ha_recovering = (dt_util.now() - self._started_at) < timedelta(minutes=15)
                if ha_recovering or shutter_was_offline or force_correction:
                    allow_bypass = True
                    _LOGGER.info(
                        "Bypassing manual override for watchdog error correction on %s (HA recovering: %s, shutter was offline: %s, forced: %s)",
                        entity_id, ha_recovering, shutter_was_offline, force_correction
                    )

            if not allow_bypass:
                # Manual override blocks automation changes
                return


        # Automatisierung und Watchdog
        settings = self.store.data.get("settings", {})
        if action_type in ["open", "close"]:
            position_threshold = 0
        else:
            position_threshold = int(settings.get("position_threshold", 5))

        if abs(current_position - target_position) > position_threshold:
            # Wenn es eine reguläre scheduled Automation Transition ist
            if is_transition:
                self._add_trace(entity_id, "Automation", target_position)
                mem["last_managed_position"] = target_position
                mem["automatic_transit"] = True
                mem["last_command_time"] = now.isoformat()
                await self._log_action(entity_id, action_type, target_position, is_watchdog_check=False)
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": target_position}, blocking=False, context=Context())
            # Wenn es ein Watchdog-Check ist, wird die Position als Fallback korrigiert
            elif is_watchdog_check:
                self._add_trace(entity_id, "Watchdog: Position korrigiert", target_position)
                mem["last_managed_position"] = target_position
                mem["automatic_transit"] = True
                mem["last_command_time"] = now.isoformat()
                await self._log_action(entity_id, action_type, target_position, is_watchdog_check=True)
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": target_position}, blocking=False, context=Context())
        elif is_watchdog_check:
            # Watchdog successfully verifying correct state (no log trace)
            pass

        # States are saved once in _evaluate_all after all blinds are processed
