import logging
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    if not store or not blinds_manager:
        return

    added_blind_entities = set()

    def add_blind_switches(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.extend([
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "enable_random_delay", "Verzögerung: Aktivieren", "smarthome_companion_switch_random_delay", "mdi:shuffle-variant", True),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "use_fixed_open_time", "Öffnen - Feste Zeit: Aktivieren", "smarthome_companion_switch_use_fixed_open_time", "mdi:calendar-clock", False),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "use_sunrise", "Öffnen - Sonnenaufgang: Aktivieren", "smarthome_companion_switch_use_sunrise", "mdi:weather-sunset-up", False),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "use_fixed_close_time", "Schließen - Feste Zeit: Aktivieren", "smarthome_companion_switch_use_fixed_close_time", "mdi:calendar-clock", False),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "use_sunset", "Schließen - Sonnenuntergang: Aktivieren", "smarthome_companion_switch_use_sunset", "mdi:weather-sunset-down", False),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "enable_ventilation", "Lüftung: Aktivieren", "smarthome_companion_switch_enable_ventilation", "mdi:window-shutter-open", False),
                    _BlindBaseGenericSwitch(hass, store, blinds_manager, entity_id, "enable_shading", "Beschattung: Aktivieren", "smarthome_companion_switch_enable_shading", "mdi:window-shutter", False),
                ])
                added_blind_entities.add(entity_id)
        if new_entities:
            async_add_entities(new_entities)

    # Initial register
    add_blind_switches()

    # Dynamic registration
    entry.async_on_unload(
        hass.bus.async_listen(
            "smarthome_companion_blinds_updated", add_blind_switches
        )
    )


class _BlindBaseGenericSwitch(SwitchEntity):
    def __init__(self, hass, store, blinds_manager, blind_id, key, name, unique_id_prefix, icon, default_value=True):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{unique_id_prefix}_{blind_id}"
        self._attr_icon = icon
        self._default_value = default_value

    @property
    def available(self):
        return self._blind_id in self.store.get_blinds()

    @property
    def device_info(self) -> DeviceInfo:
        cover_name = self._cover_label(self._blind_id)
        return DeviceInfo(
            identifiers={(DOMAIN, self._blind_id)},
            name=cover_name,
            manufacturer="SmartHome Companion",
            model="Rollladen-Automat",
        )

    def _cover_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = entity_id.split(".")[-1].replace("_", " ").title()
        return name.replace("Eg", "EG").replace("Og", "OG").replace("Hacs", "HACS")

    @property
    def is_on(self) -> bool:
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return self._default_value
        val = config.get(self._key, self._default_value)
        return self._default_value if val is None else bool(val)

    async def async_turn_on(self, **kwargs) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id][self._key] = True
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()

    async def async_turn_off(self, **kwargs) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id][self._key] = False
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()
