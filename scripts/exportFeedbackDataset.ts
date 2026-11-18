import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectToMongoDB, disconnectMongoDB } from '../server/db/connection.js';
import { IUserFeedback, UserFeedbackModel } from '../server/db/models.js';

dotenv.config();

async function main() {
  const outputPath = path.resolve(
    process.cwd(),
    process.argv[2] || 'ml/data/feedback_dataset.jsonl'
  );

  await connectToMongoDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('MongoDB is not connected. Cannot export real user feedback dataset.');
    process.exitCode = 1;
    return;
  }

  const rows = await UserFeedbackModel.find({}).sort({ createdAt: 1 }).lean<IUserFeedback[]>();
  const distinctGroups = new Set(rows.map((r) => r.queryGroupId));

  console.log(`Found ${rows.length} real feedback rows across ${distinctGroups.size} query groups.`);

  if (rows.length === 0) {
    console.log(
      'No real user feedback rows exist yet. Collect genuine user interactions (select, save, like, dislike, skip, visit) before training the ML ranker.'
    );
    await disconnectMongoDB();
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const lines = rows
    .filter((r) => Array.isArray(r.featureVector) && r.featureVector.length === 12)
    .map((r) =>
      JSON.stringify({
        queryGroupId: r.queryGroupId,
        userId: r.userId,
        placeId: r.placeId,
        placeName: r.placeName,
        category: r.category,
        destination: r.destination,
        action: r.action,
        relevanceLabel: r.relevanceLabel,
        featureVector: r.featureVector,
        featureSchemaVersion: r.featureSchemaVersion || 'v1',
        createdAt: r.createdAt,
      })
    );

  fs.writeFileSync(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`Exported ${lines.length} real feedback records to ${outputPath}`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error('Failed to export feedback dataset:', err);
  process.exit(1);
});
