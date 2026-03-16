
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setupAnalytics() {
  try {
    console.log('Создаю таблицы аналитики...');
    
    await pool.query(`
      -- Таблица для событий аналитики
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL, -- view, cart_add, favorite_add, order_success
        product_id VARCHAR(100),
        product_name VARCHAR(255),
        price DECIMAL(10, 2),
        session_id VARCHAR(100),
        user_agent TEXT,
        country VARCHAR(100),
        os VARCHAR(50),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Таблица для заказов (если её еще нет)
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        total_price DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        items JSONB,
        customer_info JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Индексы для быстрого поиска
      CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_product ON analytics_events(product_id);
    `);

    console.log('Таблицы успешно созданы!');
  } catch (err) {
    console.error('Ошибка при создании таблиц:', err.message);
  } finally {
    await pool.end();
  }
}

setupAnalytics();
