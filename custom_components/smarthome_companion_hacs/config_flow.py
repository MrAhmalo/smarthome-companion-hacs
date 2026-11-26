import voluptuous as vol
from homeassistant import config_entries

from .const import DOMAIN
from .device_helpers import MODULE_TITLES


class SmartHomeCompanionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for SmartHome Companion."""

    VERSION = 1

    def _module_exists(self, module: str) -> bool:
        for entry in self._async_current_entries():
            entry_mod = entry.data.get("module")
            if entry_mod == module:
                return True
            if module == "blinds" and "setup_completed" in entry.data:
                return True
        return False

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        return self.async_show_menu(
            step_id="user",
            menu_options=["hub", "groups", "hybrids", "blinds", "irrigation"],
        )

    async def async_step_hub(self, user_input=None):
        """Handle the hub / simulation module step."""
        if self._module_exists("hub"):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES["hub"],
            data={"module": "hub"},
        )

    async def async_step_groups(self, user_input=None):
        """Handle the groups module step."""
        if self._module_exists("groups"):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES["groups"],
            data={"module": "groups"},
        )

    async def async_step_hybrids(self, user_input=None):
        """Handle the hybrids module step."""
        if self._module_exists("hybrids"):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES["hybrids"],
            data={"module": "hybrids"},
        )

    async def async_step_blinds(self, user_input=None):
        """Handle the blinds module step."""
        if self._module_exists("blinds"):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES["blinds"],
            data={"module": "blinds"},
        )

    async def async_step_irrigation(self, user_input=None):
        """Handle the irrigation module step."""
        if self._module_exists("irrigation"):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES["irrigation"],
            data={"module": "irrigation"},
        )

    async def async_step_import(self, import_info=None):
        """Handle automatic creation of split module entries on upgrade."""
        module = (import_info or {}).get("module")
        if module not in MODULE_TITLES:
            return self.async_abort(reason="unknown")
        if self._module_exists(module):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=MODULE_TITLES[module],
            data={"module": module},
        )
