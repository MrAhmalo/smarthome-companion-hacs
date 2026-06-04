import logging
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .store import CompanionStore
from .ws_api import async_register_websockets
from .blinds_manager import BlindsManager
from .sun_manager import SunManager

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the component (YAML)."""
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the SmartHome Companion HACS component from a config entry."""
    _LOGGER.info("Setting up SmartHome Companion HACS Backend")

    store = CompanionStore(hass)
    await store.async_load()

    sun_manager = SunManager(hass, store)
    blinds_manager = BlindsManager(hass, store, sun_manager)
    
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN] = {
        "store": store,
        "sun_manager": sun_manager,
        "blinds_manager": blinds_manager
    }

    async_register_websockets(hass)
    
    await sun_manager.async_setup()
    await blinds_manager.async_setup()

    await hass.config_entries.async_forward_entry_setups(entry, ["sensor"])

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["sensor"])
    if unload_ok:
        hass.data.pop(DOMAIN, None)
    return unload_ok

