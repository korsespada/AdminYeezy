const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://shop_user:shop_pass_very_strong@85.198.97.100:5432/shop';
const pool = new Pool({ connectionString: DATABASE_URL });

async function check() {
  try {
    const subs = await pool.query("SELECT id, name FROM subcategories WHERE name ILIKE '%Ботинки%' OR name ILIKE '%Обувь%'");
    console.log("Subcategories:");
    console.log(JSON.stringify(subs.rows, null, 2));

    const cats = await pool.query("SELECT id, name FROM categories WHERE name ILIKE '%Обувь%'");
    console.log("\nCategories:");
    console.log(JSON.stringify(cats.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
