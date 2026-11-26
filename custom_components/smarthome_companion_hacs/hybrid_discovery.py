"""Read-only automatic Hybrid Multi-Protocol Device Discovery (Zigbee, WLAN, Matter).

Detects when the same physical hardware is integrated into Home Assistant over
two (or more) radio transports (e.g. Zigbee + WLAN, Matter + WLAN, Zigbee +
Matter) and emits user-confirmable proposals without mutating registries.

Matching safeguards:
- ESP32-C6 / Shelly Gen 4 eFuse blocks reserve 4 consecutive MACs per chip.
  NIC comparisons require same 4-aligned block (`(nic_a >> 2) == (nic_b >> 2)`)
  to prevent false-pairing adjacent devices from the same factory 2-pack.
- Byte-0 U/L & multicast bits (`& 0xFC`) are masked so IEEE 802.15.4 EUI-64 and
  RFC 4291 Modified EUI-64 match cleanly.
- Shelly Gen 4 Matter `serial_number` (12-hex MAC) matches Shelly WLAN MACs
  even when Matter-over-Thread `connections` is empty.
- Greedy 1:1 maximum-weight bipartite matching prevents low-score heuristics
  from stealing devices with exact hardware matches.
"""
from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import re
from typing import Any

# pyrefly: ignore [missing-import]
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

from .const import DOMAIN
from .dashboard import _IGNORED_PLATFORMS

_CONTROLLABLE_DOMAINS = frozenset({"light", "switch", "cover", "valve", "fan", "climate"})
_SWITCH_LIGHT_PAIR = frozenset({"switch", "light"})

_ZIGBEE_PREFIXES = ("zha", "deconz", "hue", "zigbee2mqtt", "z2m", "zigbee")
_BRIDGE_NAME_RE = re.compile(
    r"(?:zigbee2mqtt\s*bridge|zha\s*coordinator|coordinator|zigbee.*bridge|hue\s*bridge|conbee|raspbee|zbdongle|skyconnect|slzb-?\d+|cc2652|cc1352|ezsp)",
    re.IGNORECASE,
)
_HEX_RE = re.compile(r"[^0-9a-f]")
_PROTO_TOKENS_RE = re.compile(
    r"\b(?:zigbee2mqtt|zigbee|z2m|zha|deconz|wlan|wifi|wi[-_ ]?fi|matter|thread|shelly|rpc|mqtt|switch|light|dimmer)\b",
    re.IGNORECASE,
)
_JUNK_SERIALS = frozenset({"", "unknown", "none", "null", "n/a", "00000000", "000000000000", "ffffffffffff"})

_MFG_ALIASES = {
    "allterco": "shelly",
    "allterco robotics": "shelly",
    "shelly europe": "shelly",
    "shelly europe ltd": "shelly",
    "shelly usa": "shelly",
    "signify": "philips",
    "signify netherlands": "philips",
    "signify netherlands b v": "philips",
    "philips": "philips",
    "lumi united technology": "aqara",
    "aqara": "aqara",
    "lumi": "aqara",
    "itead": "sonoff",
    "sonoff": "sonoff",
    "ewelink": "sonoff",
    "ikea of sweden": "ikea",
    "ikea": "ikea",
    "espressif": "espressif",
}


def _clean_text(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def normalize_manufacturer(mfg: str | None) -> str:
    c = _clean_text(mfg)
    if not c:
        return ""
    if c in _MFG_ALIASES:
        return _MFG_ALIASES[c]
    for alias, canon in _MFG_ALIASES.items():
        if alias in c:
            return canon
    return c.split(" ", 1)[0]


def normalize_model(model: str | None) -> str:
    s = _clean_text(model)
    s = re.sub(r"\b(?:zb|zigbee|wifi|wlan|matter|gen\s*4|g4)\b", "", s).strip()
    return re.sub(r"\s+", " ", s)


def _strip_proto_and_area(name: str | None, area_name: str = "") -> str:
    s = str(name or "").strip()
    if area_name and s.lower().startswith(f"{area_name.lower()} "):
        s = s[len(area_name) :].strip()
    s = _PROTO_TOKENS_RE.sub(" ", s)
    s = re.sub(r"[()\[\]·_-]+", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _parse_hex_bytes(val: str | None) -> bytes | None:
    if not val:
        return None
    h = _HEX_RE.sub("", str(val).lower())
    if len(h) not in (12, 16):
        return None
    try:
        raw = bytes.fromhex(h)
    except ValueError:
        return None
    if len(set(raw)) == 1 and raw[0] in (0x00, 0xFF):
        return None
    return raw


def _device_has_ident_prefix(dev, prefixes: tuple[str, ...]) -> bool:
    for pair in getattr(dev, "identifiers", None) or ():
        if not isinstance(pair, (tuple, list)) or len(pair) < 2:
            continue
        p0 = str(pair[0] or "").lower()
        p1 = str(pair[1] or "").lower()
        if any(p0 == pre or p0.startswith(pre) or p1.startswith(pre) for pre in prefixes):
            return True
    return False


def classify_protocol(dev_entry, dev_entities: list, dev_reg=None) -> str:
    """Classify a device as `'zigbee'`, `'matter'`, or `'wlan'`."""
    if _device_has_ident_prefix(dev_entry, ("matter",)):
        return "matter"
    if any(str(getattr(e, "platform", "") or "").lower() == "matter" for e in dev_entities):
        return "matter"
    via_id = getattr(dev_entry, "via_device_id", None)
    bridge = dev_reg.async_get(via_id) if (via_id and dev_reg and hasattr(dev_reg, "async_get")) else None
    if bridge and _device_has_ident_prefix(bridge, ("matter",)):
        return "matter"

    if _device_has_ident_prefix(dev_entry, _ZIGBEE_PREFIXES):
        return "zigbee"
    if bridge and _device_has_ident_prefix(bridge, _ZIGBEE_PREFIXES):
        return "zigbee"
    if any(str(getattr(e, "platform", "") or "").lower() in ("zha", "deconz", "hue") for e in dev_entities):
        return "zigbee"
    mfg_model = f"{getattr(dev_entry, 'manufacturer', '') or ''} {getattr(dev_entry, 'model', '') or ''}".lower()
    if re.search(r"zigbee2mqtt|zigbee|\bzha\b|deconz", mfg_model):
        return "zigbee"
    if any(str(getattr(e, "platform", "") or "").lower() == "mqtt" for e in dev_entities):
        b_hay = (
            f"{getattr(bridge, 'name', '') or ''} {getattr(bridge, 'manufacturer', '') or ''} {getattr(bridge, 'model', '') or ''}".lower()
            if bridge
            else ""
        )
        if re.search(r"zigbee|z2m", b_hay) or any(
            re.search(r"zigbee|0x[0-9a-f]{12,16}", f"{e.entity_id} {getattr(e, 'unique_id', '') or ''}", re.I)
            for e in dev_entities
        ):
            return "zigbee"
    return "wlan"


@dataclass
class DeviceSignals:
    device_id: str
    protocol: str
    name: str
    area_id: str
    area_name: str
    clean_name: str
    manufacturer: str
    model: str
    serial_number: str
    macs: list[bytes]
    euis: list[bytes]
    domains: set[str]
    channel_count: int
    configured: bool
    raw_manufacturer: str
    raw_model: str
    primary_category_guess: str


def _is_ignored_candidate_device(dev_entry, dev_entities: list) -> bool:
    for pair in getattr(dev_entry, "identifiers", None) or ():
        if isinstance(pair, (tuple, list)) and pair and pair[0] == DOMAIN:
            return True
    if getattr(dev_entry, "manufacturer", None) == "SmartHome Companion":
        return True
    hay = f"{getattr(dev_entry, 'name_by_user', '') or ''} {getattr(dev_entry, 'name', '') or ''} {getattr(dev_entry, 'manufacturer', '') or ''} {getattr(dev_entry, 'model', '') or ''}"
    if _BRIDGE_NAME_RE.search(hay):
        return True
    if getattr(dev_entry, "entry_type", None) == "service" and not any(
        getattr(e, "domain", None) in _CONTROLLABLE_DOMAINS for e in dev_entities
    ):
        return True
    if dev_entities and all(str(getattr(e, "platform", "") or "").lower() in _IGNORED_PLATFORMS for e in dev_entities):
        return True
    return False


def _guess_category(domains: set[str]) -> str:
    if "light" in domains:
        return "leuchte"
    if "cover" in domains:
        return "jalousie"
    if "climate" in domains:
        return "klima"
    if "valve" in domains:
        return "wasserventil"
    if "switch" in domains:
        return "steckdose"
    return "schalter"


def extract_device_signals(
    dev_entry,
    dev_entities: list,
    dev_reg=None,
    area_reg=None,
    *,
    configured: bool = False,
) -> DeviceSignals:
    """Extract normalized hardware & metadata signals for pairing."""
    macs: list[bytes] = []
    euis: list[bytes] = []

    def _add_addr(raw: str | None) -> None:
        parsed = _parse_hex_bytes(raw)
        if not parsed:
            return
        if len(parsed) == 6 and parsed not in macs:
            macs.append(parsed)
        elif len(parsed) == 8 and parsed not in euis:
            euis.append(parsed)

    for conn in getattr(dev_entry, "connections", None) or ():
        if isinstance(conn, (tuple, list)) and len(conn) >= 2:
            _add_addr(conn[1])

    for ident in getattr(dev_entry, "identifiers", None) or ():
        if isinstance(ident, (tuple, list)) and len(ident) >= 2:
            val = str(ident[1] or "")
            _add_addr(val)
            m_hex16 = re.search(r"(?:0x)?([0-9a-fA-F]{16})", val)
            if m_hex16:
                _add_addr(m_hex16.group(1))
            m_hex12 = re.search(r"(?:^|[-_:])([0-9a-fA-F]{12})(?:$|[-_:])", val)
            if m_hex12:
                _add_addr(m_hex12.group(1))

    serial_raw = str(getattr(dev_entry, "serial_number", None) or "").strip()
    serial_norm = _HEX_RE.sub("", serial_raw.lower()) if re.fullmatch(r"[0-9a-fA-F:\-]+", serial_raw) else serial_raw.lower()
    if serial_norm in _JUNK_SERIALS or len(serial_norm) < 8:
        serial_norm = ""
    else:
        _add_addr(serial_raw)

    area_id = str(getattr(dev_entry, "area_id", None) or "")
    area_name = ""
    if area_id and area_reg and hasattr(area_reg, "async_get_area"):
        a_entry = area_reg.async_get_area(area_id)
        if a_entry:
            area_name = str(getattr(a_entry, "name", "") or "").strip()

    raw_name = str(getattr(dev_entry, "name_by_user", None) or getattr(dev_entry, "name", None) or "").strip()
    controllable = [e for e in dev_entities if getattr(e, "domain", None) in _CONTROLLABLE_DOMAINS]
    domains = {e.domain for e in controllable}
    proto = classify_protocol(dev_entry, dev_entities, dev_reg)

    return DeviceSignals(
        device_id=dev_entry.id,
        protocol=proto,
        name=raw_name,
        area_id=area_id,
        area_name=area_name,
        clean_name=_strip_proto_and_area(raw_name, area_name),
        manufacturer=normalize_manufacturer(getattr(dev_entry, "manufacturer", None)),
        model=normalize_model(getattr(dev_entry, "model", None)),
        serial_number=serial_norm,
        macs=macs,
        euis=euis,
        domains=domains,
        channel_count=len(controllable),
        configured=configured,
        raw_manufacturer=str(getattr(dev_entry, "manufacturer", None) or ""),
        raw_model=str(getattr(dev_entry, "model", None) or ""),
        primary_category_guess=_guess_category(domains),
    )


def _match_mac_to_eui64(mac: bytes, eui: bytes) -> int:
    """Match a 6-byte Wi-Fi/BT MAC to an 8-byte IEEE 802.15.4 / Thread EUI-64.

    Handles both IEEE EUI-64 (`FF:FE`) and custom ESP32-C6 middle bytes while
    requiring the NICs to share the exact same 4-aligned eFuse block (`>> 2`)
    so adjacent devices from a 2-pack (+4 offset) never false-match.
    """
    oui_e = eui[:3]
    nic_e = eui[5:8]
    if (mac[0] & 0xFC) != (oui_e[0] & 0xFC) or mac[1:3] != oui_e[1:3]:
        return 0
    nic_m_i = (mac[3] << 16) | (mac[4] << 8) | mac[5]
    nic_e_i = (nic_e[0] << 16) | (nic_e[1] << 8) | nic_e[2]
    if nic_m_i == nic_e_i:
        return 97
    if (nic_m_i >> 2) == (nic_e_i >> 2):
        return 95
    return 0


def match_hardware_identity(a: DeviceSignals, b: DeviceSignals) -> tuple[int, list[str]]:
    """Return `(score, reasons)` for hardware-level identity matching."""
    reasons: list[str] = []
    best = 0

    for ma in a.macs:
        for mb in b.macs:
            if ma == mb:
                return 100, ["exact_mac"]
            if (ma[0] & 0xFC) == (mb[0] & 0xFC) and ma[1:3] == mb[1:3]:
                na = (ma[3] << 16) | (ma[4] << 8) | ma[5]
                nb = (mb[3] << 16) | (mb[4] << 8) | mb[5]
                if (na >> 2) == (nb >> 2) and best < 92:
                    best = 92
                    reasons = ["adjacent_mac_block"]

    if a.serial_number and b.serial_number and a.serial_number == b.serial_number:
        if best < 98:
            best = 98
            reasons = ["serial_number"]

    for mac in a.macs:
        for eui in b.euis:
            sc = _match_mac_to_eui64(mac, eui)
            if sc > best:
                best = sc
                reasons = ["esp32_mac_eui64_block"]
    for mac in b.macs:
        for eui in a.euis:
            sc = _match_mac_to_eui64(mac, eui)
            if sc > best:
                best = sc
                reasons = ["esp32_mac_eui64_block"]

    return best, reasons


def _domains_compatible(a: DeviceSignals, b: DeviceSignals) -> bool:
    if not a.domains and not b.domains:
        return True  # Sensor-only dual device
    if a.domains & b.domains:
        return True
    # Shelly & Zigbee switch-as-light devices frequently cross light <-> switch
    if (a.domains <= _SWITCH_LIGHT_PAIR) and (b.domains <= _SWITCH_LIGHT_PAIR):
        return True
    return False


def score_pair(a: DeviceSignals, b: DeviceSignals) -> tuple[int, list[str]]:
    """Score whether two devices represent the same physical multi-protocol device."""
    if a.protocol == b.protocol:
        return 0, []
    if not _domains_compatible(a, b):
        return 0, []
    if a.channel_count and b.channel_count and a.channel_count != b.channel_count:
        return 0, []

    hw_score, reasons = match_hardware_identity(a, b)
    if hw_score > 0:
        if a.area_id and b.area_id and a.area_id != b.area_id:
            hw_score -= 25
            reasons.append("area_mismatch")
        return max(0, hw_score), reasons

    # Tier 2 Heuristic matching
    score = 0
    h_reasons: list[str] = []
    if a.manufacturer and b.manufacturer and a.manufacturer == b.manufacturer:
        score += 30
        h_reasons.append("manufacturer")
    elif a.manufacturer and b.manufacturer and a.manufacturer != b.manufacturer:
        return 0, []

    if a.model and b.model:
        if a.model == b.model or (a.model in b.model or b.model in a.model):
            score += 20
            h_reasons.append("model")
        elif SequenceMatcher(None, a.model, b.model).ratio() >= 0.72:
            score += 12
            h_reasons.append("model_similar")

    if a.area_id and b.area_id:
        if a.area_id == b.area_id:
            score += 15
            h_reasons.append("same_area")
        else:
            score -= 15

    if a.clean_name and b.clean_name:
        ratio = SequenceMatcher(None, a.clean_name, b.clean_name).ratio()
        if ratio >= 0.72:
            score += round(28 * ratio)
            h_reasons.append("name_similarity")

    if a.channel_count and b.channel_count and a.channel_count == b.channel_count:
        score += 10
        h_reasons.append("channel_count")

    return (score, h_reasons) if score >= 60 else (0, [])


def make_pair_key(dev_a: str, dev_b: str) -> str:
    return f"{dev_a}::{dev_b}" if dev_a <= dev_b else f"{dev_b}::{dev_a}"


async def async_discover_hybrid_pairs(hass, store) -> list[dict[str, Any]]:
    """Scan HA registries for unlinked physical devices exposed over 2+ protocols."""
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)

    configured_devices = store.get_devices() if store else {}
    hidden_dev_ids, _ = store.get_hidden_hybrid_ids() if store and hasattr(store, "get_hidden_hybrid_ids") else (set(), set())
    dismissed_pairs = set(store.get_dismissed_hybrid_pairs() if store and hasattr(store, "get_dismissed_hybrid_pairs") else [])

    ents_by_dev: dict[str, list] = {}
    for e in ent_reg.entities.values():
        if getattr(e, "device_id", None):
            ents_by_dev.setdefault(e.device_id, []).append(e)

    signals: list[DeviceSignals] = []
    for dev in dev_reg.devices.values():
        if dev.id in hidden_dev_ids:
            continue
        dev_ents = ents_by_dev.get(dev.id, [])
        if _is_ignored_candidate_device(dev, dev_ents):
            continue
        sig = extract_device_signals(
            dev,
            dev_ents,
            dev_reg=dev_reg,
            area_reg=area_reg,
            configured=(dev.id in configured_devices),
        )
        # Skip devices that have zero entities at all
        if not dev_ents:
            continue
        signals.append(sig)

    scored_edges: list[tuple[int, DeviceSignals, DeviceSignals, list[str]]] = []
    for i in range(len(signals)):
        for j in range(i + 1, len(signals)):
            sa, sb = signals[i], signals[j]
            pk = make_pair_key(sa.device_id, sb.device_id)
            if pk in dismissed_pairs:
                continue
            sc, reasons = score_pair(sa, sb)
            if sc >= 60:
                scored_edges.append((sc, sa, sb, reasons))

    # 1:1 greedy maximum-weight bipartite matching
    scored_edges.sort(key=lambda item: item[0], reverse=True)
    used_devs: set[str] = set()
    proposals: list[dict[str, Any]] = []

    proto_rank = {"zigbee": 0, "matter": 1, "wlan": 2}
    for sc, sa, sb, reasons in scored_edges:
        if sa.device_id in used_devs or sb.device_id in used_devs:
            continue
        used_devs.add(sa.device_id)
        used_devs.add(sb.device_id)

        ordered = sorted((sa, sb), key=lambda s: (proto_rank.get(s.protocol, 9), not s.configured))
        first, second = ordered[0], ordered[1]

        adopted_sig = next((s for s in ordered if s.configured), None)
        pref_name = (
            (configured_devices.get(adopted_sig.device_id, {}).get("custom_name") if adopted_sig else None)
            or next((s.clean_name.title() for s in ordered if s.clean_name), None)
            or first.name
        )
        pref_area = (adopted_sig.area_id if adopted_sig and adopted_sig.area_id else "") or first.area_id or second.area_id
        pref_cat = (
            (configured_devices.get(adopted_sig.device_id, {}).get("category") if adopted_sig else None)
            or first.primary_category_guess
            or second.primary_category_guess
        )

        proposals.append({
            "pair_key": make_pair_key(sa.device_id, sb.device_id),
            "score": sc,
            "confidence": "high" if sc >= 85 else "medium",
            "reasons": reasons,
            "protocols": [first.protocol, second.protocol],
            "adopted_device_id": adopted_sig.device_id if adopted_sig else None,
            "adopted_protocol": adopted_sig.protocol if adopted_sig else None,
            "suggested_name": str(pref_name or "Hybrid-Gerät").strip(),
            "suggested_area_id": pref_area,
            "suggested_category": pref_cat,
            "devices": [
                {
                    "device_id": s.device_id,
                    "protocol": s.protocol,
                    "name": s.name,
                    "area_id": s.area_id,
                    "area_name": s.area_name,
                    "manufacturer": s.raw_manufacturer,
                    "model": s.raw_model,
                    "configured": s.configured,
                }
                for s in ordered
            ],
        })

    return proposals
