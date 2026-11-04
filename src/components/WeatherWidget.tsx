import React, { useState, useEffect } from 'react';
import {
  CloudSun,
  Search,
  Wind,
  Droplets,
  Sun,
  CloudRain,
  Compass,
  Thermometer,
  ShieldAlert,
  Shirt,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { fetchLiveWeather } from '../services/weatherService';
import { WeatherData } from '../types';

interface WeatherWidgetProps {
  initialDestination?: string;
}

export const WeatherWidget: React.FC<WeatherWidgetProps> = ({
  initialDestination = 'Paris, France',
}) => {
  const [query, setQuery] = useState(initialDestination);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWeather = async (city: string) => {
    setLoading(true);
    try {
      const data = await fetchLiveWeather(city);
      setWeather(data);
    } catch (e) {
      console.error('Weather load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeather(initialDestination);
  }, [initialDestination]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      loadWeather(query.trim());
    }
  };

  // Dynamic packing suggestions based on temperature and conditions
  const getTravelPackingTips = (data: WeatherData) => {
    const tips = [];
    if (data.temp < 12) {
      tips.push('Pack a warm winter coat, thermal layers, and warm boots.');
    } else if (data.temp < 20) {
      tips.push('Light jacket or comfortable sweater recommended for mornings & evenings.');
    } else {
      tips.push('Breathable summer clothes, sunglasses, and UV protection.');
    }

    if (data.condition.toLowerCase().includes('rain') || data.weatherCode >= 50) {
      tips.push('Bring a compact umbrella and waterproof footwear.');
    } else {
      tips.push('Great weather for walking tours and open-air sightseeing.');
    }

    if (data.humidity > 70) {
      tips.push('High humidity: Stay well hydrated throughout outdoor activities.');
    }

    return tips;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & City Search Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            <CloudSun className="w-4 h-4" />
            <span>Real-Time Weather Intelligence & Forecast</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            Destination Weather
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Live atmospheric data powered by global meteorology sensor networks.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search destination city (e.g. Rome, Tokyo)..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>
          <button
            type="submit"
            className="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors cursor-pointer shrink-0"
          >
            Check
          </button>
        </form>
      </div>

      {/* Quick City Presets */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400 text-xs font-medium">Quick Explore:</span>
        {['Tokyo, Japan', 'Paris, France', 'Bali, Indonesia', 'Rome, Italy', 'Jaipur, India', 'Zurich, Switzerland', 'New York, USA', 'Dubai, UAE'].map(
          (city) => (
            <button
              key={city}
              onClick={() => {
                setQuery(city);
                loadWeather(city);
              }}
              className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            >
              {city.split(',')[0]}
            </button>
          )
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-slate-200">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-medium">Retrieving real-time weather data...</p>
        </div>
      ) : weather ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Weather Card */}
          <div className="lg:col-span-2 bg-gradient-to-br from-blue-600 via-indigo-600 to-teal-500 text-white p-6 sm:p-8 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start justify-between relative z-10">
              <div>
                <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-md mb-2">
                  {weather.source === 'live' ? 'Live Meteorological Feed' : 'Curated Forecast Model'}
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold font-heading">{weather.city}</h2>
                <p className="text-blue-100 text-xs mt-1">{weather.country}</p>
              </div>

              <div className="text-right">
                <div className="text-5xl sm:text-6xl font-extrabold font-heading">
                  {weather.temp}°C
                </div>
                <p className="text-xs text-blue-100 mt-1">Feels like {weather.feelsLike}°C</p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/20 grid grid-cols-2 sm:grid-cols-4 gap-4 relative z-10">
              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md">
                <span className="text-[11px] text-blue-100 flex items-center gap-1">
                  <Sun className="w-3.5 h-3.5" /> Condition
                </span>
                <p className="text-sm font-bold text-white mt-1">{weather.condition}</p>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md">
                <span className="text-[11px] text-blue-100 flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5" /> Humidity
                </span>
                <p className="text-sm font-bold text-white mt-1">{weather.humidity}%</p>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md">
                <span className="text-[11px] text-blue-100 flex items-center gap-1">
                  <Wind className="w-3.5 h-3.5" /> Wind Speed
                </span>
                <p className="text-sm font-bold text-white mt-1">{weather.windSpeed} km/h</p>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md">
                <span className="text-[11px] text-blue-100 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5" /> UV Index
                </span>
                <p className="text-sm font-bold text-white mt-1">{weather.uvIndex} / 10</p>
              </div>
            </div>
          </div>

          {/* Packing & Traveler Suggestions */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-teal-600 mb-2 font-heading">
                <Shirt className="w-4 h-4" />
                <span>Traveler Clothing & Packing Advice</span>
              </div>
              <h3 className="text-base font-bold text-slate-900 font-heading mb-4">
                What to Wear & Bring
              </h3>

              <div className="space-y-3">
                {getTravelPackingTips(weather).map((tip, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-xs text-slate-700 flex items-start gap-2.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5 shrink-0" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 p-3 rounded-2xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Itineraries automatically adjust pace during excessive rain or high heat.</span>
            </div>
          </div>

          {/* 5-Day Forecast Grid */}
          <div className="lg:col-span-3 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
            <h3 className="text-base font-bold text-slate-900 font-heading mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              5-Day Meteorological Forecast
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {weather.forecast.map((day, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-2xl border text-center transition-all ${
                    idx === 0
                      ? 'bg-blue-50/60 border-blue-200 font-medium'
                      : 'bg-slate-50/60 border-slate-200/70 hover:bg-slate-100/60'
                  }`}
                >
                  <p className="text-xs font-bold text-slate-800">{day.dayName}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{day.date}</p>

                  <div className="my-3 flex justify-center text-blue-600">
                    <CloudSun className="w-7 h-7 text-blue-500" />
                  </div>

                  <p className="text-xs font-semibold text-slate-700 truncate">{day.condition}</p>

                  <div className="mt-2 flex items-center justify-center gap-2 text-xs">
                    <span className="font-bold text-slate-900">{day.maxTemp}°</span>
                    <span className="text-slate-400 font-medium">{day.minTemp}°</span>
                  </div>

                  <div className="mt-2 text-[10px] text-blue-600 font-medium flex items-center justify-center gap-1">
                    <CloudRain className="w-3 h-3" /> {day.precipitationChance}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
