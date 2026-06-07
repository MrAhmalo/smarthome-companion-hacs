import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

def async_register_websockets(hass):
    websocket_api.async_register_command(hass, handle_get_blinds_config)
    websocket_api.async_register_command(hass, handle_save_blinds_config)
    websocket_api.async_register_command(hass, handle_cleanup_blinds_config)

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
    vol.Required("type"): "smarthome_companion/blinds/cleanup",
})
@websocket_api.async_response
async def handle_cleanup_blinds_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    await store.save_blinds({})
    
    # Notify manager to reload config
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    await blinds_manager.async_reload()
    
    connection.send_result(msg["id"], {"success": True})