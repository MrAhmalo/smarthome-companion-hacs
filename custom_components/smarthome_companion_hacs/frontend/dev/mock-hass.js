// mock-hass.js: Standalone In-Memory Mock of Home Assistant Frontend Contract
import { MOCK_DATA } from './mock-data.js';

export class MockHass {
  constructor(panelElement) {
    this.panel = panelElement;
    this.states = JSON.parse(JSON.stringify(MOCK_DATA.states));
    this.user = { id: 'dev-user-julian', name: 'Julian', is_admin: true };
    this.themes = { darkMode: true };
    this.language = 'de';
    this.locale = { language: 'de' };
    this.config = { version: '2026.11.0' };
    this.groups = JSON.parse(JSON.stringify(MOCK_DATA.groups));
    this.layout = JSON.parse(JSON.stringify(MOCK_DATA.layout));

    this.connection = {
      subscribeMessage: (callback) => {
        return Promise.resolve(() => {});
      },
    };
  }

  async callWS(msg) {
    if (msg.type === 'smarthome_companion/dashboard/get') {
      return {
        config: JSON.parse(JSON.stringify(this.configData || MOCK_DATA.config)),
        layout: JSON.parse(JSON.stringify(this.layout)),
        user: this.user,
      };
    }
    if (msg.type === 'smarthome_companion/dashboard/layout') {
      return JSON.parse(JSON.stringify(this.layout));
    }
    if (msg.type === 'smarthome_companion/dashboard/users') {
      return { users: [this.user] };
    }
    if (msg.type === 'config/device_registry/list') {
      return JSON.parse(JSON.stringify(MOCK_DATA.devices));
    }
    if (msg.type === 'config/entity_registry/list') {
      return JSON.parse(JSON.stringify(MOCK_DATA.entities));
    }
    if (msg.type === 'config/area_registry/list') {
      return JSON.parse(JSON.stringify(MOCK_DATA.areas));
    }
    if (msg.type === 'smarthome_companion/devices/get') {
      return {
        devices: {},
        categories: {},
        groups: this.groups,
      };
    }
    if (msg.type === 'smarthome_companion/groups/save') {
      const g = msg.group;
      const gid = g.id || `group_${Date.now()}`;
      g.id = gid;
      this.groups[gid] = g;
      return { success: true, group_id: gid, group: g };
    }
    if (msg.type === 'smarthome_companion/groups/delete') {
      delete this.groups[msg.group_id];
      return { success: true };
    }
    if (msg.type === 'smarthome_companion/dashboard/save') {
      this.layout.config = msg.config;
      return { success: true, config: msg.config };
    }
    return {};
  }

  async callService(domain, service, data = {}) {
    const eid = data.entity_id;
    if (!eid) return;

    const targets = Array.isArray(eid) ? eid : [eid];
    for (const target of targets) {
      const st = this.states[target];
      if (!st) continue;

      if (service === 'turn_on') {
        st.state = 'on';
        if (data.brightness !== undefined) {
          st.attributes.brightness = data.brightness;
        } else if (data.brightness_pct !== undefined) {
          st.attributes.brightness = Math.round((data.brightness_pct / 100) * 255);
        }
        if (data.rgb_color) {
          st.attributes.rgb_color = data.rgb_color;
        }
      } else if (service === 'turn_off') {
        st.state = 'off';
      } else if (service === 'toggle') {
        st.state = st.state === 'on' ? 'off' : 'on';
      } else if (service === 'open_cover') {
        st.state = 'open';
        st.attributes.current_position = 100;
      } else if (service === 'close_cover') {
        st.state = 'closed';
        st.attributes.current_position = 0;
      } else if (service === 'stop_cover') {
        // keep current position
      } else if (service === 'set_cover_position') {
        st.attributes.current_position = data.position;
        st.state = data.position === 0 ? 'closed' : 'open';
      } else if (service === 'media_play_pause') {
        st.state = st.state === 'playing' ? 'paused' : 'playing';
      }
    }

    this._notify();
  }

  _notify() {
    if (this.panel) {
      // Trigger reactive update on WebComponent
      this.panel.hass = { ...this };
    }
  }

  updateState(entityId, state, attributes = {}) {
    if (this.states[entityId]) {
      this.states[entityId].state = state;
      Object.assign(this.states[entityId].attributes, attributes);
      this._notify();
    }
  }

  applyScenario(scenario) {
    if (scenario === 'all_on') {
      for (const [id, st] of Object.entries(this.states)) {
        if (id.startsWith('light.') || id.startsWith('switch.')) {
          st.state = 'on';
          if (st.attributes.brightness !== undefined) st.attributes.brightness = 200;
        }
      }
    } else if (scenario === 'all_off') {
      for (const [id, st] of Object.entries(this.states)) {
        if (id.startsWith('light.') || id.startsWith('switch.')) {
          st.state = 'off';
        }
      }
    } else if (scenario === 'warning_cleared') {
      this.states['sensor.stadt_grevenbroich_aktuelle_warnstufe'].attributes.warning_count = 0;
      this.states['sensor.stadt_grevenbroich_aktuelle_warnstufe'].state = '0';
      this.layout.warning = null;
    } else if (scenario === 'warning_frost') {
      this.states['sensor.stadt_grevenbroich_aktuelle_warnstufe'].attributes.warning_count = 1;
      this.states['sensor.stadt_grevenbroich_aktuelle_warnstufe'].state = '2';
      this.layout.warning = MOCK_DATA.layout.warning;
    }
    this._notify();
  }
}
