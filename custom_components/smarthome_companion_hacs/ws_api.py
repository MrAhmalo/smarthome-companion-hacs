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
from .util import safe_fire_event
from .entity_sync import async_sync_renamed_entities, slugify_ha

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

    # Sync entity IDs in HA entity registry on rename (multi-channel, single-channel, or sensor-only)
    renamed_map = {}
    ent_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)

    def _find_entry_by_uid(uid: str | None, fallback_id: str) -> object | None:
        if not uid:
            return None
        dom = fallback_id.split(".", 1)[0] if "." in fallback_id else None
        for e in ent_reg.entities.values():
            if e.unique_id == uid and (dom is None or e.domain == dom):
                return e
        return None

    def _try_rename_entry(entry, raw_name: str | None, expected_uid: str | None = None) -> str | None:
        if not entry:
            return None
        old_eid = entry.entity_id
        if not raw_name:
            return old_eid
        clean_name = slugify_ha(raw_name)
        if not clean_name:
            return old_eid
        effective_area = area_id if area_id is not None else entry.area_id
        area_slug = ""
        if effective_area:
            a_entry = area_reg.async_get_area(effective_area)
            if a_entry:
                area_slug = slugify_ha(a_entry.name)
        if area_slug and not clean_name.startswith(f"{area_slug}_") and clean_name != area_slug:
            clean_slug = f"{area_slug}_{clean_name}"
        else:
            clean_slug = clean_name
        target_eid = f"{entry.domain}.{clean_slug}"
        if old_eid == target_eid:
            return old_eid
        existing = ent_reg.async_get(target_eid)
        uid_match = entry.unique_id or expected_uid
        if not existing or (uid_match and existing.unique_id == uid_match):
            try:
                ent_reg.async_update_entity(old_eid, new_entity_id=target_eid)
                renamed_map[old_eid] = target_eid
                _LOGGER.info("Updated entity ID from %s to %s", old_eid, target_eid)
                return target_eid
            except Exception as e:
                _LOGGER.warning("Could not rename entity ID for %s: %s", old_eid, e)
        return old_eid

    def _record_prior_rename(old_id: str | None, new_id: str | None) -> None:
        if old_id and new_id and old_id != new_id and ent_reg.async_get(old_id) is None:
            renamed_map[old_id] = new_id

    sub_entities = entities.get("sub_entities") if isinstance(entities, dict) else None
    room_sensors = entities.get("room_sensors") if isinstance(entities, dict) else None
    has_actuator = bool((isinstance(sub_entities, dict) and sub_entities) or primary)

    active_by_uid: dict[str, str] = {}
    final_primary_eid: str | None = None

    if isinstance(sub_entities, dict) and sub_entities:
        single_sub = len(sub_entities) == 1 and bool(custom_name)
        for sub_id, sub_data in list(sub_entities.items()):
            if not isinstance(sub_data, dict):
                continue
            sub_name = (custom_name if single_sub else None) or sub_data.get("custom_name") or sub_data.get("name") or custom_name
            uid = sub_data.get("unique_id")
            s_entry = (
                ent_reg.async_get(sub_id)
                or ent_reg.async_get(sub_data.get("original_id", ""))
                or _find_entry_by_uid(uid, sub_id)
            )
            final_eid = _try_rename_entry(s_entry, sub_name, uid)
            if final_eid:
                _record_prior_rename(sub_id, final_eid)
                _record_prior_rename(sub_data.get("original_id"), final_eid)
                if uid:
                    active_by_uid[uid] = final_eid
                if sub_id == primary or not final_primary_eid:
                    final_primary_eid = final_eid
    elif custom_name and primary:
        p_uid = entities.get("primary_unique_id") if isinstance(entities, dict) else None
        p_entry = ent_reg.async_get(primary) or _find_entry_by_uid(p_uid, primary)
        final_primary_eid = _try_rename_entry(p_entry, custom_name, p_uid)
        if final_primary_eid:
            _record_prior_rename(primary, final_primary_eid)
            _record_prior_rename(entities.get("primary_original_id") if isinstance(entities, dict) else None, final_primary_eid)
            if p_uid:
                active_by_uid[p_uid] = final_primary_eid

    if custom_name and isinstance(room_sensors, dict) and room_sensors:
        enabled_sensors = [
            (s_id, s_data)
            for s_id, s_data in room_sensors.items()
            if isinstance(s_data, dict) and s_data.get("enabled", True)
        ]
        for s_id, s_data in enabled_sensors:
            uid = s_data.get("unique_id")
            rs_entry = (
                ent_reg.async_get(s_id)
                or ent_reg.async_get(s_data.get("original_id", ""))
                or _find_entry_by_uid(uid, s_id)
            )
            s_type = str(s_data.get("type") or "").strip()
            if has_actuator:
                if not s_type or s_type == "other":
                    continue
                rs_name = f"{custom_name}_{s_type}"
            else:
                rs_name = f"{custom_name}_{s_type}" if (len(enabled_sensors) > 1 and s_type) else custom_name
            final_rs_eid = _try_rename_entry(rs_entry, rs_name, uid)
            if final_rs_eid:
                _record_prior_rename(s_id, final_rs_eid)
                _record_prior_rename(s_data.get("original_id"), final_rs_eid)
                if uid:
                    active_by_uid[uid] = final_rs_eid

    # Catch any entity ID changes compared to previous stored config of this device
    if isinstance(prev_dev, dict):
        prev_ents = prev_dev.get("entities") or {}
        if isinstance(prev_ents, dict):
            prev_primary = prev_ents.get("primary")
            prev_p_uid = prev_ents.get("primary_unique_id")
            if prev_primary:
                target = active_by_uid.get(prev_p_uid) if prev_p_uid else None
                _record_prior_rename(prev_primary, target or final_primary_eid)
            prev_subs = prev_ents.get("sub_entities")
            if isinstance(prev_subs, dict):
                for p_sid, p_sdata in prev_subs.items():
                    p_uid = p_sdata.get("unique_id") if isinstance(p_sdata, dict) else None
                    target = active_by_uid.get(p_uid) if p_uid else (final_primary_eid if len(prev_subs) == 1 else None)
                    _record_prior_rename(p_sid, target)
            prev_rs = prev_ents.get("room_sensors")
            if isinstance(prev_rs, dict):
                for p_rsid, p_rsdata in prev_rs.items():
                    p_uid = p_rsdata.get("unique_id") if isinstance(p_rsdata, dict) else None
                    if p_uid and p_uid in active_by_uid:
                        _record_prior_rename(p_rsid, active_by_uid[p_uid])

    if renamed_map:
        await async_sync_renamed_entities(hass, store, renamed_map)

    safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")
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
        dev_entry = dev_reg.async_get_device(identifiers={(DOMAIN, f"group_{group_id}")})
        if dev_entry:
            dev_reg.async_update_device(dev_entry.id, name_by_user=group_name, area_id=area_id or None)

        # 2. Update group entity in entity registry (clean slug, no duplicated suffixes)
        unique_id = f"smarthome_companion_group_light_{group_id}"
        current_eid = ent_reg.async_get_entity_id("light", DOMAIN, unique_id)
        if current_eid:
            clean_name = slugify_ha(group_name)
            area_slug = ""
            if area_id:
                area_reg = ar.async_get(hass)
                a_entry = area_reg.async_get_area(area_id)
                if a_entry:
                    area_slug = slugify_ha(a_entry.name)
            if area_slug and clean_name and not clean_name.startswith(f"{area_slug}_") and clean_name != area_slug:
                clean_slug = f"{area_slug}_{clean_name}"
            else:
                clean_slug = clean_name
            target_eid = f"light.{clean_slug}" if clean_slug else current_eid
            if current_eid != target_eid:
                existing = ent_reg.async_get(target_eid)
                if not existing or existing.unique_id == unique_id:
                    try:
                        ent_reg.async_update_entity(current_eid, new_entity_id=target_eid, original_name=None)
                        _LOGGER.info("Synchronized group entity ID: %s -> %s", current_eid, target_eid)
                        await async_sync_renamed_entities(hass, store, {current_eid: target_eid})
                    except Exception as err:
                        _LOGGER.warning("Could not rename group entity %s: %s", current_eid, err)

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
