"""Synchronize renamed Home Assistant entity IDs across Companion store and HA automations."""
from __future__ import annotations

import logging
from pathlib import Path
import re

# pyrefly: ignore [missing-import]
import yaml

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def replace_entity_ids_in_value(value, id_map: dict[str, str]):
    """Recursively replace entity IDs in strings, lists, and dict keys/values."""
    if not id_map:
        return value, False

    if isinstance(value, str):
        if value in id_map:
            return id_map[value], True

        changed = False
        out = value
        if out.startswith("e:"):
            raw = out[2:]
            if raw in id_map:
                return f"e:{id_map[raw]}", True
        elif out.startswith("d:"):
            parts = out.split(":", 2)
            if len(parts) == 3 and parts[2] in id_map:
                return f"d:{parts[1]}:{id_map[parts[2]]}", True

        for old_eid, new_eid in id_map.items():
            if old_eid in out:
                pattern = rf"(?<![a-zA-Z0-9_]){re.escape(old_eid)}(?![a-zA-Z0-9_])"
                replaced = re.sub(pattern, new_eid, out)
                if replaced != out:
                    out = replaced
                    changed = True
        return out, changed

    if isinstance(value, list):
        changed = False
        new_list = []
        for item in value:
            new_item, item_changed = replace_entity_ids_in_value(item, id_map)
            if item_changed:
                changed = True
            new_list.append(new_item)
        return (new_list if changed else value), changed

    if isinstance(value, dict):
        changed = False
        new_dict = {}
        for k, v in value.items():
            new_k, k_changed = replace_entity_ids_in_value(k, id_map) if isinstance(k, str) else (k, False)
            new_v, v_changed = replace_entity_ids_in_value(v, id_map)
            if k_changed or v_changed:
                changed = True
            new_dict[new_k] = new_v
        return (new_dict if changed else value), changed

    return value, False


def _sync_automations_yaml_sync(automations_path: Path, id_map: dict[str, str]) -> bool:
    """Read, update, and write automations.yaml synchronously in executor."""
    if not automations_path.exists():
        return False
    try:
        raw_text = automations_path.read_text(encoding="utf-8")
        if not raw_text.strip():
            return False
        data = yaml.safe_load(raw_text)
        if data is None:
            return False
        updated, changed = replace_entity_ids_in_value(data, id_map)
        if not changed:
            return False
        dumped = yaml.safe_dump(updated, allow_unicode=True, sort_keys=False, default_flow_style=False)
        automations_path.write_text(dumped, encoding="utf-8")
        return True
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Could not sync automations.yaml for %s: %s", id_map, err)
        return False


async def async_sync_renamed_entities(hass, store, id_map: dict[str, str]) -> bool:
    """Propagate entity_id renames to Companion store and Home Assistant automations."""
    clean_map = {k: v for k, v in (id_map or {}).items() if k and v and k != v}
    if not clean_map:
        return False

    store_changed = False
    for section in ("devices", "groups", "dashboard", "blinds", "irrigation", "adaptive_light", "simulation"):
        cur = store.data.get(section)
        if cur is not None:
            updated, changed = replace_entity_ids_in_value(cur, clean_map)
            if changed:
                store.data[section] = updated
                store_changed = True

    if store_changed:
        await store.async_save()
        hass.bus.async_fire(f"{DOMAIN}_dashboard_updated")
        _LOGGER.info("Synchronized Companion store references for renamed entities: %s", clean_map)

    automations_path = Path(hass.config.path("automations.yaml"))
    auto_changed = await hass.async_add_executor_job(_sync_automations_yaml_sync, automations_path, clean_map)
    if auto_changed:
        _LOGGER.info("Updated Home Assistant automations.yaml for renamed entities: %s", clean_map)
        try:
            if hass.services.has_service("automation", "reload"):
                await hass.services.async_call("automation", "reload", blocking=False)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Could not reload automations after entity rename: %s", err)

    return store_changed or auto_changed
