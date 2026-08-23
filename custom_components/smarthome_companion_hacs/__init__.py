import logging
from homeassistant.core import HomeAssistant, callback
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .store import CompanionStore
from .ws_api import async_register_websockets
from .blinds_manager import BlindsManager
from .sun_manager import SunManager
from .irrigation_manager import IrrigationManager
from .adaptive_light_manager import AdaptiveLightManager
from .simulation_manager import SimulationManager

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the component (YAML)."""
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the SmartHome Companion HACS component from a config entry."""
    _LOGGER.info(f"Setting up SmartHome Companion Backend ({entry.title})")

    hass.data.setdefault(DOMAIN, {})

    if "store" not in hass.data[DOMAIN]:
        store = CompanionStore(hass)
        await store.async_load()
        sun_manager = SunManager(hass, store)
        
        hass.data[DOMAIN]["store"] = store
        hass.data[DOMAIN]["sun_manager"] = sun_manager
        
        async_register_websockets(hass)
        await sun_manager.async_setup()

        async def handle_set_sleep_in(call):
            entity_ids = call.data.get("entity_ids", [])
            active = call.data.get("active", True)
            
            import homeassistant.util.dt as dt_util
            from datetime import timedelta
            
            now = dt_util.now()
            target_date = now.date()
            if now.hour >= 12:
                target_date = target_date + timedelta(days=1)
                
            target_date_str = target_date.isoformat() if active else None
            
            s = hass.data[DOMAIN]["store"]
            blinds = s.get_blinds()
            updated = False
            
            for eid in entity_ids:
                if eid in blinds:
                    if blinds[eid].get("sleep_in_date") != target_date_str:
                        blinds[eid]["sleep_in_date"] = target_date_str
                        updated = True
                        
            if updated:
                await s.async_save(s.data)
                await hass.data[DOMAIN]["blinds_manager"].async_reload()
                
        hass.services.async_register(DOMAIN, "set_sleep_in", handle_set_sleep_in)

    store = hass.data[DOMAIN]["store"]
    sun_manager = hass.data[DOMAIN]["sun_manager"]

    module = entry.data.get("module", "legacy")

    if module in ("blinds", "legacy"):
        if "blinds_manager" not in hass.data[DOMAIN]:
            blinds_manager = BlindsManager(hass, store, sun_manager)
            hass.data[DOMAIN]["blinds_manager"] = blinds_manager
            await blinds_manager.async_setup()

    if module in ("irrigation", "legacy"):
        if "irrigation_manager" not in hass.data[DOMAIN]:
            irrigation_manager = IrrigationManager(hass, store)
            hass.data[DOMAIN]["irrigation_manager"] = irrigation_manager
            await irrigation_manager.async_setup()

    # ── Adaptive Light Manager ──
    if "adaptive_light_manager" not in hass.data[DOMAIN]:
        adaptive_light_mgr = AdaptiveLightManager(hass, store)
        hass.data[DOMAIN]["adaptive_light_manager"] = adaptive_light_mgr

    # ── Simulation Manager ──
    if "simulation_manager" not in hass.data[DOMAIN]:
        simulation_manager = SimulationManager(hass, store)
        hass.data[DOMAIN]["simulation_manager"] = simulation_manager
        await simulation_manager.async_setup()

        # Track state changes to detect light on/off for override reset
        from homeassistant.const import STATE_ON, STATE_OFF
        from homeassistant.helpers.event import async_track_state_change_event

        @callback
        def _on_light_state_changed(event):
            entity_id = event.data.get("entity_id", "")
            if not entity_id.startswith("light."):
                return
            new_state = event.data.get("new_state")
            old_state = event.data.get("old_state")
            if new_state is None:
                return
            mgr = hass.data.get(DOMAIN, {}).get("adaptive_light_manager")
            if mgr is None:
                return
            if new_state.state == STATE_ON and (old_state is None or old_state.state == STATE_OFF):
                mgr.handle_light_turned_on(entity_id)
                mgr.apply_immediately(entity_id)
            elif new_state.state == STATE_OFF:
                mgr.handle_light_turned_off(entity_id)

        async_track_state_change_event(hass, [], _on_light_state_changed)

        # Start if enabled
        cfg = store.get_adaptive_light_config()
        if cfg.get("enabled", False):
            await adaptive_light_mgr.start()

    await hass.config_entries.async_forward_entry_setups(entry, ["sensor", "number", "button", "switch", "text", "select"])

    # Clean up obsolete entities from the registry
    from homeassistant.helpers import entity_registry as er
    ent_reg = er.async_get(hass)
    obsolete_unique_ids = [
        "smarthome_companion_global_shading_block_open_intensity_norden",
        "smarthome_companion_global_shading_block_open_intensity_osten",
        "smarthome_companion_global_shading_block_open_intensity_sueden",
        "smarthome_companion_global_shading_block_open_intensity_westen",
        "smarthome_companion_global_heat_protection_max_temp_threshold",
        "smarthome_companion_global_shading_intensity_norden",
        "smarthome_companion_global_shading_intensity_osten",
        "smarthome_companion_global_shading_intensity_sueden",
        "smarthome_companion_global_shading_intensity_westen",
    ]
    for entity in list(ent_reg.entities.values()):
        if entity.platform == DOMAIN:
            if entity.unique_id in obsolete_unique_ids or entity.unique_id.startswith("smarthome_companion_number_shading_intensity_threshold_"):
                try:
                    ent_reg.async_remove(entity.entity_id)
                    _LOGGER.info(f"Removed obsolete entity from registry: {entity.entity_id}")
                except Exception as e:
                    _LOGGER.error(f"Failed to remove entity {entity.entity_id}: {e}")

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["sensor", "number", "button", "switch", "text", "select"])
    if unload_ok:
        hass.data.pop(DOMAIN, None)
    return unload_ok

