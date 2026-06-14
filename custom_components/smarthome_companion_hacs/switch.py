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
                    _SleepInTomorrowSwitch(hass, store, blinds_manager, entity_id),
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
        self.entity_id = f"switch.{unique_id_prefix}_{blind_id.replace('.', '_')}"
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

class _SleepInTomorrowSwitch(SwitchEntity):
    def __init__(self, hass, store, blinds_manager, blind_id):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._attr_name = "Morgen Ausschlafen"
        self._attr_unique_id = f"smarthome_companion_switch_sleep_in_tomorrow_{blind_id}"
        self.entity_id = f"switch.smarthome_companion_switch_sleep_in_tomorrow_{blind_id.replace('.', '_')}"
        self._attr_icon = "mdi:bed-clock"

    @property
    def available(self):
        return self._blind_id in self.store.get_blinds()

    @property
    def device_info(self) -> DeviceInfo:
        state = self.hass.states.get(self._blind_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = self._blind_id.split(".")[-1].replace("_", " ").title()
        cover_name = name.replace("Eg", "EG").replace("Og", "OG").replace("Hacs", "HACS")
        return DeviceInfo(
            identifiers={(DOMAIN, self._blind_id)},
            name=cover_name,
            manufacturer="SmartHome Companion",
            model="Rollladen-Automat",
        )

    def _get_target_date(self):
        import homeassistant.util.dt as dt_util
        from datetime import timedelta, datetime, time
        now = dt_util.now()
        target_date = now.date()
        
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            if now.hour >= 12:
                target_date = target_date + timedelta(days=1)
            return target_date

        times = self.blinds_manager.calculate_times(self._blind_id, config, date_val=target_date)
        base_open_time = times.get("base_open_time")
        
        def get_dt(t):
            return datetime.combine(target_date, t, now.tzinfo)
            
        weekend_dt = get_dt(self.blinds_manager._parse_time(config.get("weekend_open_time"), time(9, 0)))
        
        if base_open_time:
            cutoff = max(base_open_time, weekend_dt)
        else:
            cutoff = weekend_dt
            
        open_offset = times.get("open_offset", 0)
        cutoff = cutoff + timedelta(minutes=open_offset)
        
        if now >= cutoff:
            target_date = target_date + timedelta(days=1)
            
        return target_date

    @property
    def is_on(self) -> bool:
        config = self.store.get_blinds().get(self._blind_id)
        if not config: return False
        
        target_date = self._get_target_date()
        return config.get("sleep_in_date") == target_date.isoformat()

    @property
    def extra_state_attributes(self):
        import homeassistant.util.dt as dt_util
        config = self.store.get_blinds().get(self._blind_id)
        if not config: return {}
        
        now = dt_util.now()
        target_date = self._get_target_date()
        
        is_naturally = False
        if config.get("enable_weekend_open", False):
            if target_date == now.date():
                is_naturally = self.store.data.get("today_is_holiday", False)
            else:
                is_naturally = self.store.data.get("tomorrow_is_holiday", False)
                
        return {
            "naturally_sleeping_in": is_naturally,
            "target_day_relative": "heute" if target_date == now.date() else "morgen"
        }

    async def async_turn_on(self, **kwargs) -> None:
        target_date = self._get_target_date()
        
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["sleep_in_date"] = target_date.isoformat()
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()
            self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["sleep_in_date"] = None
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    async def _handle_update(self, event):
        self.async_write_ha_state()
