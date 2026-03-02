from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity,
    AlarmControlPanelEntityFeature,
    ATTR_CODE_FORMAT,
    ATTR_CODE_ARM_REQUIRED,
    ATTR_CODE_DISARM_REQUIRED,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import (
    CONF_UNIQUE_ID,
    CONF_STATE,
    STATE_ALARM_ARMED_AWAY,
    STATE_ALARM_ARMED_CUSTOM_BYPASS,
    STATE_ALARM_ARMED_HOME,
    STATE_ALARM_ARMED_NIGHT,
    STATE_ALARM_ARMED_VACATION,
    STATE_ALARM_DISARMED,
    STATE_ALARM_PENDING,
    STATE_ALARM_TRIGGERED,
    STATE_ALARM_ARMING,
    STATE_ALARM_DISARMING,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the alarm_control_panel platform."""

    @callback
    def async_add_alarm_control_panel(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsAlarmControlPanel(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_alarm_control_panel", async_add_alarm_control_panel)
    )

class JSAutomationsAlarmControlPanel(JSAutomationsBaseEntity, AlarmControlPanelEntity):
    """Representation of a JS Automations Alarm Control Panel."""

    def __init__(self, data):
        """Initialize the alarm control panel."""
        self._attr_state = STATE_ALARM_DISARMED # Default state
        self._attr_supported_features = AlarmControlPanelEntityFeature(0)
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_state = last_state.state
            attrs = last_state.attributes
            if ATTR_CODE_FORMAT in attrs: self._attr_code_format = attrs[ATTR_CODE_FORMAT]
            if ATTR_CODE_ARM_REQUIRED in attrs: self._attr_code_arm_required = attrs[ATTR_CODE_ARM_REQUIRED]
            if ATTR_CODE_DISARM_REQUIRED in attrs: self._attr_code_disarm_required = attrs[ATTR_CODE_DISARM_REQUIRED]

    def _update_specific_state(self, data):
        """Update alarm control panel specific state."""
        if CONF_STATE in data:
            # Ensure the state is a valid alarm state
            if data[CONF_STATE] in [
                STATE_ALARM_ARMED_AWAY, STATE_ALARM_ARMED_CUSTOM_BYPASS,
                STATE_ALARM_ARMED_HOME, STATE_ALARM_ARMED_NIGHT,
                STATE_ALARM_ARMED_VACATION, STATE_ALARM_DISARMED,
                STATE_ALARM_PENDING, STATE_ALARM_TRIGGERED,
                STATE_ALARM_ARMING, STATE_ALARM_DISARMING
            ]:
                self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_CODE_FORMAT in attrs: self._attr_code_format = attrs[ATTR_CODE_FORMAT]
            if ATTR_CODE_ARM_REQUIRED in attrs: self._attr_code_arm_required = attrs[ATTR_CODE_ARM_REQUIRED]
            if ATTR_CODE_DISARM_REQUIRED in attrs: self._attr_code_disarm_required = attrs[ATTR_CODE_DISARM_REQUIRED]
            
            # Supported features
            if "supported_features" in attrs:
                self._attr_supported_features = AlarmControlPanelEntityFeature(attrs["supported_features"])
            else: # Default features if not explicitly provided
                if "arm_home" in attrs and attrs["arm_home"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.ARM_HOME
                if "arm_away" in attrs and attrs["arm_away"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.ARM_AWAY
                if "arm_night" in attrs and attrs["arm_night"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.ARM_NIGHT
                if "arm_vacation" in attrs and attrs["arm_vacation"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.ARM_VACATION
                if "arm_custom_bypass" in attrs and attrs["arm_custom_bypass"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.ARM_CUSTOM_BYPASS
                if "trigger" in attrs and attrs["trigger"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.TRIGGER
                if "disarm" in attrs and attrs["disarm"]: self._attr_supported_features |= AlarmControlPanelEntityFeature.DISARM

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        """Disarm the alarm."""
        self.send_event("disarm", {"code": code} if code else None)

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        """Arm the alarm in home mode."""
        self.send_event("arm_home", {"code": code} if code else None)

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        """Arm the alarm in away mode."""
        self.send_event("arm_away", {"code": code} if code else None)

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        """Arm the alarm in night mode."""
        self.send_event("arm_night", {"code": code} if code else None)

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        """Arm the alarm in vacation mode."""
        self.send_event("arm_vacation", {"code": code} if code else None)

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        """Arm the alarm in custom bypass mode."""
        self.send_event("arm_custom_bypass", {"code": code} if code else None)

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        """Trigger the alarm."""
        self.send_event("trigger", {"code": code} if code else None)