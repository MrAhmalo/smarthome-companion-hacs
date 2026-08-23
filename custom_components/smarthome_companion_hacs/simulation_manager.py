import logging
from homeassistant.helpers.event import async_track_state_change_event

_LOGGER = logging.getLogger(__name__)

class SimulationManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self._unsub_triggers = None
        self._is_active = False

    async def async_setup(self):
        await self.async_reload_config()

    async def async_reload_config(self):
        if self._unsub_triggers:
            self._unsub_triggers()
            self._unsub_triggers = None

        config = self.store.data.get("simulation", {})
        enabled = config.get("enabled", False)
        triggers = config.get("triggers", [])
        
        if not enabled or not triggers:
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

    def _check_triggers(self, trigger_entities):
        active = False
        for entity_id in trigger_entities:
            state = self.hass.states.get(entity_id)
            if state:
                # E.g. armed_away, armed_vacation for alarm, or 'on' for switch/input_boolean
                if state.state in ['armed_away', 'armed_vacation', 'on']:
                    active = True
                    break
        self._set_simulation_active(active)

    def _set_simulation_active(self, active: bool):
        if self._is_active == active:
            return
        
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
                
        if active:
            _LOGGER.info("Presence simulation ACTIVATED")
            if light_entities:
                _LOGGER.info("Starting presence_simulation for %s", light_entities)
                self.hass.async_create_task(
                    self.hass.services.async_call(
                        "presence_simulation", "start",
                        {"entity_id": light_entities}
                    )
                )
        else:
            _LOGGER.info("Presence simulation DEACTIVATED")
            if light_entities:
                _LOGGER.info("Stopping presence_simulation")
                self.hass.async_create_task(
                    self.hass.services.async_call("presence_simulation", "stop")
                )
    @property
    def is_active(self):
        return self._is_active

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
