import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Navigation,
  Clock,
  Compass,
  ExternalLink,
  Layers,
  ChevronRight,
  Sparkles,
  Car,
} from 'lucide-react';
import { Trip, Itinerary, TripLocationItem } from '../types';
import { formatINR } from '../utils/currency';

interface RouteMapProps {
  trip?: Trip | null;
  itinerary?: Itinerary | null;
  onSelectTrip?: () => void;
}

export const RouteMap: React.FC<RouteMapProps> = ({ trip, itinerary, onSelectTrip }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<TripLocationItem | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(1);

  // Flatten all itinerary locations with day tags
  const allSpots: Array<TripLocationItem & { dayNumber: number }> = [];
  if (itinerary && itinerary.days) {
    itinerary.days.forEach((d) => {
      d.locations.forEach((loc) => {
        allSpots.push({ ...loc, dayNumber: d.dayNumber });
      });
    });
  }

  // Filter spots by day (or all)
  const displayedSpots =
    selectedDay === 0
      ? allSpots
      : allSpots.filter((s) => s.dayNumber === selectedDay);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Default center (Paris or first spot)
    const initialLat = allSpots.length > 0 ? allSpots[0].lat : 48.8566;
    const initialLng = allSpots.length > 0 ? allSpots[0].lng : 2.3522;

    // Recreate map if needed
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    if (mapContainerRef.current && (mapContainerRef.current as any)._leaflet_id) {
      delete (mapContainerRef.current as any)._leaflet_id;
    }

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 13,
      zoomControl: true,
    });

    // OpenStreetMap standard tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if (mapContainerRef.current && (mapContainerRef.current as any)._leaflet_id) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }
    };
  }, []);

  // Update markers and route lines when displayedSpots changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing layers other than tile layer
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        map.removeLayer(layer);
      }
    });

    if (displayedSpots.length === 0) return;

    const latLngs: L.LatLngExpression[] = [];

    displayedSpots.forEach((spot, idx) => {
      const latLng: L.LatLngTuple = [spot.lat, spot.lng];
      latLngs.push(latLng);

      // Create a modern custom HTML marker pin with Day and Stop index
      const markerHtml = `
        <div style="
          background: #2563EB;
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px rgba(37,99,235,0.4);
          border: 2px solid white;
          cursor: pointer;
        ">
          <span style="
            transform: rotate(45deg);
            font-size: 11px;
            font-weight: bold;
            font-family: sans-serif;
          ">${idx + 1}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: markerHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
      });

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; font-size: 12px; max-width: 220px; line-height: 1.4;">
          <div style="font-weight: 700; color: #0F172A; font-size: 13px; margin-bottom: 2px;">
            ${spot.name}
          </div>
          <div style="color: #2563EB; font-weight: 600; font-size: 11px; margin-bottom: 6px;">
            Day ${spot.dayNumber} • ${spot.visitingTime}
          </div>
          <div style="color: #475569; margin-bottom: 6px;">
            ${spot.description}
          </div>
          <div style="background: #F1F5F9; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: #334155; margin-bottom: 6px;">
            🍽️ <strong>Food:</strong> ${spot.foodSuggestion}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #E2E8F0; padding-top: 6px;">
            <span style="font-weight: 700; color: #059669;">Est: ${formatINR(spot.cost)}</span>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              spot.name + ' ' + (itinerary?.destination || '')
            )}" target="_blank" style="color: #2563EB; font-weight: 600; text-decoration: none;">
              Directions ↗
            </a>
          </div>
        </div>
      `;

      const marker = L.marker(latLng, { icon: customIcon }).addTo(map);
      marker.bindPopup(popupContent);

      marker.on('click', () => {
        setSelectedSpot(spot);
      });
    });

    // Draw connecting route polyline
    if (latLngs.length > 1) {
      const polyline = L.polyline(latLngs, {
        color: '#2563EB',
        weight: 4,
        opacity: 0.8,
        dashArray: '6, 8',
      }).addTo(map);

      // Fit bounds with comfortable padding
      map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    } else if (latLngs.length === 1) {
      map.setView(latLngs[0], 14);
    }
  }, [displayedSpots, itinerary]);

  // Handle focus on a specific spot from the sidebar
  const handleSpotFocus = (spot: TripLocationItem) => {
    setSelectedSpot(spot);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([spot.lat, spot.lng], 15, { animate: true });
    }
  };

  // Estimate total distance
  const totalStops = displayedSpots.length;
  const estimatedMiles = (totalStops * 1.8).toFixed(1);
  const estimatedDriveMin = Math.round(totalStops * 12);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            <Compass className="w-4 h-4" />
            <span>Interactive Route Planner & Geographic Markers</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            {trip ? trip.title : 'Trip Route & Waypoints'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Destination: <span className="font-semibold text-slate-800">{itinerary?.destination || trip?.destination || 'Select a trip'}</span> • Starting from: <span className="font-semibold text-slate-800">{trip?.startLocation || 'Departure City'}</span>
          </p>
        </div>

        {/* Day Filter Pills */}
        {itinerary && itinerary.days && itinerary.days.length > 0 && (
          <div className="flex items-center flex-wrap gap-1.5 p-1.5 bg-slate-100 rounded-2xl">
            <button
              onClick={() => setSelectedDay(0)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                selectedDay === 0
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Days ({allSpots.length})
            </button>
            {itinerary.days.map((d) => (
              <button
                key={d.dayNumber}
                onClick={() => setSelectedDay(d.dayNumber)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  selectedDay === d.dayNumber
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Day {d.dayNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Map + Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Map View */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-md h-[460px] sm:h-[540px] bg-slate-100">
            <div ref={mapContainerRef} className="w-full h-full z-10" />

            {/* Quick Map Overlay Stats Badge */}
            <div className="absolute top-4 left-4 z-20 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg border border-slate-200/80 flex items-center gap-4 text-xs font-semibold text-slate-800">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span>{totalStops} Locations</span>
              </div>
              <div className="h-3.5 w-px bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <Car className="w-4 h-4 text-teal-600" />
                <span>~{estimatedMiles} km transit</span>
              </div>
              <div className="h-3.5 w-px bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>~{estimatedDriveMin} mins</span>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Click any numbered marker on the map to view instant activity highlights, visiting hours, and food stops.
              </span>
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                itinerary?.destination || 'Paris'
              )}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-800 shrink-0 ml-4"
            >
              Google Maps <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Right Waypoint List */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col h-[540px]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 font-heading">
                {selectedDay === 0 ? 'All Route Stops' : `Day ${selectedDay} Itinerary Stops`}
              </h3>
              <p className="text-[11px] text-slate-400">Click a stop to focus on the map</p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-bold text-xs">
              {displayedSpots.length} Stops
            </span>
          </div>

          <div className="mt-3 flex-1 overflow-y-auto space-y-3 pr-1">
            {displayedSpots.map((spot, idx) => {
              const isSelected = selectedSpot?.name === spot.name;
              return (
                <div
                  key={idx}
                  onClick={() => handleSpotFocus(spot)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/70 shadow-xs'
                      : 'border-slate-200/80 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{spot.name}</h4>
                        <span className="text-[10px] font-semibold text-emerald-600">{formatINR(spot.cost)}</span>
                      </div>
                      <p className="text-[11px] text-blue-600 font-medium flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" /> {spot.visitingTime}
                      </p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">{spot.description}</p>
                      <div className="mt-2 text-[10px] text-slate-600 bg-white/80 p-1.5 rounded-lg border border-slate-100">
                        🍽️ {spot.foodSuggestion}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {displayedSpots.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-xs">
                <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No waypoints found for this day.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
