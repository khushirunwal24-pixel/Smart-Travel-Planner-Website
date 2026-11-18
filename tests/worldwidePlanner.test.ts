import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
  deduplicateAndUpsertPlaces,
  deduplicateCandidatesInMemory,
  NormalizedPlaceCandidate,
  placeToDiscoveredAttraction,
} from '../server/places/normalizer.js';
import {
  CityModel,
  IngestionJobModel,
  PlaceModel,
  UserFeedbackModel,
} from '../server/db/models.js';
import { extractRankerFeatures, NUM_RANKER_FEATURES } from '../server/ml/features.js';
import {
  getModelStatus,
  rankAttractionsWithModel,
  scoreWithOnnxModel,
} from '../server/ml/ranker.js';
import { sanitizeMongoUri } from '../server/db/connection.js';
import { parseJsonResponseSafely } from '../server/places/httpClient.js';
import { OSM_OVERPASS_MIRRORS } from '../server/places/adapters/osmAdapter.js';
import { OVERPASS_FALLBACK_SERVERS } from '../server/travelEngine.js';
import { parseBackendResponse } from '../src/services/aiPlannerService.js';
import { app } from '../server.js';

let mongod: MongoMemoryServer | null = null;
let server: http.Server | null = null;
let baseUrl = '';

/**
 * Helper to construct a tiny valid ONNX protobuf (opset 12 MatMul [12, 1]) in memory
 * strictly to verify that `onnxruntime-node` executes real Float32 tensor inference
 * inside an isolated temp path — never saved as a production artifact.
 */
function buildMinimalLinearOnnxBytes(): Uint8Array {
  const encodeVarint = (n: number): number[] => {
    const out: number[] = [];
    let val = n >>> 0;
    while (val >= 0x80) {
      out.push((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    out.push(val);
    return out;
  };
  const fieldTag = (num: number, wire: number) => encodeVarint((num << 3) | wire);
  const lenField = (num: number, bytes: number[] | Uint8Array): number[] => [
    ...fieldTag(num, 2),
    ...encodeVarint(bytes.length),
    ...Array.from(bytes),
  ];
  const strField = (num: number, s: string) => lenField(num, Buffer.from(s, 'utf8'));
  const varintField = (num: number, v: number) => [...fieldTag(num, 0), ...encodeVarint(v)];

  // TensorShapeProto.Dimension
  const dim = (val?: number, param?: string): number[] =>
    val !== undefined ? varintField(1, val) : strField(2, param || 'N');

  // ValueInfoProto -> TypeProto.Tensor
  const makeValueInfo = (name: string, d0: number | string, d1: number): number[] => {
    const shape = [
      ...lenField(1, typeof d0 === 'number' ? dim(d0) : dim(undefined, d0)),
      ...lenField(1, dim(d1)),
    ];
    const tensorType = [...varintField(1, 1), ...lenField(2, shape)]; // elem_type=1 (FLOAT)
    const typeProto = lenField(1, tensorType);
    return [...strField(1, name), ...lenField(2, typeProto)];
  };

  // Weights [12, 1] favoring interest_match, popularity, source_richness
  const weights = new Float32Array([
    0.4, 0.0, 0.1, -0.1, -0.05, 0.25, 0.05, 0.05, 0.0, 0.15, 0.0, 0.2,
  ]);
  const weightBytes = new Uint8Array(weights.buffer);
  const initializer = [
    ...varintField(1, 12),
    ...varintField(1, 1),
    ...varintField(2, 1), // FLOAT
    ...strField(8, 'W'),
    ...lenField(9, weightBytes), // raw_data
  ];

  // NodeProto: MatMul(features, W) -> score
  const node = [
    ...strField(1, 'features'),
    ...strField(1, 'W'),
    ...strField(2, 'score'),
    ...strField(4, 'MatMul'),
  ];

  const graph = [
    ...lenField(1, node),
    ...strField(2, 'test_linear_ranker'),
    ...lenField(5, initializer),
    ...lenField(11, makeValueInfo('features', 'batch', 12)),
    ...lenField(12, makeValueInfo('score', 'batch', 1)),
  ];

  const opset = [...varintField(2, 12)];
  const model = [
    ...varintField(1, 7), // ir_version = 7
    ...lenField(8, opset),
    ...strField(2, 'smart-travel-planner-test'),
    ...lenField(7, graph),
  ];

  return Uint8Array.from(model);
}

before(async () => {
  process.env.DISABLE_AUTO_LISTEN = '1';
  process.env.ADMIN_API_KEY = 'test-admin-secret-key';

  mongod = await MongoMemoryServer.create({
    instance: { dbName: 'smart_travel_test' },
  });
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = 'smart_travel_test';

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: 'smart_travel_test',
  });

  await Promise.all([
    PlaceModel.syncIndexes(),
    CityModel.syncIndexes(),
    UserFeedbackModel.syncIndexes(),
    IngestionJobModel.syncIndexes(),
  ]);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await mongoose.disconnect().catch(() => undefined);
  if (mongod) {
    await mongod.stop();
  }
});

test('1. Deduplication merges matching GERS/Wikidata/OSM IDs & tight coordinates but keeps same-name distant places separate', async () => {
  const candidates: NormalizedPlaceCandidate[] = [
    {
      name: 'Amber Fort',
      country: 'India',
      countryCode: 'IN',
      city: 'Jaipur',
      category: 'Historical Places',
      latitude: 26.9855,
      longitude: 75.8513,
      source: 'wikidata',
      externalId: 'Q45678',
      sourceIds: { wikidataQid: 'Q45678', osmCompositeId: 'way/1001' },
      popularity: 85,
      popularitySource: 'wikidata-sitelinks',
    },
    {
      name: 'Amer Fort Palace',
      country: 'India',
      countryCode: 'IN',
      city: 'Jaipur',
      category: 'Historical Places',
      latitude: 26.9856,
      longitude: 75.8514,
      source: 'osm',
      externalId: 'way/1001',
      sourceIds: { osmType: 'way', osmId: '1001', osmCompositeId: 'way/1001' },
      openingHours: '08:00-17:30',
    },
    // Same-name City Palace in Jaipur vs City Palace in Udaipur (~330 km apart) must NOT merge!
    {
      name: 'City Palace',
      country: 'India',
      countryCode: 'IN',
      city: 'Jaipur',
      category: 'Historical Places',
      latitude: 26.9258,
      longitude: 75.8237,
      source: 'traveltype',
      externalId: 'tt_cp_jaipur',
      sourceIds: { traveltypeId: 'tt_cp_jaipur' },
    },
    {
      name: 'City Palace',
      country: 'India',
      countryCode: 'IN',
      city: 'Udaipur',
      category: 'Historical Places',
      latitude: 24.5764,
      longitude: 73.6835,
      source: 'traveltype',
      externalId: 'tt_cp_udaipur',
      sourceIds: { traveltypeId: 'tt_cp_udaipur' },
    },
  ];

  const inMemoryMerged = deduplicateCandidatesInMemory(candidates);
  assert.equal(inMemoryMerged.length, 3, 'Expected Amber/Amer merged and 2 distinct City Palaces kept separate');

  const amber = inMemoryMerged.find((p) => p.sourceIds.wikidataQid === 'Q45678');
  assert.ok(amber);
  assert.equal(amber.provenance.length, 2, 'Expected both wikidata and osm provenance preserved');
  assert.equal(amber.openingHours, '08:00-17:30');
  assert.equal(amber.popularity, 85);

  const upsert = await deduplicateAndUpsertPlaces(candidates);
  assert.equal(upsert.imported, 3);

  const dbCount = await PlaceModel.countDocuments({});
  assert.equal(dbCount, 3);
});

test('2. 2dsphere geospatial nearby query & Places Search / Detail endpoints work cleanly', async () => {
  // Nearby Jaipur should return Amber Fort and City Palace Jaipur, NOT City Palace Udaipur
  const nearbyRes = await fetch(
    `${baseUrl}/api/places/nearby?lat=26.9124&lng=75.7873&radiusMeters=20000`
  );
  assert.equal(nearbyRes.status, 200);
  const nearbyJson = (await nearbyRes.json()) as any;
  assert.equal(nearbyJson.items.length, 2);
  assert.ok(nearbyJson.items.every((x: any) => x.city === 'Jaipur'));

  // Search paginated endpoint
  const searchRes = await fetch(`${baseUrl}/api/places/search?q=City%20Palace&countryCode=IN`);
  assert.equal(searchRes.status, 200);
  const searchJson = (await searchRes.json()) as any;
  assert.equal(searchJson.items.length, 2);
  assert.equal(searchJson.pagination.total, 2);

  // Place detail by placeId
  const targetId = searchJson.items[0].placeId;
  const detailRes = await fetch(`${baseUrl}/api/places/${encodeURIComponent(targetId)}`);
  assert.equal(detailRes.status, 200);
  const detailJson = (await detailRes.json()) as any;
  assert.equal(detailJson.place.placeId, targetId);
  assert.ok(Array.isArray(detailJson.place.sourceLicences));
});

test('3. Honest ML model status & real feedback collection + ONNX Runtime inference verification', async () => {
  const status = await getModelStatus();
  assert.equal(status.mode, 'baseline');
  assert.equal(status.trainedModelReady, false);
  assert.equal(status.metrics, null);

  // Submit genuine user feedback via POST /api/feedback
  const samplePlaces = await PlaceModel.find({}).lean();
  const sample = placeToDiscoveredAttraction(samplePlaces[0]);

  const fbRes = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user_test_1',
      queryGroupId: 'grp_test_jaipur_1',
      placeId: sample.placeId,
      placeName: sample.name,
      category: sample.category,
      destination: 'Jaipur, India',
      city: 'Jaipur',
      countryCode: 'IN',
      action: 'liked',
      attraction: sample,
      context: {
        preferences: ['Historical'],
        budget: 25000,
        travelers: 2,
        tripDays: 3,
      },
    }),
  });
  assert.equal(fbRes.status, 201);
  const fbJson = (await fbRes.json()) as any;
  assert.equal(fbJson.saved, true);
  assert.equal(fbJson.relevanceLabel, 2);

  const savedFb = await UserFeedbackModel.findOne({ queryGroupId: 'grp_test_jaipur_1' }).lean();
  assert.ok(savedFb);
  assert.equal(savedFb.featureVector.length, NUM_RANKER_FEATURES);

  // Build temporary ONNX binary solely to prove onnxruntime-node inference runs accurately
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-test-'));
  const tmpOnnxPath = path.join(tmpDir, 'test_linear_ranker.onnx');
  fs.writeFileSync(tmpOnnxPath, buildMinimalLinearOnnxBytes());

  try {
    const candidates = samplePlaces.map((p) => placeToDiscoveredAttraction(p));
    const center = { name: 'Jaipur', displayName: 'Jaipur, India', lat: 26.9124, lng: 75.7873 };
    const matrix = candidates.map((c) =>
      extractRankerFeatures(c, { preferences: ['Historical'], center })
    );
    const rawScores = await scoreWithOnnxModel(tmpOnnxPath, matrix);
    assert.equal(rawScores.length, candidates.length);
    assert.ok(rawScores.every((s) => Number.isFinite(s)));

    const onnxRanked = await rankAttractionsWithModel(
      candidates,
      { preferences: ['Historical'], center },
      { forceOnnxPath: tmpOnnxPath }
    );
    assert.equal(onnxRanked.modelStatus.mode, 'onnx');
    assert.ok(onnxRanked.attractions[0].recommendationExplanation?.includes('ONNX'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. IngestionJob schema persists cursor & admin endpoints enforce authentication', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/admin/ingestion/status`);
  assert.equal(unauthRes.status, 401);

  const badKeyRes = await fetch(`${baseUrl}/api/admin/ingestion/status`, {
    headers: { 'x-admin-key': 'wrong-key' },
  });
  assert.equal(badKeyRes.status, 403);

  await IngestionJobModel.create({
    jobId: 'ing_test_resume_1',
    source: 'overture',
    countryCode: 'FR',
    city: 'Paris',
    bbox: [2.22, 48.81, 2.42, 48.9],
    status: 'paused',
    cursor: { itemIndex: 1, rowGroupIndex: 3, page: 0 },
    stats: { scanned: 25, imported: 20, updated: 5, skipped: 0, failed: 0 },
    startedBy: 'test-suite',
  });

  const authRes = await fetch(`${baseUrl}/api/admin/ingestion/status?jobId=ing_test_resume_1`, {
    headers: { 'x-admin-key': 'test-admin-secret-key' },
  });
  assert.equal(authRes.status, 200);
  const authJson = (await authRes.json()) as any;
  assert.equal(authJson.job.cursor.rowGroupIndex, 3);
  assert.equal(authJson.job.stats.imported, 20);
});

test('5. Validation, Attribution, Model Status & 404/400 Error Contracts', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as any;
  assert.equal(health.status, 'ok');
  assert.equal(health.mongodb.connected, true);

  const attrRes = await fetch(`${baseUrl}/api/attribution`);
  assert.equal(attrRes.status, 200);
  const attr = (await attrRes.json()) as any;
  assert.ok(attr.sources.length >= 4);
  assert.equal(attr.datasetStats.placesCount, 3);

  const emptyDest = await fetch(`${baseUrl}/api/discover-attractions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination: '   ' }),
  });
  assert.equal(emptyDest.status, 400);
  const emptyJson = (await emptyDest.json()) as any;
  assert.equal(emptyJson.code, 'VALIDATION_ERROR');

  const badNearby = await fetch(`${baseUrl}/api/places/nearby?lat=invalid&lng=75`);
  assert.equal(badNearby.status, 400);

  const notFoundRes = await fetch(`${baseUrl}/api/non-existent-route-xyz`);
  assert.equal(notFoundRes.status, 404);
  const nfJson = (await notFoundRes.json()) as any;
  assert.equal(nfJson.code, 'NOT_FOUND');
});

test('6. sanitizeMongoUri safely trims quotes and encodes special password characters', () => {
  assert.equal(
    sanitizeMongoUri('"mongodb+srv://user:p@ss#123@cluster0.mongodb.net/?retryWrites=true"'),
    'mongodb+srv://user:p%40ss%23123@cluster0.mongodb.net/?retryWrites=true'
  );
  assert.equal(
    sanitizeMongoUri('mongodb+srv://user:p%40ss%23123@cluster0.mongodb.net/db'),
    'mongodb+srv://user:p%40ss%23123@cluster0.mongodb.net/db'
  );
  assert.equal(sanitizeMongoUri('   '), '');
});

test('7. Overpass fallback endpoints & safe JSON/HTML/plain-text/remark parsing', async () => {
  assert.ok(OSM_OVERPASS_MIRRORS.includes('https://overpass-api.de/api/interpreter'));
  assert.ok(OSM_OVERPASS_MIRRORS.includes('https://overpass.kumi.systems/api/interpreter'));
  assert.ok(OVERPASS_FALLBACK_SERVERS.includes('https://overpass-api.de/api/interpreter'));
  assert.ok(OVERPASS_FALLBACK_SERVERS.includes('https://overpass.kumi.systems/api/interpreter'));

  // HTTP 200 HTML gateway page
  const htmlRes = new Response('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const htmlParsed = await parseJsonResponseSafely(htmlRes, 'Overpass Test', 'https://overpass-api.de/api/interpreter');
  assert.equal(htmlParsed.ok, false);
  if (!htmlParsed.ok) {
    assert.equal(htmlParsed.kind, 'html');
    assert.ok(htmlParsed.contentType.includes('text/html'));
    assert.ok(htmlParsed.preview.includes('502 Bad Gateway'));
  }

  // HTTP 200 plain-text rate limit / busy message
  const txtRes = new Response('The server is busy, too many requests. Please try again later.', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
  const txtParsed = await parseJsonResponseSafely(txtRes, 'Overpass Test', 'https://overpass.kumi.systems/api/interpreter');
  assert.equal(txtParsed.ok, false);
  if (!txtParsed.ok) {
    assert.equal(txtParsed.kind, 'plain-text');
    assert.equal(txtParsed.isRateLimited, true);
  }

  // HTTP 200 Overpass JSON remark timeout error
  const remarkRes = new Response(
    JSON.stringify({
      version: 0.6,
      remark: 'runtime error: Query timed out in "query" at line 3 after 12 seconds.',
      elements: [],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  const remarkParsed = await parseJsonResponseSafely(remarkRes, 'Overpass Test');
  assert.equal(remarkParsed.ok, false);
  if (!remarkParsed.ok) {
    assert.equal(remarkParsed.kind, 'overpass-remark');
    assert.equal(remarkParsed.isTimeout, true);
  }

  // Frontend parseBackendResponse on HTTP 200 HTML SPA fallback
  const feHtmlRes = new Response('<!doctype html><html><title>App</title></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  await assert.rejects(
    () => parseBackendResponse(feHtmlRes, 'Attraction discovery'),
    (err: any) =>
      err?.statusCode === 200 &&
      String(err?.message).includes('HTML page instead of JSON') &&
      String(err?.message).includes('text/html')
  );
});

test('8. Express /api/* returns JSON (never HTML) even on malformed JSON request bodies', async () => {
  const malformedRes = await fetch(`${baseUrl}/api/discover-attractions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{"destination": "Jaipur"', // intentionally broken JSON
  });
  assert.equal(malformedRes.status, 400);
  const ct = malformedRes.headers.get('content-type') || '';
  assert.ok(ct.includes('application/json'), `Expected JSON content-type, got ${ct}`);
  const payload = (await malformedRes.json()) as any;
  assert.equal(payload.code, 'VALIDATION_ERROR');
});

