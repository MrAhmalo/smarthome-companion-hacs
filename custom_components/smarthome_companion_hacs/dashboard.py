"""Companion dashboard: sidebar panel, self-healing layout resolver and WebSocket API.

The panel is a self-contained custom panel (vanilla web components, no HACS
cards required).  The room/tile layout is *resolved server-side on every
request* from the Companion device store, so renaming an entity or setting a
device up again can never leave a dead tile behind:

* tiles reference entities via the immutable ``unique_id`` first
* the current ``entity_id`` is looked up in the entity registry
* area assignment comes from the live HA registries
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

# pyrefly: ignore [missing-import]
import voluptuous as vol
# pyrefly: ignore [missing-import]
from homeassistant.components import frontend, panel_custom, websocket_api
# pyrefly: ignore [missing-import]
from homeassistant.components.http import StaticPathConfig
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import DOMAIN, VERSION
from .entity_sync import async_sync_renamed_entities, slugify_ha

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "companion-dashboard"
STATIC_URL = "/smarthome_companion_hacs_static"
UPDATE_EVENT = f"{DOMAIN}_dashboard_updated"

# Registry events that make the client re-fetch its layout.
_WATCHED_EVENTS = (
    "entity_registry_updated",
    "device_registry_updated",
    "area_registry_updated",
    UPDATE_EVENT,
)

# Sort weight of device categories inside a room (lower = further up).
# Strict priority: 1. Jalousien (Rollläden), 2. Medien (TV / Apple TV), 3. Der Rest (Lichter, Schalter, etc.)
_CATEGORY_WEIGHT = {
    "jalousie": 0,
    "cover": 0,
    "fernseher": 1,
    "medien": 1,
    "media_player": 1,
    "leuchte": 2,
    "light": 2,
    "steckdose": 3,
    "schalter": 4,
    "switch": 4,
    "klima": 5,
    "wasserventil": 6,
    "pumpe": 7,
    "bewegungsmelder": 8,
    "raummessgeraet": 9,
    "bodenmessgeraet": 9,
}

NO_AREA_ID = "__none__"


# ═══════════════════════════════════════════════
# DEFAULT CONFIG (seeded once from the legacy Lovelace dashboard)
# ═══════════════════════════════════════════════

async def _async_default_config(hass) -> dict:
    """Build the initial dashboard config; user names are mapped to user ids."""
    users: dict[str, str] = {}
    try:
        for user in await hass.auth.async_get_users():
            if user.name and user.is_active and not user.system_generated:
                users[user.name.lower()] = user.id
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Could not read users for dashboard seed: %s", err)

    def ids(*names: str) -> list[str]:
        return [users[n.lower()] for n in names if n.lower() in users]

    return {
        "greeting_entity": "sensor.greeting_sensor",
        "badges": [
            {"entity_id": "binary_sensor.fritz_box_7590_ax_verbindung", "name": "Offline",
             "icon": "mdi:cloud-off", "color": "red", "show_name": True, "show_state": False,
             "tap": "more-info", "visible_when": "state_in", "visible_value": "unavailable, off"},
            {"entity_id": "sensor.lichter_zahler", "icon": "mdi:lightbulb", "color": "amber",
             "show_state": True, "tap": "more-info"},
            {"entity_id": "sensor.einkaufsliste_zahl", "icon": "mdi:cart", "color": "green",
             "show_state": True, "tap": "navigate", "path": "/todo?entity_id=todo.cookidoo_zusatzliche_kaufe",
             "visible_when": "above", "visible_value": "0"},
            {"entity_id": "weather.forecast_home", "name": "Wetter", "color": "light-blue",
             "show_name": True, "show_state": True, "tap": "navigate", "path": "/lovelace/solar"},
            {"entity_id": "sensor.aussentemperatur_fallback", "show_state": True,
             "tap": "navigate", "path": "/lovelace/mehr"},
            {"entity_id": "input_boolean.warmwasser_push", "show_name": True, "show_state": True,
             "tap": "service", "service": "input_boolean.turn_on"},
            {"entity_id": "sensor.inverter_input_power", "name": "Ertrag", "icon": "mdi:solar-power-variant",
             "color": "yellow", "show_name": True, "show_state": True, "tap": "navigate",
             "path": "/lovelace/solar", "visible_when": "above", "visible_value": "0"},
            {"entity_id": "sensor.power_house_load", "name": "Stromverbrauch",
             "icon": "mdi:home-lightning-bolt-outline", "color": "red", "show_name": True,
             "show_state": True, "tap": "navigate", "path": "/lovelace/solar",
             "visible_when": "below", "visible_value": "1"},
        ],
        "warning": {
            "entity_id": "sensor.stadt_grevenbroich_aktuelle_warnstufe",
            "headline_attribute": "warning_1_headline",
            "path": "/dashboard-warnungen/dash-warnungen",
        },
        "announce": {
            "entity_id": "script.ankundigung",
            "name": "Ankündigung",
            "icon": "mdi:bullhorn",
            "chips": [
                {"entity_id": "sensor.hp_officejet_3830_series_black_ink", "icon": "mdi:water-black"},
                {"entity_id": "sensor.hp_officejet_3830_series_tri_color_ink", "icon": "mdi:palette"},
            ],
            "chips_visible_entity": "sensor.hp_officejet_3830_series",
        },
        "trash": {
            "calendar_entities": ["calendar.muellplan"],
            "next_days": 2,
            "patterns": [
                {"pattern": "Bioabfall", "icon": "mdi:flower", "color": "lime", "picture": "/local/custom-icons/trash-bins/brown.png"},
                {"pattern": "Papier", "icon": "mdi:newspaper", "color": "blue", "picture": "/local/custom-icons/trash-bins/blue.png"},
                {"pattern": "Leichtverpackungen", "icon": "mdi:recycle-variant", "color": "amber", "picture": "/local/custom-icons/trash-bins/yellow.png"},
                {"pattern": "Restabfall", "icon": "mdi:trash-can-outline", "color": "grey", "picture": "/local/custom-icons/trash-bins/black.png"},
            ],
        },
        "persons": [
            {"entity_id": "device_tracker.rumpelbude", "users": ["6d1c5e264a044ddbb1deddec8e10f4a8"]},
            {"entity_id": "device_tracker.pcvonmatilda", "users": ["a07810862d04475f9d56c97293603c3d"]},
        ],
        "nav": [
            {"name": "Sicherheit", "icon": "mdi:shield-home", "path": "/lovelace/sicherheit"},
            {"name": "", "icon": "mdi:home-export-outline", "path": "/lovelace/mehr"},
        ],
        "color_presets": [[234, 136, 140], [136, 198, 237], [140, 231, 185], [255, 119, 0]],
        "room_order": ["wohnzimmer", "schlafzimmer", "julian_s_zimmer", "matilda_s_zimmer", "garten", "haus"],
        "rooms": {
            "wohnzimmer": {"expanded": "collapsed", "expanded_users": ids("Brigitte", "Julian", "Sven", "Gast")},
            "schlafzimmer": {"expanded": "collapsed", "expanded_users": ids("Brigitte", "Sven")},
            "julian_s_zimmer": {"expanded": "collapsed", "expanded_users": ids("Julian")},
            "matilda_s_zimmer": {"expanded": "collapsed", "expanded_users": ids("Matilda")},
            "garten": {"expanded": "expanded", "expanded_users": ids("Matilda")},
        },
        "tile_order": {},
        "hidden_tiles": [],
        "tile_users": {},
        "extra_tiles": [],
    }


_LEGACY_SEEDED_EXTRA_ENTITIES = {
    "media_player.wohnzimmer",
    "media_player.matilda",
    "climate.meacocool_pro_10000_klimaanlage",
    "input_boolean.disco",
    "input_boolean.pc_system",
}

_LIST_KEYS = ("badges", "nav", "persons", "color_presets", "room_order", "hidden_tiles", "extra_tiles")
_DICT_KEYS = ("warning", "announce", "trash", "rooms", "tile_order", "tile_users")


def _sanitize_config(raw: dict) -> dict:
    """Keep only known keys with the expected container types."""
    clean: dict = {}
    if isinstance(raw.get("greeting_entity"), str):
        clean["greeting_entity"] = raw["greeting_entity"].strip()
    for key in _LIST_KEYS:
        value = raw.get(key)
        clean[key] = value if isinstance(value, list) else []
    for key in _DICT_KEYS:
        value = raw.get(key)
        clean[key] = value if isinstance(value, dict) else {}
    return clean


async def async_get_or_create_config(hass, store) -> dict:
    """Return the stored config, seeding it on first use."""
    config = store.get_dashboard_config()
    if config is None:
        config = _sanitize_config(await _async_default_config(hass))
        await store.save_dashboard_config(config)
    else:
        # Migration: Purge legacy hardcoded default extra_tiles so only devices
        # configured in the device manager appear on the dashboard.
        changed = False
        extras = config.get("extra_tiles", [])
        if any(isinstance(e, dict) and e.get("entity_id") in _LEGACY_SEEDED_EXTRA_ENTITIES for e in extras):
            config["extra_tiles"] = [
                e for e in extras
                if isinstance(e, dict) and e.get("entity_id") not in _LEGACY_SEEDED_EXTRA_ENTITIES
            ]
            changed = True

        # Migration: Ensure default trash bin picture URLs are populated
        _DEFAULT_TRASH_PICS = {
            "bioabfall": "/local/custom-icons/trash-bins/brown.png",
            "papier": "/local/custom-icons/trash-bins/blue.png",
            "leichtverpackungen": "/local/custom-icons/trash-bins/yellow.png",
            "restabfall": "/local/custom-icons/trash-bins/black.png",
        }
        trash = config.get("trash", {})
        if isinstance(trash, dict):
            for p in trash.get("patterns", []):
                if isinstance(p, dict) and not p.get("picture"):
                    pat_key = str(p.get("pattern", "")).strip().lower()
                    if pat_key in _DEFAULT_TRASH_PICS:
                        p["picture"] = _DEFAULT_TRASH_PICS[pat_key]
                        changed = True

        if changed:
            await store.save_dashboard_config(config)
    return config


# ═══════════════════════════════════════════════
# LAYOUT RESOLVER (self-healing)
# ═══════════════════════════════════════════════

def _device_class(entry) -> str | None:
    return entry.device_class or entry.original_device_class


def _build_uid_index(ent_reg) -> dict:
    return {(e.domain, e.unique_id): e for e in ent_reg.entities.values() if e.unique_id}


def _resolve_entry(ent_reg, by_uid, entity_id, unique_id=None, original_id=None):
    """Find the *current* registry entry: unique_id first, then ids."""
    for candidate in (entity_id, original_id):
        if not candidate:
            continue
        domain = candidate.split(".")[0]
        if unique_id and (domain, unique_id) in by_uid:
            return by_uid[(domain, unique_id)]
    for candidate in (entity_id, original_id):
        if candidate:
            entry = ent_reg.async_get(candidate)
            if entry is not None:
                return entry
    return None


def _clean_icon(icon):
    return icon if isinstance(icon, str) and ":" in icon else None


def _allowed(users, user_id) -> bool:
    return not users or user_id in users


def build_layout(hass, store, config: dict, user_id: str | None, edit: bool = False) -> dict:
    """Resolve the whole room/tile layout against the live registries."""
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    by_uid = _build_uid_index(ent_reg)
    categories = store.get_categories()

    areas = {a.id: a for a in area_reg.async_list_areas()}
    rooms_cfg = config.get("rooms", {})
    hidden_tiles = set(config.get("hidden_tiles", []))
    tile_users = config.get("tile_users", {})

    def valid_area(aid: str | None) -> str | None:
        return aid if (aid and aid in areas) else None

    tiles_by_area: dict[str, list[dict]] = {}
    configured_sensors: dict[str, dict[str, list[str]]] = {}
    seen_entities: set[str] = set()

    def add_tile(area_id, tile):
        if tile["entity_id"] in seen_entities:
            return
        seen_entities.add(tile["entity_id"])
        tile["hidden"] = tile["key"] in hidden_tiles
        tile["users"] = tile_users.get(tile["key"], [])
        if not edit:
            if tile["hidden"] or not _allowed(tile["users"], user_id):
                return
        tiles_by_area.setdefault(valid_area(area_id) or NO_AREA_ID, []).append(tile)

    def make_tile(key, entry, entity_id, name, category, icon, device, power=None, energy=None):
        cat = categories.get(category, {}) if category else {}
        area_id = valid_area((entry.area_id if entry else None) or (device.area_id if device else None))
        return area_id, {
            "key": key,
            "device_id": device.id if device else (key.split(":")[0] if ":" in key else None),
            "entity_id": entity_id,
            "name": name or "",
            "icon": _clean_icon(icon),
            "category": category,
            "color": cat.get("color"),
            "power": power,
            "energy": energy,
        }

    def resolve_aux(entity_id):
        """Power/energy helper sensors: keep only ones that still exist."""
        if entity_id and (ent_reg.async_get(entity_id) or hass.states.get(entity_id)):
            return entity_id
        return None

    # ── Devices configured in the Companion device manager ──
    for device_id, cfg in store.get_devices().items():
        device = dev_reg.async_get(device_id)
        if device is None:
            continue  # device was deleted in HA
        ents = cfg.get("entities") or {}
        subs = ents.get("sub_entities") or {}
        category = cfg.get("category")
        device_name = cfg.get("custom_name") or device.name_by_user or device.name or ""

        if isinstance(subs, dict) and subs:
            valid_subs = []
            for sub_key, sub in subs.items():
                if not isinstance(sub, dict):
                    continue
                entry = _resolve_entry(ent_reg, by_uid, sub_key, sub.get("unique_id"), sub.get("original_id"))
                if entry is not None:
                    if entry.disabled_by or getattr(entry, "entity_category", None) in ("config", "diagnostic"):
                        continue
                    entity_id = entry.entity_id
                elif hass.states.get(sub_key):
                    entity_id = sub_key
                else:
                    continue
                # Filter out config/diagnostic utility switches
                eid_lower = entity_id.lower()
                name_lower = (sub.get("custom_name") or sub.get("name") or (entry.name if entry else "") or "").lower()
                config_pattern = ("overcharge", "protection", "kindersicherung", "child_lock", "childlock", "led_mode", "ledmode")
                if any(x in eid_lower or x in name_lower for x in config_pattern):
                    continue
                valid_subs.append((sub_key, sub, entry, entity_id))

            for sub_key, sub, entry, entity_id in valid_subs:
                uid = sub.get("unique_id") or entity_id
                name = sub.get("custom_name") or sub.get("name") or device_name
                if len(valid_subs) == 1 and not sub.get("custom_name"):
                    name = device_name or name
                area_id, tile = make_tile(
                    f"{device_id}:{uid}", entry, entity_id, name, sub.get("category") or category,
                    sub.get("icon") or cfg.get("icon"), device,
                    resolve_aux(sub.get("power")), resolve_aux(sub.get("energy")),
                )
                add_tile(area_id, tile)
        else:
            primary = ents.get("primary")
            if not primary:
                continue
            entry = _resolve_entry(ent_reg, by_uid, primary, ents.get("primary_unique_id"))
            if entry is not None:
                if entry.disabled_by:
                    continue
                entity_id = entry.entity_id
            elif hass.states.get(primary):
                entity_id = primary
            else:
                continue
            uid = ents.get("primary_unique_id") or entity_id
            area_id, tile = make_tile(
                f"{device_id}:{uid}", entry, entity_id, device_name, category, cfg.get("icon"),
                device, resolve_aux(ents.get("power")), resolve_aux(ents.get("energy")),
            )
            add_tile(area_id, tile)

        # Explicitly configured room sensors on this device
        room_sensors = ents.get("room_sensors") or {}
        if isinstance(room_sensors, dict):
            for s_key, s_cfg in room_sensors.items():
                if not isinstance(s_cfg, dict) or not s_cfg.get("enabled", True):
                    continue
                s_type = s_cfg.get("type")
                if s_type not in ("temperature", "humidity", "motion", "moisture"):
                    continue
                s_entry = _resolve_entry(
                    ent_reg, by_uid, s_key, s_cfg.get("unique_id"), s_cfg.get("original_id")
                )
                if s_entry is not None:
                    if s_entry.disabled_by:
                        continue
                    s_eid = s_entry.entity_id
                elif hass.states.get(s_key):
                    s_eid = s_key
                else:
                    continue
                s_area = valid_area((s_entry.area_id if s_entry else None) or (device.area_id if device else None)) or NO_AREA_ID
                bucket = configured_sensors.setdefault(s_area, {}).setdefault(s_type, [])
                if s_eid not in bucket:
                    bucket.append(s_eid)

    # ── Extra tiles (helpers, scripts … that have no device) ──
    for extra in config.get("extra_tiles", []):
        if not isinstance(extra, dict) or not extra.get("entity_id"):
            continue
        entry = _resolve_entry(ent_reg, by_uid, extra["entity_id"], extra.get("unique_id"))
        entity_id = entry.entity_id if entry else extra["entity_id"]
        if entry is None and hass.states.get(entity_id) is None:
            continue
        device = dev_reg.async_get(entry.device_id) if entry and entry.device_id else None
        area_id, tile = make_tile(
            f"extra:{(entry.unique_id if entry and entry.unique_id else entity_id)}",
            entry, entity_id, extra.get("name"), None, extra.get("icon"), device,
        )
        add_tile(valid_area(extra.get("area_id")) or area_id, tile)

    # Only configured devices and extra_tiles are included on the dashboard

    # ── Hierarchical Groups (Multi-device / Nested Groups) ──
    groups = store.get_groups()
    if groups:
        tile_by_dev: dict[str, list[dict]] = {}
        tile_by_ent: dict[str, dict] = {}
        for a_id, t_list in list(tiles_by_area.items()):
            for t in t_list:
                if t.get("device_id"):
                    tile_by_dev.setdefault(t["device_id"], []).append(t)
                if t.get("entity_id"):
                    tile_by_ent[t["entity_id"]] = t

        subgroup_ids = set()
        for g in groups.values():
            for child_ref in g.get("children", []):
                if child_ref in groups:
                    subgroup_ids.add(child_ref)

        def resolve_group(gid, visited=None):
            if visited is None:
                visited = set()
            if gid in visited or gid not in groups:
                return None
            visited.add(gid)
            g = groups[gid]
            g_cat = g.get("category") or "leuchte"
            cat_info = categories.get(g_cat, {})

            child_specs = []
            descendant_eids = []

            for ref in g.get("children", []):
                if ref in groups:
                    sub_spec = resolve_group(ref, visited.copy())
                    if sub_spec:
                        child_specs.append(sub_spec)
                        descendant_eids.extend(sub_spec.get("entity_ids", []))
                elif ref in tile_by_dev:
                    for t in tile_by_dev[ref]:
                        child_specs.append(t)
                        if t.get("entity_id"):
                            descendant_eids.append(t["entity_id"])
                elif ref in tile_by_ent:
                    t = tile_by_ent[ref]
                    child_specs.append(t)
                    if t.get("entity_id"):
                        descendant_eids.append(t["entity_id"])
                elif ref.startswith("d:"):
                    parts = ref.split(":", 2)
                    if len(parts) >= 3 and hass.states.get(parts[2]):
                        eid = parts[2]
                        descendant_eids.append(eid)
                        st = hass.states.get(eid)
                        child_specs.append({
                            "key": ref,
                            "entity_id": eid,
                            "device_id": parts[1],
                            "name": st.attributes.get("friendly_name") or eid,
                            "category": g_cat,
                            "icon": g.get("icon") or cat_info.get("icon"),
                            "area_id": g.get("area_id"),
                        })
                elif hass.states.get(ref):
                    descendant_eids.append(ref)
                    child_specs.append({
                        "key": f"e:{ref}",
                        "entity_id": ref,
                        "name": hass.states.get(ref).attributes.get("friendly_name") or ref,
                        "category": g_cat,
                        "icon": g.get("icon") or cat_info.get("icon"),
                    })
                elif dev_reg.async_get(ref):
                    dev = dev_reg.async_get(ref)
                    dev_name = dev.name_by_user or dev.name or "Gerät"
                    dev_ents = [
                        e for e in ent_reg.entities.values()
                        if e.device_id == ref and not e.disabled_by
                        and e.domain in ("light", "switch", "cover", "valve", "media_player")
                    ]
                    if dev_ents:
                        # Prioritize lights if group category is leuchte/light
                        matching_ents = [e for e in dev_ents if (e.domain == "light" if g_cat in ("leuchte", "light") else e.domain in ("switch", "light"))]
                        ents_to_use = matching_ents or dev_ents
                        for e_item in ents_to_use:
                            descendant_eids.append(e_item.entity_id)
                            ent_st = hass.states.get(e_item.entity_id)
                            item_name = (
                                (ent_st.attributes.get("friendly_name") if ent_st else None)
                                or e_item.name
                                or e_item.original_name
                                or dev_name
                            )
                            child_specs.append({
                                "key": f"d:{ref}:{e_item.entity_id}",
                                "device_id": ref,
                                "entity_id": e_item.entity_id,
                                "name": item_name,
                                "category": g_cat,
                                "icon": g.get("icon") or cat_info.get("icon"),
                                "area_id": valid_area(dev.area_id) or valid_area(g.get("area_id")),
                            })

            unique_eids = list(dict.fromkeys(descendant_eids))
            area_id = valid_area(g.get("area_id"))
            if not area_id and child_specs:
                first = child_specs[0]
                area_id = valid_area(first.get("area_id"))

            group_entry = by_uid.get(("light", f"smarthome_companion_group_light_{gid}"))
            return {
                "key": f"group:{gid}",
                "is_group": True,
                "group_id": gid,
                "entity_id": group_entry.entity_id if group_entry else None,
                "name": g.get("name") or "Gruppe",
                "category": g_cat,
                "icon": g.get("icon") or "mdi:lightbulb-group",
                "color": cat_info.get("color"),
                "area_id": area_id,
                "entity_ids": unique_eids,
                "children": child_specs,
            }

        claimed_tile_keys = set()
        root_group_tiles: list[dict] = []

        for gid in groups:
            if gid not in subgroup_ids:
                spec = resolve_group(gid)
                if spec and spec["entity_ids"]:
                    root_group_tiles.append(spec)
                    def mark_claimed(s):
                        for c in s.get("children", []):
                            if c.get("is_group"):
                                mark_claimed(c)
                            elif c.get("key"):
                                claimed_tile_keys.add(c["key"])
                    mark_claimed(spec)

        for a_id in list(tiles_by_area):
            tiles_by_area[a_id] = [t for t in tiles_by_area[a_id] if t["key"] not in claimed_tile_keys]

        for g_tile in root_group_tiles:
            target_area = g_tile.get("area_id") or NO_AREA_ID
            tiles_by_area.setdefault(target_area, []).append(g_tile)

    # ── Assemble rooms (only configured devices/sensors appear) ──
    order = [a for a in config.get("room_order", []) if isinstance(a, str)]
    all_ids = set(tiles_by_area) | set(configured_sensors)
    if edit:
        all_ids |= set(areas.keys())
    ordered = [a for a in order if a in all_ids]
    rest = sorted(
        (a for a in all_ids if a not in order and a != NO_AREA_ID),
        key=lambda a: (areas[a].name.lower() if a in areas else a),
    )
    ordered += rest
    if NO_AREA_ID in all_ids and NO_AREA_ID not in ordered:
        ordered.append(NO_AREA_ID)

    rooms = []
    for area_id in ordered:
        rcfg = rooms_cfg.get(area_id, {}) if isinstance(rooms_cfg.get(area_id, {}), dict) else {}
        visible_users = rcfg.get("visible_users", [])
        if not edit and not _allowed(visible_users, user_id):
            continue
        tiles = list(tiles_by_area.get(area_id, []))
        all_room_sensors = configured_sensors.get(area_id, {})
        if (not edit or area_id == NO_AREA_ID) and not tiles and not all_room_sensors:
            continue
        custom_order = config.get("tile_order", {}).get(area_id, [])
        pos = {k: i for i, k in enumerate(custom_order)}
        # Strict hierarchy: 1. Jalousien, 2. Medien/TV, 3. Rest. Custom order applies within category.
        tiles.sort(key=lambda t: (
            _CATEGORY_WEIGHT.get(t["category"], 50),
            pos.get(t["key"], 10_000),
            t["name"].lower(),
        ))
        mode = rcfg.get("expanded", "collapsed")
        expanded = mode in ("expanded", "always") or user_id in rcfg.get("expanded_users", [])
        area = areas.get(area_id)
        sensor_prefs = rcfg.get("sensor_prefs", {}) if isinstance(rcfg.get("sensor_prefs"), dict) else {}
        effective_sensors: dict[str, list[str]] = {}
        for s_type, eids in all_room_sensors.items():
            pref = sensor_prefs.get(s_type)
            if isinstance(pref, dict) and isinstance(pref.get("entities"), list):
                valid_sel = [e for e in pref["entities"] if e in eids]
                if valid_sel:
                    effective_sensors[s_type] = [valid_sel[0]] if pref.get("mode") == "single" else valid_sel
                else:
                    effective_sensors[s_type] = list(eids)
            else:
                effective_sensors[s_type] = list(eids)

        rooms.append({
            "area_id": area_id,
            "name": area.name if area else "Nicht zugeordnet",
            "icon": _clean_icon(rcfg.get("icon")) or (area.icon if area and area.icon else "mdi:home-outline"),
            "tiles": tiles,
            "expanded": expanded,
            "always_open": mode == "always",
            "visible_users": visible_users,
            "expanded_users": rcfg.get("expanded_users", []),
            "mode": mode,
            "sensors": effective_sensors,
            "all_sensors": all_room_sensors,
            "sensor_prefs": sensor_prefs,
        })

    return {
        "rooms": rooms,
        "areas": [{"area_id": a.id, "name": a.name, "icon": a.icon or ""} for a in sorted(areas.values(), key=lambda x: x.name.lower())],
    }


# ═══════════════════════════════════════════════
# WEBSOCKET API
# ═══════════════════════════════════════════════

def async_register_dashboard_websockets(hass):
    websocket_api.async_register_command(hass, handle_dashboard_get)
    websocket_api.async_register_command(hass, handle_dashboard_save)
    websocket_api.async_register_command(hass, handle_dashboard_room_update)
    websocket_api.async_register_command(hass, handle_dashboard_room_delete)
    websocket_api.async_register_command(hass, handle_dashboard_users)
    websocket_api.async_register_command(hass, handle_dashboard_subscribe)


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/get",
    vol.Optional("edit", default=False): bool,
})
@websocket_api.async_response
async def handle_dashboard_get(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    config = await async_get_or_create_config(hass, store)
    user = connection.user
    edit = bool(msg.get("edit")) and user.is_admin
    connection.send_result(msg["id"], {
        "config": config,
        "layout": build_layout(hass, store, config, user.id, edit=edit),
        "user": {"id": user.id, "name": user.name, "is_admin": user.is_admin},
    })


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/save",
    vol.Required("config"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def handle_dashboard_save(hass, connection, msg):
    store = hass.data[DOMAIN]["store"]
    config = _sanitize_config(msg["config"])

    # Pin extra tiles to their immutable unique_id (self-healing on rename).
    ent_reg = er.async_get(hass)
    for extra in config["extra_tiles"]:
        if isinstance(extra, dict) and extra.get("entity_id") and not extra.get("unique_id"):
            entry = ent_reg.async_get(extra["entity_id"])
            if entry and entry.unique_id:
                extra["unique_id"] = entry.unique_id

    if not await store.save_dashboard_config(config):
        connection.send_result(msg["id"], {"save_failed": True})
        return
    hass.bus.async_fire(UPDATE_EVENT)
    connection.send_result(msg["id"], {"success": True, "config": config})


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/room_update",
    vol.Required("area_id"): str,
    vol.Optional("name"): str,
    vol.Optional("icon"): vol.Any(str, None),
    vol.Optional("sensor_prefs"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def handle_dashboard_room_update(hass, connection, msg):
    """Update a room's name/icon/sensor_prefs and cascade room slug changes to entities."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    area_reg = ar.async_get(hass)
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)

    old_slug = ""
    new_slug = ""
    renamed_map: dict[str, str] = {}

    if area_id != NO_AREA_ID:
        area_entry = area_reg.async_get_area(area_id)
        if area_entry:
            old_slug = slugify_ha(area_entry.name)
            area_kwargs = {}
            new_name = (msg.get("name") or "").strip()
            if new_name and new_name != area_entry.name:
                area_kwargs["name"] = new_name
                new_slug = slugify_ha(new_name)
            if "icon" in msg:
                area_kwargs["icon"] = msg["icon"] or None
            if area_kwargs:
                area_reg.async_update(area_id, **area_kwargs)

    config = _sanitize_config(await async_get_or_create_config(hass, store))
    room_cfg = config["rooms"].setdefault(area_id, {})
    if "icon" in msg:
        room_cfg["icon"] = msg["icon"]
    if "sensor_prefs" in msg:
        room_cfg["sensor_prefs"] = msg["sensor_prefs"]

    if not await store.save_dashboard_config(config):
        connection.send_result(msg["id"], {"save_failed": True})
        return

    if old_slug and new_slug and old_slug != new_slug:
        room_dev_ids = {d.id for d in dev_reg.devices.values() if d.area_id == area_id}
        for e in list(ent_reg.entities.values()):
            in_room = e.area_id == area_id or (e.device_id in room_dev_ids and not e.area_id)
            if not in_room:
                continue
            prefix = f"{e.domain}.{old_slug}_"
            if not e.entity_id.startswith(prefix):
                continue
            suffix = e.entity_id[len(prefix):]
            target_eid = f"{e.domain}.{new_slug}_{suffix}"
            if target_eid != e.entity_id and not ent_reg.async_get(target_eid):
                try:
                    ent_reg.async_update_entity(e.entity_id, new_entity_id=target_eid)
                    renamed_map[e.entity_id] = target_eid
                    _LOGGER.info("Cascaded room rename to entity ID: %s -> %s", e.entity_id, target_eid)
                except Exception as err:  # noqa: BLE001
                    _LOGGER.warning("Could not cascade room rename to %s: %s", e.entity_id, err)
        if renamed_map:
            await async_sync_renamed_entities(hass, store, renamed_map)

    hass.bus.async_fire(UPDATE_EVENT)
    connection.send_result(msg["id"], {"success": True, "renamed": renamed_map})


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/room_delete",
    vol.Required("area_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def handle_dashboard_room_delete(hass, connection, msg):
    """Delete an HA area cleanly and unassign all devices, entities, groups, and dashboard refs."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    if area_id == NO_AREA_ID:
        connection.send_result(msg["id"], {"success": True})
        return

    area_reg = ar.async_get(hass)
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)

    if area_reg.async_get_area(area_id):
        area_reg.async_delete(area_id)

    for d in list(dev_reg.devices.values()):
        if d.area_id == area_id:
            dev_reg.async_update_device(d.id, area_id=None)

    for e in list(ent_reg.entities.values()):
        if e.area_id == area_id:
            ent_reg.async_update_entity(e.entity_id, area_id=None)

    groups = store.get_groups()
    groups_changed = False
    for g in groups.values():
        if isinstance(g, dict) and g.get("area_id") == area_id:
            g["area_id"] = ""
            groups_changed = True
    if groups_changed:
        await store.save_groups(groups)

    config = _sanitize_config(await async_get_or_create_config(hass, store))
    for extra in config["extra_tiles"]:
        if isinstance(extra, dict) and extra.get("area_id") == area_id:
            extra["area_id"] = ""
    config["rooms"].pop(area_id, None)
    config["room_order"] = [rid for rid in config["room_order"] if rid != area_id]
    config["tile_order"].pop(area_id, None)

    if not await store.save_dashboard_config(config):
        connection.send_result(msg["id"], {"save_failed": True})
        return

    hass.bus.async_fire(UPDATE_EVENT)
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/users",
})
@websocket_api.require_admin
@websocket_api.async_response
async def handle_dashboard_users(hass, connection, msg):
    users = [
        {"id": u.id, "name": u.name}
        for u in await hass.auth.async_get_users()
        if u.is_active and not u.system_generated
    ]
    connection.send_result(msg["id"], {"users": sorted(users, key=lambda u: (u["name"] or "").lower())})


@websocket_api.websocket_command({
    vol.Required("type"): "smarthome_companion/dashboard/subscribe",
})
@callback
def handle_dashboard_subscribe(hass, connection, msg):
    """Forward registry/config changes (works for non-admin users, too)."""
    @callback
    def forward(event):
        connection.send_message(websocket_api.event_message(msg["id"], {"event": event.event_type}))

    unsubs = [hass.bus.async_listen(evt, forward) for evt in _WATCHED_EVENTS]

    @callback
    def unsub():
        for fn in unsubs:
            fn()

    connection.subscriptions[msg["id"]] = unsub
    connection.send_result(msg["id"])


# ═══════════════════════════════════════════════
# PANEL REGISTRATION
# ═══════════════════════════════════════════════

async def async_register_dashboard_panel(hass):
    """Serve the frontend bundle and add the sidebar entry."""
    frontend_dir = Path(__file__).parent / "frontend"
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(frontend_dir), cache_headers=False)]
        )
    except RuntimeError:
        pass  # already registered (config entry reload)

    try:
        frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
    except Exception:  # noqa: BLE001
        pass

    dev_server = os.environ.get("COMPANION_DEV_SERVER")
    if not dev_server and DOMAIN in hass.data and "store" in hass.data[DOMAIN]:
        try:
            cfg = await async_get_or_create_config(hass, hass.data[DOMAIN]["store"])
            dev_server = cfg.get("dev_server_url")
        except Exception:  # noqa: BLE001
            dev_server = None

    if dev_server:
        dev_server = dev_server.rstrip("/")
        module_url = f"{dev_server}/companion-dashboard.js"
        _LOGGER.warning("Companion Dashboard running in LIVE DEV MODE from: %s", module_url)
    else:
        bundle_file = Path(__file__).parent / "frontend" / "dist" / "companion-dashboard.bundle.js"
        if bundle_file.exists():
            module_url = f"{STATIC_URL}/dist/companion-dashboard.bundle.js?v={VERSION}"
        else:
            module_url = f"{STATIC_URL}/companion-dashboard.js?v={VERSION}"

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="companion-dashboard-panel",
        sidebar_title="Übersicht",
        sidebar_icon="mdi:view-dashboard",
        module_url=module_url,
        embed_iframe=False,
        require_admin=False,
        config={},
    )
    _LOGGER.info("Companion dashboard panel registered at /%s", PANEL_URL)


def async_remove_dashboard_panel(hass):
    try:
        frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
    except Exception:  # noqa: BLE001
        pass
