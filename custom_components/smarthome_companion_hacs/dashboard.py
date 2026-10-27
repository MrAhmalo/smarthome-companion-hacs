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
_CATEGORY_WEIGHT = {
    "jalousie": 0,
    "leuchte": 1,
    "steckdose": 2,
    "schalter": 3,
    "wasserventil": 4,
    "pumpe": 5,
    "klima": 6,
    "fernseher": 7,
    "medien": 7,
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
                {"pattern": "Bioabfall", "icon": "mdi:flower", "color": "lime",
                 "picture": "/local/custom-icons/trash-bins/brown.png"},
                {"pattern": "Papier", "icon": "mdi:newspaper", "color": "blue",
                 "picture": "/local/custom-icons/trash-bins/blue.png"},
                {"pattern": "Leichtverpackungen", "icon": "mdi:recycle-variant", "color": "amber",
                 "picture": "/local/custom-icons/trash-bins/yellow.png"},
                {"pattern": "Restabfall", "icon": "mdi:trash-can-outline", "color": "grey",
                 "picture": "/local/custom-icons/trash-bins/black.png"},
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
        "extra_tiles": [
            {"entity_id": "media_player.wohnzimmer", "area_id": "wohnzimmer", "name": "Apple TV",
             "icon": "mdi:television"},
            {"entity_id": "media_player.matilda", "area_id": "matilda_s_zimmer", "name": "Alexa",
             "icon": "mdi:speaker"},
            {"entity_id": "climate.meacocool_pro_10000_klimaanlage", "area_id": "julian_s_zimmer"},
            {"entity_id": "input_boolean.disco", "area_id": "julian_s_zimmer"},
            {"entity_id": "input_boolean.pc_system", "area_id": "julian_s_zimmer", "name": "PC",
             "icon": "hue:room-computer"},
        ],
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

    tiles_by_area: dict[str, list[dict]] = {}
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
        tiles_by_area.setdefault(area_id or NO_AREA_ID, []).append(tile)

    def make_tile(key, entry, entity_id, name, category, icon, device, power=None, energy=None):
        cat = categories.get(category, {}) if category else {}
        area_id = (entry.area_id if entry else None) or (device.area_id if device else None)
        return area_id, {
            "key": key,
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
            for sub_key, sub in subs.items():
                if not isinstance(sub, dict):
                    continue
                entry = _resolve_entry(ent_reg, by_uid, sub_key, sub.get("unique_id"), sub.get("original_id"))
                if entry is not None:
                    if entry.disabled_by:
                        continue
                    entity_id = entry.entity_id
                elif hass.states.get(sub_key):
                    entity_id = sub_key
                else:
                    continue
                uid = sub.get("unique_id") or entity_id
                name = sub.get("custom_name") or sub.get("name") or device_name
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
        add_tile(extra.get("area_id") or area_id, tile)

    # ── Area sensors / alerts straight from the registries ──
    sensors: dict[str, dict[str, list[str]]] = {}
    for entry in ent_reg.entities.values():
        if entry.disabled_by or entry.hidden_by:
            continue
        dc = _device_class(entry)
        wanted = None
        if entry.domain == "sensor" and dc in ("temperature", "humidity"):
            wanted = dc
        elif entry.domain == "binary_sensor" and dc in ("motion", "moisture"):
            wanted = dc
        if wanted is None:
            continue
        area_id = entry.area_id
        if not area_id and entry.device_id:
            dev = dev_reg.async_get(entry.device_id)
            area_id = dev.area_id if dev else None
        if area_id:
            sensors.setdefault(area_id, {}).setdefault(wanted, []).append(entry.entity_id)

    # ── Assemble rooms ──
    order = [a for a in config.get("room_order", []) if isinstance(a, str)]
    all_ids = set(tiles_by_area)
    ordered = [a for a in order if a in all_ids]
    rest = sorted(
        (a for a in all_ids if a not in order and a != NO_AREA_ID),
        key=lambda a: (areas[a].name.lower() if a in areas else a),
    )
    ordered += rest
    if NO_AREA_ID in all_ids:
        ordered.append(NO_AREA_ID)

    rooms = []
    for area_id in ordered:
        rcfg = rooms_cfg.get(area_id, {}) if isinstance(rooms_cfg.get(area_id, {}), dict) else {}
        visible_users = rcfg.get("visible_users", [])
        if not edit and not _allowed(visible_users, user_id):
            continue
        tiles = tiles_by_area[area_id]
        custom_order = config.get("tile_order", {}).get(area_id, [])
        pos = {k: i for i, k in enumerate(custom_order)}
        tiles.sort(key=lambda t: (
            pos.get(t["key"], 10_000),
            _CATEGORY_WEIGHT.get(t["category"], 50),
            t["name"].lower(),
        ))
        mode = rcfg.get("expanded", "collapsed")
        expanded = mode in ("expanded", "always") or user_id in rcfg.get("expanded_users", [])
        area = areas.get(area_id)
        rooms.append({
            "area_id": area_id,
            "name": area.name if area else "Sonstige",
            "icon": (area.icon if area and area.icon else "mdi:home-outline"),
            "tiles": tiles,
            "expanded": expanded,
            "always_open": mode == "always",
            "visible_users": visible_users,
            "expanded_users": rcfg.get("expanded_users", []),
            "mode": mode,
            "sensors": sensors.get(area_id, {}),
        })

    return {
        "rooms": rooms,
        "areas": [{"area_id": a.id, "name": a.name} for a in sorted(areas.values(), key=lambda x: x.name.lower())],
    }


# ═══════════════════════════════════════════════
# WEBSOCKET API
# ═══════════════════════════════════════════════

def async_register_dashboard_websockets(hass):
    websocket_api.async_register_command(hass, handle_dashboard_get)
    websocket_api.async_register_command(hass, handle_dashboard_save)
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

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="companion-dashboard-panel",
        sidebar_title="Übersicht",
        sidebar_icon="mdi:view-dashboard",
        module_url=f"{STATIC_URL}/companion-dashboard.js?v={VERSION}",
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
