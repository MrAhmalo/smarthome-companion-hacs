import logging
from datetime import datetime
# pyrefly: ignore [missing-import]
import voluptuous as vol
# pyrefly: ignore [missing-import]
from homeassistant.components import websocket_api
# pyrefly: ignore [missing-import]
from homeassistant.helpers import (
    entity_registry as er,
    device_registry as dr,
    label_registry as lr,
)
from .const import DOMAIN
from .util import safe_fire_event

_LOGGER = logging.getLogger(__name__)

def async_register_websockets(hass):
    # Blinds
    websocket_api.async_register_command(hass, handle_get_blinds_config)
    websocket_api.async_register_command(hass, handle_save_blinds_config)
    websocket_api.async_register_command(hass, handle_cleanup_blinds_config)
    # Settings
    websocket_api.async_register_command(hass, handle_get_settings)
    websocket_api.async_register_command(hass, handle_save_settings)
    # Irrigation
    websocket_api.async_register_command(hass, handle_get_irrigation_config)
    websocket_api.async_register_command(hass, handle_save_irrigation_config)
    websocket_api.async_register_command(hass, handle_cleanup_irrigation_config)
    websocket_api.async_register_command(hass, handle_irrigation_manual_start)
    websocket_api.async_register_command(hass, handle_irrigation_manual_toggle)
    websocket_api.async_register_command(hass, handle_irrigation_force_check)
    # Devices
    websocket_api.async_register_command(hass, handle_get_devices)
    websocket_api.async_register_command(hass, handle_configure_device)
    websocket_api.async_register_command(hass, handle_remove_device_config)
    websocket_api.async_register_command(hass, handle_dismiss_device)
    websocket_api.async_register_command(hass, handle_get_categories)
    websocket_api.async_register_command(hass, handle_save_category)
    websocket_api.async_register_command(hass, handle_delete_category)
    # Adaptive Light
    websocket_api.async_register_command(hass, handle_get_adaptive_light_config)
    websocket_api.async_register_command(hass, handle_save_adaptive_light_config)
    # Simulation
    websocket_api.async_register_command(hass, handle_get_simulation_config)
    websocket_api.async_register_command(hass, handle_save_simulation_config)

# ── Helpers ──

def _ensure_label_exists(hass, label_id: str, name: str | None = None, icon: str | None = None, color: str | None = None):
    """Ensure a label exists in HA's label registry. Create if missing."""
    label_reg = lr.async_get(hass)
    existing = label_reg.async_get_label(label_id)
    if existing is None:
        try:
            label_reg.async_create(
                name=name or label_id,
                icon=icon,
                color=color,
            )
            _LOGGER.info("Created HA label: %s", label_id)
        except Exception as e:
            _LOGGER.warning("Could not create label '%s': %s", label_id, e)

def _sync_entity_labels(hass, entity_id: str, labels_to_add: list[str]):
    """Add labels to an entity without removing existing ones."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None:
        return
    current = set(entry.labels or frozenset())
    updated = current | set(labels_to_add)
    if updated != current:
        ent_reg.async_update_entity(entity_id, labels=updated)

def _remove_entity_labels(hass, entity_id: str, labels_to_remove: list[str]):
    """Remove specific labels from an entity."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None:
        return
    current = set(entry.labels or frozenset())
    updated = current - set(labels_to_remove)
    if updated != current:
        ent_reg.async_update_entity(entity_id, labels=updated)


# ═══════════════════════════════════════════════
# DEVICES
# ═══════════════════════════════════════════════

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/devices/get",
})
@websocket_api.async_response
async def handle_get_devices(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    connection.send_result(msg["id"], {
        "devices": store.get_devices(),
        "categories": store.get_categories(),
        "dismissed": store.get_dismissed_devices(),
    })

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/devices/configure",
    vol.Required("device_id"): str,
    vol.Required("category"): str,
    vol.Optional("entities", default={}): dict,
    vol.Optional("custom_name"): str,
    vol.Optional("area_id"): str,
})
@websocket_api.async_response
async def handle_configure_device(hass, connection, msg):
    """Configure a device: save to store + sync HA labels."""
    store = hass.data[DOMAIN]["store"]
    device_id = msg["device_id"]
    category = msg["category"]
    entities = msg.get("entities", {})
    custom_name = msg.get("custom_name")
    area_id = msg.get("area_id")
    options = msg.get("options", {})
    custom_icon = msg.get("icon")

    categories = store.get_categories()

    # Save device config
    devices = store.get_devices()
    devices[device_id] = {
        "category": category,
        "configured_at": datetime.now().isoformat(),
        "custom_name": custom_name,
        "entities": entities,
        "options": options,
        "icon": custom_icon,
    }
    success = await store.save_devices(devices)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return

    # Remove from dismissed
    dismissed = store.get_dismissed_devices()
    if device_id in dismissed:
        dismissed.remove(device_id)
        await store.save_dismissed_devices(dismissed)

    # Ensure HA labels exist
    cat_info = categories.get(category, {})
    _ensure_label_exists(hass, category, name=cat_info.get("display_name", category), icon=cat_info.get("icon"), color=cat_info.get("color"))
    if entities.get("power"):
        _ensure_label_exists(hass, f"{category}_power", name=f"{cat_info.get('display_name', category)} Power")
    if entities.get("energy"):
        _ensure_label_exists(hass, f"{category}_energy", name=f"{cat_info.get('display_name', category)} Energy")

    # Sync labels onto entities
    primary = entities.get("primary")
    if primary:
        _sync_entity_labels(hass, primary, [category])

    power = entities.get("power")
    if power:
        _sync_entity_labels(hass, power, [f"{category}_power"])

    energy = entities.get("energy")
    if energy:
        _sync_entity_labels(hass, energy, [f"{category}_energy"])

    # Update device name / area in HA registry
    dev_reg = dr.async_get(hass)
    try:
        updates = {}
        if custom_name:
            updates["name_by_user"] = custom_name
        if area_id is not None:
            updates["area_id"] = area_id if area_id else None
        if updates:
            dev_reg.async_update_device(device_id, **updates)
    except Exception as e:
        _LOGGER.warning("Could not update device registry for %s: %s", device_id, e)

    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/devices/remove",
    vol.Required("device_id"): str,
})
@websocket_api.async_response
async def handle_remove_device_config(hass, connection, msg):
    """Remove a device configuration and clean up its HA labels."""
    store = hass.data[DOMAIN]["store"]
    device_id = msg["device_id"]
    devices = store.get_devices()

    old_config = devices.pop(device_id, None)
    success = await store.save_devices(devices)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return

    # Clean up labels from entities
    if old_config:
        cat = old_config.get("category", "")
        ents = old_config.get("entities", {})
        if ents.get("primary"):
            _remove_entity_labels(hass, ents["primary"], [cat])
        if ents.get("power"):
            _remove_entity_labels(hass, ents["power"], [f"{cat}_power"])
        if ents.get("energy"):
            _remove_entity_labels(hass, ents["energy"], [f"{cat}_energy"])

    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/devices/dismiss",
    vol.Required("device_id"): str,
    vol.Optional("dismiss", default=True): bool,
})
@websocket_api.async_response
async def handle_dismiss_device(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    dismissed = store.get_dismissed_devices()
    device_id = msg["device_id"]

    if msg["dismiss"]:
        if device_id not in dismissed:
            dismissed.append(device_id)
    else:
        if device_id in dismissed:
            dismissed.remove(device_id)

    success = await store.save_dismissed_devices(dismissed)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return
    connection.send_result(msg["id"], {"success": True})


# ═══════════════════════════════════════════════
# CATEGORIES
# ═══════════════════════════════════════════════

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/categories/get",
})
@websocket_api.async_response
async def handle_get_categories(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    connection.send_result(msg["id"], store.get_categories())

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/categories/save",
    vol.Required("category_id"): str,
    vol.Required("category"): dict,
})
@websocket_api.async_response
async def handle_save_category(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    custom = store.get_custom_categories()
    custom[msg["category_id"]] = msg["category"]
    success = await store.save_categories(custom)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/categories/delete",
    vol.Required("category_id"): str,
})
@websocket_api.async_response
async def handle_delete_category(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    custom = store.get_custom_categories()
    custom.pop(msg["category_id"], None)
    success = await store.save_categories(custom)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return
    connection.send_result(msg["id"], {"success": True})


# ═══════════════════════════════════════════════
# BLINDS (unchanged)
# ═══════════════════════════════════════════════

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
    success = await store.save_blinds(msg["blinds"])
    if not success:
        connection.send_error(msg["id"], "save_failed", "Failed to save configuration (serialization or I/O error).")
        return
    
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


# ═══════════════════════════════════════════════
# IRRIGATION (unchanged)
# ═══════════════════════════════════════════════

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
    current_zones_by_id = {z.get("id"): z for z in current_irrigation.get("zones", []) if z.get("id")}
    current_zones_by_valve = {z.get("valve_entity_id"): z for z in current_irrigation.get("zones", []) if z.get("valve_entity_id")}
    
    new_irrigation = msg["irrigation"]
    for new_z in new_irrigation.get("zones", []):
        zid = new_z.get("id")
        valve_id = new_z.get("valve_entity_id")
        
        old_z = None
        if zid and zid in current_zones_by_id:
            old_z = current_zones_by_id[zid]
        elif valve_id and valve_id in current_zones_by_valve:
            old_z = current_zones_by_valve[valve_id]
            
        if old_z:
            if not zid and old_z.get("id"):
                new_z["id"] = old_z["id"]
            for attr in ("last_watered_at", "last_skipped_at", "last_skipped_reason", "_last_auto_start_date"):
                if old_z.get(attr) is not None:
                    new_z[attr] = old_z[attr]

    success = await store.save_irrigation(new_irrigation)
    if not success:
        connection.send_error(msg["id"], "save_failed", "Failed to save configuration (serialization or I/O error).")
        return
    
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_reload()
        
    safe_fire_event(hass, "smarthome_companion_irrigation_updated")
    
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
        
    safe_fire_event(hass, "smarthome_companion_irrigation_updated")
    
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


# ── Adaptive Light ──

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/adaptive_light/get",
})
@websocket_api.async_response
async def handle_get_adaptive_light_config(hass, connection, msg):
    """Returns the current adaptive light configuration."""
    store = hass.data[DOMAIN]["store"]
    config = store.get_adaptive_light_config()
    connection.send_result(msg["id"], {"config": config})


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/adaptive_light/save",
    vol.Required("config"): dict,
})
@websocket_api.async_response
async def handle_save_adaptive_light_config(hass, connection, msg):
    """Saves adaptive light configuration and restarts the manager."""
    store = hass.data[DOMAIN]["store"]
    config = msg["config"]

    success = await store.save_adaptive_light_config(config)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return

    # Restart manager so new config takes effect immediately
    if "adaptive_light_manager" in hass.data[DOMAIN]:
        mgr = hass.data[DOMAIN]["adaptive_light_manager"]
        await mgr.stop()
        if config.get("enabled", False):
            await mgr.start()
            # Apply immediately
            mgr.apply_immediately()

    connection.send_result(msg["id"], {"success": True})


# ═══════════════════════════════════════════════
# SIMULATION
# ═══════════════════════════════════════════════

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/simulation/get",
})
@websocket_api.async_response
async def handle_get_simulation_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    connection.send_result(msg["id"], {"config": store.data.get("simulation", {})})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/simulation/save",
    vol.Required("config"): dict,
})
@websocket_api.async_response
async def handle_save_simulation_config(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    store.data["simulation"] = msg["config"]
    await store.async_save()
    
    # Notify manager to reload config
    manager = hass.data[DOMAIN].get("simulation_manager")
    if manager:
        await manager.async_reload_config()
        
    connection.send_result(msg["id"], {"success": True})
