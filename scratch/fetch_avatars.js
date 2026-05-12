const { Pool } = require('pg');
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

async function updateAvatars() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const parserPath = path.join(process.cwd(), 'scripts', 'parser', 'SzwegoParser.py');
  
  try {
    const { rows: suppliers } = await pool.query('SELECT id, album_id, name FROM suppliers WHERE avatar_url IS NULL');
    console.log(`Fetching avatars for ${suppliers.length} suppliers using Python parser...`);
    
    for (const s of suppliers) {
      if (!s.album_id || s.album_id.length < 5) continue;
      
      console.log(`-> Fetching avatar for: ${s.name} (${s.album_id})`);
      
      try {
        const logo = await new Promise((resolve, reject) => {
          const python = spawn('python', [parserPath, '--album_id', s.album_id, '--get_avatar', '--output', 'tmp/tmp_avatar.csv']);
          let output = '';
          
          python.stdout.on('data', (data) => {
            output += data.toString();
          });
          
          python.on('close', (code) => {
            const match = output.match(/AVATAR_RESULT:(.+)/);
            if (match) resolve(match[1].trim());
            else resolve(null);
          });
          
          python.on('error', (err) => reject(err));
          
          // Timeout after 15s
          setTimeout(() => { python.kill(); resolve(null); }, 15000);
        });

        if (logo) {
          await pool.query('UPDATE suppliers SET avatar_url = $1 WHERE id = $2', [logo, s.id]);
          console.log(`   ✅ Success!`);
        } else {
          console.warn(`   ⚠️ Not found`);
        }
      } catch (err) {
        console.error(`   ❌ Error:`, err.message);
      }
      
      // Delay to avoid spamming process creation
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log('--- All done! ---');
  } finally {
    await pool.end();
  }
}

updateAvatars();
