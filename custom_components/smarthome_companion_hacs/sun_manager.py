import math
import logging
from datetime import timedelta, datetime
from homeassistant.helpers.event import async_track_time_interval

_LOGGER = logging.getLogger(__name__)

class SunManager:
    def __init__(self, hass, store):
        self.hass = hass
        self.store = store
        self.intensities = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        self.forecast_max_intensities = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        self.global_shading_needed = False
        self.forecast_max_intensities_tomorrow = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        self.global_shading_needed_tomorrow = False
        self.facade_times = {"today": {}, "tomorrow": {}}
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
            self._calc_intensities(elevation, azimuth, cloud_coverage, self.intensities)
            
        # Update forecasts every 30 mins
        if getattr(self, "_last_forecast_update", None) is None or (now and (now - self._last_forecast_update) > timedelta(minutes=30)):
            self.hass.async_create_task(self._update_forecasts(now))
            if now:
                self._last_forecast_update = now
                
        self.hass.bus.async_fire("smarthome_companion_sun_updated")

    def _calc_intensities(self, elevation, azimuth, cloud_coverage, target_dict):
        if elevation < 0:
            for d in target_dict:
                target_dict[d] = 0.0
            return

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
            target_dict[d_name] = max(0.0, total)

    async def _update_forecasts(self, now):
        import homeassistant.util.dt as dt_util
        if not now:
            now = dt_util.now()
            
        settings = self.store.data.get("settings", {})
        weather_entity = settings.get("cloud_sensor")
        if not weather_entity or not weather_entity.startswith("weather."):
            weather_entity = settings.get("irrigation_weather_entity", "weather.forecast_home")
        
        try:
            response = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"entity_id": weather_entity, "type": "hourly"},
                blocking=True,
                return_response=True,
            )
        except Exception:
            return
            
        if not response or weather_entity not in response:
            return
            
        forecasts = response[weather_entity].get("forecast", [])
        if not forecasts:
            return
            
        today = now.date()
        tomorrow = today + timedelta(days=1)
        lat = self.hass.config.latitude
        lon = self.hass.config.longitude
        
        # Calculate facade times
        self.facade_times["today"] = self._calc_facade_times(datetime.combine(today, datetime.min.time(), tzinfo=dt_util.UTC), lat, lon)
        self.facade_times["tomorrow"] = self._calc_facade_times(datetime.combine(tomorrow, datetime.min.time(), tzinfo=dt_util.UTC), lat, lon)

        max_f = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        max_f_tom = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
        
        for f in forecasts:
            dt_str = f.get("datetime")
            if not dt_str:
                continue
            try:
                f_dt = dt_util.parse_datetime(dt_str)
            except Exception:
                continue
                
            f_date = f_dt.date()
            if f_date != today and f_date != tomorrow:
                if f_date > tomorrow:
                    break
                continue
                
            cloud_coverage = f.get("cloud_coverage")
            if cloud_coverage is None:
                condition = f.get("condition", "")
                if condition in ["sunny", "clear-night"]:
                    cloud_coverage = 0.0
                elif condition == "partlycloudy":
                    cloud_coverage = 50.0
                elif condition in ["cloudy", "fog", "rainy", "pouring", "lightning-rainy", "snowy"]:
                    cloud_coverage = 100.0
                else:
                    cloud_coverage = 0.0
                    
            cloud_coverage = float(cloud_coverage)
            
            # Approx sun position
            dt_utc = dt_util.as_utc(f_dt).replace(tzinfo=None)
            el, az = self._calc_sun_pos(dt_utc, lat, lon)
            
            if el > 0:
                temp_dict = {"nord": 0.0, "ost": 0.0, "sued": 0.0, "west": 0.0}
                self._calc_intensities(el, az, cloud_coverage, temp_dict)
                if f_date == today:
                    for d in max_f:
                        if temp_dict[d] > max_f[d]:
                            max_f[d] = temp_dict[d]
                else:
                    for d in max_f_tom:
                        if temp_dict[d] > max_f_tom[d]:
                            max_f_tom[d] = temp_dict[d]
                        
        self.forecast_max_intensities = max_f
        self.global_shading_needed = any(v >= 600.0 for v in max_f.values())
        
        self.forecast_max_intensities_tomorrow = max_f_tom
        self.global_shading_needed_tomorrow = any(v >= 600.0 for v in max_f_tom.values())
        
        self.hass.bus.async_fire("smarthome_companion_sun_updated")

    def _calc_sun_pos(self, dt_utc, lat, lon):
        days_since_2000 = (dt_utc - datetime(2000, 1, 1, 12, 0, 0)).total_seconds() / 86400.0
        L = (280.460 + 0.9856474 * days_since_2000) % 360
        g = math.radians((357.528 + 0.9856003 * days_since_2000) % 360)
        ecliptic_lon = math.radians((L + 1.915 * math.sin(g) + 0.02 * math.sin(2 * g)) % 360)
        obliquity = math.radians(23.439 - 0.0000004 * days_since_2000)
        dec = math.asin(math.sin(obliquity) * math.sin(ecliptic_lon))
        ra = math.atan2(math.cos(obliquity) * math.sin(ecliptic_lon), math.cos(ecliptic_lon))
        gmst = (18.697374558 + 24.06570982441908 * days_since_2000) % 24
        lmst = (gmst * 15 + lon) % 360
        hour_angle = math.radians(lmst) - ra
        lat_rad = math.radians(lat)
        el_rad = math.asin(math.sin(lat_rad) * math.sin(dec) + math.cos(lat_rad) * math.cos(dec) * math.cos(hour_angle))
        az_rad = math.atan2(-math.sin(hour_angle), math.cos(lat_rad) * math.tan(dec) - math.sin(lat_rad) * math.cos(hour_angle))
        el = math.degrees(el_rad)
        az = (math.degrees(az_rad) + 360) % 360
        return el, az

    def _calc_facade_times(self, dt_day, lat, lon):
        times = {"nord": {"enters": None, "leaves": None}, "ost": {"enters": None, "leaves": None}, "sued": {"enters": None, "leaves": None}, "west": {"enters": None, "leaves": None}}
        for m in range(0, 24 * 60, 5):
            dt = dt_day + timedelta(minutes=m)
            dt_utc = dt.replace(tzinfo=None)
            el, az = self._calc_sun_pos(dt_utc, lat, lon)
            if el > 0:
                for direction, d_azi in {"nord": 0, "ost": 90, "sued": 180, "west": 270}.items():
                    diff = abs(az - d_azi) % 360
                    if diff > 180:
                        diff = 360 - diff
                    if diff < 90:
                        if times[direction]["enters"] is None:
                            times[direction]["enters"] = dt
                        times[direction]["leaves"] = dt
        return times
