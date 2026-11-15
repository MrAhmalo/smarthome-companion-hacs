import logging
import re
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
    area_registry as ar,
)
from .const import DOMAIN
from .device_helpers import get_device_by_identifier_compat
from .util import safe_fire_event
from .entity_sync import (
    async_sync_renamed_entities,
    slugify_ha,
    sync_device_entity_ids,
    sync_device_friendly_names,
)

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
    # Groups
    websocket_api.async_register_command(hass, handle_get_groups)
    websocket_api.async_register_command(hass, handle_save_group)
    websocket_api.async_register_command(hass, handle_delete_group)
    # Adaptive Light
    websocket_api.async_register_command(hass, handle_get_adaptive_light_config)
    websocket_api.async_register_command(hass, handle_save_adaptive_light_config)
    # Simulation
    websocket_api.async_register_command(hass, handle_get_simulation_config)
    websocket_api.async_register_command(hass, handle_save_simulation_config)

# ── Helpers ──

def _ensure_label_exists(hass, label_id: str, name: str | None = None, icon: str | None = None, color: str | None = None) -> str | None:
    """Ensure a label exists in HA's label registry and return its actual label_id."""
    label_reg = lr.async_get(hass)
    existing = label_reg.async_get_label(label_id)
    if existing is not None:
        return existing.label_id

    target_name = (name or label_id).strip()
    # HA slugifies label names into label_id (e.g. 'Steckdosen' -> 'steckdosen'),
    # so lookup by name prevents duplicate-name ValueErrors when label_id != slug(name).
    if hasattr(label_reg, "async_get_label_by_name"):
        by_name = label_reg.async_get_label_by_name(target_name)
        if by_name is not None:
            return by_name.label_id
    if hasattr(label_reg, "async_list_labels"):
        target_lower = target_name.lower()
        for lbl in label_reg.async_list_labels():
            if lbl.label_id == label_id or (lbl.name and lbl.name.strip().lower() == target_lower):
                return lbl.label_id

    try:
        created = label_reg.async_create(
            name=target_name,
            icon=icon,
            color=color,
        )
        created_id = getattr(created, "label_id", label_id)
        _LOGGER.info("Created HA label: %s (%s)", target_name, created_id)
        return created_id
    except Exception as e:
        _LOGGER.warning("Could not create label '%s': %s", label_id, e)
        return None

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
        "groups": store.get_groups(),
    })

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/devices/configure",
    vol.Required("device_id"): str,
    vol.Required("category"): str,
    vol.Optional("entities", default={}): dict,
    vol.Optional("custom_name"): vol.Any(str, None),
    vol.Optional("area_id"): vol.Any(str, None),
    vol.Optional("options", default={}): dict,
    vol.Optional("icon"): vol.Any(str, None),
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

    # Enrich entities and sub_entities with immutable unique_ids from entity registry
    ent_reg = er.async_get(hass)
    if isinstance(entities, dict):
        primary_id = entities.get("primary")
        if primary_id and "primary_unique_id" not in entities:
            entry = ent_reg.async_get(primary_id)
            if entry and entry.unique_id:
                entities["primary_unique_id"] = entry.unique_id

        sub_entities = entities.get("sub_entities")
        if isinstance(sub_entities, dict):
            single_sub = len(sub_entities) == 1 and bool(custom_name)
            for sub_id, sub_data in sub_entities.items():
                if not isinstance(sub_data, dict):
                    continue
                if single_sub:
                    sub_data["custom_name"] = custom_name
                    sub_data["name"] = custom_name
                if not sub_data.get("unique_id"):
                    entry = ent_reg.async_get(sub_id) or ent_reg.async_get(sub_data.get("original_id", ""))
                    if entry and entry.unique_id:
                        sub_data["unique_id"] = entry.unique_id

        room_sensors = entities.get("room_sensors")
        if isinstance(room_sensors, dict):
            for s_id, s_data in room_sensors.items():
                if isinstance(s_data, dict) and not s_data.get("unique_id"):
                    entry = ent_reg.async_get(s_id) or ent_reg.async_get(s_data.get("original_id", ""))
                    if entry and entry.unique_id:
                        s_data["unique_id"] = entry.unique_id

    # Save device config (capture previous device config first to catch prior renames)
    devices = store.get_devices()
    prev_dev = devices.get(device_id)
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
    cat_label_id = _ensure_label_exists(hass, category, name=cat_info.get("display_name", category), icon=cat_info.get("icon"), color=cat_info.get("color"))
    power_label_id = None
    if entities.get("power"):
        power_label_id = _ensure_label_exists(hass, f"{category}_power", name=f"{cat_info.get('display_name', category)} Power")
    energy_label_id = None
    if entities.get("energy"):
        energy_label_id = _ensure_label_exists(hass, f"{category}_energy", name=f"{cat_info.get('display_name', category)} Energy")

    # Sync labels onto entities
    primary = entities.get("primary")
    if primary and cat_label_id:
        _sync_entity_labels(hass, primary, [cat_label_id])

    power = entities.get("power")
    if power and power_label_id:
        _sync_entity_labels(hass, power, [power_label_id])

    energy = entities.get("energy")
    if energy and energy_label_id:
        _sync_entity_labels(hass, energy, [energy_label_id])

    sub_entities_for_labels = entities.get("sub_entities") if isinstance(entities, dict) else None
    if isinstance(sub_entities_for_labels, dict):
        for sub_eid, sub_data in sub_entities_for_labels.items():
            if not isinstance(sub_data, dict):
                continue
            sub_cat = sub_data.get("category") or category
            sub_cat_info = categories.get(sub_cat, {})
            if sub_data.get("power"):
                sub_p_lbl = _ensure_label_exists(
                    hass,
                    f"{sub_cat}_power",
                    name=f"{sub_cat_info.get('display_name', sub_cat)} Power",
                )
                if sub_p_lbl:
                    _sync_entity_labels(hass, sub_data["power"], [sub_p_lbl])
            if sub_data.get("energy"):
                sub_e_lbl = _ensure_label_exists(
                    hass,
                    f"{sub_cat}_energy",
                    name=f"{sub_cat_info.get('display_name', sub_cat)} Energy",
                )
                if sub_e_lbl:
                    _sync_entity_labels(hass, sub_data["energy"], [sub_e_lbl])

    # Update area in HA registry, then apply '<Raumname> <Gerätename>' friendly names
    is_virtual_entity = str(device_id).startswith("entity:")
    dev_reg = dr.async_get(hass)
    if is_virtual_entity:
        if primary and area_id is not None:
            try:
                ent_reg.async_update_entity(primary, area_id=area_id if area_id else None)
            except Exception as e:
                _LOGGER.warning("Could not update virtual entity area for %s: %s", primary, e)
    else:
        if area_id is not None:
            try:
                dev_reg.async_update_device(device_id, area_id=area_id if area_id else None)
            except Exception as e:
                _LOGGER.warning("Could not update device area for %s: %s", device_id, e)

    # Apply per-channel room overrides when specified on multi-channel devices
    if isinstance(sub_entities_for_labels, dict):
        for sub_eid, sub_data in sub_entities_for_labels.items():
            if not isinstance(sub_data, dict) or not sub_data.get("enabled", True):
                continue
            if "area_id" in sub_data:
                ch_area = sub_data.get("area_id") or None
                try:
                    if ent_reg.async_get(sub_eid) is not None:
                        ent_reg.async_update_entity(sub_eid, area_id=ch_area)
                except Exception as e:
                    _LOGGER.warning("Could not update area for channel %s: %s", sub_eid, e)

    sync_device_friendly_names(hass, device_id, devices[device_id], area_id=area_id)

    # Sync primary, channel, room-sensor, and ALL remaining sub-entity IDs of this device
    renamed_map = sync_device_entity_ids(
        hass,
        device_id,
        devices[device_id],
        area_id=area_id,
        prev_dev=prev_dev,
    )

    if renamed_map:
        await async_sync_renamed_entities(hass, store, renamed_map)

    safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")
    connection.send_result(msg["id"], {"success": True, "renamed": renamed_map})

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
        if isinstance(ents.get("sub_entities"), dict):
            for sub in ents["sub_entities"].values():
                if not isinstance(sub, dict):
                    continue
                sub_cat = sub.get("category") or cat
                if sub.get("power"):
                    _remove_entity_labels(hass, sub["power"], [f"{sub_cat}_power"])
                if sub.get("energy"):
                    _remove_entity_labels(hass, sub["energy"], [f"{sub_cat}_energy"])

    safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")
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
# GROUPS (Hierarchical / Multi-device grouping)
# ═══════════════════════════════════════════════

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/groups/get",
})
@websocket_api.async_response
async def handle_get_groups(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    connection.send_result(msg["id"], store.get_groups())

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/groups/save",
    vol.Required("group"): dict,
})
@websocket_api.async_response
async def handle_save_group(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    group = msg["group"]
    group_id = group.get("id")
    if not group_id:
        group_id = f"group_{int(datetime.now().timestamp() * 1000)}"
        group["id"] = group_id

    groups = store.get_groups()
    groups[group_id] = group
    success = await store.save_groups(groups)
    if not success:
        connection.send_result(msg["id"], {"save_failed": True})
        return

    # Sync native Home Assistant group entity if possible
    try:
        dev_reg = dr.async_get(hass)
        ent_reg = er.async_get(hass)
        group_name = group.get("name") or "Gruppe"
        area_id = group.get("area_id")

        # 1. Update group device in device registry
        dev_entry = get_device_by_identifier_compat(dev_reg, (DOMAIN, f"group_{group_id}"))
        if dev_entry:
            dev_reg.async_update_device(dev_entry.id, name_by_user=group_name, area_id=area_id or None)

        # 2. Update group entity in entity registry (light or switch, clean slug)
        g_cat = (group.get("category") or "leuchte").strip()
        target_domain = "light" if g_cat in ("leuchte", "light") else "switch"
        unique_id = f"smarthome_companion_group_{target_domain}_{group_id}"
        current_eid = ent_reg.async_get_entity_id(target_domain, DOMAIN, unique_id)
        if not current_eid:
            alt_dom = "switch" if target_domain == "light" else "light"
            alt_uid = f"smarthome_companion_group_{alt_dom}_{group_id}"
            alt_eid = ent_reg.async_get_entity_id(alt_dom, DOMAIN, alt_uid)
            if alt_eid:
                current_eid = alt_eid
                target_domain = alt_dom
                unique_id = alt_uid
        if current_eid:
            clean_name = slugify_ha(group_name)
            area_name = ""
            area_slug = ""
            if area_id:
                area_reg = ar.async_get(hass)
                a_entry = area_reg.async_get_area(area_id)
                if a_entry:
                    area_name = (a_entry.name or "").strip()
                    area_slug = slugify_ha(area_name)
            if area_slug and clean_name and not clean_name.startswith(f"{area_slug}_") and clean_name != area_slug:
                clean_slug = f"{area_slug}_{clean_name}"
            else:
                clean_slug = clean_name
            target_eid = f"{target_domain}.{clean_slug}" if clean_slug else current_eid
            expected_friendly = group_name
            if area_name and group_name and not group_name.lower().startswith(area_name.lower()):
                expected_friendly = f"{area_name} {group_name}"
            update_kwargs: dict[str, Any] = {}
            cur_entry = ent_reg.async_get(current_eid)
            if expected_friendly and (not cur_entry or cur_entry.name != expected_friendly):
                update_kwargs["name"] = expected_friendly
            if current_eid != target_eid:
                existing = ent_reg.async_get(target_eid)
                if not existing or existing.unique_id == unique_id:
                    update_kwargs["new_entity_id"] = target_eid
                    update_kwargs["original_name"] = None
            if update_kwargs:
                try:
                    ent_reg.async_update_entity(current_eid, **update_kwargs)
                    if "new_entity_id" in update_kwargs:
                        _LOGGER.info("Synchronized group entity ID: %s -> %s", current_eid, target_eid)
                        await async_sync_renamed_entities(hass, store, {current_eid: target_eid})
                except Exception as err:
                    _LOGGER.warning("Could not update group entity %s: %s", current_eid, err)

        if hass.services.has_service("group", "set"):
            eids = []
            for child_ref in group.get("children", []):
                if child_ref.startswith("d:"):
                    parts = child_ref.split(":", 2)
                    if len(parts) >= 3 and hass.states.get(parts[2]):
                        eids.append(parts[2])
                elif hass.states.get(child_ref):
                    eids.append(child_ref)
                elif dev_reg.async_get(child_ref):
                    dev_ents = [
                        e.entity_id for e in ent_reg.entities.values()
                        if e.device_id == child_ref and not e.disabled_by
                        and e.domain in ("light", "switch", "cover", "valve", "media_player")
                    ]
                    if dev_ents:
                        eids.append(dev_ents[0])
            if eids:
                safe_object_id = re.sub(r"[^a-zA-Z0-9_]", "_", group_id).lower()
                await hass.services.async_call(
                    "group", "set",
                    {"object_id": safe_object_id, "name": group.get("name") or "Gruppe", "entities": eids},
                    blocking=False
                )
    except Exception as err:
        _LOGGER.debug("Could not create native HA group: %s", err)

    safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")
    connection.send_result(msg["id"], {"success": True, "group_id": group_id, "group": group})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/groups/delete",
    vol.Required("group_id"): str,
})
@websocket_api.async_response
async def handle_delete_group(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    group_id = msg["group_id"]
    groups = store.get_groups()
    if group_id in groups:
        del groups[group_id]
        # Also clean up any references in parent groups
        for g in groups.values():
            children = g.get("children", [])
            if group_id in children:
                children.remove(group_id)
        await store.save_groups(groups)

        # Remove Companion group entities & device from HA registries cleanly
        try:
            ent_reg = er.async_get(hass)
            for dom in ("light", "switch"):
                eid = ent_reg.async_get_entity_id(dom, DOMAIN, f"smarthome_companion_group_{dom}_{group_id}")
                if eid:
                    ent_reg.async_remove(eid)
            dev_reg = dr.async_get(hass)
            dev_entry = get_device_by_identifier_compat(dev_reg, (DOMAIN, f"group_{group_id}"))
            if dev_entry:
                dev_reg.async_remove_device(dev_entry.id)
        except Exception as err:
            _LOGGER.debug("Could not clean up Companion group device %s: %s", group_id, err)

        # Remove native HA group entity if possible
        try:
            if hass.services.has_service("group", "remove"):
                safe_object_id = re.sub(r"[^a-zA-Z0-9_]", "_", group_id).lower()
                await hass.services.async_call("group", "remove", {"object_id": safe_object_id}, blocking=False)
        except Exception as err:
            _LOGGER.debug("Could not remove native HA group: %s", err)
    safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")
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
        if zid:
            clean_id = re.sub(r"[^a-zA-Z0-9_]", "", str(zid)).lower()
            if clean_id:
                new_z["id"] = clean_id
                zid = clean_id
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
    clean_zone_id = re.sub(r"[^a-zA-Z0-9_]", "", str(msg["zone_id"])).lower()
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_manual_start(clean_zone_id, duration_minutes=msg.get("duration"))
    connection.send_result(msg["id"], {"success": True})

@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/irrigation/manual_toggle",
    vol.Required("zone_id"): str,
    vol.Required("state"): bool,
})
@websocket_api.async_response
async def handle_irrigation_manual_toggle(hass, connection, msg):
    clean_zone_id = re.sub(r"[^a-zA-Z0-9_]", "", str(msg["zone_id"])).lower()
    if "irrigation_manager" in hass.data[DOMAIN]:
        irrigation_manager = hass.data[DOMAIN]["irrigation_manager"]
        await irrigation_manager.async_manual_toggle(clean_zone_id, msg["state"])
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
