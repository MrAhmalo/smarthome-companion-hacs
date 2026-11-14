"""Synchronize renamed Home Assistant entity IDs across Companion store, Blueprints, Scripts, Scenes, and Automations."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import re

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def slugify_ha(text: str) -> str:
    """Transliterate German umlauts and slugify text for Home Assistant entity IDs."""
    s = str(text or "").strip().lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9_]+", "_", s).strip("_")


def _build_entity_id_pattern(id_map: dict[str, str]) -> re.Pattern[str] | None:
    """Compile a single-pass boundary-safe regex matching any entity ID in id_map."""
    keys = sorted((k for k in id_map if k), key=len, reverse=True)
    if not keys:
        return None
    alternation = "|".join(re.escape(k) for k in keys)
    return re.compile(
        rf"(?:(?<=states\.)|(?<![a-zA-Z0-9_.]))(?:{alternation})(?![a-zA-Z0-9_]|(?:\.ya?ml\b))"
    )


def replace_entity_ids_in_text(
    text: str,
    id_map: dict[str, str],
    pattern: re.Pattern[str] | None = None,
) -> tuple[str, bool]:
    """Replace entity IDs in raw text (preserving YAML comments, quotes, !input/!secret tags)."""
    if not text or not id_map:
        return text, False
    if not any(old_eid in text for old_eid in id_map):
        return text, False
    compiled = pattern or _build_entity_id_pattern(id_map)
    if compiled is None:
        return text, False
    replaced, count = compiled.subn(lambda m: id_map[m.group(0)], text)
    return (replaced, True) if count > 0 and replaced != text else (text, False)


def replace_entity_ids_in_value(
    value,
    id_map: dict[str, str],
    pattern: re.Pattern[str] | None = None,
):
    """Recursively replace entity IDs in strings, lists, and dict keys/values."""
    if not id_map:
        return value, False

    compiled = pattern or _build_entity_id_pattern(id_map)

    if isinstance(value, str):
        if value in id_map:
            return id_map[value], True

        if value.startswith("e:"):
            raw = value[2:]
            if raw in id_map:
                return f"e:{id_map[raw]}", True
        elif value.startswith("d:"):
            parts = value.split(":", 2)
            if len(parts) == 3 and parts[2] in id_map:
                return f"d:{parts[1]}:{id_map[parts[2]]}", True

        return replace_entity_ids_in_text(value, id_map, compiled)

    if isinstance(value, list):
        changed = False
        new_list = []
        for item in value:
            new_item, item_changed = replace_entity_ids_in_value(item, id_map, compiled)
            if item_changed:
                changed = True
            new_list.append(new_item)
        return (new_list if changed else value), changed

    if isinstance(value, dict):
        changed = False
        new_dict = {}
        for k, v in value.items():
            new_k, k_changed = (
                replace_entity_ids_in_value(k, id_map, compiled)
                if isinstance(k, str)
                else (k, False)
            )
            new_v, v_changed = replace_entity_ids_in_value(v, id_map, compiled)
            if k_changed or v_changed:
                changed = True
            new_dict[new_k] = new_v
        return (new_dict if changed else value), changed

    return value, False


def _iter_yaml_files(directory: Path) -> list[Path]:
    """Yield regular YAML files recursively while skipping hidden/internal directories."""
    if not directory.is_dir():
        return []
    files: list[Path] = []
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in (".yaml", ".yml"):
            continue
        if any(part.startswith(".") for part in path.relative_to(directory).parts):
            continue
        files.append(path)
    return sorted(files)


def _collect_yaml_targets(config_dir: Path) -> list[tuple[Path, str]]:
    """Collect Home Assistant YAML config files mapped to their reload category."""
    targets: list[tuple[Path, str]] = [
        (config_dir / "automations.yaml", "automation"),
        (config_dir / "scripts.yaml", "script"),
        (config_dir / "scenes.yaml", "scene"),
    ]

    dir_specs = [
        (config_dir / "automations", "automation"),
        (config_dir / "scripts", "script"),
        (config_dir / "scenes", "scene"),
        (config_dir / "blueprints" / "automation", "automation"),
        (config_dir / "blueprints" / "script", "script"),
        (config_dir / "blueprints" / "template", "template"),
        (config_dir / "packages", "all"),
    ]
    seen: set[Path] = {p for p, _ in targets}

    for folder, category in dir_specs:
        for file_path in _iter_yaml_files(folder):
            if file_path not in seen:
                seen.add(file_path)
                targets.append((file_path, category))

    # Any custom blueprint directories directly under blueprints/
    blueprints_root = config_dir / "blueprints"
    for file_path in _iter_yaml_files(blueprints_root):
        if file_path not in seen:
            seen.add(file_path)
            targets.append((file_path, "all"))

    return targets


def _sync_yaml_configs_sync(config_dir: Path, id_map: dict[str, str]) -> dict[str, list[str]]:
    """Synchronize entity IDs in HA automations, blueprint connections, scripts, scenes, blueprints, and packages."""
    pattern = _build_entity_id_pattern(id_map)
    if pattern is None:
        return {}

    updated_by_category: dict[str, list[str]] = {}
    for file_path, category in _collect_yaml_targets(config_dir):
        if not file_path.is_file():
            continue
        try:
            raw_text = file_path.read_text(encoding="utf-8")
            updated_text, changed = replace_entity_ids_in_text(raw_text, id_map, pattern)
            if not changed:
                continue
            file_path.write_text(updated_text, encoding="utf-8")
            updated_by_category.setdefault(category, []).append(str(file_path.relative_to(config_dir)))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Could not sync %s for %s: %s", file_path, id_map, err)

    return updated_by_category


async def _reload_domain_if_available(hass, domain: str) -> None:
    """Reload a Home Assistant YAML domain if its reload service is registered."""
    try:
        if hass.services.has_service(domain, "reload"):
            await hass.services.async_call(domain, "reload", blocking=False)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Could not reload %s after entity rename: %s", domain, err)


async def async_sync_renamed_entities(hass, store, id_map: dict[str, str]) -> bool:
    """Propagate entity_id renames to Companion store, Automations (incl. Blueprints), Scripts, Scenes, and Blueprints."""
    clean_map = {k: v for k, v in (id_map or {}).items() if k and v and k != v}
    if not clean_map:
        return False

    domain_data = hass.data.setdefault(DOMAIN, {})
    lock = domain_data.setdefault("entity_sync_lock", asyncio.Lock())

    async with lock:
        pattern = _build_entity_id_pattern(clean_map)
        store_changed = False
        for section in ("devices", "groups", "dashboard", "blinds", "irrigation", "adaptive_light", "simulation"):
            cur = store.data.get(section)
            if cur is not None:
                updated, changed = replace_entity_ids_in_value(cur, clean_map, pattern)
                if changed:
                    store.data[section] = updated
                    store_changed = True

        if store_changed:
            await store.async_save()
            hass.bus.async_fire(f"{DOMAIN}_dashboard_updated")
            _LOGGER.info("Synchronized Companion store references for renamed entities: %s", clean_map)

        config_dir = Path(hass.config.path())
        updated_by_category = await hass.async_add_executor_job(_sync_yaml_configs_sync, config_dir, clean_map)
        yaml_changed = bool(updated_by_category)

        if yaml_changed:
            _LOGGER.info(
                "Updated HA YAML files for renamed entities %s: %s",
                clean_map,
                updated_by_category,
            )
            reload_all = "all" in updated_by_category
            if reload_all or "automation" in updated_by_category:
                await _reload_domain_if_available(hass, "automation")
            if reload_all or "script" in updated_by_category:
                await _reload_domain_if_available(hass, "script")
            if reload_all or "scene" in updated_by_category:
                await _reload_domain_if_available(hass, "scene")
            if reload_all or "template" in updated_by_category:
                await _reload_domain_if_available(hass, "template")

        return store_changed or yaml_changed
