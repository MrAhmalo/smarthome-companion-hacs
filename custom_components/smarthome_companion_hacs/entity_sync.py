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


def _strip_prefix_token(text: str, token: str) -> str:
    if not text or not token:
        return text
    if text == token:
        return ""
    if text.startswith(f"{token}_"):
        return text[len(token) + 1 :]
    return text


def _build_base_slug(raw_name: str | None, area_slug: str = "") -> str:
    clean = slugify_ha(raw_name or "")
    if not clean:
        return ""
    if area_slug and not clean.startswith(f"{area_slug}_") and clean != area_slug:
        return f"{area_slug}_{clean}"
    return clean


def _common_underscore_prefixes(object_ids: list[str]) -> list[str]:
    """Return all multi-entity underscore-aligned common prefixes (length >= 3)."""
    split_ids = [oid.split("_") for oid in object_ids if oid]
    prefixes: set[str] = set()
    for i in range(len(split_ids)):
        for j in range(i + 1, len(split_ids)):
            a, b = split_ids[i], split_ids[j]
            common: list[str] = []
            for tok_a, tok_b in zip(a, b):
                if tok_a == tok_b:
                    common.append(tok_a)
                else:
                    break
            if common:
                pref = "_".join(common)
                if len(pref) >= 3:
                    prefixes.add(pref)
    return sorted(prefixes, key=len, reverse=True)


def _resolve_unique_target_eid(ent_reg, domain: str, desired_slug: str, current_eid: str) -> str:
    """Return a collision-free entity_id for `domain.desired_slug` (idempotent on existing suffixes)."""
    clean_slug = re.sub(r"_+", "_", desired_slug).strip("_")
    candidate = f"{domain}.{clean_slug}"
    if candidate == current_eid or ent_reg.async_get(candidate) is None:
        return candidate
    idx = 2
    while True:
        cand_n = f"{domain}.{clean_slug}_{idx}"
        if cand_n == current_eid or ent_reg.async_get(cand_n) is None:
            return cand_n
        idx += 1


_CHANNEL_SUB_PREFIX_RE = re.compile(r"^(?:ch|channel|switch|light|plug|outlet|socket)_?\d+_")


def _extract_sub_entity_suffix(
    entry,
    known_prefixes: list[str],
    strip_name_tokens: list[str],
    linked_role: str | None = None,
    strip_channel_prefix: bool = False,
) -> str:
    """Extract the functional suffix of a secondary device entity without duplicating device prefixes."""
    obj_id = entry.entity_id.split(".", 1)[1].lower()

    for prefix in known_prefixes:
        if obj_id == prefix:
            raw_suffix = ""
            break
        if obj_id.startswith(f"{prefix}_"):
            raw_suffix = obj_id[len(prefix) + 1 :]
            if strip_channel_prefix and linked_role in ("power", "energy"):
                stripped_ch = _CHANNEL_SUB_PREFIX_RE.sub("", raw_suffix)
                if stripped_ch:
                    raw_suffix = stripped_ch
            return raw_suffix
    else:
        raw_suffix = None

    # Fallback when object_id did not match any device/channel prefix
    orig_name = getattr(entry, "original_name", None) or getattr(entry, "name", None) or ""
    if orig_name:
        orig_slug = slugify_ha(orig_name)
        changed = True
        while changed and orig_slug:
            changed = False
            for tok in strip_name_tokens:
                if not tok:
                    continue
                if orig_slug.startswith(f"{tok}_"):
                    orig_slug = orig_slug[len(tok) + 1 :]
                    changed = True
                elif orig_slug.endswith(f"_{tok}"):
                    orig_slug = orig_slug[: -len(tok) - 1]
                    changed = True
                elif orig_slug == tok:
                    orig_slug = ""
                    changed = True
        if orig_slug:
            return orig_slug

    trans_key = slugify_ha(getattr(entry, "translation_key", None) or "")
    if trans_key:
        return trans_key

    dc = slugify_ha(getattr(entry, "device_class", None) or getattr(entry, "original_device_class", None) or "")
    if dc:
        return dc

    if linked_role:
        return linked_role

    if raw_suffix == "":
        return ""
    return obj_id


def _suppress_internal_rename_event(hass, old_eid: str, new_eid: str) -> None:
    """Mark `(old_eid, new_eid)` as batch-handled so entity_registry_updated listener skips duplicate sync."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    internal = domain_data.setdefault("_internal_renames", set())
    pair = (old_eid, new_eid)
    internal.add(pair)
    loop = getattr(hass, "loop", None)
    if loop is not None:
        try:
            loop.call_later(10, internal.discard, pair)
        except Exception:  # noqa: BLE001
            pass


def sync_device_entity_ids(
    hass,
    device_id: str,
    device_cfg: dict,
    *,
    area_id: str | None = None,
    prev_dev: dict | None = None,
) -> dict[str, str]:
    """Rename primary, channel, room-sensor, and ALL remaining sub-entities of a device consistently.

    Leaves existing Friendly Names (`name`/`original_name`) untouched and guarantees collision-free target IDs.
    Returns `renamed_map` (`{old_entity_id: new_entity_id}`).
    """
    # pyrefly: ignore [missing-import]
    from homeassistant.helpers import (
        area_registry as ar,
        device_registry as dr,
        entity_registry as er,
    )

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)

    device = dev_reg.async_get(device_id)
    entities_cfg = device_cfg.get("entities") if isinstance(device_cfg, dict) else {}
    if not isinstance(entities_cfg, dict):
        entities_cfg = {}

    is_virtual_entity = device is None and str(device_id).startswith("entity:")
    virtual_entry = None
    if is_virtual_entity:
        v_raw = str(device_id)[len("entity:") :]
        v_primary = entities_cfg.get("primary") or v_raw
        virtual_entry = ent_reg.async_get(v_primary) or ent_reg.async_get(v_raw)
        if virtual_entry is None and entities_cfg.get("primary_unique_id"):
            dom_hint = v_primary.split(".", 1)[0] if "." in v_primary else None
            for e in ent_reg.entities.values():
                if e.unique_id == entities_cfg["primary_unique_id"] and (dom_hint is None or e.domain == dom_hint):
                    virtual_entry = e
                    break

    custom_name = (
        (device_cfg.get("custom_name") if isinstance(device_cfg, dict) else None)
        or (device.name_by_user if device else None)
        or (device.name if device else None)
        or (virtual_entry.name if virtual_entry else None)
        or (virtual_entry.original_name if virtual_entry else None)
        or ""
    )
    if not custom_name:
        return {}

    effective_area_id = (
        area_id
        if area_id is not None
        else (device.area_id if device else (virtual_entry.area_id if virtual_entry else None))
    )
    area_slug = ""
    if effective_area_id:
        a_entry = area_reg.async_get_area(effective_area_id)
        if a_entry:
            area_slug = slugify_ha(a_entry.name)

    device_base_slug = _build_base_slug(custom_name, area_slug)
    if not device_base_slug:
        return {}

    if is_virtual_entity:
        device_entries = [virtual_entry] if virtual_entry else []
    else:
        device_entries = [
            e for e in ent_reg.entities.values()
            if getattr(e, "device_id", None) == device_id
        ]

    # Collect known prefixes BEFORE mutating entity_registry so sub-entity suffix extraction stays accurate
    target_prefixes: set[str] = {device_base_slug, slugify_ha(custom_name)}
    known_prefix_set: set[str] = set(target_prefixes)
    for raw_n in (
        device.name if device else None,
        device.name_by_user if device else None,
        prev_dev.get("custom_name") if isinstance(prev_dev, dict) else None,
    ):
        if raw_n:
            s = slugify_ha(raw_n)
            if s:
                known_prefix_set.add(s)
                if area_slug:
                    known_prefix_set.add(_build_base_slug(raw_n, area_slug))

    # Add previous/current primary & channel object_ids and pairwise common prefixes
    prev_ents = prev_dev.get("entities") if isinstance(prev_dev, dict) else {}
    if isinstance(prev_ents, dict):
        if prev_ents.get("primary") and "." in str(prev_ents["primary"]):
            oid = str(prev_ents["primary"]).split(".", 1)[1].lower()
            known_prefix_set.add(oid)
            target_prefixes.add(oid)
        if isinstance(prev_ents.get("sub_entities"), dict):
            for p_sid in prev_ents["sub_entities"]:
                if "." in str(p_sid):
                    oid = str(p_sid).split(".", 1)[1].lower()
                    known_prefix_set.add(oid)
                    target_prefixes.add(oid)

    if entities_cfg.get("primary") and "." in str(entities_cfg["primary"]):
        oid = str(entities_cfg["primary"]).split(".", 1)[1].lower()
        known_prefix_set.add(oid)
        target_prefixes.add(oid)
    sub_entities = entities_cfg.get("sub_entities")
    if isinstance(sub_entities, dict):
        for s_id in sub_entities:
            if "." in str(s_id):
                oid = str(s_id).split(".", 1)[1].lower()
                known_prefix_set.add(oid)
                target_prefixes.add(oid)

    target_prefixes.discard("")
    raw_obj_ids = [
        e.entity_id.split(".", 1)[1].lower()
        for e in device_entries
        if "." in e.entity_id
    ]
    unaligned_obj_ids = [
        oid
        for oid in raw_obj_ids
        if not any(oid == tp or oid.startswith(f"{tp}_") for tp in target_prefixes)
    ]
    for cp in _common_underscore_prefixes(unaligned_obj_ids):
        known_prefix_set.add(cp)

    known_prefix_set.discard("")
    known_prefixes = sorted(known_prefix_set, key=len, reverse=True)
    strip_name_tokens = sorted(
        {
            t
            for t in (
                area_slug,
                device_base_slug,
                slugify_ha(custom_name),
                slugify_ha(device.name if device else ""),
                slugify_ha(device.name_by_user if device else ""),
                slugify_ha(prev_dev.get("custom_name") if isinstance(prev_dev, dict) else ""),
            )
            if t
        },
        key=len,
        reverse=True,
    )

    renamed_map: dict[str, str] = {}
    handled_entry_ids: set[int] = set()
    handled_eids: set[str] = set()
    active_by_uid: dict[str, str] = {}

    def _find_entry_by_uid(uid: str | None, fallback_id: str) -> object | None:
        if not uid:
            return None
        dom = fallback_id.split(".", 1)[0] if "." in fallback_id else None
        for e in ent_reg.entities.values():
            if e.unique_id == uid and (dom is None or e.domain == dom):
                return e
        return None

    def _rename_entry(entry, target_slug: str) -> str | None:
        if not entry:
            return None
        handled_entry_ids.add(id(entry))
        old_eid = entry.entity_id
        handled_eids.add(old_eid)
        if not target_slug:
            return old_eid
        target_eid = _resolve_unique_target_eid(ent_reg, entry.domain, target_slug, old_eid)
        if old_eid == target_eid:
            return old_eid
        try:
            _suppress_internal_rename_event(hass, old_eid, target_eid)
            ent_reg.async_update_entity(old_eid, new_entity_id=target_eid)
            handled_eids.add(target_eid)
            renamed_map[old_eid] = target_eid
            _LOGGER.info("Updated entity ID from %s to %s", old_eid, target_eid)
            return target_eid
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Could not rename entity ID for %s: %s", old_eid, err)
            return old_eid

    def _record_prior_rename(old_id: str | None, new_id: str | None) -> None:
        if old_id and new_id and old_id != new_id and ent_reg.async_get(old_id) is None:
            renamed_map[old_id] = new_id

    primary = entities_cfg.get("primary")
    room_sensors = entities_cfg.get("room_sensors")
    has_actuator = bool((isinstance(sub_entities, dict) and sub_entities) or primary)

    final_primary_eid: str | None = None
    channel_base_slugs: dict[str, str] = {}
    linked_power_to_channel: dict[str, str] = {}
    linked_energy_to_channel: dict[str, str] = {}

    # 1. Primary / multi-channel actuators
    if isinstance(sub_entities, dict) and sub_entities:
        enabled_sub_count = sum(1 for sd in sub_entities.values() if isinstance(sd, dict) and sd.get("enabled", True))
        single_sub = enabled_sub_count == 1 and len(sub_entities) == 1 and bool(custom_name)
        for sub_id, sub_data in list(sub_entities.items()):
            if not isinstance(sub_data, dict):
                continue
            uid = sub_data.get("unique_id")
            s_entry = (
                ent_reg.async_get(sub_id)
                or ent_reg.async_get(sub_data.get("original_id", ""))
                or _find_entry_by_uid(uid, sub_id)
            )
            if not sub_data.get("enabled", True):
                if s_entry:
                    handled_entry_ids.add(id(s_entry))
                    handled_eids.add(s_entry.entity_id)
                handled_eids.add(sub_id)
                continue
            sub_name = (custom_name if single_sub else None) or sub_data.get("custom_name") or sub_data.get("name") or custom_name
            ch_area_id = sub_data.get("area_id") or effective_area_id
            ch_area_slug = area_slug
            if ch_area_id and ch_area_id != effective_area_id:
                ch_a_entry = area_reg.async_get_area(ch_area_id)
                ch_area_slug = slugify_ha(ch_a_entry.name) if ch_a_entry else ""
            target_slug = _build_base_slug(sub_name, ch_area_slug)
            final_eid = _rename_entry(s_entry, target_slug)
            if final_eid:
                _record_prior_rename(sub_id, final_eid)
                _record_prior_rename(sub_data.get("original_id"), final_eid)
                if uid:
                    active_by_uid[uid] = final_eid
                ch_slug = final_eid.split(".", 1)[1]
                channel_base_slugs[sub_id] = ch_slug
                channel_base_slugs[final_eid] = ch_slug
                if sub_data.get("power"):
                    linked_power_to_channel[sub_data["power"]] = ch_slug
                if sub_data.get("energy"):
                    linked_energy_to_channel[sub_data["energy"]] = ch_slug
                if sub_id == primary or not final_primary_eid:
                    final_primary_eid = final_eid
    elif primary:
        p_uid = entities_cfg.get("primary_unique_id")
        p_entry = (
            ent_reg.async_get(primary)
            or ent_reg.async_get(entities_cfg.get("primary_original_id", ""))
            or _find_entry_by_uid(p_uid, primary)
        )
        final_primary_eid = _rename_entry(p_entry, device_base_slug)
        if final_primary_eid:
            _record_prior_rename(primary, final_primary_eid)
            _record_prior_rename(entities_cfg.get("primary_original_id"), final_primary_eid)
            if p_uid:
                active_by_uid[p_uid] = final_primary_eid

    # 2. Enabled room sensors
    single_sensor_slug: str | None = None
    if isinstance(room_sensors, dict) and room_sensors:
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
            final_rs_eid = _rename_entry(rs_entry, _build_base_slug(rs_name, area_slug))
            if final_rs_eid:
                _record_prior_rename(s_id, final_rs_eid)
                _record_prior_rename(s_data.get("original_id"), final_rs_eid)
                if uid:
                    active_by_uid[uid] = final_rs_eid
                if not has_actuator and len(enabled_sensors) == 1:
                    single_sensor_slug = final_rs_eid.split(".", 1)[1]

    # Effective base slug for ALL remaining device sub-entities follows the renamed main entity's slug
    is_multi_ch = isinstance(sub_entities, dict) and len(sub_entities) > 1
    if final_primary_eid and not is_multi_ch:
        effective_device_slug = final_primary_eid.split(".", 1)[1]
    elif single_sensor_slug:
        effective_device_slug = single_sensor_slug
    else:
        effective_device_slug = device_base_slug

    # 3. ALL remaining entities belonging to `device_id` (power, energy, battery, RSSI, events, diagnostics, etc.)
    # Process active entities before disabled entities so active ones always claim primary suffixes first
    remaining = sorted(
        (e for e in device_entries if id(e) not in handled_entry_ids and e.entity_id not in handled_eids),
        key=lambda e: (bool(getattr(e, "disabled_by", None)), e.entity_id),
    )
    for entry in remaining:
        old_eid = entry.entity_id
        linked_role = None
        target_base = effective_device_slug
        strip_ch = is_multi_ch

        if old_eid in linked_power_to_channel:
            linked_role = "power"
            if is_multi_ch:
                target_base = linked_power_to_channel[old_eid]
        elif old_eid in linked_energy_to_channel:
            linked_role = "energy"
            if is_multi_ch:
                target_base = linked_energy_to_channel[old_eid]
        elif old_eid == entities_cfg.get("power"):
            linked_role = "power"
        elif old_eid == entities_cfg.get("energy"):
            linked_role = "energy"

        suffix = _extract_sub_entity_suffix(
            entry,
            known_prefixes,
            strip_name_tokens,
            linked_role=linked_role,
            strip_channel_prefix=strip_ch,
        )
        desired_slug = f"{target_base}_{suffix}" if suffix else target_base
        _rename_entry(entry, desired_slug)

    # 4. Catch any entity ID changes compared to previous stored config of this device
    if isinstance(prev_ents, dict) and prev_ents:
        prev_primary = prev_ents.get("primary")
        prev_p_uid = prev_ents.get("primary_unique_id")
        if prev_primary:
            target = active_by_uid.get(prev_p_uid) if prev_p_uid else None
            _record_prior_rename(prev_primary, target or final_primary_eid)
        for aux_key in ("power", "energy"):
            prev_aux = prev_ents.get(aux_key)
            cur_aux = entities_cfg.get(aux_key)
            if prev_aux and prev_aux in renamed_map:
                _record_prior_rename(prev_aux, renamed_map[prev_aux])
            elif prev_aux and cur_aux and prev_aux != cur_aux and ent_reg.async_get(prev_aux) is None:
                _record_prior_rename(prev_aux, cur_aux)
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

    return renamed_map


def _build_entity_id_pattern(id_map: dict[str, str]) -> re.Pattern[str] | None:
    """Compile a single-pass boundary-safe case-insensitive regex matching any entity ID in id_map."""
    keys = sorted((k for k in id_map if k), key=len, reverse=True)
    if not keys:
        return None
    alternation = "|".join(re.escape(k) for k in keys)
    return re.compile(
        rf"(?:(?<=states\.)|(?<![a-zA-Z0-9_.]))(?:{alternation})(?![a-zA-Z0-9_]|(?:\.ya?ml\b))",
        re.IGNORECASE,
    )


def replace_entity_ids_in_text(
    text: str,
    id_map: dict[str, str],
    pattern: re.Pattern[str] | None = None,
) -> tuple[str, bool]:
    """Replace entity IDs in raw text (preserving YAML comments, quotes, !input/!secret tags)."""
    if not text or not id_map:
        return text, False
    lower_map = {k.lower(): v for k, v in id_map.items() if k}
    text_lower = text.lower()
    if not any(old_eid in text_lower for old_eid in lower_map):
        return text, False
    compiled = pattern or _build_entity_id_pattern(id_map)
    if compiled is None:
        return text, False
    replaced, count = compiled.subn(lambda m: lower_map[m.group(0).lower()], text)
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


_INCLUDE_RE = re.compile(
    r"^\s*([a-zA-Z0-9_ -]+)?\s*:\s*!include(?:_dir_(?:list|named|merge_list|merge_named))?\s+([^\s#]+)",
    re.MULTILINE,
)


def _category_for_key(key: str) -> str:
    k = key.strip().lower()
    if k.startswith("automation"):
        return "automation"
    if k.startswith("script"):
        return "script"
    if k.startswith("scene"):
        return "scene"
    if k.startswith("template"):
        return "template"
    return "all"


def _collect_yaml_targets(config_dir: Path) -> list[tuple[Path, str]]:
    """Collect Home Assistant YAML config files mapped to their reload category."""
    resolved_root = config_dir.resolve()
    targets: list[tuple[Path, str]] = [
        (config_dir / "automations.yaml", "automation"),
        (config_dir / "scripts.yaml", "script"),
        (config_dir / "scenes.yaml", "scene"),
    ]

    dir_specs = [
        (config_dir / "automations", "automation"),
        (config_dir / "automation", "automation"),
        (config_dir / "scripts", "script"),
        (config_dir / "script", "script"),
        (config_dir / "scenes", "scene"),
        (config_dir / "scene", "scene"),
        (config_dir / "blueprints" / "automation", "automation"),
        (config_dir / "blueprints" / "script", "script"),
        (config_dir / "blueprints" / "template", "template"),
        (config_dir / "packages", "all"),
    ]
    seen: set[Path] = {p.resolve() for p, _ in targets}

    def _add_file(path: Path, category: str) -> None:
        try:
            rp = path.resolve()
            rp.relative_to(resolved_root)
        except ValueError:
            return
        if not path.is_file() or path.suffix.lower() not in (".yaml", ".yml"):
            return
        if any(part.startswith(".") for part in rp.relative_to(resolved_root).parts):
            return
        if rp not in seen:
            seen.add(rp)
            targets.append((path, category))

    for folder, category in dir_specs:
        for file_path in _iter_yaml_files(folder):
            _add_file(file_path, category)

    # Parse !include* directives from configuration.yaml (and configuration.yaml itself)
    main_cfg = config_dir / "configuration.yaml"
    if main_cfg.is_file():
        try:
            cfg_text = main_cfg.read_text(encoding="utf-8")
            for m in _INCLUDE_RE.finditer(cfg_text):
                inc_cat = _category_for_key(m.group(1) or "")
                rel = m.group(2).strip().strip("'\"")
                inc_path = config_dir / rel
                if inc_path.is_dir():
                    for file_path in _iter_yaml_files(inc_path):
                        _add_file(file_path, inc_cat)
                elif inc_path.is_file():
                    _add_file(inc_path, inc_cat)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Could not inspect configuration.yaml includes: %s", err)
        _add_file(main_cfg, "all")

    # Any custom blueprint directories directly under blueprints/
    blueprints_root = config_dir / "blueprints"
    for file_path in _iter_yaml_files(blueprints_root):
        _add_file(file_path, "all")

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
            await hass.services.async_call(domain, "reload", blocking=True)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Could not reload %s after entity rename: %s", domain, err)


async def async_sync_renamed_entities(hass, store, id_map: dict[str, str]) -> bool:
    """Propagate entity_id renames to Companion store, Automations (incl. Blueprints), Scripts, Scenes, and Blueprints."""
    clean_map = {k: v for k, v in (id_map or {}).items() if k and v and k != v}
    if not clean_map:
        return False

    domain_data = hass.data.setdefault(DOMAIN, {})
    lock = domain_data.setdefault("entity_sync_lock", asyncio.Lock())

    store_changed = False
    updated_by_category: dict[str, list[str]] = {}

    async with lock:
        pattern = _build_entity_id_pattern(clean_map)
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
