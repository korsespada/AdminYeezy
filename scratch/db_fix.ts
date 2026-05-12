
import { scrapingQuery } from '../lib/db';

async function fix() {
  try {
    console.log('Running SQL fix...');
    await scrapingQuery(`
      ALTER TABLE suppliers 
      ADD COLUMN IF NOT EXISTS ai_parallel_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_parallel_count INTEGER DEFAULT 5;
    `);
    console.log('SQL Fix applied successfully!');
  } catch (err) {
    console.error('SQL Fix failed:', err);
  }
}

fix();
