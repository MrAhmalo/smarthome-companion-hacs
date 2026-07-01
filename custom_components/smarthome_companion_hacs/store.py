import logging
import copy
from homeassistant.helpers.storage import Store
from .const import STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

class CompanionStore:
    def __init__(self, hass):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data = {"blinds": {}, "irrigation": {}}

    async def async_load(self):
        saved = await self._store.async_load()
        if saved:
            self.data = saved
        return self.data

    async def async_save(self, data=None):
        """Save the current data to disk.
        
        If data is provided, it will be set as the current data first.
        Unlike the previous implementation, this does NOT deepcopy to avoid
        breaking external references (e.g. BlindsManager._states).
        """
        if data is not None and data is not self.data:
            self.data = data
        await self._store.async_save(copy.deepcopy(self.data))

    def get_blinds(self):
        return self.data.get("blinds", {})

    async def save_blinds(self, blinds_data):
        self.data["blinds"] = blinds_data
        await self.async_save()

    def get_irrigation(self):
        return self.data.get("irrigation", {})

    async def save_irrigation(self, irrigation_data):
        self.data["irrigation"] = irrigation_data
        await self.async_save()
