import math
import logging
from datetime import timedelta
from homeassistant.helpers.event import async_track_time_interval

_LOGGER = logging.getLogger(__name__)

class SunManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self.intensities = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        self._remove_update_listener = None

    async def async_setup(self):
        self._remove_update_listener = async_track_time_interval(
            self.hass, self._update_calculations, timedelta(minutes=2)
        )
        self.hass.async_create_task(self._update_calculations())
        
    async def _update_calculations(self, now=None):
        sun_state = self.hass.states.get("sun.sun")
        if not sun_state:
            return
            
        config = self.store.data.get("settings", {})
        cloud_sensor_id = config.get("cloud_sensor", "weather.forecast_home")
        
        cloud_coverage = 0.0
        cloud_state = self.hass.states.get(cloud_sensor_id)
        if cloud_state:
            if cloud_state.domain == "weather":
                try:
                    cloud_coverage = float(cloud_state.attributes.get("cloud_coverage", 0))
                except (ValueError, TypeError):
                    pass
            else:
                try:
                    cloud_coverage = float(cloud_state.state)
                except (ValueError, TypeError):
                    pass
                    
        try:
            elevation = float(sun_state.attributes.get("elevation", 0))
            azimuth = float(sun_state.attributes.get("azimuth", 0))
        except (ValueError, TypeError):
            return
            
        if elevation < 0:
            for d in self.intensities:
                self.intensities[d] = 0.0
        else:
            clear_sky = 1000.0 * math.sin(math.radians(elevation))
            diffuse = clear_sky * 0.15
            direct_normal = clear_sky * 0.85
            
            cloud_factor = 1.0 - (cloud_coverage / 100.0) * 0.75
            
            directions = {"nord": 0, "ost": 90, "sued": 180, "west": 270}
            for d_name, d_azi in directions.items():
                diff = abs(azimuth - d_azi) % 360
                if diff > 180:
                    diff = 360 - diff
                    
                if diff < 90:
                    direct = direct_normal * math.cos(math.radians(elevation)) * math.cos(math.radians(diff))
                else:
                    direct = 0.0
                    
                total = (direct + diffuse) * cloud_factor
                self.intensities[d_name] = max(0.0, total)
                
        self.hass.bus.async_fire("smarthome_companion_sun_updated")
