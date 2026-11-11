// mock-data.js: High-fidelity fixtures reflecting SmartHome Companion OS setup
export const MOCK_DATA = {
  states: {
    // ── Julian Room ──
    'media_player.apple_tv': {
      entity_id: 'media_player.apple_tv',
      state: 'idle',
      attributes: { friendly_name: 'Apple TV', supported_features: 152447 },
    },
    'light.schreibtisch_lampe': {
      entity_id: 'light.schreibtisch_lampe',
      state: 'off',
      attributes: { friendly_name: 'Schreibtisch-Lampe', supported_color_modes: ['onoff'] },
    },
    'light.lichtstreifen': {
      entity_id: 'light.lichtstreifen',
      state: 'on',
      attributes: {
        friendly_name: 'Lichtstreifen',
        brightness: 188, // 74%
        rgb_color: [255, 128, 140],
        supported_color_modes: ['brightness', 'rgb'],
      },
    },
    'light.bettlampe': {
      entity_id: 'light.bettlampe',
      state: 'on',
      attributes: {
        friendly_name: 'Bettlampe',
        brightness: 26, // 10%
        supported_color_modes: ['brightness'],
      },
    },
    'light.lavalampe': {
      entity_id: 'light.lavalampe',
      state: 'off',
      attributes: { friendly_name: 'Lavalampe', supported_color_modes: ['onoff'] },
    },
    'light.deckenlampe_1': {
      entity_id: 'light.deckenlampe_1',
      state: 'on',
      attributes: { friendly_name: 'Deckenlampe Links 1', brightness: 107, supported_color_modes: ['brightness'] },
    },
    'light.deckenlampe_2': {
      entity_id: 'light.deckenlampe_2',
      state: 'on',
      attributes: { friendly_name: 'Deckenlampe Links 2', brightness: 107, supported_color_modes: ['brightness'] },
    },
    'light.deckenlampe_3': {
      entity_id: 'light.deckenlampe_3',
      state: 'off',
      attributes: { friendly_name: 'Deckenlampe Rechts 1', brightness: 107, supported_color_modes: ['brightness'] },
    },
    'light.deckenlampe_4': {
      entity_id: 'light.deckenlampe_4',
      state: 'off',
      attributes: { friendly_name: 'Deckenlampe Rechts 2', brightness: 107, supported_color_modes: ['brightness'] },
    },
    'sensor.temperatur_julian': {
      entity_id: 'sensor.temperatur_julian',
      state: '21.4',
      attributes: { friendly_name: 'Temperatur', unit_of_measurement: '°C', device_class: 'temperature' },
    },
    'sensor.luftfeuchtigkeit_julian': {
      entity_id: 'sensor.luftfeuchtigkeit_julian',
      state: '48',
      attributes: { friendly_name: 'Luftfeuchtigkeit', unit_of_measurement: '%', device_class: 'humidity' },
    },

    // ── Wohnzimmer Room ──
    'cover.rollladen_wohnzimmer': {
      entity_id: 'cover.rollladen_wohnzimmer',
      state: 'open',
      attributes: { friendly_name: 'Rollladen Wohnzimmer', current_position: 65, device_class: 'shutter' },
    },
    'light.wohnzimmer_deckenleuchte': {
      entity_id: 'light.wohnzimmer_deckenleuchte',
      state: 'off',
      attributes: { friendly_name: 'Deckenleuchte', supported_color_modes: ['brightness'] },
    },
    'sensor.temperatur_wohnzimmer': {
      entity_id: 'sensor.temperatur_wohnzimmer',
      state: '22.0',
      attributes: { friendly_name: 'Temperatur Wohnzimmer', unit_of_measurement: '°C', device_class: 'temperature' },
    },

    // ── Garten Room ──
    'switch.wasserpumpe_fenster': {
      entity_id: 'switch.wasserpumpe_fenster',
      state: 'off',
      attributes: { friendly_name: 'Wasserpumpe Fenster' },
    },
    'switch.doppelschalter_garten_1': {
      entity_id: 'switch.doppelschalter_garten_1',
      state: 'on',
      attributes: { friendly_name: 'Gartenbeleuchtung Nord' },
    },
    'switch.doppelschalter_garten_2': {
      entity_id: 'switch.doppelschalter_garten_2',
      state: 'off',
      attributes: { friendly_name: 'Teichpumpe' },
    },
    'sensor.temperatur_garten': {
      entity_id: 'sensor.temperatur_garten',
      state: '3.2',
      attributes: { friendly_name: 'Außentemperatur', unit_of_measurement: '°C', device_class: 'temperature' },
    },

    // ── DWD Weather Warning ──
    'sensor.stadt_grevenbroich_aktuelle_warnstufe': {
      entity_id: 'sensor.stadt_grevenbroich_aktuelle_warnstufe',
      state: '2',
      attributes: {
        friendly_name: 'Aktuelle Warnstufe',
        warning_count: 1,
        warning_1_level: 2,
        warning_1_headline: 'WARNUNG vor FROST',
        warning_1_start: '2026-11-11T20:00:00Z',
        warning_1_end: '2026-11-12T09:00:00Z',
        warning_1_description: 'Es tritt mäßiger Frost zwischen -2 °C und -5 °C auf. In Bodennähe wird strenger Frost bis -8 °C erwartet.',
        warning_1_instruction: 'Verkehrsteilnehmer sollten sich auf Glätte durch Reif oder überfrierende Nässe einstellen. Pflanzen vor Frost schützen.',
      },
    },

    // ── System / Trash / Weather ──
    'sensor.abfall_papier': {
      entity_id: 'sensor.abfall_papier',
      state: 'Heute',
      attributes: { friendly_name: 'Papiermüll', days: 0 },
    },
    'sensor.abfall_restmuell': {
      entity_id: 'sensor.abfall_restmuell',
      state: 'In 4 Tagen',
      attributes: { friendly_name: 'Restmüll', days: 4 },
    },
    'weather.home': {
      entity_id: 'weather.home',
      state: 'partlycloudy',
      attributes: { temperature: 3.2, friendly_name: 'Wetter' },
    },
  },

  areas: [
    { area_id: 'julian', name: 'Julian', icon: 'mdi:home' },
    { area_id: 'wohnzimmer', name: 'Wohnzimmer', icon: 'mdi:sofa' },
    { area_id: 'garten', name: 'Garten', icon: 'mdi:sprout' },
  ],

  devices: [
    { id: 'dev_appletv', name: 'Apple TV', manufacturer: 'Apple', model: 'Apple TV 4K', area_id: 'julian' },
    { id: 'dev_schreibtisch', name: 'Schreibtisch-Lampe', manufacturer: 'IKEA', model: 'TRADFRI bulb', area_id: 'julian' },
    { id: 'dev_lichtstreifen', name: 'Lichtstreifen', manufacturer: 'Philips Hue', model: 'Lightstrip Plus', area_id: 'julian' },
    { id: 'dev_bettlampe', name: 'Bettlampe', manufacturer: 'Xiaomi', model: 'Bedside Lamp', area_id: 'julian' },
    { id: 'dev_lavalampe', name: 'Lavalampe', manufacturer: 'Sonoff', model: 'S26', area_id: 'julian' },
    { id: 'dev_shelly2pm', name: 'Doppelschalter Garten', manufacturer: 'Shelly', model: 'Shelly 2PM Gen3', area_id: 'garten' },
    { id: 'dev_wasserpumpe', name: 'Wasserpumpe Fenster', manufacturer: 'Tuya', model: 'Smart Plug', area_id: 'garten' },
    { id: 'dev_rollladen_wz', name: 'Rollladen Wohnzimmer', manufacturer: 'Somfy', model: 'RTS IO', area_id: 'wohnzimmer' },
  ],

  entities: [
    { entity_id: 'media_player.apple_tv', device_id: 'dev_appletv', area_id: 'julian', name: 'Apple TV' },
    { entity_id: 'light.schreibtisch_lampe', device_id: 'dev_schreibtisch', area_id: 'julian', name: 'Schreibtisch-Lampe' },
    { entity_id: 'light.lichtstreifen', device_id: 'dev_lichtstreifen', area_id: 'julian', name: 'Lichtstreifen' },
    { entity_id: 'light.bettlampe', device_id: 'dev_bettlampe', area_id: 'julian', name: 'Bettlampe' },
    { entity_id: 'light.lavalampe', device_id: 'dev_lavalampe', area_id: 'julian', name: 'Lavalampe' },
    { entity_id: 'switch.doppelschalter_garten_1', device_id: 'dev_shelly2pm', area_id: 'garten', name: 'Kanal 1 Garten Nord' },
    { entity_id: 'switch.doppelschalter_garten_2', device_id: 'dev_shelly2pm', area_id: 'garten', name: 'Kanal 2 Teichpumpe' },
    { entity_id: 'switch.wasserpumpe_fenster', device_id: 'dev_wasserpumpe', area_id: 'garten', name: 'Wasserpumpe Fenster' },
    { entity_id: 'cover.rollladen_wohnzimmer', device_id: 'dev_rollladen_wz', area_id: 'wohnzimmer', name: 'Rollladen Wohnzimmer' },
  ],

  groups: {
    'group_rechts': {
      id: 'group_rechts',
      name: 'Lampen Rechts',
      area_id: 'julian',
      category: 'leuchte',
      icon: 'mdi:lightbulb-group',
      children: ['light.deckenlampe_3', 'light.deckenlampe_4'],
    },
    'group_links': {
      id: 'group_links',
      name: 'Lampen Links',
      area_id: 'julian',
      category: 'leuchte',
      icon: 'mdi:lightbulb-group',
      children: ['light.deckenlampe_1', 'light.deckenlampe_2'],
    },
    'group_master': {
      id: 'group_master',
      name: 'Deckenlampen Master',
      area_id: 'julian',
      category: 'leuchte',
      icon: 'mdi:lightbulb-group',
      children: ['group_links', 'group_rechts'],
    },
  },

  config: {
    color_presets: [
      [255, 128, 140],
      [150, 200, 255],
      [160, 255, 200],
      [255, 160, 50],
    ],
    greeting_name: 'Julian',
    weather_entity: 'weather.forecast_grevenbroich',
    weather_temp_entity: 'sensor.temperatur_grevenbroich',
    warning_entity: 'sensor.stadt_grevenbroich_aktuelle_warnstufe',
    warning: {
      entity_id: 'sensor.stadt_grevenbroich_aktuelle_warnstufe',
      headline_attribute: 'warning_1_headline',
    },
    ww_push_entity: 'switch.warmwasser_push',
    rooms: [
      { id: 'wohnzimmer', name: 'Wohnzimmer', icon: 'mdi:sofa' },
      { id: 'julian', name: 'Julian', icon: 'mdi:home' },
      { id: 'garten', name: 'Garten', icon: 'mdi:sprout' },
    ],
  },

  layout: {
    greeting: 'Gute Nacht, Julian',
    greeting_icon: 'mdi:weather-partly-cloudy',
    warning: {
      entity_id: 'sensor.stadt_grevenbroich_aktuelle_warnstufe',
      name: 'WARNUNG vor FROST',
      level: 2,
      count: 1,
      color: '#ff9800',
    },
    trash: [
      { id: 'papier', name: 'Papier', due: 'Heute', color: '#2196f3', icon: 'mdi:delete' },
      { id: 'rest', name: 'Restmüll', due: 'In 4 Tagen', color: '#64748b', icon: 'mdi:delete' },
    ],
    badges: [
      { id: 'lights_on', label: 'Lichter an', count: 2, color: '#ffc107', icon: 'mdi:lightbulb' },
      { id: 'temp_out', label: 'Außen', value: '3,2 °C', icon: 'mdi:thermometer' },
      { id: 'weather', label: 'Wetter', value: 'Teilweise bewölkt', icon: 'mdi:weather-partly-cloudy' },
    ],
    alerts: [],
    persons: [],
    announcement: null,
    rooms: [
      {
        area_id: 'julian',
        name: 'Julian',
        icon: 'mdi:home',
        always_open: true,
        sensors: {
          temperature: ['sensor.temperatur_julian'],
          humidity: ['sensor.luftfeuchtigkeit_julian'],
        },
        tiles: [
          { key: 'dev_appletv:media', entity_id: 'media_player.apple_tv', name: 'Apple TV', category: 'fernseher', icon: 'mdi:television' },
          { key: 'dev_schreibtisch:light', entity_id: 'light.schreibtisch_lampe', name: 'Schreibtisch-Lampe', category: 'leuchte', icon: 'mdi:lightbulb' },
          { key: 'dev_lichtstreifen:light', entity_id: 'light.lichtstreifen', name: 'Lichtstreifen', category: 'leuchte', icon: 'mdi:lightbulb' },
          { key: 'dev_bettlampe:light', entity_id: 'light.bettlampe', name: 'Bettlampe', category: 'leuchte', icon: 'mdi:lightbulb' },
          { key: 'dev_lavalampe:light', entity_id: 'light.lavalampe', name: 'Lavalampe', category: 'leuchte', icon: 'mdi:lightbulb' },
          {
            key: 'group:group_master',
            is_group: true,
            group_id: 'group_master',
            name: 'Deckenlampen Master',
            category: 'leuchte',
            icon: 'mdi:lightbulb-group',
            area_id: 'julian',
            entity_ids: ['light.deckenlampe_1', 'light.deckenlampe_2', 'light.deckenlampe_3', 'light.deckenlampe_4'],
            children: [
              {
                key: 'group:group_links',
                is_group: true,
                group_id: 'group_links',
                name: 'Lampen Links',
                category: 'leuchte',
                icon: 'mdi:lightbulb-group',
                area_id: 'julian',
                entity_ids: ['light.deckenlampe_1', 'light.deckenlampe_2'],
                children: [
                  { key: 'dev_dl1:light', entity_id: 'light.deckenlampe_1', name: 'Deckenlampe Links 1', category: 'leuchte', icon: 'mdi:lightbulb' },
                  { key: 'dev_dl2:light', entity_id: 'light.deckenlampe_2', name: 'Deckenlampe Links 2', category: 'leuchte', icon: 'mdi:lightbulb' },
                ],
              },
              {
                key: 'group:group_rechts',
                is_group: true,
                group_id: 'group_rechts',
                name: 'Lampen Rechts',
                category: 'leuchte',
                icon: 'mdi:lightbulb-group',
                area_id: 'julian',
                entity_ids: ['light.deckenlampe_3', 'light.deckenlampe_4'],
                children: [
                  { key: 'dev_dl3:light', entity_id: 'light.deckenlampe_3', name: 'Deckenlampe Rechts 1', category: 'leuchte', icon: 'mdi:lightbulb' },
                  { key: 'dev_dl4:light', entity_id: 'light.deckenlampe_4', name: 'Deckenlampe Rechts 2', category: 'leuchte', icon: 'mdi:lightbulb' },
                ],
              },
            ],
          },
        ],
      },
      {
        area_id: 'wohnzimmer',
        name: 'Wohnzimmer',
        icon: 'mdi:sofa',
        always_open: false,
        sensors: {
          temperature: ['sensor.temperatur_wohnzimmer'],
        },
        tiles: [
          { key: 'dev_rollladen_wz:cover', entity_id: 'cover.rollladen_wohnzimmer', name: 'Rollladen Wohnzimmer', category: 'jalousie', icon: 'mdi:window-shutter' },
          { key: 'dev_wz_light:light', entity_id: 'light.wohnzimmer_deckenleuchte', name: 'Deckenleuchte', category: 'leuchte', icon: 'mdi:lightbulb' },
        ],
      },
      {
        area_id: 'garten',
        name: 'Garten',
        icon: 'mdi:sprout',
        always_open: false,
        sensors: {
          temperature: ['sensor.temperatur_garten'],
        },
        tiles: [
          { key: 'dev_wasserpumpe:switch', entity_id: 'switch.wasserpumpe_fenster', name: 'Wasserpumpe Fenster', category: 'pumpe', icon: 'mdi:power-plug' },
          { key: 'd:dev_shelly2pm:switch.doppelschalter_garten_1', device_id: 'dev_shelly2pm', entity_id: 'switch.doppelschalter_garten_1', name: 'Gartenbeleuchtung Nord', category: 'schalter', icon: 'mdi:power-plug' },
          { key: 'd:dev_shelly2pm:switch.doppelschalter_garten_2', device_id: 'dev_shelly2pm', entity_id: 'switch.doppelschalter_garten_2', name: 'Teichpumpe', category: 'pumpe', icon: 'mdi:power-plug' },
        ],
      },
    ],
    nav: {
      left: { label: 'Sicherheit', icon: 'mdi:shield-check' },
      right: { label: 'Räume', icon: 'mdi:home-outline' },
    },
    config: {
      color_presets: [
        [255, 128, 140],
        [150, 200, 255],
        [160, 255, 200],
        [255, 160, 50],
      ],
    },
  },
};
