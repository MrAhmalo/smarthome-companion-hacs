import asyncio
import logging
import homeassistant.const as _ha_const
EVENT_HOMEASSISTANT_STARTED = getattr(_ha_const, "EVENT_HOMEASSISTANT_STARTED", "homeassistant_started")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
from homeassistant.core import callback
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import (
    build_blind_device_info,
    build_group_device_info,
    build_hybrid_device_info,
    cleanup_duplicated_group_entity_id,
    resolve_group_child_entities,
)
from .entity_sync import PROTOCOL_LABELS
from .hybrid_manager import resolve_source_entity_id

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
                    if cat in ("leuchte", "light", "jalousie", "cover"):
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
            _listen_start = getattr(hass.bus, "async_listen_once", None)
            if callable(_listen_start):
                entry.async_on_unload(
                    _listen_start(EVENT_HOMEASSISTANT_STARTED, lambda _e: sync_group_switches())
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

    hybrid_mgr = hass.data.get(DOMAIN, {}).get("hybrid_manager")
    if module in ("hybrids", "legacy") and store and hybrid_mgr:
        domain_data = hass.data.setdefault(DOMAIN, {})
        h_owner = domain_data.get("_hybrid_switches_entry_id")
        if not h_owner or h_owner == entry_id:
            domain_data["_hybrid_switches_entry_id"] = entry_id
            existing_hybrid_switches: dict[tuple[str, str], HybridSwitch] = {}

            @callback
            def sync_hybrid_switches(event=None):
                hybrids = store.get_hybrids() or {}
                new_ents = []
                active_keys: set[tuple[str, str]] = set()
                for hid, h_cfg in hybrids.items():
                    if not isinstance(h_cfg, dict):
                        continue
                    for ch in h_cfg.get("channels") or []:
                        if not isinstance(ch, dict) or ch.get("domain") != "switch":
                            continue
                        key = (hid, ch.get("channel_key", "main"))
                        active_keys.add(key)
                        if key not in existing_hybrid_switches:
                            ent = HybridSwitch(hass, store, hybrid_mgr, hid, ch)
                            existing_hybrid_switches[key] = ent
                            new_ents.append(ent)
                        else:
                            existing_hybrid_switches[key].async_refresh_hybrid(ch)
                for stale_key in [k for k in existing_hybrid_switches if k not in active_keys]:
                    st_ent = existing_hybrid_switches.pop(stale_key)
                    if st_ent._unsub_tracker:
                        st_ent._unsub_tracker()
                        st_ent._unsub_tracker = None
                    if st_ent._added and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())
                if new_ents:
                    async_add_entities(new_ents)

            sync_hybrid_switches()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_switches))

            @callback
            def _cleanup_hs():
                if domain_data.get("_hybrid_switches_entry_id") == entry_id:
                    domain_data.pop("_hybrid_switches_entry_id", None)
                for ent in existing_hybrid_switches.values():
                    if ent._unsub_tracker:
                        ent._unsub_tracker()
                        ent._unsub_tracker = None

            entry.async_on_unload(_cleanup_hs)


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
            domains=("switch", "light", "fan", "input_boolean", "valve"),
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


class HybridSwitch(SwitchEntity):
    """Master Switch entity routing commands strictly to preferred transport with failover."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, channel_spec: dict) -> None:
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._ch = dict(channel_spec)
        self._channel_key = self._ch.get("channel_key", "main")
        self._ctrl = hybrid_mgr.get_controller(hybrid_id, self._channel_key)
        self._unsub_tracker = None
        self._added = False
        self._active_proto: str | None = None
        self._cached_state: str | None = None
        self._seed_initial_snapshot()
        self._update_attrs()

    def _seed_initial_snapshot(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        snap = (h_cfg.get("initial_channel_states") or {}).get("0")
        if isinstance(snap, dict):
            self._cached_state = snap.get("state")

    def _update_attrs(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        channels = h_cfg.get("channels") or []
        self._attr_name = None if len(channels) <= 1 else f"Kanal {self._channel_key}"
        self._attr_unique_id = self._ch.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_{self._channel_key}"
        self._attr_icon = h_cfg.get("icon") or None
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if self._ch.get("master_entity_id"):
            self.entity_id = self._ch["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, ch_spec: dict) -> None:
        self._ch = dict(ch_spec)
        self._update_attrs()
        self._sync_from_active()
        self._update_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _sync_from_active(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        proto, eid = self._ctrl.select_active_protocol(self._ch.get("sources") or {}, h_cfg)
        self._active_proto = proto
        st = self.hass.states.get(eid) if (eid and self.hass) else None
        if st and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._cached_state = st.state

    @property
    def available(self) -> bool:
        return self._active_proto is not None

    @property
    def is_on(self) -> bool | None:
        if self._cached_state is None:
            return None
        return self._cached_state == "on"

    @property
    def extra_state_attributes(self) -> dict:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    def _refresh_cb(self) -> None:
        self._sync_from_active()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        await self._ctrl.async_dispatch_command(
            "switch",
            "turn_on",
            {},
            self._ch.get("sources") or {},
            on_state_refresh=self._refresh_cb,
        )
        self._refresh_cb()

    async def async_turn_off(self, **kwargs) -> None:
        await self._ctrl.async_dispatch_command(
            "switch",
            "turn_off",
            {},
            self._ch.get("sources") or {},
            on_state_refresh=self._refresh_cb,
        )
        self._refresh_cb()

    def _update_tracking(self) -> None:
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        if not self._added or not self.hass:
            return
        eid_to_proto: dict[str, str] = {}
        for proto, src in (self._ch.get("sources") or {}).items():
            eid = resolve_source_entity_id(self.hass, src)
            if eid:
                eid_to_proto[eid] = proto
        if not eid_to_proto:
            return

        @callback
        def _on_src_change(event) -> None:
            eid = event.data.get("entity_id")
            proto = eid_to_proto.get(eid or "")
            if not proto:
                return
            if not self._ctrl.should_accept_state_event(proto, event.data.get("old_state"), event.data.get("new_state")):
                return
            self._refresh_cb()

        self._unsub_tracker = async_track_state_change_event(self.hass, list(eid_to_proto.keys()), _on_src_change)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._sync_from_active()
        self._update_tracking()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
