import crypto from 'crypto';
import mongoose from 'mongoose';
import { CityModel, IngestionJobModel, IIngestionJob } from '../db/models.js';
import { GeoCoordinates } from '../../src/types/index.js';
import {
  deduplicateAndUpsertPlaces,
  NormalizedPlaceCandidate,
  resolveCountryCode,
  resolveCountryName,
  slugifyCity,
} from './normalizer.js';
import { BoundingBox, ingestOverturePlacesBatch } from './adapters/overtureAdapter.js';
import { fetchTravelTypeAttractions } from './adapters/traveltypeAdapter.js';
import { fetchWikidataAttractions } from './adapters/wikidataAdapter.js';
import { fetchOsmAttractions } from './adapters/osmAdapter.js';
import { fetchOpenTripMapAttractions } from './adapters/opentripmapAdapter.js';

export interface StartIngestionParams {
  source: 'overture' | 'traveltype' | 'wikidata' | 'osm' | 'opentripmap' | 'all';
  countryCode?: string;
  region?: string;
  city?: string;
  center?: GeoCoordinates;
  bbox?: BoundingBox;
  radiusMeters?: number;
  maxPlaces?: number;
  resumeJobId?: string;
  startedBy?: string;
}

const COUNTRY_DEFAULT_BBOXES: Record<string, { bbox: BoundingBox; center: GeoCoordinates }> = {
  IN: {
    bbox: [73.5, 24.4, 77.4, 28.8],
    center: { name: 'Jaipur', displayName: 'Jaipur, Rajasthan, India', country: 'India', lat: 26.9124, lng: 75.7873 },
  },
  FR: {
    bbox: [2.15, 48.75, 2.55, 48.95],
    center: { name: 'Paris', displayName: 'Paris, Île-de-France, France', country: 'France', lat: 48.8566, lng: 2.3522 },
  },
  GB: {
    bbox: [-0.35, 51.35, 0.15, 51.65],
    center: { name: 'London', displayName: 'London, England, United Kingdom', country: 'United Kingdom', lat: 51.5074, lng: -0.1278 },
  },
  US: {
    bbox: [-74.1, 40.6, -73.85, 40.9],
    center: { name: 'New York', displayName: 'New York, United States', country: 'United States', lat: 40.7128, lng: -74.006 },
  },
  JP: {
    bbox: [139.55, 35.55, 139.9, 35.82],
    center: { name: 'Tokyo', displayName: 'Tokyo, Japan', country: 'Japan', lat: 35.6762, lng: 139.6503 },
  },
  AU: {
    bbox: [151.05, -33.98, 151.32, -33.75],
    center: { name: 'Sydney', displayName: 'Sydney, New South Wales, Australia', country: 'Australia', lat: -33.8688, lng: 151.2093 },
  },
};

export function bboxFromCenter(lat: number, lng: number, radiusMeters = 15000): BoundingBox {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [
    +(lng - lngDelta).toFixed(5),
    +(lat - latDelta).toFixed(5),
    +(lng + lngDelta).toFixed(5),
    +(lat + latDelta).toFixed(5),
  ];
}

export async function runControlledIngestionJob(
  params: StartIngestionParams
): Promise<IIngestionJob> {
  const mongoConnected = mongoose.connection.readyState === 1;

  let jobDoc: IIngestionJob | null = null;
  if (params.resumeJobId && mongoConnected) {
    const existing = await IngestionJobModel.findOne({ jobId: params.resumeJobId }).lean<IIngestionJob>();
    if (existing) {
      jobDoc = existing;
    }
  }

  const normalizedCountryCode = resolveCountryCode(params.countryCode, params.countryCode) || jobDoc?.countryCode || null;
  const defaultRegion = normalizedCountryCode ? COUNTRY_DEFAULT_BBOXES[normalizedCountryCode] : undefined;

  const center: GeoCoordinates | undefined =
    params.center ||
    (params.bbox
      ? {
          name: params.city || 'Regional Center',
          displayName: [params.city, params.region, resolveCountryName(null, normalizedCountryCode)]
            .filter(Boolean)
            .join(', '),
          country: resolveCountryName(null, normalizedCountryCode) || undefined,
          lat: (params.bbox[1] + params.bbox[3]) / 2,
          lng: (params.bbox[0] + params.bbox[2]) / 2,
        }
      : defaultRegion?.center);

  const bbox: BoundingBox | null =
    params.bbox ||
    (jobDoc?.bbox && jobDoc.bbox.length === 4 ? (jobDoc.bbox as BoundingBox) : null) ||
    (center ? bboxFromCenter(center.lat, center.lng, params.radiusMeters ?? 15000) : null) ||
    defaultRegion?.bbox ||
    null;

  const jobId =
    jobDoc?.jobId || `ing_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const state: IIngestionJob = {
    jobId,
    source: jobDoc?.source || params.source,
    countryCode: normalizedCountryCode,
    region: params.region || jobDoc?.region || center?.admin1 || null,
    city: params.city || jobDoc?.city || center?.name || null,
    bbox,
    categories: jobDoc?.categories || [],
    status: 'running',
    cursor: jobDoc?.cursor || { itemIndex: 0, rowGroupIndex: 0, page: 0, lastProcessedKey: null },
    stats: jobDoc?.stats || { scanned: 0, imported: 0, updated: 0, skipped: 0, failed: 0 },
    errorLogs: jobDoc?.errorLogs || [],
    startedBy: params.startedBy || 'admin',
    startedAt: jobDoc?.startedAt || new Date(),
    finishedAt: null,
  };

  if (mongoConnected) {
    await IngestionJobModel.updateOne(
      { jobId: state.jobId },
      { $set: state },
      { upsert: true }
    );
  }

  const allCandidates: NormalizedPlaceCandidate[] = [];
  const sourcesSynced = new Set<string>();
  const radiusMeters = params.radiusMeters ?? 12000;
  const maxPlaces = params.maxPlaces ?? 80;

  try {
    // 1. Overture Maps Places GeoParquet (controlled regional bbox + batch cursor)
    if ((state.source === 'overture' || state.source === 'all') && bbox) {
      try {
        const ovRes = await ingestOverturePlacesBatch({
          bbox,
          countryCode: normalizedCountryCode || undefined,
          cityName: state.city || center?.name,
          maxPlaces,
          maxRowGroupsPerItem: 4,
          startCursor: {
            itemIndex: state.cursor.itemIndex,
            rowGroupIndex: state.cursor.rowGroupIndex,
          },
          onBatch: async (batch, cursor) => {
            const up = await deduplicateAndUpsertPlaces(batch);
            state.stats.scanned += up.scanned;
            state.stats.imported += up.imported;
            state.stats.updated += up.updated;
            state.stats.skipped += up.skipped;
            state.stats.failed += up.failed;
            state.cursor.itemIndex = cursor.itemIndex;
            state.cursor.rowGroupIndex = cursor.rowGroupIndex;
            if (mongoConnected) {
              await IngestionJobModel.updateOne(
                { jobId: state.jobId },
                { $set: { stats: state.stats, cursor: state.cursor } }
              );
            }
          },
        });
        sourcesSynced.add('overture');
        for (const e of ovRes.errors) {
          state.errorLogs.push({ message: e, timestamp: new Date(), source: 'overture' });
        }
      } catch (err: any) {
        state.errorLogs.push({
          message: err?.message || 'Overture ingestion failed',
          timestamp: new Date(),
          source: 'overture',
        });
      }
    }

    // 2. TravelType Open Data (60 req/min compliant)
    if ((state.source === 'traveltype' || state.source === 'all') && center) {
      const tt = await fetchTravelTypeAttractions(center, {
        radiusKm: Math.max(15, Math.round(radiusMeters / 1000) + 10),
        limit: Math.min(40, maxPlaces),
      });
      if (tt.candidates.length > 0) {
        allCandidates.push(...tt.candidates);
        sourcesSynced.add('traveltype');
      } else if (tt.error) {
        state.errorLogs.push({ message: tt.error, timestamp: new Date(), source: 'traveltype' });
      }
    }

    // 3. Wikidata SPARQL
    if ((state.source === 'wikidata' || state.source === 'all') && center) {
      const wd = await fetchWikidataAttractions(center, {
        radiusKm: Math.max(10, Math.round(radiusMeters / 1000)),
        limit: Math.min(75, maxPlaces),
      });
      if (wd.candidates.length > 0) {
        allCandidates.push(...wd.candidates);
        sourcesSynced.add('wikidata');
      } else if (wd.error) {
        state.errorLogs.push({ message: wd.error, timestamp: new Date(), source: 'wikidata' });
      }
    }

    // 4. OpenStreetMap / Overpass
    if ((state.source === 'osm' || state.source === 'all') && center) {
      const osm = await fetchOsmAttractions(center, {
        radiusMeters,
        limit: Math.min(120, maxPlaces),
      });
      if (osm.candidates.length > 0) {
        allCandidates.push(...osm.candidates);
        sourcesSynced.add('osm');
      } else if (osm.error) {
        state.errorLogs.push({ message: osm.error, timestamp: new Date(), source: 'osm' });
      }
    }

    // 5. Optional OpenTripMap (disabled by default)
    if (state.source === 'opentripmap' || state.source === 'all') {
      if (center) {
        const otm = await fetchOpenTripMapAttractions(center, { radiusMeters });
        if (otm.enabled && otm.candidates.length > 0) {
          allCandidates.push(...otm.candidates);
          sourcesSynced.add('opentripmap');
        }
      }
    }

    if (allCandidates.length > 0) {
      const upsert = await deduplicateAndUpsertPlaces(allCandidates);
      state.stats.scanned += upsert.scanned;
      state.stats.imported += upsert.imported;
      state.stats.updated += upsert.updated;
      state.stats.skipped += upsert.skipped;
      state.stats.failed += upsert.failed;
    }

    if (mongoConnected && center) {
      const citySlug = slugifyCity(center.name);
      if (citySlug) {
        const count = await CityModel.db
          .collection('places')
          .countDocuments({ citySlug });
        await CityModel.updateOne(
          { citySlug },
          {
            $set: {
              citySlug,
              name: center.name,
              country: resolveCountryName(center.country, normalizedCountryCode) || center.country || 'Unknown',
              countryCode: normalizedCountryCode,
              region: center.admin1 || null,
              location: { type: 'Point', coordinates: [center.lng, center.lat] },
              latitude: center.lat,
              longitude: center.lng,
              placeCount: count,
              lastSyncedAt: new Date(),
            },
            $addToSet: {
              sourcesSynced: { $each: Array.from(sourcesSynced) },
            },
          },
          { upsert: true }
        );
      }
    }

    state.status = 'completed';
    state.finishedAt = new Date();
  } catch (err: any) {
    state.status = 'failed';
    state.finishedAt = new Date();
    state.errorLogs.push({
      message: err?.message || 'Unexpected ingestion error',
      timestamp: new Date(),
      source: state.source,
    });
  }

  if (mongoConnected) {
    await IngestionJobModel.updateOne(
      { jobId: state.jobId },
      { $set: state },
      { upsert: true }
    );
  }

  return state;
}

export async function listIngestionJobs(limit = 20): Promise<IIngestionJob[]> {
  if (mongoose.connection.readyState !== 1) return [];
  return IngestionJobModel.find({})
    .sort({ startedAt: -1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .lean<IIngestionJob[]>();
}
