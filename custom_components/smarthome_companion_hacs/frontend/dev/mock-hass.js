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
    this.areas = JSON.parse(JSON.stringify(MOCK_DATA.areas || []));
    this.deviceRegistry = JSON.parse(JSON.stringify(MOCK_DATA.devices || []));
    this.entityRegistry = JSON.parse(JSON.stringify(MOCK_DATA.entities || []));
    this.configData = JSON.parse(JSON.stringify(MOCK_DATA.config));
    this.configData.pinned_tiles ||= [];
    this.configData.tile_order ||= {};
    this.configData.tile_layout ||= {};
    this.configuredDevices = {};
    this.hybrids = JSON.parse(JSON.stringify(MOCK_DATA.hybrids || {}));
    this.hybridSettings = { preferred_protocol: 'zigbee', failover_timeout_s: 1.8, event_debounce_ms: 400 };
    this.dismissedHybridPairs = [];
    this.hybridProposals = JSON.parse(JSON.stringify(MOCK_DATA.hybrid_proposals || []));
    this.layout = JSON.parse(JSON.stringify(MOCK_DATA.layout));
    for (const room of (this.layout.rooms || [])) {
      for (const t of (room.tiles || [])) {
        if (t.is_group) continue;
        const keyStr = String(t.key || '');
        const devId = t.device_id || (keyStr.includes(':') ? keyStr.split(':')[0] : '');
        if (devId && !t.device_id) t.device_id = devId;
        if (devId && !this.configuredDevices[devId]) {
          this.configuredDevices[devId] = {
            device_id: devId,
            category: t.category || 'leuchte',
            custom_name: t.name || devId,
            area_id: room.area_id || '',
            icon: t.icon,
            options: { pinned: !!t.pinned, force_own_row: !!t.force_own_row },
            entities: t.entity_id ? { primary: t.entity_id } : {},
          };
        }
      }
    }
    this._rebuildRoomTileOrder();

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
      return JSON.parse(JSON.stringify(this.deviceRegistry));
    }
    if (msg.type === 'config/entity_registry/list') {
      return JSON.parse(JSON.stringify(this.entityRegistry));
    }
    if (msg.type === 'config/area_registry/list') {
      return JSON.parse(JSON.stringify(this.areas));
    }
    if (msg.type === 'smarthome_companion/groups/list') {
      return { groups: JSON.parse(JSON.stringify(this.groups)) };
    }
    if (msg.type === 'smarthome_companion/devices/get') {
      const hiddenDevs = [];
      for (const hCfg of Object.values(this.hybrids || {})) {
        for (const tInfo of Object.values(hCfg?.transports || {})) {
          if (tInfo?.device_id) hiddenDevs.push(tInfo.device_id);
        }
      }
      return {
        devices: JSON.parse(JSON.stringify(this.configuredDevices)),
        categories: {},
        groups: JSON.parse(JSON.stringify(this.groups)),
        hybrids: JSON.parse(JSON.stringify(this.hybrids || {})),
        hybrid_settings: JSON.parse(JSON.stringify(this.hybridSettings || {})),
        hidden_hybrid_device_ids: hiddenDevs,
      };
    }
    if (msg.type === 'smarthome_companion/hybrids/get') {
      return {
        hybrids: JSON.parse(JSON.stringify(this.hybrids || {})),
        hybrid_settings: JSON.parse(JSON.stringify(this.hybridSettings || {})),
        dismissed_hybrid_pairs: [...(this.dismissedHybridPairs || [])],
      };
    }
    if (msg.type === 'smarthome_companion/hybrids/discover') {
      const linkedIds = new Set();
      for (const hCfg of Object.values(this.hybrids || {})) {
        for (const tInfo of Object.values(hCfg?.transports || {})) {
          if (tInfo?.device_id) linkedIds.add(tInfo.device_id);
        }
      }
      const dismissed = new Set(this.dismissedHybridPairs || []);
      const proposals = (this.hybridProposals || []).filter(
        (p) => !dismissed.has(p.pair_key) && !(p.devices || []).some((d) => linkedIds.has(d.device_id)),
      );
      return {
        proposals: JSON.parse(JSON.stringify(proposals)),
        hybrids: JSON.parse(JSON.stringify(this.hybrids || {})),
        hybrid_settings: JSON.parse(JSON.stringify(this.hybridSettings || {})),
      };
    }
    if (msg.type === 'smarthome_companion/hybrids/dismiss_pair') {
      if (msg.pair_key && !this.dismissedHybridPairs.includes(msg.pair_key)) {
        this.dismissedHybridPairs.push(msg.pair_key);
      }
      return { success: true, pair_key: msg.pair_key };
    }
    if (msg.type === 'smarthome_companion/hybrids/settings') {
      if (msg.preferred_protocol) this.hybridSettings.preferred_protocol = msg.preferred_protocol;
      if (msg.failover_timeout_s !== undefined) this.hybridSettings.failover_timeout_s = Number(msg.failover_timeout_s);
      if (msg.event_debounce_ms !== undefined) this.hybridSettings.event_debounce_ms = Number(msg.event_debounce_ms);
      return { success: true, hybrid_settings: JSON.parse(JSON.stringify(this.hybridSettings)) };
    }
    if (msg.type === 'smarthome_companion/hybrids/save') {
      const hid = msg.hybrid_id || msg.id || `hybrid_${Date.now()}`;
      const existing = this.hybrids[hid] || {};
      const slugify = (s) => String(s || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const name = msg.name || existing.name || 'Hybrid-Gerät';
      const areaId = msg.area_id !== undefined ? (msg.area_id || '') : (existing.area_id || '');
      const areaName = this.areas.find((a) => a.area_id === areaId)?.name || '';
      const baseSlug = [slugify(areaName), slugify(name)].filter(Boolean).join('_').replace(new RegExp(`^(${slugify(areaName)}_)+`), slugify(areaName) ? `${slugify(areaName)}_` : '');
      const masterDevId = existing.master_device_id || `dev_${hid}`;
      const transports = {};
      for (const [proto, val] of Object.entries(msg.transports || existing.transports || {})) {
        const did = typeof val === 'object' ? val.device_id : val;
        if (did) transports[proto] = { device_id: did };
      }
      const firstProto = msg.preferred_protocol || this.hybridSettings.preferred_protocol || Object.keys(transports)[0] || 'zigbee';
      const activeProto = transports[firstProto] ? firstProto : (Object.keys(transports)[0] || 'zigbee');
      const primarySrc = this.entityRegistry.find((e) => e.device_id === transports[activeProto]?.device_id && /^(light|switch|cover)\./.test(e.entity_id));
      const dom = primarySrc ? primarySrc.entity_id.split('.')[0] : 'switch';
      const masterEid = `${dom}.${baseSlug || hid}`;
      if (!this.deviceRegistry.some((d) => d.id === masterDevId)) {
        this.deviceRegistry.push({
          id: masterDevId,
          name,
          manufacturer: 'SmartHome Companion',
          model: 'Hybrid Master',
          area_id: areaId || null,
          identifiers: [['smarthome_companion_hacs', `hybrid_${hid}`]],
        });
      } else {
        const md = this.deviceRegistry.find((d) => d.id === masterDevId);
        if (md) { md.name = name; md.area_id = areaId || null; }
      }
      if (!this.entityRegistry.some((e) => e.entity_id === masterEid)) {
        this.entityRegistry.push({
          entity_id: masterEid,
          device_id: masterDevId,
          area_id: areaId || null,
          platform: 'smarthome_companion_hacs',
          name,
          disabled_by: null,
        });
      }
      this.states[masterEid] = {
        entity_id: masterEid,
        state: 'off',
        attributes: { friendly_name: areaName ? `${areaName} ${name}` : name, active_transport: activeProto },
      };
      const record = {
        id: hid,
        name,
        area_id: areaId,
        category: msg.category || existing.category || 'schalter',
        icon: msg.icon || existing.icon || null,
        preferred_protocol: msg.preferred_protocol !== undefined ? (msg.preferred_protocol || null) : (existing.preferred_protocol || null),
        master_device_id: masterDevId,
        transports,
        channels: [{ master_entity_id: masterEid, domain: dom, category: msg.category || existing.category || 'schalter', sources: {} }],
      };
      this.hybrids[hid] = record;
      this.configuredDevices[masterDevId] = {
        device_id: masterDevId,
        hybrid_id: hid,
        category: record.category,
        custom_name: name,
        area_id: areaId,
        icon: record.icon,
        options: { hybrid_id: hid },
        entities: { primary: masterEid },
      };
      const adoptedId = msg.adopted_device_id;
      if (adoptedId && this.configuredDevices[adoptedId]) delete this.configuredDevices[adoptedId];
      for (const tInfo of Object.values(transports)) {
        const tdId = tInfo.device_id;
        for (const r of (this.layout.rooms || [])) {
          r.tiles = (r.tiles || []).filter((t) => t.device_id !== tdId);
        }
      }
      const destRoom = (this.layout.rooms || []).find((r) => r.area_id === areaId) || this.layout.rooms?.[0];
      if (destRoom && !(destRoom.tiles || []).some((t) => t.device_id === masterDevId)) {
        destRoom.tiles.push({
          key: `${masterDevId}:${masterEid}`,
          device_id: masterDevId,
          hybrid_id: hid,
          entity_id: masterEid,
          name,
          category: record.category,
          icon: record.icon || 'mdi:lightbulb',
        });
      }
      this._rebuildRoomTileOrder();
      return { success: true, hybrid: JSON.parse(JSON.stringify(record)) };
    }
    if (msg.type === 'smarthome_companion/hybrids/unpair') {
      const hid = msg.hybrid_id;
      const hCfg = this.hybrids[hid];
      if (hCfg) {
        const mId = hCfg.master_device_id;
        delete this.hybrids[hid];
        if (mId) {
          delete this.configuredDevices[mId];
          this.deviceRegistry = this.deviceRegistry.filter((d) => d.id !== mId);
          this.entityRegistry = this.entityRegistry.filter((e) => e.device_id !== mId);
          for (const r of (this.layout.rooms || [])) {
            r.tiles = (r.tiles || []).filter((t) => t.device_id !== mId && t.hybrid_id !== hid);
          }
        }
      }
      return { success: true, hybrid_id: hid };
    }
    if (msg.type === 'smarthome_companion/devices/configure') {
      const devId = msg.device_id;
      const prevArea = this.configuredDevices[devId]?.area_id || '';
      const nextArea = msg.area_id !== undefined ? (msg.area_id || '') : prevArea;
      this.configuredDevices[devId] = {
        device_id: devId,
        category: msg.category,
        custom_name: msg.custom_name,
        area_id: nextArea,
        icon: msg.icon,
        options: msg.options || {},
        entities: msg.entities || {},
      };
      const devReg = this.deviceRegistry.find((d) => d.id === devId);
      if (devReg && msg.area_id !== undefined) devReg.area_id = nextArea || null;

      const areaObj = this.areas.find((a) => a.area_id === nextArea);
      const areaName = (areaObj?.name || '').trim();
      const slugify = (s) => String(s || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const areaSlug = slugify(areaName);
      const renamed = {};

      const movedTiles = [];
      for (const room of (this.layout.rooms || [])) {
        const remaining = [];
        for (const t of (room.tiles || [])) {
          const matchesDev = t.device_id === devId || (typeof t.key === 'string' && (t.key.startsWith(`${devId}:`) || t.key.startsWith(`d:${devId}:`) || t.key === `bundled:${devId}`));
          if (matchesDev) {
            if (msg.custom_name) t.name = msg.custom_name;
            if (msg.category) t.category = msg.category;
            if (msg.icon) t.icon = msg.icon;
            if (msg.options) {
              t.pinned = !!msg.options.pinned;
              t.force_own_row = !!msg.options.force_own_row;
            }
            if (t.entity_id && msg.area_id !== undefined) {
              const oldEid = t.entity_id;
              const dom = oldEid.split('.')[0];
              const baseName = t.name || msg.custom_name || devId;
              const nameSlug = slugify(baseName);
              const targetSlug = (areaSlug && nameSlug && !nameSlug.startsWith(`${areaSlug}_`))
                ? `${areaSlug}_${nameSlug}` : nameSlug;
              const newEid = targetSlug ? `${dom}.${targetSlug}` : oldEid;
              const expectedFriendly = (areaName && baseName && !baseName.toLowerCase().startsWith(areaName.toLowerCase()))
                ? `${areaName} ${baseName}` : baseName;
              if (newEid !== oldEid && this.states[oldEid]) {
                this.states[newEid] = JSON.parse(JSON.stringify(this.states[oldEid]));
                delete this.states[oldEid];
                renamed[oldEid] = newEid;
                t.entity_id = newEid;
                if (typeof t.key === 'string' && t.key.endsWith(`:${oldEid}`)) {
                  t.key = t.key.slice(0, t.key.length - oldEid.length) + newEid;
                }
                if (this.configuredDevices[devId].entities?.primary === oldEid) {
                  this.configuredDevices[devId].entities.primary = newEid;
                }
                const erEntry = this.entityRegistry.find((e) => e.entity_id === oldEid);
                if (erEntry) { erEntry.entity_id = newEid; erEntry.area_id = nextArea || null; erEntry.name = expectedFriendly; }
              } else {
                const erEntry = this.entityRegistry.find((e) => e.entity_id === oldEid);
                if (erEntry) { erEntry.area_id = nextArea || null; erEntry.name = expectedFriendly; }
              }
              if (this.states[t.entity_id]?.attributes) {
                this.states[t.entity_id].attributes.friendly_name = expectedFriendly;
              }
            }
            if (nextArea && room.area_id !== nextArea) {
              movedTiles.push(t);
              continue;
            }
          }
          remaining.push(t);
        }
        room.tiles = remaining;
      }
      if (movedTiles.length && nextArea) {
        const destRoom = (this.layout.rooms || []).find((r) => r.area_id === nextArea);
        if (destRoom) destRoom.tiles.push(...movedTiles);
      }
      this._rebuildRoomTileOrder();
      return { success: true, renamed };
    }
    if (msg.type === 'smarthome_companion/groups/save') {
      const g = JSON.parse(JSON.stringify(msg.group));
      const gid = g.id || `group_${Date.now()}`;
      g.id = gid;
      this.groups[gid] = g;
      const nextArea = g.area_id || '';
      const areaObj = this.areas.find((a) => a.area_id === nextArea);
      const areaName = (areaObj?.name || '').trim();
      const slugify = (s) => String(s || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const areaSlug = slugify(areaName);
      const cleanSlug = slugify(g.name || 'gruppe');
      const fullSlug = (areaSlug && cleanSlug && !cleanSlug.startsWith(`${areaSlug}_`)) ? `${areaSlug}_${cleanSlug}` : cleanSlug;
      const expectedFriendly = (areaName && g.name && !g.name.toLowerCase().startsWith(areaName.toLowerCase()))
        ? `${areaName} ${g.name}` : (g.name || 'Gruppe');

      const movedGroups = [];
      for (const room of (this.layout.rooms || [])) {
        const remaining = [];
        for (const t of (room.tiles || [])) {
          if (t.is_group && t.group_id === gid) {
            t.name = g.name || t.name;
            t.category = g.category || t.category;
            t.icon = g.icon || t.icon;
            t.pinned = !!g.pinned;
            if (t.entity_id && nextArea) {
              const oldEid = t.entity_id;
              const targetEid = `light.${fullSlug}`;
              if (targetEid !== oldEid && this.states[oldEid]) {
                this.states[targetEid] = JSON.parse(JSON.stringify(this.states[oldEid]));
                delete this.states[oldEid];
                t.entity_id = targetEid;
              }
              if (this.states[t.entity_id]?.attributes) {
                this.states[t.entity_id].attributes.friendly_name = expectedFriendly;
              }
            }
            if (nextArea && room.area_id !== nextArea) {
              movedGroups.push(t);
              continue;
            }
          }
          remaining.push(t);
        }
        room.tiles = remaining;
      }
      if (movedGroups.length && nextArea) {
        const destRoom = (this.layout.rooms || []).find((r) => r.area_id === nextArea);
        if (destRoom) destRoom.tiles.push(...movedGroups);
      }
      this._rebuildRoomTileOrder();
      return { success: true, group_id: gid, group: g };
    }
    if (msg.type === 'smarthome_companion/groups/delete') {
      delete this.groups[msg.group_id];
      for (const room of (this.layout.rooms || [])) {
        room.tiles = (room.tiles || []).filter((t) => !(t.is_group && t.group_id === msg.group_id));
      }
      return { success: true };
    }
    if (msg.type === 'smarthome_companion/dashboard/tile_order') {
      const areaId = msg.area_id;
      this.configData.tile_order ||= {};
      this.configData.tile_layout ||= {};
      this.configData.pinned_tiles ||= [];
      if (Array.isArray(msg.tile_order)) {
        if (msg.tile_order.length) {
          this.configData.tile_order[areaId] = [...msg.tile_order];
        } else {
          delete this.configData.tile_order[areaId];
        }
      }
      if (msg.tile_layout && typeof msg.tile_layout === 'object') {
        const cleanLayout = {};
        for (const [k, v] of Object.entries(msg.tile_layout)) {
          if (v === 'compact' || v === 'wide') cleanLayout[k] = v;
        }
        if (Object.keys(cleanLayout).length) {
          this.configData.tile_layout[areaId] = cleanLayout;
        } else {
          delete this.configData.tile_layout[areaId];
        }
      }
      if (typeof msg.pin_key === 'string' && typeof msg.pinned === 'boolean') {
        const pinKey = msg.pin_key.trim();
        let pins = [...this.configData.pinned_tiles];
        if (msg.pinned) {
          if (pinKey && !pins.includes(pinKey)) pins.push(pinKey);
          if (areaId && Array.isArray(this.configData.tile_order[areaId])) {
            const devId = pinKey.startsWith('dev:') ? pinKey.slice(4) : '';
            const grpId = pinKey.startsWith('g:') ? pinKey.slice(2) : (pinKey.startsWith('group:') ? pinKey.slice(6) : '');
            const matchesPin = (k) => k === pinKey
              || (devId && (k.startsWith(`${devId}:`) || k.startsWith(`d:${devId}:`) || k === `bundled:${devId}`))
              || (grpId && (k === `g:${grpId}` || k === `group:${grpId}`));
            const filtered = this.configData.tile_order[areaId].filter((k) => !matchesPin(k));
            if (filtered.length) this.configData.tile_order[areaId] = filtered;
            else delete this.configData.tile_order[areaId];
          }
        } else {
          pins = pins.filter((k) => k !== pinKey);
        }
        this.configData.pinned_tiles = pins;
      }
      this._rebuildRoomTileOrder(areaId);
      return { success: true };
    }
    if (msg.type === 'smarthome_companion/dashboard/save') {
      this.configData = JSON.parse(JSON.stringify(msg.config));
      this.layout.config = JSON.parse(JSON.stringify(msg.config));
      this._rebuildRoomTileOrder();
      return { success: true, config: msg.config };
    }
    return {};
  }

  _rebuildRoomTileOrder(targetAreaId = null) {
    const CATEGORY_WEIGHT = {
      heating: 10, climate: 10, heizung: 10,
      door_window: 20, window: 20, door: 20, tuer_fenster: 20,
      lock: 30, schloss: 30,
      media_player: 40, tv: 40, fernseher: 40, speaker: 40, lautsprecher: 40,
      appliance: 45, haushaltsgeraet: 45,
      fan: 50, ventilator: 50,
      light: 60, leuchte: 60,
      switch: 65, schalter: 65,
      outlet: 70, steckdose: 70,
      valve: 75, ventil: 75, pumpe: 75,
      cover: 80, rollladen: 80,
      sensor: 90, bodenmessgeraet: 90, rauchmelder: 90,
      solar: 95,
    };
    const pinnedSet = new Set(this.configData?.pinned_tiles || []);
    for (const room of (this.layout.rooms || [])) {
      if (targetAreaId && room.area_id !== targetAreaId) continue;
      const tiles = room.tiles || [];
      const roomLayout = (this.configData?.tile_layout || {})[room.area_id] || {};
      for (const t of tiles) {
        const keyStr = String(t.key || '');
        const devId = t.device_id || (keyStr.includes(':') && !keyStr.startsWith('group:') && !keyStr.startsWith('g:') ? keyStr.split(':')[0] : '');
        const gid = t.group_id || (keyStr.startsWith('group:') ? keyStr.slice(6) : (keyStr.startsWith('g:') ? keyStr.slice(2) : ''));
        const devPinned = !!(devId && this.configuredDevices?.[devId]?.options?.pinned);
        const grpPinned = !!(gid && (this.groups?.[gid]?.pinned || this.groups?.[gid]?.options?.pinned));
        t.pinned = !!(
          pinnedSet.has(keyStr)
          || (devId && pinnedSet.has(`dev:${devId}`))
          || (gid && (pinnedSet.has(`g:${gid}`) || pinnedSet.has(`group:${gid}`)))
          || devPinned
          || grpPinned
        );
        const lm = roomLayout[t.key];
        t.layout_mode = (lm === 'compact' || lm === 'wide') ? lm : null;
      }
      const customOrder = (this.configData?.tile_order || {})[room.area_id] || [];
      const pos = new Map(customOrder.map((k, i) => [k, i]));
      const getSortPos = (t) => {
        if (pos.has(t.key)) return pos.get(t.key);
        if (t.pinned) {
          const w = CATEGORY_WEIGHT[t.category] ?? 50;
          const candidates = tiles
            .filter((o) => pos.has(o.key) && ((CATEGORY_WEIGHT[o.category] ?? 50) > w || ((CATEGORY_WEIGHT[o.category] ?? 50) === w && !o.pinned)))
            .map((o) => pos.get(o.key));
          if (candidates.length) return Math.min(...candidates) - 0.5;
          return pos.size ? pos.size - 0.5 : -0.5;
        }
        return 10000;
      };
      tiles.sort((a, b) => {
        if (customOrder.length) {
          const pa = getSortPos(a);
          const pb = getSortPos(b);
          if (pa !== pb) return pa - pb;
        }
        const wa = CATEGORY_WEIGHT[a.category] ?? 50;
        const wb = CATEGORY_WEIGHT[b.category] ?? 50;
        if (wa !== wb) return wa - wb;
        const pina = a.pinned ? 0 : 1;
        const pinb = b.pinned ? 0 : 1;
        if (pina !== pinb) return pina - pinb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'de');
      });
    }
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
      // Deep clone states so component value-checks and references strictly update
      this.states = JSON.parse(JSON.stringify(this.states));
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
    if (scenario === 'default') {
      this.states = JSON.parse(JSON.stringify(MOCK_DATA.states));
      this.layout.warning = MOCK_DATA.layout.warning;
    } else if (scenario === 'master_off') {
      this.states['light.deckenlampe_1'].state = 'off';
      this.states['light.deckenlampe_2'].state = 'off';
      this.states['light.deckenlampe_3'].state = 'off';
      this.states['light.deckenlampe_4'].state = 'off';
      this.states['light.schreibtisch_lampe'].state = 'off';
      this.states['light.lavalampe'].state = 'off';
      this.states['light.lichtstreifen'].state = 'on';
      this.states['light.lichtstreifen'].attributes.brightness = 188;
      this.states['light.bettlampe'].state = 'on';
      this.states['light.bettlampe'].attributes.brightness = 26;
    } else if (scenario === 'single_slider') {
      this.states['light.deckenlampe_1'].state = 'off';
      this.states['light.deckenlampe_2'].state = 'off';
      this.states['light.deckenlampe_3'].state = 'off';
      this.states['light.deckenlampe_4'].state = 'off';
      this.states['light.schreibtisch_lampe'].state = 'off';
      this.states['light.lavalampe'].state = 'off';
      this.states['light.bettlampe'].state = 'off';
      this.states['light.lichtstreifen'].state = 'on';
      this.states['light.lichtstreifen'].attributes.brightness = 188;
    } else if (scenario === 'all_on') {
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
