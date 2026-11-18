import { GeoCoordinates } from '../../../src/types/index.js';
import {
  fetchWithTimeoutAndRetry,
  scheduleProviderRequest,
  SOURCE_LICENCE_SPECS,
} from '../httpClient.js';
import {
  mapRawCategoryToAttractionCategory,
  NormalizedPlaceCandidate,
  resolveCountryCode,
  resolveCountryName,
} from '../normalizer.js';

export function isOpenTripMapEnabled(): boolean {
  return (
    process.env.OPENTRIPMAP_ENABLED === 'true' &&
    Boolean((process.env.OPENTRIPMAP_API_KEY || '').trim())
  );
}

/**
 * Optional OpenTripMap adapter.
 * Disabled by default because OpenTripMap's free tier is limited to non-commercial use.
 */
export async function fetchOpenTripMapAttractions(
  center: GeoCoordinates,
  options?: { radiusMeters?: number; limit?: number }
): Promise<{
  enabled: boolean;
  candidates: NormalizedPlaceCandidate[];
  notice?: string;
}> {
  if (!isOpenTripMapEnabled()) {
    return {
      enabled: false,
      candidates: [],
      notice:
        'OpenTripMap adapter is disabled by default (requires OPENTRIPMAP_ENABLED=true and OPENTRIPMAP_API_KEY; free tier is non-commercial).',
    };
  }

  const apiKey = process.env.OPENTRIPMAP_API_KEY!.trim();
  const radius = Math.min(30000, Math.max(1000, options?.radiusMeters ?? 12000));
  const limit = Math.min(50, options?.limit ?? 25);
  const url = `https://api.opentripmap.com/0.1/en/places/radius?radius=${radius}&lon=${center.lng}&lat=${center.lat}&kinds=cultural,historic,architecture,museums,natural,religion&limit=${limit}&format=json&apikey=${encodeURIComponent(
    apiKey
  )}`;

  try {
    const res = await scheduleProviderRequest('opentripmap', 500, () =>
      fetchWithTimeoutAndRetry(url, { headers: { Accept: 'application/json' } }, { timeoutMs: 8000, maxRetries: 1 })
    );

    if (!res.ok) {
      return {
        enabled: true,
        candidates: [],
        notice: `OpenTripMap returned HTTP ${res.status}`,
      };
    }

    const items = (await res.json()) as Array<{
      xid: string;
      name: string;
      kinds?: string;
      wikidata?: string;
      rate?: number;
      point?: { lat: number; lon: number };
    }>;

    const spec = SOURCE_LICENCE_SPECS.opentripmap;
    const countryCode = resolveCountryCode(center.country, undefined);

    const candidates: NormalizedPlaceCandidate[] = (Array.isArray(items) ? items : [])
      .filter((it) => it.xid && it.name && it.point)
      .map((it) => {
        const kindsArr = (it.kinds || '').split(',').map((k) => k.trim()).filter(Boolean);
        return {
          name: it.name.trim(),
          country: resolveCountryName(center.country, countryCode),
          countryCode,
          region: center.admin1 || null,
          city: center.name,
          category: mapRawCategoryToAttractionCategory(kindsArr[0], kindsArr, it.name),
          subcategory: kindsArr[0] || null,
          tags: kindsArr,
          latitude: it.point!.lat,
          longitude: it.point!.lon,
          source: 'opentripmap',
          externalId: it.xid,
          sourceIds: {
            opentripmapXid: it.xid,
            wikidataQid: it.wikidata ? it.wikidata.toUpperCase() : undefined,
          },
          sourceMetadata: {
            kinds: kindsArr,
            otmRate: it.rate,
          },
          licence: spec.licence,
          attribution: spec.attribution,
          sourceUrl: `https://opentripmap.com/en/card/${it.xid}`,
        };
      });

    return { enabled: true, candidates };
  } catch (err: any) {
    return {
      enabled: true,
      candidates: [],
      notice: `OpenTripMap error: ${err?.message || 'request failed'}`,
    };
  }
}
