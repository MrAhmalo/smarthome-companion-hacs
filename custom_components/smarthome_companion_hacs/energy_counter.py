"""Persistent monotonic Delta Energy Engine & RestoreSensor base class.

Shared across both Hybrid Multi-Protocol Energy Masters (single physical load
switching between Zigbee/WLAN/Matter sources) and Group Master Energy
Aggregators (summing deltas across multiple physical member loads).

All internal math uses exact integer micro-kWh (`mWh` = 10^-6 kWh) to
eliminate IEEE-754 floating-point drift and ensure strictly monotonic
`TOTAL_INCREASING` behavior across protocol switches, reconnect glitches,
unit changes, temporary `unavailable` dropouts, resets to 0, and sentinel
outliers (`0xFFFFFFFF`).
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

import types
try:
    # pyrefly: ignore [missing-import]
    import homeassistant.components.sensor as _ha_sensor
except ImportError:  # pragma: no cover - lightweight unit test stub fallback
    _ha_sensor = types.SimpleNamespace(SensorEntity=object)
# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
SensorEntity = getattr(_ha_sensor, "SensorEntity", object)
RestoreSensor = getattr(_ha_sensor, "RestoreSensor", SensorEntity)
SensorDeviceClass = getattr(_ha_sensor, "SensorDeviceClass", types.SimpleNamespace(ENERGY="energy"))
SensorStateClass = getattr(_ha_sensor, "SensorStateClass", types.SimpleNamespace(TOTAL_INCREASING="total_increasing", MEASUREMENT="measurement"))
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
UnitOfEnergy = getattr(_ha_const, "UnitOfEnergy", types.SimpleNamespace(KILO_WATT_HOUR="kWh", WATT_HOUR="Wh"))
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
import homeassistant.helpers.event as _ha_event
async_track_time_interval = getattr(_ha_event, "async_track_time_interval", lambda *a, **kw: (lambda: None))

try:
    # pyrefly: ignore [missing-import]
    from homeassistant.helpers.restore_state import ExtraStoredData
except ImportError:  # pragma: no cover - lightweight unit test fallback
    class ExtraStoredData:  # type: ignore[no-redef]
        def as_dict(self) -> dict[str, Any]:
            return {}

_LOGGER = logging.getLogger(__name__)

# Integer conversion factors to micro-kWh (`1 mWh = 10^-6 kWh`, `1 Wh = 1000 mWh`)
_ENERGY_UNIT_TO_MWH: dict[str, float] = {
    "mwh": 1.0,
    "wh": 1_000.0,
    "kwh": 1_000_000.0,
    "mwh_mega": 1_000_000_000.0,
    "gwh": 1_000_000_000_000.0,
    "j": 1.0 / 3.6,
    "kj": 1_000.0 / 3.6,
    "mj": 1_000_000.0 / 3.6,
}

# Preserve exact case for SI prefix distinction (`mWh` vs `MWh`)
_CASE_SENSITIVE_UNIT_TO_MWH: dict[str, float] = {
    "mWh": 1.0,
    "Wh": 1_000.0,
    "kWh": 1_000_000.0,
    "MWh": 1_000_000_000.0,
    "GWh": 1_000_000_000_000.0,
    "J": 1.0 / 3.6,
    "kJ": 1_000.0 / 3.6,
    "MJ": 1_000_000.0 / 3.6,
}


def normalize_energy_to_mwh(raw_value: Any, unit: str | None) -> int | None:
    """Convert a raw energy reading to integer micro-kWh (`10^-6 kWh`).

    Returns `None` when value or unit is missing, non-numeric, negative, or
    unrecognized so callers never invent or 1000x-mis-scale deltas during boot.
    """
    if raw_value is None or not unit or not isinstance(unit, str):
        return None
    u_clean = unit.strip()
    factor = _CASE_SENSITIVE_UNIT_TO_MWH.get(u_clean)
    if factor is None:
        u_lower = u_clean.lower()
        if u_lower in ("wh", "kwh", "gwh", "j", "kj", "mj"):
            factor = _ENERGY_UNIT_TO_MWH.get(u_lower)
    if factor is None:
        return None
    try:
        val = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(val) or val < 0.0:
        return None
    return round(val * factor)


def mwh_to_unit(mwh: int, target_unit: str | None = UnitOfEnergy.KILO_WATT_HOUR) -> float:
    """Convert integer micro-kWh (`mWh`) cleanly into `kWh` or `Wh`."""
    if target_unit == UnitOfEnergy.WATT_HOUR or str(target_unit).strip() == "Wh":
        return round(mwh / 1_000.0, 2)
    return round(mwh / 1_000_000.0, 4)


class PersistentDeltaEnergyEngine:
    """Pure, monotonic delta-accumulation engine for hybrid & group energy."""

    def __init__(
        self,
        *,
        mode: str = "hybrid",
        max_kw: float | None = None,
        jitter_mwh: int = 5_000,
        reset_confirm_s: float = 60.0,
    ) -> None:
        if mode not in ("hybrid", "group"):
            raise ValueError(f"Unsupported energy engine mode: {mode}")
        self.mode = mode
        self.max_kw = float(max_kw if max_kw is not None else (50.0 if mode == "group" else 25.0))
        self.jitter_mwh = int(jitter_mwh)
        self.reset_confirm_s = float(reset_confirm_s)

        self.initialized: bool = False
        self.cumulative_mwh: int = 0
        self.baselines_mwh: dict[str, int] = {}
        self.last_valid_ts: dict[str, float] = {}
        self.active_source: str | None = None

        # Transient runtime detectors (not persisted across restarts)
        self._needs_reseed: set[str] = set()
        self._pending_reset: dict[str, tuple[int, float, int]] = {}
        self._pending_outlier: dict[str, tuple[int, float, int]] = {}

    def seed_initial(
        self,
        cumulative_mwh: int,
        baselines: dict[str, int] | None = None,
        active_source: str | None = None,
    ) -> None:
        """Initialize cumulative total and baselines (e.g., on retroactive adoption or restore)."""
        self.cumulative_mwh = max(0, int(cumulative_mwh))
        if isinstance(baselines, dict):
            for sid, val in baselines.items():
                if isinstance(val, (int, float)) and val >= 0:
                    self.baselines_mwh[str(sid)] = int(val)
        if active_source is not None:
            self.active_source = str(active_source)
        self.initialized = True

    def mark_source_unavailable(self, source_id: str) -> None:
        """Handle a source going offline/unavailable.

        - In `hybrid` mode: if another transport takes over, require re-seeding
          this source's baseline on return so offline accumulation isn't double-counted.
        - In `group` mode: keep the member's baseline frozen so any energy consumed
          while temporarily offline is recovered cleanly on reconnect.
        """
        sid = str(source_id)
        self._pending_reset.pop(sid, None)
        self._pending_outlier.pop(sid, None)
        if self.mode == "hybrid":
            self._needs_reseed.add(sid)

    def remove_source(self, source_id: str) -> None:
        """Forget baseline for a removed group member or unpaired transport without lowering total."""
        sid = str(source_id)
        self.baselines_mwh.pop(sid, None)
        self.last_valid_ts.pop(sid, None)
        self._needs_reseed.discard(sid)
        self._pending_reset.pop(sid, None)
        self._pending_outlier.pop(sid, None)
        if self.active_source == sid:
            self.active_source = None

    def set_active_source(
        self,
        source_id: str | None,
        current_raw_mwh: int | None = None,
        now: float | None = None,
    ) -> None:
        """Switch active transport (hybrid mode) without introducing any jump."""
        if self.mode != "hybrid":
            return
        sid = str(source_id) if source_id else None
        if sid == self.active_source:
            return
        self.active_source = sid
        if sid and current_raw_mwh is not None and current_raw_mwh >= 0:
            if sid not in self.baselines_mwh or sid in self._needs_reseed:
                self.baselines_mwh[sid] = int(current_raw_mwh)
                self.last_valid_ts[sid] = float(now if now is not None else time.monotonic())
                self._needs_reseed.discard(sid)
                self._pending_reset.pop(sid, None)
                self._pending_outlier.pop(sid, None)
                self.initialized = True

    def process_reading(
        self,
        source_id: str,
        raw_mwh: int,
        now: float | None = None,
        *,
        is_active: bool = True,
    ) -> int:
        """Process a validated integer-mWh reading for `source_id`.

        Returns the added positive delta in `mWh` (`0` if baseline initialization,
        shadow update, jitter, pending reset, or rejected outlier).
        """
        sid = str(source_id)
        ts = float(now if now is not None else time.monotonic())
        raw = int(raw_mwh)
        if raw < 0:
            return 0

        # Hybrid mode shadow-update for non-active transport (or reconnecting source):
        # keep baseline synchronized with physical meter without adding to master total.
        if self.mode == "hybrid" and not is_active:
            self.baselines_mwh[sid] = raw
            self.last_valid_ts[sid] = ts
            self._needs_reseed.discard(sid)
            self._pending_reset.pop(sid, None)
            self._pending_outlier.pop(sid, None)
            if not self.initialized and self.active_source in (None, sid):
                self.initialized = True
            return 0

        # First ever reading or re-seed after reconnect: establish baseline ONLY (delta = 0)
        if sid not in self.baselines_mwh or sid in self._needs_reseed:
            self.baselines_mwh[sid] = raw
            self.last_valid_ts[sid] = ts
            self._needs_reseed.discard(sid)
            self._pending_reset.pop(sid, None)
            self._pending_outlier.pop(sid, None)
            self.initialized = True
            return 0

        baseline = self.baselines_mwh[sid]

        # Case 1: Unchanged
        if raw == baseline:
            self._pending_reset.pop(sid, None)
            self._pending_outlier.pop(sid, None)
            self.last_valid_ts[sid] = ts
            self.initialized = True
            return 0

        # Case 2: Small negative rounding jitter (<= 0.005 kWh by default) -> preserve high-water mark
        if 0 < (baseline - raw) <= self.jitter_mwh:
            return 0

        # Case 3: Genuine drop below baseline -> Two-stage Reset Detector
        if raw < baseline - self.jitter_mwh:
            self._pending_outlier.pop(sid, None)
            pending = self._pending_reset.get(sid)
            if pending is None:
                # Stage 1: hold baseline, ignore single glitch (e.g. 0.0 on Zigbee reconnect)
                self._pending_reset[sid] = (raw, ts, 1)
                return 0
            p_raw, p_ts, p_cnt = pending
            confirmed_counting_up = raw > p_raw
            confirmed_sustained = (p_cnt + 1 >= 2) and ((ts - p_ts) >= self.reset_confirm_s)
            if confirmed_counting_up or confirmed_sustained:
                # Stage 2: Confirmed hardware meter reset -> count only increase since p_raw
                delta = max(0, raw - p_raw)
                dt_h = max((ts - p_ts) / 3600.0, 1.0 / 3600.0)
                max_delta = max(500_000, int(self.max_kw * 1_000_000 * dt_h))
                self._pending_reset.pop(sid, None)
                self.baselines_mwh[sid] = raw
                self.last_valid_ts[sid] = ts
                if delta <= max_delta:
                    self.cumulative_mwh += delta
                    self.initialized = True
                    return delta
                return 0
            # Update pending lowest seen level and keep waiting
            self._pending_reset[sid] = (min(p_raw, raw), p_ts, p_cnt + 1)
            return 0

        # Case 4: Positive increase (`raw > baseline`) + Time-aware Outlier Guard
        self._pending_reset.pop(sid, None)
        delta = raw - baseline
        prev_ts = self.last_valid_ts.get(sid, ts)
        dt_h = max((ts - prev_ts) / 3600.0, 1.0 / 3600.0)
        max_delta = max(500_000, int(self.max_kw * 1_000_000 * dt_h))

        if delta > max_delta:
            # Outlier / sentinel spike (e.g. 0xFFFFFFFF): DO NOT accept delta or overwrite baseline
            # unless 3 consecutive readings over >= 60s confirm the meter genuinely sits at this level.
            out = self._pending_outlier.get(sid)
            if out is None:
                self._pending_outlier[sid] = (raw, ts, 1)
                return 0
            o_raw, o_ts, o_cnt = out
            if abs(raw - o_raw) <= 100_000:
                new_cnt = o_cnt + 1
                if new_cnt >= 3 and (ts - o_ts) >= 60.0:
                    self._pending_outlier.pop(sid, None)
                    self.baselines_mwh[sid] = raw
                    self.last_valid_ts[sid] = ts
                else:
                    self._pending_outlier[sid] = (raw, o_ts, new_cnt)
            else:
                self._pending_outlier[sid] = (raw, ts, 1)
            return 0

        self._pending_outlier.pop(sid, None)
        self.cumulative_mwh += delta
        self.baselines_mwh[sid] = raw
        self.last_valid_ts[sid] = ts
        self.initialized = True
        return delta

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "initialized": self.initialized,
            "cumulative_mwh": int(self.cumulative_mwh),
            "baselines_mwh": {str(k): int(v) for k, v in self.baselines_mwh.items()},
            "last_valid_ts": {str(k): float(v) for k, v in self.last_valid_ts.items()},
            "active_source": self.active_source,
        }

    def load_dict(self, data: dict[str, Any] | None) -> bool:
        if not isinstance(data, dict):
            return False
        if "cumulative_mwh" not in data:
            return False
        try:
            self.cumulative_mwh = max(0, int(data.get("cumulative_mwh", 0)))
        except (TypeError, ValueError):
            return False
        raw_baselines = data.get("baselines_mwh")
        if isinstance(raw_baselines, dict):
            self.baselines_mwh = {
                str(k): int(v)
                for k, v in raw_baselines.items()
                if isinstance(v, (int, float)) and v >= 0
            }
        raw_ts = data.get("last_valid_ts")
        if isinstance(raw_ts, dict):
            now_mono = time.monotonic()
            # Re-anchor monotonic timestamps cleanly relative to current loop time
            self.last_valid_ts = {str(k): now_mono for k in raw_ts}
        if isinstance(data.get("active_source"), str):
            self.active_source = data["active_source"]
        self.initialized = bool(data.get("initialized", True))
        return True


class DeltaEnergyExtraData(ExtraStoredData):
    """Serializable ExtraStoredData snapshot for HA's restore_state store."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = dict(payload)

    def as_dict(self) -> dict[str, Any]:
        return dict(self._payload)

    @classmethod
    def from_dict(cls, restored: dict[str, Any]) -> "DeltaEnergyExtraData | None":
        if not isinstance(restored, dict) or "cumulative_mwh" not in restored:
            return None
        return cls(restored)


class CompanionDeltaEnergySensor(RestoreSensor):
    """Shared HA RestoreSensor backed by `PersistentDeltaEnergyEngine`."""

    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(
        self,
        *,
        mode: str,
        native_unit: str = UnitOfEnergy.KILO_WATT_HOUR,
        max_kw: float | None = None,
        initial_cumulative_mwh: int | None = None,
        initial_baselines: dict[str, int] | None = None,
        write_coalesce_s: float = 2.0,
    ) -> None:
        self._engine = PersistentDeltaEnergyEngine(mode=mode, max_kw=max_kw)
        if initial_cumulative_mwh is not None:
            self._engine.seed_initial(initial_cumulative_mwh, initial_baselines)
        self._attr_native_unit_of_measurement = (
            UnitOfEnergy.WATT_HOUR
            if str(native_unit).strip() == "Wh"
            else UnitOfEnergy.KILO_WATT_HOUR
        )
        self._write_coalesce_s = float(write_coalesce_s)
        self._dirty_write = False
        self._last_write_ts = 0.0
        self._coalesce_handle = None
        self._added = False

    @property
    def native_value(self) -> float | None:
        if not self._engine.initialized:
            return None
        return mwh_to_unit(self._engine.cumulative_mwh, self._attr_native_unit_of_measurement)

    @property
    def extra_restore_state_data(self) -> ExtraStoredData | None:
        if not self._engine.initialized:
            return None
        return DeltaEnergyExtraData(self._engine.to_dict())

    async def _restore_delta_state(self) -> None:
        extra = await self.async_get_last_extra_data()
        if extra is not None and self._engine.load_dict(extra.as_dict()):
            return
        last_sensor = await self.async_get_last_sensor_data()
        if last_sensor and last_sensor.native_value is not None:
            unit = last_sensor.native_unit_of_measurement or self._attr_native_unit_of_measurement
            mwh = normalize_energy_to_mwh(last_sensor.native_value, unit)
            if mwh is not None and (not self._engine.initialized or mwh > self._engine.cumulative_mwh):
                self._engine.seed_initial(mwh)
                return
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in (None, STATE_UNAVAILABLE, STATE_UNKNOWN):
            unit = last_state.attributes.get("unit_of_measurement") or self._attr_native_unit_of_measurement
            mwh = normalize_energy_to_mwh(last_state.state, unit)
            if mwh is not None and (not self._engine.initialized or mwh > self._engine.cumulative_mwh):
                self._engine.seed_initial(mwh)

    @callback
    def _schedule_coalesced_write(self, force: bool = False) -> None:
        if not self._added or not self.hass or not self.entity_id or self.platform is None:
            return
        now = time.monotonic()
        if force or self._write_coalesce_s <= 0 or (now - self._last_write_ts) >= self._write_coalesce_s:
            if self._coalesce_handle is not None:
                self._coalesce_handle.cancel()
                self._coalesce_handle = None
            self._dirty_write = False
            self._last_write_ts = now
            self.async_write_ha_state()
            return

        self._dirty_write = True
        if self._coalesce_handle is None and hasattr(self.hass, "loop"):
            delay = max(0.05, self._write_coalesce_s - (now - self._last_write_ts))

            @callback
            def _flush():
                self._coalesce_handle = None
                if self._dirty_write and self._added and self.hass and self.entity_id and self.platform is not None:
                    self._dirty_write = False
                    self._last_write_ts = time.monotonic()
                    self.async_write_ha_state()

            self._coalesce_handle = self.hass.loop.call_later(delay, _flush)

    async def async_will_remove_from_hass(self) -> None:
        self._added = False
        if self._coalesce_handle is not None:
            self._coalesce_handle.cancel()
            self._coalesce_handle = None
