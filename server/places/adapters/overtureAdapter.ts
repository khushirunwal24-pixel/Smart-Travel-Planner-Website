import {
  mapRawCategoryToAttractionCategory,
  NormalizedPlaceCandidate,
  parseOsmCompositeId,
  resolveCountryCode,
  resolveCountryName,
} from '../normalizer.js';
import { fetchWithTimeoutAndRetry, SOURCE_LICENCE_SPECS, TtlCache } from '../httpClient.js';

export type BoundingBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

export interface OvertureIngestionOptions {
  bbox: BoundingBox;
  countryCode?: string;
  cityName?: string;
  maxPlaces?: number;
  maxRowGroupsPerItem?: number;
  startCursor?: {
    itemIndex: number;
    rowGroupIndex: number;
  };
  stacCatalogUrl?: string;
  onBatch?: (
    candidates: NormalizedPlaceCandidate[],
    cursor: { itemIndex: number; rowGroupIndex: number }
  ) => Promise<void>;
}

export interface OvertureIngestionResult {
  candidates: NormalizedPlaceCandidate[];
  releaseVersion: string;
  itemsScanned: number;
  rowGroupsScanned: number;
  cursor: { itemIndex: number; rowGroupIndex: number };
  completed: boolean;
  errors: string[];
}

const stacCache = new TtlCache<{ releaseId: string; items: Array<{ bbox?: BoundingBox; parquetUrl: string }> }>();

const TRAVEL_TAXONOMY_KEYWORDS = new Set([
  'landmark_and_historical_building',
  'monument',
  'museum',
  'art_museum',
  'history_museum',
  'science_museum',
  'art_gallery',
  'palace',
  'castle',
  'fort',
  'historic_site',
  'archaeological_site',
  'tourist_attraction',
  'attraction',
  'viewpoint',
  'scenic_spot',
  'park',
  'national_park',
  'botanical_garden',
  'garden',
  'zoo',
  'aquarium',
  'theme_park',
  'amusement_park',
  'waterfall',
  'lake',
  'beach',
  'temple',
  'hindu_temple',
  'buddhist_temple',
  'mosque',
  'church',
  'cathedral',
  'synagogue',
  'shrine',
  'religious_organization',
  'place_of_worship',
  'cultural_center',
  'performing_arts_theater',
  'opera_house',
  'plaza',
  'square',
  'public_market',
  'bazaar',
  'observatory',
  'planetarium',
  'nature_reserve',
  'wildlife_sanctuary',
]);

const TRAVEL_TAXONOMY_REGEX =
  /(museum|gallery|landmark|historic|monument|memorial|palace|castle|fort|temple|mosque|church|cathedral|shrine|park|garden|botanical|zoo|aquarium|attraction|viewpoint|scenic|lake|waterfall|beach|plaza|cultural|theatre|theater|observatory|planetarium|sanctuary|heritage|ruins|citadel|bazaar)/i;

const EXCLUDE_TAXONOMY_REGEX =
  /(atm|bank|dentist|doctor|clinic|hospital|pharmacy|gas_station|fuel|insurance|real_estate|lawyer|attorney|accounting|repair|automotive|car_dealer|beauty_salon|hair_salon|laundry|storage|warehouse|courier|post_office|school|preschool|kindergarten|university|tutor|gym|fitness_trainer|grocery|supermarket|convenience_store|fast_food|coffee_shop|cafe|restaurant|hotel|motel|hostel|lodging|parking)/i;

function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function isTravelRelevantOverturePlace(
  basicCat?: string | null,
  primaryTax?: string | null,
  hierarchy: string[] = []
): boolean {
  const tokens = [basicCat || '', primaryTax || '', ...hierarchy]
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);

  if (tokens.length === 0) return false;

  for (const t of tokens) {
    if (TRAVEL_TAXONOMY_KEYWORDS.has(t)) return true;
  }

  const joined = tokens.join(' ');
  if (EXCLUDE_TAXONOMY_REGEX.test(joined) && !TRAVEL_TAXONOMY_REGEX.test(joined)) {
    return false;
  }

  return TRAVEL_TAXONOMY_REGEX.test(joined);
}

function decodeParquetStatNumber(val: any): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Uint8Array && val.byteLength === 4) {
    return new DataView(val.buffer, val.byteOffset, 4).getFloat32(0, true);
  }
  if (val instanceof Uint8Array && val.byteLength === 8) {
    return new DataView(val.buffer, val.byteOffset, 8).getFloat64(0, true);
  }
  return null;
}

function rowGroupIntersectsBbox(rowGroup: any, targetBbox: BoundingBox): boolean {
  const cols = rowGroup?.columns || [];
  let xmin: number | null = null;
  let xmax: number | null = null;
  let ymin: number | null = null;
  let ymax: number | null = null;

  for (const col of cols) {
    const pathParts = col?.meta_data?.path_in_schema || [];
    const pathKey = Array.isArray(pathParts) ? pathParts.join('.') : '';
    const stats = col?.meta_data?.statistics;
    if (!stats) continue;

    if (pathKey === 'bbox.xmin') {
      xmin = decodeParquetStatNumber(stats.min_value ?? stats.min);
    } else if (pathKey === 'bbox.xmax') {
      xmax = decodeParquetStatNumber(stats.max_value ?? stats.max);
    } else if (pathKey === 'bbox.ymin') {
      ymin = decodeParquetStatNumber(stats.min_value ?? stats.min);
    } else if (pathKey === 'bbox.ymax') {
      ymax = decodeParquetStatNumber(stats.max_value ?? stats.max);
    }
  }

  if (xmin === null || xmax === null || ymin === null || ymax === null) {
    // No bbox stats on row group; must inspect safely
    return true;
  }

  return boxesIntersect([xmin, ymin, xmax, ymax], targetBbox);
}

async function resolveOverturePlacesStacItems(
  stacCatalogUrl = process.env.OVERTURE_STAC_URL || 'https://stac.overturemaps.org/catalog.json'
): Promise<{ releaseId: string; items: Array<{ bbox?: BoundingBox; parquetUrl: string }> }> {
  const cached = stacCache.get(stacCatalogUrl);
  if (cached) return cached;

  const rootRes = await fetchWithTimeoutAndRetry(stacCatalogUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'SmartTravelPlanner/1.0' },
  }, { timeoutMs: 8000, maxRetries: 2 });

  if (!rootRes.ok) {
    throw new Error(`Overture STAC catalog returned HTTP ${rootRes.status}`);
  }
  const rootJson = (await rootRes.json()) as {
    links?: Array<{ rel: string; href: string; title?: string; latest?: boolean }>;
  };

  const childReleases = (rootJson.links || []).filter((l) => l.rel === 'child');
  const latestLink =
    childReleases.find((l) => l.latest) || childReleases[childReleases.length - 1];
  if (!latestLink) {
    throw new Error('Overture STAC catalog did not expose any release child links.');
  }

  const releaseUrl = new URL(latestLink.href, stacCatalogUrl).toString();
  const collectionUrl = new URL('places/place/collection.json', releaseUrl).toString();
  const colRes = await fetchWithTimeoutAndRetry(collectionUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'SmartTravelPlanner/1.0' },
  }, { timeoutMs: 8000, maxRetries: 2 });

  if (!colRes.ok) {
    throw new Error(`Overture places collection returned HTTP ${colRes.status}`);
  }
  const colJson = (await colRes.json()) as {
    id?: string;
    links?: Array<{ rel: string; href: string }>;
  };

  const itemLinks = (colJson.links || []).filter((l) => l.rel === 'item');
  const items: Array<{ bbox?: BoundingBox; parquetUrl: string }> = [];

  for (const link of itemLinks) {
    const itemUrl = new URL(link.href, collectionUrl).toString();
    const itemRes = await fetchWithTimeoutAndRetry(itemUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'SmartTravelPlanner/1.0' },
    }, { timeoutMs: 8000, maxRetries: 1 });
    if (!itemRes.ok) continue;

    const itemJson = (await itemRes.json()) as {
      bbox?: BoundingBox;
      assets?: { aws?: { href?: string }; azure?: { href?: string } };
    };
    const parquetUrl = itemJson.assets?.aws?.href || itemJson.assets?.azure?.href;
    if (parquetUrl) {
      items.push({ bbox: itemJson.bbox, parquetUrl });
    }
  }

  const releaseId = latestLink.title || colJson.id || 'latest';
  const result = { releaseId, items };
  stacCache.set(stacCatalogUrl, result, 60 * 60 * 1000);
  return result;
}

export async function ingestOverturePlacesBatch(
  options: OvertureIngestionOptions
): Promise<OvertureIngestionResult> {
  const { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');

  const maxPlaces = options.maxPlaces ?? 200;
  const maxRowGroupsPerItem = options.maxRowGroupsPerItem ?? 6;
  const startItem = options.startCursor?.itemIndex ?? 0;
  const startRowGroup = options.startCursor?.rowGroupIndex ?? 0;

  const { releaseId, items } = await resolveOverturePlacesStacItems(options.stacCatalogUrl);

  const matchingItemIndices = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => !it.bbox || boxesIntersect(it.bbox, options.bbox))
    .map(({ idx }) => idx);

  const candidates: NormalizedPlaceCandidate[] = [];
  const errors: string[] = [];
  let itemsScanned = 0;
  let rowGroupsScanned = 0;
  let lastCursor = { itemIndex: startItem, rowGroupIndex: startRowGroup };
  let completed = true;

  for (const itemIdx of matchingItemIndices) {
    if (itemIdx < startItem) continue;
    if (candidates.length >= maxPlaces) {
      completed = false;
      break;
    }

    const item = items[itemIdx];
    itemsScanned++;

    try {
      const file = await asyncBufferFromUrl({ url: item.parquetUrl });
      const meta = await parquetMetadataAsync(file);
      const schemaNames = new Set((meta.schema || []).map((s: any) => s.name));

      const desiredCols = [
        'id',
        'geometry',
        'bbox',
        'names',
        'confidence',
        'addresses',
        'sources',
        'websites',
        'brand',
      ];
      if (schemaNames.has('basic_category')) desiredCols.push('basic_category');
      if (schemaNames.has('taxonomy')) desiredCols.push('taxonomy');
      if (schemaNames.has('categories')) desiredCols.push('categories');

      let rowOffset = 0;
      let groupsHandledForThisItem = 0;

      for (let rgIdx = 0; rgIdx < meta.row_groups.length; rgIdx++) {
        const rg = meta.row_groups[rgIdx];
        const rgRows = Number(rg.num_rows || 0);
        const rgStart = rowOffset;
        const rgEnd = rowOffset + rgRows;
        rowOffset = rgEnd;

        if (itemIdx === startItem && rgIdx < startRowGroup) continue;
        if (!rowGroupIntersectsBbox(rg, options.bbox)) continue;
        if (groupsHandledForThisItem >= maxRowGroupsPerItem || candidates.length >= maxPlaces) {
          lastCursor = { itemIndex: itemIdx, rowGroupIndex: rgIdx };
          completed = false;
          break;
        }

        groupsHandledForThisItem++;
        rowGroupsScanned++;
        lastCursor = { itemIndex: itemIdx, rowGroupIndex: rgIdx + 1 };

        const rows = await parquetReadObjects({
          file,
          compressors,
          columns: desiredCols,
          rowStart: rgStart,
          rowEnd: rgEnd,
        });

        const batchOut: NormalizedPlaceCandidate[] = [];

        for (const row of rows as any[]) {
          const coords = row.geometry?.coordinates;
          let lng = Array.isArray(coords) ? Number(coords[0]) : Number(row.bbox?.xmin);
          let lat = Array.isArray(coords) ? Number(coords[1]) : Number(row.bbox?.ymin);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lng < options.bbox[0] ||
            lng > options.bbox[2] ||
            lat < options.bbox[1] ||
            lat > options.bbox[3]
          ) {
            continue;
          }

          const primaryName = row.names?.primary ? String(row.names.primary).trim() : '';
          if (!primaryName) continue;

          const basicCat = row.basic_category || row.categories?.primary || null;
          const primaryTax = row.taxonomy?.primary || row.categories?.primary || null;
          const hierarchy: string[] = Array.isArray(row.taxonomy?.hierarchy)
            ? row.taxonomy.hierarchy.map(String)
            : Array.isArray(row.categories?.alternate)
            ? row.categories.alternate.map(String)
            : [];

          if (!isTravelRelevantOverturePlace(basicCat, primaryTax, hierarchy)) {
            continue;
          }

          const addr = Array.isArray(row.addresses) && row.addresses.length > 0 ? row.addresses[0] : null;
          const rowCountryCode = resolveCountryCode(addr?.country, addr?.country) || options.countryCode || null;
          if (options.countryCode && rowCountryCode && rowCountryCode !== options.countryCode.toUpperCase()) {
            continue;
          }

          const commonNames: string[] = [];
          if (Array.isArray(row.names?.common)) {
            for (const kv of row.names.common) {
              if (kv?.value) commonNames.push(String(kv.value));
            }
          } else if (row.names?.common && typeof row.names.common === 'object') {
            for (const val of Object.values(row.names.common)) {
              if (typeof val === 'string' && val.trim()) commonNames.push(val.trim());
            }
          }

          const sourcesArr: any[] = Array.isArray(row.sources) ? row.sources : [];
          let osmIdMatch: { osmType?: string; osmId?: string; osmCompositeId?: string } = {};
          const sourceLicenses = new Set<string>();
          const sourceDatasets = new Set<string>();

          for (const src of sourcesArr) {
            if (src?.dataset) sourceDatasets.add(String(src.dataset));
            if (src?.license) sourceLicenses.add(String(src.license));
            if (
              typeof src?.dataset === 'string' &&
              src.dataset.toLowerCase().includes('openstreetmap') &&
              src.record_id
            ) {
              const rec = String(src.record_id).trim();
              const prefix = rec[0]?.toLowerCase();
              const digits = rec.slice(1).replace(/\D/g, '');
              if (digits) {
                const osmType =
                  prefix === 'n' ? 'node' : prefix === 'w' ? 'way' : prefix === 'r' ? 'relation' : null;
                if (osmType) {
                  osmIdMatch = parseOsmCompositeId(`${osmType}/${digits}`);
                }
              }
            }
          }

          const wikidataQid =
            row.brand?.wikidata && /^Q\d+$/i.test(String(row.brand.wikidata))
              ? String(row.brand.wikidata).toUpperCase()
              : undefined;

          const websites: string[] = Array.isArray(row.websites)
            ? row.websites.map(String).filter(Boolean)
            : [];

          const gersId = String(row.id);
          const licenceStr =
            sourceLicenses.size > 0
              ? Array.from(sourceLicenses).join(', ')
              : SOURCE_LICENCE_SPECS.overture.licence;
          const attributionStr =
            sourceDatasets.size > 0
              ? `Overture Maps Places (${Array.from(sourceDatasets).join(', ')})`
              : SOURCE_LICENCE_SPECS.overture.attribution;

          const category = mapRawCategoryToAttractionCategory(
            primaryTax || basicCat,
            hierarchy,
            primaryName
          );

          const cand: NormalizedPlaceCandidate = {
            name: primaryName,
            alternateNames: commonNames,
            description: `${primaryName} — ${(primaryTax || basicCat || category)
              .toString()
              .replace(/_/g, ' ')}`,
            country: resolveCountryName(addr?.country, rowCountryCode),
            countryCode: rowCountryCode,
            region: addr?.region ? String(addr.region) : null,
            city: addr?.locality ? String(addr.locality) : options.cityName || null,
            category,
            subcategory: primaryTax ? String(primaryTax) : basicCat ? String(basicCat) : null,
            tags: hierarchy.map((h) => String(h).toLowerCase()),
            latitude: lat,
            longitude: lng,
            source: 'overture',
            externalId: gersId,
            sourceIds: {
              overtureGersId: gersId,
              wikidataQid,
              ...osmIdMatch,
            },
            sourceMetadata: {
              releaseVersion: releaseId,
              basicCategory: basicCat,
              taxonomy: row.taxonomy,
              sources: sourcesArr,
            },
            licence: licenceStr,
            attribution: attributionStr,
            sourceUrl: 'https://docs.overturemaps.org/guides/places/',
            confidence:
              typeof row.confidence === 'number' && Number.isFinite(row.confidence)
                ? Number(row.confidence.toFixed(3))
                : null,
            website: websites[0] || null,
          };

          candidates.push(cand);
          batchOut.push(cand);
          if (candidates.length >= maxPlaces) break;
        }

        if (batchOut.length > 0 && options.onBatch) {
          await options.onBatch(batchOut, lastCursor);
        }
      }
    } catch (err: any) {
      errors.push(`STAC item ${itemIdx}: ${err?.message || 'Read error'}`);
    }
  }

  return {
    candidates,
    releaseVersion: releaseId,
    itemsScanned,
    rowGroupsScanned,
    cursor: lastCursor,
    completed,
    errors,
  };
}
