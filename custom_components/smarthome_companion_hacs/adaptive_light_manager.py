"""Adaptive Light Manager für SmartHome Companion.

Logik:
- Berechnet anhand der Tageszeit (Sonnenstand + Konfiguration) eine Ziel-Helligkeit
- Passt alle 3 Minuten die Helligkeit sanft an (nur wenn Licht brennt)
- Erkennt manuelle Helligkeitsänderungen → Override bis nächstes An/Aus
- Unterstützt Label-Filterung (nur Lampen mit Label "adaptiv") oder alle Lampen
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, time as dtime
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval, async_track_state_change_event
from homeassistant.util.dt import now as ha_now
from homeassistant.const import STATE_ON, STATE_OFF
from datetime import timedelta

_LOGGER = logging.getLogger(__name__)

# Wie oft wird die Helligkeit angepasst
ADJUST_INTERVAL = timedelta(minutes=3)

# Wie viel darf manuell verändert werden, bevor Override aktiv wird (in Prozentpunkten)
MANUAL_OVERRIDE_THRESHOLD = 8


class AdaptiveLightManager:
    """Verwaltet adaptives Licht für eine Konfiguration."""

    def __init__(self, hass: HomeAssistant, store) -> None:
        self.hass = hass
        self.store = store
        self._unsub_interval = None
        self._unsub_state_change = None
        # device_id -> True wenn manueller Override aktiv
        self._manual_overrides: dict[str, bool] = {}
        # entity_id -> letzte vom System gesetzte Helligkeit
        self._last_set_brightness: dict[str, int] = {}

    def get_config(self) -> dict:
        """Lädt aktuelle adaptive Licht Konfiguration aus Store."""
        data = self.store.get_adaptive_light_config()
        return data or {}

    def is_enabled(self) -> bool:
        cfg = self.get_config()
        return cfg.get("enabled", False)

    async def start(self) -> None:
        """Startet den Intervall-Timer und State-Listener."""
        self._unsub_interval = async_track_time_interval(
            self.hass, self._async_adjust_lights, ADJUST_INTERVAL
        )
        self._unsub_state_change = self.hass.bus.async_listen(
            "state_changed", self._async_state_changed
        )
        _LOGGER.info("Adaptive Light Manager gestartet.")

    async def stop(self) -> None:
        if self._unsub_interval:
            self._unsub_interval()
            self._unsub_interval = None
        if self._unsub_state_change:
            self._unsub_state_change()
            self._unsub_state_change = None

    @callback
    def _async_state_changed(self, event) -> None:
        entity_id = event.data.get("entity_id")
        if not entity_id or not entity_id.startswith("light."):
            return
            
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        
        if old_state is None or new_state is None:
            return
            
        if old_state.state == STATE_OFF and new_state.state == STATE_ON:
            if not self.is_enabled():
                return
            cfg = self.get_config()
            if entity_id in self._get_adaptive_entities(cfg):
                self.handle_light_turned_on(entity_id)
                self.hass.async_create_task(self._async_apply_now(entity_id, is_turn_on=True))
                
        elif old_state.state == STATE_ON and new_state.state == STATE_OFF:
            self.handle_light_turned_off(entity_id)

    @callback
    async def _async_adjust_lights(self, now=None) -> None:
        """Wird alle 3 Minuten aufgerufen – passt alle aktiven Lichter an."""
        if not self.is_enabled():
            return

        cfg = self.get_config()
        target_brightness = self._calculate_target_brightness(cfg)
        entities = self._get_adaptive_entities(cfg)

        for entity_id in entities:
            state = self.hass.states.get(entity_id)
            if state is None or state.state != STATE_ON:
                continue

            # Manual Override Check
            current_brightness = state.attributes.get("brightness")
            if current_brightness is not None:
                current_pct = round(current_brightness / 2.55)
                last_set = self._last_set_brightness.get(entity_id)
                if last_set is not None:
                    diff = abs(current_pct - last_set)
                    if diff > MANUAL_OVERRIDE_THRESHOLD:
                        _LOGGER.debug(
                            "Manual override detected for %s (current=%d, last_set=%d)",
                            entity_id, current_pct, last_set
                        )
                        self._manual_overrides[entity_id] = True
                        continue

            if self._manual_overrides.get(entity_id):
                continue

            await self._set_brightness(entity_id, target_brightness, cfg)

    async def _set_brightness(
        self, entity_id: str, brightness_pct: int, cfg: dict, is_turn_on: bool = False
    ) -> None:
        """Setzt die Helligkeit eines Lichts über HA service call."""
        brightness_byte = max(1, min(255, round(brightness_pct * 2.55)))
        transition = 1 if is_turn_on else cfg.get("transition_seconds", 30)

        try:
            await self.hass.services.async_call(
                "light",
                "turn_on",
                {
                    "entity_id": entity_id,
                    "brightness": brightness_byte,
                    "transition": transition,
                },
                blocking=False,
            )
            self._last_set_brightness[entity_id] = brightness_pct
            _LOGGER.debug(
                "Adaptive light: %s → %d%% (transition=%ds)",
                entity_id, brightness_pct, transition
            )
        except Exception as e:
            _LOGGER.warning("Fehler beim Setzen von %s: %s", entity_id, e)

    def reset_override(self, entity_id: str) -> None:
        """Setzt den Manual-Override zurück (z.B. nach An/Aus-Zyklus)."""
        self._manual_overrides.pop(entity_id, None)
        self._last_set_brightness.pop(entity_id, None)

    def handle_light_turned_on(self, entity_id: str) -> None:
        """Wird aufgerufen wenn ein Licht eingeschaltet wird – Override zurücksetzen."""
        self.reset_override(entity_id)

    def handle_light_turned_off(self, entity_id: str) -> None:
        """Wird aufgerufen wenn ein Licht ausgeschaltet wird – Override zurücksetzen."""
        self.reset_override(entity_id)

    def apply_immediately(self, entity_id: str | None = None) -> None:
        """Sofortige Anpassung auslösen (z.B. wenn Licht eingeschaltet wird)."""
        self.hass.async_create_task(self._async_apply_now(entity_id))

    async def _async_apply_now(self, entity_id: str | None = None, is_turn_on: bool = False) -> None:
        """Passt Helligkeit sofort an – für einzelne Entität oder alle."""
        if not self.is_enabled():
            return
        cfg = self.get_config()
        target = self._calculate_target_brightness(cfg)
        entities = [entity_id] if entity_id else self._get_adaptive_entities(cfg)

        for eid in entities:
            state = self.hass.states.get(eid)
            if state and state.state == STATE_ON and not self._manual_overrides.get(eid):
                await self._set_brightness(eid, target, cfg, is_turn_on=is_turn_on)

    def _get_adaptive_entities(self, cfg: dict) -> list[str]:
        """Gibt alle Licht-Entitäten zurück, die adaptiv gesteuert werden sollen."""
        mode = cfg.get("entity_mode", "label")  # 'label' oder 'specific'

        if mode == "specific":
            return cfg.get("entities", [])

        # Label-Modus: alle Lichter mit Label 'adaptiv' oder alle Lichter
        label_filter = cfg.get("label_filter", "")
        all_light_states = [
            s for s in self.hass.states.async_all("light")
        ]

        if label_filter:
            from homeassistant.helpers import entity_registry as er
            ent_reg = er.async_get(self.hass)
            result = []
            for state in all_light_states:
                entry = ent_reg.async_get(state.entity_id)
                if entry and label_filter in (entry.labels or []):
                    result.append(state.entity_id)
            return result

        return [s.entity_id for s in all_light_states]

    def _calculate_target_brightness(self, cfg: dict) -> int:
        """Berechnet die Ziel-Helligkeit basierend auf der aktuellen Zeit.

        Die Kurve wird durch bis zu 5 Stützpunkte definiert (Uhrzeit → Helligkeit).
        Zwischen den Punkten wird interpoliert.
        Standard: Morgen 40%, Mittag 100%, Abend 60%, Nacht 20%
        """
        curve = cfg.get("brightness_curve", _default_brightness_curve())
        if not curve:
            curve = _default_brightness_curve()

        now = ha_now()
        current_minutes = now.hour * 60 + now.minute

        # Sortieren nach Uhrzeit (in Minuten)
        sorted_curve = sorted(curve, key=lambda p: _time_str_to_minutes(p["time"]))

        if len(sorted_curve) == 1:
            return int(sorted_curve[0]["brightness"])

        # Wraparound: letzten Punkt des Vortags am Anfang einfügen
        first = sorted_curve[0]
        last = sorted_curve[-1]
        extended = [
            {"time": _minutes_to_time_str(_time_str_to_minutes(last["time"]) - 1440),
             "brightness": last["brightness"]}
        ] + sorted_curve + [
            {"time": _minutes_to_time_str(_time_str_to_minutes(first["time"]) + 1440),
             "brightness": first["brightness"]}
        ]

        # Interpolation finden
        for i in range(len(extended) - 1):
            t0 = _time_str_to_minutes(extended[i]["time"])
            t1 = _time_str_to_minutes(extended[i + 1]["time"])
            b0 = extended[i]["brightness"]
            b1 = extended[i + 1]["brightness"]

            if t0 <= current_minutes <= t1:
                if t1 == t0:
                    return int(b0)
                # Smooth cosine interpolation
                t_ratio = (current_minutes - t0) / (t1 - t0)
                smooth = (1 - math.cos(t_ratio * math.pi)) / 2
                brightness = b0 + (b1 - b0) * smooth
                return max(1, min(100, round(brightness)))

        return int(sorted_curve[0]["brightness"])


def _default_brightness_curve() -> list[dict]:
    """Standard-Helligkeitskurve: typischer Tagesverlauf."""
    return [
        {"time": "06:00", "brightness": 30},
        {"time": "08:00", "brightness": 70},
        {"time": "12:00", "brightness": 100},
        {"time": "17:00", "brightness": 80},
        {"time": "20:00", "brightness": 50},
        {"time": "22:00", "brightness": 20},
        {"time": "00:00", "brightness": 10},
    ]


def _time_str_to_minutes(time_str: str) -> int:
    """'HH:MM' → Minuten seit Mitternacht. Kann auch negativ sein (Wraparound)."""
    try:
        h, m = map(int, time_str.split(":"))
        return h * 60 + m
    except Exception:
        return 0


def _minutes_to_time_str(minutes: int) -> str:
    """Minuten → 'HH:MM' String (kann über 24h oder negativ sein für Wraparound)."""
    m = minutes % 1440
    return f"{m // 60:02d}:{m % 60:02d}"
