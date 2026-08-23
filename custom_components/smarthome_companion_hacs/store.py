import logging
import copy
from homeassistant.helpers.storage import Store
from .const import STORAGE_KEY, STORAGE_VERSION, DEFAULT_CATEGORIES

_LOGGER = logging.getLogger(__name__)

class CompanionStore:
    def __init__(self, hass):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data = {"blinds": {}, "irrigation": {}, "devices": {}, "categories": {}, "dismissed_devices": [], "simulation": {}}

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
        return self.data

    async def async_save(self, data=None):
        """Save the current data to disk.
        
        If data is provided, it will be set as the current data first.
        """
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
