import logging
import copy
from homeassistant.helpers.storage import Store
from .const import STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

class CompanionStore:
    def __init__(self, hass):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data = {"blinds": {}}

    async def async_load(self):
        saved = await self._store.async_load()
        if saved:
            self.data = saved
        return self.data

    async def async_save(self, data):
        self.data = copy.deepcopy(data)
        await self._store.async_save(self.data)

    def get_blinds(self):
        return self.data.get("blinds", {})

    async def save_blinds(self, blinds_data):
        self.data["blinds"] = blinds_data
        await self.async_save(self.data)
