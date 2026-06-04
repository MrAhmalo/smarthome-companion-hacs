import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

def async_register_websockets(hass):
    websocket_api.async_register_command(hass, handle_get_blinds_config)
    websocket_api.async_register_command(hass, handle_save_blinds_config)
    websocket_api.async_register_command(hass, handle_get_blind_traces)
    websocket_api.async_register_command(hass, handle_get_settings)
    websocket_api.async_register_command(hass, handle_save_settings)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/blinds/get",
})
@websocket_api.async_response
async def handle_get_blinds_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    blinds = store.get_blinds()
    connection.send_result(msg["id"], blinds)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/blinds/save",
    vol.Required("blinds"): dict,
})
@websocket_api.async_response
async def handle_save_blinds_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    await store.save_blinds(msg["blinds"])

    # Notify manager to reload config
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    await blinds_manager.async_reload()

    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/blinds/traces",
    vol.Required("entity_id"): str,
})
@websocket_api.async_response
async def handle_get_blind_traces(hass, connection, msg):
    """Return the last 20 execution traces for a given cover entity."""
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    traces = blinds_manager.get_traces(msg["entity_id"])
    connection.send_result(msg["id"], {"traces": traces})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/settings/get",
})
@websocket_api.async_response
async def handle_get_settings(hass, connection, msg):
    """Return integration-wide settings (e.g. watchdog_interval)."""
    store = hass.data[DOMAIN]["store"]
    settings = store.data.get("settings", {})
    connection.send_result(msg["id"], settings)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/settings/save",
    vol.Required("settings"): dict,
})
@websocket_api.async_response
async def handle_save_settings(hass, connection, msg):
    """Save integration-wide settings and reload the blinds manager watchdog."""
    store = hass.data[DOMAIN]["store"]
    store.data["settings"] = msg["settings"]
    await store.async_save(store.data)

    # Reload the watchdog timer with the new interval
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    await blinds_manager.async_reload()

    connection.send_result(msg["id"], {"success": True})
