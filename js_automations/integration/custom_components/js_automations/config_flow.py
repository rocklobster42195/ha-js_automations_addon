"""Config flow for JS Automations Bridge integration."""
from homeassistant import config_entries

class JSAutomationsConfigFlow(config_entries.ConfigFlow, domain="js_automations"):
    """Handle a config flow for JS Automations."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="JS Automations Bridge", data={})

        return self.async_show_form(step_id="user")