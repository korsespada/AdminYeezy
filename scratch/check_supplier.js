const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://shop_user:shop_pass_very_strong@85.198.97.100:5432/yeezy_scraping';
const pool = new Pool({ connectionString: DATABASE_URL });

async function check() {
  try {
    const res = await pool.query("SELECT * FROM suppliers WHERE album_id = $1", ['_dXlrSlauVfOBy2vjNWzUzDArJP6vUDxNo6iVwZA']);
    if (res.rows.length === 0) {
      console.log("Supplier not found");
    } else {
      console.log(JSON.stringify(res.rows[0], null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
