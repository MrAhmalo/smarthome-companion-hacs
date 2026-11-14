"""Idempotent one-time migrations for SmartHome Companion OS."""

from __future__ import annotations

import logging
import re
# pyrefly: ignore [missing-import]
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .const import DOMAIN
from .entity_sync import async_sync_renamed_entities, sync_device_entity_ids
from .util import safe_fire_event
from .ws_api import _ensure_label_exists, _sync_entity_labels

_LOGGER = logging.getLogger(__name__)

MIGRATION_ENERGY_SENSORS_V1 = "energy_sensors_v1"
MIGRATION_SUB_ENTITY_NAMES_V1 = "sub_entity_names_v1"

_ENERGY_UNITS = {"kwh", "wh", "mwh"}
_NON_ENERGY_CLASSES = {
    "power",
    "apparent_power",
    "reactive_power",
    "water",
    "gas",
    "volume",
    "monetary",
    "duration",
    "voltage",
    "current",
    "frequency",
    "power_factor",
    "temperature",
    "humidity",
    "battery",
    "illuminance",
    "pressure",
    "signal_strength",
    "data_size",
    "data_rate",
    "timestamp",
    "enum",
}
_NON_ENERGY_UNITS = {
    "w",
    "kw",
    "mw",
    "va",
    "var",
    "v",
    "a",
    "ma",
    "hz",
    "l",
    "m³",
    "m3",
    "eur",
    "usd",
    "s",
    "min",
    "h",
    "°c",
    "°f",
    "%",
}
_ENERGY_KEYWORD_RE = re.compile(r"(energy|energie|verbrauch|consumption|summation|kwh|mwh|\bwh\b)")
_PENALTY_KEYWORD_RE = re.compile(
    r"(today|daily|yesterday|month|monthly|week|weekly|year|annual|hour|hourly|"
    r"returned|export|grid|feed_in|tages|heute|gestern|woche|monat|jahr|"
    r"einspeisung|rueckspeisung|rückspeisung)"
)
_CHANNEL_NUM_RE = re.compile(r"(?:_|ch|channel|l|switch|light|plug|outlet|socket)(\d+)(?:$|_)")


def _extract_channel_tokens(channel_eid: str | None, channel_name: str | None) -> list[str]:
    tokens: list[str] = []
    if channel_eid:
        eid_low = channel_eid.lower()
        for digits in _CHANNEL_NUM_RE.findall(eid_low):
            if digits not in tokens:
                tokens.append(digits)
    if channel_name:
        for part in re.split(r"[^a-z0-9äöüß]+", channel_name.lower()):
            if len(part) >= 2 and part not in tokens:
                tokens.append(part)
    return tokens


def _channel_match_score(entry, state, channel_eid: str | None, channel_name: str | None) -> int:
    tokens = _extract_channel_tokens(channel_eid, channel_name)
    if not tokens:
        return 0
    friendly = state.attributes.get("friendly_name", "") if state else ""
    hay = (
        f"{getattr(entry, 'entity_id', '')} "
        f"{getattr(entry, 'name', None) or ''} "
        f"{getattr(entry, 'original_name', None) or ''} "
        f"{friendly}"
    ).lower()
    hits = 0
    for token in tokens:
        if token.isdigit():
            if re.search(rf"(?:_|ch|channel|l|switch|outlet|socket){re.escape(token)}(?:$|_|\b)", hay):
                hits += 2
        elif token in hay:
            hits += 1
    return hits


def detect_energy_sensor(
    hass,
    sensors: list,
    channel_eid: str | None = None,
    channel_name: str | None = None,
    exclude_ids: set[str] | None = None,
) -> tuple[str, int] | None:
    """Return `(entity_id, channel_match_score)` for the best electrical energy sensor."""
    candidates: list[tuple[int, int, str]] = []
    states = getattr(hass, "states", None)

    for entry in sensors:
        if not entry:
            continue
        eid = getattr(entry, "entity_id", "")
        if not eid or (exclude_ids and eid in exclude_ids):
            continue
        if getattr(entry, "disabled_by", None) or getattr(entry, "entity_category", None) == "config":
            continue

        st = states.get(eid) if states else None
        attrs = getattr(st, "attributes", None) or {}
        dc = str(
            attrs.get("device_class")
            or getattr(entry, "device_class", None)
            or getattr(entry, "original_device_class", None)
            or ""
        ).strip().lower()
        caps = getattr(entry, "capabilities", None) or {}
        sc = str(
            attrs.get("state_class")
            or (caps.get("state_class") if isinstance(caps, dict) else None)
            or ""
        ).strip().lower()
        unit = str(
            attrs.get("unit_of_measurement")
            or getattr(entry, "unit_of_measurement", None)
            or ""
        ).strip().lower()

        if dc and dc != "energy" and dc in _NON_ENERGY_CLASSES:
            continue
        if unit and unit not in _ENERGY_UNITS and unit in _NON_ENERGY_UNITS:
            continue

        friendly = str(attrs.get("friendly_name") or "")
        name_str = (
            f"{eid} {getattr(entry, 'original_name', None) or ''} "
            f"{getattr(entry, 'name', None) or ''} {friendly}"
        ).lower()

        has_energy_unit = unit in _ENERGY_UNITS
        has_total_sc = sc in ("total", "total_increasing")
        has_keyword = bool(_ENERGY_KEYWORD_RE.search(name_str))

        if not (
            dc == "energy"
            or has_energy_unit
            or (has_total_sc and not dc and not unit and has_keyword)
            or (not dc and not unit and has_keyword)
        ):
            continue

        score = 0
        if dc == "energy":
            score += 100
        if has_energy_unit:
            score += 60
        if has_total_sc:
            score += 40
        if has_keyword:
            score += 20
        if _PENALTY_KEYWORD_RE.search(name_str):
            score -= 25
        if getattr(entry, "entity_category", None) == "diagnostic":
            score -= 15

        ch_score = _channel_match_score(entry, st, channel_eid, channel_name)
        score += ch_score * 35
        candidates.append((score, ch_score, eid))

    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    best_score, best_ch_score, best_eid = candidates[0]
    return best_eid, best_ch_score


async def async_migrate_energy_sensors(hass, store) -> bool:
    """One-time, idempotent backfill of missing energy sensors on configured devices.

    Returns True when changes were persisted, False otherwise.
    """
    migrations = store.get_migrations()
    if migrations.get(MIGRATION_ENERGY_SENSORS_V1):
        return False
    if getattr(store, "_energy_migrating", False):
        return False

    store._energy_migrating = True
    try:
        ent_reg = er.async_get(hass)
        devices = store.get_devices()
        categories = store.get_categories()

        sensors_by_device: dict[str, list] = {}
        for entry in ent_reg.entities.values():
            dev_id = getattr(entry, "device_id", None)
            if not dev_id or getattr(entry, "domain", None) != "sensor":
                continue
            if getattr(entry, "disabled_by", None) or getattr(entry, "entity_category", None) == "config":
                continue
            sensors_by_device.setdefault(dev_id, []).append(entry)

        changed = False
        labels_to_sync: list[tuple[str, str]] = []

        for device_id, cfg in devices.items():
            if not isinstance(cfg, dict):
                continue
            dev_sensors = sensors_by_device.get(device_id)
            if not dev_sensors:
                continue

            ents = cfg.get("entities")
            if not isinstance(ents, dict):
                continue
            category = cfg.get("category") or ""
            subs = ents.get("sub_entities")

            if isinstance(subs, dict) and subs:
                used_energy = {
                    sub.get("energy")
                    for sub in subs.values()
                    if isinstance(sub, dict) and sub.get("energy")
                }
                sub_items = [(k, v) for k, v in subs.items() if isinstance(v, dict)]
                for idx, (sub_key, sub) in enumerate(sub_items):
                    if sub.get("energy"):
                        continue
                    sub_name = sub.get("custom_name") or sub.get("name")
                    match = detect_energy_sensor(
                        hass,
                        dev_sensors,
                        channel_eid=sub_key,
                        channel_name=sub_name,
                        exclude_ids=used_energy,
                    )
                    if not match:
                        continue
                    energy_eid, ch_score = match
                    if ch_score > 0 or len(sub_items) == 1 or (idx == 0 and not used_energy):
                        sub["energy"] = energy_eid
                        used_energy.add(energy_eid)
                        changed = True
                        sub_cat = sub.get("category") or category
                        if sub_cat:
                            labels_to_sync.append((energy_eid, sub_cat))
            elif (ents.get("primary") or ents.get("power")) and not ents.get("energy"):
                match = detect_energy_sensor(hass, dev_sensors)
                if match:
                    energy_eid, _ = match
                    ents["energy"] = energy_eid
                    changed = True
                    if category:
                        labels_to_sync.append((energy_eid, category))

        migrations[MIGRATION_ENERGY_SENSORS_V1] = True
        saved = await store.async_save()
        if not saved:
            migrations.pop(MIGRATION_ENERGY_SENSORS_V1, None)
            _LOGGER.warning("Energy sensor migration could not persist changes; will retry next startup.")
            return False

        for energy_eid, cat in labels_to_sync:
            cat_info = categories.get(cat, {})
            _ensure_label_exists(
                hass,
                f"{cat}_energy",
                name=f"{cat_info.get('display_name', cat)} Energy",
            )
            _sync_entity_labels(hass, energy_eid, [f"{cat}_energy"])

        if changed:
            _LOGGER.info(
                "Migrated %d device channel(s)/entity(ies) with detected energy sensors.",
                len(labels_to_sync) or 1,
            )
            safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")

        return changed
    finally:
        store._energy_migrating = False


async def async_migrate_sub_entity_names(hass, store) -> bool:
    """One-time, idempotent cleanup migration aligning all sub-entities of configured devices.

    Renames secondary device entities to follow the configured primary/device slug while preserving
    functional suffixes, avoiding collisions, leaving Friendly Names intact, and syncing Dashboard +
    Home Assistant Automations/Scripts/Scenes/Blueprints.
    """
    migrations = store.get_migrations()
    if migrations.get(MIGRATION_SUB_ENTITY_NAMES_V1):
        return False
    if getattr(store, "_sub_entity_migrating", False):
        return False

    store._sub_entity_migrating = True
    try:
        dev_reg = dr.async_get(hass)
        devices = store.get_devices()
        all_renamed: dict[str, str] = {}

        for device_id, cfg in list(devices.items()):
            if not isinstance(cfg, dict):
                continue
            dev = dev_reg.async_get(device_id)
            if dev is None:
                continue
            dev_renamed = sync_device_entity_ids(
                hass,
                device_id,
                cfg,
                area_id=dev.area_id,
                prev_dev=cfg,
            )
            if dev_renamed:
                all_renamed.update(dev_renamed)

        if all_renamed:
            await async_sync_renamed_entities(hass, store, all_renamed)

        migrations[MIGRATION_SUB_ENTITY_NAMES_V1] = True
        saved = await store.async_save()
        if not saved:
            migrations.pop(MIGRATION_SUB_ENTITY_NAMES_V1, None)
            _LOGGER.warning("Sub-entity naming migration could not persist changes; will retry next startup.")
            return False

        if all_renamed:
            _LOGGER.info(
                "Migrated and synchronized %d device entity/sub-entity ID(s).",
                len(all_renamed),
            )
            safe_fire_event(hass, f"{DOMAIN}_dashboard_updated")

        return bool(all_renamed)
    finally:
        store._sub_entity_migrating = False
