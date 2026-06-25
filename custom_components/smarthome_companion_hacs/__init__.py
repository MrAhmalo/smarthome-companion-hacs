import logging
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .store import CompanionStore
from .ws_api import async_register_websockets
from .blinds_manager import BlindsManager
from .sun_manager import SunManager
from .irrigation_manager import IrrigationManager

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

    await hass.config_entries.async_forward_entry_setups(entry, ["sensor", "number", "button", "switch", "text", "select"])

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["sensor", "number", "button", "switch", "text", "select"])
    if unload_ok:
        hass.data.pop(DOMAIN, None)
    return unload_ok

