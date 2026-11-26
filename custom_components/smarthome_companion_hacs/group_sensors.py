"""Group Master Sensor & Binary-Sensor Aggregation Engine + HA Entities.

Resolves leaf devices/channels for every Companion group (preventing sub-group
double counting and hidden hybrid duplicate counting), normalizes units before
combining, tolerates partial member outages cleanly, and applies exact domain /
device_class aggregation rules:
- SUM: power (W), current (A), volume (L), water (L), gas (m³), volume_flow_rate (L/min)
- DELTA SUM: energy (kWh) via PersistentDeltaEnergyEngine (mode='group')
- AVERAGE: temperature, humidity, illuminance, voltage, pressure, carbon_dioxide, aqi, pm25, pm10, voc
- MINIMUM: battery (%) with lowest member metadata
- LOGICAL OR: binary_sensor classes (motion, smoke, moisture, door, window, opening, problem, ...)
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

import types
try:
    # pyrefly: ignore [missing-import]
    import homeassistant.components.binary_sensor as _ha_bin
except ImportError:  # pragma: no cover
    _ha_bin = types.SimpleNamespace()
try:
    # pyrefly: ignore [missing-import]
    import homeassistant.components.sensor as _ha_sensor
except ImportError:  # pragma: no cover
    _ha_sensor = types.SimpleNamespace(SensorEntity=object)
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
BinarySensorDeviceClass = getattr(_ha_bin, "BinarySensorDeviceClass", types.SimpleNamespace())
SensorEntity = getattr(_ha_sensor, "SensorEntity", object)
SensorDeviceClass = getattr(_ha_sensor, "SensorDeviceClass", types.SimpleNamespace(
    POWER="power", ENERGY="energy", CURRENT="current", VOLUME="volume", WATER="water", GAS="gas",
    VOLUME_FLOW_RATE="volume_flow_rate", TEMPERATURE="temperature", HUMIDITY="humidity",
    ILLUMINANCE="illuminance", VOLTAGE="voltage", PRESSURE="pressure", CO2="carbon_dioxide",
    AQI="aqi", PM25="pm25", PM10="pm10", BATTERY="battery",
))
SensorStateClass = getattr(_ha_sensor, "SensorStateClass", types.SimpleNamespace(MEASUREMENT="measurement", TOTAL_INCREASING="total_increasing"))
STATE_ON = getattr(_ha_const, "STATE_ON", "on")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
UnitOfEnergy = getattr(_ha_const, "UnitOfEnergy", types.SimpleNamespace(KILO_WATT_HOUR="kWh", WATT_HOUR="Wh"))
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers import device_registry as dr, entity_registry as er
# pyrefly: ignore [missing-import]
from homeassistant.helpers.entity import DeviceInfo
# pyrefly: ignore [missing-import]
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .device_helpers import build_group_device_info
from .energy_counter import CompanionDeltaEnergySensor, normalize_energy_to_mwh

_LOGGER = logging.getLogger(__name__)

# (domain, device_class) -> (mode, canonical_unit, display_suffix, state_class, ha_device_class, icon)
GROUP_SENSOR_SPECS: dict[str, dict[str, Any]] = {
    "power": {
        "mode": "sum",
        "unit": "W",
        "label": "Leistung",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.POWER,
        "icon": "mdi:flash",
        "precision": 1,
    },
    "energy": {
        "mode": "delta_sum",
        "unit": UnitOfEnergy.KILO_WATT_HOUR,
        "label": "Energie",
        "state_class": SensorStateClass.TOTAL_INCREASING,
        "device_class": SensorDeviceClass.ENERGY,
        "icon": "mdi:lightning-bolt",
        "precision": 4,
    },
    "current": {
        "mode": "sum",
        "unit": "A",
        "label": "Stromstärke",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.CURRENT,
        "icon": "mdi:current-ac",
        "precision": 2,
    },
    "volume": {
        "mode": "sum",
        "unit": "L",
        "label": "Volumen",
        "state_class": SensorStateClass.TOTAL_INCREASING,
        "device_class": getattr(SensorDeviceClass, "VOLUME", "volume"),
        "icon": "mdi:cup-water",
        "precision": 2,
    },
    "water": {
        "mode": "sum",
        "unit": "L",
        "label": "Wasser",
        "state_class": SensorStateClass.TOTAL_INCREASING,
        "device_class": getattr(SensorDeviceClass, "WATER", "water"),
        "icon": "mdi:water",
        "precision": 2,
    },
    "gas": {
        "mode": "sum",
        "unit": "m³",
        "label": "Gas",
        "state_class": SensorStateClass.TOTAL_INCREASING,
        "device_class": getattr(SensorDeviceClass, "GAS", "gas"),
        "icon": "mdi:meter-gas",
        "precision": 3,
    },
    "volume_flow_rate": {
        "mode": "sum",
        "unit": "L/min",
        "label": "Durchfluss",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "VOLUME_FLOW_RATE", "volume_flow_rate"),
        "icon": "mdi:water-pump",
        "precision": 2,
    },
    "temperature": {
        "mode": "avg",
        "unit": "°C",
        "label": "Temperatur",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.TEMPERATURE,
        "icon": "mdi:thermometer",
        "precision": 1,
    },
    "humidity": {
        "mode": "avg",
        "unit": "%",
        "label": "Luftfeuchtigkeit",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.HUMIDITY,
        "icon": "mdi:water-percent",
        "precision": 1,
    },
    "illuminance": {
        "mode": "avg",
        "unit": "lx",
        "label": "Helligkeit",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.ILLUMINANCE,
        "icon": "mdi:brightness-6",
        "precision": 0,
    },
    "voltage": {
        "mode": "avg",
        "unit": "V",
        "label": "Spannung",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.VOLTAGE,
        "icon": "mdi:sine-wave",
        "precision": 1,
    },
    "pressure": {
        "mode": "avg",
        "unit": "hPa",
        "label": "Luftdruck",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.PRESSURE,
        "icon": "mdi:gauge",
        "precision": 1,
    },
    "atmospheric_pressure": {
        "mode": "avg",
        "unit": "hPa",
        "label": "Luftdruck",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "ATMOSPHERIC_PRESSURE", SensorDeviceClass.PRESSURE),
        "icon": "mdi:gauge",
        "precision": 1,
    },
    "carbon_dioxide": {
        "mode": "avg",
        "unit": "ppm",
        "label": "CO₂",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.CO2,
        "icon": "mdi:molecule-co2",
        "precision": 0,
    },
    "aqi": {
        "mode": "avg",
        "unit": None,
        "label": "Luftqualität (AQI)",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "AQI", "aqi"),
        "icon": "mdi:air-filter",
        "precision": 0,
    },
    "pm25": {
        "mode": "avg",
        "unit": "µg/m³",
        "label": "Feinstaub PM2.5",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "PM25", "pm25"),
        "icon": "mdi:blur",
        "precision": 1,
    },
    "pm10": {
        "mode": "avg",
        "unit": "µg/m³",
        "label": "Feinstaub PM10",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "PM10", "pm10"),
        "icon": "mdi:blur",
        "precision": 1,
    },
    "volatile_organic_compounds": {
        "mode": "avg",
        "unit": "µg/m³",
        "label": "VOC",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "VOLATILE_ORGANIC_COMPOUNDS", "volatile_organic_compounds"),
        "icon": "mdi:chemical-weapon",
        "precision": 0,
    },
    "volatile_organic_compounds_parts": {
        "mode": "avg",
        "unit": "ppb",
        "label": "VOC",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": getattr(SensorDeviceClass, "VOLATILE_ORGANIC_COMPOUNDS_PARTS", "volatile_organic_compounds_parts"),
        "icon": "mdi:chemical-weapon",
        "precision": 0,
    },
    "battery": {
        "mode": "min",
        "unit": "%",
        "label": "Batterie",
        "state_class": SensorStateClass.MEASUREMENT,
        "device_class": SensorDeviceClass.BATTERY,
        "icon": "mdi:battery",
        "precision": 0,
    },
}

GROUP_BINARY_CLASSES: dict[str, tuple[str, Any]] = {
    "motion": ("Bewegung", getattr(BinarySensorDeviceClass, "MOTION", "motion")),
    "occupancy": ("Belegung", getattr(BinarySensorDeviceClass, "OCCUPANCY", "occupancy")),
    "presence": ("Anwesenheit", getattr(BinarySensorDeviceClass, "PRESENCE", "presence")),
    "smoke": ("Rauch", getattr(BinarySensorDeviceClass, "SMOKE", "smoke")),
    "moisture": ("Feuchtigkeit / Wasser", getattr(BinarySensorDeviceClass, "MOISTURE", "moisture")),
    "door": ("Tür", getattr(BinarySensorDeviceClass, "DOOR", "door")),
    "window": ("Fenster", getattr(BinarySensorDeviceClass, "WINDOW", "window")),
    "opening": ("Öffnung", getattr(BinarySensorDeviceClass, "OPENING", "opening")),
    "garage_door": ("Garagentor", getattr(BinarySensorDeviceClass, "GARAGE_DOOR", "garage_door")),
    "problem": ("Störung", getattr(BinarySensorDeviceClass, "PROBLEM", "problem")),
    "tamper": ("Manipulation", getattr(BinarySensorDeviceClass, "TAMPER", "tamper")),
    "safety": ("Sicherheit", getattr(BinarySensorDeviceClass, "SAFETY", "safety")),
    "gas": ("Gas", getattr(BinarySensorDeviceClass, "GAS", "gas")),
    "heat": ("Hitze", getattr(BinarySensorDeviceClass, "HEAT", "heat")),
    "vibration": ("Vibration", getattr(BinarySensorDeviceClass, "VIBRATION", "vibration")),
}


def normalize_numeric_for_class(raw_value: Any, unit: str | None, dc: str, *, target_temp_unit: str = "°C") -> float | None:
    """Convert raw numeric state to canonical unit for `dc`."""
    try:
        val = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(val):
        return None

    u = str(unit or "").strip()
    u_low = u.lower()

    if dc == "power":
        if u_low == "kw":
            return val * 1000.0
        if u_low == "mw":
            return val * 0.001
        return val
    if dc == "current":
        if u_low == "ma":
            return val * 0.001
        return val
    if dc == "voltage":
        if u_low == "mv":
            return val * 0.001
        if u_low == "kv":
            return val * 1000.0
        return val
    if dc in ("volume", "water"):
        if u_low in ("m³", "m3"):
            return val * 1000.0
        if u_low in ("ml",):
            return val * 0.001
        return val
    if dc == "gas":
        if u_low in ("l", "liter"):
            return val * 0.001
        return val
    if dc == "volume_flow_rate":
        if u_low in ("m³/h", "m3/h"):
            return (val * 1000.0) / 60.0
        if u_low in ("l/h",):
            return val / 60.0
        return val
    if dc == "temperature":
        temp_c = val
        if u in ("°F", "F"):
            temp_c = (val - 32.0) * (5.0 / 9.0)
        elif u == "K":
            temp_c = val - 273.15
        if target_temp_unit in ("°F", "F"):
            return (temp_c * 9.0 / 5.0) + 32.0
        return temp_c
    if dc in ("pressure", "atmospheric_pressure"):
        if u_low == "pa":
            return val / 100.0
        if u_low == "kpa":
            return val * 10.0
        if u_low == "bar":
            return val * 1000.0
        if u_low == "psi":
            return val * 68.9476
        return val
    return val


def _classify_sensor_entry(entry, st) -> tuple[str, str] | None:
    """Return `(domain, device_class_key)` if `entry` is a valid aggregatable sensor."""
    if getattr(entry, "disabled_by", None) or getattr(entry, "entity_category", None) in ("config", "diagnostic"):
        return None
    dom = entry.domain
    if dom not in ("sensor", "binary_sensor"):
        return None
    dc = str(
        getattr(entry, "device_class", None)
        or getattr(entry, "original_device_class", None)
        or (st.attributes.get("device_class") if st else None)
        or ""
    ).strip().lower()

    if dom == "binary_sensor":
        if dc in GROUP_BINARY_CLASSES:
            return ("binary_sensor", dc)
        return None

    if dc in GROUP_SENSOR_SPECS:
        return ("sensor", dc)

    # Unit fallback when device_class omitted
    unit = str((st.attributes.get("unit_of_measurement") if st else None) or getattr(entry, "unit_of_measurement", None) or "").strip()
    u_low = unit.lower()
    if u_low in ("w", "kw"):
        return ("sensor", "power")
    if u_low in ("wh", "kwh", "mwh") and unit != "mWh":
        return ("sensor", "energy")
    if unit in ("°C", "°F"):
        return ("sensor", "temperature")
    return None


def resolve_group_leaf_sensors(hass, store, group_id: str) -> dict[tuple[str, str], list[str]]:
    """Resolve leaf `(domain, device_class) -> [entity_id, ...]` across nested groups.

    Rules:
    - Traverses nested subgroups recursively down to leaf devices/channels ONLY
      (never includes subgroup aggregate sensors -> zero double counting).
    - Skips hidden Hybrid underlying `_zigbee`/`_wlan`/`_matter` devices and
      resolves their Hybrid Master device's sensors instead.
    - Respects channel-scoped `d:<dev_id>:<channel_eid>` refs (e.g. Shelly 2PM
      Channel 1 collects ONLY Channel 1's power/energy sensors, not Channel 2's).
    """
    if not hass or not store:
        return {}
    groups = store.get_groups() or {}
    if group_id not in groups:
        return {}

    _raw_hyb = store.get_hybrids() if hasattr(store, "get_hybrids") else {}
    hybrids = _raw_hyb if isinstance(_raw_hyb, dict) else {}
    devices_cfg = store.get_devices() or {}
    _raw_hidden = (
        store.get_hidden_hybrid_ids() if hasattr(store, "get_hidden_hybrid_ids") else (set(), set())
    )
    hidden_dev_ids, hidden_ent_ids = (
        _raw_hidden if isinstance(_raw_hidden, tuple) and len(_raw_hidden) == 2 else (set(), set())
    )

    underlying_dev_to_master: dict[str, str] = {}
    underlying_ent_to_master_dev: dict[str, str] = {}
    for h_cfg in (hybrids or {}).values():
        if not isinstance(h_cfg, dict) or not h_cfg.get("master_device_id"):
            continue
        m_did = h_cfg["master_device_id"]
        for t_info in (h_cfg.get("transports") or {}).values():
            if isinstance(t_info, dict) and t_info.get("device_id"):
                underlying_dev_to_master[t_info["device_id"]] = m_did
        for ch in h_cfg.get("channels") or []:
            if isinstance(ch, dict):
                for src in (ch.get("sources") or {}).values():
                    if isinstance(src, dict) and src.get("entity_id"):
                        underlying_ent_to_master_dev[src["entity_id"]] = m_did

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)

    # Track leaf device IDs and explicit channel-scoped sensor IDs
    leaf_device_ids: list[str] = []
    explicit_sensor_eids: list[str] = []
    # For channel-scoped multi-channel refs we only want THAT channel's sensors (plus device-level env if shared)
    channel_scoped_devs: set[str] = set()
    full_devs: set[str] = set()

    visited = {group_id}

    def _walk(children: list) -> None:
        for ref in children or []:
            if not isinstance(ref, str):
                continue
            if ref in groups and ref not in visited:
                visited.add(ref)
                _walk(groups[ref].get("children", []))
                continue

            if ref.startswith("d:"):
                parts = ref.split(":", 2)
                if len(parts) < 3:
                    continue
                did, ch_eid = parts[1], parts[2]
                if ch_eid in underlying_ent_to_master_dev:
                    did = underlying_ent_to_master_dev[ch_eid]
                elif did in underlying_dev_to_master:
                    did = underlying_dev_to_master[did]
                dev_cfg = devices_cfg.get(did) or {}
                subs = (dev_cfg.get("entities") or {}).get("sub_entities") or {}
                ch_data = subs.get(ch_eid) if isinstance(subs, dict) else None
                if isinstance(ch_data, dict) and len(subs) > 1:
                    channel_scoped_devs.add(did)
                    if ch_data.get("power"):
                        explicit_sensor_eids.append(ch_data["power"])
                    if ch_data.get("energy"):
                        explicit_sensor_eids.append(ch_data["energy"])
                    continue
                full_devs.add(did)
                leaf_device_ids.append(did)
                continue

            if "." in ref:
                if ref in underlying_ent_to_master_dev:
                    m_did = underlying_ent_to_master_dev[ref]
                    full_devs.add(m_did)
                    leaf_device_ids.append(m_did)
                    continue
                if ref in hidden_ent_ids:
                    continue
                ent = ent_reg.async_get(ref)
                if ent and getattr(ent, "platform", None) == DOMAIN and str(getattr(ent, "unique_id", "") or "").startswith("smarthome_companion_group_"):
                    continue
                if ent and getattr(ent, "device_id", None):
                    did = ent.device_id
                    if did in underlying_dev_to_master:
                        did = underlying_dev_to_master[did]
                    full_devs.add(did)
                    leaf_device_ids.append(did)
                else:
                    explicit_sensor_eids.append(ref)
                continue

            # Raw device_id reference
            target_did = underlying_dev_to_master.get(ref, ref)
            if target_did in hidden_dev_ids:
                continue
            if dev_reg.async_get(target_did):
                full_devs.add(target_did)
                leaf_device_ids.append(target_did)

    _walk(groups[group_id].get("children", []))

    buckets: dict[tuple[str, str], list[str]] = {}
    seen_eids: set[str] = set()

    def _add_entry(entry) -> None:
        if not entry or entry.entity_id in seen_eids or entry.entity_id in hidden_ent_ids:
            return
        # Never consume Companion group aggregated sensors recursively
        if getattr(entry, "platform", None) == DOMAIN and str(getattr(entry, "unique_id", "") or "").startswith("smarthome_companion_group_"):
            return
        st = hass.states.get(entry.entity_id)
        cls = _classify_sensor_entry(entry, st)
        if not cls:
            return
        seen_eids.add(entry.entity_id)
        buckets.setdefault(cls, []).append(entry.entity_id)

    for eid in explicit_sensor_eids:
        entry = ent_reg.async_get(eid)
        if entry:
            _add_entry(entry)

    allowed_devs = set(leaf_device_ids) | full_devs
    for entry in ent_reg.entities.values():
        did = getattr(entry, "device_id", None)
        if did and did in allowed_devs:
            # Skip unrequested channel-scoped devices if another explicit channel was already added
            if did in channel_scoped_devs and did not in full_devs:
                continue
            _add_entry(entry)

    return buckets


class CompanionGroupAggregatedSensor(SensorEntity):
    """Dynamic aggregated numeric sensor (SUM / AVG / MIN) for a Companion Group."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass, store, group_id: str, device_class_key: str) -> None:
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._dc = device_class_key
        self._spec = GROUP_SENSOR_SPECS[device_class_key]
        self._member_eids: list[str] = []
        self._unsub = None
        self._added = False
        self._coalesce_handle = None
        self._dirty_write = False
        self._last_write_ts = 0.0

        self._value: float | None = None
        self._lowest_member: dict[str, Any] | None = None
        self._active_count = 0
        self._unavailable_members: list[str] = []

        self._update_meta()

    def _update_meta(self) -> None:
        g = (self._store.get_groups() or {}).get(self._group_id, {})
        self._attr_name = self._spec["label"]
        self._attr_unique_id = f"smarthome_companion_group_sensor_{self._group_id}_{self._dc}"
        self._attr_icon = self._spec["icon"]
        self._attr_device_class = self._spec["device_class"]
        self._attr_state_class = self._spec["state_class"]
        if self._dc == "temperature" and self.hass and hasattr(self.hass, "config"):
            self._attr_native_unit_of_measurement = str(getattr(self.hass.config.units, "temperature_unit", "°C") or "°C")
        else:
            self._attr_native_unit_of_measurement = self._spec["unit"]
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)

    def set_members(self, member_eids: list[str]) -> None:
        new_members = list(dict.fromkeys(member_eids))
        changed = new_members != self._member_eids
        self._member_eids = new_members
        self._update_meta()
        self._recompute()
        if changed and self._added:
            self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self._schedule_coalesced_write(force=True)

    def _recompute(self) -> None:
        target_temp = str(self._attr_native_unit_of_measurement or "°C")
        mode = self._spec["mode"]
        prec = int(self._spec.get("precision", 2))
        vals: list[tuple[str, str, float]] = []
        unavail: list[str] = []

        for eid in self._member_eids:
            st = self.hass.states.get(eid) if self.hass else None
            if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                unavail.append(eid)
                continue
            unit = st.attributes.get("unit_of_measurement")
            num = normalize_numeric_for_class(st.state, unit, self._dc, target_temp_unit=target_temp)
            if num is None:
                unavail.append(eid)
                continue
            fname = str(st.attributes.get("friendly_name") or eid)
            vals.append((eid, fname, num))

        self._active_count = len(vals)
        self._unavailable_members = unavail
        self._lowest_member = None

        if not vals:
            self._value = None
            return

        if mode == "sum":
            total = sum(v[2] for v in vals)
            self._value = round(total, prec) if prec > 0 else round(total)
        elif mode == "avg":
            avg = sum(v[2] for v in vals) / len(vals)
            self._value = round(avg, prec) if prec > 0 else round(avg)
        elif mode == "min":
            lowest = min(vals, key=lambda v: v[2])
            self._value = round(lowest[2], prec) if prec > 0 else round(lowest[2])
            self._lowest_member = {"entity_id": lowest[0], "name": lowest[1], "value": self._value}

    @property
    def available(self) -> bool:
        return self._active_count > 0

    @property
    def native_value(self) -> float | None:
        return self._value

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        attrs: dict[str, Any] = {
            "member_count": len(self._member_eids),
            "active_member_count": self._active_count,
            "unavailable_members": list(self._unavailable_members),
        }
        if self._lowest_member:
            attrs["lowest_battery_entity_id"] = self._lowest_member["entity_id"]
            attrs["lowest_battery_name"] = self._lowest_member["name"]
        return attrs

    async def async_added_to_hass(self) -> None:
        self._added = True
        self._recompute()
        self._rebind_tracking()

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass or not self._member_eids:
            return

        @callback
        def _on_member_change(event) -> None:
            prev_val = self._value
            prev_avail = self.available
            self._recompute()
            if self._value != prev_val or self.available != prev_avail:
                self._schedule_coalesced_write()

        self._unsub = async_track_state_change_event(self.hass, self._member_eids, _on_member_change)

    @callback
    def _schedule_coalesced_write(self, force: bool = False) -> None:
        if not self._added or not self.hass or not self.entity_id or self.platform is None:
            return
        now = time.monotonic()
        if force or (now - self._last_write_ts) >= 0.5:
            if self._coalesce_handle is not None:
                self._coalesce_handle.cancel()
                self._coalesce_handle = None
            self._dirty_write = False
            self._last_write_ts = now
            self.async_write_ha_state()
            return
        self._dirty_write = True
        if self._coalesce_handle is None and hasattr(self.hass, "loop"):
            def _flush():
                self._coalesce_handle = None
                if self._dirty_write and self._added and self.hass and self.entity_id and self.platform is not None:
                    self._dirty_write = False
                    self._last_write_ts = time.monotonic()
                    self.async_write_ha_state()

            self._coalesce_handle = self.hass.loop.call_later(0.5, _flush)

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._unsub:
            self._unsub()
            self._unsub = None
        if self._coalesce_handle is not None:
            self._coalesce_handle.cancel()
            self._coalesce_handle = None


class CompanionGroupEnergySensor(CompanionDeltaEnergySensor):
    """Persistent `TOTAL_INCREASING` delta-sum energy sensor for a Companion Group."""

    def __init__(self, hass, store, group_id: str) -> None:
        super().__init__(mode="group", native_unit=UnitOfEnergy.KILO_WATT_HOUR, max_kw=50.0)
        self.hass = hass
        self._store = store
        self._group_id = group_id
        self._member_eids: list[str] = []
        self._unsub = None
        self._update_meta()

    def _update_meta(self) -> None:
        g = (self._store.get_groups() or {}).get(self._group_id, {})
        self._attr_name = "Energie"
        self._attr_unique_id = f"smarthome_companion_group_sensor_{self._group_id}_energy"
        self._attr_icon = "mdi:lightning-bolt"
        self._attr_device_info = build_group_device_info(self._group_id, g, self._store)

    def set_members(self, member_eids: list[str]) -> None:
        new_members = list(dict.fromkeys(member_eids))
        removed = set(self._member_eids) - set(new_members)
        for r_eid in removed:
            self._engine.remove_source(r_eid)
        changed = new_members != self._member_eids
        self._member_eids = new_members
        self._update_meta()
        # Seed baseline only for newly added members without adding jumps
        self._seed_or_process_members()
        if changed and self._added:
            self._rebind_tracking()
        if self._added and self.hass and self.entity_id and self.platform is not None:
            self._schedule_coalesced_write(force=True)

    def _seed_or_process_members(self) -> None:
        now = time.monotonic()
        for eid in self._member_eids:
            st = self.hass.states.get(eid) if self.hass else None
            if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._engine.mark_source_unavailable(eid)
                continue
            unit = st.attributes.get("unit_of_measurement")
            mwh = normalize_energy_to_mwh(st.state, unit)
            if mwh is not None:
                self._engine.process_reading(eid, mwh, now=now)

    @property
    def available(self) -> bool:
        if self._engine.initialized:
            return True
        return any(
            (st := self.hass.states.get(eid)) is not None
            and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, "")
            for eid in self._member_eids
        ) if self.hass else False

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "member_count": len(self._member_eids),
            "tracked_baselines": len(self._engine.baselines_mwh),
        }

    async def async_added_to_hass(self) -> None:
        self._added = True
        await self._restore_delta_state()
        self._seed_or_process_members()
        self._rebind_tracking()

    def _rebind_tracking(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not self._added or not self.hass or not self._member_eids:
            return

        @callback
        def _on_energy_event(event) -> None:
            eid = event.data.get("entity_id")
            new_st = event.data.get("new_state")
            if not eid or eid not in self._member_eids:
                return
            if new_st is None or new_st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
                self._engine.mark_source_unavailable(eid)
                return
            mwh = normalize_energy_to_mwh(new_st.state, new_st.attributes.get("unit_of_measurement"))
            if mwh is None:
                return
            added = self._engine.process_reading(eid, mwh, now=time.monotonic())
            if added > 0:
                self._schedule_coalesced_write()

        self._unsub = async_track_state_change_event(self.hass, self._member_eids, _on_energy_event)

    async def async_will_remove_from_hass(self) -> None:
        await super().async_will_remove_from_hass()
        if self._unsub:
            self._unsub()
            self._unsub = None


def evaluate_group_binary_or(hass, member_eids: list[str]) -> tuple[bool | None, bool, list[str], list[str]]:
    """Compute logical OR across member binary sensors with partial-failure tolerance.

    Returns `(is_on, available, active_on_members, unavailable_members)`.
    """
    active_on: list[str] = []
    valid_count = 0
    unavail: list[str] = []
    for eid in member_eids:
        st = hass.states.get(eid) if hass else None
        if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
            unavail.append(eid)
            continue
        valid_count += 1
        if st.state == STATE_ON:
            active_on.append(eid)
    if valid_count == 0:
        return (None, False, active_on, unavail)
    return (len(active_on) > 0, True, active_on, unavail)
