import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Navigation,
  Clock,
  Compass,
  ExternalLink,
  Car,
  Layers,
  Ticket,
} from 'lucide-react';
import {
  Trip,
  Itinerary,
  TripLocationItem,
  RouteSegmentResult,
} from '../types';
import { fetchOsrmRoute } from '../services/routeService';
import { formatINR } from '../utils/currency';

interface RouteMapProps {
  trip?: Trip | null;
  itinerary?: Itinerary | null;
  focusedSpot?: TripLocationItem | null;
  onSelectTrip?: () => void;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const RouteMap: React.FC<RouteMapProps> = ({
  trip,
  itinerary,
  focusedSpot,
  onSelectTrip,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const [selectedSpot, setSelectedSpot] = useState<TripLocationItem | null>(
    focusedSpot || null
  );
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [showAllDiscovered, setShowAllDiscovered] = useState<boolean>(true);
  const [routeData, setRouteData] = useState<RouteSegmentResult | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);

  // Flatten all itinerary locations with day tags
  const allSpots = useMemo(() => {
    const list: Array<TripLocationItem & { dayNumber: number }> = [];
    if (itinerary && itinerary.days) {
      itinerary.days.forEach((d) => {
        d.locations.forEach((loc) => {
          list.push({ ...loc, dayNumber: d.dayNumber });
        });
      });
    }
    return list;
  }, [itinerary]);

  // If navigated via an attraction's "Explore on Map", focus that spot & its day
  useEffect(() => {
    if (!focusedSpot) return;
    setSelectedSpot(focusedSpot);
    const matching = allSpots.find(
      (s) =>
        (focusedSpot.osmId && s.osmId === focusedSpot.osmId) ||
        (s.name === focusedSpot.name &&
          Math.abs(s.lat - focusedSpot.lat) < 0.0005 &&
          Math.abs(s.lng - focusedSpot.lng) < 0.0005)
    );
    if (matching) {
      setSelectedDay(matching.dayNumber);
    }
  }, [focusedSpot, allSpots]);

  // Ensure selectedDay exists if itinerary changes
  useEffect(() => {
    if (itinerary?.days && itinerary.days.length > 0 && selectedDay > itinerary.days.length) {
      setSelectedDay(1);
    }
  }, [itinerary, selectedDay]);

  const displayedSpots = useMemo(() => {
    return selectedDay === 0
      ? allSpots
      : allSpots.filter((s) => s.dayNumber === selectedDay);
  }, [allSpots, selectedDay]);

  // Initialize Leaflet map once with OpenStreetMap tile layer
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialLat = allSpots.length > 0 ? allSpots[0].lat : 24.5854;
    const initialLng = allSpots.length > 0 ? allSpots[0].lng : 73.7125;

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

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
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

  // Fetch real OSRM driving route geometry whenever displayedSpots changes
  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      if (displayedSpots.length < 2) {
        setRouteData(null);
        return;
      }
      setRouteLoading(true);
      const res = await fetchOsrmRoute(
        displayedSpots.map((s) => ({ lat: s.lat, lng: s.lng }))
      );
      if (!cancelled) {
        setRouteData(res);
        setRouteLoading(false);
      }
    }

    loadRoute();
    return () => {
      cancelled = true;
    };
  }, [displayedSpots]);

  // Render secondary discovered markers, numbered route markers, and OSRM route line
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        map.removeLayer(layer);
      }
    });
    markersRef.current.clear();

    const boundsPoints: L.LatLngTuple[] = [];

    // 1. Secondary layer: all other discovered OpenStreetMap attractions around the city
    if (showAllDiscovered && itinerary?.discoveredAttractions) {
      const activeIds = new Set(displayedSpots.map((s) => s.osmId || s.name));
      itinerary.discoveredAttractions.forEach((attr) => {
        if (activeIds.has(attr.id) || activeIds.has(attr.name)) return;

        const marker = L.circleMarker([attr.lat, attr.lng], {
          radius: 6,
          fillColor: '#0D9488',
          color: '#FFFFFF',
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.75,
        }).addTo(map);

        const priceLabel = attr.entranceFee || 'Price unavailable';
        const popupHtml = `
          <div style="font-family: system-ui, sans-serif; font-size: 12px; max-width: 230px; line-height: 1.4;">
            <div style="font-size: 10px; font-weight: 700; color: #0D9488; text-transform: uppercase; margin-bottom: 2px;">
              Discovered OSM • ${escapeHtml(attr.category)}
            </div>
            <div style="font-weight: 700; color: #0F172A; font-size: 13px; margin-bottom: 4px;">
              ${escapeHtml(attr.name)}
            </div>
            <div style="color: #475569; margin-bottom: 6px;">
              ${escapeHtml(attr.description)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #E2E8F0; padding-top: 6px;">
              <span style="font-weight: 600; color: #334155;">${escapeHtml(priceLabel)}</span>
              <a href="${escapeHtml(attr.osmUrl)}" target="_blank" rel="noreferrer" style="color: #2563EB; font-weight: 600; text-decoration: none;">
                OpenStreetMap ↗
              </a>
            </div>
          </div>
        `;
        marker.bindPopup(popupHtml);
      });
    }

    // 2. Road route polyline from OSRM (or dashed Haversine fallback)
    if (routeData && routeData.geometry.length > 1) {
      const polyline = L.polyline(routeData.geometry, {
        color: routeData.source === 'osrm' ? '#2563EB' : '#D97706',
        weight: routeData.source === 'osrm' ? 4.5 : 3.5,
        opacity: 0.88,
        dashArray: routeData.source === 'osrm' ? undefined : '7, 7',
      }).addTo(map);

      if (displayedSpots.length > 1) {
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      }
    }

    // 3. Primary numbered markers for selected itinerary stops
    displayedSpots.forEach((spot, idx) => {
      const latLng: L.LatLngTuple = [spot.lat, spot.lng];
      boundsPoints.push(latLng);

      const isFocused =
        selectedSpot &&
        ((spot.osmId && selectedSpot.osmId === spot.osmId) ||
          (spot.name === selectedSpot.name && Math.abs(spot.lat - selectedSpot.lat) < 0.0005));

      const markerHtml = `
        <div style="
          background: ${isFocused ? '#0D9488' : '#2563EB'};
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

      const osmLink =
        spot.osmUrl ||
        `https://www.openstreetmap.org/?mlat=${spot.lat}&mlon=${spot.lng}#map=17/${spot.lat}/${spot.lng}`;
      const priceText =
        spot.priceLabel || (spot.cost > 0 ? formatINR(spot.cost) : 'Price unavailable');

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; font-size: 12px; max-width: 240px; line-height: 1.4;">
          <div style="font-weight: 700; color: #0F172A; font-size: 13px; margin-bottom: 2px;">
            ${escapeHtml(spot.name)}
          </div>
          <div style="color: #2563EB; font-weight: 600; font-size: 11px; margin-bottom: 6px;">
            Day ${spot.dayNumber} • ${escapeHtml(spot.visitingTime)}
            ${spot.category ? ` • ${escapeHtml(spot.category)}` : ''}
          </div>
          <div style="color: #475569; margin-bottom: 6px;">
            ${escapeHtml(spot.description)}
          </div>
          ${
            spot.estimatedDistance
              ? `<div style="font-size: 11px; color: #0F766E; font-weight: 600; margin-bottom: 6px;">📍 ${escapeHtml(
                  spot.estimatedDistance
                )}</div>`
              : ''
          }
          <div style="background: #F1F5F9; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: #334155; margin-bottom: 6px;">
            🍽️ <strong>Food:</strong> ${escapeHtml(spot.foodSuggestion)}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #E2E8F0; padding-top: 6px;">
            <span style="font-weight: 700; color: #059669;">${escapeHtml(priceText)}</span>
            <a href="${escapeHtml(osmLink)}" target="_blank" rel="noreferrer" style="color: #2563EB; font-weight: 600; text-decoration: none;">
              Open on OSM ↗
            </a>
          </div>
        </div>
      `;

      const marker = L.marker(latLng, { icon: customIcon }).addTo(map);
      marker.bindPopup(popupContent);
      markersRef.current.set(spot.osmId || `${spot.name}_${idx}`, marker);

      marker.on('click', () => {
        setSelectedSpot(spot);
      });

      if (isFocused) {
        marker.openPopup();
      }
    });

    if (!routeData && boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [50, 50] });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 14);
    }
  }, [displayedSpots, itinerary, routeData, showAllDiscovered, selectedSpot]);

  const handleSpotFocus = (spot: TripLocationItem, idx: number) => {
    setSelectedSpot(spot);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([spot.lat, spot.lng], 15, { animate: true });
      const marker = markersRef.current.get(spot.osmId || `${spot.name}_${idx}`);
      if (marker) {
        marker.openPopup();
      }
    }
  };

  // Use real OSRM totals (or current day precomputed totals while loading)
  const activeDayObj = itinerary?.days?.find((d) => d.dayNumber === selectedDay);
  const totalStops = displayedSpots.length;
  const totalDistKm =
    routeData?.distanceKm ??
    activeDayObj?.totalRouteDistanceKm ??
    null;
  const totalDurMin =
    routeData?.durationMin ??
    activeDayObj?.totalRouteDurationMin ??
    null;

  const osmCityLink =
    displayedSpots.length > 0
      ? `https://www.openstreetmap.org/?mlat=${displayedSpots[0].lat}&mlon=${displayedSpots[0].lng}#map=13/${displayedSpots[0].lat}/${displayedSpots[0].lng}`
      : 'https://www.openstreetmap.org/';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            <Compass className="w-4 h-4" />
            <span>OpenStreetMap & OSRM Real Route Visualization</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            {trip ? trip.title : 'Trip Route & Waypoints'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Destination:{' '}
            <span className="font-semibold text-slate-800">
              {itinerary?.destination || trip?.destination || 'Select or plan a trip'}
            </span>{' '}
            • Starting from:{' '}
            <span className="font-semibold text-slate-800">
              {trip?.startLocation || 'Departure City'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {itinerary?.discoveredAttractions && itinerary.discoveredAttractions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllDiscovered((v) => !v)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                showAllDiscovered
                  ? 'bg-teal-50 border-teal-200 text-teal-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>City POIs ({itinerary.discoveredAttractions.length})</span>
            </button>
          )}

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
      </div>

      {/* Main Map + Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Map View */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-md h-[460px] sm:h-[540px] bg-slate-100">
            <div ref={mapContainerRef} className="w-full h-full z-10" />

            {/* Quick Map Overlay Stats Badge */}
            <div className="absolute top-4 left-4 z-20 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg border border-slate-200/80 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-800">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span>{totalStops} Stops</span>
              </div>
              <div className="h-3.5 w-px bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <Car className="w-4 h-4 text-teal-600" />
                <span>
                  {routeLoading
                    ? 'Routing via OSRM...'
                    : totalDistKm !== null
                    ? `${totalDistKm} km ${routeData?.source === 'haversine-fallback' ? '(est.)' : 'road route'}`
                    : 'Single stop'}
                </span>
              </div>
              {totalDurMin !== null && (
                <>
                  <div className="h-3.5 w-px bg-slate-200" />
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span>~{totalDurMin} mins drive</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                {routeData?.source === 'haversine-fallback'
                  ? routeData.note ||
                    'OSRM driving directions were unavailable; showing straight-line fallback.'
                  : 'Blue numbered pins show your selected day route via OSRM; teal dots show additional discovered OpenStreetMap attractions.'}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {onSelectTrip && !itinerary && (
                <button
                  type="button"
                  onClick={onSelectTrip}
                  className="font-bold text-teal-700 hover:underline cursor-pointer"
                >
                  Select Trip
                </button>
              )}
              <a
                href={osmCityLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-800"
              >
                OpenStreetMap <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Right Waypoint List */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col h-[540px]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 font-heading">
                {selectedDay === 0 ? 'All Route Stops' : `Day ${selectedDay} Waypoints`}
              </h3>
              <p className="text-[11px] text-slate-400">
                Click a stop to focus on the map
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-bold text-xs">
              {displayedSpots.length} Stops
            </span>
          </div>

          <div className="mt-3 flex-1 overflow-y-auto space-y-3 pr-1">
            {displayedSpots.map((spot, idx) => {
              const isSelected =
                selectedSpot?.name === spot.name &&
                Math.abs((selectedSpot?.lat || 0) - spot.lat) < 0.0005;
              const legInfo = idx > 0 ? routeData?.legs?.[idx - 1] : null;
              const priceText =
                spot.priceLabel ||
                (spot.cost > 0 ? formatINR(spot.cost) : 'Price unavailable');

              return (
                <div
                  key={`${spot.osmId || spot.name}_${idx}`}
                  onClick={() => handleSpotFocus(spot, idx)}
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
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{spot.name}</h4>
                        <span className="text-[10px] font-semibold text-emerald-700 shrink-0 flex items-center gap-0.5">
                          <Ticket className="w-3 h-3" /> {priceText}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                        <span className="text-blue-600 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {spot.visitingTime}
                        </span>
                        {spot.category && (
                          <span className="text-slate-500 font-medium">• {spot.category}</span>
                        )}
                      </div>

                      {(legInfo || spot.estimatedDistance) && (
                        <p className="text-[10px] font-semibold text-teal-700 mt-1">
                          {legInfo
                            ? `↗ ${legInfo.distanceKm} km from previous stop (~${legInfo.durationMin} min)`
                            : spot.estimatedDistance}
                        </p>
                      )}

                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                        {spot.description}
                      </p>

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
