import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import DOMAIN


class SmartHomeCompanionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for SmartHome Companion."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        return self.async_show_menu(
            step_id="user",
            menu_options=["blinds", "irrigation"]
        )

    async def async_step_blinds(self, user_input=None):
        """Handle the blinds module step."""
        if self._async_current_entries():
            for entry in self._async_current_entries():
                if entry.data.get("module") == "blinds" or "setup_completed" in entry.data:
                    return self.async_abort(reason="already_configured")

        return self.async_create_entry(
            title="SmartHome Rollläden",
            data={"module": "blinds"},
        )

    async def async_step_irrigation(self, user_input=None):
        """Handle the irrigation module step."""
        if self._async_current_entries():
            for entry in self._async_current_entries():
                if entry.data.get("module") == "irrigation":
                    return self.async_abort(reason="already_configured")

        return self.async_create_entry(
            title="SmartHome Bewässerung",
            data={"module": "irrigation"},
        )


