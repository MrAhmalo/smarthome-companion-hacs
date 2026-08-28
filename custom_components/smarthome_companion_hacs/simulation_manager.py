import logging
# pyrefly: ignore [missing-import]
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class SimulationManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self._unsub_triggers = None
        self._is_active = False
        self._active_triggers = []

    async def async_setup(self):
        await self.async_reload_config()

        # Re-check triggers once Home Assistant is completely started
        async def _on_ha_started(event):
            config = self.store.data.get("simulation", {})
            triggers = [t.get("entityId") for t in config.get("triggers", []) if t.get("entityId")]
            if triggers:
                self._check_triggers(triggers)

        self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_ha_started)

    async def async_reload_config(self):
        if self._unsub_triggers:
            self._unsub_triggers()
            self._unsub_triggers = None

        config = self.store.data.get("simulation", {})
        enabled = config.get("enabled", False)
        triggers = config.get("triggers", [])
        
        if not enabled or not triggers:
            self._active_triggers = []
            self._set_simulation_active(False)
            return

        trigger_entities = [t.get("entityId") for t in triggers if t.get("entityId")]
        
        if trigger_entities:
            self._unsub_triggers = async_track_state_change_event(
                self.hass, trigger_entities, self._handle_trigger_state_change
            )
            # Check current state
            self._check_triggers(trigger_entities)

    def _handle_trigger_state_change(self, event):
        config = self.store.data.get("simulation", {})
        triggers = [t.get("entityId") for t in config.get("triggers", []) if t.get("entityId")]
        self._check_triggers(triggers)

    def _is_trigger_active(self, entity_id: str) -> bool:
        state = self.hass.states.get(entity_id)
        if not state or state.state in ['unavailable', 'unknown']:
            return False
        st = str(state.state).lower().strip()
        # Alarm states (all active arming modes + custom vacation/away)
        if st in ['armed_away', 'armed_vacation', 'armed_night', 'armed_home', 'armed_custom_bypass', 'vacation', 'away']:
            return True
        if 'vacation' in st or 'away' in st or 'urlaub' in st:
            return True
        # Standard boolean / switch / binary sensor / presence states
        if st in ['on', 'true', 'home', 'active']:
            return True
        # Device tracker / person not home
        if st in ['not_home', 'abwesend']:
            return True
        return False

    def _check_triggers(self, trigger_entities):
        config = self.store.data.get("simulation", {})
        enabled = config.get("enabled", False)
        if not enabled:
            self._active_triggers = []
            self._set_simulation_active(False)
            return

        active_triggers = [e for e in trigger_entities if self._is_trigger_active(e)]
        self._active_triggers = active_triggers
        active = len(active_triggers) > 0
        self._set_simulation_active(active)

    def _set_simulation_active(self, active: bool):
        was_active = self._is_active
        self._is_active = active
        
        config = self.store.data.get("simulation", {})
        actions = config.get("actions", [])
        
        light_entities = []
        for action in actions:
            if action.get("categoryId") == "lights":
                mode = action.get("blindsMode", "all")
                ids = action.get("blindIds", [])
                
                if mode == "all":
                    for state in self.hass.states.async_all("light"):
                        light_entities.append(state.entity_id)
                elif mode == "all_except":
                    for state in self.hass.states.async_all("light"):
                        if state.entity_id not in ids:
                            light_entities.append(state.entity_id)
                else:
                    light_entities.extend(ids)
                
        if active and not was_active:
            _LOGGER.info("Presence simulation ACTIVATED (Active triggers: %s)", self._active_triggers)
            if light_entities:
                _LOGGER.info("Starting presence_simulation for %s", light_entities)
                self.hass.async_create_task(
                    self.hass.services.async_call(
                        "presence_simulation", "start",
                        {"entity_id": light_entities}
                    )
                )
        elif not active and was_active:
            _LOGGER.info("Presence simulation DEACTIVATED")
            if light_entities:
                _LOGGER.info("Stopping presence_simulation")
                self.hass.async_create_task(
                    self.hass.services.async_call("presence_simulation", "stop")
                )

        # Notify Home Assistant & Blinds Manager about simulation state update
        self.hass.bus.async_fire("smarthome_companion_simulation_updated")
        self.hass.bus.async_fire("smarthome_companion_blinds_updated")
        
        blinds_mgr = self.hass.data.get(DOMAIN, {}).get("blinds_manager")
        if blinds_mgr:
            self.hass.async_create_task(blinds_mgr._evaluate_all(is_watchdog_check=False))

    @property
    def is_active(self):
        return self._is_active

    @property
    def active_triggers(self):
        return self._active_triggers

    def get_blind_config(self, entity_id):
        if not self._is_active:
            return None
            
        config = self.store.data.get("simulation", {})
        actions = config.get("actions", [])
        
        for action in actions:
            if action.get("categoryId") == "blinds":
                mode = action.get("blindsMode", "all")
                ids = action.get("blindIds", [])
                
                applies = False
                if mode == "all":
                    applies = True
                elif mode == "all_except":
                    applies = entity_id not in ids
                elif mode == "only":
                    applies = entity_id in ids
                    
                if applies:
                    return action
        return None
