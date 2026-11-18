import { RouteSegmentResult } from '../types';

const clientRouteCache = new Map<string, RouteSegmentResult>();

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2);
}

function buildClientHaversineFallback(
  points: Array<{ lat: number; lng: number }>,
  note: string
): RouteSegmentResult {
  const legs: RouteSegmentResult['legs'] = [];
  let totalDist = 0;
  let totalDur = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
    const dur = Math.max(4, Math.round((dist / 25) * 60));
    totalDist += dist;
    totalDur += dur;
    legs.push({ fromIndex: i, toIndex: i + 1, distanceKm: dist, durationMin: dur });
  }
  return {
    distanceKm: +totalDist.toFixed(2),
    durationMin: totalDur,
    geometry: points.map((p) => [p.lat, p.lng]),
    legs,
    source: 'haversine-fallback',
    note,
  };
}

export async function fetchOsrmRoute(
  points: Array<{ lat: number; lng: number }>,
  customOsrmUrl?: string
): Promise<RouteSegmentResult> {
  if (points.length < 2) {
    return {
      distanceKm: 0,
      durationMin: 0,
      geometry: points.map((p) => [p.lat, p.lng]),
      legs: [],
      source: 'osrm',
    };
  }

  const cacheKey = `${customOsrmUrl || 'default'}|${points
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join(';')}`;

  const cached = clientRouteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, customOsrmUrl }),
    });

    if (res.ok) {
      const data = (await res.json()) as RouteSegmentResult;
      if (data && Array.isArray(data.geometry)) {
        clientRouteCache.set(cacheKey, data);
        return data;
      }
    }
    return buildClientHaversineFallback(
      points,
      'Road routing temporarily unavailable; showing straight-line estimates.'
    );
  } catch {
    return buildClientHaversineFallback(
      points,
      'Road routing request failed; showing straight-line estimates.'
    );
  }
}
