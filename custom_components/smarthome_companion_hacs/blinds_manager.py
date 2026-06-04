import logging
import uuid
from datetime import timedelta, datetime, time
import homeassistant.util.dt as dt_util
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
from homeassistant.core import Context, callback
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# A stable context that makes HA logbook show our integration as the actor.
# Using a fixed UUID means all actions are attributed to the same "user" (integration).
_INTEGRATION_CONTEXT_ID = "smarthome-companion-hacs-automation"

def _make_context():
    """Return a Context that HA logbook will attribute to SmartHome Companion HACS."""
    return Context(
        id=str(uuid.uuid4()),
        parent_id=_INTEGRATION_CONTEXT_ID,
        user_id=None,
    )

class BlindsManager:
    def __init__(self, hass, store, sun_manager):
        self.hass = hass
        self.store = store
        self.sun_manager = sun_manager
        self._watchdog_unsub = None
        self._state_listener_unsub = None
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

    async def async_setup(self):
        settings = self.store.data.get("settings", {})
        interval_min = int(settings.get("watchdog_interval", 1))
        if interval_min < 1: interval_min = 1
        self._watchdog_unsub = async_track_time_interval(self.hass, self._watchdog_loop, timedelta(minutes=interval_min))
        self._state_listener_unsub = async_track_state_change_event(self.hass, [], self._async_state_changed)

    async def async_reload(self):
        _LOGGER.info("Blinds Manager reloading config...")
        
        settings = self.store.data.get("settings", {})
        interval_min = int(settings.get("watchdog_interval", 1))
        if interval_min < 1: interval_min = 1
        
        if self._watchdog_unsub:
            self._watchdog_unsub()
        self._watchdog_unsub = async_track_time_interval(self.hass, self._watchdog_loop, timedelta(minutes=interval_min))
        
        if self._state_listener_unsub:
            self._state_listener_unsub()
        self._state_listener_unsub = async_track_state_change_event(self.hass, [], self._async_state_changed)
        
        # Will be called when new config comes from UI
        self.hass.bus.async_fire("smarthome_companion_blinds_updated")
        await self._evaluate_all()

    async def _watchdog_loop(self, now):
        await self._evaluate_all()

    async def _evaluate_all(self):
        blinds = self.store.get_blinds()
        for entity_id, config in blinds.items():
            if entity_id not in self._states:
                self._states[entity_id] = {
                    "last_managed_position": -1,
                    "override_until": None,
                    "last_intention": None,
                    "ventilation_date": None,
                    "last_phase": None,
                    "pause_executed_intentions": set()
                }
            await self._evaluate_blind(entity_id, config)

    @callback
    def _async_state_changed(self, event):
        entity_id = event.data.get("entity_id")
        if not entity_id or not entity_id.startswith("cover."):
            return
            
        blinds = self.store.get_blinds()
        if entity_id not in blinds:
            return
            
        config = blinds[entity_id]
        if not config.get("enable_ventilation", False):
            return
            
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        
        if not new_state or not old_state:
            return

        now = dt_util.now()
        
        # Helper: Zeit parsen
        def parse_time(t_str, default):
            if not t_str: return default
            try:
                parts = t_str.split(':')
                return time(int(parts[0]), int(parts[1]))
            except Exception:
                return default

        vent_until = parse_time(config.get("ventilation_until"), time(10, 0))
        if now.time() > vent_until:
            return
            
        if entity_id not in self._states:
            self._states[entity_id] = {
                "last_managed_position": -1,
                "override_until": None,
                "last_intention": None,
                "ventilation_date": None
            }
            
        mem = self._states[entity_id]
        if mem.get("ventilation_date") == now.date():
            return
            
        try:
            current_pos = int(new_state.attributes.get("current_position", 0))
            old_pos = int(old_state.attributes.get("current_position", 0))
        except (ValueError, TypeError):
            return
            
        target_vent_pos = int(config.get("ventilation_position", 59))
        
        is_opening = new_state.state == "opening" or (current_pos > old_pos and abs(current_pos - old_pos) >= 1)
        
        if is_opening and current_pos >= target_vent_pos:
            mem["ventilation_date"] = now.date()
            mem["last_managed_position"] = current_pos
            self._add_trace(entity_id, "Lüftungsstopp", current_pos, "Manuell/Auto erkannt und gestoppt")
            
            # Fire and forget stop
            self.hass.async_create_task(
                self.hass.services.async_call(
                    "cover",
                    "stop_cover",
                    {"entity_id": entity_id},
                    blocking=False,
                    context=_make_context()
                )
            )

    async def _evaluate_blind(self, entity_id, config):
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
        
        if not hasattr(self, "_states"):
            self._states = {}
            
        if entity_id not in self._states:
            self._states[entity_id] = {
                "last_managed_position": current_position,
                "override_until": None,
                "last_intention": None,
                "ventilation_date": None,
                "last_phase": None,
                "pause_executed_intentions": set()
            }
            
        mem = self._states[entity_id]
        if mem.get("pause_executed_intentions") is None:
            mem["pause_executed_intentions"] = set()
            
        if mem["last_managed_position"] == -1:
            mem["last_managed_position"] = current_position
        
        # Manuelle Bedienung erkennen
        enable_manual_pause = config.get("enable_manual_pause", True)
        pause_until_next_event = config.get("pause_until_next_event", True)
        manual_pause_duration = config.get("manual_pause_duration", 60)
        
        if abs(mem["last_managed_position"] - current_position) > 5:
            if enable_manual_pause:
                if pause_until_next_event:
                    mem["override_until"] = "next_event"
                    mem["pause_executed_intentions"] = set()
                else:
                    mem["override_until"] = now + timedelta(minutes=int(manual_pause_duration))
            mem["last_managed_position"] = current_position

        # Helper
        def parse_time(t_str, default):
            if not t_str: return default
            try:
                parts = t_str.split(':')
                return time(int(parts[0]), int(parts[1]))
            except Exception:
                return default

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

        # Öffnungszeit kalkulieren
        open_time_dt = None
        
        is_weekend = now.weekday() >= 5
        if config.get("enable_weekend_open", False) and is_weekend:
            ot = parse_time(config.get("weekend_open_time"), time(8, 30))
            open_time_dt = get_dt(ot)
        elif config.get("use_fixed_open_time", False):
            ot = parse_time(config.get("fixed_open_time"), time(7, 0))
            open_time_dt = get_dt(ot)
        elif config.get("use_sunrise", False):
            sun_next_rising = self.hass.states.get("sun.sun").attributes.get("next_rising")
            if sun_next_rising:
                rt = dt_util.parse_datetime(sun_next_rising)
                if rt:
                    rt_local = dt_util.as_local(rt)
                    open_time_dt = datetime.combine(now.date(), rt_local.time(), now.tzinfo)
                    open_time_dt += timedelta(minutes=config.get("sunrise_offset", 0))
                    eot = parse_time(config.get("earliest_open_time"), time(6, 0))
                    lot = parse_time(config.get("latest_open_time"), time(9, 0))
                    open_time_dt = clamp_time(open_time_dt, eot, lot)

        if not open_time_dt:
            open_time_dt = get_dt(time(7, 0))

        # Schließzeit kalkulieren
        close_time_dt = None
        if config.get("use_fixed_close_time", False):
            ct = parse_time(config.get("fixed_close_time"), time(22, 0))
            close_time_dt = get_dt(ct)
        elif config.get("use_sunset", False):
            sun_next_setting = self.hass.states.get("sun.sun").attributes.get("next_setting")
            if sun_next_setting:
                st = dt_util.parse_datetime(sun_next_setting)
                if st:
                    st_local = dt_util.as_local(st)
                    close_time_dt = datetime.combine(now.date(), st_local.time(), now.tzinfo)
                    close_time_dt += timedelta(minutes=config.get("sunset_offset", 0))
                    ect = parse_time(config.get("earliest_close_time"), time(18, 0))
                    lct = parse_time(config.get("latest_close_time"), time(23, 0))
                    close_time_dt = clamp_time(close_time_dt, ect, lct)

        if not close_time_dt:
            close_time_dt = get_dt(time(22, 0))

        target_position = 100
        
        is_night = False
        if open_time_dt <= close_time_dt:
            if now < open_time_dt or now >= close_time_dt:
                is_night = True
        else:
            if now >= close_time_dt and now < open_time_dt:
                is_night = True
                
        # Determine semantic intention for the trace
        intention = "Öffnen"
        if is_night:
            target_position = 0
            intention = "Schließen"
        else:
            # Lüftung Morgens
            vent_until = parse_time(config.get("ventilation_until"), time(10, 0))
            if config.get("enable_ventilation", False) and now.time() <= vent_until and mem.get("ventilation_date") != now.date():
                target_position = int(config.get("ventilation_position", 59))
                intention = "Lüftung"
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
                            intention = "Beschatten"
                            
                if intention == "Öffnen":
                    target_position = 100
                    if mem.get("last_intention") == "Beschatten":
                        intention = "Beschattung aufheben"

        current_phase = "Nacht" if is_night else "Tag"
        if mem.get("last_phase") is None:
            mem["last_phase"] = current_phase
            
        if mem.get("last_phase") != current_phase:
            if mem.get("override_until") == "next_event":
                mem["override_until"] = None
            mem["pause_executed_intentions"] = set()
            mem["last_phase"] = current_phase

        if mem["override_until"]:
            if mem["override_until"] == "next_event":
                allowed_exceptions = []
                if config.get("exc_shading", True): allowed_exceptions.append("Beschatten")
                if config.get("exc_unshading", True): allowed_exceptions.append("Beschattung aufheben")
                if config.get("exc_ventilation", True): allowed_exceptions.append("Lüftung")
                
                if intention in allowed_exceptions and intention not in mem["pause_executed_intentions"]:
                    mem["pause_executed_intentions"].add(intention)
                else:
                    mem["last_intention"] = intention
                    return
            else:
                if now < mem["override_until"]:
                    mem["last_intention"] = intention
                    return
                else:
                    mem["override_until"] = None

        mem["last_intention"] = intention

        if abs(current_position - target_position) > 5:
            if intention == "Lüftung":
                mem["ventilation_date"] = now.date()
                
            mem["last_managed_position"] = target_position
            # Record trace BEFORE calling service
            self._add_trace(entity_id, intention, target_position)
            _LOGGER.debug(
                "SmartHome Companion: %s → %s%% (Intention: %s)",
                entity_id, target_position, intention,
            )
            # Use our branded context so HA logbook shows "SmartHome Companion HACS"
            await self.hass.services.async_call(
                "cover",
                "set_cover_position",
                {"entity_id": entity_id, "position": target_position},
                blocking=False,
                context=_make_context(),
            )
        else:
            # No movement needed — still record a "no-op" trace so UI shows watchdog ran
            self._add_trace(entity_id, intention, target_position, state="Keine Änderung nötig")