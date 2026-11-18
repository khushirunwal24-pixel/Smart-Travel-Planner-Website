import { GeoCoordinates } from '../../../src/types/index.js';
import {
  fetchWithTimeoutAndRetry,
  parseJsonResponseSafely,
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
  slugifyCity,
} from '../normalizer.js';

interface TravelTypePoi {
  id: string;
  slug?: string;
  name: string;
  description?: string | null;
  city_slug?: string | null;
  country_iso2?: string | null;
  lat: number;
  lng: number;
  tags?: string[];
  categories?: Array<{ slug?: string; label?: string }>;
  wikidata_qid?: string | null;
  osm_id?: string | null;
  google_place_id?: string | null;
  image_url?: string | null;
  image_source?: string | null;
  url?: string | null;
}

const travelTypeCache = new TtlCache<NormalizedPlaceCandidate[]>();

// Honor documented 60 requests / minute limit -> minimum 1,050 ms between requests
const TRAVELTYPE_MIN_INTERVAL_MS = 1050;

export async function fetchTravelTypeAttractions(
  center: GeoCoordinates,
  options?: {
    radiusKm?: number;
    limit?: number;
    baseUrl?: string;
  }
): Promise<{ candidates: NormalizedPlaceCandidate[]; error?: string }> {
  const baseUrl = (
    options?.baseUrl ||
    process.env.TRAVELTYPE_API_BASE_URL ||
    'https://traveltype.app'
  ).replace(/\/$/, '');
  const limit = Math.min(40, Math.max(5, options?.limit ?? 25));
  const radiusKm = options?.radiusKm ?? 35;

  const citySlug = slugifyCity(center.name);
  const expectedCountryCode = resolveCountryCode(center.country, undefined);

  const cacheKey = `${baseUrl}|${citySlug || center.name.toLowerCase()}|${expectedCountryCode || ''}|${limit}`;
  const cached = travelTypeCache.get(cacheKey);
  if (cached) {
    return { candidates: cached };
  }

  const queries: string[] = [];
  if (citySlug) {
    queries.push(`${baseUrl}/api/public/pois/search?city=${encodeURIComponent(citySlug)}&limit=${limit}`);
  }
  queries.push(`${baseUrl}/api/public/pois/search?q=${encodeURIComponent(center.name)}&limit=${limit}`);

  const collected = new Map<string, TravelTypePoi>();
  const errors: string[] = [];

  for (const url of queries) {
    try {
      const res = await scheduleProviderRequest('traveltype', TRAVELTYPE_MIN_INTERVAL_MS, () =>
        fetchWithTimeoutAndRetry(
          url,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'SmartTravelPlanner/1.0 (https://smarttravelplanner.local)',
            },
          },
          { timeoutMs: 8000, maxRetries: 2 }
        )
      );

      if (!res.ok) {
        const parsedErr = await parseJsonResponseSafely<any>(res, 'TravelType Error', url);
        errors.push(
          parsedErr.ok
            ? `TravelType HTTP ${res.status} for ${url}`
            : `TravelType HTTP ${res.status} (${parsedErr.kind}) for ${url}`
        );
        continue;
      }

      const parsed = await parseJsonResponseSafely<{ pois?: TravelTypePoi[] }>(
        res,
        'TravelType POI Search',
        url
      );
      if (!parsed.ok) {
        errors.push(parsed.error);
        continue;
      }
      const json = parsed.data;
      if (!Array.isArray(json.pois)) continue;

      for (const poi of json.pois) {
        if (!poi || !poi.id || !poi.name) continue;
        if (typeof poi.lat !== 'number' || typeof poi.lng !== 'number') continue;

        // Strictly verify POI is actually near the destination (prevents false matches from q= search)
        const dist = haversineDistanceKm(center.lat, center.lng, poi.lat, poi.lng);
        if (dist > radiusKm) continue;

        if (
          expectedCountryCode &&
          poi.country_iso2 &&
          poi.country_iso2.toUpperCase() !== expectedCountryCode
        ) {
          continue;
        }

        collected.set(poi.id, poi);
      }

      // If city= already returned rich verified local POIs, skip extra q= call to respect rate limit
      if (collected.size >= 15) break;
    } catch (err: any) {
      errors.push(`TravelType request failed: ${err?.message || 'network error'}`);
    }
  }

  const spec = SOURCE_LICENCE_SPECS.traveltype;
  const candidates: NormalizedPlaceCandidate[] = Array.from(collected.values()).map((poi) => {
    const rawCats = (poi.categories || [])
      .map((c) => c.label || c.slug || '')
      .filter(Boolean);
    const tags = [
      ...(poi.tags || []),
      ...(poi.categories || []).map((c) => c.slug || '').filter(Boolean),
    ];
    const category = mapRawCategoryToAttractionCategory(rawCats[0], tags, poi.name);
    const osmParsed = parseOsmCompositeId(poi.osm_id);
    const iso2 = resolveCountryCode(center.country, poi.country_iso2) || expectedCountryCode;

    // Preserve image URL only with explicit attribution notice; never assume CC-BY 4.0 grants image rights
    const hasPermittedImageUrl = Boolean(poi.image_url && poi.image_source);

    return {
      name: poi.name.trim(),
      description: poi.description?.trim() || null,
      country: resolveCountryName(center.country, iso2),
      countryCode: iso2,
      region: center.admin1 || null,
      city: center.name,
      category,
      subcategory: rawCats[0] || null,
      tags,
      latitude: poi.lat,
      longitude: poi.lng,
      source: 'traveltype',
      externalId: poi.id,
      sourceIds: {
        traveltypeId: poi.id,
        wikidataQid: poi.wikidata_qid ? poi.wikidata_qid.toUpperCase() : undefined,
        ...osmParsed,
      },
      sourceMetadata: {
        slug: poi.slug,
        city_slug: poi.city_slug,
        categories: poi.categories,
        image_source: poi.image_source,
      },
      licence: spec.licence,
      attribution: spec.attribution,
      sourceUrl: poi.url || `${baseUrl}/en/data`,
      imageUrl: hasPermittedImageUrl ? poi.image_url! : null,
      imageSource: poi.image_source || null,
      imageLicence:
        poi.image_source === 'wikimedia'
          ? 'Wikimedia Commons (subject to individual file license; not covered by TravelType CC-BY 4.0)'
          : poi.image_source
          ? `Upstream image source: ${poi.image_source}`
          : null,
    };
  });

  if (candidates.length > 0) {
    travelTypeCache.set(cacheKey, candidates, 6 * 60 * 60 * 1000);
  }

  return {
    candidates,
    error: candidates.length === 0 && errors.length > 0 ? errors.join('; ') : undefined,
  };
}
