import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

def async_register_websockets(hass):
    websocket_api.async_register_command(hass, handle_get_blinds_config)
    websocket_api.async_register_command(hass, handle_save_blinds_config)
    websocket_api.async_register_command(hass, handle_cleanup_blinds_config)
    websocket_api.async_register_command(hass, handle_get_settings)
    websocket_api.async_register_command(hass, handle_save_settings)
    websocket_api.async_register_command(hass, handle_get_irrigation_config)
    websocket_api.async_register_command(hass, handle_save_irrigation_config)
    websocket_api.async_register_command(hass, handle_cleanup_irrigation_config)
    websocket_api.async_register_command(hass, handle_irrigation_manual_start)
    websocket_api.async_register_command(hass, handle_irrigation_manual_toggle)
    websocket_api.async_register_command(hass, handle_irrigation_force_check)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/blinds/get",
})
@websocket_api.async_response
async def handle_get_blinds_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    blinds = store.get_blinds()
    connection.send_result(msg["id"], blinds)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/settings/get",
})
@websocket_api.async_response
async def handle_get_settings(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    settings = store.data.get("settings", {})
    connection.send_result(msg["id"], settings)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/settings/save",
    vol.Required("settings"): dict,
})
@websocket_api.async_response
async def handle_save_settings(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    store.data["settings"] = msg["settings"]
    await store.async_save(store.data)
    
    # Notify manager to reload config and trigger state update
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    try:
        await blinds_manager.async_reload()
    except Exception as e:
        _LOGGER.error("Error reloading blinds manager after settings save: %s", e, exc_info=True)
    
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/blinds/save",
    vol.Required("blinds"): dict,
})
@websocket_api.async_response
async def handle_save_blinds_config(hass, connection, msg):
    _LOGGER.info(f"Received blinds config save request: {msg['blinds']}")
    store = hass.data[DOMAIN]["store"]
    await store.save_blinds(msg["blinds"])
    
    # Notify manager to reload config
    blinds_manager = hass.data[DOMAIN]["blinds_manager"]
    try:
        await blinds_manager.async_reload()
    except Exception as e:
        _LOGGER.error("Error reloading blinds manager: %s", e, exc_info=True)
    
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

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/get",
})
@websocket_api.async_response
async def handle_get_irrigation_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    irrigation = store.get_irrigation()
    connection.send_result(msg["id"], irrigation)

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/save",
    vol.Required("irrigation"): dict,
})
@websocket_api.async_response
async def handle_save_irrigation_config(hass, connection, msg):
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        try:
            irrigation_manager.validate_config(msg["irrigation"])
        except ValueError as e:
            connection.send_error(msg["id"], "invalid_format", str(e))
            return

    store = hass.data[DOMAIN]["store"]
    current_irrigation = store.get_irrigation()
    current_zones = {z.get("id"): z for z in current_irrigation.get("zones", []) if z.get("id")}
    
    new_irrigation = msg["irrigation"]
    for new_z in new_irrigation.get("zones", []):
        zid = new_z.get("id")
        if zid in current_zones:
            old_z = current_zones[zid]
            for attr in ("last_watered_at", "last_skipped_at", "last_skipped_reason", "_last_auto_start_date"):
                if not new_z.get(attr) and old_z.get(attr):
                    new_z[attr] = old_z[attr]

    await store.save_irrigation(new_irrigation)
    
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_reload()
        
    hass.bus.async_fire("smarthome_companion_irrigation_updated")
    
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/cleanup",
})
@websocket_api.async_response
async def handle_cleanup_irrigation_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    await store.save_irrigation({})
    
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_reload()
        
    hass.bus.async_fire("smarthome_companion_irrigation_updated")
    
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/manual_start",
    vol.Required("zone_id"): str,
    vol.Optional("duration"): int,
})
@websocket_api.async_response
async def handle_irrigation_manual_start(hass, connection, msg):
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_manual_start(msg["zone_id"], duration_minutes=msg.get("duration"))
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/manual_toggle",
    vol.Required("zone_id"): str,
    vol.Required("state"): bool,
})
@websocket_api.async_response
async def handle_irrigation_manual_toggle(hass, connection, msg):
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_manual_toggle(msg["zone_id"], msg["state"])
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/force_check",
})
@websocket_api.async_response
async def handle_irrigation_force_check(hass, connection, msg):
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_force_check()
    connection.send_result(msg["id"], {"success": True})