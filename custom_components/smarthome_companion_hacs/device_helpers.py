"""Shared DeviceInfo & Device Registry helpers for SmartHome Companion OS."""

from __future__ import annotations

import logging
import re
# pyrefly: ignore [missing-import]
from homeassistant.helpers import device_registry as dr, entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.entity import DeviceInfo

from .const import DEFAULT_CATEGORIES, DOMAIN

_LOGGER = logging.getLogger(__name__)

MODULE_TITLES: dict[str, str] = {
    "hub": "SmartHome Companion Hub",
    "groups": "SmartHome Gruppen",
    "blinds": "SmartHome Rollläden",
    "irrigation": "SmartHome Bewässerung",
}

MODULE_PLATFORMS: dict[str, list[str]] = {
    "hub": ["sensor"],
    "groups": ["light", "switch"],
    "blinds": ["sensor", "number", "button", "switch", "text", "select"],
    "irrigation": ["sensor", "text"],
    "legacy": ["sensor", "number", "button", "switch", "text", "select", "light"],
}


def get_device_by_identifier_compat(dev_reg, identifier: tuple[str, str]):
    """Look up a device by identifier using the modern HA API cleanly."""
    if hasattr(dev_reg, "async_get_device_by_identifier"):
        return dev_reg.async_get_device_by_identifier(identifier)
    if hasattr(dev_reg, "async_get_device"):
        return dev_reg.async_get_device(identifiers={identifier})
    return None


def get_device_id_by_identifier_compat(hass, identifier: tuple[str, str]) -> str | None:
    """Resolve internal Home Assistant device registry ID for an identifier tuple."""
    if not hass:
        return None
    try:
        dev_reg = dr.async_get(hass)
    except Exception:  # noqa: BLE001
        return None
    dev = get_device_by_identifier_compat(dev_reg, identifier)
    return dev.id if dev else None


def cover_label(hass, entity_id: str) -> str:
    """Return human-readable label for a cover entity."""
    state = hass.states.get(entity_id) if hass else None
    if state and state.attributes.get("friendly_name"):
        name = state.attributes["friendly_name"]
    else:
        name = entity_id.split(".")[-1].replace("_", " ").title()
    return name.replace("Eg", "EG").replace("Og", "OG").replace("Hacs", "HACS")


def build_hub_device_info(module: str) -> DeviceInfo:
    """Return standardized DeviceInfo for a module's control hub device."""
    if module == "blinds":
        return DeviceInfo(
            identifiers={(DOMAIN, "hub")},
            name="SmartHome Rollläden (Steuerung)",
            manufacturer="SmartHome Companion",
            model="Rollläden · Steuerung",
        )
    if module == "irrigation":
        return DeviceInfo(
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerung · Steuerung",
        )
    if module == "groups":
        return DeviceInfo(
            identifiers={(DOMAIN, "groups_hub")},
            name="SmartHome Gruppen",
            manufacturer="SmartHome Companion",
            model="Gruppen · Übersicht",
        )
    return DeviceInfo(
        identifiers={(DOMAIN, "simulation_hub")},
        name="SmartHome Companion Hub",
        manufacturer="SmartHome Companion",
        model="System · Hub & Simulation",
    )


def build_blind_device_info(hass, blind_id: str) -> DeviceInfo:
    """Return standardized DeviceInfo for a blind automation device."""
    via_id = get_device_id_by_identifier_compat(hass, (DOMAIN, "hub"))
    kwargs: dict = {
        "identifiers": {(DOMAIN, blind_id)},
        "name": cover_label(hass, blind_id),
        "manufacturer": "SmartHome Companion",
        "model": "Rollläden · Automat",
    }
    if via_id:
        kwargs["via_device_id"] = via_id
    return DeviceInfo(**kwargs)


def build_irrigation_zone_device_info(hass, clean_zone_id: str, zone_name: str) -> DeviceInfo:
    """Return standardized DeviceInfo for an irrigation zone without deprecated via_device."""
    via_id = get_device_id_by_identifier_compat(hass, (DOMAIN, "irrigation_hub"))
    kwargs: dict = {
        "identifiers": {(DOMAIN, f"irrigation_zone_{clean_zone_id}")},
        "name": f"Bewässerung {zone_name}",
        "manufacturer": "SmartHome Companion",
        "model": "Bewässerung · Kreis",
    }
    if via_id:
        kwargs["via_device_id"] = via_id
    return DeviceInfo(**kwargs)


def build_group_device_info(group_id: str, group_cfg: dict, store=None) -> DeviceInfo:
    """Return categorized DeviceInfo for a SmartHome Companion group."""
    cat_key = (group_cfg.get("category") or "leuchte").strip()
    categories = store.get_categories() if store and hasattr(store, "get_categories") else DEFAULT_CATEGORIES
    cat_meta = categories.get(cat_key) or DEFAULT_CATEGORIES.get(cat_key) or {}
    cat_label = cat_meta.get("display_name") or cat_key.title()
    return DeviceInfo(
        identifiers={(DOMAIN, f"group_{group_id}")},
        name=group_cfg.get("name") or "Gruppe",
        manufacturer="SmartHome Companion",
        model=f"Gruppe · {cat_label}",
        suggested_area=group_cfg.get("area_id") or None,
    )


def resolve_group_child_entities(
    hass,
    store,
    group_id: str,
    domains: tuple[str, ...] = ("light", "switch"),
) -> list[str]:
    """Recursively resolve concrete child entity IDs for a Companion group."""
    if not hass or not store:
        return []
    groups = store.get_groups() or {}
    g = groups.get(group_id, {})
    ent_reg = None
    dev_reg = None
    try:
        ent_reg = er.async_get(hass)
    except Exception:
        ent_reg = None
    try:
        dev_reg = dr.async_get(hass)
    except Exception:
        dev_reg = None

    eids: list[str] = []
    visited = {group_id}

    def resolve(children):
        for ref in children or []:
            if not isinstance(ref, str):
                continue
            if ref in groups and ref not in visited:
                visited.add(ref)
                resolve(groups[ref].get("children", []))
            elif ref.startswith("d:"):
                parts = ref.split(":", 2)
                if len(parts) >= 3 and hass.states.get(parts[2]):
                    eids.append(parts[2])
            elif hass.states.get(ref):
                eids.append(ref)
            elif dev_reg and ent_reg and dev_reg.async_get(ref):
                dev_ents = [
                    e.entity_id
                    for e in ent_reg.entities.values()
                    if e.device_id == ref and not e.disabled_by and e.domain in domains
                ]
                eids.extend(dev_ents)

    resolve(g.get("children", []))
    return list(dict.fromkeys(eids))


_DUP_SUFFIX_RE = re.compile(r"^([a-z0-9_]+?)_([a-z0-9_]+)_\2$")


def cleanup_duplicated_group_entity_id(hass, entity_id: str | None) -> str | None:
    """Fix duplicated trailing slug suffixes like `light.julian_lampen_rechts_lampen_rechts`."""
    if not hass or not entity_id or "." not in entity_id:
        return entity_id
    dom, obj_id = entity_id.split(".", 1)
    parts = obj_id.split("_")
    clean_obj = None
    for half_len in range(len(parts) // 2, 0, -1):
        tail = parts[-half_len:]
        prev = parts[-2 * half_len : -half_len]
        if tail == prev:
            clean_obj = "_".join(parts[:-half_len])
            break
    if not clean_obj:
        m = _DUP_SUFFIX_RE.match(obj_id)
        if m:
            clean_obj = f"{m.group(1)}_{m.group(2)}"
    if not clean_obj or clean_obj == obj_id:
        return entity_id
    clean_eid = f"{dom}.{clean_obj}"
    ent_reg = er.async_get(hass)
    if not ent_reg.async_get(clean_eid):
        try:
            ent_reg.async_update_entity(entity_id, new_entity_id=clean_eid)
            _LOGGER.info("Cleaned up duplicated group entity_id: %s -> %s", entity_id, clean_eid)
            return clean_eid
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Could not rename duplicated entity_id %s: %s", entity_id, err)
    return entity_id


def _target_module_for_entity(entity_entry) -> str | None:
    """Determine which SmartHome Companion config entry module owns an entity."""
    uid = getattr(entity_entry, "unique_id", "") or ""
    if uid.startswith("smarthome_companion_group_"):
        return "groups"
    if uid == "smarthome_companion_presence_simulation_active":
        return "hub"
    if uid == "smarthome_companion_integration_info_hub":
        return "hub"
    if uid == "smarthome_companion_integration_info_groups":
        return "groups"
    if uid == "smarthome_companion_integration_info_irrigation" or "_irr_" in uid or "irrigation" in uid:
        return "irrigation"
    if (
        uid == "smarthome_companion_integration_info_blinds"
        or "blind" in uid
        or "shading" in uid
        or "sun" in uid
        or "watchdog" in uid
        or "sunrise" in uid
        or "sunset" in uid
        or "ventilation" in uid
        or "open_time" in uid
        or "close_time" in uid
        or "temp_sensor" in uid
        or "cloud_sensor" in uid
        or "cardinal_direction" in uid
        or "sleep_in_tomorrow" in uid
        or "random_delay" in uid
        or "position_threshold" in uid
        or "clear_overrides" in uid
        or "force_plan" in uid
        or "force_apply" in uid
    ):
        return "blinds"
    return None


def _target_module_for_device(dev_entry, store) -> str | None:
    """Determine which config entry module owns a SmartHome Companion device."""
    for dom, ident in dev_entry.identifiers:
        if dom != DOMAIN:
            continue
        if ident.startswith("group_"):
            return "groups"
        if ident == "groups_hub":
            return "groups"
        if ident in ("simulation_hub",):
            return "hub"
        if ident in ("irrigation_hub",) or ident.startswith("irrigation_zone_"):
            return "irrigation"
        if ident == "hub" or ident.startswith("cover.") or ident in (store.get_blinds() if store else {}):
            return "blinds"
    return None


async def async_organize_and_cleanup_devices(hass, store) -> dict[str, int]:
    """Migrate entities/devices into module-scoped entries and remove empty orphan devices."""
    entries_by_module: dict[str, str] = {}
    for cfg_entry in hass.config_entries.async_entries(DOMAIN):
        mod = cfg_entry.data.get("module")
        if mod and mod not in entries_by_module:
            entries_by_module[mod] = cfg_entry.entry_id

    # Nothing to separate if running in single legacy entry mode
    if "legacy" in entries_by_module and len(entries_by_module) == 1:
        return {"migrated_entities": 0, "migrated_devices": 0, "removed_devices": 0}

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)

    migrated_entities = 0
    migrated_devices = 0
    removed_devices = 0

    # 1. Ensure parent hub devices exist with consistent models
    if "blinds" in entries_by_module:
        dev_reg.async_get_or_create(
            config_entry_id=entries_by_module["blinds"],
            identifiers={(DOMAIN, "hub")},
            name="SmartHome Rollläden (Steuerung)",
            manufacturer="SmartHome Companion",
            model="Rollläden · Steuerung",
        )
    if "irrigation" in entries_by_module:
        dev_reg.async_get_or_create(
            config_entry_id=entries_by_module["irrigation"],
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerung · Steuerung",
        )
    if "hub" in entries_by_module:
        dev_reg.async_get_or_create(
            config_entry_id=entries_by_module["hub"],
            identifiers={(DOMAIN, "simulation_hub")},
            name="SmartHome Companion Hub",
            manufacturer="SmartHome Companion",
            model="System · Hub & Simulation",
        )

    # 2. Reassign devices cleanly to their owning module's config entry
    groups = store.get_groups() if store else {}
    blinds_hub_id = get_device_id_by_identifier_compat(hass, (DOMAIN, "hub"))
    irrigation_hub_id = get_device_id_by_identifier_compat(hass, (DOMAIN, "irrigation_hub"))

    for dev in list(dev_reg.devices.values()):
        if not dev.identifiers or not all(dom == DOMAIN for dom, _ in dev.identifiers):
            continue
        target_mod = _target_module_for_device(dev, store)
        if not target_mod or target_mod not in entries_by_module:
            continue
        target_entry_id = entries_by_module[target_mod]

        # Ensure group device metadata is synchronized with current store category/name
        update_kwargs: dict = {}
        for _, ident in dev.identifiers:
            if ident.startswith("group_"):
                gid = ident[len("group_") :]
                g_cfg = groups.get(gid)
                if isinstance(g_cfg, dict):
                    cat_key = (g_cfg.get("category") or "leuchte").strip()
                    cats = store.get_categories() if store else DEFAULT_CATEGORIES
                    cat_label = (cats.get(cat_key) or DEFAULT_CATEGORIES.get(cat_key) or {}).get("display_name") or cat_key.title()
                    desired_model = f"Gruppe · {cat_label}"
                    if dev.model != desired_model:
                        update_kwargs["model"] = desired_model
            elif ident == "hub":
                if dev.model != "Rollläden · Steuerung":
                    update_kwargs["model"] = "Rollläden · Steuerung"
                if dev.name == "SmartHome Companion":
                    update_kwargs["name"] = "SmartHome Rollläden (Steuerung)"
            elif ident.startswith("cover."):
                if dev.model != "Rollläden · Automat":
                    update_kwargs["model"] = "Rollläden · Automat"
                if blinds_hub_id and getattr(dev, "via_device_id", None) != blinds_hub_id:
                    update_kwargs["via_device_id"] = blinds_hub_id
            elif ident == "irrigation_hub":
                if dev.model != "Bewässerung · Steuerung":
                    update_kwargs["model"] = "Bewässerung · Steuerung"
            elif ident.startswith("irrigation_zone_"):
                if dev.model != "Bewässerung · Kreis":
                    update_kwargs["model"] = "Bewässerung · Kreis"
                if irrigation_hub_id and getattr(dev, "via_device_id", None) != irrigation_hub_id:
                    update_kwargs["via_device_id"] = irrigation_hub_id
            elif ident == "simulation_hub":
                if dev.model != "System · Hub & Simulation":
                    update_kwargs["model"] = "System · Hub & Simulation"

        if target_entry_id not in dev.config_entries:
            update_kwargs["add_config_entry_id"] = target_entry_id
        for old_eid in list(dev.config_entries):
            if old_eid != target_entry_id and old_eid in entries_by_module.values():
                # Update step by step because async_update_device accepts one add/remove per call in some HA versions
                dev_reg.async_update_device(dev.id, remove_config_entry_id=old_eid)
                migrated_devices += 1

        if update_kwargs:
            dev_reg.async_update_device(dev.id, **update_kwargs)
            migrated_devices += 1

    # 3. Reassign entities cleanly so HA groups them under the matching module entry
    sim_hub_id = get_device_id_by_identifier_compat(hass, (DOMAIN, "simulation_hub"))
    for ent in list(ent_reg.entities.values()):
        if ent.platform != DOMAIN:
            continue
        target_mod = _target_module_for_entity(ent)
        if not target_mod or target_mod not in entries_by_module:
            continue
        target_entry_id = entries_by_module[target_mod]
        ent_kwargs: dict = {}
        if ent.config_entry_id != target_entry_id:
            ent_kwargs["config_entry_id"] = target_entry_id
        if ent.unique_id == "smarthome_companion_presence_simulation_active" and sim_hub_id and ent.device_id != sim_hub_id:
            ent_kwargs["device_id"] = sim_hub_id
        if ent_kwargs:
            try:
                ent_reg.async_update_entity(ent.entity_id, **ent_kwargs)
                migrated_entities += 1
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Could not reassign entity %s: %s", ent.entity_id, err)

    # 4. Remove empty orphan SmartHome Companion devices (no entities left)
    attached_dev_ids = {e.device_id for e in ent_reg.entities.values() if e.device_id}
    for dev in list(dev_reg.devices.values()):
        if not dev.identifiers or not all(dom == DOMAIN for dom, _ in dev.identifiers):
            continue
        # Keep active singleton control hubs even if temporarily entity-less during module transition
        idents = {ident for _, ident in dev.identifiers}
        has_attached = dev.id in attached_dev_ids
        if idents & {"hub", "irrigation_hub", "simulation_hub", "groups_hub"}:
            # Remove only if a SECOND duplicate hub exists without entities
            if has_attached:
                continue
            primary_id = next(iter(idents), "")
            if primary_id == "hub" and "blinds" in entries_by_module and dev.id == blinds_hub_id:
                continue
            if primary_id == "irrigation_hub" and "irrigation" in entries_by_module and dev.id == irrigation_hub_id:
                continue
            if primary_id == "simulation_hub" and "hub" in entries_by_module and dev.id == sim_hub_id:
                continue
        if not has_attached:
            try:
                dev_reg.async_remove_device(dev.id)
                removed_devices += 1
                _LOGGER.info("Removed orphan SmartHome Companion device: %s (%s)", dev.name, dev.id)
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Could not remove orphan device %s: %s", dev.id, err)

    if migrated_entities or migrated_devices or removed_devices:
        _LOGGER.info(
            "Organized SmartHome Companion devices/entities (entities=%d, devices=%d, orphans_removed=%d)",
            migrated_entities,
            migrated_devices,
            removed_devices,
        )
    return {
        "migrated_entities": migrated_entities,
        "migrated_devices": migrated_devices,
        "removed_devices": removed_devices,
    }
