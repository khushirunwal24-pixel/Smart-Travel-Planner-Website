import type { IncomingMessage, ServerResponse } from 'http';
import { app } from '../server.js';
import { connectToMongoDB } from '../server/db/connection.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await connectToMongoDB().catch(() => ({ connected: false }));
  return (app as any)(req, res);
}
