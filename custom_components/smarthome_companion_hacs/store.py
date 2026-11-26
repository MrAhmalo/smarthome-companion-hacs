import asyncio
import logging
import copy
import re
from homeassistant.helpers.storage import Store
from .const import STORAGE_KEY, STORAGE_VERSION, DEFAULT_CATEGORIES

_LOGGER = logging.getLogger(__name__)

class CompanionStore:
    def __init__(self, hass):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._save_lock = asyncio.Lock()
        self.data = {
            "blinds": {},
            "irrigation": {},
            "devices": {},
            "categories": {},
            "dismissed_devices": [],
            "simulation": {},
            "groups": {},
            "hybrids": {},
            "hybrid_settings": {
                "preferred_protocol": "zigbee",
                "protocol_priority": ["zigbee", "matter", "wlan"],
                "failover_timeout_s": 1.8,
                "desync_guard_s": 2.5,
                "event_debounce_ms": 400,
            },
            "dismissed_hybrid_pairs": [],
            "dashboard": None,
            "migrations": {},
        }

    async def async_load(self):
        saved = await self._store.async_load()
        if saved:
            self.data = saved
            # Ensure new keys exist for backward compatibility
            self.data.setdefault("devices", {})
            self.data.setdefault("categories", {})
            self.data.setdefault("dismissed_devices", [])
            self.data.setdefault("adaptive_light", {})
            self.data.setdefault("simulation", {})
            self.data.setdefault("groups", {})
            self.data.setdefault("hybrids", {})
            self.data.setdefault(
                "hybrid_settings",
                {
                    "preferred_protocol": "zigbee",
                    "protocol_priority": ["zigbee", "matter", "wlan"],
                    "failover_timeout_s": 1.8,
                    "desync_guard_s": 2.5,
                    "event_debounce_ms": 400,
                },
            )
            self.data.setdefault("dismissed_hybrid_pairs", [])
            self.data.setdefault("dashboard", None)
            self.data.setdefault("migrations", {})

            # Migrate / sanitize zone IDs in irrigation store if they contain invalid characters
            irrigation = self.data.get("irrigation")
            if isinstance(irrigation, dict) and "zones" in irrigation:
                modified = False
                for z in irrigation.get("zones", []):
                    zid = str(z.get("id", ""))
                    clean_id = re.sub(r"[^a-zA-Z0-9_]", "", zid).lower()
                    if clean_id and clean_id != zid:
                        z["id"] = clean_id
                        modified = True
                if modified:
                    await self.async_save()
        return self.data

    async def async_save(self, data=None):
        """Save the current data to disk.
        
        If data is provided, it will be set as the current data first.
        """
        async with self._save_lock:
            if data is not None and data is not self.data:
                self.data = data

            try:
                # We deepcopy to avoid mutating the dict while it's being serialized
                # by Home Assistant's executor job, which could raise
                # "dictionary changed size during iteration".
                data_to_save = copy.deepcopy(self.data)
            except Exception as e:
                _LOGGER.error("Deepcopy failed in CompanionStore, falling back to JSON copy: %s", e)
                import json
                # Fallback to json dump/load to strip uncopyable/unserializable objects
                data_to_save = json.loads(json.dumps(self.data, default=str))

            try:
                await self._store.async_save(data_to_save)
                return True
            except Exception as e:
                _LOGGER.error("HA Store async_save failed: %s", e)
                return False

    # ── Blinds ──

    def get_blinds(self):
        return self.data.get("blinds", {})

    async def save_blinds(self, blinds_data):
        self.data["blinds"] = blinds_data
        return await self.async_save()

    # ── Irrigation ──

    def get_irrigation(self):
        return self.data.get("irrigation", {})

    async def save_irrigation(self, data):
        self.data["irrigation"] = data
        return await self.async_save()

    # ── Devices ──

    def get_devices(self):
        return self.data.get("devices", {})

    async def save_devices(self, devices_data):
        self.data["devices"] = devices_data
        return await self.async_save()

    # ── Groups ──

    def get_groups(self):
        return self.data.get("groups", {})

    async def save_groups(self, groups_data):
        self.data["groups"] = groups_data
        return await self.async_save()

    # ── Hybrids (Multi-Protocol Devices) ──

    def get_hybrids(self):
        hybrids = self.data.get("hybrids")
        return hybrids if isinstance(hybrids, dict) else {}

    async def save_hybrids(self, hybrids_data):
        self.data["hybrids"] = hybrids_data if isinstance(hybrids_data, dict) else {}
        return await self.async_save()

    def get_hybrid_settings(self):
        defaults = {
            "preferred_protocol": "zigbee",
            "protocol_priority": ["zigbee", "matter", "wlan"],
            "failover_timeout_s": 1.8,
            "desync_guard_s": 2.5,
            "event_debounce_ms": 400,
        }
        cur = self.data.get("hybrid_settings")
        if not isinstance(cur, dict):
            return dict(defaults)
        merged = dict(defaults)
        merged.update(cur)
        if merged.get("preferred_protocol") not in ("zigbee", "wlan", "matter"):
            merged["preferred_protocol"] = "zigbee"
        return merged

    async def save_hybrid_settings(self, cfg):
        cur = self.get_hybrid_settings()
        if isinstance(cfg, dict):
            cur.update(cfg)
        pref = cur.get("preferred_protocol")
        if pref not in ("zigbee", "wlan", "matter"):
            pref = "zigbee"
        cur["preferred_protocol"] = pref
        cur["protocol_priority"] = [pref] + [p for p in ("zigbee", "matter", "wlan") if p != pref]
        self.data["hybrid_settings"] = cur
        return await self.async_save()

    def get_dismissed_hybrid_pairs(self):
        raw = self.data.get("dismissed_hybrid_pairs")
        return raw if isinstance(raw, list) else []

    async def save_dismissed_hybrid_pairs(self, pairs):
        self.data["dismissed_hybrid_pairs"] = list(dict.fromkeys(str(p) for p in (pairs or []) if p))
        return await self.async_save()

    def get_hidden_hybrid_ids(self) -> tuple[set[str], set[str]]:
        """Return (underlying_device_ids, underlying_entity_ids) hidden from dashboards/automation scans."""
        dev_ids: set[str] = set()
        ent_ids: set[str] = set()
        for h_cfg in self.get_hybrids().values():
            if not isinstance(h_cfg, dict):
                continue
            for t_info in (h_cfg.get("transports") or {}).values():
                if isinstance(t_info, dict) and t_info.get("device_id"):
                    dev_ids.add(str(t_info["device_id"]))
            for ch in h_cfg.get("channels") or []:
                if not isinstance(ch, dict):
                    continue
                for src in (ch.get("sources") or {}).values():
                    if isinstance(src, dict) and src.get("entity_id"):
                        ent_ids.add(str(src["entity_id"]))
            for s_spec in h_cfg.get("sensors") or []:
                if not isinstance(s_spec, dict):
                    continue
                for src in (s_spec.get("sources") or {}).values():
                    if isinstance(src, dict) and src.get("entity_id"):
                        ent_ids.add(str(src["entity_id"]))
            for ev in h_cfg.get("events") or []:
                if not isinstance(ev, dict):
                    continue
                for src in ev.get("sources") or []:
                    if isinstance(src, dict) and src.get("entity_id"):
                        ent_ids.add(str(src["entity_id"]))
        return dev_ids, ent_ids

    # ── Categories ──

    def get_categories(self):
        """Returns merged default + custom categories."""
        custom = self.data.get("categories", {})
        merged = dict(DEFAULT_CATEGORIES)
        merged.update(custom)
        return merged

    def get_custom_categories(self):
        """Returns only user-defined categories."""
        return self.data.get("categories", {})

    async def save_categories(self, categories_data):
        self.data["categories"] = categories_data
        return await self.async_save()

    # ── Dismissed Devices ──

    def get_dismissed_devices(self):
        return self.data.get("dismissed_devices", [])

    async def save_dismissed_devices(self, dismissed):
        self.data["dismissed_devices"] = dismissed
        return await self.async_save()

    # ── Adaptive Light ──

    def get_adaptive_light_config(self):
        return self.data.get("adaptive_light", {})

    async def save_adaptive_light_config(self, config: dict):
        self.data["adaptive_light"] = config
        return await self.async_save()

    # ── Dashboard ──

    def get_dashboard_config(self):
        """Returns the stored dashboard config or None if never initialised."""
        return self.data.get("dashboard")

    async def save_dashboard_config(self, config: dict):
        self.data["dashboard"] = config
        return await self.async_save()

    # ── Migrations ──

    def get_migrations(self) -> dict:
        migrations = self.data.get("migrations")
        if not isinstance(migrations, dict):
            migrations = {}
            self.data["migrations"] = migrations
        return migrations

    async def set_migration_done(self, name: str, value=True) -> bool:
        self.get_migrations()[name] = value
        return await self.async_save()
