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

const wikidataCache = new TtlCache<NormalizedPlaceCandidate[]>();

const EXCLUDE_TITLE_RX =
  /\b(constituency|railway station|metro station|subway station|train station|bus station|airport|university|school|hospital|election|former kingdom|archdiocese|company|corporation|hotel|hostel|resort|neighborhood|neighbourhood|arrondissement|municipality|ward of|district of|lok sabha|vidhan sabha)\b/i;

function parseWktPoint(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export async function fetchWikidataAttractions(
  center: GeoCoordinates,
  options?: {
    radiusKm?: number;
    limit?: number;
    sparqlUrl?: string;
  }
): Promise<{ candidates: NormalizedPlaceCandidate[]; error?: string }> {
  const sparqlUrl =
    options?.sparqlUrl ||
    process.env.WIKIDATA_SPARQL_URL ||
    'https://query.wikidata.org/sparql';
  const radiusKm = Math.max(5, Math.min(35, Math.round(options?.radiusKm ?? 15)));
  const limit = Math.min(80, Math.max(15, options?.limit ?? 65));

  const cacheKey = `${sparqlUrl}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radiusKm}|${limit}`;
  const cached = wikidataCache.get(cacheKey);
  if (cached) return { candidates: cached };

  const buildQuery = (minSitelinks: number) => `
SELECT ?place ?placeLabel ?placeDescription ?placeAltLabel ?coord ?sitelinks (SAMPLE(?typeLabel) AS ?primaryType) ?osmNode ?osmWay ?osmRel WHERE {
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
    ?place skos:altLabel ?placeAltLabel .
    ?type rdfs:label ?typeLabel .
  }
}
GROUP BY ?place ?placeLabel ?placeDescription ?placeAltLabel ?coord ?sitelinks ?osmNode ?osmWay ?osmRel
ORDER BY DESC(?sitelinks)
LIMIT ${limit}
`.trim();

  const spec = SOURCE_LICENCE_SPECS.wikidata;
  const expectedCountryCode = resolveCountryCode(center.country, undefined);
  const candidates: NormalizedPlaceCandidate[] = [];
  let lastErr: string | undefined;

  for (const threshold of [4, 1]) {
    try {
      const sparql = buildQuery(threshold);
      const res = await scheduleProviderRequest('wikidata', 450, () =>
        fetchWithTimeoutAndRetry(
          `${sparqlUrl}?format=json&query=${encodeURIComponent(sparql)}`,
          {
            headers: {
              Accept: 'application/sparql-results+json',
              'User-Agent': 'SmartTravelPlanner/1.0 (https://smarttravelplanner.local)',
            },
          },
          { timeoutMs: 11000, maxRetries: 1 }
        )
      );

      if (!res.ok) {
        const parsedErr = await parseJsonResponseSafely<any>(res, 'Wikidata SPARQL Error', sparqlUrl);
        lastErr = parsedErr.ok
          ? `Wikidata SPARQL returned HTTP ${res.status}`
          : `Wikidata SPARQL returned HTTP ${res.status} (${parsedErr.kind})`;
        continue;
      }

      const parsed = await parseJsonResponseSafely<{
        results?: {
          bindings?: Array<{
            place?: { value: string };
            placeLabel?: { value: string };
            placeDescription?: { value: string };
            placeAltLabel?: { value: string };
            coord?: { value: string };
            sitelinks?: { value: string };
            primaryType?: { value: string };
            osmNode?: { value: string };
            osmWay?: { value: string };
            osmRel?: { value: string };
          }>;
        };
      }>(res, 'Wikidata SPARQL', sparqlUrl);

      if (!parsed.ok) {
        lastErr = parsed.error;
        continue;
      }
      const data = parsed.data;

      const seenQids = new Set<string>();
      for (const row of data.results?.bindings || []) {
        const name = (row.placeLabel?.value || '').trim();
        if (!name || /^Q\d+$/.test(name)) continue;

        const desc = (row.placeDescription?.value || '').trim();
        const typeLabel = (row.primaryType?.value || '').trim();
        if (EXCLUDE_TITLE_RX.test(`${name} ${desc} ${typeLabel}`)) continue;

        const pt = row.coord?.value ? parseWktPoint(row.coord.value) : null;
        if (!pt) continue;

        const qid = (row.place?.value?.split('/').pop() || '').toUpperCase();
        if (!qid || seenQids.has(qid)) continue;
        seenQids.add(qid);

        const altNames = row.placeAltLabel?.value
          ? row.placeAltLabel.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && s.toLowerCase() !== name.toLowerCase())
          : [];

        const osmCompositeRaw = row.osmWay?.value
          ? `way/${row.osmWay.value}`
          : row.osmRel?.value
          ? `relation/${row.osmRel.value}`
          : row.osmNode?.value
          ? `node/${row.osmNode.value}`
          : null;
        const osmParsed = parseOsmCompositeId(osmCompositeRaw);
        const sitelinks = parseInt(row.sitelinks?.value || '0', 10) || 0;
        const category = mapRawCategoryToAttractionCategory(
          typeLabel,
          [desc, typeLabel],
          name
        );

        candidates.push({
          name,
          alternateNames: altNames,
          description: desc || `${name} (${typeLabel || category})`,
          country: resolveCountryName(center.country, expectedCountryCode),
          countryCode: expectedCountryCode,
          region: center.admin1 || null,
          city: center.name,
          category,
          subcategory: typeLabel || null,
          tags: [typeLabel, category].filter(Boolean).map((s) => s.toLowerCase()),
          latitude: pt.lat,
          longitude: pt.lng,
          source: 'wikidata',
          externalId: qid,
          sourceIds: {
            wikidataQid: qid,
            ...osmParsed,
          },
          sourceMetadata: {
            sitelinks,
            primaryType: typeLabel,
          },
          licence: spec.licence,
          attribution: spec.attribution,
          sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
          popularity: sitelinks > 0 ? sitelinks : null,
          popularitySource: sitelinks > 0 ? 'wikidata-sitelinks' : null,
          confidence: sitelinks >= 10 ? 0.92 : sitelinks >= 3 ? 0.8 : 0.7,
        });
      }

      if (candidates.length >= 10) break;
    } catch (err: any) {
      lastErr = `Wikidata SPARQL error: ${err?.message || 'timeout'}`;
    }
  }

  if (candidates.length > 0) {
    wikidataCache.set(cacheKey, candidates, 6 * 60 * 60 * 1000);
  }

  return {
    candidates,
    error: candidates.length === 0 ? lastErr : undefined,
  };
}
