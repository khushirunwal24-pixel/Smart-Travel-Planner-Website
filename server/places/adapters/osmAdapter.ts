import { GeoCoordinates } from '../../../src/types/index.js';
import {
  fetchWithTimeoutAndRetry,
  parseJsonResponseSafely,
  scheduleProviderRequest,
  SOURCE_LICENCE_SPECS,
  TtlCache,
} from '../httpClient.js';
import {
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
  'https://z.overpass-api.de/api/interpreter',
];

const osmCache = new TtlCache<NormalizedPlaceCandidate[]>();

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

export async function fetchOsmAttractions(
  center: GeoCoordinates,
  options?: {
    radiusMeters?: number;
    customOverpassUrl?: string;
    limit?: number;
  }
): Promise<{ candidates: NormalizedPlaceCandidate[]; endpointUsed?: string; error?: string }> {
  const radius = Math.max(3000, Math.min(35000, options?.radiusMeters ?? 12000));
  const limit = Math.min(180, options?.limit ?? 140);

  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radius}|${limit}`;
  const cached = osmCache.get(cacheKey);
  if (cached) return { candidates: cached, endpointUsed: 'osm-cache' };

  const latDelta = radius / 111320;
  const lngDelta = radius / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const south = (center.lat - latDelta).toFixed(4);
  const west = (center.lng - lngDelta).toFixed(4);
  const north = (center.lat + latDelta).toFixed(4);
  const east = (center.lng + lngDelta).toFixed(4);

  const query = `
[out:json][timeout:8][bbox:${south},${west},${north},${east}];
(
  nwr["tourism"~"^(attraction|museum|viewpoint|gallery|artwork|theme_park|zoo|aquarium)$"]["name"];
  nwr["historic"~"^(castle|palace|fort|monument|memorial|archaeological_site|ruins|heritage|temple|city_gate)$"]["name"];
  nwr["amenity"~"^(place_of_worship|arts_centre|theatre)$"]["name"]["wikidata"];
  nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]["wikidata"];
);
out center ${limit};
`.trim();

  const endpoints = Array.from(
    new Set(
      [options?.customOverpassUrl, process.env.OVERPASS_API_URL, ...OSM_OVERPASS_MIRRORS].filter(
        Boolean
      ) as string[]
    )
  );

  const spec = SOURCE_LICENCE_SPECS.osm;
  const countryCode = resolveCountryCode(center.country, undefined);
  const errors: string[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < Math.min(endpoints.length, 4); i++) {
    // Always attempt primary + kumi.systems fallback; cap total probing time afterwards
    if (i >= 2 && Date.now() - startedAt > 9500) {
      break;
    }
    const endpoint = endpoints[i];
    try {
      const res = await scheduleProviderRequest(`osm:${endpoint}`, 700, () =>
        fetchWithTimeoutAndRetry(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              Accept: 'application/json',
              'User-Agent': 'SmartTravelPlanner/1.0',
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          { timeoutMs: 4500, maxRetries: 0 }
        )
      );

      if (!res.ok) {
        const parsedErr = await parseJsonResponseSafely<any>(res, 'Overpass Adapter Error', endpoint);
        errors.push(
          parsedErr.ok
            ? `${endpoint} HTTP ${res.status}`
            : `${endpoint} HTTP ${res.status} (${parsedErr.kind})`
        );
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
        errors.push(`${endpoint}: ${parsed.error}`);
        continue;
      }

      const json = parsed.data;

      const candidates: NormalizedPlaceCandidate[] = [];
      for (const el of json.elements || []) {
        const tags = el.tags || {};
        const name = (tags['name:en'] || tags.name || '').trim();
        if (!name || EXCLUDED_NAME_RX.test(name)) continue;
        if (tags.tourism && EXCLUDED_TOURISM.has(tags.tourism.toLowerCase())) continue;

        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;

        const rawTagCat =
          tags.tourism || tags.historic || tags.leisure || tags.natural || tags.amenity || '';
        const category = mapRawCategoryToAttractionCategory(rawTagCat, Object.values(tags), name);
        const osmComposite = `${el.type}/${el.id}`;
        const osmParsed = parseOsmCompositeId(osmComposite);
        const wikidataQid =
          tags.wikidata && /^Q\d+$/i.test(tags.wikidata.trim())
            ? tags.wikidata.trim().toUpperCase()
            : undefined;
        const { label: feeLabel, amount: feeAmount } = parseOsmFeeText(tags);

        const altNames = [tags.alt_name, tags.int_name, tags['name:en'] !== tags.name ? tags.name : '']
          .filter(Boolean)
          .map(String);

        candidates.push({
          name,
          alternateNames: altNames,
          description: tags.description || `${name} (${category})`,
          country: resolveCountryName(center.country, countryCode),
          countryCode,
          region: center.admin1 || null,
          city: center.name,
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

      if (candidates.length > 0) {
        osmCache.set(cacheKey, candidates, 6 * 60 * 60 * 1000);
        return { candidates, endpointUsed: endpoint };
      }
    } catch (err: any) {
      errors.push(`${endpoint}: ${err?.message || 'timeout'}`);
    }
  }

  return {
    candidates: [],
    error: errors.length > 0 ? errors.join('; ') : 'No OpenStreetMap attractions matched within timeout.',
  };
}
