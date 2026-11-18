import mongoose from 'mongoose';

interface CachedConnection {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose | null> | null;
  memoryServer: any | null;
  mode: 'atlas-or-external' | 'memory-server' | 'unconfigured' | 'error';
  lastError: string | null;
}

const globalCache = globalThis as typeof globalThis & {
  __stpMongoCache?: CachedConnection;
};

if (!globalCache.__stpMongoCache) {
  globalCache.__stpMongoCache = {
    conn: null,
    promise: null,
    memoryServer: null,
    mode: 'unconfigured',
    lastError: null,
  };
}

export function getMongoStatus() {
  const cache = globalCache.__stpMongoCache!;
  return {
    connected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    mode: cache.mode,
    dbName: mongoose.connection.name || process.env.MONGODB_DB_NAME || 'smart_travel_planner',
    lastError: cache.lastError,
  };
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function sanitizeMongoUri(rawUri: string): string {
  const cleaned = (rawUri || '')
    .trim()
    .replace(/^MONGODB_URI\s*=\s*/i, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!cleaned) return '';

  const schemeMatch = cleaned.match(/^(mongodb(?:\+srv)?:\/\/)(.+)$/i);
  if (!schemeMatch) return cleaned;

  const scheme = schemeMatch[1];
  const rest = schemeMatch[2];
  const hostMatch = rest.match(/^(.*)@([a-zA-Z0-9.-]+(?::\d+)?(?:\/.*|\?.*|$))$/);
  if (!hostMatch) return cleaned;

  const credsPart = hostMatch[1];
  const hostAndRest = hostMatch[2];
  const colonIdx = credsPart.indexOf(':');
  if (colonIdx <= 0) return cleaned;

  const rawUser = credsPart.slice(0, colonIdx);
  const rawPass = credsPart.slice(colonIdx + 1);

  const normalizeCred = (part: string) => {
    try {
      return rfc3986Encode(decodeURIComponent(part));
    } catch {
      return rfc3986Encode(part);
    }
  };

  return `${scheme}${normalizeCred(rawUser)}:${normalizeCred(rawPass)}@${hostAndRest}`;
}

export async function connectToMongoDB(): Promise<typeof mongoose | null> {
  const cache = globalCache.__stpMongoCache!;

  if (mongoose.connection.readyState === 1) {
    cache.conn = mongoose;
    if (cache.mode === 'unconfigured') {
      cache.mode = process.env.MONGODB_URI ? 'atlas-or-external' : 'memory-server';
    }
    return mongoose;
  }

  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = (async () => {
    try {
      let uri = sanitizeMongoUri(process.env.MONGODB_URI || '');
      const dbName = (process.env.MONGODB_DB_NAME || 'smart_travel_planner')
        .trim()
        .replace(/^["']+|["']+$/g, '') || 'smart_travel_planner';
      const useMemFlag = (process.env.USE_MEMORY_MONGODB || '')
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .toLowerCase();
      const isServerlessOrProd =
        process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
      const allowMemoryFallback = !isServerlessOrProd && useMemFlag !== 'false';

      if (!uri) {
        if (!allowMemoryFallback) {
          cache.mode = 'unconfigured';
          cache.lastError =
            'MONGODB_URI is not configured in environment variables; running without MongoDB persistence.';
          console.log('[MongoDB]', cache.lastError);
          return null;
        }

        // Dev / local test fallback using real local mongod via mongodb-memory-server
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        if (!cache.memoryServer) {
          cache.memoryServer = await MongoMemoryServer.create({
            instance: { dbName },
          });
        }
        uri = cache.memoryServer.getUri();
        cache.mode = 'memory-server';
      } else {
        cache.mode = 'atlas-or-external';
      }

      mongoose.set('strictQuery', true);
      try {
        const conn = await mongoose.connect(uri, {
          dbName,
          maxPoolSize: isServerlessOrProd ? 5 : 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 30000,
        });

        cache.conn = conn;
        cache.lastError = null;
        console.log(`[MongoDB] Connected (${cache.mode}) to database "${dbName}"`);
        return conn;
      } catch (primaryErr: any) {
        const primaryMsg = primaryErr?.message || 'MongoDB primary connection failed';
        if (uri && allowMemoryFallback && cache.mode === 'atlas-or-external') {
          await mongoose.disconnect().catch(() => undefined);
          const { MongoMemoryServer } = await import('mongodb-memory-server');
          if (!cache.memoryServer) {
            cache.memoryServer = await MongoMemoryServer.create({
              instance: { dbName },
            });
          }
          const memUri = cache.memoryServer.getUri();
          const memConn = await mongoose.connect(memUri, {
            dbName,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 8000,
            socketTimeoutMS: 30000,
          });
          cache.conn = memConn;
          cache.mode = 'memory-server';
          cache.lastError = `Using local dev fallback (Atlas notice: ${primaryMsg})`;
          console.log(`[MongoDB] Connected (memory-server fallback) to database "${dbName}"`);
          return memConn;
        }
        throw primaryErr;
      }
    } catch (err: any) {
      cache.mode = 'error';
      cache.lastError = err?.message || 'MongoDB connection failed';
      console.log(
        '[MongoDB] Continuing without persistent MongoDB cache (live travel APIs remain active):',
        cache.lastError
      );
      return null;
    } finally {
      cache.promise = null;
    }
  })();

  return cache.promise;
}

export async function disconnectMongoDB(): Promise<void> {
  const cache = globalCache.__stpMongoCache!;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  cache.conn = null;
  if (cache.memoryServer) {
    await cache.memoryServer.stop();
    cache.memoryServer = null;
  }
}
