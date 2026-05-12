const { spawn } = require('child_process');
const { Client } = require('pg');
require('dotenv').config();

async function run() {
    console.log('--- Starting Excel Import ---');
    
    // 1. Запускаем Python для получения данных
    const python = spawn('python', ['scripts/excel_to_json.py']);
    let jsonData = '';
    let errorData = '';

    python.stdout.on('data', (data) => { jsonData += data.toString(); });
    python.stderr.on('data', (data) => { errorData += data.toString(); });

    python.on('close', async (code) => {
        if (code !== 0) {
            console.error('Python Error:', errorData);
            return;
        }

        try {
            const fs = require('fs');
            const path = require('path');
            const tmpPath = path.join(process.cwd(), 'tmp', 'suppliers_import.json');
            
            if (!fs.existsSync(tmpPath)) {
                console.error('Data file not found at:', tmpPath);
                return;
            }

            const jsonData = fs.readFileSync(tmpPath, 'utf8');
            const suppliers = JSON.parse(jsonData);
            console.log(`Parsed ${suppliers.length} suppliers from Excel (UTF-8 Mode)`);

            const client = new Client({ connectionString: process.env.DATABASE_URL });
            await client.connect();

            for (const s of suppliers) {
                // Маппинг полей
                const query = `
                    INSERT INTO suppliers (
                        name, album_id, group_id, tag_id, 
                        default_category, default_brand, default_subcategory, 
                        min_photos, min_desc, aliases, gender
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (album_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        group_id = EXCLUDED.group_id,
                        tag_id = EXCLUDED.tag_id,
                        default_category = EXCLUDED.default_category,
                        default_brand = EXCLUDED.default_brand,
                        default_subcategory = EXCLUDED.default_subcategory,
                        min_photos = EXCLUDED.min_photos,
                        min_desc = EXCLUDED.min_desc,
                        aliases = EXCLUDED.aliases,
                        gender = EXCLUDED.gender
                `;

                // Очистка и подготовка данных
                const params = [
                    s.name || 'Unknown',
                    s.album_id,
                    s.group_id?.toString() || '',
                    s.tag_id?.toString() || '',
                    s.category || null,
                    s.brand || null,
                    s.subcategory || null,
                    parseInt(s.min_photos) || 0,
                    parseInt(s.min_desc) || 0,
                    s.aliases || null,
                    s.gender || null
                ];

                await client.query(query, params);
            }

            await client.end();
            console.log('✓ Import successful!');
        } catch (err) {
            console.error('Import Error:', err);
        }
    });
}

// Чтобы ON CONFLICT (album_id) работал, нужно добавить UNIQUE индекс
async function prepare() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('ALTER TABLE suppliers ADD CONSTRAINT unique_album_id UNIQUE (album_id)');
    await client.end();
}

// Сначала индекс, потом импорт
prepare().catch(() => {}).then(run);
