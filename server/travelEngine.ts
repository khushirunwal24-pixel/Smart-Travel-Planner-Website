import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  AttractionCategory,
  BudgetSummary,
  DayCostBreakdown,
  DayItinerary,
  DiscoveredAttraction,
  GeoCoordinates,
  ItineraryGenerationResponse,
  RouteSegmentResult,
  TripLocationItem,
} from '../src/types/index.js';
import { connectToMongoDB } from './db/connection.js';
import { CityModel, IPlace, PlaceModel } from './db/models.js';
import {
  deduplicateAndUpsertPlaces,
  haversineDistanceKm,
  NormalizedPlaceCandidate,
  placeToDiscoveredAttraction,
  resolveCountryCode,
  resolveCountryName,
  slugifyCity,
} from './places/normalizer.js';
import { fetchTravelTypeAttractions } from './places/adapters/traveltypeAdapter.js';
import { fetchWikidataAttractions } from './places/adapters/wikidataAdapter.js';
import { fetchOsmAttractions } from './places/adapters/osmAdapter.js';
import { fetchOpenTripMapAttractions } from './places/adapters/opentripmapAdapter.js';
import { parseJsonResponseSafely } from './places/httpClient.js';
import { rankAttractionsWithModel } from './ml/ranker.js';

export const OVERPASS_FALLBACK_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export interface TravelApiConfig {
  overpassUrl: string;
  overpassFallbacks: string[];
  osrmUrl: string;
  openMeteoGeocodeUrl: string;
  openMeteoForecastUrl: string;
}

export function normalizeOsrmUrl(rawUrl: string): string {
  const cleaned = (rawUrl || 'https://router.project-osrm.org/route/v1/driving').trim().replace(/\/$/, '');
  if (!cleaned.includes('/route/')) {
    return `${cleaned}/route/v1/driving`;
  }
  return cleaned;
}

export function getDefaultApiConfig(): TravelApiConfig {
  const primaryOverpass =
    process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
  const fallbacks = Array.from(new Set([primaryOverpass, ...OVERPASS_FALLBACK_SERVERS]));
  return {
    overpassUrl: primaryOverpass,
    overpassFallbacks: fallbacks,
    osrmUrl: normalizeOsrmUrl(process.env.OSRM_API_URL || 'https://router.project-osrm.org/route/v1/driving'),
    openMeteoGeocodeUrl:
      process.env.OPEN_METEO_GEOCODE_URL || 'https://geocoding-api.open-meteo.com/v1/search',
    openMeteoForecastUrl:
      process.env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
  };
}

export function validateExternalEndpoint(urlStr: string, fallback: string): string {
  if (!urlStr || typeof urlStr !== 'string') return fallback;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return fallback;
    }
    // Block localhost / private metadata IPs for safety
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

// ---------- In-Memory Caches ----------
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const geocodeCache = new Map<string, CacheEntry<GeoCoordinates>>();
const overpassCache = new Map<
  string,
  CacheEntry<{ attractions: DiscoveredAttraction[]; foodVenues: FoodVenue[]; endpointUsed: string }>
>();
const osrmCache = new Map<string, CacheEntry<RouteSegmentResult>>();

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OVERPASS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const OSRM_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---------- Rate Limiters & Queues ----------
let overpassQueue: Promise<unknown> = Promise.resolve();
let lastOverpassRequestAt = 0;
const overpassRateLimitUntil = new Map<string, number>(); // endpoint -> timestamp

let osrmQueue: Promise<unknown> = Promise.resolve();
let lastOsrmRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function enqueueOverpass<T>(task: () => Promise<T>): Promise<T> {
  const next = overpassQueue.then(task, task);
  overpassQueue = next.catch(() => undefined);
  return next;
}

function enqueueOsrm<T>(task: () => Promise<T>): Promise<T> {
  const next = osrmQueue.then(task, task);
  osrmQueue = next.catch(() => undefined);
  return next;
}

// ---------- Geo Helpers ----------
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

// ---------- Destination Validation & Geocoding ----------
export class DestinationValidationError extends Error {
  code: 'VALIDATION_ERROR';
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'DestinationValidationError';
    this.code = 'VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

export interface DestinationValidationResult {
  valid: boolean;
  cleaned?: string;
  cityQuery?: string;
  regionHint?: string;
  error?: string;
  code?: 'VALIDATION_ERROR';
}

const INVALID_LITERAL_DESTINATIONS = new Set(['null', 'undefined', 'nan', 'none', 'n/a', 'na']);

export function validateAndNormalizeDestination(raw: unknown): DestinationValidationResult {
  if (raw === null || raw === undefined) {
    return {
      valid: false,
      error: 'Destination cannot be empty. Please enter a city name such as Jaipur, Udaipur, or Delhi.',
      code: 'VALIDATION_ERROR',
    };
  }

  const trimmed = String(raw).trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Destination cannot be empty. Please enter a city name such as Jaipur, Udaipur, or Delhi.',
      code: 'VALIDATION_ERROR',
    };
  }

  if (trimmed.length > 120) {
    return {
      valid: false,
      error: 'Destination name is too long. Please enter a concise city or region name.',
      code: 'VALIDATION_ERROR',
    };
  }

  const parts = trimmed
    .split(',')
    .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      valid: false,
      error: 'Destination cannot be empty. Please enter a valid city name such as Jaipur, Udaipur, or Delhi.',
      code: 'VALIDATION_ERROR',
    };
  }

  const cityQuery = parts[0];
  const normalizedLower = cityQuery.toLowerCase();

  if (INVALID_LITERAL_DESTINATIONS.has(normalizedLower) || INVALID_LITERAL_DESTINATIONS.has(trimmed.toLowerCase())) {
    return {
      valid: false,
      error: 'Please enter a real destination city name (e.g. Jaipur, Udaipur, or Delhi).',
      code: 'VALIDATION_ERROR',
    };
  }

  // Must contain at least 2 Unicode letters (prevents "123", "a", "@!#", ",,," from reaching geocoder)
  const lettersOnly = cityQuery.replace(/[^\p{L}]/gu, '');
  if (lettersOnly.length < 2) {
    return {
      valid: false,
      error: 'Please enter a valid destination name with at least 2 letters (e.g. Jaipur, Udaipur, or Delhi).',
      code: 'VALIDATION_ERROR',
    };
  }

  const cleaned = parts.join(', ');
  const regionHint = parts.slice(1).join(' ').toLowerCase();
  return {
    valid: true,
    cleaned,
    cityQuery,
    regionHint,
  };
}

// ---------- 1. Open-Meteo + Nominatim Geocoding ----------
async function geocodeViaNominatim(cleanedQuery: string): Promise<GeoCoordinates | null> {
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    cleanedQuery
  )}&format=jsonv2&addressdetails=1&limit=5`;

  try {
    const res = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'SmartTravelPlanner/1.0 (https://smarttravelplanner.local)',
        Accept: 'application/json',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const parsed = await parseJsonResponseSafely<
      Array<{
        lat: string;
        lon: string;
        name?: string;
        display_name?: string;
        importance?: number;
        addresstype?: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state_district?: string;
          state?: string;
          country?: string;
        };
      }>
    >(res, 'Nominatim Geocode', nominatimUrl);

    if (!parsed.ok) return null;
    const rows = parsed.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const scored = [...rows]
      .filter((r) => !isNaN(parseFloat(r.lat)) && !isNaN(parseFloat(r.lon)))
      .sort((a, b) => {
        const aCityBoost =
          a.addresstype === 'city' || a.addresstype === 'town' || a.addresstype === 'state_district'
            ? 0.5
            : 0;
        const bCityBoost =
          b.addresstype === 'city' || b.addresstype === 'town' || b.addresstype === 'state_district'
            ? 0.5
            : 0;
        return (b.importance || 0) + bCityBoost - ((a.importance || 0) + aCityBoost);
      });

    if (scored.length === 0) return null;
    const best = scored[0];
    const cityName =
      best.name ||
      best.address?.city ||
      best.address?.town ||
      best.address?.village ||
      cleanedQuery.split(',')[0].trim();
    const admin1 = best.address?.state || best.address?.state_district;
    const country = best.address?.country;
    const displayParts = [cityName, admin1, country].filter(Boolean);

    return {
      name: cityName,
      displayName: Array.from(new Set(displayParts)).join(', ') || best.display_name || cityName,
      country,
      admin1,
      lat: parseFloat(best.lat),
      lng: parseFloat(best.lon),
    };
  } catch {
    return null;
  }
}

export async function geocodeDestination(
  queryText: string,
  geocodeUrl: string
): Promise<GeoCoordinates> {
  const validation = validateAndNormalizeDestination(queryText);
  if (!validation.valid || !validation.cleaned || !validation.cityQuery) {
    throw new DestinationValidationError(
      validation.error || 'Destination cannot be empty. Please enter a valid city name.'
    );
  }

  const cleaned = validation.cleaned;
  const cityQuery = validation.cityQuery;
  const regionHint = validation.regionHint || '';

  const cacheKey = `${geocodeUrl}|${cleaned.toLowerCase()}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = `${geocodeUrl}?name=${encodeURIComponent(cityQuery)}&count=8&language=en&format=json`;
  let openMeteoResults:
    | Array<{
        name: string;
        latitude: number;
        longitude: number;
        country?: string;
        admin1?: string;
        population?: number;
        feature_code?: string;
      }>
    | undefined;
  let openMeteoHttpError: number | null = null;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SmartTravelPlanner/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      openMeteoHttpError = res.status;
    } else {
      const parsed = await parseJsonResponseSafely<{ results?: typeof openMeteoResults }>(
        res,
        'Open-Meteo Geocode',
        url
      );
      if (parsed.ok) {
        openMeteoResults = parsed.data.results;
      } else {
        openMeteoHttpError = res.status || 502;
      }
    }
  } catch {
    openMeteoResults = undefined;
  }

  if (openMeteoResults && openMeteoResults.length > 0) {
    // Score matches: region hint match + population prominence + city feature priority
    const scored = openMeteoResults
      .map((item) => {
        let score = 0;
        const itemName = (item.name || '').toLowerCase();
        const itemCountry = (item.country || '').toLowerCase();
        const itemAdmin1 = (item.admin1 || '').toLowerCase();

        if (itemName === cityQuery.toLowerCase()) score += 100;
        if (regionHint) {
          if (itemCountry.includes(regionHint) || itemAdmin1.includes(regionHint)) {
            score += 200;
          }
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

  // Fallback to Nominatim for valid destination names missed or failed by Open-Meteo
  const nominatimResult = await geocodeViaNominatim(cleaned);
  if (nominatimResult) {
    geocodeCache.set(cacheKey, { data: nominatimResult, expiresAt: Date.now() + GEOCODE_TTL_MS });
    return nominatimResult;
  }

  if (openMeteoHttpError !== null) {
    throw new Error(`Geocoding service returned HTTP ${openMeteoHttpError}`);
  }

  throw new Error(
    `Could not find geographical coordinates for "${cleaned}". Please check the spelling or include the country name.`
  );
}

// ---------- 2. Overpass API Attraction Discovery ----------
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface FoodVenue {
  name: string;
  cuisine?: string;
  lat: number;
  lng: number;
}

export interface EndpointAttempt {
  endpoint: string;
  status: number | 'timeout' | 'network-error';
  message: string;
}

export class OverpassError extends Error {
  statusCode: number;
  retryAfterSeconds?: number;
  isRateLimited: boolean;
  destGeo?: GeoCoordinates;
  overpassQuery?: string;
  attempts: EndpointAttempt[];

  constructor(
    message: string,
    statusCode: number,
    retryAfterSeconds?: number,
    isRateLimited = false,
    destGeo?: GeoCoordinates,
    overpassQuery?: string,
    attempts: EndpointAttempt[] = []
  ) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.isRateLimited = isRateLimited;
    this.destGeo = destGeo;
    this.overpassQuery = overpassQuery;
    this.attempts = attempts;
  }
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

  if (tourism === 'museum' || tourism === 'gallery' || amenity === 'museum') {
    return 'Museums';
  }
  if (
    amenity === 'place_of_worship' ||
    historic === 'temple' ||
    historic === 'wayside_shrine' ||
    tags.religion
  ) {
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
  if (tourism === 'viewpoint' || natural === 'peak') {
    return 'Viewpoints';
  }
  if (
    historic &&
    [
      'castle',
      'palace',
      'fort',
      'monument',
      'memorial',
      'archaeological_site',
      'ruins',
      'heritage',
      'city_gate',
      'manor',
      'building',
      'yes',
    ].includes(historic)
  ) {
    return 'Historical Places';
  }
  if (historic) {
    return 'Historical Places';
  }
  if (
    tourism === 'theme_park' ||
    leisure === 'water_park' ||
    natural === 'cave_entrance' ||
    Boolean(tags.sport) ||
    Boolean(tags.aerialway)
  ) {
    return 'Adventure';
  }
  if (
    leisure === 'park' ||
    leisure === 'garden' ||
    leisure === 'nature_reserve' ||
    tourism === 'zoo' ||
    tourism === 'aquarium'
  ) {
    return 'Nature and Parks';
  }
  if (shop || amenity === 'marketplace') {
    return 'Shopping';
  }
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
  if (tags.historic && tags.historic !== 'yes') {
    qualifiers.push(`historic ${tags.historic.replace(/_/g, ' ')}`);
  }
  if (tags.tourism && tags.tourism !== 'yes') {
    qualifiers.push(tags.tourism.replace(/_/g, ' '));
  }
  if (tags.natural && tags.natural !== 'yes') {
    qualifiers.push(tags.natural.replace(/_/g, ' '));
  }
  if (tags.water && tags.water !== 'yes') {
    qualifiers.push(tags.water.replace(/_/g, ' '));
  }
  if (tags.leisure && tags.leisure !== 'yes') {
    qualifiers.push(tags.leisure.replace(/_/g, ' '));
  }
  if (tags.religion) {
    qualifiers.push(`${tags.religion.replace(/_/g, ' ')} site`);
  }
  if (tags.heritage) {
    qualifiers.push('designated heritage site');
  }

  const detailText =
    qualifiers.length > 0
      ? `OpenStreetMap listing categorized as ${qualifiers.slice(0, 3).join(', ')}.`
      : `Discovered ${category.toLowerCase()} point of interest on OpenStreetMap.`;

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
    // Only extract numeric INR if explicitly INR / Rs / ₹
    const inrMatch = chargeTag.match(/(?:INR|Rs\.?|₹)\s*(\d[\d,]*)/i) || chargeTag.match(/(\d[\d,]*)\s*(?:INR|Rs\.?)/i);
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

function computeRelevanceScore(
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

  // Slight distance decay so central attractions rank ahead of distant minor ones
  score -= Math.min(20, distFromCenterKm * 1.1);

  if (category === 'Shopping') score -= 6;
  return Math.round(score);
}

function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`".,()\-–—]/g, ' ')
    .replace(/\b(the|shri|sri)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runSingleOverpassRequest(
  query: string,
  overpassUrl: string,
  allowRetryAfterPause = true
): Promise<{ elements: OsmElement[]; endpointUsed: string }> {
  return enqueueOverpass(async () => {
    const cooldownUntil = overpassRateLimitUntil.get(overpassUrl) || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      const waitSec = Math.ceil((cooldownUntil - now) / 1000);
      throw new OverpassError(
        `Overpass API (${overpassUrl}) requested a rate-limit pause. Please retry in ${waitSec} seconds.`,
        429,
        waitSec,
        true
      );
    }

    // Respect sequential spacing between Overpass queries (>= 1.5s)
    const elapsedSinceLast = now - lastOverpassRequestAt;
    if (elapsedSinceLast < 1500) {
      await sleep(1500 - elapsedSinceLast);
    }
    lastOverpassRequestAt = Date.now();

    const executeFetch = async (): Promise<Response> => {
      const body = new URLSearchParams({ data: query }).toString();
      return fetchWithTimeout(
        overpassUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': 'SmartTravelPlanner/1.0 (OpenStreetMap travel itinerary generator)',
          },
          body,
        },
        4500
      );
    };

    const parseOverpassOrThrow = async (res: Response): Promise<{ elements: OsmElement[]; endpointUsed: string }> => {
      const parsed = await parseJsonResponseSafely<{ elements?: OsmElement[]; remark?: string }>(
        res,
        'Overpass API',
        overpassUrl
      );
      if (!parsed.ok) {
        if (parsed.isRateLimited) {
          overpassRateLimitUntil.set(overpassUrl, Date.now() + 30_000);
          throw new OverpassError(parsed.error, 429, 30, true);
        }
        throw new OverpassError(
          parsed.error,
          parsed.isTimeout ? 504 : 502,
          undefined,
          false
        );
      }
      if (!Array.isArray(parsed.data.elements)) {
        throw new OverpassError(
          `Overpass API (${overpassUrl}) returned JSON without an elements array (Content-Type: ${parsed.contentType}).`,
          502,
          undefined,
          false
        );
      }
      return { elements: parsed.data.elements, endpointUsed: overpassUrl };
    };

    let response: Response;
    try {
      response = await executeFetch();
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      throw new OverpassError(
        isTimeout
          ? `Overpass provider (${overpassUrl}) timed out after 4.5s.`
          : `Unable to reach Overpass provider (${overpassUrl}): ${err?.message || 'Network error'}.`,
        504,
        undefined,
        false
      );
    }

    // Retry once quickly on transient 502/503/504 errors
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      await sleep(500);
      try {
        response = await executeFetch();
      } catch {
        throw new OverpassError(
          `Overpass server (${overpassUrl}) timed out on retry (HTTP ${response.status}).`,
          504,
          undefined,
          false
        );
      }
    }

    // Handle 429 or 406 with a mandatory minimum 30-second pause
    if (response.status === 429 || response.status === 406) {
      const pauseMs = 30_000;
      overpassRateLimitUntil.set(overpassUrl, Date.now() + pauseMs);

      if (allowRetryAfterPause) {
        await sleep(pauseMs);
        lastOverpassRequestAt = Date.now();
        const retryResponse = await executeFetch();
        if (retryResponse.ok) {
          return await parseOverpassOrThrow(retryResponse);
        }
        if (retryResponse.status === 429 || retryResponse.status === 406) {
          overpassRateLimitUntil.set(overpassUrl, Date.now() + pauseMs);
          throw new OverpassError(
            `Overpass API returned HTTP ${retryResponse.status} after the 30-second pause. Please wait 30 seconds or switch to another OSM-compatible Overpass provider.`,
            retryResponse.status,
            30,
            true
          );
        }
        response = retryResponse;
      } else {
        throw new OverpassError(
          `Overpass API (${overpassUrl}) returned HTTP ${response.status}. A 30-second pause is required before retrying this server.`,
          response.status,
          30,
          true
        );
      }
    }

    if (!response.ok) {
      const parsedErr = await parseJsonResponseSafely<any>(response, 'Overpass HTTP Error', overpassUrl);
      const previewText = parsedErr.ok ? '' : parsedErr.preview;
      const hint =
        previewText.toLowerCase().includes('capacity') ||
        response.status === 502 ||
        response.status === 504
          ? `Overpass server (${overpassUrl}) is currently at capacity or timed out (HTTP ${response.status}).`
          : `Overpass API (${overpassUrl}) responded with HTTP ${response.status}${
              previewText ? `: ${previewText.slice(0, 140)}` : '.'
            }`;
      throw new OverpassError(hint, response.status, undefined, false);
    }

    return await parseOverpassOrThrow(response);
  });
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
  nwr["shop"~"^(mall|department_store|craft)$"]["name"];
  nwr["amenity"~"^(restaurant|cafe)$"]["name"]["cuisine"];
);
out center 240;
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

    // Separate dining spots into foodVenues list so they enhance food suggestions
    if ((tags.amenity === 'restaurant' || tags.amenity === 'cafe') && !tags.tourism && !tags.historic) {
      foodVenues.push({
        name: displayName,
        cuisine: tags.cuisine,
        lat,
        lng,
      });
      continue;
    }

    if (tags.tourism && EXCLUDED_TOURISM_TYPES.has(tags.tourism.toLowerCase())) continue;
    if (tags.amenity === 'parking' || tags.amenity === 'toilets' || tags.shop === 'ticket') continue;
    if (EXCLUDED_NAME_PATTERNS.some((rx) => rx.test(displayName))) continue;

    const category = classifyOsmTags(tags);
    const distKm = haversineKm(center.lat, center.lng, lat, lng);
    const { label: priceLabel, amount: feeAmount } = parseOsmFee(tags);
    const relevanceScore = computeRelevanceScore(tags, category, distKm);

    rawAttractions.push({
      id: `${el.type}/${el.id}`,
      name: displayName,
      category,
      lat,
      lng,
      description: buildOsmDescription(displayName, tags, category),
      osmTags: tags,
      openingHours: tags.opening_hours,
      entranceFee: priceLabel,
      feeAmount,
      website: tags.website || tags['contact:website'],
      relevanceScore,
      osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
    });
  }

  // Deduplicate by normalized name + proximity (< 0.8 km) or identical coordinates (< 35m)
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
      // Attach closest real OSM dining venue within 1.5 km if available
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

  return { attractions: deduped, foodVenues };
}

// ---------- 2B. Server-Side Fallback: Wikidata SPARQL + Wikipedia GeoSearch ----------
const WIKI_EXCLUDE_PATTERN =
  /\b(constituency|railway station|metro station|subway station|train station|bus depot|bus station|airport|medical college|university|school|hospital|police|attack|bombing|battle|election|former kingdom|roman city|archdiocese|company|corporation|newspaper|magazine|hotel|guesthouse|hostel|resort|neighborhood|neighbourhood|arrondissement|municipality|ward of|district of|city in|town in|village in|capital of|metropolitan area|airline|lok sabha|vidhan sabha)\b/i;

const WIKI_INCLUDE_PATTERN =
  /\b(palace|mahal|fort|fortress|castle|temple|mandir|masjid|mosque|church|cathedral|basilica|shrine|museum|gallery|lake|sagar|waterfall|park|garden|bagh|bari|zoo|monument|memorial|arch|tower|gate|tomb|mausoleum|observatory|planetarium|aquarium|haveli|ghat|bazaar|market|theatre|theater|opera|bridge|square|plaza|viewpoint|landmark|heritage|sanctuary|island|beach|cenotaph|minar|minaret|stepwell|baori|stupa|abbey|citadel|fountain|statue|cultural center|cultural institution)\b/i;

function classifyTextToCategory(text: string): AttractionCategory {
  const lower = text.toLowerCase();
  if (/\b(museum|gallery|planetarium|kendra|kalakshetra|observatory|jantar mantar)\b/.test(lower)) {
    return 'Museums';
  }
  if (/\b(temple|mandir|mosque|masjid|church|cathedral|basilica|shrine|gurudwara|monastery|abbey|pilgrimage)\b/.test(lower)) {
    return 'Temples and Religious Places';
  }
  if (/\b(lake|sagar|waterfall|reservoir|pond|kund|river|beach|dam|island)\b/.test(lower)) {
    return 'Lakes and Waterfalls';
  }
  if (/\b(viewpoint|hill|peak|sunset point|monsoon palace|nahargarh)\b/.test(lower)) {
    return 'Viewpoints';
  }
  if (/\b(palace|mahal|fort|castle|fortress|monument|memorial|haveli|tomb|mausoleum|gate|cenotaph|stepwell|baori|archaeological|ruins|heritage|citadel)\b/.test(lower)) {
    return 'Historical Places';
  }
  if (/\b(park|garden|bagh|bari|botanical|zoo|wildlife|sanctuary|nature reserve|forest)\b/.test(lower)) {
    return 'Nature and Parks';
  }
  if (/\b(bazaar|market|shopping|haat|emporium)\b/.test(lower)) {
    return 'Shopping';
  }
  if (/\b(adventure|theme park|water park|amusement|ropeway|cable car)\b/.test(lower)) {
    return 'Adventure';
  }
  return 'Cultural Attractions';
}

function parseWktPoint(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

function deduplicateAttractions(items: DiscoveredAttraction[]): DiscoveredAttraction[] {
  const deduped: DiscoveredAttraction[] = [];
  const sorted = [...items].sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const candidate of sorted) {
    const normCand = normalizePlaceName(candidate.name);
    if (!normCand) continue;

    const duplicate = deduped.find((existing) => {
      const normEx = normalizePlaceName(existing.name);
      const dist = haversineKm(existing.lat, existing.lng, candidate.lat, candidate.lng);
      if (dist < 0.04) return true;
      if (
        (normEx === normCand || normEx.includes(normCand) || normCand.includes(normEx)) &&
        dist < 2.5
      ) {
        return true;
      }
      return false;
    });

    if (!duplicate) {
      deduped.push(candidate);
    }
  }
  return deduped;
}

async function discoverFromWikidataAndWikipedia(
  center: GeoCoordinates,
  radiusMeters: number
): Promise<{
  attractions: DiscoveredAttraction[];
  endpointUsed: string;
  source: 'wikidata-sparql' | 'wikipedia-geosearch' | 'wikidata-wikipedia';
  attempts: EndpointAttempt[];
}> {
  const attempts: EndpointAttempt[] = [];
  const radiusKm = Math.max(5, Math.min(35, Math.round(radiusMeters / 1000)));
  const collected: DiscoveredAttraction[] = [];

  const buildSparql = (minSitelinks: number) => `
SELECT ?place ?placeLabel ?placeDescription ?coord ?sitelinks (SAMPLE(?typeLabel) AS ?primaryType) ?osmNode ?osmWay ?osmRel WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${center.lng} ${center.lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  ?place wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= ${minSitelinks})
  VALUES ?cat {
    wd:Q570116 wd:Q33506 wd:Q23413 wd:Q16560 wd:Q57821 wd:Q839954
    wd:Q22698 wd:Q1107656 wd:Q44539 wd:Q1370598 wd:Q4989906
    wd:Q23397 wd:Q34038 wd:Q6017969 wd:Q9259 wd:Q1081138 wd:Q1802963 wd:Q1785071
    wd:Q32815 wd:Q16970 wd:Q24354 wd:Q207694 wd:Q43501 wd:Q160742
  }
  ?place wdt:P31 ?type .
  { ?place wdt:P31 ?cat } UNION { ?type wdt:P279 ?cat }
  FILTER NOT EXISTS { ?place wdt:P31 wd:Q27686 }
  FILTER NOT EXISTS { ?place wdt:P31 wd:Q11707 }
  OPTIONAL { ?place wdt:P11693 ?osmNode . }
  OPTIONAL { ?place wdt:P10689 ?osmWay . }
  OPTIONAL { ?place wdt:P402 ?osmRel . }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?place rdfs:label ?placeLabel .
    ?place schema:description ?placeDescription .
    ?type rdfs:label ?typeLabel .
  }
}
GROUP BY ?place ?placeLabel ?placeDescription ?coord ?sitelinks ?osmNode ?osmWay ?osmRel
ORDER BY DESC(?sitelinks)
LIMIT 55
`;

  let wikidataSucceeded = false;
  const runWikidataQuery = async (minSitelinks: number) => {
    const wdEndpoint = 'https://query.wikidata.org/sparql';
    const url = `${wdEndpoint}?format=json&query=${encodeURIComponent(buildSparql(minSitelinks))}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: 'application/sparql-results+json',
            'User-Agent': 'SmartTravelPlanner/1.0 (https://smart-travel-planner.app)',
          },
        },
        10000
      );
      if (res.status >= 500) {
        await sleep(500);
        res = await fetchWithTimeout(
          url,
          {
            headers: {
              Accept: 'application/sparql-results+json',
              'User-Agent': 'SmartTravelPlanner/1.0 (https://smart-travel-planner.app)',
            },
          },
          10000
        );
      }
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      attempts.push({
        endpoint: wdEndpoint,
        status: isTimeout ? 'timeout' : 'network-error',
        message: isTimeout ? 'Wikidata SPARQL timed out' : err?.message || 'Network error',
      });
      return;
    }

    if (!res.ok) {
      attempts.push({
        endpoint: wdEndpoint,
        status: res.status,
        message: `Wikidata SPARQL returned HTTP ${res.status}`,
      });
      return;
    }

    const parsedWd = await parseJsonResponseSafely<{
      results?: {
        bindings?: Array<{
          place?: { value: string };
          placeLabel?: { value: string };
          placeDescription?: { value: string };
          coord?: { value: string };
          sitelinks?: { value: string };
          primaryType?: { value: string };
          osmNode?: { value: string };
          osmWay?: { value: string };
          osmRel?: { value: string };
        }>;
      };
    }>(res, 'Wikidata Fallback SPARQL', wdEndpoint);

    if (!parsedWd.ok) {
      attempts.push({
        endpoint: wdEndpoint,
        status: res.status,
        message: parsedWd.error,
      });
      return;
    }

    wikidataSucceeded = true;
    const json = parsedWd.data;

    for (const row of json.results?.bindings || []) {
      const name = (row.placeLabel?.value || '').trim();
      if (!name || /^Q\d+$/.test(name)) continue;
      const desc = (row.placeDescription?.value || '').trim();
      const typeLabel = (row.primaryType?.value || '').trim();
      if (WIKI_EXCLUDE_PATTERN.test(`${name} ${typeLabel} ${desc}`)) continue;

      const pt = row.coord?.value ? parseWktPoint(row.coord.value) : null;
      if (!pt) continue;

      const category = classifyTextToCategory(`${name} ${typeLabel} ${desc}`);
      const distKm = haversineKm(center.lat, center.lng, pt.lat, pt.lng);
      const sitelinks = parseInt(row.sitelinks?.value || '1', 10) || 1;
      const qid = row.place?.value?.split('/').pop() || name;

      let osmUrl = `https://www.openstreetmap.org/?mlat=${pt.lat}&mlon=${pt.lng}#map=17/${pt.lat}/${pt.lng}`;
      if (row.osmRel?.value) {
        osmUrl = `https://www.openstreetmap.org/relation/${row.osmRel.value}`;
      } else if (row.osmWay?.value) {
        osmUrl = `https://www.openstreetmap.org/way/${row.osmWay.value}`;
      } else if (row.osmNode?.value) {
        osmUrl = `https://www.openstreetmap.org/node/${row.osmNode.value}`;
      }

      const typeNote = typeLabel && !/^Q\d+$/.test(typeLabel) ? typeLabel : category.toLowerCase();
      collected.push({
        id: `wikidata/${qid}`,
        name,
        category,
        lat: pt.lat,
        lng: pt.lng,
        description: desc
          ? `${name} — ${desc}.`
          : `${name} — verified ${typeNote} in ${center.name} (Wikidata / OpenStreetMap).`,
        osmTags: {
          wikidata: qid,
          ...(typeLabel ? { type: typeLabel } : {}),
        },
        entranceFee: 'Price unavailable',
        feeAmount: null,
        website: row.place?.value,
        relevanceScore: Math.round(38 + Math.min(62, sitelinks * 2.5) - Math.min(18, distKm)),
        osmUrl,
      });
    }
  };

  await runWikidataQuery(2);
  // If dense filter yielded very few on a smaller destination, relax sitelinks threshold to 1
  if (deduplicateAttractions(collected).length < 6) {
    await runWikidataQuery(1);
  }

  // Supplement with Wikipedia GeoSearch (fast <1s) when Wikidata returns < 16 deduplicated places or failed
  let wikipediaSucceeded = false;
  if (deduplicateAttractions(collected).length < 16) {
    const wikiEndpoint = 'https://en.wikipedia.org/w/api.php';
    const wikiRadius = Math.min(10000, Math.max(5000, radiusMeters));
    const wikiUrl = `${wikiEndpoint}?action=query&generator=geosearch&ggscoord=${center.lat}%7C${center.lng}&ggsradius=${wikiRadius}&ggslimit=50&prop=coordinates%7Cdescription%7Cextracts&exintro=1&explaintext=1&exsentences=2&format=json&origin=*`;
    try {
      const res = await fetchWithTimeout(
        wikiUrl,
        { headers: { 'User-Agent': 'SmartTravelPlanner/1.0 (https://smart-travel-planner.app)' } },
        7500
      );
      if (res.ok) {
        const parsedWiki = await parseJsonResponseSafely<{
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
        }>(res, 'Wikipedia GeoSearch', wikiEndpoint);

        if (!parsedWiki.ok) {
          attempts.push({
            endpoint: wikiEndpoint,
            status: res.status,
            message: parsedWiki.error,
          });
        } else {
          wikipediaSucceeded = true;
          const json = parsedWiki.data;

          for (const page of Object.values(json.query?.pages || {})) {
            const coord = page.coordinates?.[0];
            if (!coord) continue;
            const combined = `${page.title} ${page.description || ''}`;
            if (WIKI_EXCLUDE_PATTERN.test(combined)) continue;
            if (!WIKI_INCLUDE_PATTERN.test(combined)) continue;

            const category = classifyTextToCategory(combined);
            const distKm = haversineKm(center.lat, center.lng, coord.lat, coord.lon);
            const cleanExtract = (page.extract || '').trim();
            const desc =
              cleanExtract.length > 15
                ? cleanExtract.slice(0, 220) + (cleanExtract.length > 220 ? '...' : '')
                : page.description
                ? `${page.title} — ${page.description}.`
                : `${page.title} — verified ${category.toLowerCase()} landmark near ${center.name}.`;

            collected.push({
              id: `wikipedia/${page.pageid}`,
              name: page.title,
              category,
              lat: coord.lat,
              lng: coord.lon,
              description: desc,
              osmTags: { wikipedia: page.title },
              entranceFee: 'Price unavailable',
              feeAmount: null,
              website: `https://en.wikipedia.org/?curid=${page.pageid}`,
              relevanceScore: Math.round(52 - Math.min(18, distKm * 1.2)),
              osmUrl: `https://www.openstreetmap.org/?mlat=${coord.lat}&mlon=${coord.lon}#map=17/${coord.lat}/${coord.lon}`,
            });
          }
        }
      } else {
        attempts.push({
          endpoint: wikiEndpoint,
          status: res.status,
          message: `Wikipedia GeoSearch returned HTTP ${res.status}`,
        });
      }
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      attempts.push({
        endpoint: wikiEndpoint,
        status: isTimeout ? 'timeout' : 'network-error',
        message: isTimeout ? 'Wikipedia GeoSearch timed out' : err?.message || 'Network error',
      });
    }
  }

  const deduped = deduplicateAttractions(collected);
  const source: 'wikidata-sparql' | 'wikipedia-geosearch' | 'wikidata-wikipedia' =
    wikidataSucceeded && wikipediaSucceeded
      ? 'wikidata-wikipedia'
      : wikidataSucceeded
      ? 'wikidata-sparql'
      : 'wikipedia-geosearch';
  const endpointUsed =
    wikidataSucceeded && wikipediaSucceeded
      ? 'https://query.wikidata.org/sparql + en.wikipedia.org'
      : wikidataSucceeded
      ? 'https://query.wikidata.org/sparql'
      : wikipediaSucceeded
      ? 'https://en.wikipedia.org/w/api.php'
      : '';

  return { attractions: deduped, endpointUsed, source, attempts };
}

export async function discoverAttractions(
  center: GeoCoordinates,
  radiusMeters: number,
  config: TravelApiConfig,
  _waitOnRateLimit = false
): Promise<{
  attractions: DiscoveredAttraction[];
  foodVenues: FoodVenue[];
  endpointUsed: string;
  fallbacksTried: string[];
  dataSource: string;
  attempts: EndpointAttempt[];
}> {
  const { query, safeRadius } = buildOverpassQuery(center, radiusMeters);
  const candidateServers = Array.from(
    new Set([config.overpassUrl, ...(config.overpassFallbacks || OVERPASS_FALLBACK_SERVERS)])
  );

  // Check cache across primary + fallback keys for this location + radius
  for (const cacheKey of [
    `auto|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${safeRadius}`,
    ...candidateServers.map((ep) => `${ep}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${safeRadius}`),
  ]) {
    const cached = overpassCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.data.attractions.length >= 2) {
      return {
        ...cached.data,
        fallbacksTried: [cached.data.endpointUsed],
        dataSource: cached.data.endpointUsed.includes('wikidata') || cached.data.endpointUsed.includes('wikipedia')
          ? 'wikidata-wikipedia'
          : 'openstreetmap-overpass',
        attempts: [],
      };
    }
  }

  const fallbacksTried: string[] = [];
  const attempts: EndpointAttempt[] = [];
  let lastError: OverpassError | null = null;
  let allRateLimited = true;
  const chainStart = Date.now();

  let bestAttractions: DiscoveredAttraction[] = [];
  let bestFoodVenues: FoodVenue[] = [];
  let endpointUsed = '';
  let dataSource = 'openstreetmap-overpass';

  for (const endpoint of candidateServers) {
    // Cap overall Overpass fallback probing at ~8.5s when endpoints time out so server-side Wikidata/Wikipedia fallback runs promptly
    if (fallbacksTried.length >= 2 && Date.now() - chainStart > 8500) {
      break;
    }

    fallbacksTried.push(endpoint);
    try {
      const { elements, endpointUsed: used } = await runSingleOverpassRequest(query, endpoint, false);
      const { attractions, foodVenues } = processOsmElements(elements, center);
      attempts.push({
        endpoint,
        status: 200,
        message: `Returned ${attractions.length} named attractions`,
      });
      if (attractions.length >= 2) {
        bestAttractions = attractions;
        bestFoodVenues = foodVenues;
        endpointUsed = used;
        const cacheKey = `auto|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${safeRadius}`;
        overpassCache.set(cacheKey, {
          data: { attractions, foodVenues, endpointUsed },
          expiresAt: Date.now() + OVERPASS_TTL_MS,
        });
        return {
          attractions,
          foodVenues,
          endpointUsed,
          fallbacksTried,
          dataSource: 'openstreetmap-overpass',
          attempts,
        };
      }
      bestAttractions = attractions;
      bestFoodVenues = foodVenues;
      endpointUsed = used;
    } catch (err: any) {
      const ovErr =
        err instanceof OverpassError
          ? err
          : new OverpassError(err?.message || 'Overpass error', 504, undefined, false);
      lastError = ovErr;
      if (!ovErr.isRateLimited && ovErr.statusCode !== 429 && ovErr.statusCode !== 406) {
        allRateLimited = false;
      }
      attempts.push({
        endpoint,
        status: ovErr.statusCode === 504 ? 'timeout' : ovErr.statusCode || 'network-error',
        message: ovErr.message,
      });
    }
  }

  // Server-side fallback to free Wikidata SPARQL + Wikipedia GeoSearch if Overpass endpoints failed/timed out or returned < 2 results
  const wikiResult = await discoverFromWikidataAndWikipedia(center, safeRadius);
  attempts.push(...wikiResult.attempts);
  if (wikiResult.endpointUsed) {
    fallbacksTried.push(wikiResult.endpointUsed);
  }

  if (wikiResult.attractions.length > 0) {
    const merged = deduplicateAttractions([...bestAttractions, ...wikiResult.attractions]);
    if (merged.length >= 1) {
      endpointUsed = wikiResult.endpointUsed || endpointUsed || 'https://query.wikidata.org/sparql';
      dataSource = bestAttractions.length > 0 ? 'mixed' : wikiResult.source;
      const cacheKey = `auto|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${safeRadius}`;
      overpassCache.set(cacheKey, {
        data: { attractions: merged, foodVenues: bestFoodVenues, endpointUsed },
        expiresAt: Date.now() + OVERPASS_TTL_MS,
      });
      return {
        attractions: merged,
        foodVenues: bestFoodVenues,
        endpointUsed,
        fallbacksTried,
        dataSource,
        attempts,
      };
    }
  }

  if (bestAttractions.length > 0) {
    return {
      attractions: bestAttractions,
      foodVenues: bestFoodVenues,
      endpointUsed,
      fallbacksTried,
      dataSource,
      attempts,
    };
  }

  const attemptSummary = attempts
    .map((a) => {
      try {
        return `${new URL(a.endpoint).hostname}: ${a.message}`;
      } catch {
        return `${a.endpoint}: ${a.message}`;
      }
    })
    .join(' | ');

  if (allRateLimited && fallbacksTried.length > 0 && lastError?.isRateLimited) {
    throw new OverpassError(
      `Attraction discovery rate-limited (${attemptSummary}). Please wait 30 seconds before retrying.`,
      429,
      lastError.retryAfterSeconds || 30,
      true,
      center,
      query,
      attempts
    );
  }

  if (!wikiResult.endpointUsed && lastError) {
    throw new OverpassError(
      `All backend attraction discovery sources failed (${attemptSummary}).`,
      lastError.statusCode || 504,
      undefined,
      false,
      center,
      query,
      attempts
    );
  }

  throw new OverpassError(
    `No named tourist attractions were found within ${(safeRadius / 1000).toFixed(0)} km of ${center.displayName}. Try expanding the search radius or verifying the city name.`,
    404,
    undefined,
    false,
    center,
    query,
    attempts
  );
}

// ---------- 3. OSRM Routing (1 req/sec rate limit + cache + Haversine fallback) ----------
export async function getOsrmRoute(
  points: Array<{ lat: number; lng: number }>,
  osrmBaseUrl: string
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
      const dur = Math.max(4, Math.round((dist / 25) * 60)); // ~25 km/h urban avg
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

    // Strict 1 request per second public server policy (1100ms spacing)
    const elapsed = Date.now() - lastOsrmRequestAt;
    if (elapsed < 1100) {
      await sleep(1100 - elapsed);
    }
    lastOsrmRequestAt = Date.now();

    try {
      const normalizedOsrmBase = normalizeOsrmUrl(osrmBaseUrl);
      const url = `${normalizedOsrmBase}/${coordStr}?overview=full&geometries=geojson`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SmartTravelPlanner/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const fb = buildFallback(`OSRM returned HTTP ${res.status}; showing straight-line estimates.`);
        return fb;
      }

      const parsedOsrm = await parseJsonResponseSafely<{
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

// ---------- 4. Preference Matching, Geographic Clustering & Day Planning ----------
function matchesUserPreferences(category: AttractionCategory, preferencesText: string): boolean {
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

  const keywords = map[category] || [];
  return keywords.some((kw) => pref.includes(kw));
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
      return 'Guided cultural walk & sightseeing';
  }
}

function clusterAttractionsByDay(
  attractions: DiscoveredAttraction[],
  numDays: number,
  includeAllProvided = false
): DiscoveredAttraction[][] {
  if (attractions.length === 0) return [];

  // Target up to 4 attractions per day unless user explicitly selected specific spots
  const maxTotal = includeAllProvided
    ? attractions.length
    : Math.min(attractions.length, numDays * 4);
  const selected = attractions.slice(0, maxTotal);

  if (numDays === 1 || selected.length <= 2) {
    return [orderByNearestNeighbor(selected)];
  }

  const effectiveDays = Math.min(numDays, selected.length);

  // K-means geographic clustering into `effectiveDays` clusters
  // Initialize centroids using evenly spaced items sorted by longitude/angle
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
      // Find closest cluster that isn't over-stuffed
      const orderedClusters = centroids
        .map((c, idx) => ({
          idx,
          dist: haversineKm(spot.lat, spot.lng, c.lat, c.lng),
        }))
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

    // Recompute centroids
    centroids = buckets.map((bucket, idx) => {
      if (bucket.length === 0) return centroids[idx];
      const latSum = bucket.reduce((s, x) => s + x.lat, 0);
      const lngSum = bucket.reduce((s, x) => s + x.lng, 0);
      return { lat: latSum / bucket.length, lng: lngSum / bucket.length };
    });
  }

  // Filter out any accidental empty bucket and order each day via nearest-neighbor TSP
  const nonEmpty = buckets.filter((b) => b.length > 0).map(orderByNearestNeighbor);
  return nonEmpty;
}

function orderByNearestNeighbor(spots: DiscoveredAttraction[]): DiscoveredAttraction[] {
  if (spots.length <= 2) return spots;
  // Start with highest relevance spot
  const remaining = [...spots];
  remaining.sort((a, b) => b.relevanceScore - a.relevanceScore);
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

function getSuggestedTimeSlot(index: number): { arrival: string; duration: string; window: string } {
  const slots = [
    { arrival: '09:30 AM (suggested)', duration: '~1.5–2 hrs (est.)', window: '09:30 AM – 11:30 AM (est.)' },
    { arrival: '12:00 PM (suggested)', duration: '~1.5–2 hrs (est.)', window: '12:00 PM – 02:00 PM (est.)' },
    { arrival: '03:00 PM (suggested)', duration: '~1.5–2 hrs (est.)', window: '03:00 PM – 05:00 PM (est.)' },
    { arrival: '05:30 PM (suggested)', duration: '~1.5 hrs (est.)', window: '05:30 PM – 07:00 PM (est.)' },
  ];
  return slots[index % slots.length];
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
  const iso = d.toISOString().split('T')[0];
  const formatted = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { iso, formatted };
}

function estimateAccommodationPerNight(accommodation: string, travelers: number): number {
  const rooms = Math.max(1, Math.ceil(travelers / 2));
  const lower = (accommodation || '').toLowerCase();
  if (lower.includes('hostel')) return 700 * travelers;
  if (lower.includes('luxury') || lower.includes('resort')) return 6500 * rooms;
  if (lower.includes('villa') || lower.includes('ryokan')) return 4500 * rooms;
  if (lower.includes('apartment') || lower.includes('airbnb')) return 2400 * rooms;
  if (lower.includes('eco')) return 2800 * rooms;
  return 2200 * rooms; // Boutique / standard hotel
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

// ---------- 5. Full Real-Location Itinerary Orchestrator ----------
export interface GenerateItineraryInput {
  destination: string;
  startLocation: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  travelPreferences: string;
  travelMode: string;
  accommodation: string;
  radiusMeters?: number;
  customOverpassUrl?: string;
  customOsrmUrl?: string;
  waitOnRateLimit?: boolean;
}

function resolveApiConfig(input: Partial<GenerateItineraryInput>): TravelApiConfig {
  const defaults = getDefaultApiConfig();
  const primaryOverpass = input.customOverpassUrl
    ? validateExternalEndpoint(input.customOverpassUrl, defaults.overpassUrl)
    : defaults.overpassUrl;
  return {
    overpassUrl: primaryOverpass,
    overpassFallbacks: Array.from(new Set([primaryOverpass, ...defaults.overpassFallbacks])),
    osrmUrl: input.customOsrmUrl
      ? validateExternalEndpoint(input.customOsrmUrl, defaults.osrmUrl)
      : defaults.osrmUrl,
    openMeteoGeocodeUrl: defaults.openMeteoGeocodeUrl,
    openMeteoForecastUrl: defaults.openMeteoForecastUrl,
  };
}

async function assembleItinerary(
  attractions: DiscoveredAttraction[],
  destGeo: GeoCoordinates,
  startDistanceKm: number | null,
  input: GenerateItineraryInput,
  config: TravelApiConfig,
  endpointUsed: string,
  radius: number,
  options?: { fromSelected?: boolean; allDiscovered?: DiscoveredAttraction[] }
): Promise<ItineraryGenerationResponse> {
  const minRequired = options?.fromSelected ? 1 : 2;
  if (attractions.length < minRequired) {
    throw new OverpassError(
      options?.fromSelected
        ? 'Please select at least 1 real attraction to generate an itinerary.'
        : `OpenStreetMap returned only ${attractions.length} named attraction(s) within ${(radius / 1000).toFixed(0)} km of ${destGeo.displayName}. Try expanding the search radius or using a more specific city name.`,
      options?.fromSelected ? 400 : 404,
      undefined,
      false,
      destGeo
    );
  }

  const startMs = parseUtcDateParts(input.startDate).getTime();
  const endMs = parseUtcDateParts(input.endDate).getTime();
  let totalDays = 3;
  if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
    totalDays = Math.max(1, Math.min(14, Math.round((endMs - startMs) / 86400000) + 1));
  }

  // Preserve scores from the single ML/baseline ranker when available
  const rankedAttractions = [...attractions]
    .map((attr) => {
      if (attr.recommendationScore !== undefined) {
        return attr;
      }
      const prefMatch = matchesUserPreferences(attr.category, input.travelPreferences);
      return {
        ...attr,
        relevanceScore: (attr.relevanceScore || 20) + (prefMatch ? 28 : 0),
      };
    })
    .sort((a, b) => (b.recommendationScore ?? b.relevanceScore) - (a.recommendationScore ?? a.relevanceScore));

  // Cluster attractions geographically into days
  const dayBuckets = clusterAttractionsByDay(
    rankedAttractions,
    totalDays,
    Boolean(options?.fromSelected)
  );

  // Compute OSRM routes & real day-wise expenditure
  const travelersCount = Math.max(1, Number(input.travelers) || 1);
  const totalBudget = Math.max(0, Number(input.budget) || 0);
  const nights = Math.max(0, dayBuckets.length - 1);
  const totalIntercityTransport = estimateBaseTransportCost(
    input.travelMode,
    travelersCount,
    startDistanceKm
  );
  const accomPerNight = estimateAccommodationPerNight(input.accommodation, travelersCount);
  const dailyFoodEstimate = 650 * travelersCount; // ₹650/person/day estimated meals
  const dailyOtherEstimate = 250 * travelersCount;

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

    // Fetch real OSRM driving route between this day's attractions
    const routeResult = await getOsrmRoute(
      spots.map((s) => ({ lat: s.lat, lng: s.lng })),
      config.osrmUrl
    );

    let dayEntranceFees = 0;
    const locations: TripLocationItem[] = spots.map((spot, idx) => {
      const slot = getSuggestedTimeSlot(idx);
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
        spot.feeAmount !== null && spot.feeAmount !== undefined
          ? spot.feeAmount * travelersCount
          : 0;
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
        visitDuration: slot.duration,
        distanceFromPrevKm: idx === 0 ? null : distFromPrevKm,
        travelTimeMin: idx === 0 ? null : travelTimeMin,
        distanceSource:
          idx === 0
            ? 'start'
            : routeResult.source === 'osrm'
            ? 'osrm'
            : 'haversine-estimate',
        cost: knownFeeTotal,
        priceLabel: spot.entranceFee || 'Price unavailable',
        openingHours: spot.openingHours,
        recommendedActivity: getRecommendedActivity(spot.category, spot.osmTags),
        foodSuggestion:
          spot.nearbyFood || 'Nearby dining listings unavailable in OpenStreetMap for this stop',
        estimatedDistance:
          idx === 0
            ? 'Starting stop of the day'
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
      theme: buildDayTitle(dayNumber, destGeo.name, spots),
      description: `${spots.length} real attractions in ${destGeo.name} (${catsSummary}). Total day route: ${routeResult.distanceKm} km (~${routeResult.durationMin} mins driving).`,
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

  const extraNote =
    dayBuckets.length < totalDays
      ? ` (scheduled across ${dayBuckets.length} days based on ${attractions.length} real POIs found within ${(radius / 1000).toFixed(0)} km; expand radius for more days)`
      : '';

  return {
    itinerary: days,
    discoveredAttractions: (options?.allDiscovered || rankedAttractions).slice(0, 60),
    destinationInfo: destGeo,
    budgetSummary,
    searchRadiusMeters: radius,
    overpassEndpointUsed: endpointUsed,
    source: 'openstreetmap-overpass-osrm',
    note: options?.fromSelected
      ? `Built ${days.length}-day itinerary using ONLY your ${attractions.length} selected OpenStreetMap attraction(s) in ${destGeo.displayName}`
      : `Discovered ${attractions.length} real OpenStreetMap attractions in ${destGeo.displayName}${extraNote}`,
  };
}

export function rankAttractionsByPreferences(
  attractions: DiscoveredAttraction[],
  travelPreferences: string
): DiscoveredAttraction[] {
  return [...attractions]
    .map((attr) => {
      const prefMatch = matchesUserPreferences(attr.category, travelPreferences);
      return {
        ...attr,
        relevanceScore: attr.relevanceScore + (prefMatch ? 28 : 0),
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

async function queryPlacesFromMongo(
  destGeo: GeoCoordinates,
  radiusMeters: number
): Promise<DiscoveredAttraction[]> {
  if (mongoose.connection.readyState !== 1) return [];

  try {
    const docs = await PlaceModel.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [destGeo.lng, destGeo.lat],
          },
          $maxDistance: radiusMeters,
        },
      },
    })
      .limit(120)
      .lean<IPlace[]>();

    return docs.map((d) => placeToDiscoveredAttraction(d, destGeo));
  } catch {
    return [];
  }
}

async function upsertCitySyncRecord(
  destGeo: GeoCoordinates,
  sourcesUsed: string[]
): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  const citySlug = slugifyCity(destGeo.name);
  if (!citySlug) return;
  try {
    const iso2 = resolveCountryCode(destGeo.country, undefined);
    const placeCount = await PlaceModel.countDocuments({
      $or: [
        { citySlug },
        {
          latitude: { $gte: destGeo.lat - 0.2, $lte: destGeo.lat + 0.2 },
          longitude: { $gte: destGeo.lng - 0.2, $lte: destGeo.lng + 0.2 },
        },
      ],
    });
    await CityModel.updateOne(
      { citySlug },
      {
        $set: {
          citySlug,
          name: destGeo.name,
          country: resolveCountryName(destGeo.country, iso2) || destGeo.country || 'Unknown',
          countryCode: iso2,
          region: destGeo.admin1 || null,
          location: { type: 'Point', coordinates: [destGeo.lng, destGeo.lat] },
          latitude: destGeo.lat,
          longitude: destGeo.lng,
          placeCount,
          lastSyncedAt: new Date(),
        },
        ...(sourcesUsed.length > 0
          ? { $addToSet: { sourcesSynced: { $each: sourcesUsed } } }
          : {}),
      },
      { upsert: true }
    );
  } catch {
    // Non-fatal metadata update
  }
}

export async function discoverAttractionsForDestination(input: {
  destination: string;
  travelPreferences?: string;
  radiusMeters?: number;
  customOverpassUrl?: string;
  budget?: number;
  travelers?: number;
  tripDays?: number;
  userId?: string;
  forceRefresh?: boolean;
}): Promise<{
  destinationInfo: GeoCoordinates;
  attractions: DiscoveredAttraction[];
  searchRadiusMeters: number;
  overpassEndpointUsed: string;
  fallbacksTried: string[];
  source: string;
  attempts: EndpointAttempt[];
  coverageNotice?: string;
  modelStatus?: {
    mode: 'baseline' | 'onnx';
    modelVersion: string;
    trainedModelReady: boolean;
    reason?: string;
  };
  queryGroupId?: string;
}> {
  const config = resolveApiConfig(input);
  const destGeo = await geocodeDestination(input.destination, config.openMeteoGeocodeUrl);
  const radius = Math.max(3000, Math.min(45000, input.radiusMeters || 12000));
  const { query } = buildOverpassQuery(destGeo, radius);
  const queryGroupId = `qry_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const prefTokens = (input.travelPreferences || '')
    .split(/[,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rankContext = {
    preferences: prefTokens,
    budget: input.budget,
    travelers: input.travelers,
    tripDays: input.tripDays,
    center: destGeo,
  };

  try {
    await connectToMongoDB().catch(() => null);
    const existingMongo = await queryPlacesFromMongo(destGeo, radius);

    const attempts: EndpointAttempt[] = [];
    const fallbacksTried: string[] = [];
    const activeSources = new Set<string>();
    let endpointUsed = '';
    let dataSource = 'mongodb-cache';
    let attractionsPool: DiscoveredAttraction[] = existingMongo;

    // MongoDB-first: reuse cached worldwide DB if sufficient rich places already exist
    if (existingMongo.length >= 12 && !input.forceRefresh) {
      attempts.push({
        endpoint: 'mongodb:places',
        status: 200,
        message: `Loaded ${existingMongo.length} deduplicated places from MongoDB 2dsphere index`,
      });
      endpointUsed = 'mongodb:places';
      dataSource = 'mongodb-cache';
      existingMongo.forEach((a) => (a.sources || []).forEach((s) => activeSources.add(s)));
    } else {
      // Backfill concurrently from independent free sources (TravelType + Wikidata + OSM + optional OpenTripMap)
      const [ttRes, wdRes, osmRes, otmRes] = await Promise.all([
        fetchTravelTypeAttractions(destGeo, {
          radiusKm: Math.max(15, Math.round(radius / 1000) + 10),
          limit: 35,
        }).catch((e) => ({ candidates: [] as NormalizedPlaceCandidate[], error: e?.message || 'TravelType failed' })),
        fetchWikidataAttractions(destGeo, {
          radiusKm: Math.max(10, Math.round(radius / 1000)),
          limit: 65,
        }).catch((e) => ({ candidates: [] as NormalizedPlaceCandidate[], error: e?.message || 'Wikidata failed' })),
        fetchOsmAttractions(destGeo, {
          radiusMeters: radius,
          customOverpassUrl: input.customOverpassUrl,
          limit: 140,
        }).catch((e) => ({
          candidates: [] as NormalizedPlaceCandidate[],
          endpointUsed: undefined,
          error: e?.message || 'Overpass failed',
        })),
        fetchOpenTripMapAttractions(destGeo, { radiusMeters: radius }).catch(() => ({
          candidates: [] as NormalizedPlaceCandidate[],
          enabled: false,
        })),
      ]);

      const batchCandidates: NormalizedPlaceCandidate[] = [];

      if (ttRes.candidates.length > 0) {
        batchCandidates.push(...ttRes.candidates);
        activeSources.add('traveltype');
        fallbacksTried.push('https://traveltype.app/api/public/pois/search');
        attempts.push({
          endpoint: 'https://traveltype.app/api/public/pois/search',
          status: 200,
          message: `TravelType returned ${ttRes.candidates.length} verified places`,
        });
      } else if (ttRes.error) {
        attempts.push({
          endpoint: 'https://traveltype.app/api/public/pois/search',
          status: 'network-error',
          message: ttRes.error,
        });
      }

      if (wdRes.candidates.length > 0) {
        batchCandidates.push(...wdRes.candidates);
        activeSources.add('wikidata');
        fallbacksTried.push('https://query.wikidata.org/sparql');
        attempts.push({
          endpoint: 'https://query.wikidata.org/sparql',
          status: 200,
          message: `Wikidata SPARQL returned ${wdRes.candidates.length} places`,
        });
      } else if (wdRes.error) {
        attempts.push({
          endpoint: 'https://query.wikidata.org/sparql',
          status: 'network-error',
          message: wdRes.error,
        });
      }

      if (osmRes.candidates.length > 0) {
        batchCandidates.push(...osmRes.candidates);
        activeSources.add('osm');
        const osmEp = osmRes.endpointUsed || config.overpassUrl;
        fallbacksTried.push(osmEp);
        attempts.push({
          endpoint: osmEp,
          status: 200,
          message: `OpenStreetMap Overpass returned ${osmRes.candidates.length} places`,
        });
      } else if (osmRes.error) {
        attempts.push({
          endpoint: config.overpassUrl,
          status: 'timeout',
          message: osmRes.error,
        });
      }

      if (otmRes.enabled && otmRes.candidates.length > 0) {
        batchCandidates.push(...otmRes.candidates);
        activeSources.add('opentripmap');
        fallbacksTried.push('https://api.opentripmap.com/0.1');
        attempts.push({
          endpoint: 'https://api.opentripmap.com/0.1',
          status: 200,
          message: `OpenTripMap returned ${otmRes.candidates.length} places`,
        });
      }

      // Secondary Wikipedia GeoSearch supplement if primary providers combined gave < 10 places
      if (batchCandidates.length + existingMongo.length < 10) {
        const legacyWiki = await discoverFromWikidataAndWikipedia(destGeo, radius);
        attempts.push(...legacyWiki.attempts);
        if (legacyWiki.endpointUsed) fallbacksTried.push(legacyWiki.endpointUsed);

        const iso2 = resolveCountryCode(destGeo.country, undefined);
        for (const a of legacyWiki.attractions) {
          const isWd = a.id.startsWith('wikidata/');
          batchCandidates.push({
            name: a.name,
            description: a.description,
            country: resolveCountryName(destGeo.country, iso2),
            countryCode: iso2,
            region: destGeo.admin1 || null,
            city: destGeo.name,
            category: a.category,
            latitude: a.lat,
            longitude: a.lng,
            source: 'wikidata',
            externalId: a.id,
            sourceIds: isWd ? { wikidataQid: a.id.replace('wikidata/', '') } : undefined,
            sourceUrl: a.website || a.osmUrl,
            confidence: 0.7,
          });
        }
      }

      if (batchCandidates.length > 0) {
        const upsertStats = await deduplicateAndUpsertPlaces(batchCandidates);
        await upsertCitySyncRecord(destGeo, Array.from(activeSources));

        // Re-query MongoDB for complete deduplicated set if connected, else convert upserted places directly
        const refreshedMongo = await queryPlacesFromMongo(destGeo, radius);
        if (refreshedMongo.length > 0) {
          attractionsPool = refreshedMongo;
        } else {
          attractionsPool = upsertStats.places.map((p) => placeToDiscoveredAttraction(p, destGeo));
        }
      }

      if (attractionsPool.length === 0) {
        // Check if every provider failed or if destination truly had 0 POIs
        const hadAny200 = attempts.some((a) => a.status === 200);
        if (!hadAny200 && attempts.length > 0) {
          throw new OverpassError(
            `All external attraction providers failed for ${destGeo.displayName}: ${attempts
              .map((a) => a.message)
              .join(' | ')}`,
            503,
            undefined,
            false,
            destGeo,
            query,
            attempts
          );
        }
        throw new OverpassError(
          `No named tourist attractions were found within ${(radius / 1000).toFixed(0)} km of ${destGeo.displayName}. Try expanding the search radius.`,
          404,
          undefined,
          false,
          destGeo,
          query,
          attempts
        );
      }

      dataSource = activeSources.size > 1 ? 'multi-source' : Array.from(activeSources)[0] || 'multi-source';
      endpointUsed = fallbacksTried.join(' + ') || 'mongodb:places';
    }

    // Rank all deduplicated attractions using the SINGLE attraction ranking model
    const rankedResult = await rankAttractionsWithModel(attractionsPool, rankContext, {
      userId: input.userId,
    });

    const coverageNotice =
      rankedResult.attractions.length < 8
        ? `Regional open-data coverage around ${destGeo.name} returned ${rankedResult.attractions.length} verified places within ${(radius / 1000).toFixed(0)} km. Expanding the search radius may uncover additional attractions.`
        : undefined;

    return {
      destinationInfo: destGeo,
      attractions: rankedResult.attractions.slice(0, 60),
      searchRadiusMeters: radius,
      overpassEndpointUsed: endpointUsed,
      fallbacksTried,
      source: dataSource,
      attempts,
      coverageNotice,
      modelStatus: rankedResult.modelStatus,
      queryGroupId,
    };
  } catch (err: any) {
    if (err instanceof OverpassError) {
      err.destGeo = err.destGeo || destGeo;
      err.overpassQuery = err.overpassQuery || query;
      throw err;
    }
    throw err;
  }
}

export async function buildItineraryFromSelectedAttractions(
  selectedAttractions: DiscoveredAttraction[],
  destGeo: GeoCoordinates,
  input: GenerateItineraryInput,
  endpointUsed: string,
  allDiscovered?: DiscoveredAttraction[]
): Promise<ItineraryGenerationResponse> {
  const config = resolveApiConfig(input);
  const radius = input.radiusMeters || 12000;

  let startDistanceKm: number | null = null;
  if (input.startLocation && input.startLocation.trim()) {
    try {
      const startGeo = await geocodeDestination(input.startLocation, config.openMeteoGeocodeUrl);
      startDistanceKm = haversineKm(startGeo.lat, startGeo.lng, destGeo.lat, destGeo.lng);
    } catch {
      startDistanceKm = null;
    }
  }

  return await assembleItinerary(
    selectedAttractions,
    destGeo,
    startDistanceKm,
    input,
    config,
    endpointUsed,
    radius,
    { fromSelected: true, allDiscovered }
  );
}

export async function buildRealLocationItinerary(
  input: GenerateItineraryInput
): Promise<ItineraryGenerationResponse> {
  const config = resolveApiConfig(input);
  const radius = input.radiusMeters || 12000;
  const discovery = await discoverAttractionsForDestination({
    destination: input.destination,
    travelPreferences: input.travelPreferences,
    radiusMeters: radius,
    customOverpassUrl: input.customOverpassUrl,
    budget: input.budget,
    travelers: input.travelers,
  });

  let startDistanceKm: number | null = null;
  if (input.startLocation && input.startLocation.trim()) {
    try {
      const startGeo = await geocodeDestination(
        input.startLocation,
        config.openMeteoGeocodeUrl
      );
      startDistanceKm = haversineKm(
        startGeo.lat,
        startGeo.lng,
        discovery.destinationInfo.lat,
        discovery.destinationInfo.lng
      );
    } catch {
      startDistanceKm = null;
    }
  }

  return await assembleItinerary(
    discovery.attractions,
    discovery.destinationInfo,
    startDistanceKm,
    input,
    config,
    discovery.overpassEndpointUsed,
    radius
  );
}

export async function buildItineraryFromOsmElements(
  elements: OsmElement[],
  destGeo: GeoCoordinates,
  input: GenerateItineraryInput,
  endpointUsed: string
): Promise<ItineraryGenerationResponse> {
  const config = resolveApiConfig(input);
  const radius = input.radiusMeters || 12000;

  let startDistanceKm: number | null = null;
  if (input.startLocation && input.startLocation.trim()) {
    try {
      const startGeo = await geocodeDestination(input.startLocation, config.openMeteoGeocodeUrl);
      startDistanceKm = haversineKm(startGeo.lat, startGeo.lng, destGeo.lat, destGeo.lng);
    } catch {
      startDistanceKm = null;
    }
  }

  const { attractions } = processOsmElements(elements, destGeo);
  return await assembleItinerary(
    attractions,
    destGeo,
    startDistanceKm,
    input,
    config,
    endpointUsed,
    radius
  );
}
