import { GeoCoordinates } from '../../../src/types/index.js';
import {
  fetchWithTimeoutAndRetry,
  parseJsonResponseSafely,
  parseRetryAfterMs,
  scheduleProviderRequest,
  SOURCE_LICENCE_SPECS,
  TtlCache,
} from '../httpClient.js';
import {
  haversineDistanceKm,
  mapRawCategoryToAttractionCategory,
  NormalizedPlaceCandidate,
  parseOsmCompositeId,
  resolveCountryCode,
  resolveCountryName,
} from '../normalizer.js';

export const OSM_OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export interface OsmEndpointAttempt {
  endpoint: string;
  status: number | 'timeout' | 'network-error';
  message: string;
  retryAfterSeconds?: number;
}

const osmCache = new TtlCache<NormalizedPlaceCandidate[]>();
const osmEndpointCooldownUntil = new Map<string, number>();

export function getOsmOverpassSettings() {
  const isVercel = process.env.VERCEL === '1';
  const rawTimeout = Number(process.env.OVERPASS_TIMEOUT_MS || (isVercel ? 5500 : 6500));
  const rawRetries = Number(process.env.OVERPASS_MAX_RETRIES ?? 1);
  const rawBackoff = Number(process.env.OVERPASS_RETRY_BASE_MS || 500);
  const rawChainBudget = Number(process.env.OVERPASS_CHAIN_BUDGET_MS || (isVercel ? 16500 : 19500));

  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.max(3000, Math.min(25000, Math.round(rawTimeout)))
    : isVercel
    ? 5500
    : 6500;
  const maxRetries = Number.isFinite(rawRetries)
    ? Math.max(0, Math.min(3, Math.round(rawRetries)))
    : 1;
  const baseBackoffMs = Number.isFinite(rawBackoff)
    ? Math.max(150, Math.min(3000, Math.round(rawBackoff)))
    : 500;
  const chainBudgetMs = Number.isFinite(rawChainBudget)
    ? Math.max(timeoutMs, Math.min(27000, Math.round(rawChainBudget)))
    : isVercel
    ? 16500
    : 19500;

  return { timeoutMs, maxRetries, baseBackoffMs, chainBudgetMs };
}

const EXCLUDED_TOURISM = new Set([
  'hotel',
  'hostel',
  'guest_house',
  'motel',
  'apartment',
  'chalet',
  'camp_site',
  'caravan_site',
  'information',
]);

const EXCLUDED_NAME_RX = /\b(atm|parking|toilet|restroom|washroom|bus stop|ticket counter|gate \d+)\b/i;

function parseOsmFeeText(tags: Record<string, string>): { label: string | null; amount: number | null } {
  const charge = tags.charge || tags['fee:amount'] || '';
  if (charge) {
    const m = charge.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      return { label: charge, amount: Math.round(parseFloat(m[1])) };
    }
    return { label: charge, amount: null };
  }
  if (tags.fee === 'no') return { label: 'Free Entry', amount: 0 };
  if (tags.fee === 'yes') return { label: 'Entry fee applies', amount: null };
  return { label: null, amount: null };
}

function extractOsmLocalityAndAddress(
  tags: Record<string, string>,
  fallbackCity: string
): { city: string; locality: string | null; address: string | null } {
  const city = (tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || fallbackCity).trim();
  const locality =
    (
      tags['addr:suburb'] ||
      tags['addr:neighbourhood'] ||
      tags['addr:quarter'] ||
      tags['addr:locality'] ||
      tags['addr:district'] ||
      ''
    ).trim() || null;
  const addrParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    locality,
    city !== fallbackCity ? city : null,
    tags['addr:state'],
  ].filter(Boolean) as string[];
  const address = addrParts.length > 0 ? Array.from(new Set(addrParts)).join(', ') : null;
  return { city, locality, address };
}

function normalizeOsmTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`".,()\-–—]/g, ' ')
    .replace(/\b(the|shri|sri)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchOsmAttractions(
  center: GeoCoordinates,
  options?: {
    radiusMeters?: number;
    customOverpassUrl?: string;
    limit?: number;
    endpointsOverride?: string[];
    timeoutMsOverride?: number;
    maxRetriesOverride?: number;
  }
): Promise<{
  candidates: NormalizedPlaceCandidate[];
  endpointUsed?: string;
  error?: string;
  attempts: OsmEndpointAttempt[];
  allRateLimited: boolean;
}> {
  const radius = Math.max(3000, Math.min(45000, options?.radiusMeters ?? 12000));
  const limit = Math.min(180, options?.limit ?? 140);

  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radius}|${limit}`;
  if (!options?.endpointsOverride) {
    const cached = osmCache.get(cacheKey);
    if (cached && cached.length > 0) {
      return {
        candidates: cached,
        endpointUsed: 'osm-cache',
        attempts: [],
        allRateLimited: false,
      };
    }
  }

  const latDelta = radius / 111320;
  const lngDelta = radius / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const south = (center.lat - latDelta).toFixed(4);
  const west = (center.lng - lngDelta).toFixed(4);
  const north = (center.lat + latDelta).toFixed(4);
  const east = (center.lng + lngDelta).toFixed(4);

  const {
    timeoutMs: cfgTimeout,
    maxRetries: cfgRetries,
    baseBackoffMs,
    chainBudgetMs,
  } = getOsmOverpassSettings();
  const timeoutMs = options?.timeoutMsOverride ?? cfgTimeout;
  const maxRetries = options?.maxRetriesOverride ?? cfgRetries;
  const overpassQueryTimeoutSec = Math.max(5, Math.min(18, Math.ceil(timeoutMs / 1000) + 1));

  const query = `
[out:json][timeout:${overpassQueryTimeoutSec}][bbox:${south},${west},${north},${east}];
(
  nwr["tourism"~"^(attraction|museum|viewpoint|gallery|artwork|theme_park|zoo|aquarium)$"]["name"];
  nwr["historic"~"^(castle|palace|fort|monument|memorial|archaeological_site|ruins|heritage|temple|church|basilica|cathedral|mosque|city_gate)$"]["name"];
  nwr["leisure"~"^(park|garden|nature_reserve|botanical_garden)$"]["name"];
  nwr["natural"~"^(beach|waterfall|peak|spring|cave_entrance)$"]["name"];
  nwr["amenity"~"^(place_of_worship|arts_centre|theatre)$"]["name"]["wikidata"];
);
out center ${limit};
`.trim();

  const endpoints = options?.endpointsOverride?.length
    ? options.endpointsOverride
    : Array.from(
        new Set(
          [options?.customOverpassUrl, process.env.OVERPASS_API_URL, ...OSM_OVERPASS_MIRRORS].filter(
            Boolean
          ) as string[]
        )
      );

  const spec = SOURCE_LICENCE_SPECS.osm;
  const countryCode = resolveCountryCode(center.country, undefined);
  const errors: string[] = [];
  const attempts: OsmEndpointAttempt[] = [];
  let rateLimitedCount = 0;
  const chainStartMs = Date.now();

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const remainingBudgetMs = chainBudgetMs - (Date.now() - chainStartMs);
    if (!options?.endpointsOverride && i > 0 && remainingBudgetMs < 2500) {
      break;
    }

    const attemptTimeoutMs = options?.endpointsOverride
      ? timeoutMs
      : Math.max(2500, Math.min(timeoutMs, remainingBudgetMs));
    const now = Date.now();
    const cooldownUntil = osmEndpointCooldownUntil.get(endpoint) || 0;
    if (cooldownUntil > now) {
      const waitSec = Math.ceil((cooldownUntil - now) / 1000);
      const msg = `Rate-limit cooldown active (${waitSec}s remaining)`;
      errors.push(`${endpoint}: ${msg}`);
      attempts.push({ endpoint, status: 429, message: msg, retryAfterSeconds: waitSec });
      rateLimitedCount += 1;
      continue;
    }

    try {
      const res = await scheduleProviderRequest(`osm:${endpoint}`, 700, () =>
        fetchWithTimeoutAndRetry(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              Accept: 'application/json',
              'User-Agent': 'SmartTravelPlanner/1.0 (OpenStreetMap travel itinerary generator)',
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          {
            timeoutMs: attemptTimeoutMs,
            maxRetries,
            baseBackoffMs,
            retryOnTimeout: false, // Move immediately to next Overpass mirror on timeout so fallback endpoints aren't starved
            maxRetryAfterWaitMs: 2500,
            onRetryAfter: (retryAfterMs) => {
              osmEndpointCooldownUntil.set(
                endpoint,
                Date.now() + Math.min(120_000, Math.max(5_000, retryAfterMs))
              );
            },
          }
        )
      );

      if (res.status === 429 || res.status === 406) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after')) || 30_000;
        const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
        osmEndpointCooldownUntil.set(
          endpoint,
          Date.now() + Math.min(120_000, Math.max(5_000, retryAfterMs))
        );
        const msg = `HTTP ${res.status} rate limit (Retry-After: ${retryAfterSec}s)`;
        errors.push(`${endpoint}: ${msg}`);
        attempts.push({
          endpoint,
          status: res.status,
          message: msg,
          retryAfterSeconds: retryAfterSec,
        });
        rateLimitedCount += 1;
        continue;
      }

      if (!res.ok) {
        const parsedErr = await parseJsonResponseSafely<any>(res, 'Overpass Adapter Error', endpoint);
        const msg = parsedErr.ok
          ? `HTTP ${res.status}`
          : `HTTP ${res.status} (${parsedErr.kind}): ${parsedErr.preview.slice(0, 120)}`;
        errors.push(`${endpoint}: ${msg}`);
        attempts.push({ endpoint, status: res.status, message: msg });
        continue;
      }

      const parsed = await parseJsonResponseSafely<{
        elements?: Array<{
          type: 'node' | 'way' | 'relation';
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      }>(res, 'Overpass Adapter', endpoint);

      if (!parsed.ok) {
        if (parsed.isRateLimited) {
          osmEndpointCooldownUntil.set(endpoint, Date.now() + 30_000);
          rateLimitedCount += 1;
        }
        errors.push(`${endpoint}: ${parsed.error}`);
        attempts.push({
          endpoint,
          status: parsed.isRateLimited ? 429 : parsed.isTimeout ? 'timeout' : res.status,
          message: parsed.error,
        });
        continue;
      }

      const json = parsed.data;
      const seenOsmIds = new Set<string>();
      const seenNormalized: Array<{ norm: string; lat: number; lng: number }> = [];
      const candidates: NormalizedPlaceCandidate[] = [];

      for (const el of json.elements || []) {
        const osmComposite = `${el.type}/${el.id}`;
        if (seenOsmIds.has(osmComposite)) continue;
        seenOsmIds.add(osmComposite);

        const tags = el.tags || {};
        const name = (tags['name:en'] || tags.name || '').trim();
        if (!name || EXCLUDED_NAME_RX.test(name)) continue;
        if (tags.tourism && EXCLUDED_TOURISM.has(tags.tourism.toLowerCase())) continue;

        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;

        const norm = normalizeOsmTitle(name);
        if (!norm) continue;
        const isDuplicateNameNearby = seenNormalized.some(
          (s) =>
            (s.norm === norm || s.norm.includes(norm) || norm.includes(s.norm)) &&
            haversineDistanceKm(s.lat, s.lng, lat, lng) < 0.5
        );
        if (isDuplicateNameNearby) continue;
        seenNormalized.push({ norm, lat, lng });

        const rawTagCat =
          tags.tourism || tags.historic || tags.natural || tags.leisure || tags.amenity || '';
        const category = mapRawCategoryToAttractionCategory(rawTagCat, Object.values(tags), name);
        const osmParsed = parseOsmCompositeId(osmComposite);
        const wikidataQid =
          tags.wikidata && /^Q\d+$/i.test(tags.wikidata.trim())
            ? tags.wikidata.trim().toUpperCase()
            : undefined;
        const { label: feeLabel, amount: feeAmount } = parseOsmFeeText(tags);
        const { city: osmCity, locality, address } = extractOsmLocalityAndAddress(tags, center.name);

        const altNames = [tags.alt_name, tags.int_name, tags['name:en'] !== tags.name ? tags.name : '']
          .filter(Boolean)
          .map(String);

        const localitySuffix = locality || (osmCity !== center.name ? osmCity : '');
        const realDesc = tags.description?.trim()
          ? tags.description.trim()
          : localitySuffix
          ? `${name} (${category}, ${localitySuffix})`
          : `${name} (${category})`;

        candidates.push({
          name,
          alternateNames: altNames,
          description: realDesc,
          country: resolveCountryName(center.country, countryCode),
          countryCode,
          region: tags['addr:state'] || center.admin1 || null,
          city: osmCity || center.name,
          category,
          subcategory: rawTagCat || null,
          tags: [tags.tourism, tags.historic, tags.amenity, tags.leisure, tags.natural]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase()),
          latitude: lat,
          longitude: lng,
          source: 'osm',
          externalId: osmComposite,
          sourceIds: {
            ...osmParsed,
            wikidataQid,
          },
          sourceMetadata: {
            tags,
            locality,
            address,
          },
          licence: spec.licence,
          attribution: spec.attribution,
          sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          openingHours: tags.opening_hours || null,
          entranceFee: feeLabel,
          feeAmount,
          website: tags.website || tags['contact:website'] || null,
          confidence: wikidataQid ? 0.85 : 0.72,
        });
      }

      attempts.push({
        endpoint,
        status: 200,
        message: `Returned ${candidates.length} verified OSM attractions`,
      });

      if (candidates.length > 0) {
        if (!options?.endpointsOverride) {
          osmCache.set(cacheKey, candidates, 6 * 60 * 60 * 1000);
        }
        return { candidates, endpointUsed: endpoint, attempts, allRateLimited: false };
      }
    } catch (err: any) {
      const isTimeout =
        err?.name === 'AbortError' ||
        err?.name === 'TimeoutError' ||
        /timed out|aborted/i.test(err?.message || '');
      const msg = isTimeout
        ? `Timed out after ${attemptTimeoutMs}ms`
        : err?.message || 'Network error';
      errors.push(`${endpoint}: ${msg}`);
      attempts.push({
        endpoint,
        status: isTimeout ? 'timeout' : 'network-error',
        message: msg,
      });
    }
  }

  return {
    candidates: [],
    error: errors.length > 0 ? errors.join('; ') : 'No OpenStreetMap attractions matched within timeout.',
    attempts,
    allRateLimited: endpoints.length > 0 && rateLimitedCount === endpoints.length,
  };
}
