import logging
import os
import json
import re
import time
from datetime import timedelta, time as dt_time, datetime
# pyrefly: ignore [missing-import]
import homeassistant.util.dt as dt_util

# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.components.sensor import SensorEntity
import types
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
EVENT_HOMEASSISTANT_STARTED = getattr(_ha_const, "EVENT_HOMEASSISTANT_STARTED", "homeassistant_started")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
UnitOfEnergy = getattr(_ha_const, "UnitOfEnergy", types.SimpleNamespace(KILO_WATT_HOUR="kWh", WATT_HOUR="Wh"))
# pyrefly: ignore [missing-import]
from homeassistant.helpers import device_registry as dr, entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.entity import DeviceInfo
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import (
    build_blind_device_info,
    build_hub_device_info,
    build_hybrid_device_info,
    build_irrigation_zone_device_info,
)
from .energy_counter import CompanionDeltaEnergySensor, normalize_energy_to_mwh
from .entity_sync import PROTOCOL_LABELS
from .group_sensors import (
    GROUP_SENSOR_SPECS,
    CompanionGroupAggregatedSensor,
    CompanionGroupEnergySensor,
    resolve_group_leaf_sensors,
)
from .hybrid_manager import resolve_source_entity_id

_LOGGER = logging.getLogger(__name__)

class IntegrationInfoSensor(SensorEntity):
    def __init__(self, hass, module="legacy", version="Unknown"):
        self.hass = hass
        self._module = module
        if module == "legacy":
            self._attr_name = "SmartHome Companion"
            self._attr_unique_id = "smarthome_companion_integration_info"
        else:
            self._attr_name = f"SmartHome Companion ({module.title()})"
            self._attr_unique_id = f"smarthome_companion_integration_info_{module}"
        self._attr_icon = "mdi:home-assistant"
        self._version = version

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info(self._module)

    @property
    def native_value(self):
        return self._version

    @property
    def extra_state_attributes(self):
        return {
            "integration": "SmartHome Companion HACS Backend",
            "author": "SmartHome Companion"
        }

async def async_setup_entry(hass, entry, async_add_entities):
    # pyrefly: ignore [missing-import]
    from homeassistant.loader import async_get_integration
    
    sun_manager = hass.data[DOMAIN].get("sun_manager")
    store = hass.data[DOMAIN].get("store")
    blinds_manager = hass.data[DOMAIN].get("blinds_manager")
    irrigation_manager = hass.data[DOMAIN].get("irrigation_manager")
    
    module = entry.data.get("module", "legacy")

    try:
        integration = await async_get_integration(hass, DOMAIN)
        version = integration.version
    except Exception:
        version = "Unknown"

    entities = [IntegrationInfoSensor(hass, module, version)]
    if module in ("blinds", "legacy") and sun_manager:
        entities.extend([
            FassadeSunSensor(sun_manager, "nord", "Nord"),
            FassadeSunSensor(sun_manager, "ost", "Ost"),
            FassadeSunSensor(sun_manager, "sued", "Süd"),
            FassadeSunSensor(sun_manager, "west", "West"),
            FassadeSunForecastSensor(sun_manager, "nord", "Nord"),
            FassadeSunForecastSensor(sun_manager, "ost", "Ost"),
            FassadeSunForecastSensor(sun_manager, "sued", "Süd"),
            FassadeSunForecastSensor(sun_manager, "west", "West"),
            FassadeSunForecastTomorrowSensor(sun_manager, "nord", "Nord"),
            FassadeSunForecastTomorrowSensor(sun_manager, "ost", "Ost"),
            FassadeSunForecastTomorrowSensor(sun_manager, "sued", "Süd"),
            FassadeSunForecastTomorrowSensor(sun_manager, "west", "West"),
            GlobalShadingNeededSensor(sun_manager),
            GlobalShadingNeededTomorrowSensor(sun_manager),
        ])
        if store:
            entities.extend([
                ConfiguredBlindsSensor(hass, store),
                UnconfiguredBlindsSensor(hass, store),
            ])
            
    if module in ("irrigation", "legacy") and store:
        entities.extend([
            ConfiguredIrrigationSensor(hass, store),
            UnconfiguredIrrigationSensor(hass, store),
            IrrigationMaxManualRuntimeSensor(hass, store),
            IrrigationSimultaneousModeSensor(hass, store),
        ])

    simulation_manager = hass.data[DOMAIN].get("simulation_manager")
    if store and simulation_manager and module in ("hub", "legacy"):
        if "presence_simulation_sensor_added" not in hass.data[DOMAIN]:
            entities.append(PresenceSimulationActiveSensor(hass, store, simulation_manager))
            hass.data[DOMAIN]["presence_simulation_sensor_added"] = True

    if module in ("blinds", "legacy"):
        dev_reg = dr.async_get(hass)
        dev_reg.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, "hub")},
            name="SmartHome Rollläden (Steuerung)",
            manufacturer="SmartHome Companion",
            model="Rollläden · Steuerung",
        )
    if module in ("irrigation", "legacy"):
        dev_reg = dr.async_get(hass)
        dev_reg.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, "irrigation_hub")},
            name="SmartHome Bewässerung",
            manufacturer="SmartHome Companion",
            model="Bewässerung · Steuerung",
        )

    if entities:
        async_add_entities(entities)

    # Track dynamically added blind unique IDs
    added_blind_entities = set()

    @callback
    def _add_blind_sensors_sync(event=None):
        if not store or not blinds_manager:
            return
        blinds = store.get_blinds()
        new_entities = []
        for entity_id, config in blinds.items():
            if not entity_id.startswith("cover."):
                continue
            if entity_id not in added_blind_entities:
                new_entities.extend(
                    [
                        BlindOpenTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindCloseTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindSunriseOpenTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindSunsetCloseTimeSensor(hass, store, blinds_manager, entity_id),
                        BlindNextActionSensor(hass, store, blinds_manager, entity_id),
                        BlindShadingPredictionTodaySensor(hass, store, blinds_manager, entity_id),
                        BlindShadingPredictionTomorrowSensor(hass, store, blinds_manager, entity_id),
                    ]
                )
                added_blind_entities.add(entity_id)

        if new_entities:
            async_add_entities(new_entities)

    @callback
    def add_blind_sensors(event=None):
        _add_blind_sensors_sync(event)

    if module in ("blinds", "legacy"):
        # Initial register
        _add_blind_sensors_sync()

        # Dynamic registration upon config reloads/updates
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_blinds_updated", add_blind_sensors
            )
        )

    added_irrigation_entities = set()

    @callback
    def _add_irrigation_sensors_sync(event=None):
        if not store or not irrigation_manager:
            return
        irrigation_data = store.get_irrigation()
        if not irrigation_data:
            return
        zones = irrigation_data.get("zones", [])
        new_entities = []
        for zone in zones:
            zone_id = zone.get("id")
            if not zone_id:
                continue
            clean_zone_id = _clean_zone_id(zone_id)
                
            base_sensors = [
                ("last_watered", IrrigationZoneLastWateredSensor),
                ("next_planned", IrrigationZoneNextRunSensor),
                ("status", IrrigationZoneStatusSensor),
                ("duration", IrrigationZoneDurationSensor),
                ("progress", IrrigationZoneProgressSensor),
            ]
            
            for sensor_key, sensor_class in base_sensors:
                unique_id = f"{clean_zone_id}_{sensor_key}"
                if unique_id not in added_irrigation_entities:
                    new_entities.append(sensor_class(hass, store, irrigation_manager, zone_id))
                    added_irrigation_entities.add(unique_id)
                    
            if zone.get("soil_sensor_entity_id"):
                unique_id = f"{clean_zone_id}_target_moisture"
                if unique_id not in added_irrigation_entities:
                    new_entities.append(IrrigationZoneTargetMoistureSensor(hass, store, irrigation_manager, zone_id))
                    added_irrigation_entities.add(unique_id)

        if new_entities:
            async_add_entities(new_entities)

    @callback
    def update_irrigation_sensors(event=None):
        _add_irrigation_sensors_sync()
        for entity in entities:
            if isinstance(entity, (ConfiguredIrrigationSensor, UnconfiguredIrrigationSensor, IrrigationMaxManualRuntimeSensor, IrrigationSimultaneousModeSensor)):
                entity.async_write_ha_state()

    if module in ("irrigation", "legacy"):
        _add_irrigation_sensors_sync()
        entry.async_on_unload(
            hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", update_irrigation_sensors
            )
        )

    domain_data = hass.data.setdefault(DOMAIN, {})
    entry_id = getattr(entry, "entry_id", "default")

    # ── Group Master Aggregated Sensors (module in groups/legacy) ──
    if store and module in ("groups", "legacy"):
        g_owner = domain_data.get("_group_sensors_entry_id")
        if not g_owner or g_owner == entry_id:
            domain_data["_group_sensors_entry_id"] = entry_id
            group_sensors_map: dict[tuple[str, str], SensorEntity] = {}

            @callback
            def sync_group_sensors(event=None):
                groups = store.get_groups() or {}
                active_keys: set[tuple[str, str]] = set()
                new_ents: list[SensorEntity] = []

                for gid in list(groups.keys()):
                    buckets = resolve_group_leaf_sensors(hass, store, gid)
                    for (dom, dc), member_eids in buckets.items():
                        if dom != "sensor" or dc not in GROUP_SENSOR_SPECS or not member_eids:
                            continue
                        key = (gid, dc)
                        active_keys.add(key)
                        if key not in group_sensors_map:
                            if GROUP_SENSOR_SPECS[dc]["mode"] == "delta_sum":
                                ent: SensorEntity = CompanionGroupEnergySensor(hass, store, gid)
                            else:
                                ent = CompanionGroupAggregatedSensor(hass, store, gid, dc)
                            ent.set_members(member_eids)
                            group_sensors_map[key] = ent
                            new_ents.append(ent)
                        else:
                            group_sensors_map[key].set_members(member_eids)

                ent_reg = er.async_get(hass)
                for stale_key in [k for k in group_sensors_map if k not in active_keys]:
                    st_ent = group_sensors_map.pop(stale_key)
                    if getattr(st_ent, "_unsub", None):
                        st_ent._unsub()
                        st_ent._unsub = None
                    if getattr(st_ent, "_added", False) and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())
                    uid = st_ent.unique_id
                    if uid:
                        reg_eid = ent_reg.async_get_entity_id("sensor", DOMAIN, uid)
                        if reg_eid:
                            try:
                                ent_reg.async_remove(reg_eid)
                            except Exception:  # noqa: BLE001
                                pass

                if new_ents:
                    async_add_entities(new_ents)

            sync_group_sensors()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_dashboard_updated", sync_group_sensors))
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_group_sensors))
            _listen_start = getattr(hass.bus, "async_listen_once", None)
            if callable(_listen_start):
                entry.async_on_unload(_listen_start(EVENT_HOMEASSISTANT_STARTED, lambda _e: sync_group_sensors()))

            @callback
            def _cleanup_gs():
                if domain_data.get("_group_sensors_entry_id") == entry_id:
                    domain_data.pop("_group_sensors_entry_id", None)
                for ent in group_sensors_map.values():
                    if getattr(ent, "_unsub", None):
                        ent._unsub()
                        ent._unsub = None

            entry.async_on_unload(_cleanup_gs)

    # ── Hybrid Multi-Protocol Sensors & Delta Energy Counters (module in hybrids/legacy) ──
    hybrid_mgr = domain_data.get("hybrid_manager")
    if store and hybrid_mgr and module in ("hybrids", "legacy"):
        h_owner = domain_data.get("_hybrid_sensors_entry_id")
        if not h_owner or h_owner == entry_id:
            domain_data["_hybrid_sensors_entry_id"] = entry_id
            hybrid_sensors_map: dict[tuple[str, str], SensorEntity] = {}

            @callback
            def sync_hybrid_sensors(event=None):
                hybrids = store.get_hybrids() or {}
                active_keys: set[tuple[str, str]] = set()
                new_ents: list[SensorEntity] = []

                for hid, h_cfg in hybrids.items():
                    if not isinstance(h_cfg, dict):
                        continue
                    for s_spec in h_cfg.get("sensors") or []:
                        if not isinstance(s_spec, dict) or s_spec.get("domain") != "sensor":
                            continue
                        key = (hid, s_spec.get("sensor_key", ""))
                        active_keys.add(key)
                        if key not in hybrid_sensors_map:
                            if s_spec.get("mode") == "delta_energy":
                                ent = HybridEnergySensor(hass, store, hybrid_mgr, hid, s_spec)
                            else:
                                ent = HybridFallbackSensor(hass, store, hybrid_mgr, hid, s_spec)
                            hybrid_sensors_map[key] = ent
                            new_ents.append(ent)
                        else:
                            hybrid_sensors_map[key].async_refresh_hybrid(s_spec)

                for stale_key in [k for k in hybrid_sensors_map if k not in active_keys]:
                    st_ent = hybrid_sensors_map.pop(stale_key)
                    if getattr(st_ent, "_unsub", None):
                        st_ent._unsub()
                        st_ent._unsub = None
                    if getattr(st_ent, "_added", False) and st_ent.hass and st_ent.platform is not None:
                        hass.async_create_task(st_ent.async_remove())

                if new_ents:
                    async_add_entities(new_ents)

            sync_hybrid_sensors()
            entry.async_on_unload(hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", sync_hybrid_sensors))

            @callback
            def _cleanup_hs():
                if domain_data.get("_hybrid_sensors_entry_id") == entry_id:
                    domain_data.pop("_hybrid_sensors_entry_id", None)
                for ent in hybrid_sensors_map.values():
                    if getattr(ent, "_unsub", None):
                        ent._unsub()
                        ent._unsub = None

            entry.async_on_unload(_cleanup_hs)


class HybridEnergySensor(CompanionDeltaEnergySensor):
    """Persistent `TOTAL_INCREASING` Delta Energy Master for a single physical multi-protocol device."""

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, spec: dict) -> None:
        init_unit = str(spec.get("native_unit") or UnitOfEnergy.KILO_WATT_HOUR)
        init_mwh = spec.get("initial_energy_mwh")
        super().__init__(
            mode="hybrid",
            native_unit=init_unit,
            max_kw=25.0,
            initial_cumulative_mwh=int(init_mwh) if isinstance(init_mwh, (int, float)) else None,
        )
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._spec = dict(spec)
        self._sensor_key = self._spec.get("sensor_key", "energy")
        self._ctrl = hybrid_mgr.get_controller(hybrid_id, "main")
        self._unsub = None
        self._active_proto: str | None = None
        self._update_meta()

    def _update_meta(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        self._attr_name = "Energie"
        self._attr_unique_id = self._spec.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_sensor_{self._sensor_key}"
        self._attr_icon = "mdi:lightning-bolt"
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if self._spec.get("master_entity_id"):
            self.entity_id = self._spec["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, spec: dict) -> None:
        self._spec = dict(spec)
        self._update_meta()
        self._sync_sources()
        self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self._schedule_coalesced_write(force=True)

    def _sync_sources(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        sources = self._spec.get("sources") or {}
        now = time.monotonic()

        # Select highest-priority available transport for energy
        chosen_proto: str | None = None
        readings: dict[str, int | None] = {}
        for proto in self._ctrl.get_protocol_order(h_cfg):
            src = sources.get(proto)
            eid = resolve_source_entity_id(self.hass, src)
            if not eid:
                continue
            st = self.hass.states.get(eid) if self.hass else None
            if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._engine.mark_source_unavailable(proto)
                readings[proto] = None
                continue
            mwh = normalize_energy_to_mwh(st.state, st.attributes.get("unit_of_measurement"))
            readings[proto] = mwh
            if mwh is not None and chosen_proto is None:
                chosen_proto = proto

        self._active_proto = chosen_proto
        if chosen_proto is not None:
            self._engine.set_active_source(chosen_proto, readings.get(chosen_proto), now=now)
        for proto, mwh in readings.items():
            if mwh is not None:
                self._engine.process_reading(proto, mwh, now=now, is_active=(proto == chosen_proto))

    @property
    def available(self) -> bool:
        return self._engine.initialized or self._active_proto is not None

    @property
    def extra_state_attributes(self) -> dict:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    async def async_added_to_hass(self) -> None:
        self._added = True
        await self._restore_delta_state()
        self._sync_sources()
        self._rebind_tracking()

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass:
            return
        eid_to_proto: dict[str, str] = {}
        for proto, src in (self._spec.get("sources") or {}).items():
            eid = resolve_source_entity_id(self.hass, src)
            if eid:
                eid_to_proto[eid] = proto
        if not eid_to_proto:
            return

        @callback
        def _on_energy_tick(event) -> None:
            eid = event.data.get("entity_id")
            proto = eid_to_proto.get(eid or "")
            if not proto:
                return
            h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
            sources = self._spec.get("sources") or {}
            # Determine active transport cleanly on every event
            chosen_proto = None
            for p_cand in self._ctrl.get_protocol_order(h_cfg):
                c_eid = resolve_source_entity_id(self.hass, sources.get(p_cand))
                c_st = self.hass.states.get(c_eid) if c_eid else None
                if c_st is not None and c_st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                    if normalize_energy_to_mwh(c_st.state, c_st.attributes.get("unit_of_measurement")) is not None:
                        chosen_proto = p_cand
                        break

            prev_proto = self._active_proto
            self._active_proto = chosen_proto
            new_st = event.data.get("new_state")
            now = time.monotonic()

            if new_st is None or new_st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._engine.mark_source_unavailable(proto)
                if chosen_proto and chosen_proto != prev_proto:
                    c_eid = resolve_source_entity_id(self.hass, sources.get(chosen_proto))
                    c_st = self.hass.states.get(c_eid) if c_eid else None
                    c_mwh = normalize_energy_to_mwh(c_st.state, c_st.attributes.get("unit_of_measurement")) if c_st else None
                    self._engine.set_active_source(chosen_proto, c_mwh, now=now)
                    self._schedule_coalesced_write()
                return

            mwh = normalize_energy_to_mwh(new_st.state, new_st.attributes.get("unit_of_measurement"))
            if mwh is None:
                return
            if chosen_proto and chosen_proto != prev_proto:
                c_eid = resolve_source_entity_id(self.hass, sources.get(chosen_proto))
                c_st = self.hass.states.get(c_eid) if c_eid else None
                c_mwh = normalize_energy_to_mwh(c_st.state, c_st.attributes.get("unit_of_measurement")) if c_st else None
                self._engine.set_active_source(chosen_proto, c_mwh, now=now)

            added = self._engine.process_reading(proto, mwh, now=now, is_active=(proto == chosen_proto))
            if added > 0 or chosen_proto != prev_proto:
                self._schedule_coalesced_write()

        self._unsub = async_track_state_change_event(self.hass, list(eid_to_proto.keys()), _on_energy_tick)

    async def async_will_remove_from_hass(self) -> None:
        await super().async_will_remove_from_hass()
        if self._unsub:
            self._unsub()
            self._unsub = None


class HybridFallbackSensor(SensorEntity):
    """Per-sensor fallback Sensor for non-energy Hybrid sensors (power, voltage, temp, ...)."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, hybrid_mgr, hybrid_id: str, spec: dict) -> None:
        self.hass = hass
        self._store = store
        self._hybrid_mgr = hybrid_mgr
        self._hybrid_id = hybrid_id
        self._spec = dict(spec)
        self._sensor_key = self._spec.get("sensor_key", "")
        self._ctrl = hybrid_mgr.get_controller(hybrid_id, "main")
        self._unsub = None
        self._added = False
        self._active_proto: str | None = None
        self._value = None
        self._unit = None
        self._device_class = None
        self._state_class = None
        self._available = False
        self._update_meta()

    def _update_meta(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        dc = str(self._spec.get("device_class") or "").strip().lower()
        spec_meta = GROUP_SENSOR_SPECS.get(dc)
        self._attr_name = (spec_meta["label"] if spec_meta else dc.replace("_", " ").title()) or self._sensor_key
        self._attr_unique_id = self._spec.get("master_unique_id") or f"smarthome_companion_hybrid_{self._hybrid_id}_sensor_{self._sensor_key}"
        if spec_meta:
            self._attr_icon = spec_meta["icon"]
            self._device_class = spec_meta["device_class"]
            self._state_class = spec_meta["state_class"]
        self._attr_device_info = build_hybrid_device_info(self._hybrid_id, h_cfg, self._store)
        if self._spec.get("master_entity_id"):
            self.entity_id = self._spec["master_entity_id"]

    @callback
    def async_refresh_hybrid(self, spec: dict) -> None:
        self._spec = dict(spec)
        self._update_meta()
        self._recompute()
        self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self.async_write_ha_state()

    def _recompute(self) -> None:
        h_cfg = (self._store.get_hybrids() or {}).get(self._hybrid_id, {})
        sources = self._spec.get("sources") or {}
        for proto in self._ctrl.get_protocol_order(h_cfg):
            eid = resolve_source_entity_id(self.hass, sources.get(proto))
            if not eid:
                continue
            st = self.hass.states.get(eid) if self.hass else None
            if st is not None and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._active_proto = proto
                attrs = st.attributes or {}
                if self._unit is None and attrs.get("unit_of_measurement"):
                    self._unit = attrs.get("unit_of_measurement")
                if self._device_class is None and attrs.get("device_class"):
                    self._device_class = attrs.get("device_class")
                if self._state_class is None and attrs.get("state_class"):
                    self._state_class = attrs.get("state_class")
                try:
                    self._value = float(st.state) if "." in str(st.state) else int(st.state)
                except (TypeError, ValueError):
                    self._value = st.state
                self._available = True
                return
        self._active_proto = None
        self._available = False

    @property
    def available(self) -> bool:
        return self._available

    @property
    def native_value(self):
        return self._value

    @property
    def native_unit_of_measurement(self):
        return self._unit

    @property
    def device_class(self):
        return self._device_class

    @property
    def state_class(self):
        return self._state_class

    @property
    def extra_state_attributes(self) -> dict:
        if not self._active_proto:
            return {}
        return {"active_transport": PROTOCOL_LABELS.get(self._active_proto, self._active_proto)}

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass:
            return
        eids = [
            eid
            for src in (self._spec.get("sources") or {}).values()
            if (eid := resolve_source_entity_id(self.hass, src))
        ]
        if not eids:
            return

        @callback
        def _changed(event) -> None:
            self._recompute()
            if self._added and self.hass and self.entity_id and self.platform is not None:
                self.async_write_ha_state()

        self._unsub = async_track_state_change_event(self.hass, list(dict.fromkeys(eids)), _changed)

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._recompute()
        self._rebind_tracking()

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub:
            self._unsub()
            self._unsub = None


class _BaseBlindsSensor(SensorEntity):
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store

    def _configured_blinds(self):
        blinds = self.store.get_blinds()
        return {
            entity_id: config
            for entity_id, config in blinds.items()
            if entity_id.startswith("cover.")
        }

    def _all_cover_entities(self):
        return {state.entity_id for state in self.hass.states.async_all("cover")}

    def _cover_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = entity_id.split(".")[-1].replace("_", " ").title()
        return name.replace("Eg", "EG").replace("Og", "OG").replace("Hacs", "HACS")

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()


class ConfiguredBlindsSensor(_BaseBlindsSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion eingerichtete Rollläden"
        self._attr_unique_id = "smarthome_companion_configured_blinds"
        self._attr_icon = "mdi:window-shutter-cog"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return len(self._configured_blinds())

    @property
    def extra_state_attributes(self):
        blinds = self._configured_blinds()
        return {
            "configured_count": len(blinds),
            "configured_blinds": [
                {
                    "entity_id": entity_id,
                    "name": self._cover_label(entity_id),
                    "enable_shading": bool(config.get("enable_shading", False)),
                    "window_azimuth": config.get("window_azimuth"),
                    "use_sunrise": bool(config.get("use_sunrise", False)),
                    "use_sunset": bool(config.get("use_sunset", False)),
                }
                for entity_id, config in sorted(blinds.items())
            ],
        }


class UnconfiguredBlindsSensor(_BaseBlindsSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion nicht eingerichtete Rollläden"
        self._attr_unique_id = "smarthome_companion_unconfigured_blinds"
        self._attr_icon = "mdi:window-shutter-alert"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        configured = set(self._configured_blinds().keys())
        return len(self._all_cover_entities() - configured)

    @property
    def extra_state_attributes(self):
        configured = set(self._configured_blinds().keys())
        all_covers = sorted(self._all_cover_entities())
        unconfigured = [entity_id for entity_id in all_covers if entity_id not in configured]
        return {
            "unconfigured_count": len(unconfigured),
            "total_cover_entities": len(all_covers),
            "unconfigured_blinds": [
                {
                    "entity_id": entity_id,
                    "name": self._cover_label(entity_id),
                }
                for entity_id in unconfigured
            ],
        }


class _BaseIrrigationSensor(SensorEntity):
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store

    def _get_zones(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return []
        return irrigation_data.get("zones", [])

    def _all_valve_entities(self):
        return {state.entity_id for state in self.hass.states.async_all("valve")}

    def _valve_label(self, entity_id):
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            name = state.attributes["friendly_name"]
        else:
            name = entity_id.split(".")[-1].replace("_", " ").title()
        return name

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()


class ConfiguredIrrigationSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion eingerichtete Bewässerungszonen"
        self._attr_unique_id = "smarthome_companion_configured_irrigation_zones"
        self._attr_icon = "mdi:sprinkler-variant"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("irrigation")

    @property
    def native_value(self):
        return len(self._get_zones())

    @property
    def extra_state_attributes(self):
        zones = self._get_zones()
        return {
            "configured_count": len(zones),
            "configured_zones": [
                {
                    "id": zone.get("id"),
                    "name": zone.get("name"),
                    "valve": zone.get("valve_entity_id"),
                }
                for zone in zones
            ],
        }


class UnconfiguredIrrigationSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Smarthome Companion nicht eingerichtete Ventile"
        self._attr_unique_id = "smarthome_companion_unconfigured_irrigation_valves"
        self._attr_icon = "mdi:valve-closed"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("irrigation")

    @property
    def native_value(self):
        zones = self._get_zones()
        configured_valves = {z.get("valve_entity_id") for z in zones if z.get("valve_entity_id")}
        return len(self._all_valve_entities() - configured_valves)

    @property
    def extra_state_attributes(self):
        zones = self._get_zones()
        configured_valves = {z.get("valve_entity_id") for z in zones if z.get("valve_entity_id")}
        all_valves = sorted(self._all_valve_entities())
        unconfigured = [entity_id for entity_id in all_valves if entity_id not in configured_valves]
        return {
            "unconfigured_count": len(unconfigured),
            "total_valve_entities": len(all_valves),
            "unconfigured_valves": [
                {
                    "entity_id": entity_id,
                    "name": self._valve_label(entity_id),
                }
                for entity_id in unconfigured
            ],
        }

class IrrigationMaxManualRuntimeSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Maximale manuelle Laufzeit"
        self._attr_unique_id = "smarthome_companion_irrigation_max_manual_runtime"
        self._attr_icon = "mdi:timer-sand"
        self._attr_native_unit_of_measurement = "min"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("irrigation")

    @property
    def native_value(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return 60
        return irrigation_data.get("max_manual_runtime_minutes", 60)

class IrrigationSimultaneousModeSensor(_BaseIrrigationSensor):
    def __init__(self, hass, store):
        super().__init__(hass, store)
        self._attr_name = "Bewässerungsmodus (Gleichzeitig)"
        self._attr_unique_id = "smarthome_companion_irrigation_simultaneous_mode"
        self._attr_icon = "mdi:water-pump"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("irrigation")

    @property
    def native_value(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data:
            return "Nacheinander"
        return "Gleichzeitig" if irrigation_data.get("simultaneous", False) else "Nacheinander"



class FassadeSunSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:weather-sunny"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return round(self.sun_manager.intensities.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class FassadeSunForecastSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit (Max Heute)"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_forecast_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:sun-wireless"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return round(self.sun_manager.forecast_max_intensities.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class GlobalShadingNeededSensor(SensorEntity):
    def __init__(self, sun_manager):
        self.sun_manager = sun_manager
        self._attr_name = "Beschattung heute erforderlich"
        self._attr_unique_id = "smarthome_companion_global_shading_needed"
        self._attr_icon = "mdi:shield-sun"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return "Ja" if self.sun_manager.global_shading_needed else "Nein"

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class FassadeSunForecastTomorrowSensor(SensorEntity):
    def __init__(self, sun_manager, direction_id, direction_name):
        self.sun_manager = sun_manager
        self._direction_id = direction_id
        self._attr_name = f"Haus {direction_name} Helligkeit (Max Morgen)"
        self._attr_unique_id = f"smarthome_companion_sun_intensity_forecast_tomorrow_{direction_id}"
        self._attr_native_unit_of_measurement = "W/m²"
        self._attr_icon = "mdi:sun-wireless"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return round(self.sun_manager.forecast_max_intensities_tomorrow.get(self._direction_id, 0), 1)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class GlobalShadingNeededTomorrowSensor(SensorEntity):
    def __init__(self, sun_manager):
        self.sun_manager = sun_manager
        self._attr_name = "Beschattung morgen erforderlich"
        self._attr_unique_id = "smarthome_companion_global_shading_needed_tomorrow"
        self._attr_icon = "mdi:shield-sun"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("blinds")

    @property
    def native_value(self):
        return "Ja" if self.sun_manager.global_shading_needed_tomorrow else "Nein"

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class _BlindBaseSensor(SensorEntity):
    def __init__(self, hass, store, blinds_manager, blind_id, sensor_type):
        self.hass = hass
        self.store = store
        self.blinds_manager = blinds_manager
        self._blind_id = blind_id
        self._sensor_type = sensor_type

    @property
    def extra_state_attributes(self):
        return {
            "blind_id": self._blind_id,
            "sensor_type": self._sensor_type,
        }

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

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_blinds_updated", self._handle_update
            )
        )
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_sun_updated", self._handle_update
            )
        )
        self.async_write_ha_state()

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()


class BlindOpenTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "open_time")
        self._attr_name = "Geplante Öffnungszeit"
        self._attr_unique_id = f"smarthome_companion_sensor_open_time_{blind_id}"
        self._attr_icon = "mdi:clock-start"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_fixed_open_time", False) and not config.get("use_sunrise", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        open_time = times_today.get("open_time")
        if open_time and open_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            open_time = times_tomorrow.get("open_time")
        if open_time:
            return open_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindCloseTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "close_time")
        self._attr_name = "Geplante Schließzeit"
        self._attr_unique_id = f"smarthome_companion_sensor_close_time_{blind_id}"
        self._attr_icon = "mdi:clock-end"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_fixed_close_time", False) and not config.get("use_sunset", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        close_time = times_today.get("close_time")
        if close_time and close_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            close_time = times_tomorrow.get("close_time")
        if close_time:
            return close_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindSunriseOpenTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "sunrise_time")
        self._attr_name = "Sonnenaufgangs-Öffnungszeit"
        self._attr_unique_id = f"smarthome_companion_sensor_sunrise_open_time_{blind_id}"
        self._attr_icon = "mdi:weather-sunset-up"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_sunrise", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        sunrise_time = times_today.get("sunrise_time")
        if sunrise_time and sunrise_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            sunrise_time = times_tomorrow.get("sunrise_time")
        if sunrise_time:
            return sunrise_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindSunsetCloseTimeSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "sunset_time")
        self._attr_name = "Sonnenuntergangs-Schließzeit"
        self._attr_unique_id = f"smarthome_companion_sensor_sunset_close_time_{blind_id}"
        self._attr_icon = "mdi:weather-sunset-down"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return None
        if not config.get("use_sunset", False):
            return "Deaktiviert"
        now = dt_util.now()
        times_today = self.blinds_manager.calculate_times(self._blind_id, config, now.date())
        sunset_time = times_today.get("sunset_time")
        if sunset_time and sunset_time <= now:
            times_tomorrow = self.blinds_manager.calculate_times(self._blind_id, config, now.date() + timedelta(days=1))
            sunset_time = times_tomorrow.get("sunset_time")
        if sunset_time:
            return sunset_time.strftime("%H:%M")
        return "Deaktiviert"


class BlindNextActionSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "next_action")
        self._attr_name = "Nächste Aktion"
        self._attr_unique_id = f"smarthome_companion_sensor_next_action_{blind_id}"
        self._attr_icon = "mdi:clock-check-outline"

    def _get_events(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config:
            return []
            
        now = dt_util.now()
        events = []
        
        for day_offset in [0, 1]:
            d = now.date() + timedelta(days=day_offset)
            times = self.blinds_manager.calculate_times(self._blind_id, config, d)
            open_dt = times.get("open_time")
            close_dt = times.get("close_time")
            
            if open_dt:
                vent_until = self.blinds_manager._parse_time(config.get("ventilation_until"), time(10, 0))
                has_vent = config.get("enable_ventilation", False) and open_dt.time() <= vent_until
                
                plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {}) if day_offset == 0 else {}
                action = "Lüften" if has_vent else "Öffnen"
                
                if day_offset == 0 and plan.get("shading_active"):
                    s_time = dt_util.parse_datetime(plan.get("start_time"))
                    if s_time and s_time <= open_dt:
                        target_pos = plan.get("target_position", 0)
                        vent_pos = int(config.get("ventilation_position", 59))
                        if has_vent and vent_pos < target_pos:
                            action = "Lüften"
                        else:
                            action = "Beschattung"
                            
                events.append((open_dt, action))
                
            if close_dt:
                events.append((close_dt, "Schließen"))
                
            if day_offset == 0:
                plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
                if plan.get("shading_active"):
                    s_time = dt_util.parse_datetime(plan.get("start_time"))
                    e_time = dt_util.parse_datetime(plan.get("end_time"))
                    if s_time and (open_dt is None or s_time > open_dt):
                        events.append((s_time, "Beschattung"))
                    if e_time and (close_dt is None or e_time < close_dt):
                        events.append((e_time, "Öffnen"))
                        
        events.sort(key=lambda x: x[0])
        return events

    @property
    def native_value(self):
        events = self._get_events()
        now = dt_util.now()
        future_events = [f"{act} ({dt_util.as_local(dt).strftime('%H:%M')})" for dt, act in events if dt > now]
        if not future_events:
            return "Keine Aktionen"
        return future_events[0]

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        events = self._get_events()
        now = dt_util.now()
        future = [e for e in events if e[0] > now]
        if not future:
            attrs.update({"events_list": []})
            return attrs
        dt, act = future[0]
        
        events_list = [{"action": a, "time": dt_util.as_local(d).strftime("%H:%M"), "is_today": dt_util.as_local(d).date() == dt_util.as_local(now).date()} for d, a in future]
        
        attrs.update({
            "next_action": act,
            "next_time": dt_util.as_local(dt).strftime("%H:%M"),
            "next_datetime": dt.isoformat(),
            "events_list": events_list,
        })
        return attrs

class BlindShadingPredictionTodaySensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_today")
        self._attr_name = "Beschattungs-Prognose (Heute)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_today_{blind_id}"
        self._attr_icon = "mdi:shield-sun"

    @property
    def native_value(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config or not config.get("enable_shading", False):
            return "Deaktiviert"
            
        plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
        if not plan:
            return "Wartet auf Planung..."
            
        if not plan.get("shading_active"):
            return "Inaktiv heute"
            
        pos = plan.get("target_position", 0)
        s_time_str = plan.get("start_time")
        e_time_str = plan.get("end_time")
        if s_time_str and e_time_str:
            s_dt = dt_util.parse_datetime(s_time_str)
            e_dt = dt_util.parse_datetime(e_time_str)
            if s_dt and e_dt:
                return f"Geplant: {pos}% ({dt_util.as_local(s_dt).strftime('%H:%M')} - {dt_util.as_local(e_dt).strftime('%H:%M')})"
        return f"Geplant: {pos}%"

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        plan = self.store.data.get("blinds_daily_plan", {}).get(self._blind_id, {})
        if not plan:
            return attrs
        
        attrs.update({
            "shading_active": plan.get("shading_active"),
            "target_position": plan.get("target_position"),
            "start_time": plan.get("start_time"),
            "end_time": plan.get("end_time"),
            "trigger_temp": plan.get("trigger_temp"),
            "forecast_max_temp": plan.get("today_max"),
            "forecast_peak_intensity": plan.get("max_intensity"),
            "forecast_cloud_coverage": plan.get("avg_cloud")
        })
        return attrs

class BlindShadingPredictionTomorrowSensor(_BlindBaseSensor):
    def __init__(self, hass, store, blinds_manager, blind_id):
        super().__init__(hass, store, blinds_manager, blind_id, "shading_prediction_tomorrow")
        self._attr_name = "Beschattungs-Prognose (Morgen)"
        self._attr_unique_id = f"smarthome_companion_sensor_shading_prediction_tomorrow_{blind_id}"
        self._attr_icon = "mdi:shield-sun-outline"

    def _get_tomorrow_plan(self):
        config = self.store.get_blinds().get(self._blind_id)
        if not config or not config.get("enable_shading", False):
            return None
        tomorrow = dt_util.now().date() + timedelta(days=1)
        return self.blinds_manager._generate_shading_plan(self._blind_id, config, tomorrow)

    @property
    def native_value(self):
        plan = self._get_tomorrow_plan()
        if not plan:
            return "Deaktiviert"
        if not plan.get("shading_active"):
            return "Inaktiv morgen"
            
        pos = plan.get("target_position", 0)
        s_time_str = plan.get("start_time")
        e_time_str = plan.get("end_time")
        if s_time_str and e_time_str:
            s_dt = dt_util.parse_datetime(s_time_str)
            e_dt = dt_util.parse_datetime(e_time_str)
            if s_dt and e_dt:
                return f"Geplant: {pos}% ({dt_util.as_local(s_dt).strftime('%H:%M')} - {dt_util.as_local(e_dt).strftime('%H:%M')})"
        return f"Geplant: {pos}%"

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        plan = self._get_tomorrow_plan()
        if not plan:
            return attrs
            
        attrs.update({
            "shading_active": plan.get("shading_active"),
            "target_position": plan.get("target_position"),
            "start_time": plan.get("start_time"),
            "end_time": plan.get("end_time"),
            "trigger_temp": plan.get("trigger_temp"),
            "forecast_max_temp": plan.get("today_max"),
            "forecast_peak_intensity": plan.get("max_intensity"),
            "forecast_cloud_coverage": plan.get("avg_cloud")
        })
        return attrs

def _clean_zone_id(zone_id: str) -> str:
    """Sanitize zone_id for entity_id and unique_id to only allow [a-z0-9_]."""
    clean = re.sub(r"[^a-zA-Z0-9_]", "", str(zone_id)).lower()
    return clean or "unknown"

class _IrrigationZoneBaseSensor(SensorEntity):
    def __init__(self, hass, store, irrigation_manager, zone_id, sensor_type):
        self.hass = hass
        self.store = store
        self.irrigation_manager = irrigation_manager
        self._zone_id = str(zone_id)
        self._clean_zone_id = _clean_zone_id(zone_id)
        self._sensor_type = sensor_type
        self.entity_id = f"sensor.smarthome_companion_sensor_irr_{sensor_type}_{self._clean_zone_id}"

    def _get_zone(self):
        irrigation_data = self.store.get_irrigation()
        if not irrigation_data or not irrigation_data.get("zones"):
            if self.irrigation_manager and getattr(self.irrigation_manager, "config", None):
                irrigation_data = self.irrigation_manager.config
            else:
                return None
        for z in irrigation_data.get("zones", []):
            zid = str(z.get("id", ""))
            if zid == self._zone_id or _clean_zone_id(zid) == self._clean_zone_id:
                return z
        return None

    @property
    def available(self):
        return self._get_zone() is not None

    @property
    def device_info(self) -> DeviceInfo:
        zone = self._get_zone()
        name = zone.get("name", "Unbekannte Zone") if zone else "Bewässerungszone"
        return build_irrigation_zone_device_info(self.hass, self._clean_zone_id, name)

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_irrigation_updated", self._handle_update
            )
        )
        self.async_write_ha_state()

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

class IrrigationZoneLastWateredSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "last_watered")
        self._attr_name = "Zuletzt bewässert"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_last_watered_{self._clean_zone_id}"
        self._attr_icon = "mdi:water-check"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone or not zone.get("last_watered_at"):
            return "Nie"
        try:
            dt = dt_util.parse_datetime(zone.get("last_watered_at"))
            if dt:
                dt = dt_util.as_local(dt)
                return dt.strftime("%d.%m.%Y %H:%M")
            return "Nie"
        except Exception:
            return "Nie"

    @property
    def extra_state_attributes(self):
        zone = self._get_zone()
        if not zone:
            return {}
        last_watered = zone.get("last_watered_at")
        attrs = {
            "last_watered_at": last_watered,
            "last_skipped_at": zone.get("last_skipped_at"),
            "last_skipped_reason": zone.get("last_skipped_reason"),
        }
        if last_watered:
            try:
                dt = dt_util.parse_datetime(last_watered)
                if dt:
                    dt = dt_util.as_local(dt)
                    now = dt_util.as_local(dt_util.now())
                    attrs["days_ago"] = (now.date() - dt.date()).days
                    attrs["minutes_ago"] = int((now - dt).total_seconds() / 60)
            except Exception:
                pass
        return attrs

class IrrigationZoneNextRunSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "next_planned")
        self._attr_name = "Nächste Bewässerung"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_next_planned_{self._clean_zone_id}"
        self._attr_icon = "mdi:calendar-clock"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone:
            return "Keine"
        
        now = dt_util.now()
        next_dt = (
            self.irrigation_manager.calculate_next_run(zone, now)
            if self.irrigation_manager and hasattr(self.irrigation_manager, "calculate_next_run")
            else None
        )
        if not next_dt:
            return "Keine"
            
        next_local = dt_util.as_local(next_dt)
        today = dt_util.as_local(now).date()
        
        if next_local.date() == today:
            return f"Heute {next_local.strftime('%H:%M')}"
        elif next_local.date() == today + timedelta(days=1):
            return f"Morgen {next_local.strftime('%H:%M')}"
        else:
            return next_local.strftime("%d.%m. %H:%M")

    @property
    def extra_state_attributes(self):
        zone = self._get_zone()
        if not zone:
            return {}
        
        now = dt_util.now()
        next_dt = (
            self.irrigation_manager.calculate_next_run(zone, now)
            if self.irrigation_manager and hasattr(self.irrigation_manager, "calculate_next_run")
            else None
        )
        
        return {
            "next_datetime": next_dt.isoformat() if next_dt else None,
            "last_forecast_temperature": getattr(self.irrigation_manager, "_last_forecast_temperature", None),
            "manual_overrides": zone.get("manual_overrides", ["auto"] * 7),
            "min_rest_days": zone.get("min_rest_days", 2),
        }

class IrrigationZoneStatusSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "status")
        self._attr_name = "Aktueller Status"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_status_{self._clean_zone_id}"
        self._attr_icon = "mdi:information-outline"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return "Unbekannt"
        
        zid = zone.get("id")
        clean_zid = _clean_zone_id(zid) if zid else ""
        running = self.irrigation_manager.running_zones
        if zid in running or clean_zid in running or self._zone_id in running or self._clean_zone_id in running:
            return "Bewässert aktuell"

        if self.irrigation_manager.config.get("winter_mode_active", False):
            return "Winterpause"
            
        heat_active = self.irrigation_manager.is_heat_override_today(zone) if hasattr(self.irrigation_manager, "is_heat_override_today") else False
        if heat_active:
            return "Hitze-Automatik aktiv"
            
        last_skip = zone.get("last_skipped_at")
        last_run = zone.get("last_watered_at")
        
        if last_skip:
            try:
                dt_skip = dt_util.parse_datetime(last_skip)
                dt_run = dt_util.parse_datetime(last_run) if last_run else None
                now = dt_util.now()
                # If zone was watered today, it's not paused!
                if dt_run and dt_util.as_local(dt_run).date() == now.date() and (dt_skip is None or dt_run >= dt_skip):
                    return "Wartet"
                if dt_skip and dt_util.as_local(dt_skip).date() == now.date():
                    if dt_run is None or dt_skip > dt_run:
                        reason = zone.get("last_skipped_reason", "")
                        return f"Pausiert ({reason})" if reason else "Pausiert"
            except Exception:
                pass
                
        return "Wartet"

    @property
    def extra_state_attributes(self):
        zone = self._get_zone()
        if not zone: return {}
        attrs = {}
        running = self.irrigation_manager.running_zones
        run_data = (
            running.get(zone.get("id"))
            or running.get(_clean_zone_id(zone.get("id")))
            or running.get(self._zone_id)
            or running.get(self._clean_zone_id)
        )
        if run_data:
            attrs["is_manual"] = run_data.get("is_manual", False)
            if run_data.get("duration"):
                attrs["duration_minutes"] = run_data["duration"].total_seconds() / 60
            if run_data.get("start_time"):
                attrs["start_time"] = run_data["start_time"].isoformat()
        return attrs

class IrrigationZoneDurationSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "duration")
        zone = self._get_zone()
        if zone and zone.get("soil_sensor_entity_id"):
            self._attr_name = "Maximale Länge"
        else:
            self._attr_name = "Eingestellte Zeit"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_duration_{self._clean_zone_id}"
        self._attr_icon = "mdi:timer-sand"
        self._attr_native_unit_of_measurement = "min"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return 0
        return zone.get("scheduled_duration_minutes", 30)

class IrrigationZoneTargetMoistureSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "target_moisture")
        self._attr_name = "Zielfeuchtigkeit"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_target_moisture_{self._clean_zone_id}"
        self._attr_icon = "mdi:water-percent"
        self._attr_native_unit_of_measurement = "%"

    @property
    def native_value(self):
        zone = self._get_zone()
        if not zone: return 0
        return zone.get("target_moisture_percent", 40.0)

class IrrigationZoneProgressSensor(_IrrigationZoneBaseSensor):
    def __init__(self, hass, store, irrigation_manager, zone_id):
        super().__init__(hass, store, irrigation_manager, zone_id, "progress")
        self._attr_name = "Fortschritt"
        self._attr_unique_id = f"smarthome_companion_sensor_irr_progress_{self._clean_zone_id}"
        self._attr_icon = "mdi:progress-clock"
        self._attr_native_unit_of_measurement = "%"

    @property
    def native_value(self):
        if not self.irrigation_manager:
            return 0
            
        running = self.irrigation_manager.running_zones
        data = (
            running.get(self._zone_id)
            or running.get(self._clean_zone_id)
        )
        if not data:
            return 0
            
        start_time = data.get("start_time")
        duration = data.get("duration")
        
        if not start_time or not duration or duration.total_seconds() == 0:
            return 0
            
        now = dt_util.now()
        elapsed = (now - start_time).total_seconds()
        total = duration.total_seconds()
        
        progress = (elapsed / total) * 100
        return round(max(0, min(100, progress)))


class PresenceSimulationActiveSensor(SensorEntity):
    def __init__(self, hass, store, simulation_manager):
        self.hass = hass
        self.store = store
        self.simulation_manager = simulation_manager
        self._attr_name = "Anwesenheitssimulation aktiv"
        self._attr_unique_id = "smarthome_companion_presence_simulation_active"
        self.entity_id = "sensor.smarthome_companion_presence_simulation_active"
        self._attr_icon = "mdi:shield-home"

    @property
    def device_info(self) -> DeviceInfo:
        return build_hub_device_info("hub")

    @property
    def native_value(self):
        if not self.simulation_manager:
            return "Inaktiv"
        return "Aktiv" if self.simulation_manager.is_active else "Inaktiv"

    @property
    def extra_state_attributes(self):
        config = self.store.data.get("simulation", {})
        return {
            "is_active": self.simulation_manager.is_active if self.simulation_manager else False,
            "enabled": config.get("enabled", False),
            "active_triggers": getattr(self.simulation_manager, "active_triggers", []),
            "triggers": config.get("triggers", []),
            "actions_count": len(config.get("actions", [])),
        }

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen(
                "smarthome_companion_simulation_updated", self._handle_update
            )
        )

    @callback
    def _handle_update(self, event):
        self.async_write_ha_state()

