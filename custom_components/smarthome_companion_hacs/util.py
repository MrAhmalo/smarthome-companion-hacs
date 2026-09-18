import asyncio
import logging
# pyrefly: ignore [missing-import]
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


def safe_fire_event(hass: HomeAssistant, event_type: str, event_data: dict | None = None) -> None:
    """Safely fire an event on the Home Assistant event bus whether in the loop or a thread."""
    try:
        if hass.loop is asyncio.get_running_loop():
            hass.bus.async_fire(event_type, event_data)
            return
    except RuntimeError:
        pass
    hass.loop.call_soon_threadsafe(hass.bus.async_fire, event_type, event_data)


def safe_create_task(hass: HomeAssistant, target):
    """Safely create an asyncio task whether in the loop or a thread."""
    try:
        if hass.loop is asyncio.get_running_loop():
            return hass.async_create_task(target)
    except RuntimeError:
        pass
    return asyncio.run_coroutine_threadsafe(target, hass.loop)
