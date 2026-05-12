import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { Pool } from 'pg';

const scrapingPool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function main() {
    try {
        const res = await scrapingPool.query('SELECT * FROM suppliers WHERE album_id = $1', ['_dXlrSlauVfOBy2vjNWzUzDArJP6vUDxNo6iVwZA']);
        console.log("Found supplier:");
        console.dir(res.rows[0], { depth: null });
    } catch (e) {
        console.error(e);
    } finally {
        scrapingPool.end();
    }
}

main();
