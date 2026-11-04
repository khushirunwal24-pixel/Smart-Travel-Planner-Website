import { WeatherData, DailyForecast } from '../types';

// Map WMO weather codes to human descriptions and icon styles
export function getWeatherDescription(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear Sky', icon: 'Sun' };
  if (code === 1 || code === 2) return { label: 'Partly Cloudy', icon: 'CloudSun' };
  if (code === 3) return { label: 'Overcast', icon: 'Cloud' };
  if (code >= 45 && code <= 48) return { label: 'Foggy / Haze', icon: 'CloudFog' };
  if (code >= 51 && code <= 55) return { label: 'Light Drizzle', icon: 'CloudDrizzle' };
  if (code >= 61 && code <= 65) return { label: 'Rain Showers', icon: 'CloudRain' };
  if (code >= 71 && code <= 77) return { label: 'Snowfall', icon: 'CloudSnow' };
  if (code >= 80 && code <= 82) return { label: 'Heavy Rain Showers', icon: 'CloudRainWind' };
  if (code >= 95 && code <= 99) return { label: 'Thunderstorms', icon: 'CloudLightning' };
  return { label: 'Mild / Pleasant', icon: 'Sun' };
}

// Fallback curated weather for popular travel hubs
const FALLBACK_CITIES: Record<string, Partial<WeatherData>> = {
  paris: { temp: 19, feelsLike: 18, condition: 'Partly Cloudy', weatherCode: 2, humidity: 62, windSpeed: 14, uvIndex: 4 },
  tokyo: { temp: 22, feelsLike: 23, condition: 'Clear Sky', weatherCode: 0, humidity: 55, windSpeed: 11, uvIndex: 6 },
  bali: { temp: 29, feelsLike: 33, condition: 'Tropical Breeze', weatherCode: 1, humidity: 78, windSpeed: 16, uvIndex: 9 },
  rome: { temp: 24, feelsLike: 25, condition: 'Sunny & Warm', weatherCode: 0, humidity: 48, windSpeed: 9, uvIndex: 7 },
  london: { temp: 16, feelsLike: 15, condition: 'Light Drizzle', weatherCode: 51, humidity: 74, windSpeed: 18, uvIndex: 3 },
  'new york': { temp: 21, feelsLike: 20, condition: 'Breezy & Clear', weatherCode: 1, humidity: 50, windSpeed: 15, uvIndex: 5 },
  jaipur: { temp: 31, feelsLike: 32, condition: 'Sunny & Warm', weatherCode: 0, humidity: 35, windSpeed: 8, uvIndex: 8 },
  dubai: { temp: 33, feelsLike: 36, condition: 'Sunny & Hot', weatherCode: 0, humidity: 40, windSpeed: 12, uvIndex: 10 },
  zurich: { temp: 15, feelsLike: 14, condition: 'Alpine Fresh', weatherCode: 2, humidity: 65, windSpeed: 10, uvIndex: 4 },
};

export async function fetchLiveWeather(destination: string): Promise<WeatherData> {
  const cleanCity = destination.split(',')[0].trim();
  const lowerKey = cleanCity.toLowerCase();

  try {
    // 1. Geocode city name via Open-Meteo free geocoding API
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      cleanCity
    )}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (geoData.results && geoData.results.length > 0) {
      const { latitude, longitude, country, name } = geoData.results[0];

      // 2. Query forecast data from Open-Meteo
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relativehumidity_2m,apparent_temperature&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
      const weatherRes = await fetch(weatherUrl);
      const data = await weatherRes.json();

      if (data && data.current_weather) {
        const cw = data.current_weather;
        const code = cw.weathercode ?? 0;
        const desc = getWeatherDescription(code);

        // Compute 5-day daily forecast
        const forecast: DailyForecast[] = [];
        if (data.daily && data.daily.time) {
          const daysCount = Math.min(5, data.daily.time.length);
          for (let i = 0; i < daysCount; i++) {
            const dateStr = data.daily.time[i];
            const d = new Date(dateStr);
            const dayName = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayCode = data.daily.weathercode?.[i] ?? code;
            forecast.push({
              date: dateStr,
              dayName,
              maxTemp: Math.round(data.daily.temperature_2m_max?.[i] ?? cw.temperature + 2),
              minTemp: Math.round(data.daily.temperature_2m_min?.[i] ?? cw.temperature - 4),
              condition: getWeatherDescription(dayCode).label,
              precipitationChance: data.daily.precipitation_probability_max?.[i] ?? 10,
              weatherCode: dayCode,
            });
          }
        }

        // Relative humidity from current hour
        const hourIdx = new Date().getHours();
        const humidity = data.hourly?.relativehumidity_2m?.[hourIdx] ?? 55;
        const feelsLike = Math.round(data.hourly?.apparent_temperature?.[hourIdx] ?? cw.temperature);

        return {
          city: name || cleanCity,
          country: country || '',
          temp: Math.round(cw.temperature),
          feelsLike,
          condition: desc.label,
          weatherCode: code,
          humidity,
          windSpeed: Math.round(cw.windspeed),
          uvIndex: 5,
          forecast,
          source: 'live',
        };
      }
    }
  } catch (err) {
    console.warn('Live weather lookup failed, serving curated fallback:', err);
  }

  // Fallback state
  const preset = FALLBACK_CITIES[lowerKey] || {
    temp: 22,
    feelsLike: 22,
    condition: 'Pleasant & Sunny',
    weatherCode: 1,
    humidity: 50,
    windSpeed: 12,
    uvIndex: 5,
  };

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const fallbackForecast: DailyForecast[] = Array.from({ length: 5 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return {
      date: d.toISOString().split('T')[0],
      dayName: i === 0 ? 'Today' : daysOfWeek[d.getDay()],
      maxTemp: Math.round((preset.temp || 22) + 2 + (i % 2)),
      minTemp: Math.round((preset.temp || 22) - 4 + (i % 3)),
      condition: i % 2 === 0 ? preset.condition || 'Clear' : 'Partly Cloudy',
      precipitationChance: 15 + i * 5,
      weatherCode: preset.weatherCode || 1,
    };
  });

  return {
    city: cleanCity,
    country: 'Global Destination',
    temp: preset.temp || 22,
    feelsLike: preset.feelsLike || 22,
    condition: preset.condition || 'Mild & Sunny',
    weatherCode: preset.weatherCode || 1,
    humidity: preset.humidity || 52,
    windSpeed: preset.windSpeed || 12,
    uvIndex: preset.uvIndex || 5,
    forecast: fallbackForecast,
    source: 'fallback',
  };
}
