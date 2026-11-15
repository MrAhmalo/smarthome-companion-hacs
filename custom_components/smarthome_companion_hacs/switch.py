import asyncio
import logging
from homeassistant.core import callback
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import (
    build_blind_device_info,
    build_group_device_info,
    cleanup_duplicated_group_entity_id,
    resolve_group_child_entities,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    
    module = (getattr(entry, "data", None) or {}).get("module", "legacy")
    entry_id = getattr(entry, "entry_id", "default")

    added_blind_entities = set()

    @callback
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

    if module in ("blinds", "legacy"):
        # Initial register
        add_blind_switches()

        # Dynamic registration
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_blinds_updated", add_blind_switches
            )
        )

    if module in ("groups", "legacy") and store:
        domain_data = hass.data.setdefault(DOMAIN, {})
        owner_entry_id = domain_data.get("_switch_groups_entry_id")
        if not owner_entry_id or owner_entry_id == entry_id:
            domain_data["_switch_groups_entry_id"] = entry_id
            existing_switch_groups: dict[str, CompanionGroupSwitch] = {}

            @callback
            def sync_group_switches(event=None):
                groups = store.get_groups() or {}
                new_group_entities = []
                active_switch_ids: set[str] = set()
                for group_id, g_cfg in groups.items():
                    if not isinstance(g_cfg, dict):
                        continue
                    cat = (g_cfg.get("category") or "leuchte").strip()
                    if cat in ("leuchte", "light"):
                        continue
                    active_switch_ids.add(group_id)
                    if group_id not in existing_switch_groups:
                        ent = CompanionGroupSwitch(hass, store, group_id)
                        existing_switch_groups[group_id] = ent
                        new_group_entities.append(ent)
                    else:
                        existing_switch_groups[group_id].async_refresh_group()
                for stale_id in [gid for gid in existing_switch_groups if gid not in active_switch_ids]:
                    stale_ent = existing_switch_groups.pop(stale_id)
                    if stale_ent._unsub_tracker:
                        stale_ent._unsub_tracker()
                        stale_ent._unsub_tracker = None
                    if stale_ent._added and stale_ent.hass and stale_ent.platform is not None:
                        hass.async_create_task(stale_ent.async_remove())
                if new_group_entities:
                    async_add_entities(new_group_entities)

            sync_group_switches()
            entry.async_on_unload(
                hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_switches)
            )

            @callback
            def _cleanup_switch_groups_owner():
                if domain_data.get("_switch_groups_entry_id") == entry_id:
                    domain_data.pop("_switch_groups_entry_id", None)
                for ent in existing_switch_groups.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_switch_groups_owner)


class _BlindBaseGenericSwitch(SwitchEntity):
    # Prevent HA state restore from calling async_turn_on/off after restart
    # with old cached values, which would overwrite live store settings.
    _attr_should_poll = False

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
        return build_blind_device_info(self.hass, self._blind_id)

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

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()


class _SleepInTomorrowSwitch(SwitchEntity):
    # Prevent HA state restore from interfering with live store values.
    _attr_should_poll = False

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
        return build_blind_device_info(self.hass, self._blind_id)

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
        if not config:
            return False
        
        target_date = self._get_target_date()
        target_str = target_date.isoformat()
        
        # 1. Manual early wake-up override
        if config.get("wake_early_date") == target_str:
            return False
            
        # 2. Manual sleep-in override
        if config.get("sleep_in_date") == target_str:
            return True
            
        # 3. Automatic detection (Urlaub, Ferien, Feiertag, Wochenende)
        if not config.get("enable_weekend_open", False):
            return False
            
        if target_date.weekday() >= 5:
            return True
            
        import homeassistant.util.dt as dt_util
        now = dt_util.now()
        is_kinderzimmer = config.get("enable_vacation_weekend_mode", False)
        
        if target_date == now.date():
            has_holiday = bool(self.store.data.get("today_is_holiday"))
            has_vacation = bool(self.store.data.get("today_is_vacation"))
            has_urlaub = bool(self.store.data.get("today_is_urlaub"))
        else:
            has_holiday = bool(self.store.data.get("tomorrow_is_holiday"))
            has_vacation = bool(self.store.data.get("tomorrow_is_vacation"))
            has_urlaub = bool(self.store.data.get("tomorrow_is_urlaub"))
            
        if has_holiday:
            return True
        if is_kinderzimmer and has_vacation:
            return True
        if not is_kinderzimmer and has_urlaub:
            return True
            
        return False

    @property
    def extra_state_attributes(self):
        import homeassistant.util.dt as dt_util
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return {}
        
        now = dt_util.now()
        target_date = self._get_target_date()
        target_str = target_date.isoformat()
        
        is_manual_sleep = config.get("sleep_in_date") == target_str
        is_manual_early = config.get("wake_early_date") == target_str
        
        return {
            "naturally_sleeping_in": self.is_on,
            "target_day_relative": "heute" if target_date == now.date() else "morgen",
            "target_date": target_str,
            "manual_override_active": is_manual_sleep or is_manual_early,
        }

    async def async_turn_on(self, **kwargs) -> None:
        target_date = self._get_target_date()
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["sleep_in_date"] = target_date.isoformat()
            blinds[self._blind_id]["wake_early_date"] = None
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()
            self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        target_date = self._get_target_date()
        blinds = self.store.get_blinds()
        if self._blind_id in blinds:
            blinds[self._blind_id]["sleep_in_date"] = None
            blinds[self._blind_id]["wake_early_date"] = target_date.isoformat()
            await self.store.async_save(self.store.data)
            await self.blinds_manager.async_reload()
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()


class CompanionGroupSwitch(SwitchEntity):
    """Native Home Assistant Switch Entity for non-light SmartHome Companion groups."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._unsub_tracker = None
        self._added = False
        self._update_attrs()

    def _update_attrs(self) -> None:
        g = (self._store.get_groups() or {}).get(self._group_id, {})
        self._name = g.get("name") or "Schaltgruppe"
        self._attr_name = None
        self._attr_unique_id = f"smarthome_companion_group_switch_{self._group_id}"
        self._attr_icon = g.get("icon") or "mdi:power-socket-eu"
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)

    @callback
    def async_refresh_group(self) -> None:
        if not self.hass:
            return
        self._update_attrs()
        self._update_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _get_child_entities(self) -> list[str]:
        return resolve_group_child_entities(
            self.hass,
            self._store,
            self._group_id,
            domains=("switch", "light", "fan", "input_boolean", "valve", "cover"),
        )

    @property
    def is_on(self) -> bool:
        if not self.hass:
            return False
        for eid in self._get_child_entities():
            st = self.hass.states.get(eid)
            if st and st.state in ("on", "open", "opening"):
                return True
        return False

    async def async_turn_on(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if not eids:
            return
        by_domain: dict[str, list[str]] = {}
        for eid in eids:
            by_domain.setdefault(eid.split(".", 1)[0], []).append(eid)
        calls = [
            self.hass.services.async_call(dom, "turn_on", {"entity_id": dom_eids}, blocking=False)
            for dom, dom_eids in by_domain.items()
        ]
        if calls:
            await asyncio.gather(*calls)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        eids = self._get_child_entities()
        if not eids:
            return
        by_domain: dict[str, list[str]] = {}
        for eid in eids:
            by_domain.setdefault(eid.split(".", 1)[0], []).append(eid)
        calls = [
            self.hass.services.async_call(dom, "turn_off", {"entity_id": dom_eids}, blocking=False)
            for dom, dom_eids in by_domain.items()
        ]
        if calls:
            await asyncio.gather(*calls)
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._update_tracking()
        cleanup_duplicated_group_entity_id(self.hass, self.entity_id)

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if not self._added or not self.hass:
            return
        eids = self._get_child_entities()
        if eids:
            @callback
            def _state_changed(event):
                if self._added and self.hass and self.entity_id and self.platform is not None:
                    self.async_write_ha_state()

            self._unsub_tracker = async_track_state_change_event(self.hass, eids, _state_changed)

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
