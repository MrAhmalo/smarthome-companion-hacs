DOMAIN = "smarthome_companion_hacs"
STORAGE_KEY = "smarthome_companion_hacs.configuration"
STORAGE_VERSION = 1

DEFAULT_CATEGORIES = {
    "leuchte": {
        "icon": "mdi:lightbulb",
        "color": "#F59E0B",
        "display_name": "Beleuchtung",
    },
    "schalter": {
        "icon": "mdi:power-plug",
        "color": "#3B82F6",
        "display_name": "Geräte",
    },
    "jalousie": {
        "icon": "mdi:window-shutter",
        "color": "#6366F1",
        "display_name": "Jalousien",
    },
    "klima": {
        "icon": "mdi:thermometer",
        "color": "#EF4444",
        "display_name": "Klima",
    },
    "medien": {
        "icon": "mdi:speaker",
        "color": "#8B5CF6",
        "display_name": "Medien",
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
