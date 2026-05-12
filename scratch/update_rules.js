const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

const rules = `ИНСТРУКЦИИ ПО ФОРМАТИРОВАНИЮ И КОНТЕНТУ:

1. ФОРМАТ ЗАГОЛОВКА (name):
   - Строго придерживайся формата: "Бренд Тип товара". 
   - Название типа товара должно состоять из 1-2 слов (например: "Louis Vuitton Кроссовки" или "Gucci Футболка с принтом").

2. ОФОРМЛЕНИЕ ТЕКСТА (description):
   - Для разделения абзацев используй только символы переноса строки: \\n (одинарный) или \\n\\n (двойной).
   - Не используй HTML-теги или другие способы форматирования.

3. ЗАПРЕЩЕННЫЙ КОНТЕНТ:
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать китайские иероглифы, символы или слова в любом виде. Весь текст должен быть на русском языке.
   - УДАЛЯЙ любую информацию о наличии товара, способах и сроках отправки, а также о стоимости (цене) внутри поля описания (description).`;

async function run() {
  try {
    await pool.query('UPDATE app_settings SET value = $1 WHERE key = \'general_ai_rules\'', [rules]);
    console.log('AI rules updated successfully');
  } catch (err) {
    console.error('Error updating AI rules:', err);
  } finally {
    await pool.end();
  }
}

run();
