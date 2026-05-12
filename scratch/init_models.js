const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function initModels() {
  try {
    // 1. Initialize available models
    const defaultModels = JSON.stringify([
      "google/gemini-2.0-flash-lite:free",
      "google/gemini-3.1-flash-lite-preview",
      "anthropic/claude-3-haiku",
      "openai/gpt-4o-mini"
    ]);

    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES 
        ('available_ai_models', $1),
        ('selected_ai_model', 'google/gemini-2.0-flash-lite:free')
      ON CONFLICT (key) DO NOTHING;
    `, [defaultModels]);

    console.log('AI models settings initialized.');
  } catch (err) {
    console.error('Error initializing models:', err);
  } finally {
    await pool.end();
  }
}

initModels();
