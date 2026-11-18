# Smart Travel Planner — Worldwide Travel Dataset & ML Attraction Ranker

Smart Travel Planner is a full-stack React + TypeScript + Vite + Express + Firebase + MongoDB travel planning application supporting real-location itinerary generation, OSRM routing, Indian Rupee (INR ₹) budget management, live Open-Meteo weather forecasts, multi-source worldwide attraction discovery, and a Learning-to-Rank ML pipeline (`LightGBM LambdaRank` exported to `ONNX` for server-side inference via `onnxruntime-node`).

---

## Architecture Overview

- **Frontend (`src/`)**: React 19, Vite, Tailwind CSS, Firebase Authentication & Firestore (trips, itineraries, expenses, user profile), interactive Leaflet + OSRM RouteMap, INR BudgetManager, WeatherWidget, Attraction Feedback controls (`Like`, `Save`, `Skip`, `Dislike`), and Data Attribution & Licensing modal.
- **Backend (`server.ts`, `server/`)**: Express TypeScript server (and Vercel serverless adapter at `api/index.ts`) providing geocoding, MongoDB-first attraction discovery, multi-source backfill, route computation, feedback collection, admin-protected ingestion, and server-side ML ranking.
- **Database (`server/db/`)**: MongoDB via Mongoose (`places` with `2dsphere` geospatial + compound + text + sparse external ID indexes, `cities`, `users`, `user_feedback`, `ingestion_jobs`, `model_versions`).
- **ML Pipeline (`ml/`, `server/ml/`)**: Single unified attraction recommendation pipeline sharing a deterministic 12-feature vector (`ml/feature_schema.json`). Uses a transparent baseline ranker while collecting real user feedback, and switches to server-side `onnxruntime-node` LightGBM ONNX inference once trained on genuine user feedback.

---

## Data Sources & Licensing Attribution

1. **Overture Maps Places (`CDLA-Permissive-2.0`)**: Streamed selectively by bounding box from Overture's public STAC GeoParquet releases using `hyparquet` + `hyparquet-compressors` (`zstd` + HTTP Range requests), preserving GERS IDs and upstream source attribution.
2. **TravelType Open Data (`CC-BY 4.0`)**: City and keyword POI search via `GET https://traveltype.app/api/public/pois/search`, rate-limited to comply with `60 requests/minute`. Images are referenced solely via external URLs with explicit `imageSource` attribution rather than bulk-downloaded.
3. **Wikidata SPARQL (`CC0 1.0`)**: Public landmark/attraction entities, QIDs, alternate labels, descriptions, sitelink counts, and OSM links via `https://query.wikidata.org/sparql`.
4. **OpenStreetMap / Overpass API (`ODbL 1.0`)**: Multi-mirror Overpass queries with caching, timeouts, explicit entrance fee parsing, and OSM element IDs (`node/`, `way/`, `relation/`).
5. **OpenTripMap (Optional, Disabled by Default)**: Disabled unless `OPENTRIPMAP_ENABLED="true"` and `OPENTRIPMAP_API_KEY` are configured (note: OpenTripMap's free tier is restricted to non-commercial usage).

**Data Integrity**: Smart Travel Planner never invents attractions, prices, ratings, reviews, or opening hours. Unknown ticket prices remain `"Price unavailable"`, and visit durations are explicitly labelled as estimates (`Est. ...`).

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `MONGODB_URI`: MongoDB Atlas or self-hosted MongoDB connection string (required in production/Vercel).
- `MONGODB_DB_NAME`: Database name (default: `smart_travel_planner`).
- `USE_MEMORY_MONGODB`: Set `"false"` to disable local `mongodb-memory-server` fallback in non-production development.
- `ADMIN_API_KEY`: Secret key protecting `/api/admin/ingestion/*` routes (`x-admin-key` or `Authorization: Bearer`).
- `OPENTRIPMAP_ENABLED`: `"false"` by default.
- `OPENTRIPMAP_API_KEY`: Optional OpenTripMap API key.
- `MODEL_ONNX_PATH`: Default `ml/artifacts/attraction_ranker.onnx`.

---

## Controlled Worldwide Ingestion

Startup never triggers a bulk worldwide import. Populate cities or regions cleanly via CLI or admin API:

```bash
# Ingest a city from all free sources
npm run ingest -- --source=all --city="Jaipur" --country="IN" --maxPlaces=80

# Stream an Overture Maps GeoParquet bounding box slice [minLng,minLat,maxLng,maxLat]
npm run ingest -- --source=overture --city="Paris" --country="FR" --bbox="2.22,48.81,2.42,48.90" --maxPlaces=60

# Resume an interrupted ingestion job
npm run ingest -- --resumeJobId="ing_1234567890_abc123"
```

Via protected Admin API:
- `POST /api/admin/ingestion/start` (header `x-admin-key: <ADMIN_API_KEY>`)
- `GET /api/admin/ingestion/status` (header `x-admin-key: <ADMIN_API_KEY>`)

---

## ML Attraction Recommendation Pipeline

The application uses **one** attraction ranking model (`server/ml/ranker.ts`):

1. **Collect Real Feedback**: User actions (`liked`, `saved`, `selected`, `visited`, `skipped`, `disliked`) are stored in MongoDB `user_feedback` via `POST /api/feedback` alongside the exact 12-feature vector (`ml/feature_schema.json`).
2. **Baseline Mode (`trainedModelReady: false`)**: Until at least `50` real feedback interactions across `10+` distinct query groups exist, `/api/admin/model/status` honestly reports baseline mode and never fabricates synthetic training labels or fake NDCG/Precision metrics.
3. **Export Real Dataset**:
   ```bash
   npm run export-feedback
   ```
4. **Train & Export ONNX Offline (Python)**:
   ```bash
   pip install -r ml/requirements.txt
   python3 ml/train_ranker.py --input ml/data/feedback_dataset.jsonl
   ```
   This splits by `GroupShuffleSplit` on `queryGroupId`, trains `lightgbm.LGBMRanker(objective="lambdarank")`, evaluates genuine `NDCG@5`, `NDCG@10`, and `Precision@5` on held-out query groups via `ml/evaluate_ranker.py`, exports `ml/artifacts/attraction_ranker.onnx`, verifies ONNX vs LightGBM numerical parity, and registers the model version.

---

## Key Backend Endpoints

- `GET /api/health` — Server, MongoDB, and ML ranker readiness status
- `GET /api/places/search?q=&city=&countryCode=&category=&page=1&limit=20` — Paginated worldwide place search
- `GET /api/places/nearby?lat=&lng=&radiusMeters=12000&category=&page=1&limit=20` — Geospatial `$nearSphere` query
- `GET /api/places/:id` — Single place details with full provenance & licences
- `GET|POST /api/discover-attractions` — MongoDB-first discovery + multi-source backfill + ranking
- `GET /api/recommendations/attractions` — Context-ranked recommendations (`budget`, `travelers`, `tripDays`, `travelPreferences`)
- `POST /api/feedback` — Persists real user attraction feedback
- `POST /api/admin/ingestion/start` & `GET /api/admin/ingestion/status` — Admin-protected ingestion jobs
- `GET /api/admin/model/status` — Honest ML readiness & held-out evaluation metrics
- `GET /api/attribution` — Source licences, image policy, and live catalog counts
- `POST /api/generate-selected-itinerary` & `POST /api/route` — Day-wise OSRM itinerary & route builder

---

## Public API Caveats & Vercel Deployment

- **Public Rate Limits**: TravelType limits requests to `60/min`; Overpass mirrors enforce strict query timeouts and occasional `429` throttling; Wikidata SPARQL caps query runtime. Backend queues, caching, and multi-source fallback mitigate transient upstream failures.
- **Vercel Deployment**:
  1. Set `MONGODB_URI`, `MONGODB_DB_NAME`, and `ADMIN_API_KEY` in Vercel Project Settings -> Environment Variables.
  2. `vercel.json` routes `/api/(.*)` to `api/index.ts` and builds the Vite SPA to `dist/`.
  3. Run large Overture Maps GeoParquet ingestion jobs using `npm run ingest` from a local/worker Node environment (not inside serverless request timeouts), writing directly to your Atlas `MONGODB_URI`.

---

## Development & Testing

```bash
npm install
npm run dev        # Runs Vite + Express on port 3000
npm test           # Runs automated unit, MongoDB, ONNX & API tests
npm run lint       # TypeScript typecheck
npm run build      # Production frontend bundle
```
