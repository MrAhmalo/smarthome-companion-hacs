DOMAIN = "smarthome_companion_hacs"
STORAGE_KEY = "smarthome_companion_hacs.configuration"
STORAGE_VERSION = 1
VERSION = "2.8.21"

DEFAULT_CATEGORIES = {
    "leuchte": {
        "icon": "mdi:lightbulb",
        "color": "#FFC107",
        "display_name": "Beleuchtung",
    },
    "steckdose": {
        "icon": "mdi:power-socket-eu",
        "color": "#009688",
        "display_name": "Steckdosen",
    },
    "schalter": {
        "icon": "mdi:power-plug",
        "color": "#2196F3",
        "display_name": "Geräte",
    },
    "jalousie": {
        "icon": "mdi:window-shutter",
        "color": "#9C27B0",
        "display_name": "Jalousien",
    },
    "klima": {
        "icon": "mdi:thermometer",
        "color": "#FF9800",
        "display_name": "Klima",
    },
    "fernseher": {
        "icon": "mdi:television",
        "color": "#03A9F4",
        "display_name": "Fernseher",
    },
    "medien": {
        "icon": "mdi:speaker",
        "color": "#03A9F4",
        "display_name": "Medien",
    },
    "wasserventil": {
        "icon": "mdi:water-pump",
        "color": "#00BCD4",
        "display_name": "Wasserventile",
    },
    "pumpe": {
        "icon": "mdi:pump",
        "color": "#03A9F4",
        "display_name": "Pumpen",
    },
    "bewegungsmelder": {
        "icon": "mdi:motion-sensor",
        "color": "#E91E63",
        "display_name": "Bewegungsmelder",
    },
    "bodenmessgeraet": {
        "icon": "mdi:sprout",
        "color": "#4CAF50",
        "display_name": "Bodenmessgeräte",
    },
    "raummessgeraet": {
        "icon": "mdi:thermometer-lines",
        "color": "#FF5722",
        "display_name": "Raummessgeräte",
    },
}

# Maps HA domains to suggested categories
DOMAIN_CATEGORY_MAP = {
    "light": "leuchte",
    "cover": "jalousie",
    "climate": "klima",
    "media_player": "medien",
    "switch": "schalter",
    "fan": "schalter",
}
