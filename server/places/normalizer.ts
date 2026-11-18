import crypto from 'crypto';
import mongoose from 'mongoose';
import { IPlace, ISourceProvenance, PlaceModel } from '../db/models.js';
import { AttractionCategory, DiscoveredAttraction, GeoCoordinates } from '../../src/types/index.js';
import { SOURCE_LICENCE_SPECS } from './httpClient.js';

export type DataSourceName = 'overture' | 'traveltype' | 'wikidata' | 'osm' | 'opentripmap';

export interface NormalizedPlaceCandidate {
  name: string;
  alternateNames?: string[];
  description?: string | null;
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  category?: AttractionCategory | string;
  subcategory?: string | null;
  tags?: string[];
  latitude: number;
  longitude: number;
  source: DataSourceName;
  externalId: string;
  sourceIds?: {
    overtureGersId?: string;
    wikidataQid?: string;
    osmType?: string;
    osmId?: string;
    osmCompositeId?: string;
    traveltypeId?: string;
    opentripmapXid?: string;
  };
  sourceMetadata?: Record<string, any>;
  licence?: string;
  attribution?: string;
  sourceUrl?: string;
  imageUrl?: string | null;
  imageSource?: string | null;
  imageLicence?: string | null;
  confidence?: number | null;
  popularity?: number | null;
  popularitySource?: string | null;
  rating?: number | null;
  ratingSource?: string | null;
  ratingCount?: number | null;
  estimatedVisitDurationMin?: number | null;
  durationIsEstimate?: boolean;
  openingHours?: string | null;
  entranceFee?: string | null;
  feeAmount?: number | null;
  website?: string | null;
  nearbyFood?: string | null;
}

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  india: 'IN',
  france: 'FR',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  japan: 'JP',
  australia: 'AU',
  italy: 'IT',
  spain: 'ES',
  germany: 'DE',
  switzerland: 'CH',
  indonesia: 'ID',
  thailand: 'TH',
  singapore: 'SG',
  'united arab emirates': 'AE',
  uae: 'AE',
  canada: 'CA',
  netherlands: 'NL',
  portugal: 'PT',
  greece: 'GR',
  austria: 'AT',
  czechia: 'CZ',
  'czech republic': 'CZ',
  turkey: 'TR',
  türkiye: 'TR',
  egypt: 'EG',
  morocco: 'MA',
  'south africa': 'ZA',
  brazil: 'BR',
  mexico: 'MX',
  peru: 'PE',
  argentina: 'AR',
  vietnam: 'VN',
  'south korea': 'KR',
  china: 'CN',
  nepal: 'NP',
  'sri lanka': 'LK',
  malaysia: 'MY',
  'new zealand': 'NZ',
  ireland: 'IE',
  belgium: 'BE',
  norway: 'NO',
  sweden: 'SE',
  denmark: 'DK',
  iceland: 'IS',
};

const ISO2_TO_COUNTRY_NAME: Record<string, string> = {
  IN: 'India',
  FR: 'France',
  GB: 'United Kingdom',
  US: 'United States',
  JP: 'Japan',
  AU: 'Australia',
  IT: 'Italy',
  ES: 'Spain',
  DE: 'Germany',
  CH: 'Switzerland',
  ID: 'Indonesia',
  TH: 'Thailand',
  SG: 'Singapore',
  AE: 'United Arab Emirates',
  CA: 'Canada',
  NL: 'Netherlands',
  PT: 'Portugal',
  GR: 'Greece',
  AT: 'Austria',
  CZ: 'Czechia',
  TR: 'Turkey',
  EG: 'Egypt',
  MA: 'Morocco',
  ZA: 'South Africa',
  BR: 'Brazil',
  MX: 'Mexico',
  PE: 'Peru',
  AR: 'Argentina',
  VN: 'Vietnam',
  KR: 'South Korea',
  CN: 'China',
  NP: 'Nepal',
  LK: 'Sri Lanka',
  MY: 'Malaysia',
  NZ: 'New Zealand',
  IE: 'Ireland',
  BE: 'Belgium',
  NO: 'Norway',
  SE: 'Sweden',
  DK: 'Denmark',
  IS: 'Iceland',
};

export function resolveCountryCode(
  country?: string | null,
  countryCode?: string | null
): string | null {
  if (countryCode && /^[a-zA-Z]{2}$/.test(countryCode.trim())) {
    return countryCode.trim().toUpperCase();
  }
  if (!country) return null;
  const lower = country.trim().toLowerCase();
  if (COUNTRY_NAME_TO_ISO2[lower]) return COUNTRY_NAME_TO_ISO2[lower];
  for (const [name, iso] of Object.entries(COUNTRY_NAME_TO_ISO2)) {
    if (lower.includes(name)) return iso;
  }
  return null;
}

export function resolveCountryName(
  country?: string | null,
  countryCode?: string | null
): string | null {
  if (country && country.trim()) return country.trim();
  if (countryCode) {
    return ISO2_TO_COUNTRY_NAME[countryCode.trim().toUpperCase()] || countryCode.trim().toUpperCase();
  }
  return null;
}

export function slugifyCity(city?: string | null): string | null {
  if (!city) return null;
  const slug = city
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

export function normalizePlaceNameStrict(name: string): string {
  return (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(3);
}

const VALID_ATTRACTION_CATEGORIES: Set<AttractionCategory> = new Set([
  'Historical Places',
  'Museums',
  'Temples and Religious Places',
  'Lakes and Waterfalls',
  'Nature and Parks',
  'Viewpoints',
  'Adventure',
  'Shopping',
  'Cultural Attractions',
  'Food and Gastronomy',
]);

export function mapRawCategoryToAttractionCategory(
  rawCategory?: string | null,
  tags: string[] = [],
  name = ''
): AttractionCategory {
  if (rawCategory && VALID_ATTRACTION_CATEGORIES.has(rawCategory as AttractionCategory)) {
    return rawCategory as AttractionCategory;
  }

  const combined = `${rawCategory || ''} ${tags.join(' ')} ${name}`.toLowerCase();

  if (/(museum|gallery|art_gallery|planetarium|observatory|science_museum|exhibition)/.test(combined)) {
    return 'Museums';
  }
  if (/(temple|mandir|mosque|masjid|church|cathedral|basilica|shrine|synagogue|abbey|monastery|place_of_worship|religious|gurudwara)/.test(combined)) {
    return 'Temples and Religious Places';
  }
  if (/(waterfall|lake|lagoon|river|harbour|harbor|pond|beach|coast|reservoir|dam|waterfront)/.test(combined)) {
    return 'Lakes and Waterfalls';
  }
  if (/(viewpoint|lookout|observation_deck|panoramic|scenic|overlook|hilltop|summit)/.test(combined)) {
    return 'Viewpoints';
  }
  if (/(castle|palace|fort|fortress|monument|memorial|historic|heritage|ruins|archaeological|citadel|haveli|tomb|mausoleum|bridge|tower|landmark|architecture)/.test(combined)) {
    return 'Historical Places';
  }
  if (/(park|garden|botanical|zoo|aquarium|wildlife|sanctuary|reserve|forest|nature)/.test(combined)) {
    return 'Nature and Parks';
  }
  if (/(adventure|theme_park|amusement|water_park|cable_car|zipline|hiking|trail|climb|safari)/.test(combined)) {
    return 'Adventure';
  }
  if (/(bazaar|market|shopping|mall|souk|emporium|arcade)/.test(combined)) {
    return 'Shopping';
  }
  if (/(restaurant|cafe|food|gastronomy|dining|bakery|street_food|brewery|winery|tea_house)/.test(combined)) {
    return 'Food and Gastronomy';
  }
  return 'Cultural Attractions';
}

export function estimateVisitDurationMinutes(category: AttractionCategory): number {
  switch (category) {
    case 'Museums':
      return 120;
    case 'Historical Places':
      return 90;
    case 'Temples and Religious Places':
      return 60;
    case 'Nature and Parks':
      return 90;
    case 'Lakes and Waterfalls':
      return 75;
    case 'Adventure':
      return 120;
    case 'Shopping':
      return 90;
    case 'Viewpoints':
      return 45;
    case 'Food and Gastronomy':
      return 60;
    default:
      return 75;
  }
}

export function formatDurationLabel(minutes?: number | null, isEstimate = true): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const base =
    hrs > 0 && mins > 0
      ? `${hrs}h ${mins}m`
      : hrs > 0
      ? `${hrs} hr${hrs > 1 ? 's' : ''}`
      : `${mins} min`;
  return isEstimate ? `Est. ${base}` : base;
}

export function computeStablePlaceId(candidate: NormalizedPlaceCandidate): string {
  const s = candidate.sourceIds || {};
  if (s.overtureGersId) return `plc_ov_${s.overtureGersId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (s.wikidataQid) return `plc_wd_${s.wikidataQid.toUpperCase()}`;
  if (s.osmCompositeId) return `plc_osm_${s.osmCompositeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  if (s.traveltypeId) return `plc_tt_${s.traveltypeId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (s.opentripmapXid) return `plc_otm_${s.opentripmapXid.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const key = `${normalizePlaceNameStrict(candidate.name)}|${resolveCountryCode(
    candidate.country,
    candidate.countryCode
  ) || 'XX'}|${candidate.latitude.toFixed(3)},${candidate.longitude.toFixed(3)}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 14);
  return `plc_${hash}`;
}

export function isValidCoordinatePair(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  );
}

export function parseOsmCompositeId(osmIdRaw?: string | null): {
  osmType?: string;
  osmId?: string;
  osmCompositeId?: string;
} {
  if (!osmIdRaw) return {};
  const m = String(osmIdRaw).trim().match(/^(node|way|relation)\/(\d+)$/i);
  if (!m) return {};
  const osmType = m[1].toLowerCase();
  const osmId = m[2];
  return {
    osmType,
    osmId,
    osmCompositeId: `${osmType}/${osmId}`,
  };
}

function buildProvenanceEntry(c: NormalizedPlaceCandidate): ISourceProvenance {
  const spec = SOURCE_LICENCE_SPECS[c.source];
  return {
    source: c.source,
    externalId: c.externalId,
    licence: c.licence || spec.licence,
    attribution: c.attribution || spec.attribution,
    url: c.sourceUrl || spec.url,
    fetchedAt: new Date(),
    confidence: c.confidence ?? undefined,
  };
}

function areCandidatesDuplicate(a: NormalizedPlaceCandidate | IPlace, b: NormalizedPlaceCandidate): boolean {
  const aIds = a.sourceIds || {};
  const bIds = b.sourceIds || {};

  // 1. Overture GERS ID
  if (aIds.overtureGersId && bIds.overtureGersId && aIds.overtureGersId === bIds.overtureGersId) {
    return true;
  }
  // 2. Wikidata QID
  if (aIds.wikidataQid && bIds.wikidataQid && aIds.wikidataQid.toUpperCase() === bIds.wikidataQid.toUpperCase()) {
    return true;
  }
  // 3. OSM Element Type & ID
  if (aIds.osmCompositeId && bIds.osmCompositeId && aIds.osmCompositeId === bIds.osmCompositeId) {
    return true;
  }
  // Also match TravelType ID / OpenTripMap XID if identical
  if (aIds.traveltypeId && bIds.traveltypeId && aIds.traveltypeId === bIds.traveltypeId) {
    return true;
  }
  if (aIds.opentripmapXid && bIds.opentripmapXid && aIds.opentripmapXid === bIds.opentripmapXid) {
    return true;
  }

  // 4. Fallback: Normalized name + countryCode + tight geographic proximity (NEVER merge on name alone)
  const aNorm = 'normalizedName' in a ? a.normalizedName : normalizePlaceNameStrict(a.name);
  const bNorm = normalizePlaceNameStrict(b.name);
  if (!aNorm || !bNorm) return false;

  const aCountry = resolveCountryCode(a.country, a.countryCode);
  const bCountry = resolveCountryCode(b.country, b.countryCode);
  if (aCountry && bCountry && aCountry !== bCountry) {
    return false;
  }

  const distKm = haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  if (aNorm === bNorm && distKm <= 0.45) {
    return true;
  }

  if ((aNorm.includes(bNorm) || bNorm.includes(aNorm)) && Math.min(aNorm.length, bNorm.length) >= 5 && distKm <= 0.25) {
    return true;
  }

  return false;
}

export interface UpsertStats {
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  places: IPlace[];
}

function candidateToNewPlaceObject(c: NormalizedPlaceCandidate): IPlace {
  const category = mapRawCategoryToAttractionCategory(c.category, c.tags || [], c.name);
  const countryCode = resolveCountryCode(c.country, c.countryCode);
  const country = resolveCountryName(c.country, countryCode);
  const city = c.city ? c.city.trim() : null;
  const citySlug = slugifyCity(city);
  const provenanceEntry = buildProvenanceEntry(c);
  const durationMin =
    c.estimatedVisitDurationMin !== undefined && c.estimatedVisitDurationMin !== null
      ? c.estimatedVisitDurationMin
      : estimateVisitDurationMinutes(category);
  const durationIsEstimate =
    c.estimatedVisitDurationMin !== undefined && c.estimatedVisitDurationMin !== null
      ? Boolean(c.durationIsEstimate)
      : true;

  const osmParsed =
    c.sourceIds?.osmCompositeId && (!c.sourceIds.osmType || !c.sourceIds.osmId)
      ? parseOsmCompositeId(c.sourceIds.osmCompositeId)
      : {};

  const sourceIds = {
    ...(c.sourceIds || {}),
    ...osmParsed,
  };

  return {
    placeId: computeStablePlaceId({ ...c, sourceIds, countryCode, country }),
    name: c.name.trim(),
    normalizedName: normalizePlaceNameStrict(c.name),
    alternateNames: Array.from(new Set((c.alternateNames || []).map((x) => x.trim()).filter(Boolean))).slice(0, 12),
    description: c.description?.trim() || null,
    country,
    countryCode,
    region: c.region?.trim() || null,
    city,
    citySlug,
    category,
    subcategory: c.subcategory?.trim() || null,
    tags: Array.from(new Set((c.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 20),
    location: {
      type: 'Point',
      coordinates: [c.longitude, c.latitude],
    },
    latitude: c.latitude,
    longitude: c.longitude,
    sourceIds,
    sourceMetadata: {
      [c.source]: c.sourceMetadata || {},
    },
    sourceLicences: [
      {
        source: provenanceEntry.source,
        licence: provenanceEntry.licence,
        attribution: provenanceEntry.attribution,
        url: provenanceEntry.url,
      },
    ],
    provenance: [provenanceEntry],
    imageUrl: c.imageUrl || null,
    imageSource: c.imageSource || null,
    imageLicence: c.imageLicence || null,
    confidence: c.confidence ?? null,
    popularity: c.popularity ?? null,
    popularitySource: c.popularitySource || null,
    rating: c.rating ?? null,
    ratingSource: c.ratingSource || null,
    ratingCount: c.ratingCount ?? null,
    estimatedVisitDurationMin: durationMin,
    durationIsEstimate,
    openingHours: c.openingHours || null,
    entranceFee: c.entranceFee || null,
    feeAmount: c.feeAmount ?? null,
    website: c.website || null,
    nearbyFood: c.nearbyFood || null,
    lastUpdated: new Date(),
    createdAt: new Date(),
  };
}

export function mergeCandidateIntoPlace(existing: IPlace, c: NormalizedPlaceCandidate): IPlace {
  const incomingProv = buildProvenanceEntry(c);
  const nextProvenance = [...(existing.provenance || [])];
  const prevIdx = nextProvenance.findIndex(
    (p) => p.source === incomingProv.source && p.externalId === incomingProv.externalId
  );
  if (prevIdx >= 0) {
    nextProvenance[prevIdx] = incomingProv;
  } else {
    nextProvenance.push(incomingProv);
  }

  const nextLicences = [...(existing.sourceLicences || [])];
  if (!nextLicences.some((l) => l.source === incomingProv.source && l.licence === incomingProv.licence)) {
    nextLicences.push({
      source: incomingProv.source,
      licence: incomingProv.licence,
      attribution: incomingProv.attribution,
      url: incomingProv.url,
    });
  }

  const mergedAltNames = Array.from(
    new Set([
      ...(existing.alternateNames || []),
      ...(c.alternateNames || []),
      ...(c.name.trim() !== existing.name ? [c.name.trim()] : []),
    ])
  )
    .filter((n) => n && n.toLowerCase() !== existing.name.toLowerCase())
    .slice(0, 12);

  const mergedTags = Array.from(
    new Set([...(existing.tags || []), ...(c.tags || []).map((t) => t.toLowerCase())])
  ).slice(0, 20);

  const mergedSourceIds = {
    ...(existing.sourceIds || {}),
    ...(c.sourceIds || {}),
  };

  // Prefer higher-quality description without overwriting a rich one with null
  const betterDescription =
    c.description && (!existing.description || c.description.length > existing.description.length)
      ? c.description.trim()
      : existing.description;

  const betterImageUrl = existing.imageUrl || c.imageUrl || null;
  const betterImageSource = existing.imageUrl ? existing.imageSource : c.imageSource || null;
  const betterImageLicence = existing.imageUrl ? existing.imageLicence : c.imageLicence || null;

  const countryCode = existing.countryCode || resolveCountryCode(c.country, c.countryCode);
  const country = existing.country || resolveCountryName(c.country, countryCode);
  const city = existing.city || (c.city ? c.city.trim() : null);

  return {
    ...existing,
    alternateNames: mergedAltNames,
    description: betterDescription,
    country,
    countryCode,
    region: existing.region || c.region || null,
    city,
    citySlug: existing.citySlug || slugifyCity(city),
    subcategory: existing.subcategory || c.subcategory || null,
    tags: mergedTags,
    sourceIds: mergedSourceIds,
    sourceMetadata: {
      ...(existing.sourceMetadata || {}),
      [c.source]: c.sourceMetadata || {},
    },
    sourceLicences: nextLicences,
    provenance: nextProvenance,
    imageUrl: betterImageUrl,
    imageSource: betterImageSource,
    imageLicence: betterImageLicence,
    confidence: Math.max(existing.confidence ?? 0, c.confidence ?? 0) || existing.confidence || null,
    popularity:
      c.popularity !== null && c.popularity !== undefined
        ? Math.max(existing.popularity ?? 0, c.popularity)
        : existing.popularity,
    popularitySource: existing.popularitySource || c.popularitySource || null,
    rating: existing.rating ?? c.rating ?? null,
    ratingSource: existing.ratingSource || c.ratingSource || null,
    ratingCount: existing.ratingCount ?? c.ratingCount ?? null,
    openingHours: existing.openingHours || c.openingHours || null,
    entranceFee: existing.entranceFee || c.entranceFee || null,
    feeAmount: existing.feeAmount ?? c.feeAmount ?? null,
    website: existing.website || c.website || null,
    nearbyFood: existing.nearbyFood || c.nearbyFood || null,
    lastUpdated: new Date(),
  };
}

export function deduplicateCandidatesInMemory(candidates: NormalizedPlaceCandidate[]): IPlace[] {
  const merged: Array<{ place: IPlace; rawCandidates: NormalizedPlaceCandidate[] }> = [];

  for (const cand of candidates) {
    if (!cand.name || !cand.name.trim() || !isValidCoordinatePair(cand.latitude, cand.longitude)) {
      continue;
    }

    const match = merged.find((entry) => areCandidatesDuplicate(entry.place, cand));
    if (match) {
      match.place = mergeCandidateIntoPlace(match.place, cand);
      match.rawCandidates.push(cand);
    } else {
      merged.push({
        place: candidateToNewPlaceObject(cand),
        rawCandidates: [cand],
      });
    }
  }

  return merged.map((m) => m.place);
}

export async function deduplicateAndUpsertPlaces(
  candidates: NormalizedPlaceCandidate[]
): Promise<UpsertStats> {
  const validCandidates = candidates.filter(
    (c) => c.name && c.name.trim().length >= 2 && isValidCoordinatePair(c.latitude, c.longitude)
  );
  const skipped = candidates.length - validCandidates.length;

  // First deduplicate within the incoming batch
  const batchMerged = deduplicateCandidatesInMemory(validCandidates);

  if (mongoose.connection.readyState !== 1 || batchMerged.length === 0) {
    return {
      scanned: candidates.length,
      imported: batchMerged.length,
      updated: 0,
      skipped,
      failed: 0,
      places: batchMerged,
    };
  }

  // Build lookup query for existing MongoDB documents by IDs or bounding box
  const gersIds = batchMerged.map((p) => p.sourceIds?.overtureGersId).filter(Boolean) as string[];
  const qids = batchMerged.map((p) => p.sourceIds?.wikidataQid).filter(Boolean) as string[];
  const osmIds = batchMerged.map((p) => p.sourceIds?.osmCompositeId).filter(Boolean) as string[];
  const ttIds = batchMerged.map((p) => p.sourceIds?.traveltypeId).filter(Boolean) as string[];
  const otmIds = batchMerged.map((p) => p.sourceIds?.opentripmapXid).filter(Boolean) as string[];
  const normNames = Array.from(new Set(batchMerged.map((p) => p.normalizedName))).slice(0, 200);

  const orConditions: any[] = [];
  if (gersIds.length) orConditions.push({ 'sourceIds.overtureGersId': { $in: gersIds } });
  if (qids.length) orConditions.push({ 'sourceIds.wikidataQid': { $in: qids } });
  if (osmIds.length) orConditions.push({ 'sourceIds.osmCompositeId': { $in: osmIds } });
  if (ttIds.length) orConditions.push({ 'sourceIds.traveltypeId': { $in: ttIds } });
  if (otmIds.length) orConditions.push({ 'sourceIds.opentripmapXid': { $in: otmIds } });
  if (normNames.length) orConditions.push({ normalizedName: { $in: normNames } });

  const existingDocs =
    orConditions.length > 0 ? await PlaceModel.find({ $or: orConditions }).lean<IPlace[]>() : [];

  const bulkOps: any[] = [];
  const finalPlaces: IPlace[] = [];
  let imported = 0;
  let updated = 0;
  let failed = 0;

  for (const incomingPlace of batchMerged) {
    const incomingAsCand: NormalizedPlaceCandidate = {
      name: incomingPlace.name,
      alternateNames: incomingPlace.alternateNames,
      description: incomingPlace.description,
      country: incomingPlace.country,
      countryCode: incomingPlace.countryCode,
      region: incomingPlace.region,
      city: incomingPlace.city,
      category: incomingPlace.category,
      subcategory: incomingPlace.subcategory,
      tags: incomingPlace.tags,
      latitude: incomingPlace.latitude,
      longitude: incomingPlace.longitude,
      source: incomingPlace.provenance[0]?.source || 'osm',
      externalId: incomingPlace.provenance[0]?.externalId || incomingPlace.placeId,
      sourceIds: incomingPlace.sourceIds,
      sourceMetadata: incomingPlace.sourceMetadata,
      imageUrl: incomingPlace.imageUrl,
      imageSource: incomingPlace.imageSource,
      imageLicence: incomingPlace.imageLicence,
      confidence: incomingPlace.confidence,
      popularity: incomingPlace.popularity,
      popularitySource: incomingPlace.popularitySource,
      rating: incomingPlace.rating,
      ratingSource: incomingPlace.ratingSource,
      ratingCount: incomingPlace.ratingCount,
      openingHours: incomingPlace.openingHours,
      entranceFee: incomingPlace.entranceFee,
      feeAmount: incomingPlace.feeAmount,
      website: incomingPlace.website,
      nearbyFood: incomingPlace.nearbyFood,
    };

    const existingMatch = existingDocs.find((ex) => areCandidatesDuplicate(ex, incomingAsCand));
    if (existingMatch) {
      let merged = existingMatch;
      for (const prov of incomingPlace.provenance) {
        merged = mergeCandidateIntoPlace(merged, {
          ...incomingAsCand,
          source: prov.source,
          externalId: prov.externalId,
          licence: prov.licence,
          attribution: prov.attribution,
          sourceUrl: prov.url,
          confidence: prov.confidence,
          sourceMetadata: incomingPlace.sourceMetadata?.[prov.source] || {},
        });
      }

      const {
        placeId: _ignoreId,
        createdAt: _ignoreCreated,
        lastUpdated: _ignoreUpdated,
        ...setFields
      } = merged as any;
      delete setFields._id;
      bulkOps.push({
        updateOne: {
          filter: { placeId: existingMatch.placeId },
          update: { $set: setFields },
        },
      });
      finalPlaces.push(merged);
      updated++;
    } else {
      const {
        createdAt: _ignoreCreatedInsert,
        lastUpdated: _ignoreUpdatedInsert,
        ...docToInsert
      } = incomingPlace as any;
      bulkOps.push({
        updateOne: {
          filter: { placeId: incomingPlace.placeId },
          update: { $setOnInsert: docToInsert },
          upsert: true,
        },
      });
      finalPlaces.push(incomingPlace);
      imported++;
    }
  }

  if (bulkOps.length > 0) {
    try {
      await PlaceModel.bulkWrite(bulkOps, { ordered: false });
    } catch (err: any) {
      console.error('[MongoDB] bulkWrite warning:', err?.message || err);
      failed += err?.writeErrors?.length || 0;
    }
  }

  return {
    scanned: candidates.length,
    imported,
    updated,
    skipped,
    failed,
    places: finalPlaces,
  };
}

export function placeToDiscoveredAttraction(
  place: IPlace,
  center?: GeoCoordinates | null
): DiscoveredAttraction {
  const category = VALID_ATTRACTION_CATEGORIES.has(place.category as AttractionCategory)
    ? (place.category as AttractionCategory)
    : mapRawCategoryToAttractionCategory(place.category, place.tags, place.name);

  const distKm = center
    ? haversineDistanceKm(center.lat, center.lng, place.latitude, place.longitude)
    : undefined;

  const primarySource = place.provenance?.[0]?.source || 'osm';
  const dataSource: DiscoveredAttraction['dataSource'] =
    primarySource === 'wikidata' ? 'wikidata-wikipedia' : 'openstreetmap-overpass';

  const osmTags: Record<string, string> = {
    ...(place.sourceMetadata?.osm?.tags || {}),
  };
  const locality: string | undefined =
    place.sourceMetadata?.osm?.locality ||
    osmTags['addr:suburb'] ||
    osmTags['addr:neighbourhood'] ||
    osmTags['addr:district'] ||
    undefined;
  const address: string | undefined =
    place.sourceMetadata?.osm?.address ||
    ([osmTags['addr:street'], locality, place.city].filter(Boolean).join(', ') || undefined);

  return {
    id: place.sourceIds?.osmCompositeId || place.placeId,
    placeId: place.placeId,
    name: place.name,
    alternateNames: place.alternateNames?.length ? place.alternateNames : undefined,
    category,
    subcategory: place.subcategory || undefined,
    tags: place.tags?.length ? place.tags : undefined,
    city: place.city || center?.name || undefined,
    locality,
    address,
    country: place.country || center?.country || undefined,
    countryCode: place.countryCode || undefined,
    lat: place.latitude,
    lng: place.longitude,
    distanceFromCenterKm: distKm,
    description:
      place.description ||
      `${place.name} — ${category}${place.city ? ` in ${place.city}` : ''}`,
    osmTags,
    openingHours: place.openingHours || undefined,
    estimatedDuration: formatDurationLabel(
      place.estimatedVisitDurationMin,
      place.durationIsEstimate
    ),
    estimatedVisitDurationMin: place.estimatedVisitDurationMin ?? undefined,
    durationIsEstimate: place.durationIsEstimate,
    entranceFee: place.entranceFee || undefined,
    feeAmount: place.feeAmount ?? null,
    website: place.website || undefined,
    nearbyFood: place.nearbyFood || undefined,
    imageUrl: place.imageUrl || undefined,
    imageSource: place.imageSource || undefined,
    imageLicence: place.imageLicence || undefined,
    popularity: place.popularity ?? undefined,
    popularitySource: place.popularitySource || undefined,
    rating: place.rating ?? undefined,
    ratingSource: place.ratingSource || undefined,
    confidence: place.confidence ?? undefined,
    relevanceScore: Math.round((place.popularity ? Math.min(40, Math.log10(place.popularity + 1) * 10) : 20) + (place.description ? 8 : 0)),
    osmUrl:
      place.provenance?.find((p) => p.url)?.url ||
      `https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}`,
    dataSource,
    sources: (place.provenance || []).map((p) => p.source),
    sourceLicences: (place.sourceLicences || []).map((l) => ({
      source: l.source,
      licence: l.licence,
      attribution: l.attribution,
      url: l.url,
    })),
  };
}
