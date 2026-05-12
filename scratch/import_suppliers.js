const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  const suppliersJson = JSON.parse(fs.readFileSync('tmp_suppliers.json', 'utf8'));

  console.log(`Processing ${suppliersJson.length} suppliers...`);

  for (const s of suppliersJson) {
    // Construct brand_tags
    let brand_tags = [];
    if (s.group_id) {
      String(s.group_id).split('\n').forEach(line => {
        if (line.includes('=')) {
          const [label, val] = line.split('=');
          brand_tags.push(`group:${label.trim()}=${val.trim()}`);
        }
      });
    }
    if (s.tag_id) {
      String(s.tag_id).split('\n').forEach(line => {
        if (line.includes('=')) {
          const [label, val] = line.split('=');
          brand_tags.push(`tag:${label.trim()}=${val.trim()}`);
        }
      });
    }

    const brandTagsStr = brand_tags.join('\n');

    const query = `
      INSERT INTO suppliers (
        album_id, name, brand_tags, default_price, default_gender, 
        default_category, default_subcategory, default_brand, 
        aliases, merge_enabled, ai_photo_enabled, min_photos, min_desc_len
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (album_id) DO UPDATE SET
        name = EXCLUDED.name,
        brand_tags = EXCLUDED.brand_tags,
        default_price = EXCLUDED.default_price,
        default_gender = EXCLUDED.default_gender,
        default_category = EXCLUDED.default_category,
        default_subcategory = EXCLUDED.default_subcategory,
        default_brand = EXCLUDED.default_brand,
        aliases = EXCLUDED.aliases,
        merge_enabled = EXCLUDED.merge_enabled,
        ai_photo_enabled = EXCLUDED.ai_photo_enabled,
        min_photos = EXCLUDED.min_photos,
        min_desc_len = EXCLUDED.min_desc_len
    `;

    const values = [
      s.album_id,
      s.name,
      brandTagsStr,
      s.price || null,
      s.gender || null,
      s.category || null,
      s.subcategory || null,
      s.brand || null,
      s.aliases || null,
      s.merge === 'yes',
      s.ai_photo === 'yes',
      s.min_photos ? parseInt(s.min_photos) : null,
      s.min_desc ? parseInt(s.min_desc) : null
    ];

    try {
      await client.query(query, values);
    } catch (err) {
      console.error(`Error importing ${s.name}:`, err.message);
    }
  }

  await client.end();
  console.log('Import finished.');
}

run();
