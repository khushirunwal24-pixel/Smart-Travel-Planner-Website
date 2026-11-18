import {
  AttractionCategory,
  BudgetSummary,
  DayCostBreakdown,
  DayItinerary,
  DiscoveredAttraction,
  DiscoveryResponse,
  EndpointAttemptLog,
  GeoCoordinates,
  ItineraryGenerationResponse,
  RouteSegmentResult,
  TripLocationItem,
} from '../types/index';

export const OVERPASS_FALLBACK_ENDPOINTS: string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const DEFAULT_OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
export const DEFAULT_OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const isBrowser = typeof window !== 'undefined';

function getRequestHeaders(accept = 'application/json', contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (contentType) headers['Content-Type'] = contentType;
  if (!isBrowser) {
    headers['User-Agent'] = 'SmartTravelPlanner/1.0 (OpenStreetMap travel itinerary generator)';
  }
  return headers;
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeParseJsonResponse<T = any>(
  res: Response,
  contextLabel: string,
  endpointUrl: string
): Promise<
  | { ok: true; data: T; contentType: string }
  | {
      ok: false;
      contentType: string;
      preview: string;
      error: string;
      isRateLimited?: boolean;
      isTimeout?: boolean;
    }
> {
  const contentType = res.headers.get('content-type') || 'unknown';
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (err: any) {
    return {
      ok: false,
      contentType,
      preview: '',
      error: `${contextLabel} failed reading body (HTTP ${res.status}, Content-Type: ${contentType}): ${err?.message || 'read error'}`,
    };
  }

  const trimmed = rawText.trim();
  const preview = rawText.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!trimmed) {
    console.warn(`[${contextLabel}] Empty response body`, {
      endpoint: endpointUrl,
      status: res.status,
      contentType,
    });
    return {
      ok: false,
      contentType,
      preview: '',
      error: `${contextLabel} returned an empty response (HTTP ${res.status}, Content-Type: ${contentType}).`,
    };
  }

  const ctLower = contentType.toLowerCase();
  const looksHtml = ctLower.includes('text/html') || /^<!doctype\s+html|^<html\b/i.test(trimmed);
  const looksXml = !looksHtml && (ctLower.includes('xml') || /^<\?xml\b|^<osm\b|^<remark\b/i.test(trimmed));

  if (looksHtml || looksXml) {
    console.warn(`[${contextLabel}] Non-JSON response`, {
      endpoint: endpointUrl,
      status: res.status,
      contentType,
      preview,
    });
    return {
      ok: false,
      contentType,
      preview,
      isRateLimited: res.status === 429 || preview.toLowerCase().includes('too many requests'),
      isTimeout: res.status === 504 || preview.toLowerCase().includes('timed out'),
      error: `${contextLabel} returned ${looksHtml ? 'HTML' : 'XML'} instead of JSON (HTTP ${res.status}, Content-Type: ${contentType}).`,
    };
  }

  try {
    const data = JSON.parse(trimmed) as T & { remark?: string; elements?: unknown[] };
    if (
      data &&
      typeof data === 'object' &&
      typeof data.remark === 'string' &&
      data.remark.trim() &&
      (!Array.isArray(data.elements) || data.elements.length === 0) &&
      /(error|timed out|timeout|rate|busy|capacity|memory)/i.test(data.remark)
    ) {
      console.warn(`[${contextLabel}] Overpass JSON remark error`, {
        endpoint: endpointUrl,
        status: res.status,
        contentType,
        remark: data.remark.slice(0, 200),
      });
      return {
        ok: false,
        contentType,
        preview: data.remark.slice(0, 200),
        isTimeout: /timed out|timeout/i.test(data.remark),
        isRateLimited: /rate|too many/i.test(data.remark),
        error: `Overpass error remark: ${data.remark.slice(0, 160)}`,
      };
    }
    return { ok: true, data, contentType };
  } catch (err: any) {
    console.warn(`[${contextLabel}] JSON parse failed`, {
      endpoint: endpointUrl,
      status: res.status,
      contentType,
      parseError: err?.message,
      preview,
    });
    return {
      ok: false,
      contentType,
      preview,
      error: `${contextLabel} returned non-JSON/invalid JSON (HTTP ${res.status}, Content-Type: ${contentType}). Preview: ${preview}`,
    };
  }
}

// ---------- Geo Math ----------
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`".,()\-–—]/g, ' ')
    .replace(/\b(the|shri|sri)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateExternalEndpoint(urlStr: string, fallback: string): string {
  if (!urlStr || typeof urlStr !== 'string') return fallback;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    ) {
      return fallback;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

// ---------- Caches & Rate Limit State ----------
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const geocodeCache = new Map<string, CacheEntry<GeoCoordinates>>();
const discoveryCache = new Map<string, CacheEntry<DiscoveryResponse>>();
const osrmCache = new Map<string, CacheEntry<RouteSegmentResult>>();
const endpointCooldownUntil = new Map<string, number>();

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const OSRM_TTL_MS = 12 * 60 * 60 * 1000;

let osrmQueue: Promise<unknown> = Promise.resolve();
let lastOsrmRequestAt = 0;

function enqueueOsrm<T>(task: () => Promise<T>): Promise<T> {
  const next = osrmQueue.then(task, task);
  osrmQueue = next.catch(() => undefined);
  return next;
}

export class TravelDiscoveryError extends Error {
  statusCode: number;
  code:
    | 'RATE_LIMITED'
    | 'SERVICE_UNAVAILABLE'
    | 'INSUFFICIENT_RESULTS'
    | 'GEOCODE_ERROR'
    | 'VALIDATION_ERROR';
  retryAfterSeconds?: number;
  destGeo?: GeoCoordinates;
  overpassQuery?: string;
  attempts: EndpointAttemptLog[];

  constructor(
    message: string,
    code:
      | 'RATE_LIMITED'
      | 'SERVICE_UNAVAILABLE'
      | 'INSUFFICIENT_RESULTS'
      | 'GEOCODE_ERROR'
      | 'VALIDATION_ERROR',
    statusCode: number,
    options?: {
      retryAfterSeconds?: number;
      destGeo?: GeoCoordinates;
      overpassQuery?: string;
      attempts?: EndpointAttemptLog[];
    }
  ) {
    super(message);
    this.name = 'TravelDiscoveryError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.destGeo = options?.destGeo;
    this.overpassQuery = options?.overpassQuery;
    this.attempts = options?.attempts || [];
  }
}

// ---------- 1. Geocoding (Open-Meteo) ----------
export async function geocodeDestinationCore(
  queryText: string,
  geocodeUrl = DEFAULT_OPEN_METEO_GEOCODE_URL
): Promise<GeoCoordinates> {
  const cleaned = queryText.trim();
  if (!cleaned) {
    throw new TravelDiscoveryError('Destination name cannot be empty.', 'VALIDATION_ERROR', 400);
  }

  const parts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const cityQuery = parts[0];
  const regionHint = parts.slice(1).join(' ').toLowerCase();

  const cacheKey = `${geocodeUrl}|${cleaned.toLowerCase()}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = `${geocodeUrl}?name=${encodeURIComponent(cityQuery)}&count=8&language=en&format=json`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: getRequestHeaders() }, 10000);
  } catch (err: any) {
    throw new TravelDiscoveryError(
      `Unable to geocode "${queryText}": ${err?.message || 'Network timeout'}.`,
      'SERVICE_UNAVAILABLE',
      504
    );
  }

  if (!res.ok) {
    throw new TravelDiscoveryError(
      `Geocoding service returned HTTP ${res.status}.`,
      'SERVICE_UNAVAILABLE',
      502
    );
  }

  const parsedGeo = await safeParseJsonResponse<{
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      country?: string;
      admin1?: string;
      population?: number;
      feature_code?: string;
    }>;
  }>(res, 'Open-Meteo Geocode', url);

  if (!parsedGeo.ok) {
    throw new TravelDiscoveryError(parsedGeo.error, 'SERVICE_UNAVAILABLE', 502);
  }
  const json = parsedGeo.data;

  if (!json.results || json.results.length === 0) {
    throw new TravelDiscoveryError(
      `Could not find geographical coordinates for "${queryText}". Please check spelling or add the country name.`,
      'GEOCODE_ERROR',
      400
    );
  }

  const scored = json.results
    .map((item) => {
      let score = 0;
      const itemName = (item.name || '').toLowerCase();
      const itemCountry = (item.country || '').toLowerCase();
      const itemAdmin1 = (item.admin1 || '').toLowerCase();

      if (itemName === cityQuery.toLowerCase()) score += 100;
      if (regionHint) {
        if (itemCountry.includes(regionHint) || itemAdmin1.includes(regionHint)) score += 200;
      }
      if (item.feature_code?.startsWith('PPL')) score += 40;
      if (item.population) {
        score += Math.min(80, Math.log10(Math.max(10, item.population)) * 12);
      }
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0].item;
  const displayParts = [best.name, best.admin1, best.country].filter(Boolean);
  const result: GeoCoordinates = {
    name: best.name,
    displayName: Array.from(new Set(displayParts)).join(', '),
    country: best.country,
    admin1: best.admin1,
    lat: best.latitude,
    lng: best.longitude,
  };

  geocodeCache.set(cacheKey, { data: result, expiresAt: Date.now() + GEOCODE_TTL_MS });
  return result;
}

// ---------- 2. Category Classification & Duration Helpers ----------
export function getEstimatedVisitDuration(category: AttractionCategory): string {
  switch (category) {
    case 'Museums':
      return '~2–2.5 hrs (est.)';
    case 'Historical Places':
      return '~1.5–2.5 hrs (est.)';
    case 'Lakes and Waterfalls':
      return '~1–1.5 hrs (est.)';
    case 'Nature and Parks':
      return '~1.5–2 hrs (est.)';
    case 'Temples and Religious Places':
      return '~45–90 mins (est.)';
    case 'Viewpoints':
      return '~45–60 mins (est.)';
    case 'Shopping':
      return '~1.5–2 hrs (est.)';
    default:
      return '~1.5–2 hrs (est.)';
  }
}

export function classifyTextToCategory(text: string): AttractionCategory {
  const lower = text.toLowerCase();
  if (/\b(museum|gallery|observatory|planetarium|aquarium)\b/.test(lower)) return 'Museums';
  if (/\b(temple|mandir|mosque|masjid|church|cathedral|basilica|shrine|gurdwara|monastery|synagogue|pagoda|ghat|stupa|abbey)\b/.test(lower)) {
    return 'Temples and Religious Places';
  }
  if (/\b(lake|waterfall|falls|reservoir|lagoon|pond|spring|beach|sagar)\b/.test(lower)) {
    return 'Lakes and Waterfalls';
  }
  if (/\b(viewpoint|lookout|sunset point|panoram|tower|peak|hilltop|minar|minaret)\b/.test(lower)) {
    return 'Viewpoints';
  }
  if (/\b(palace|mahal|fort|fortress|castle|monument|memorial|tomb|mausoleum|haveli|citadel|ruins|heritage|arch|gate|archaeological|stepwell|baori|cenotaph|killa|chowk)\b/.test(lower)) {
    return 'Historical Places';
  }
  if (/\b(park|garden|bagh|bari|zoo|sanctuary|botanical|reserve|forest)\b/.test(lower)) {
    return 'Nature and Parks';
  }
  if (/\b(bazaar|market|mall|souk|shopping)\b/.test(lower)) return 'Shopping';
  if (/\b(theatre|theater|opera|cultural|arts|auditorium)\b/.test(lower)) {
    return 'Cultural Attractions';
  }
  return 'Cultural Attractions';
}

// ---------- 3. Overpass Query Builder & Element Parser ----------
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface FoodVenue {
  name: string;
  cuisine?: string;
  lat: number;
  lng: number;
}

const EXCLUDED_TOURISM_TYPES = new Set([
  'hotel',
  'motel',
  'hostel',
  'guest_house',
  'apartment',
  'camp_site',
  'caravan_site',
  'chalet',
  'information',
]);

const EXCLUDED_NAME_PATTERNS = [
  /^parking/i,
  /^toilet/i,
  /^restroom/i,
  /^atm\b/i,
  /^ticket\s*(counter|booth|office)/i,
  /^entry\s*gate/i,
  /^exit\s*gate/i,
  /^bus\s*stop/i,
];

function classifyOsmTags(tags: Record<string, string>): AttractionCategory {
  const tourism = (tags.tourism || '').toLowerCase();
  const historic = (tags.historic || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();
  const natural = (tags.natural || '').toLowerCase();
  const leisure = (tags.leisure || '').toLowerCase();
  const shop = (tags.shop || '').toLowerCase();
  const water = (tags.water || '').toLowerCase();
  const waterway = (tags.waterway || '').toLowerCase();

  if (tourism === 'museum' || tourism === 'gallery' || amenity === 'museum') return 'Museums';
  if (amenity === 'place_of_worship' || historic === 'temple' || historic === 'wayside_shrine' || tags.religion) {
    return 'Temples and Religious Places';
  }
  if (
    natural === 'water' ||
    natural === 'waterfall' ||
    natural === 'spring' ||
    natural === 'beach' ||
    water === 'lake' ||
    water === 'reservoir' ||
    waterway === 'waterfall'
  ) {
    return 'Lakes and Waterfalls';
  }
  if (tourism === 'viewpoint' || natural === 'peak') return 'Viewpoints';
  if (historic) return 'Historical Places';
  if (tourism === 'theme_park' || leisure === 'water_park' || natural === 'cave_entrance' || tags.sport || tags.aerialway) {
    return 'Adventure';
  }
  if (leisure === 'park' || leisure === 'garden' || leisure === 'nature_reserve' || tourism === 'zoo' || tourism === 'aquarium') {
    return 'Nature and Parks';
  }
  if (shop || amenity === 'marketplace') return 'Shopping';
  if (amenity === 'restaurant' || amenity === 'cafe' || amenity === 'food_court') {
    return 'Food and Gastronomy';
  }
  if (amenity === 'arts_centre' || amenity === 'theatre' || tourism === 'artwork') {
    return 'Cultural Attractions';
  }
  return 'Cultural Attractions';
}

function buildOsmDescription(name: string, tags: Record<string, string>, category: AttractionCategory): string {
  if (tags.description && tags.description.trim().length > 10) {
    return tags.description.trim();
  }
  const qualifiers: string[] = [];
  if (tags.historic && tags.historic !== 'yes') qualifiers.push(`historic ${tags.historic.replace(/_/g, ' ')}`);
  if (tags.tourism && tags.tourism !== 'yes') qualifiers.push(tags.tourism.replace(/_/g, ' '));
  if (tags.natural && tags.natural !== 'yes') qualifiers.push(tags.natural.replace(/_/g, ' '));
  if (tags.water && tags.water !== 'yes') qualifiers.push(tags.water.replace(/_/g, ' '));
  if (tags.leisure && tags.leisure !== 'yes') qualifiers.push(tags.leisure.replace(/_/g, ' '));
  if (tags.religion) qualifiers.push(`${tags.religion.replace(/_/g, ' ')} site`);
  if (tags.heritage) qualifiers.push('heritage site');

  const detailText =
    qualifiers.length > 0
      ? `OpenStreetMap listing categorized as ${qualifiers.slice(0, 3).join(', ')}.`
      : `Verified ${category.toLowerCase()} attraction from OpenStreetMap.`;

  const addrParts = [tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean);
  const addrText = addrParts.length > 0 ? ` Located near ${addrParts.join(', ')}.` : '';
  return `${name} — ${detailText}${addrText}`;
}

function parseOsmFee(tags: Record<string, string>): { label: string; amount: number | null } {
  const feeTag = (tags.fee || '').toLowerCase().trim();
  const chargeTag = (tags.charge || '').trim();

  if (feeTag === 'no' || feeTag === 'free') {
    return { label: 'Free entry (OSM)', amount: 0 };
  }
  if (chargeTag) {
    const inrMatch =
      chargeTag.match(/(?:INR|Rs\.?|₹)\s*(\d[\d,]*)/i) ||
      chargeTag.match(/(\d[\d,]*)\s*(?:INR|Rs\.?)/i);
    if (inrMatch) {
      const numeric = parseInt(inrMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(numeric) && numeric >= 0) {
        return { label: `₹${numeric.toLocaleString('en-IN')} (OSM)`, amount: numeric };
      }
    }
    return { label: `${chargeTag} (OSM)`, amount: null };
  }
  if (feeTag === 'yes') {
    return { label: 'Entry fee applies (exact price unavailable)', amount: null };
  }
  return { label: 'Price unavailable', amount: null };
}

function computeOsmRelevanceScore(
  tags: Record<string, string>,
  category: AttractionCategory,
  distFromCenterKm: number
): number {
  let score = 20;
  if (tags.wikipedia || tags.wikidata) score += 40;
  if (tags.tourism === 'attraction') score += 26;
  if (tags.tourism === 'museum' || tags.tourism === 'viewpoint') score += 22;
  if (tags.historic && ['palace', 'fort', 'castle', 'monument', 'archaeological_site'].includes(tags.historic)) {
    score += 24;
  } else if (tags.historic) {
    score += 14;
  }
  if (tags.heritage) score += 16;
  if (tags.natural === 'water' || tags.water === 'lake' || tags.natural === 'waterfall') score += 18;
  if (tags.amenity === 'place_of_worship') score += 12;
  if (tags.opening_hours) score += 6;
  if (tags.website || tags['contact:website']) score += 6;
  if (tags.description) score += 5;
  if (tags['name:en']) score += 5;
  score -= Math.min(20, distFromCenterKm * 1.1);
  if (category === 'Shopping') score -= 6;
  return Math.round(score);
}

export function buildOverpassQuery(center: GeoCoordinates, radiusMeters: number): {
  query: string;
  safeRadius: number;
} {
  const safeRadius = Math.max(3000, Math.min(45000, radiusMeters));
  const latDelta = safeRadius / 111320;
  const lngDelta = safeRadius / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const south = (center.lat - latDelta).toFixed(4);
  const west = (center.lng - lngDelta).toFixed(4);
  const north = (center.lat + latDelta).toFixed(4);
  const east = (center.lng + lngDelta).toFixed(4);

  const query = `
[out:json][timeout:12][bbox:${south},${west},${north},${east}];
(
  nwr["tourism"~"^(attraction|museum|viewpoint|gallery|artwork|theme_park|zoo|aquarium)$"]["name"];
  nwr["historic"~"^(castle|palace|fort|monument|memorial|archaeological_site|ruins|heritage|temple|city_gate)$"]["name"];
  nwr["amenity"~"^(place_of_worship|arts_centre|theatre|marketplace)$"]["name"];
  nwr["natural"~"^(water|waterfall|peak|beach|cave_entrance)$"]["name"];
  nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"];
  nwr["amenity"~"^(restaurant|cafe)$"]["name"]["cuisine"];
);
out center 220;
`.trim();

  return { query, safeRadius };
}

export function processOsmElements(
  elements: OsmElement[],
  center: GeoCoordinates
): { attractions: DiscoveredAttraction[]; foodVenues: FoodVenue[] } {
  const rawAttractions: DiscoveredAttraction[] = [];
  const foodVenues: FoodVenue[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const displayName = (tags['name:en'] || tags.name || '').trim();
    if (!displayName) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat === undefined || lng === undefined) continue;

    if ((tags.amenity === 'restaurant' || tags.amenity === 'cafe') && !tags.tourism && !tags.historic) {
      foodVenues.push({ name: displayName, cuisine: tags.cuisine, lat, lng });
      continue;
    }

    if (tags.tourism && EXCLUDED_TOURISM_TYPES.has(tags.tourism.toLowerCase())) continue;
    if (tags.amenity === 'parking' || tags.amenity === 'toilets' || tags.shop === 'ticket') continue;
    if (EXCLUDED_NAME_PATTERNS.some((rx) => rx.test(displayName))) continue;

    const category = classifyOsmTags(tags);
    const distKm = haversineKm(center.lat, center.lng, lat, lng);
    const { label: priceLabel, amount: feeAmount } = parseOsmFee(tags);
    const relevanceScore = computeOsmRelevanceScore(tags, category, distKm);

    rawAttractions.push({
      id: `${el.type}/${el.id}`,
      name: displayName,
      category,
      lat,
      lng,
      distanceFromCenterKm: distKm,
      description: buildOsmDescription(displayName, tags, category),
      osmTags: tags,
      openingHours: tags.opening_hours,
      estimatedDuration: getEstimatedVisitDuration(category),
      entranceFee: priceLabel,
      feeAmount,
      website: tags.website || tags['contact:website'],
      relevanceScore,
      osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
      dataSource: 'openstreetmap-overpass',
    });
  }

  return {
    attractions: deduplicateAndAttachFood(rawAttractions, foodVenues),
    foodVenues,
  };
}

function deduplicateAndAttachFood(
  rawAttractions: DiscoveredAttraction[],
  foodVenues: FoodVenue[]
): DiscoveredAttraction[] {
  const deduped: DiscoveredAttraction[] = [];
  const sortedRaw = [...rawAttractions].sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const candidate of sortedRaw) {
    const normCand = normalizePlaceName(candidate.name);
    if (!normCand) continue;

    const duplicate = deduped.find((existing) => {
      const normEx = normalizePlaceName(existing.name);
      const dist = haversineKm(existing.lat, existing.lng, candidate.lat, candidate.lng);
      if (dist < 0.035) return true;
      if ((normEx === normCand || normEx.includes(normCand) || normCand.includes(normEx)) && dist < 0.8) {
        return true;
      }
      return false;
    });

    if (!duplicate) {
      let bestFood: { venue: FoodVenue; dist: number } | null = null;
      for (const fv of foodVenues) {
        const d = haversineKm(candidate.lat, candidate.lng, fv.lat, fv.lng);
        if (d <= 1.5 && (!bestFood || d < bestFood.dist)) {
          bestFood = { venue: fv, dist: d };
        }
      }

      if (bestFood) {
        const cuisineTxt = bestFood.venue.cuisine
          ? ` (${bestFood.venue.cuisine.replace(/;/g, ', ')})`
          : '';
        candidate.nearbyFood = `${bestFood.venue.name}${cuisineTxt} — ~${Math.round(bestFood.dist * 1000)}m away`;
      }

      deduped.push(candidate);
    }
  }

  return deduped;
}

// ---------- 4. Multi-Endpoint Overpass Executor (Auto-Fallback + Retry) ----------
async function tryOverpassEndpoints(
  query: string,
  endpoints: string[],
  timeoutMs: number
): Promise<{
  elements: OsmElement[];
  endpointUsed: string;
  attempts: EndpointAttemptLog[];
  allRateLimited: boolean;
}> {
  const attempts: EndpointAttemptLog[] = [];
  let rateLimitedCount = 0;

  for (const endpoint of endpoints) {
    const cooldownUntil = endpointCooldownUntil.get(endpoint) || 0;
    if (cooldownUntil > Date.now()) {
      const waitSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      attempts.push({
        endpoint,
        status: 429,
        message: `Rate-limit cooldown active (${waitSec}s remaining)`,
      });
      rateLimitedCount += 1;
      continue;
    }

    const body = new URLSearchParams({ data: query }).toString();
    let lastAttemptStatus: number | 'timeout' | 'network-error' = 'network-error';
    let lastAttemptMsg = 'Unknown error';

    // Up to 2 attempts per endpoint for transient 502/503, 1 attempt on timeout/429/406
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: getRequestHeaders(
              'application/json',
              'application/x-www-form-urlencoded; charset=UTF-8'
            ),
            body,
          },
          timeoutMs
        );

        if (res.status === 429 || res.status === 406) {
          endpointCooldownUntil.set(endpoint, Date.now() + 30_000);
          lastAttemptStatus = res.status;
          lastAttemptMsg = `HTTP ${res.status} (30s cooldown applied)`;
          rateLimitedCount += 1;
          break; // Immediately fall back to next Overpass mirror
        }

        if (res.ok) {
          const parsedOv = await safeParseJsonResponse<{ elements?: OsmElement[] }>(
            res,
            'Overpass API',
            endpoint
          );
          if (parsedOv.ok && Array.isArray(parsedOv.data?.elements)) {
            return {
              elements: parsedOv.data.elements,
              endpointUsed: endpoint,
              attempts,
              allRateLimited: false,
            };
          }
          if (!parsedOv.ok && parsedOv.isRateLimited) {
            endpointCooldownUntil.set(endpoint, Date.now() + 30_000);
            lastAttemptStatus = 429;
            lastAttemptMsg = parsedOv.error;
            rateLimitedCount += 1;
            break;
          }
          lastAttemptStatus = !parsedOv.ok && parsedOv.isTimeout ? 'timeout' : res.status;
          lastAttemptMsg = parsedOv.ok ? 'Malformed JSON response from Overpass' : parsedOv.error;
          break;
        }

        lastAttemptStatus = res.status;
        lastAttemptMsg = `HTTP ${res.status}`;
        if (res.status >= 500 && attempt === 1) {
          await sleep(600);
          continue;
        }
        break;
      } catch (err: any) {
        const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        lastAttemptStatus = isAbort ? 'timeout' : 'network-error';
        lastAttemptMsg = isAbort
          ? `Timed out after ${Math.round(timeoutMs / 1000)}s`
          : err?.message || 'Network/CORS failure';
        break; // Immediately move to next Overpass fallback endpoint
      }
    }

    attempts.push({
      endpoint,
      status: lastAttemptStatus,
      message: lastAttemptMsg,
    });
  }

  return {
    elements: [],
    endpointUsed: '',
    attempts,
    allRateLimited: endpoints.length > 0 && rateLimitedCount === endpoints.length,
  };
}

// ---------- 5. Open-Data Fallback (Wikidata SPARQL + Wikipedia GeoSearch) ----------
// Used automatically if ALL Overpass mirrors time out or return 5xx/network errors.
// Returns 100% real verified landmarks with coordinates and OpenStreetMap links, zero fake hours/prices.
const WIKI_EXCLUDE_PATTERN =
  /\b(constituency|railway station|metro station|subway station|train station|bus depot|bus station|airport|medical college|university|school|hospital|police|attack|bombing|battle|election|former kingdom|roman city|archdiocese|company|corporation|newspaper|magazine|hotel|resort|neighborhood|neighbourhood|arrondissement|municipality|ward of|district of|city in|town in|village in|capital of|metropolitan area|airline|lok sabha|vidhan sabha)\b/i;

const WIKI_INCLUDE_PATTERN =
  /\b(palace|mahal|fort|fortress|castle|temple|mandir|masjid|mosque|church|cathedral|basilica|shrine|museum|gallery|lake|sagar|waterfall|park|garden|bagh|bari|zoo|monument|memorial|arch|tower|gate|tomb|mausoleum|observatory|planetarium|aquarium|haveli|ghat|bazaar|market|theatre|theater|opera|bridge|square|plaza|viewpoint|landmark|heritage|sanctuary|island|beach|cenotaph|minar|minaret|stepwell|baori|stupa|abbey|citadel|fountain|statue)\b/i;

function parseWktPoint(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

async function discoverFromWikidataAndWikipedia(
  center: GeoCoordinates,
  radiusMeters: number
): Promise<{
  attractions: DiscoveredAttraction[];
  endpointUsed: string;
  attempts: EndpointAttemptLog[];
}> {
  const attempts: EndpointAttemptLog[] = [];
  const radiusKm = Math.max(5, Math.min(35, Math.round(radiusMeters / 1000)));
  const collected: DiscoveredAttraction[] = [];

  // 1. Wikidata SPARQL (fast direct P31 landmark query)
  const sparql = `
SELECT DISTINCT ?place ?placeLabel ?placeDescription ?coord ?sitelinks ?typeLabel WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${center.lng} ${center.lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  ?place wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 1)
  VALUES ?type {
    wd:Q570116 wd:Q33506 wd:Q16560 wd:Q23413 wd:Q4989906 wd:Q839954 wd:Q22698 wd:Q1107656 wd:Q23397 wd:Q34038 wd:Q16970 wd:Q44539 wd:Q32815 wd:Q35112127 wd:Q24354 wd:Q1081138 wd:Q2977 wd:Q160742 wd:Q1076486 wd:Q43501 wd:Q207694 wd:Q1370598
  }
  ?place wdt:P31 ?type .
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?place rdfs:label ?placeLabel .
    ?place schema:description ?placeDescription .
    ?type rdfs:label ?typeLabel .
  }
}
ORDER BY DESC(?sitelinks)
LIMIT 45
`;

  let wikidataSucceeded = false;
  try {
    const wdUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const res = await fetchWithTimeout(
      wdUrl,
      { headers: getRequestHeaders('application/sparql-results+json') },
      7500
    );
    if (res.ok) {
      const parsedWd = await safeParseJsonResponse<{
        results?: {
          bindings?: Array<{
            place?: { value: string };
            placeLabel?: { value: string };
            placeDescription?: { value: string };
            coord?: { value: string };
            sitelinks?: { value: string };
            typeLabel?: { value: string };
          }>;
        };
      }>(res, 'Wikidata SPARQL', wdUrl);

      if (!parsedWd.ok) {
        attempts.push({
          endpoint: 'https://query.wikidata.org/sparql',
          status: res.status,
          message: parsedWd.error,
        });
      } else {
        wikidataSucceeded = true;
        const json = parsedWd.data;

        for (const row of json.results?.bindings || []) {
        const name = (row.placeLabel?.value || '').trim();
        if (!name || /^Q\d+$/.test(name)) continue;
        if (WIKI_EXCLUDE_PATTERN.test(`${name} ${row.placeDescription?.value || ''}`)) continue;

        const pt = row.coord?.value ? parseWktPoint(row.coord.value) : null;
        if (!pt) continue;

        const typeLabel = row.typeLabel?.value || '';
        const desc = row.placeDescription?.value || '';
        const category = classifyTextToCategory(`${name} ${typeLabel} ${desc}`);
        const distKm = haversineKm(center.lat, center.lng, pt.lat, pt.lng);
        const sitelinks = parseInt(row.sitelinks?.value || '1', 10) || 1;
        const qid = row.place?.value?.split('/').pop() || name;

        collected.push({
          id: `wikidata/${qid}`,
          name,
          category,
          lat: pt.lat,
          lng: pt.lng,
          distanceFromCenterKm: distKm,
          description: desc
            ? `${name} — ${desc}.`
            : `Verified ${category.toLowerCase()} landmark in ${center.name} (Wikidata).`,
          osmTags: {},
          estimatedDuration: getEstimatedVisitDuration(category),
          entranceFee: 'Price unavailable',
          feeAmount: null,
          website: row.place?.value,
          relevanceScore: Math.round(40 + Math.min(60, sitelinks * 3) - Math.min(18, distKm)),
          osmUrl: `https://www.openstreetmap.org/?mlat=${pt.lat}&mlon=${pt.lng}#map=17/${pt.lat}/${pt.lng}`,
          dataSource: 'wikidata-wikipedia',
        });
        }
      }
    } else {
      attempts.push({
        endpoint: 'https://query.wikidata.org/sparql',
        status: res.status,
        message: `HTTP ${res.status}`,
      });
    }
  } catch (err: any) {
    attempts.push({
      endpoint: 'https://query.wikidata.org/sparql',
      status: err?.name === 'AbortError' ? 'timeout' : 'network-error',
      message: err?.message || 'Wikidata SPARQL unavailable',
    });
  }

  // 2. Wikipedia GeoSearch (fast <1s global coverage, complements or replaces if Wikidata timed out on dense mega-cities)
  let wikipediaSucceeded = false;
  if (collected.length < 10) {
    const wikiRadius = Math.min(10000, Math.max(4000, radiusMeters));
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${center.lat}%7C${center.lng}&ggsradius=${wikiRadius}&ggslimit=50&prop=coordinates%7Cdescription%7Cextracts&exintro=1&explaintext=1&exsentences=2&format=json&origin=*`;
    try {
      const res = await fetchWithTimeout(wikiUrl, { headers: getRequestHeaders() }, 8000);
      if (res.ok) {
        const parsedWiki = await safeParseJsonResponse<{
          query?: {
            pages?: Record<
              string,
              {
                pageid: number;
                title: string;
                description?: string;
                extract?: string;
                coordinates?: Array<{ lat: number; lon: number }>;
              }
            >;
          };
        }>(res, 'Wikipedia GeoSearch', wikiUrl);

        if (!parsedWiki.ok) {
          attempts.push({
            endpoint: 'https://en.wikipedia.org/w/api.php',
            status: res.status,
            message: parsedWiki.error,
          });
        } else {
          wikipediaSucceeded = true;
          const json = parsedWiki.data;

          const pages = Object.values(json.query?.pages || {});
          for (const page of pages) {
          const coord = page.coordinates?.[0];
          if (!coord) continue;

          const combinedText = `${page.title} ${page.description || ''}`;
          if (WIKI_EXCLUDE_PATTERN.test(combinedText)) continue;
          if (!WIKI_INCLUDE_PATTERN.test(combinedText)) continue;

          const category = classifyTextToCategory(combinedText);
          const distKm = haversineKm(center.lat, center.lng, coord.lat, coord.lon);
          const cleanExtract = (page.extract || '').trim();
          const desc =
            cleanExtract.length > 15
              ? cleanExtract.slice(0, 220) + (cleanExtract.length > 220 ? '...' : '')
              : page.description
              ? `${page.title} — ${page.description}.`
              : `Verified ${category.toLowerCase()} attraction near ${center.name}.`;

          collected.push({
            id: `wikipedia/${page.pageid}`,
            name: page.title,
            category,
            lat: coord.lat,
            lng: coord.lon,
            distanceFromCenterKm: distKm,
            description: desc,
            osmTags: {},
            estimatedDuration: getEstimatedVisitDuration(category),
            entranceFee: 'Price unavailable',
            feeAmount: null,
            website: `https://en.wikipedia.org/?curid=${page.pageid}`,
            relevanceScore: Math.round(55 - Math.min(18, distKm * 1.2)),
            osmUrl: `https://www.openstreetmap.org/?mlat=${coord.lat}&mlon=${coord.lon}#map=17/${coord.lat}/${coord.lon}`,
            dataSource: 'wikidata-wikipedia',
          });
          }
        }
      } else {
        attempts.push({
          endpoint: 'https://en.wikipedia.org/w/api.php',
          status: res.status,
          message: `HTTP ${res.status}`,
        });
      }
    } catch (err: any) {
      attempts.push({
        endpoint: 'https://en.wikipedia.org/w/api.php',
        status: err?.name === 'AbortError' ? 'timeout' : 'network-error',
        message: err?.message || 'Wikipedia GeoSearch unavailable',
      });
    }
  }

  const deduped = deduplicateAndAttachFood(collected, []);
  const endpointUsed =
    wikidataSucceeded && wikipediaSucceeded
      ? 'https://query.wikidata.org/sparql + en.wikipedia.org'
      : wikidataSucceeded
      ? 'https://query.wikidata.org/sparql'
      : wikipediaSucceeded
      ? 'https://en.wikipedia.org/w/api.php'
      : '';

  return { attractions: deduped, endpointUsed, attempts };
}

// ---------- 6. Public Discovery Orchestrator ----------
export interface DiscoverAttractionsInput {
  destination: string;
  startLocation?: string;
  radiusMeters?: number;
  customOverpassUrl?: string;
  openMeteoGeocodeUrl?: string;
}

export async function discoverRealAttractionsCore(
  input: DiscoverAttractionsInput
): Promise<DiscoveryResponse> {
  const destGeo = await geocodeDestinationCore(
    input.destination,
    input.openMeteoGeocodeUrl || DEFAULT_OPEN_METEO_GEOCODE_URL
  );

  let startDistanceKm: number | null = null;
  if (input.startLocation && input.startLocation.trim()) {
    try {
      const startGeo = await geocodeDestinationCore(
        input.startLocation,
        input.openMeteoGeocodeUrl || DEFAULT_OPEN_METEO_GEOCODE_URL
      );
      startDistanceKm = haversineKm(startGeo.lat, startGeo.lng, destGeo.lat, destGeo.lng);
    } catch {
      startDistanceKm = null;
    }
  }

  const radius = Math.max(3000, Math.min(45000, input.radiusMeters || 12000));
  const customUrl = input.customOverpassUrl
    ? validateExternalEndpoint(input.customOverpassUrl, '')
    : '';
  const endpointsToTry = Array.from(
    new Set([customUrl, ...OVERPASS_FALLBACK_ENDPOINTS].filter(Boolean))
  );

  const cacheKey = `${endpointsToTry[0]}|${destGeo.lat.toFixed(3)},${destGeo.lng.toFixed(3)}|${radius}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, startDistanceKm };
  }

  const { query } = buildOverpassQuery(destGeo, radius);
  const timeoutMs = isBrowser ? 8500 : 6000;
  const overpassRes = await tryOverpassEndpoints(query, endpointsToTry, timeoutMs);

  let finalAttractions: DiscoveredAttraction[] = [];
  let endpointUsed = overpassRes.endpointUsed;
  let source: DiscoveryResponse['source'] = 'openstreetmap-overpass';
  const allAttempts: EndpointAttemptLog[] = [...overpassRes.attempts];

  if (overpassRes.elements.length > 0) {
    const processed = processOsmElements(overpassRes.elements, destGeo);
    finalAttractions = processed.attractions;
  }

  // If Overpass endpoints all timed out / failed or returned < 2 results,
  // automatically try free Wikidata + Wikipedia GeoSearch so real attractions load cleanly without fabricating anything.
  if (finalAttractions.length < 2) {
    const wikiRes = await discoverFromWikidataAndWikipedia(destGeo, radius);
    allAttempts.push(...wikiRes.attempts);

    if (wikiRes.attractions.length > finalAttractions.length) {
      finalAttractions = deduplicateAndAttachFood([...finalAttractions, ...wikiRes.attractions], []);
      endpointUsed = wikiRes.endpointUsed || endpointUsed;
      source = overpassRes.elements.length > 0 ? 'mixed' : 'wikidata-wikipedia';
    }
  }

  const safeHostname = (raw: string): string => {
    try {
      return new URL(raw).hostname;
    } catch {
      return raw || 'unknown';
    }
  };

  if (finalAttractions.length < 2) {
    if (overpassRes.allRateLimited) {
      throw new TravelDiscoveryError(
        'All Overpass API endpoints requested a rate-limit pause (HTTP 429/406). Please wait 30 seconds before retrying.',
        'RATE_LIMITED',
        429,
        {
          retryAfterSeconds: 30,
          destGeo,
          overpassQuery: query,
          attempts: allAttempts,
        }
      );
    }

    if (!endpointUsed && overpassRes.attempts.length > 0) {
      throw new TravelDiscoveryError(
        `All tourist attraction endpoints timed out or were unreachable (${allAttempts
          .map((a) => `${safeHostname(a.endpoint)}: ${a.message}`)
          .join('; ')}). Please retry or expand the search radius.`,
        'SERVICE_UNAVAILABLE',
        504,
        {
          destGeo,
          overpassQuery: query,
          attempts: allAttempts,
        }
      );
    }

    throw new TravelDiscoveryError(
      `Only ${finalAttractions.length} named attraction(s) found within ${(radius / 1000).toFixed(0)} km of ${destGeo.displayName}. Try expanding the search radius or entering a larger nearby city.`,
      'INSUFFICIENT_RESULTS',
      404,
      {
        destGeo,
        overpassQuery: query,
        attempts: allAttempts,
      }
    );
  }

  const response: DiscoveryResponse = {
    attractions: finalAttractions.slice(0, 60),
    destinationInfo: destGeo,
    startDistanceKm,
    searchRadiusMeters: radius,
    endpointUsed,
    source,
    attempts: allAttempts,
    note:
      source === 'openstreetmap-overpass'
        ? `Discovered ${finalAttractions.length} real OpenStreetMap attractions via ${safeHostname(endpointUsed)}`
        : `Discovered ${finalAttractions.length} verified real landmarks in ${destGeo.displayName} (via fallback: ${endpointUsed})`,
  };

  discoveryCache.set(cacheKey, { data: response, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return response;
}

// ---------- 7. OSRM Driving Route (1 req/sec rate limit + cache + Haversine fallback) ----------
export async function getOsrmRouteCore(
  points: Array<{ lat: number; lng: number }>,
  osrmBaseUrl = DEFAULT_OSRM_URL
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

  const coordStr = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cacheKey = `${osrmBaseUrl}|${coordStr}`;
  const cached = osrmCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const buildFallback = (note: string): RouteSegmentResult => {
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
  };

  return enqueueOsrm(async () => {
    const recheck = osrmCache.get(cacheKey);
    if (recheck && recheck.expiresAt > Date.now()) {
      return recheck.data;
    }

    const elapsed = Date.now() - lastOsrmRequestAt;
    if (elapsed < 1100) {
      await sleep(1100 - elapsed);
    }
    lastOsrmRequestAt = Date.now();

    try {
      const url = `${osrmBaseUrl}/${coordStr}?overview=full&geometries=geojson`;
      const res = await fetchWithTimeout(url, { headers: getRequestHeaders() }, 10000);
      if (!res.ok) {
        return buildFallback(`OSRM returned HTTP ${res.status}; showing straight-line estimates.`);
      }

      const parsedOsrm = await safeParseJsonResponse<{
        code?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry?: { coordinates: Array<[number, number]> };
          legs?: Array<{ distance: number; duration: number }>;
        }>;
      }>(res, 'OSRM Route', url);

      if (!parsedOsrm.ok) {
        return buildFallback('OSRM returned non-JSON response; showing straight-line estimates.');
      }
      const json = parsedOsrm.data;

      if (json.code !== 'Ok' || !json.routes || json.routes.length === 0) {
        return buildFallback('OSRM route unavailable for coordinates; showing straight-line estimates.');
      }

      const route = json.routes[0];
      const geometry: Array<[number, number]> = (route.geometry?.coordinates || []).map(
        ([lng, lat]) => [lat, lng]
      );
      const legs = (route.legs || []).map((leg, i) => ({
        fromIndex: i,
        toIndex: i + 1,
        distanceKm: +(leg.distance / 1000).toFixed(2),
        durationMin: Math.max(1, Math.round(leg.duration / 60)),
      }));

      const result: RouteSegmentResult = {
        distanceKm: +(route.distance / 1000).toFixed(2),
        durationMin: Math.max(1, Math.round(route.duration / 60)),
        geometry: geometry.length > 0 ? geometry : points.map((p) => [p.lat, p.lng]),
        legs,
        source: 'osrm',
      };

      osrmCache.set(cacheKey, { data: result, expiresAt: Date.now() + OSRM_TTL_MS });
      return result;
    } catch (err: any) {
      return buildFallback(`OSRM unreachable (${err?.message || 'timeout'}); showing straight-line estimates.`);
    }
  });
}

// ---------- 8. Day-Wise Clustering & Itinerary Assembly (Selected / Verified Places Only) ----------
export function matchesUserPreferences(category: AttractionCategory, preferencesText: string): boolean {
  const pref = preferencesText.toLowerCase();
  if (!pref.trim()) return true;
  const map: Record<AttractionCategory, string[]> = {
    'Historical Places': ['historical', 'history', 'culture', 'heritage', 'architecture', 'photography'],
    Museums: ['culture', 'historical', 'museum', 'art', 'photography'],
    'Temples and Religious Places': ['culture', 'historical', 'relaxation', 'spiritual'],
    'Lakes and Waterfalls': ['nature', 'relaxation', 'photography', 'adventure'],
    'Nature and Parks': ['nature', 'relaxation', 'parks', 'photography'],
    Viewpoints: ['photography', 'nature', 'adventure', 'relaxation'],
    Adventure: ['adventure', 'nightlife'],
    Shopping: ['shopping', 'culture'],
    'Cultural Attractions': ['culture', 'historical', 'nightlife', 'photography'],
    'Food and Gastronomy': ['food', 'gastronomy'],
  };
  return (map[category] || []).some((kw) => pref.includes(kw));
}

function getRecommendedActivity(category: AttractionCategory, tags: Record<string, string>): string {
  switch (category) {
    case 'Historical Places':
      return tags.historic === 'palace' || tags.historic === 'fort' || tags.historic === 'castle'
        ? 'Architectural walk, heritage courtyard tour & landmark photography'
        : 'Historical sightseeing & heritage exploration';
    case 'Museums':
      return 'Curated exhibit exploration & cultural history walkthrough';
    case 'Temples and Religious Places':
      return 'Quiet architectural observation & cultural heritage visit';
    case 'Lakes and Waterfalls':
      return 'Lakeside promenade walk, scenic viewpoint stops & photography';
    case 'Nature and Parks':
      return 'Nature trail stroll, garden sightseeing & outdoor relaxation';
    case 'Viewpoints':
      return 'Panoramic city vista & golden-hour landscape photography';
    case 'Adventure':
      return 'Outdoor exploration & recreational sightseeing';
    case 'Shopping':
      return 'Local artisan browsing, regional crafts & bazaar walk';
    case 'Food and Gastronomy':
      return 'Regional culinary sampling & local street dining';
    default:
      return 'Cultural walk & landmark sightseeing';
  }
}

function orderByNearestNeighbor(spots: DiscoveredAttraction[]): DiscoveredAttraction[] {
  if (spots.length <= 2) return spots;
  const remaining = [...spots].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const ordered: DiscoveredAttraction[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

function clusterAttractionsByDay(
  attractions: DiscoveredAttraction[],
  numDays: number,
  useAllSelected = false
): DiscoveredAttraction[][] {
  if (attractions.length === 0) return [];
  const selected = useAllSelected ? attractions : attractions.slice(0, Math.min(attractions.length, numDays * 4));

  if (numDays === 1 || selected.length <= 2) {
    return [orderByNearestNeighbor(selected)];
  }

  const effectiveDays = Math.min(numDays, selected.length);
  const byAngle = [...selected].sort((a, b) => a.lng - b.lng);
  let centroids = Array.from({ length: effectiveDays }, (_, i) => {
    const idx = Math.min(byAngle.length - 1, Math.floor((i * byAngle.length) / effectiveDays));
    return { lat: byAngle[idx].lat, lng: byAngle[idx].lng };
  });

  let buckets: DiscoveredAttraction[][] = Array.from({ length: effectiveDays }, () => []);
  const maxPerDay = Math.ceil(selected.length / effectiveDays);

  for (let iter = 0; iter < 6; iter++) {
    buckets = Array.from({ length: effectiveDays }, () => []);
    for (const spot of selected) {
      const orderedClusters = centroids
        .map((c, idx) => ({ idx, dist: haversineKm(spot.lat, spot.lng, c.lat, c.lng) }))
        .sort((a, b) => a.dist - b.dist);

      let chosen = orderedClusters[0].idx;
      for (const cand of orderedClusters) {
        if (buckets[cand.idx].length < maxPerDay) {
          chosen = cand.idx;
          break;
        }
      }
      buckets[chosen].push(spot);
    }

    centroids = buckets.map((bucket, idx) => {
      if (bucket.length === 0) return centroids[idx];
      return {
        lat: bucket.reduce((s, x) => s + x.lat, 0) / bucket.length,
        lng: bucket.reduce((s, x) => s + x.lng, 0) / bucket.length,
      };
    });
  }

  return buckets.filter((b) => b.length > 0).map(orderByNearestNeighbor);
}

function buildDayTitle(dayNumber: number, destinationName: string, spots: DiscoveredAttraction[]): string {
  const counts = new Map<AttractionCategory, number>();
  spots.forEach((s) => counts.set(s.category, (counts.get(s.category) || 0) + 1));
  const sortedCats = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);

  const primary = sortedCats[0];
  let suffix = 'CITY HIGHLIGHTS & CULTURE';
  if (primary === 'Historical Places' || primary === 'Museums') {
    suffix = `${destinationName.toUpperCase()} HISTORICAL EXPLORATION`;
  } else if (primary === 'Lakes and Waterfalls') {
    suffix = 'LAKES AND SCENIC ATTRACTIONS';
  } else if (primary === 'Nature and Parks' || primary === 'Viewpoints') {
    suffix = 'NATURE, GARDENS AND VIEWPOINTS';
  } else if (primary === 'Temples and Religious Places') {
    suffix = 'HERITAGE TEMPLES AND CULTURE';
  } else if (primary === 'Shopping') {
    suffix = 'LOCAL BAZAARS AND CULTURE';
  } else if (primary === 'Adventure') {
    suffix = 'OUTDOOR ADVENTURE AND DISCOVERY';
  }

  if (sortedCats.length > 1 && sortedCats[1] === 'Lakes and Waterfalls' && primary === 'Historical Places') {
    suffix = `${destinationName.toUpperCase()} HERITAGE AND LAKES`;
  }
  return `DAY ${dayNumber} – ${suffix}`;
}

function parseUtcDateParts(dateStr: string): Date {
  const m = dateStr ? dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (m) {
    return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatDayDate(startDateStr: string, offsetDays: number): { iso: string; formatted: string } {
  const safeBase = parseUtcDateParts(startDateStr);
  const d = new Date(safeBase.getTime() + offsetDays * 86400000);
  return {
    iso: d.toISOString().split('T')[0],
    formatted: d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  };
}

function getSuggestedTimeSlot(
  index: number,
  category: AttractionCategory
): { arrival: string; duration: string; window: string } {
  const duration = getEstimatedVisitDuration(category);
  const slots = [
    { arrival: '09:30 AM (suggested)', window: '09:30 AM – 11:30 AM (est.)' },
    { arrival: '12:00 PM (suggested)', window: '12:00 PM – 02:00 PM (est.)' },
    { arrival: '03:00 PM (suggested)', window: '03:00 PM – 05:00 PM (est.)' },
    { arrival: '05:30 PM (suggested)', window: '05:30 PM – 07:00 PM (est.)' },
  ];
  const s = slots[index % slots.length];
  return { arrival: s.arrival, duration, window: s.window };
}

function estimateAccommodationPerNight(accommodation: string, travelers: number): number {
  const rooms = Math.max(1, Math.ceil(travelers / 2));
  const lower = (accommodation || '').toLowerCase();
  if (lower.includes('hostel')) return 700 * travelers;
  if (lower.includes('luxury') || lower.includes('resort')) return 6500 * rooms;
  if (lower.includes('villa') || lower.includes('ryokan')) return 4500 * rooms;
  if (lower.includes('apartment') || lower.includes('airbnb')) return 2400 * rooms;
  if (lower.includes('eco')) return 2800 * rooms;
  return 2200 * rooms;
}

function estimateBaseTransportCost(
  travelMode: string,
  travelers: number,
  distanceKm: number | null
): number {
  const dist = distanceKm ?? 500;
  const roundTripMultiplier = 2;
  switch (travelMode) {
    case 'flight':
      return Math.round(Math.max(3500, dist * 4.5) * roundTripMultiplier * travelers);
    case 'train':
      return Math.round(Math.max(600, dist * 1.1) * roundTripMultiplier * travelers);
    case 'bus':
      return Math.round(Math.max(450, dist * 0.9) * roundTripMultiplier * travelers);
    case 'car':
      return Math.round(Math.max(1200, dist * 9) * roundTripMultiplier);
    default:
      return Math.round(1200 * travelers);
  }
}

export interface BuildItineraryFromAttractionsInput {
  attractions: DiscoveredAttraction[];
  allDiscoveredAttractions?: DiscoveredAttraction[];
  destGeo: GeoCoordinates;
  startDistanceKm: number | null;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  travelPreferences: string;
  travelMode: string;
  accommodation: string;
  radiusMeters?: number;
  endpointUsed?: string;
  source?: string;
  customOsrmUrl?: string;
  useAllProvidedAttractions?: boolean;
  attempts?: EndpointAttemptLog[];
}

export async function assembleItineraryFromAttractionsCore(
  input: BuildItineraryFromAttractionsInput
): Promise<ItineraryGenerationResponse> {
  if (!input.attractions || input.attractions.length === 0) {
    throw new TravelDiscoveryError(
      'Please select at least 1 verified attraction to build your day-wise itinerary.',
      'VALIDATION_ERROR',
      400
    );
  }

  const startMs = parseUtcDateParts(input.startDate).getTime();
  const endMs = parseUtcDateParts(input.endDate).getTime();
  let totalDays = 3;
  if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
    totalDays = Math.max(1, Math.min(14, Math.round((endMs - startMs) / 86400000) + 1));
  }

  const ranked = [...input.attractions]
    .map((attr) => ({
      ...attr,
      relevanceScore:
        attr.relevanceScore + (matchesUserPreferences(attr.category, input.travelPreferences) ? 28 : 0),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const dayBuckets = clusterAttractionsByDay(ranked, totalDays, Boolean(input.useAllProvidedAttractions));

  const travelersCount = Math.max(1, Number(input.travelers) || 1);
  const totalBudget = Math.max(0, Number(input.budget) || 0);
  const nights = Math.max(0, dayBuckets.length - 1);
  const totalIntercityTransport = estimateBaseTransportCost(
    input.travelMode,
    travelersCount,
    input.startDistanceKm
  );
  const accomPerNight = estimateAccommodationPerNight(input.accommodation, travelersCount);
  const dailyFoodEstimate = 650 * travelersCount;
  const dailyOtherEstimate = 250 * travelersCount;
  const osrmUrl = input.customOsrmUrl
    ? validateExternalEndpoint(input.customOsrmUrl, DEFAULT_OSRM_URL)
    : DEFAULT_OSRM_URL;

  const days: DayItinerary[] = [];
  let unavailablePriceCount = 0;

  const categoryTotals: DayCostBreakdown = {
    transport: 0,
    accommodation: 0,
    food: 0,
    entranceFees: 0,
    other: 0,
  };

  for (let i = 0; i < dayBuckets.length; i++) {
    const spots = dayBuckets[i];
    const dayNumber = i + 1;
    const { iso: dateIso, formatted: formattedDate } = formatDayDate(input.startDate, i);

    const routeResult = await getOsrmRouteCore(
      spots.map((s) => ({ lat: s.lat, lng: s.lng })),
      osrmUrl
    );

    let dayEntranceFees = 0;
    const locations: TripLocationItem[] = spots.map((spot, idx) => {
      const slot = getSuggestedTimeSlot(idx, spot.category);
      const leg = idx > 0 ? routeResult.legs[idx - 1] : null;
      const distFromPrevKm =
        idx === 0
          ? 0
          : leg?.distanceKm ??
            haversineKm(spots[idx - 1].lat, spots[idx - 1].lng, spot.lat, spot.lng);
      const travelTimeMin =
        idx === 0
          ? 0
          : leg?.durationMin ?? Math.max(5, Math.round((distFromPrevKm / 25) * 60));

      const knownFeeTotal =
        spot.feeAmount !== null && spot.feeAmount !== undefined ? spot.feeAmount * travelersCount : 0;
      if (spot.feeAmount === null || spot.feeAmount === undefined) {
        unavailablePriceCount += 1;
      }
      dayEntranceFees += knownFeeTotal;

      return {
        name: spot.name,
        category: spot.category,
        description: spot.description,
        visitingTime: slot.window,
        arrivalTime: slot.arrival,
        visitDuration: spot.estimatedDuration || slot.duration,
        distanceFromPrevKm: idx === 0 ? null : distFromPrevKm,
        travelTimeMin: idx === 0 ? null : travelTimeMin,
        distanceSource:
          idx === 0 ? 'start' : routeResult.source === 'osrm' ? 'osrm' : 'haversine-estimate',
        cost: knownFeeTotal,
        priceLabel: spot.entranceFee || 'Price unavailable',
        openingHours: spot.openingHours,
        recommendedActivity: getRecommendedActivity(spot.category, spot.osmTags || {}),
        foodSuggestion:
          spot.nearbyFood || 'Nearby dining listings unavailable locally; explore local restaurants nearby',
        estimatedDistance:
          idx === 0
            ? spot.distanceFromCenterKm !== undefined
              ? `${spot.distanceFromCenterKm} km from city center`
              : 'Starting stop of the day'
            : `${distFromPrevKm} km from ${spots[idx - 1].name} (~${travelTimeMin} min${
                routeResult.source === 'osrm' ? ' via OSRM' : ' est.'
              })`,
        lat: spot.lat,
        lng: spot.lng,
        osmUrl: spot.osmUrl,
        osmId: spot.id,
      };
    });

    const localTransitCost = Math.round(Math.max(250, routeResult.distanceKm * 22));
    const dayIntercityShare =
      dayNumber === 1 || dayNumber === dayBuckets.length
        ? Math.round(totalIntercityTransport / (dayBuckets.length === 1 ? 1 : 2))
        : 0;
    const dayTransport = localTransitCost + dayIntercityShare;
    const dayAccom = i < nights ? accomPerNight : 0;
    const dayFood = dailyFoodEstimate;
    const dayOther = dailyOtherEstimate;
    const dayTotal = dayTransport + dayAccom + dayFood + dayEntranceFees + dayOther;

    categoryTotals.transport += dayTransport;
    categoryTotals.accommodation += dayAccom;
    categoryTotals.food += dayFood;
    categoryTotals.entranceFees += dayEntranceFees;
    categoryTotals.other += dayOther;

    const catsSummary = Array.from(new Set(spots.map((s) => s.category))).join(', ');

    days.push({
      dayNumber,
      date: dateIso,
      formattedDate,
      theme: buildDayTitle(dayNumber, input.destGeo.name, spots),
      description: `${spots.length} verified place(s) in ${input.destGeo.name} (${catsSummary}). Day route: ${routeResult.distanceKm} km (~${routeResult.durationMin} mins).`,
      estimatedCost: dayTotal,
      costBreakdown: {
        transport: dayTransport,
        accommodation: dayAccom,
        food: dayFood,
        entranceFees: dayEntranceFees,
        other: dayOther,
      },
      totalRouteDistanceKm: routeResult.distanceKm,
      totalRouteDurationMin: routeResult.durationMin,
      routeSource: routeResult.source,
      locations,
    });
  }

  const totalEstimatedExpenditure =
    categoryTotals.transport +
    categoryTotals.accommodation +
    categoryTotals.food +
    categoryTotals.entranceFees +
    categoryTotals.other;

  const budgetSummary: BudgetSummary = {
    totalBudget,
    totalEstimatedExpenditure,
    remainingBudget: totalBudget - totalEstimatedExpenditure,
    perPersonExpenditure: Math.round(totalEstimatedExpenditure / travelersCount),
    dailyBreakdown: days.map((d) => ({
      dayNumber: d.dayNumber,
      date: d.date || '',
      formattedDate: d.formattedDate || `Day ${d.dayNumber}`,
      amount: d.estimatedCost,
    })),
    categoryTotals,
    unavailablePriceCount,
  };

  return {
    itinerary: days,
    discoveredAttractions: (input.allDiscoveredAttractions || input.attractions).slice(0, 50),
    destinationInfo: input.destGeo,
    budgetSummary,
    searchRadiusMeters: input.radiusMeters || 12000,
    overpassEndpointUsed: input.endpointUsed || OVERPASS_FALLBACK_ENDPOINTS[0],
    source: input.source || 'openstreetmap-overpass-osrm',
    attempts: input.attempts,
    note: `Planned ${days.length}-day itinerary using ${ranked.length} verified real attractions in ${input.destGeo.displayName}`,
  };
}
