"""Hybrid Multi-Protocol Runtime Controller, Event Debouncer & Atomic Lifecycle Manager.

Coordinates:
1. `HybridTransportController`: strict single-transport dispatching, direct
   fallback when preferred transport is `unavailable`/`unknown`, active
   silent-failover after configurable timeout (1.5-2.0s) ONLY when the expected
   state transition did not occur, capability sanitization across protocols,
   and convergence-aware anti-flicker desync protection.
2. `HybridEventDebouncer`: cross-protocol button/click normalization &
   300-500ms deduplication across `event.*`, `zha_event`, `shelly.click`, and
   Matter events (ignoring phantom boot/reload historical timestamps).
3. `HybridManager`: atomic retroactive conversion (`<base>` -> `_wlan`/`_zigbee`
   with `_suppress_internal_rename_event` so existing HA automations keep
   targeting `<base>` uninterrupted), live `entity_id` resolution by immutable
   `unique_id`, and clean unpairing restoring `<base>` back to the surviving
   standalone device.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
import logging
import re
import time
from typing import Any, Callable

# pyrefly: ignore [missing-import]
import homeassistant.const as _ha_const
STATE_OFF = getattr(_ha_const, "STATE_OFF", "off")
STATE_ON = getattr(_ha_const, "STATE_ON", "on")
STATE_UNAVAILABLE = getattr(_ha_const, "STATE_UNAVAILABLE", "unavailable")
STATE_UNKNOWN = getattr(_ha_const, "STATE_UNKNOWN", "unknown")
# pyrefly: ignore [missing-import]
from homeassistant.core import callback
# pyrefly: ignore [missing-import]
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from datetime import timezone
try:
    # pyrefly: ignore [missing-import]
    import homeassistant.util.dt as dt_util
except ImportError:  # pragma: no cover - lightweight unit test stub fallback
    class _FallbackDt:
        @staticmethod
        def utcnow():
            return datetime.now(timezone.utc)

        @staticmethod
        def now():
            return datetime.now(timezone.utc)

        @staticmethod
        def parse_datetime(val: str):
            try:
                return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            except ValueError:
                return None

    dt_util = _FallbackDt()

from .const import DOMAIN
from .device_helpers import get_device_by_identifier_compat
from .energy_counter import normalize_energy_to_mwh
from .entity_sync import (
    PROTOCOL_LABELS,
    _suppress_internal_rename_event,
    replace_entity_ids_in_value,
    slugify_ha,
    sync_device_entity_ids,
    sync_device_friendly_names,
)
from .hybrid_discovery import classify_protocol, make_pair_key
from .util import safe_fire_event

_LOGGER = logging.getLogger(__name__)

CANONICAL_EVENT_TYPES = [
    "single_press",
    "double_press",
    "triple_press",
    "long_press",
    "long_release",
    "button_down",
    "button_up",
    "other",
]

_ACTUATOR_DOMAINS = ("light", "switch", "cover")


def is_state_available(state) -> bool:
    return state is not None and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, "")


def resolve_source_entity_id(hass, src: dict | None) -> str | None:
    """Resolve current HA entity_id for a source dict (`unique_id` first, then `entity_id`)."""
    if not isinstance(src, dict):
        return None
    eid = src.get("entity_id")
    uid = src.get("unique_id")
    if uid and hass:
        try:
            ent_reg = er.async_get(hass)
            dom_hint = eid.split(".", 1)[0] if isinstance(eid, str) and "." in eid else None
            for entry in ent_reg.entities.values():
                if entry.unique_id == uid and (dom_hint is None or entry.domain == dom_hint):
                    if entry.entity_id != eid:
                        src["entity_id"] = entry.entity_id
                    return entry.entity_id
        except Exception:  # noqa: BLE001
            pass
    return eid if isinstance(eid, str) and eid else None


def build_command_predicate(
    domain: str,
    service: str,
    service_data: dict[str, Any],
    start_states: dict[str, Any] | None = None,
) -> Callable[[Any], bool]:
    """Return a progress/completion predicate tolerant of protocol quantization & transitions."""
    svc = str(service).lower()
    if domain == "switch" or svc == "turn_off":
        if svc in ("turn_off", "close_cover"):
            target = "closed" if domain == "cover" else STATE_OFF
            if domain == "cover":
                return lambda st: is_state_available(st) and st.state in ("closing", "closed")
            return lambda st: is_state_available(st) and st.state == target
        if svc == "turn_on":
            if domain == "light":
                return _build_light_on_predicate(service_data)
            return lambda st: is_state_available(st) and st.state == STATE_ON

    if domain == "light":
        if svc == "turn_off":
            return lambda st: is_state_available(st) and st.state == STATE_OFF
        return _build_light_on_predicate(service_data)

    if domain == "cover":
        if svc == "open_cover":
            return lambda st: is_state_available(st) and st.state in ("opening", "open")
        if svc == "close_cover":
            return lambda st: is_state_available(st) and st.state in ("closing", "closed")
        if svc == "stop_cover":
            return lambda st: is_state_available(st) and st.state not in ("opening", "closing")
        if svc == "set_cover_position":
            target_pos = service_data.get("position")
            start_pos = None
            for s in (start_states or {}).values():
                if is_state_available(s) and isinstance(s.attributes.get("current_position"), (int, float)):
                    start_pos = float(s.attributes["current_position"])
                    break

            def _cover_pos_ok(st) -> bool:
                if not is_state_available(st):
                    return False
                if target_pos is None:
                    return True
                cur = st.attributes.get("current_position")
                if isinstance(cur, (int, float)) and abs(float(cur) - float(target_pos)) <= 3:
                    return True
                if start_pos is not None and isinstance(cur, (int, float)):
                    if float(target_pos) > start_pos and (float(cur) > start_pos + 1 or st.state == "opening"):
                        return True
                    if float(target_pos) < start_pos and (float(cur) < start_pos - 1 or st.state == "closing"):
                        return True
                if float(target_pos) >= 95 and st.state in ("opening", "open"):
                    return True
                if float(target_pos) <= 5 and st.state in ("closing", "closed"):
                    return True
                return st.state in ("opening", "closing")

            return _cover_pos_ok

    return lambda st: is_state_available(st)


def _build_light_on_predicate(service_data: dict[str, Any]) -> Callable[[Any], bool]:
    transition = float(service_data.get("transition") or 0.0)
    req_br = service_data.get("brightness")
    req_kelvin = service_data.get("color_temp_kelvin")
    req_rgb = service_data.get("rgb_color")

    def _pred(st) -> bool:
        if not is_state_available(st) or st.state != STATE_ON:
            return False
        if transition > 1.5:
            # Long ramps won't finish in 1.8s; being ON confirms radio reception
            return True
        attrs = st.attributes or {}
        if req_br is not None and isinstance(attrs.get("brightness"), (int, float)):
            if abs(float(attrs["brightness"]) - float(req_br)) > 8:
                return False
        if req_kelvin is not None and isinstance(attrs.get("color_temp_kelvin"), (int, float)):
            if abs(float(attrs["color_temp_kelvin"]) - float(req_kelvin)) > 150:
                return False
        if req_rgb is not None and isinstance(attrs.get("rgb_color"), (list, tuple)) and len(attrs["rgb_color"]) == 3:
            if any(abs(int(attrs["rgb_color"][i]) - int(req_rgb[i])) > 20 for i in range(3)):
                return False
        return True

    return _pred


def sanitize_service_data_for_entity(
    hass,
    domain: str,
    service: str,
    service_data: dict[str, Any],
    target_eid: str,
) -> tuple[str, str, dict[str, Any]]:
    """Adapt service & payload parameters safely to the target entity's real domain & capabilities."""
    target_dom = target_eid.split(".", 1)[0] if "." in target_eid else domain
    clean = dict(service_data or {})
    clean["entity_id"] = target_eid

    # Map light <-> switch cleanly if Shelly device is switch-mode vs Zigbee light-mode
    effective_dom = target_dom
    effective_svc = service
    if domain == "light" and target_dom == "switch":
        effective_dom = "switch"
        effective_svc = "turn_off" if service == "turn_off" else "turn_on"
        return effective_dom, effective_svc, {"entity_id": target_eid}
    if domain == "switch" and target_dom == "light":
        effective_dom = "light"
        effective_svc = "turn_off" if service == "turn_off" else "turn_on"
        return effective_dom, effective_svc, {"entity_id": target_eid}

    st = hass.states.get(target_eid) if hass else None
    attrs = (st.attributes if st else {}) or {}

    if effective_dom == "light" and effective_svc == "turn_on":
        modes = set(attrs.get("supported_color_modes") or ())
        features = int(attrs.get("supported_features") or 0)
        if not (features & 32):  # LightEntityFeature.TRANSITION == 32
            clean.pop("transition", None)
        if not (features & 4):   # LightEntityFeature.EFFECT == 4
            clean.pop("effect", None)

        # Clamp color_temp_kelvin
        if "color_temp_kelvin" in clean:
            if modes and not (modes & {"color_temp"}):
                clean.pop("color_temp_kelvin", None)
            else:
                k = int(clean["color_temp_kelvin"])
                k_min = attrs.get("min_color_temp_kelvin")
                k_max = attrs.get("max_color_temp_kelvin")
                if isinstance(k_min, (int, float)):
                    k = max(int(k_min), k)
                if isinstance(k_max, (int, float)):
                    k = min(int(k_max), k)
                clean["color_temp_kelvin"] = k

        # Brightness check on onoff-only fallback
        if modes == {"onoff"}:
            clean.pop("brightness", None)
            clean.pop("rgb_color", None)
            clean.pop("hs_color", None)
            clean.pop("color_temp_kelvin", None)

        # Convert rgb_color -> hs_color if target only supports hs
        if "rgb_color" in clean and modes and not (modes & {"rgb", "rgbw", "rgbww"}):
            if "hs" in modes:
                try:
                    # pyrefly: ignore [missing-import]
                    import homeassistant.util.color as color_util
                    r, g, b = clean.pop("rgb_color")
                    clean["hs_color"] = color_util.color_RGB_to_hs(r, g, b)
                except Exception:  # noqa: BLE001
                    clean.pop("rgb_color", None)
            else:
                clean.pop("rgb_color", None)

    return effective_dom, effective_svc, clean


class HybridTransportController:
    """Per-channel runtime router with strict single-transport dispatch & anti-flicker guard."""

    def __init__(self, hass, store, hybrid_id: str, channel_key: str) -> None:
        self.hass = hass
        self.store = store
        self.hybrid_id = hybrid_id
        self.channel_key = channel_key

        self.cmd_seq: int = 0
        self.failover_task: asyncio.Task | None = None
        self.guard_timer = None
        self.guard_until: float = 0.0
        self.dispatched_proto: str | None = None
        self.target_predicate: Callable[[Any], bool] | None = None
        self.converged_protos: set[str] = set()
        self.active_proto: str | None = None
        self._failover_confirmed_ev: asyncio.Event | None = None

    def get_protocol_order(self, hybrid_cfg: dict | None = None) -> list[str]:
        cfg = hybrid_cfg or self.store.get_hybrids().get(self.hybrid_id, {})
        settings = self.store.get_hybrid_settings()
        pref = cfg.get("preferred_protocol") or settings.get("preferred_protocol") or "zigbee"
        if pref not in ("zigbee", "wlan", "matter"):
            pref = "zigbee"
        order = [pref]
        for p in settings.get("protocol_priority") or ("zigbee", "matter", "wlan"):
            if p not in order:
                order.append(p)
        for p in ("zigbee", "matter", "wlan"):
            if p not in order:
                order.append(p)
        return order

    def ordered_sources(self, sources_by_proto: dict[str, dict], hybrid_cfg: dict | None = None) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for proto in self.get_protocol_order(hybrid_cfg):
            src = (sources_by_proto or {}).get(proto)
            eid = resolve_source_entity_id(self.hass, src)
            if eid:
                out.append((proto, eid))
        return out

    def select_active_protocol(self, sources_by_proto: dict[str, dict], hybrid_cfg: dict | None = None) -> tuple[str | None, str | None]:
        ordered = self.ordered_sources(sources_by_proto, hybrid_cfg)
        now = time.monotonic()
        # During an active failover/desync guard window, prefer the successfully dispatched protocol if available
        if now < self.guard_until and self.dispatched_proto:
            for proto, eid in ordered:
                if proto == self.dispatched_proto and is_state_available(self.hass.states.get(eid)):
                    self.active_proto = proto
                    return proto, eid
        for proto, eid in ordered:
            if is_state_available(self.hass.states.get(eid)):
                self.active_proto = proto
                return proto, eid
        if ordered:
            # All unavailable: keep preferred order name or None for active_transport
            return None, ordered[0][1]
        return None, None

    def should_accept_state_event(self, proto: str, old_state, new_state, now: float | None = None) -> bool:
        """Convergence-aware anti-flicker filter that still allows immediate physical toggles."""
        ts = float(now if now is not None else time.monotonic())
        pred = self.target_predicate
        matched_target = bool(pred and new_state is not None and pred(new_state))

        if matched_target and self._failover_confirmed_ev is not None:
            self.converged_protos.add(proto)
            self._failover_confirmed_ev.set()

        if ts >= self.guard_until or pred is None:
            return True

        if proto == self.dispatched_proto:
            if matched_target:
                self.converged_protos.add(proto)
                return True
            if proto in self.converged_protos:
                # Already confirmed target, now changed again -> genuine physical toggle!
                self.guard_until = 0.0
                return True
            # Accept dispatched protocol updates while awaiting transition
            return True

        # Non-dispatched secondary protocol update during guard window:
        if matched_target:
            self.converged_protos.add(proto)
            return True
        if proto in self.converged_protos or (old_state is not None and pred(old_state)):
            # Secondary had already reached target and now toggled -> genuine physical toggle!
            self.guard_until = 0.0
            return True
        # Stale pre-command state from a slower un-converged protocol -> suppress flicker
        return False

    def cancel_pending(self) -> None:
        self.cmd_seq += 1
        if self.failover_task and not self.failover_task.done():
            self.failover_task.cancel()
        self.failover_task = None
        if self.guard_timer is not None:
            self.guard_timer.cancel()
            self.guard_timer = None

    async def async_dispatch_command(
        self,
        domain: str,
        service: str,
        service_data: dict[str, Any],
        sources_by_proto: dict[str, dict],
        *,
        hybrid_cfg: dict | None = None,
        on_state_refresh: Callable[[], None] | None = None,
    ) -> str | None:
        """Dispatch command to ONE protocol only, with direct fallback & silent failover watchdog."""
        self.cancel_pending()
        my_seq = self.cmd_seq

        ordered = self.ordered_sources(sources_by_proto, hybrid_cfg)
        if not ordered:
            return None

        settings = self.store.get_hybrid_settings()
        failover_timeout = max(0.3, float(settings.get("failover_timeout_s", 1.8)))
        desync_guard_s = max(failover_timeout, float(settings.get("desync_guard_s", 2.5)))

        start_states = {proto: self.hass.states.get(eid) for proto, eid in ordered}
        expected_pred = build_command_predicate(domain, service, service_data, start_states)

        primary_proto, primary_eid = ordered[0]
        primary_state = start_states.get(primary_proto)

        available_fallbacks = [
            (p, eid) for p, eid in ordered[1:]
            if is_state_available(start_states.get(p))
        ]

        # Case A: Preferred protocol is explicitly unavailable/unknown -> Direct Fallback
        if not is_state_available(primary_state):
            target_pair = available_fallbacks[0] if available_fallbacks else (ordered[1] if len(ordered) > 1 else None)
            if target_pair is None:
                return None
            fb_proto, fb_eid = target_pair
            now = time.monotonic()
            self.dispatched_proto = fb_proto
            self.active_proto = fb_proto
            self.target_predicate = expected_pred
            self.converged_protos = set()
            self.guard_until = now + desync_guard_s
            eff_dom, eff_svc, payload = sanitize_service_data_for_entity(self.hass, domain, service, service_data, fb_eid)
            await self.hass.services.async_call(eff_dom, eff_svc, payload, blocking=True)
            self._schedule_guard_reconcile(desync_guard_s, on_state_refresh)
            if on_state_refresh:
                on_state_refresh()
            return fb_proto

        # Case B: Idempotent no-op command (primary already satisfies target) -> Primary only, NO failover!
        if expected_pred(primary_state):
            self.dispatched_proto = primary_proto
            self.active_proto = primary_proto
            eff_dom, eff_svc, payload = sanitize_service_data_for_entity(self.hass, domain, service, service_data, primary_eid)
            try:
                await asyncio.wait_for(
                    self.hass.services.async_call(eff_dom, eff_svc, payload, blocking=True),
                    timeout=failover_timeout,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Primary idempotent call warning for %s: %s", primary_eid, err)
            return primary_proto

        # Case C: Normal single-transport primary dispatch + Silent-Failover Watchdog
        now = time.monotonic()
        self.dispatched_proto = primary_proto
        self.active_proto = primary_proto
        self.target_predicate = expected_pred
        self.converged_protos = set()
        self.guard_until = now + desync_guard_s
        confirm_ev = asyncio.Event()
        self._failover_confirmed_ev = confirm_ev

        def _any_transport_satisfied() -> bool:
            if self.converged_protos:
                return True
            for p_chk, eid_chk in ordered:
                st_chk = self.hass.states.get(eid_chk)
                if st_chk is not None and expected_pred(st_chk):
                    self.converged_protos.add(p_chk)
                    return True
            return False

        async def _fire_fallback(reason: str) -> str | None:
            if my_seq != self.cmd_seq or _any_transport_satisfied():
                return None
            # Pick best currently available fallback (or first configured fallback)
            fb_choice = next(
                ((p, eid) for p, eid in ordered[1:] if is_state_available(self.hass.states.get(eid))),
                ordered[1] if len(ordered) > 1 else None,
            )
            if fb_choice is None:
                return None
            fb_p, fb_eid = fb_choice
            _LOGGER.warning(
                "Hybrid %s (%s): %s via %s -> failing over to %s (%s)",
                self.hybrid_id,
                self.channel_key,
                reason,
                primary_proto,
                fb_p,
                fb_eid,
            )
            self.dispatched_proto = fb_p
            self.active_proto = fb_p
            self.guard_until = time.monotonic() + desync_guard_s
            f_dom, f_svc, f_payload = sanitize_service_data_for_entity(
                self.hass, domain, service, service_data, fb_eid
            )
            try:
                await self.hass.services.async_call(f_dom, f_svc, f_payload, blocking=True)
            except Exception as fb_err:  # noqa: BLE001
                _LOGGER.error("Hybrid fallback %s failed for %s: %s", fb_p, fb_eid, fb_err)
                return None
            self._schedule_guard_reconcile(desync_guard_s, on_state_refresh)
            if on_state_refresh:
                on_state_refresh()
            return fb_p

        eff_dom, eff_svc, payload = sanitize_service_data_for_entity(
            self.hass, domain, service, service_data, primary_eid
        )
        t_start = time.monotonic()
        primary_threw = False
        try:
            await asyncio.wait_for(
                self.hass.services.async_call(eff_dom, eff_svc, payload, blocking=True),
                timeout=failover_timeout,
            )
        except asyncio.TimeoutError:
            await _fire_fallback("primary RPC timeout")
            return self.dispatched_proto
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Hybrid primary %s call failed immediately: %s", primary_eid, err)
            primary_threw = True

        if my_seq != self.cmd_seq:
            return self.dispatched_proto

        if primary_threw:
            await _fire_fallback("primary RPC error")
            return self.dispatched_proto

        if _any_transport_satisfied():
            self._schedule_guard_reconcile(desync_guard_s, on_state_refresh)
            return primary_proto

        # Primary call returned without exception (common for ZHA/MQTT fire-and-forget);
        # watch in background for remaining timeout window for actual state change.
        remaining = max(0.05, failover_timeout - (time.monotonic() - t_start))

        async def _watchdog() -> None:
            try:
                await asyncio.wait_for(confirm_ev.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                if my_seq == self.cmd_seq and not _any_transport_satisfied():
                    await _fire_fallback("silent timeout (no expected state change)")
            except asyncio.CancelledError:
                return

        self.failover_task = self.hass.async_create_task(_watchdog())
        self._schedule_guard_reconcile(desync_guard_s, on_state_refresh)
        return primary_proto

    def _schedule_guard_reconcile(self, delay_s: float, on_state_refresh: Callable[[], None] | None) -> None:
        if self.guard_timer is not None:
            self.guard_timer.cancel()
            self.guard_timer = None
        if on_state_refresh and hasattr(self.hass, "loop"):
            def _reconcile():
                self.guard_timer = None
                self.guard_until = 0.0
                on_state_refresh()

            self.guard_timer = self.hass.loop.call_later(delay_s, _reconcile)


class HybridEventDebouncer:
    """Cross-protocol event normalizer and deduplicator (prevents double button presses)."""

    def __init__(self, debounce_ms: float = 400.0) -> None:
        self.debounce_s = max(0.05, float(debounce_ms) / 1000.0)
        # Key: (event_key, canonical_action) -> (timestamp, source_protocol)
        self._last_fired: dict[tuple[str, str], tuple[float, str]] = {}

    @staticmethod
    def normalize_action(raw: Any) -> str:
        s = str(raw or "").strip().lower()
        if s in ("single", "single_press", "single_push", "press", "click", "on", "toggle", "short_release"):
            return "single_press"
        if s in ("double", "double_press", "double_push", "double_click"):
            return "double_press"
        if s in ("triple", "triple_press", "triple_push", "triple_click"):
            return "triple_press"
        if s in ("long", "long_press", "long_push", "hold", "start_hold"):
            return "long_press"
        if s in ("long_release", "release", "stop_hold"):
            return "long_release"
        if s in ("btn_down", "button_down", "initial_press", "down"):
            return "button_down"
        if s in ("btn_up", "button_up", "up"):
            return "button_up"
        return "other"

    @staticmethod
    def is_fresh_event_entity_state(old_state, new_state, *, max_age_s: float = 5.0) -> bool:
        """Guard against phantom button presses when HA boots or reloads an integration."""
        if new_state is None or old_state is None:
            return False
        if old_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
            return False
        if new_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None, ""):
            return False
        if new_state.state == old_state.state:
            return False
        parsed = dt_util.parse_datetime(str(new_state.state))
        if parsed is not None:
            now_utc = dt_util.utcnow()
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=now_utc.tzinfo)
            if abs((now_utc - parsed).total_seconds()) > max_age_s:
                return False
        return True

    def should_emit(
        self,
        event_key: str,
        raw_action: Any,
        source_protocol: str,
        now: float | None = None,
    ) -> tuple[bool, str]:
        """Return `(accepted, canonical_action)`, deduping ONLY across different protocols."""
        ts = float(now if now is not None else time.monotonic())
        action = self.normalize_action(raw_action)
        k = (str(event_key), action)
        prev = self._last_fired.get(k)
        if prev is not None:
            prev_ts, prev_proto = prev
            if source_protocol != prev_proto and (ts - prev_ts) <= self.debounce_s:
                return False, action
        self._last_fired[k] = (ts, str(source_protocol))
        return True, action


_SENSOR_LABELS: dict[str, str] = {
    "power": "Leistung",
    "energy": "Energie",
    "temperature": "Temperatur",
    "humidity": "Luftfeuchtigkeit",
    "voltage": "Spannung",
    "current": "Stromstärke",
    "battery": "Batterie",
    "illuminance": "Helligkeit",
    "pressure": "Luftdruck",
    "motion": "Bewegung",
    "occupancy": "Belegung",
    "presence": "Anwesenheit",
    "smoke": "Rauch",
    "moisture": "Feuchtigkeit",
    "door": "Tür",
    "window": "Fenster",
    "opening": "Öffnung",
    "garage_door": "Garagentor",
    "problem": "Störung",
    "tamper": "Manipulation",
    "safety": "Sicherheit",
    "gas": "Gas",
    "heat": "Hitze",
    "vibration": "Vibration",
    "carbon_dioxide": "CO₂",
    "aqi": "Luftqualität",
    "pm25": "Feinstaub PM2.5",
    "pm10": "Feinstaub PM10",
    "volume": "Volumen",
    "water": "Wasser",
    "volume_flow_rate": "Durchfluss",
}

_UTILITY_ACTUATOR_RE = re.compile(
    r"(?:overcharge|protection|kindersicherung|child_?lock|restart|reboot|update|firmware|"
    r"auto_?off|inching|pairing|identify|interlock|relay_mode|power_on_state|eco_?mode|"
    r"cloud|indicator|led_?mode|backlight|status_?led|detach)",
    re.IGNORECASE,
)


def _is_utility_hybrid_actuator(entry) -> bool:
    dom = getattr(entry, "domain", None) or ""
    if dom == "light":
        return False
    eid = str(getattr(entry, "entity_id", "") or "").lower()
    nm = str(getattr(entry, "name", None) or getattr(entry, "original_name", None) or "").lower()
    return bool(_UTILITY_ACTUATOR_RE.search(eid) or _UTILITY_ACTUATOR_RE.search(nm))


def _infer_sensor_role(entry, state) -> tuple[str, str, bool]:
    """Return `(sensor_key, device_class_or_role, is_binary)` for matching across protocols."""
    dom = getattr(entry, "domain", "sensor")
    is_bin = dom == "binary_sensor"
    dc = (
        getattr(entry, "device_class", None)
        or getattr(entry, "original_device_class", None)
        or (state.attributes.get("device_class") if state else None)
        or ""
    )
    dc = str(dc).strip().lower()
    if dc:
        return f"{dom}:{dc}", dc, is_bin
    trans = str(getattr(entry, "translation_key", None) or "").strip().lower()
    if trans:
        return f"{dom}:{trans}", trans, is_bin
    eid_tail = entry.entity_id.split(".", 1)[1].lower()
    for token in ("power", "energy", "voltage", "current", "temperature", "humidity", "battery", "illuminance", "motion", "smoke", "moisture", "rssi", "linkquality"):
        if eid_tail.endswith(f"_{token}") or f"_{token}_" in eid_tail:
            return f"{dom}:{token}", token, is_bin
    return f"{dom}:{eid_tail}", eid_tail, is_bin


class HybridManager:
    """Manages Hybrid pairing, atomic retroactive conversion, controllers & unpairing."""

    def __init__(self, hass, store) -> None:
        self.hass = hass
        self.store = store
        self.controllers: dict[tuple[str, str], HybridTransportController] = {}
        self.debouncers: dict[str, HybridEventDebouncer] = {}
        self._unsubs: list[Callable[[], None]] = []

    def get_controller(self, hybrid_id: str, channel_key: str) -> HybridTransportController:
        key = (str(hybrid_id), str(channel_key))
        ctrl = self.controllers.get(key)
        if ctrl is None:
            ctrl = HybridTransportController(self.hass, self.store, hybrid_id, channel_key)
            self.controllers[key] = ctrl
        return ctrl

    def get_debouncer(self, hybrid_id: str) -> HybridEventDebouncer:
        ms = float(self.store.get_hybrid_settings().get("event_debounce_ms", 400))
        deb = self.debouncers.get(hybrid_id)
        if deb is None or abs(deb.debounce_s - ms / 1000.0) > 0.01:
            deb = HybridEventDebouncer(debounce_ms=ms)
            self.debouncers[hybrid_id] = deb
        return deb

    def clear_hybrid_runtime(self, hybrid_id: str) -> None:
        for key in [k for k in self.controllers if k[0] == hybrid_id]:
            self.controllers.pop(key).cancel_pending()
        self.debouncers.pop(hybrid_id, None)

    async def async_setup(self) -> None:
        @callback
        def _on_hybrids_updated(event=None):
            live_ids = set((self.store.get_hybrids() or {}).keys())
            for hid in list({k[0] for k in self.controllers} - live_ids):
                self.clear_hybrid_runtime(hid)

        self._unsubs.append(self.hass.bus.async_listen(f"{DOMAIN}_hybrids_updated", _on_hybrids_updated))

    def unload(self) -> None:
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                pass
        self._unsubs.clear()
        for ctrl in self.controllers.values():
            ctrl.cancel_pending()
        self.controllers.clear()
        self.debouncers.clear()

    def _hybrids_config_entry(self):
        entries = self.hass.config_entries.async_entries(DOMAIN)
        for pref in ("hybrids", "legacy"):
            for e in entries:
                if e.data.get("module") == pref:
                    return e
        return entries[0] if entries else None

    async def async_convert_to_hybrid(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Create or update a Hybrid Master device atomically without rewriting automations."""
        domain_data = self.hass.data.setdefault(DOMAIN, {})
        sync_lock = domain_data.setdefault("entity_sync_lock", asyncio.Lock())
        hybrid_lock = domain_data.setdefault("hybrid_mutation_lock", asyncio.Lock())

        async with sync_lock:
            async with hybrid_lock:
                return await self._async_convert_locked(payload)

    async def _async_convert_locked(self, payload: dict[str, Any]) -> dict[str, Any]:
        dev_reg = dr.async_get(self.hass)
        ent_reg = er.async_get(self.hass)
        area_reg = ar.async_get(self.hass)

        hybrids = dict(self.store.get_hybrids())
        devices_store = dict(self.store.get_devices())
        groups_store = dict(self.store.get_groups())

        raw_hid = payload.get("hybrid_id") or (payload.get("id") if isinstance(payload.get("id"), str) else None)
        is_edit = bool(raw_hid and raw_hid in hybrids)
        hid = str(raw_hid) if is_edit else f"hybrid_{int(time.time() * 1000)}"

        existing_cfg = hybrids.get(hid, {}) if is_edit else {}
        name = str(payload.get("name") or existing_cfg.get("name") or "Hybrid-Gerät").strip()
        area_id = str(payload.get("area_id") if payload.get("area_id") is not None else (existing_cfg.get("area_id") or "")).strip()
        category = str(payload.get("category") or existing_cfg.get("category") or "schalter").strip()
        custom_icon = payload.get("icon") if "icon" in payload else existing_cfg.get("icon")
        pref_proto = payload.get("preferred_protocol") if "preferred_protocol" in payload else existing_cfg.get("preferred_protocol")
        if pref_proto not in ("zigbee", "wlan", "matter", None, ""):
            pref_proto = None
        pref_proto = pref_proto or None

        raw_transports: dict[str, str] = {}
        for proto, val in (payload.get("transports") or {}).items():
            p_clean = str(proto).strip().lower()
            dev_id = val.get("device_id") if isinstance(val, dict) else val
            if p_clean in PROTOCOL_LABELS and dev_id:
                raw_transports[p_clean] = str(dev_id)

        if not raw_transports and existing_cfg.get("transports"):
            for p, info in existing_cfg["transports"].items():
                if isinstance(info, dict) and info.get("device_id"):
                    raw_transports[p] = str(info["device_id"])

        if len(raw_transports) < 2:
            raise ValueError("Hybrid requires at least 2 distinct protocol devices")

        adopted_dev_id = payload.get("adopted_device_id") or existing_cfg.get("adopted_device_id")
        if not adopted_dev_id:
            # Automatically adopt whichever member was already configured in store.devices
            for proto, did in raw_transports.items():
                if did in devices_store:
                    adopted_dev_id = did
                    break
        adopted_proto = payload.get("adopted_protocol") or existing_cfg.get("adopted_protocol")
        if adopted_dev_id and not adopted_proto:
            for p, did in raw_transports.items():
                if did == adopted_dev_id:
                    adopted_proto = p
                    break

        adopted_prev_cfg = devices_store.get(adopted_dev_id, {}) if adopted_dev_id else {}

        # Gather entities per transport BEFORE mutating registry
        ents_by_proto: dict[str, list] = {}
        dev_entries: dict[str, Any] = {}
        for proto, did in raw_transports.items():
            d_ent = dev_reg.async_get(did)
            if d_ent is None:
                raise ValueError(f"Device not found in HA registry: {did}")
            dev_entries[proto] = d_ent
            ents_by_proto[proto] = [
                e for e in ent_reg.entities.values()
                if getattr(e, "device_id", None) == did
            ]

        # Snapshot original entity IDs & states for rollback and zero-drop adoption
        undo_renames: list[tuple[str, str]] = []  # (new_eid, old_eid)
        created_master_eids: list[str] = []
        created_master_dev_id: str | None = None

        adopted_primary_eid: str | None = None
        adopted_sub_eids: list[str] = []
        adopted_power_eid: str | None = None
        adopted_energy_eid: str | None = None
        adopted_energy_unit = "kWh"
        adopted_energy_mwh: int | None = None

        if adopted_prev_cfg:
            adopted_ents = adopted_prev_cfg.get("entities") or {}
            adopted_primary_eid = adopted_ents.get("primary")
            adopted_power_eid = adopted_ents.get("power")
            adopted_energy_eid = adopted_ents.get("energy")
            if isinstance(adopted_ents.get("sub_entities"), dict):
                adopted_sub_eids = [
                    k for k, v in adopted_ents["sub_entities"].items()
                    if isinstance(v, dict) and v.get("enabled", True)
                ]
        elif adopted_proto and adopted_proto in ents_by_proto:
            act = [e for e in ents_by_proto[adopted_proto] if e.domain in _ACTUATOR_DOMAINS and not e.disabled_by]
            if act:
                adopted_primary_eid = act[0].entity_id

        # Capture current energy reading & unit from adopted sensor (or highest-prio sensor)
        area_entry = area_reg.async_get_area(area_id) if area_id else None
        area_name = (area_entry.name or "").strip() if area_entry else ""
        area_slug = slugify_ha(area_name)
        name_slug = slugify_ha(name)
        base_obj_slug = f"{area_slug}_{name_slug}" if (area_slug and not name_slug.startswith(f"{area_slug}_")) else name_slug
        master_friendly = f"{area_name} {name}".strip() if (area_name and not name.lower().startswith(f"{area_name.lower()} ")) else name

        # Determine adopted base object_ids per channel/sensor so existing automations keep working!
        adopted_channel_base_eids: list[str] = []
        if adopted_sub_eids:
            adopted_channel_base_eids = list(adopted_sub_eids)
        elif adopted_primary_eid:
            adopted_channel_base_eids = [adopted_primary_eid]

        # Track initial state snapshots BEFORE renaming underlying entities
        initial_channel_states: dict[int, Any] = {}
        for idx, base_eid in enumerate(adopted_channel_base_eids):
            st = self.hass.states.get(base_eid)
            if st is not None:
                initial_channel_states[idx] = st

        if adopted_energy_eid:
            est = self.hass.states.get(adopted_energy_eid)
            if est is not None:
                u = est.attributes.get("unit_of_measurement") or "kWh"
                mwh = normalize_energy_to_mwh(est.state, u)
                if mwh is not None:
                    adopted_energy_mwh = mwh
                    adopted_energy_unit = "Wh" if str(u).strip() == "Wh" else "kWh"

        # ── Discover aligned channels, sensors & events BEFORE renaming ──
        # Record unique_ids of every entity so post-rename IDs are exact
        pre_actuators: dict[str, list] = {}
        pre_sensors: dict[str, dict[str, list]] = {}
        pre_events: dict[str, list] = {}
        pre_sensor_states: dict[tuple[str, str], Any] = {}
        for proto, dev_ents in ents_by_proto.items():
            acts = [
                e for e in dev_ents
                if e.domain in _ACTUATOR_DOMAINS
                and not e.disabled_by
                and getattr(e, "entity_category", None) not in ("config", "diagnostic")
                and not _is_utility_hybrid_actuator(e)
            ]
            acts.sort(key=lambda e: e.entity_id)
            pre_actuators[proto] = acts

            s_map: dict[str, list] = {}
            evs = []
            for e in sorted(dev_ents, key=lambda x: x.entity_id):
                if e.disabled_by:
                    continue
                if e.domain == "event":
                    evs.append(e)
                    continue
                if e.domain not in ("sensor", "binary_sensor"):
                    continue
                st = self.hass.states.get(e.entity_id)
                role_key, dc, is_bin = _infer_sensor_role(e, st)
                e_cat = getattr(e, "entity_category", None)
                if e_cat in ("config", "diagnostic") and dc != "battery":
                    continue
                if st is not None:
                    pre_sensor_states[(proto, e.unique_id or e.entity_id)] = st
                s_map.setdefault(role_key, []).append((e, dc, is_bin))
            pre_sensors[proto] = s_map
            pre_events[proto] = evs

        try:
            # ── Step A: Vacate base IDs & rename all underlying devices + sub-entities cleanly ──
            for proto, did in raw_transports.items():
                if area_id:
                    dev_reg.async_update_device(did, area_id=area_id)
                acts = pre_actuators.get(proto, [])
                sub_cfg = {}
                for e in acts:
                    sub_cfg[e.entity_id] = {
                        "enabled": True,
                        "unique_id": e.unique_id,
                        "original_id": e.entity_id,
                        "custom_name": name if len(acts) == 1 else (e.original_name or e.name or name),
                    }
                pseudo_cfg = {
                    "custom_name": name,
                    "entities": {
                        "primary": acts[0].entity_id if acts else None,
                        "primary_unique_id": acts[0].unique_id if acts else None,
                        "sub_entities": sub_cfg,
                    },
                }
                sync_device_friendly_names(self.hass, did, pseudo_cfg, area_id=area_id or None, protocol_suffix=proto)
                renamed = sync_device_entity_ids(self.hass, did, pseudo_cfg, area_id=area_id or None, protocol_suffix=proto)
                for old_id, new_id in renamed.items():
                    undo_renames.append((new_id, old_id))

            # Helper to fetch latest entity_id after Step A by unique_id or renamed lookup
            reverse_rename = {old_k: new_v for new_v, old_k in undo_renames}

            def _latest_eid(entry) -> str:
                if entry.unique_id:
                    for cur_e in ent_reg.entities.values():
                        if cur_e.unique_id == entry.unique_id and cur_e.domain == entry.domain:
                            return cur_e.entity_id
                return reverse_rename.get(entry.entity_id, entry.entity_id)

            # ── Step B: Create Master device & pre-claim exact base entity_ids atomically ──
            hybrids_entry = self._hybrids_config_entry()
            if hybrids_entry is None:
                raise RuntimeError("No SmartHome Companion config entry available")

            master_dev = dev_reg.async_get_or_create(
                config_entry_id=hybrids_entry.entry_id,
                identifiers={(DOMAIN, f"hybrid_{hid}")},
                name=master_friendly,
                manufacturer="SmartHome Companion",
                model=f"Hybrid · {' + '.join(PROTOCOL_LABELS.get(p, p) for p in raw_transports)}",
            )
            if area_id and master_dev.area_id != area_id:
                dev_reg.async_update_device(master_dev.id, area_id=area_id)
            if not is_edit:
                created_master_dev_id = master_dev.id

            def _claim_master_entity(domain: str, unique_id: str, desired_base_eid: str, friendly_suffix: str | None = None) -> str:
                desired_obj = desired_base_eid.split(".", 1)[1] if "." in desired_base_eid else desired_base_eid
                existing_eid = ent_reg.async_get_entity_id(domain, DOMAIN, unique_id)
                if existing_eid:
                    entry = ent_reg.async_get(existing_eid)
                else:
                    entry = ent_reg.async_get_or_create(
                        domain,
                        DOMAIN,
                        unique_id,
                        suggested_object_id=desired_obj,
                        config_entry=hybrids_entry,
                        device_id=master_dev.id,
                    )
                    created_master_eids.append(entry.entity_id)

                target_eid = f"{domain}.{desired_obj}"
                upd: dict[str, Any] = {}
                if entry.device_id != master_dev.id:
                    upd["device_id"] = master_dev.id
                if entry.entity_id != target_eid:
                    coll = ent_reg.async_get(target_eid)
                    if coll is None or coll.unique_id == unique_id:
                        _suppress_internal_rename_event(self.hass, entry.entity_id, target_eid)
                        upd["new_entity_id"] = target_eid
                if friendly_suffix and entry.name != friendly_suffix:
                    upd["name"] = friendly_suffix
                elif not friendly_suffix and entry.name is not None:
                    upd["name"] = None
                if upd:
                    entry = ent_reg.async_update_entity(entry.entity_id, **upd)
                return entry.entity_id

            # Build aligned Master channels
            max_ch = max((len(v) for v in pre_actuators.values()), default=0)
            adopted_sub_map = (adopted_prev_cfg.get("entities") or {}).get("sub_entities") if isinstance(adopted_prev_cfg, dict) else {}
            channels_spec: list[dict[str, Any]] = []
            for idx in range(max_ch):
                sources: dict[str, dict[str, str]] = {}
                ch_domain = None
                ch_label: str | None = None
                for proto, acts in pre_actuators.items():
                    if idx < len(acts):
                        act_ent = acts[idx]
                        cur_eid = _latest_eid(act_ent)
                        sources[proto] = {
                            "entity_id": cur_eid,
                            "unique_id": act_ent.unique_id or "",
                        }
                        if ch_domain is None:
                            ch_domain = "cover" if category == "jalousie" and act_ent.domain == "cover" else (
                                "light" if category == "leuchte" and any(e.domain == "light" for p_list in pre_actuators.values() if idx < len(p_list) for e in [p_list[idx]]) else act_ent.domain
                            )
                        if not ch_label and max_ch > 1:
                            if proto == adopted_proto and isinstance(adopted_sub_map, dict) and act_ent.entity_id in adopted_sub_map:
                                sc = adopted_sub_map[act_ent.entity_id]
                                if isinstance(sc, dict):
                                    ch_label = sc.get("custom_name") or sc.get("name")
                if not sources:
                    continue
                ch_domain = ch_domain or "switch"
                ch_key = "main" if max_ch == 1 else f"ch_{idx + 1}"
                if max_ch > 1 and not ch_label:
                    ch_label = f"Kanal {idx + 1}"
                if idx < len(adopted_channel_base_eids) and adopted_channel_base_eids[idx].split(".")[0] == ch_domain:
                    desired_eid = adopted_channel_base_eids[idx]
                else:
                    desired_eid = f"{ch_domain}.{base_obj_slug}" if max_ch == 1 else f"{ch_domain}.{base_obj_slug}_{idx + 1}"
                m_uid = f"smarthome_companion_hybrid_{hid}_{ch_key}"
                m_eid = _claim_master_entity(
                    ch_domain,
                    m_uid,
                    desired_eid,
                    friendly_suffix=None if max_ch == 1 else ch_label,
                )
                channels_spec.append({
                    "channel_key": ch_key,
                    "name": ch_label,
                    "domain": ch_domain,
                    "master_unique_id": m_uid,
                    "master_entity_id": m_eid,
                    "sources": sources,
                })

            # Build aligned Master sensors & binary_sensors
            all_role_keys: list[str] = []
            for s_map in pre_sensors.values():
                for rk in s_map:
                    if rk not in all_role_keys:
                        all_role_keys.append(rk)

            sensors_spec: list[dict[str, Any]] = []
            master_power_eid = None
            master_energy_eid = None
            room_sensors_store: dict[str, dict[str, Any]] = {}

            for rk in all_role_keys:
                # Pair per index if multiple of same role (rare)
                max_role_cnt = max((len(pre_sensors[p].get(rk, [])) for p in raw_transports), default=0)
                for r_idx in range(max_role_cnt):
                    sources_s: dict[str, dict[str, str]] = {}
                    dom_s = "sensor"
                    dc_s = ""
                    is_bin = False
                    for proto in raw_transports:
                        lst = pre_sensors[proto].get(rk, [])
                        if r_idx < len(lst):
                            s_ent, dc_val, bin_flag = lst[r_idx]
                            dom_s = s_ent.domain
                            dc_s = dc_val
                            is_bin = bin_flag
                            sources_s[proto] = {
                                "entity_id": _latest_eid(s_ent),
                                "unique_id": s_ent.unique_id or "",
                            }
                    if not sources_s:
                        continue
                    s_key = dc_s if max_role_cnt == 1 else f"{dc_s}_{r_idx + 1}"
                    if dc_s == "energy" and r_idx == 0 and adopted_energy_eid and adopted_energy_eid.startswith("sensor."):
                        desired_s_eid = adopted_energy_eid
                    elif dc_s == "power" and r_idx == 0 and adopted_power_eid and adopted_power_eid.startswith("sensor."):
                        desired_s_eid = adopted_power_eid
                    else:
                        desired_s_eid = f"{dom_s}.{base_obj_slug}_{s_key}"
                    m_s_uid = f"smarthome_companion_hybrid_{hid}_{dom_s}_{s_key}"
                    base_s_label = _SENSOR_LABELS.get(dc_s) or dc_s.replace("_", " ").title()
                    s_label = base_s_label if max_role_cnt == 1 else f"{base_s_label} {r_idx + 1}"
                    m_s_eid = _claim_master_entity(dom_s, m_s_uid, desired_s_eid, friendly_suffix=s_label)

                    is_energy = (dom_s == "sensor" and dc_s == "energy")
                    if is_energy and not master_energy_eid:
                        master_energy_eid = m_s_eid
                        if adopted_energy_mwh is None:
                            # Initialize from highest-priority available pre-rename or current energy sensor
                            for src_p, src_d in sources_s.items():
                                st_e = (
                                    self.hass.states.get(src_d["entity_id"])
                                    or pre_sensor_states.get((src_p, src_d.get("unique_id") or src_d["entity_id"]))
                                )
                                if st_e is not None:
                                    u = st_e.attributes.get("unit_of_measurement") or "kWh"
                                    val_mwh = normalize_energy_to_mwh(st_e.state, u)
                                    if val_mwh is not None:
                                        adopted_energy_mwh = val_mwh
                                        adopted_energy_unit = "Wh" if str(u).strip() == "Wh" else "kWh"
                                        break
                    if dom_s == "sensor" and dc_s == "power" and not master_power_eid:
                        master_power_eid = m_s_eid

                    sensors_spec.append({
                        "sensor_key": s_key,
                        "label": s_label,
                        "domain": dom_s,
                        "device_class": dc_s,
                        "mode": "delta_energy" if is_energy else "fallback",
                        "native_unit": adopted_energy_unit if is_energy else None,
                        "initial_energy_mwh": adopted_energy_mwh if is_energy else None,
                        "master_unique_id": m_s_uid,
                        "master_entity_id": m_s_eid,
                        "sources": sources_s,
                    })
                    if dc_s in ("temperature", "humidity", "moisture", "motion", "smoke"):
                        room_sensors_store[m_s_eid] = {
                            "entity_id": m_s_eid,
                            "unique_id": m_s_uid,
                            "original_id": m_s_eid,
                            "type": dc_s,
                            "enabled": True,
                        }

            # Build unified Event entity spec (cross-protocol button presses)
            event_sources: list[dict[str, Any]] = []
            for proto, did in raw_transports.items():
                d_ent = dev_entries[proto]
                for ev_e in pre_events.get(proto, []):
                    event_sources.append({
                        "protocol": proto,
                        "kind": "entity",
                        "entity_id": _latest_eid(ev_e),
                        "unique_id": ev_e.unique_id or "",
                    })
                if proto == "wlan" and any(isinstance(i, (tuple, list)) and i[0] == "shelly" for i in d_ent.identifiers):
                    event_sources.append({
                        "protocol": "wlan",
                        "kind": "bus_event",
                        "event_name": "shelly.click",
                        "match": {"device_id": did},
                    })
                elif proto == "zigbee":
                    ieee = None
                    for conn in getattr(d_ent, "connections", None) or ():
                        if isinstance(conn, (tuple, list)) and len(conn) >= 2 and conn[0] in ("zigbee", "mac"):
                            ieee = str(conn[1]).lower()
                    for ident in getattr(d_ent, "identifiers", None) or ():
                        if isinstance(ident, (tuple, list)) and len(ident) >= 2 and ident[0] == "zha":
                            ieee = str(ident[1]).lower()
                    if ieee:
                        event_sources.append({
                            "protocol": "zigbee",
                            "kind": "bus_event",
                            "event_name": "zha_event",
                            "match": {"device_ieee": ieee, "device_id": did},
                        })

            events_spec: list[dict[str, Any]] = []
            if event_sources:
                ev_uid = f"smarthome_companion_hybrid_{hid}_event_main"
                ev_eid = _claim_master_entity("event", ev_uid, f"event.{base_obj_slug}_button", friendly_suffix="Taster")
                events_spec.append({
                    "event_key": "main",
                    "master_unique_id": ev_uid,
                    "master_entity_id": ev_eid,
                    "sources": event_sources,
                })

            # Move Companion category/power/energy labels onto Master entities
            from .ws_api import _ensure_label_exists, _sync_entity_labels, _remove_entity_labels
            cats = self.store.get_categories()
            cat_info = cats.get(category, {})
            cat_lbl = _ensure_label_exists(self.hass, category, name=cat_info.get("display_name", category), icon=cat_info.get("icon"), color=cat_info.get("color"))
            if channels_spec and cat_lbl:
                for ch_item in channels_spec:
                    _sync_entity_labels(self.hass, ch_item["master_entity_id"], [cat_lbl])
            if master_power_eid:
                p_lbl = _ensure_label_exists(self.hass, f"{category}_power", name=f"{cat_info.get('display_name', category)} Power")
                if p_lbl:
                    _sync_entity_labels(self.hass, master_power_eid, [p_lbl])
            if master_energy_eid:
                e_lbl = _ensure_label_exists(self.hass, f"{category}_energy", name=f"{cat_info.get('display_name', category)} Energy")
                if e_lbl:
                    _sync_entity_labels(self.hass, master_energy_eid, [e_lbl])
            for proto in raw_transports:
                for ch in channels_spec:
                    u_eid = (ch.get("sources") or {}).get(proto, {}).get("entity_id")
                    if u_eid:
                        _remove_entity_labels(self.hass, u_eid, [category, f"{category}_power", f"{category}_energy"])

            # ── Step C: Atomic Store Commit & Layout Key Migration ──
            hybrid_record = {
                "id": hid,
                "name": name,
                "area_id": area_id,
                "category": category,
                "icon": custom_icon,
                "preferred_protocol": pref_proto,
                "adopted_device_id": adopted_dev_id,
                "adopted_protocol": adopted_proto,
                "master_device_id": master_dev.id,
                "initial_channel_states": {
                    str(i): {"state": st.state, "attributes": dict(st.attributes)}
                    for i, st in initial_channel_states.items()
                },
                "transports": {
                    proto: {
                        "device_id": did,
                        "name": dev_entries[proto].name_by_user or dev_entries[proto].name or name,
                    }
                    for proto, did in raw_transports.items()
                },
                "channels": channels_spec,
                "sensors": sensors_spec,
                "events": events_spec,
            }
            hybrids[hid] = hybrid_record

            # Configure Master device in store.devices (so Dashboard builds the single clean Master tile)
            primary_ch = channels_spec[0] if channels_spec else None
            sub_entities_store = {}
            if len(channels_spec) > 1:
                for c in channels_spec:
                    ch_disp = c.get("name") or c["channel_key"]
                    sub_entities_store[c["master_entity_id"]] = {
                        "enabled": True,
                        "category": category,
                        "custom_name": ch_disp,
                        "name": ch_disp,
                        "unique_id": c["master_unique_id"],
                        "original_id": c["master_entity_id"],
                    }
            master_opts = dict(adopted_prev_cfg.get("options") or {})
            master_opts["hybrid_id"] = hid

            devices_store[master_dev.id] = {
                "hybrid_id": hid,
                "category": category,
                "configured_at": datetime.now().isoformat(),
                "custom_name": name,
                "icon": custom_icon,
                "options": master_opts,
                "entities": {
                    "primary": primary_ch["master_entity_id"] if primary_ch else (sensors_spec[0]["master_entity_id"] if sensors_spec else None),
                    "primary_unique_id": primary_ch["master_unique_id"] if primary_ch else (sensors_spec[0]["master_unique_id"] if sensors_spec else None),
                    "power": master_power_eid,
                    "energy": master_energy_eid,
                    "presence_simulation": bool((adopted_prev_cfg.get("entities") or {}).get("presence_simulation", False)),
                    "sub_entities": sub_entities_store,
                    "room_sensors": room_sensors_store,
                },
            }

            # Remove underlying devices from store.devices so only Master appears on Dashboard
            member_dev_ids = set(raw_transports.values())
            for m_did in member_dev_ids:
                devices_store.pop(m_did, None)

            # Update groups referencing underlying device_ids -> master_dev.id
            dev_id_remap = {m_did: master_dev.id for m_did in member_dev_ids}
            for gid, g_cfg in groups_store.items():
                if isinstance(g_cfg, dict) and isinstance(g_cfg.get("children"), list):
                    new_children = []
                    for c_ref in g_cfg["children"]:
                        if c_ref in dev_id_remap:
                            if dev_id_remap[c_ref] not in new_children:
                                new_children.append(dev_id_remap[c_ref])
                        elif isinstance(c_ref, str) and c_ref.startswith("d:"):
                            parts = c_ref.split(":", 2)
                            if len(parts) == 3 and parts[1] in dev_id_remap:
                                new_eid = primary_ch["master_entity_id"] if primary_ch else parts[2]
                                new_ref = f"d:{master_dev.id}:{new_eid}"
                                if new_ref not in new_children:
                                    new_children.append(new_ref)
                            else:
                                new_children.append(c_ref)
                        else:
                            new_children.append(c_ref)
                    g_cfg["children"] = new_children

            # Migrate dashboard tile_order / tile_layout / pinned_tiles from old device_id -> master_dev.id
            dash_cfg = self.store.data.get("dashboard")
            if isinstance(dash_cfg, dict) and adopted_dev_id:
                dash_updated, changed = replace_entity_ids_in_value(dash_cfg, {f"dev:{adopted_dev_id}": f"dev:{master_dev.id}"})
                if changed:
                    dash_cfg = dash_updated
                    self.store.data["dashboard"] = dash_cfg
                if primary_ch:
                    old_key = f"{adopted_dev_id}:{adopted_prev_cfg.get('entities', {}).get('primary_unique_id', '')}"
                    new_key = f"{master_dev.id}:{primary_ch['master_unique_id']}"
                    if old_key != new_key and not old_key.endswith(":"):
                        dash_updated2, changed2 = replace_entity_ids_in_value(dash_cfg, {old_key: new_key})
                        if changed2:
                            self.store.data["dashboard"] = dash_updated2

            self.store.data["hybrids"] = hybrids
            self.store.data["devices"] = devices_store
            self.store.data["groups"] = groups_store
            ok = await self.store.async_save()
            if not ok:
                raise RuntimeError("Failed to save Companion store")

        except Exception:
            # ── Full Rollback on any failure prior to store commit ──
            for m_eid in created_master_eids:
                try:
                    ent_reg.async_remove(m_eid)
                except Exception:  # noqa: BLE001
                    pass
            if created_master_dev_id:
                try:
                    dev_reg.async_remove_device(created_master_dev_id)
                except Exception:  # noqa: BLE001
                    pass
            for cur_eid, orig_eid in reversed(undo_renames):
                try:
                    _suppress_internal_rename_event(self.hass, cur_eid, orig_eid)
                    ent_reg.async_update_entity(cur_eid, new_entity_id=orig_eid)
                except Exception:  # noqa: BLE001
                    pass
            raise

        safe_fire_event(self.hass, f"{DOMAIN}_hybrids_updated")
        safe_fire_event(self.hass, f"{DOMAIN}_dashboard_updated")
        return hybrid_record

    async def async_unpair_hybrid(self, hybrid_id: str, reclaim_protocol: str | None = None) -> dict[str, Any]:
        """Cleanly unpair a Hybrid Master, restoring original base entity_ids without rewriting automations."""
        domain_data = self.hass.data.setdefault(DOMAIN, {})
        sync_lock = domain_data.setdefault("entity_sync_lock", asyncio.Lock())
        hybrid_lock = domain_data.setdefault("hybrid_mutation_lock", asyncio.Lock())

        async with sync_lock:
            async with hybrid_lock:
                return await self._async_unpair_locked(hybrid_id, reclaim_protocol=reclaim_protocol)

    async def _async_unpair_locked(self, hybrid_id: str, reclaim_protocol: str | None = None) -> dict[str, Any]:
        hybrids = dict(self.store.get_hybrids())
        h_cfg = hybrids.get(hybrid_id)
        if not isinstance(h_cfg, dict):
            raise ValueError(f"Hybrid not found: {hybrid_id}")

        dev_reg = dr.async_get(self.hass)
        ent_reg = er.async_get(self.hass)
        transports = h_cfg.get("transports") or {}

        # Choose surviving transport that takes back the base entity_ids
        surviving_proto = None
        for cand in (reclaim_protocol, h_cfg.get("adopted_protocol"), h_cfg.get("preferred_protocol"), "zigbee", "matter", "wlan"):
            if cand and cand in transports and dev_reg.async_get(transports[cand].get("device_id", "")):
                surviving_proto = cand
                break
        if not surviving_proto:
            for p, info in transports.items():
                if isinstance(info, dict) and dev_reg.async_get(info.get("device_id", "")):
                    surviving_proto = p
                    break

        surviving_dev_id = transports.get(surviving_proto, {}).get("device_id") if surviving_proto else None
        master_dev_id = h_cfg.get("master_device_id")

        self.clear_hybrid_runtime(hybrid_id)

        # Snapshot Master base entity IDs BEFORE removing Master registry entries
        reclaim_map: list[tuple[str, dict[str, str]]] = []
        for ch in h_cfg.get("channels") or []:
            if isinstance(ch, dict) and ch.get("master_entity_id"):
                src = (ch.get("sources") or {}).get(surviving_proto or "")
                if src:
                    reclaim_map.append((ch["master_entity_id"], src))
        for s in h_cfg.get("sensors") or []:
            if isinstance(s, dict) and s.get("master_entity_id"):
                src = (s.get("sources") or {}).get(surviving_proto or "")
                if src:
                    reclaim_map.append((s["master_entity_id"], src))

        # 1. Remove ALL Master entities & Master device from HA registries first
        master_dev = get_device_by_identifier_compat(dev_reg, (DOMAIN, f"hybrid_{hybrid_id}"))
        target_master_did = (master_dev.id if master_dev else master_dev_id)
        for e_entry in list(ent_reg.entities.values()):
            if getattr(e_entry, "platform", None) != DOMAIN:
                continue
            uid = str(getattr(e_entry, "unique_id", "") or "")
            if (target_master_did and e_entry.device_id == target_master_did) or uid.startswith(f"smarthome_companion_hybrid_{hybrid_id}_"):
                try:
                    ent_reg.async_remove(e_entry.entity_id)
                except Exception:  # noqa: BLE001
                    pass
        if target_master_did:
            try:
                dev_reg.async_remove_device(target_master_did)
            except Exception:  # noqa: BLE001
                pass

        # 2. Restore base entity_ids & base friendly names onto the surviving transport (suppressed!)
        restored_primary_eid = None
        restored_primary_uid = None
        if surviving_proto and surviving_dev_id:
            for base_eid, src in reclaim_map:
                cur_eid = resolve_source_entity_id(self.hass, src)
                if cur_eid and cur_eid != base_eid and ent_reg.async_get(base_eid) is None:
                    try:
                        _suppress_internal_rename_event(self.hass, cur_eid, base_eid)
                        ent_reg.async_update_entity(cur_eid, new_entity_id=base_eid)
                        if not restored_primary_eid and "." in base_eid and base_eid.split(".")[0] in _ACTUATOR_DOMAINS:
                            restored_primary_eid = base_eid
                            restored_primary_uid = src.get("unique_id")
                    except Exception as err:  # noqa: BLE001
                        _LOGGER.warning("Could not restore base entity_id %s -> %s: %s", cur_eid, base_eid, err)

            surv_cfg = {
                "custom_name": h_cfg.get("name"),
                "entities": {
                    "primary": restored_primary_eid,
                    "primary_unique_id": restored_primary_uid,
                },
            }
            sync_device_friendly_names(self.hass, surviving_dev_id, surv_cfg, area_id=h_cfg.get("area_id") or None, protocol_suffix=None)

        # 3. Restore store.devices & store.groups & suppress immediate re-proposal
        devices_store = dict(self.store.get_devices())
        old_master_cfg = devices_store.pop(master_dev_id, {}) if master_dev_id else {}
        if surviving_dev_id and restored_primary_eid:
            devices_store[surviving_dev_id] = {
                "category": h_cfg.get("category") or "schalter",
                "configured_at": datetime.now().isoformat(),
                "custom_name": h_cfg.get("name"),
                "icon": h_cfg.get("icon"),
                "options": {k: v for k, v in (old_master_cfg.get("options") or {}).items() if k != "hybrid_id"},
                "entities": {
                    **(old_master_cfg.get("entities") or {}),
                    "primary": restored_primary_eid,
                    "primary_unique_id": restored_primary_uid,
                },
            }

        groups_store = dict(self.store.get_groups())
        if surviving_dev_id and master_dev_id:
            for g_cfg in groups_store.values():
                if isinstance(g_cfg, dict) and isinstance(g_cfg.get("children"), list):
                    g_cfg["children"] = [
                        surviving_dev_id if c == master_dev_id else c
                        for c in g_cfg["children"]
                    ]

        dev_ids_in_pair = [info.get("device_id") for info in transports.values() if isinstance(info, dict) and info.get("device_id")]
        dismissed = list(self.store.get_dismissed_hybrid_pairs())
        if len(dev_ids_in_pair) >= 2:
            pk = make_pair_key(dev_ids_in_pair[0], dev_ids_in_pair[1])
            if pk not in dismissed:
                dismissed.append(pk)

        hybrids.pop(hybrid_id, None)
        self.store.data["hybrids"] = hybrids
        self.store.data["devices"] = devices_store
        self.store.data["groups"] = groups_store
        self.store.data["dismissed_hybrid_pairs"] = dismissed
        await self.store.async_save()

        safe_fire_event(self.hass, f"{DOMAIN}_hybrids_updated")
        safe_fire_event(self.hass, f"{DOMAIN}_dashboard_updated")
        return {"success": True, "hybrid_id": hybrid_id, "surviving_device_id": surviving_dev_id}
