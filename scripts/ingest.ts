import dotenv from 'dotenv';
import { connectToMongoDB, disconnectMongoDB } from '../server/db/connection.js';
import { geocodeDestination, getDefaultApiConfig } from '../server/travelEngine.js';
import { runControlledIngestionJob } from '../server/places/ingestionManager.js';
import { resolveCountryCode } from '../server/places/normalizer.js';

dotenv.config();

function parseArg(prefix: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const source = (parseArg('--source=') || 'all') as
    | 'overture'
    | 'traveltype'
    | 'wikidata'
    | 'osm'
    | 'opentripmap'
    | 'all';
  const cityArg = parseArg('--city=');
  const countryArg = parseArg('--country=');
  const bboxArg = parseArg('--bbox=');
  const resumeJobId = parseArg('--resume=');
  const maxPlaces = Number(parseArg('--max=') || '60');
  const radiusMeters = Number(parseArg('--radius=') || '15000');

  if (!cityArg && !countryArg && !bboxArg && !resumeJobId) {
    console.log(
      'Usage: npm run ingest -- --city="Jaipur, India" --source=all --max=60\n' +
        '   or: npm run ingest -- --country=FR --bbox=2.2,48.8,2.45,48.92 --source=overture\n' +
        '   or: npm run ingest -- --resume=ing_12345'
    );
    process.exit(1);
  }

  const conn = await connectToMongoDB();
  if (!conn) {
    console.error('MongoDB is required for persistent ingestion. Set MONGODB_URI in .env or allow USE_MEMORY_MONGODB=true.');
    process.exit(1);
  }

  try {
    let center = undefined;
    if (cityArg) {
      const defaults = getDefaultApiConfig();
      center = await geocodeDestination(cityArg, defaults.openMeteoGeocodeUrl);
    }

    const bbox = bboxArg
      ? (bboxArg.split(',').map(Number) as [number, number, number, number])
      : undefined;

    const job = await runControlledIngestionJob({
      source,
      city: center?.name || cityArg,
      countryCode: resolveCountryCode(center?.country || countryArg, countryArg) || undefined,
      center,
      bbox,
      radiusMeters,
      maxPlaces,
      resumeJobId,
      startedBy: 'cli-worker',
    });

    console.log('Ingestion Job Result:', JSON.stringify(job, null, 2));
  } finally {
    await disconnectMongoDB();
  }
}

main().catch((err) => {
  console.error('Ingestion worker failed:', err);
  process.exit(1);
});
