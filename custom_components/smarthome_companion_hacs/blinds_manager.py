import logging
from datetime import timedelta, datetime, time
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
from homeassistant.core import Context
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
        self._states = {}

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
        if action_type == "open":
            msg = f"geöffnet von der Integration um der Öffnungszeit nachzugehen{suffix}."
        elif action_type == "close":
            msg = f"geschlossen von der Integration um der Schließzeit nachzugehen{suffix}."
        elif action_type == "shading":
            msg = f"von der Integration auf Beschattungsposition ({target_position}%) gefahren{suffix}."
        elif action_type == "ventilation":
            msg = f"von der Integration auf Lüftungsposition ({target_position}%) gefahren{suffix}."
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

    def calculate_times(self, entity_id, config):
        import random
        now = dt_util.now()
        date_str = now.date().isoformat()
        
        def get_dt(t):
            return datetime.combine(now.date(), t, now.tzinfo)

        def clamp_time(dt_val, e_t, l_t):
            if e_t:
                edt = get_dt(e_t)
                if dt_val < edt: dt_val = edt
            if l_t:
                ldt = get_dt(l_t)
                if dt_val > ldt: dt_val = ldt
            return dt_val

        # 1. Basis-Öffnungszeit kalkulieren
        base_open_time_dt = None
        sunrise_time_dt = None
        if config.get("use_fixed_open_time", False):
            ot = self._parse_time(config.get("fixed_open_time"), time(7, 0))
            base_open_time_dt = get_dt(ot)
        elif config.get("use_sunrise", False):
            sun_sun = self.hass.states.get("sun.sun")
            sun_next_rising = sun_sun.attributes.get("next_rising") if sun_sun else None
            if sun_next_rising:
                rt = dt_util.parse_datetime(sun_next_rising)
                if rt:
                    rt_local = dt_util.as_local(rt)
                    sunrise_time_dt = datetime.combine(now.date(), rt_local.time(), now.tzinfo)
                    sunrise_time_dt += timedelta(minutes=config.get("sunrise_offset", 0))
                    eot = self._parse_time(config.get("earliest_open_time"), time(6, 0))
                    lot = self._parse_time(config.get("latest_open_time"), time(9, 0))
                    sunrise_time_dt = clamp_time(sunrise_time_dt, eot, lot)
                    base_open_time_dt = sunrise_time_dt

        if not base_open_time_dt:
            base_open_time_dt = get_dt(time(7, 0))

        # 2. Basis-Schließzeit kalkulieren
        base_close_time_dt = None
        sunset_time_dt = None
        if config.get("use_fixed_close_time", False):
            ct = self._parse_time(config.get("fixed_close_time"), time(22, 0))
            base_close_time_dt = get_dt(ct)
        elif config.get("use_sunset", False):
            sun_sun = self.hass.states.get("sun.sun")
            sun_next_setting = sun_sun.attributes.get("next_setting") if sun_sun else None
            if sun_next_setting:
                st = dt_util.parse_datetime(sun_next_setting)
                if st:
                    st_local = dt_util.as_local(st)
                    sunset_time_dt = datetime.combine(now.date(), st_local.time(), now.tzinfo)
                    sunset_time_dt += timedelta(minutes=config.get("sunset_offset", 0))
                    ect = self._parse_time(config.get("earliest_close_time"), time(18, 0))
                    lct = self._parse_time(config.get("latest_close_time"), time(23, 0))
                    sunset_time_dt = clamp_time(sunset_time_dt, ect, lct)
                    base_close_time_dt = sunset_time_dt

        if not base_close_time_dt:
            base_close_time_dt = get_dt(time(22, 0))

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
        await self._async_setup_schedulers()
        
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

    async def _regular_loop(self, now):
        await self._evaluate_all(is_watchdog_check=False)

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

    async def _evaluate_all(self, is_watchdog_check=False):
        blinds = self.store.get_blinds()
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            await self._evaluate_blind(entity_id, config, is_watchdog_check)

    async def _evaluate_blind(self, entity_id, config, is_watchdog_check=False, is_state_change=False):
        """
        Gleiche die konfigurierten UI-Parameter mit dem aktuellen Stand ab und 
        sende Service-Calls an die Rolladen-Aktorik.
        Enthält:
        - Feste / Sonnen-basierte Zeiten
        - Hitzeschutz/Beschattung
        - Lüftungsposition am Morgen
        - Manueller-Überschreibungs-Watchdog
        """
        state_obj = self.hass.states.get(entity_id)
        if not state_obj:
            return
            
        current_position = state_obj.attributes.get("current_position")
        if current_position is None:
            return
        
        try:
            current_position = int(current_position)
        except ValueError:
            return
            
        now = dt_util.now()
        
        if entity_id not in self._states:
            self._states[entity_id] = {
                "last_managed_position": current_position,
                "override_until": None,
                "last_target_position": None,
                "last_known_position": current_position,
                "ventilation_stopped_today": None,
                "ventilation_initiated_today": None
            }
            
        mem = self._states[entity_id]
        
        last_known_pos = mem.get("last_known_position")
        if last_known_pos is None:
            last_known_pos = current_position
        mem["last_known_position"] = current_position
        
        cover_state = state_obj.state
        
        # Manuelle Bedienung erkennen
        enable_manual_pause = config.get("enable_manual_pause", True)
        manual_pause_duration = config.get("manual_pause_duration", 60)
        
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
                
            if is_opening_detected:
                mem["ventilation_initiated_today"] = now.date().isoformat()
                self._add_trace(entity_id, "Lüftungsposition gesendet (Präventiv)", ventilation_position)
                # Command cover to open precisely to the ventilation position directly
                await self._log_to_logbook(entity_id, f"präventiv von der Integration auf Lüftungsposition ({ventilation_position}%) gefahren.")
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": ventilation_position}, blocking=False, context=Context())

        if is_morning_ventilation_time and mem.get("ventilation_stopped_today") != now.date().isoformat():
            is_crossing = False
            # Check if active opening near or already past/above the ventilation target
            if cover_state == "opening" and current_position >= (ventilation_position - 3):
                is_crossing = True
            # Check if position rose above ventilation position from a previous lower position (even if it skipped exactly matching range)
            elif last_known_pos is not None and last_known_pos < ventilation_position and current_position >= ventilation_position:
                is_crossing = True

            if is_crossing:
                # Deduce if this is manual or scheduled
                is_manual = cover_state != "opening" and abs(mem.get("last_managed_position", current_position) - current_position) > 5
                reason = "Lüftungsstopp (manuell)" if is_manual else "Lüftungsstopp"
                
                self._add_trace(entity_id, reason, ventilation_position)
                mem["last_managed_position"] = ventilation_position
                mem["ventilation_stopped_today"] = now.date().isoformat()
                
                # Stop cover command as a hard block intercept
                await self._log_to_logbook(entity_id, "von der Integration angehalten (Lüftungsstopp).")
                await self.hass.services.async_call("cover", "stop_cover", {"entity_id": entity_id}, blocking=False, context=Context())
                mem["override_until"] = now + timedelta(minutes=int(manual_pause_duration))
                return

        # 2. Reguläre manuelle Bedienung erkennen und sperren
        if abs(mem.get("last_managed_position", current_position) - current_position) > 5:
            if enable_manual_pause:
                mem["override_until"] = now + timedelta(minutes=int(manual_pause_duration))
            mem["last_managed_position"] = current_position
            
        if mem.get("override_until"):
            if now < mem["override_until"]:
                return  # Skip, da manuell manipuliert/gesperrt
            else:
                mem["override_until"] = None

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
            # Lüftung Morgens
            vent_until = self._parse_time(config.get("ventilation_until"), time(10, 0))
            if config.get("enable_ventilation", False) and now.time() <= vent_until:
                target_position = int(config.get("ventilation_position", 59))
                action_type = "ventilation"
            else:
                # Beschattung
                if config.get("enable_shading", False):
                    direction = config.get("cardinal_direction", "sued").lower()
                    sun_intensity = self.sun_manager.intensities.get(direction, 0.0)
                    
                    temp = 20.0
                    weather = self.hass.states.get("weather.forecast_home")
                    if weather and "temperature" in weather.attributes:
                        try:
                            temp = float(weather.attributes["temperature"])
                        except ValueError:
                            pass
                            
                    shading_temp = float(config.get("shading_temp_threshold", 24.0))
                    shading_int = float(config.get("shading_intensity_threshold", 600.0))
                    sun_azimuth = float(self.hass.states.get("sun.sun").attributes.get("azimuth", 0))
                    sun_elevation = float(self.hass.states.get("sun.sun").attributes.get("elevation", 0))
                    
                    azi_min = float(config.get("shading_azimuth_min", 0))
                    azi_max = float(config.get("shading_azimuth_max", 360))
                    ele_min = float(config.get("shading_elevation_min", 0))
                    
                    if (temp >= shading_temp and sun_intensity >= shading_int and sun_elevation >= ele_min):
                        if azi_min < azi_max:
                            in_azimuth = (azi_min <= sun_azimuth <= azi_max)
                        else:
                            in_azimuth = (sun_azimuth >= azi_min or sun_azimuth <= azi_max)
                            
                        if in_azimuth:
                            target_position = int(config.get("shading_position", 30))
                            action_type = "shading"
                            
        # Transition and watchdog logs decoupling
        last_target_pos = mem.get("last_target_position")
        mem["last_target_position"] = target_position
        
        is_transition = last_target_pos is not None and last_target_pos != target_position
        
        # Automatisierung und Watchdog
        if abs(current_position - target_position) > 5:
            # Wenn es eine reguläre scheduled Automation Transition ist
            if is_transition:
                self._add_trace(entity_id, "Automation", target_position)
                mem["last_managed_position"] = target_position
                await self._log_action(entity_id, action_type, target_position, is_watchdog_check=False)
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": target_position}, blocking=False, context=Context())
            # Wenn es ein Watchdog-Check ist, wird die Position als Fallback korrigiert
            elif is_watchdog_check:
                self._add_trace(entity_id, "Watchdog: Position korrigiert", target_position)
                mem["last_managed_position"] = target_position
                await self._log_action(entity_id, action_type, target_position, is_watchdog_check=True)
                await self.hass.services.async_call("cover", "set_cover_position", {"entity_id": entity_id, "position": target_position}, blocking=False, context=Context())
        elif is_watchdog_check:
            # Watchdog successfully verifying correct state (no log trace)
            pass
