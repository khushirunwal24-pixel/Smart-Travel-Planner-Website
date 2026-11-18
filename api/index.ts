import type { IncomingMessage, ServerResponse } from 'http';
import { app } from '../server.js';
import { connectToMongoDB } from '../server/db/connection.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await Promise.race([
    connectToMongoDB().catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  return (app as any)(req, res);
}
