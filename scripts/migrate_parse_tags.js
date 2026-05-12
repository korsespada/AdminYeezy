const { Client } = require('pg');
require('dotenv').config({ path: '.env' });

async function migrate() {
    const client = new Client({
        connectionString: process.env.SCRAPING_DATABASE_URL,
    });
    try {
        await client.connect();
        await client.query(`
            ALTER TABLE suppliers 
            ADD COLUMN IF NOT EXISTS parse_tags_enabled BOOLEAN DEFAULT FALSE;
        `);
        console.log('Migration parse_tags_enabled completed successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await client.end();
    }
}

migrate();
