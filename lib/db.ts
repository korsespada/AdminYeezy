import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Client as ElasticClient } from '@elastic/elasticsearch';

// 1. PostgreSQL - Боевая база (Vibe)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const legacyCatalogPool = new Pool({
  connectionString: process.env.LEGACY_CATALOG_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const analyticsPool = new Pool({
  connectionString: process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// 2. PostgreSQL - Техническая база (Scraping)
const scrapingPool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL, // Если нет отдельной, используем основную
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const legacyCatalogQuery = (text: string, params?: any[]) => legacyCatalogPool.query(text, params);
export const analyticsQuery = (text: string, params?: any[]) => analyticsPool.query(text, params);
export const scrapingQuery = (text: string, params?: any[]) => scrapingPool.query(text, params);
export const getClient = () => pool.connect();
export const getLegacyCatalogClient = () => legacyCatalogPool.connect();
export const getAnalyticsClient = () => analyticsPool.connect();
export const getScrapingClient = () => scrapingPool.connect();

// 2. Redis подключение (для сброса кеша)
export const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  lazyConnect: true, // не падать сразу, если нет соединения
});

redis.on('error', (err) => {
  if (err.message.toUpperCase().includes('NOAUTH')) return;
  console.warn('Redis error in admin:', err.message);
});

// 3. Elasticsearch подключение (для обновления индекса поиска)
export const elastic = new ElasticClient({
  node: process.env.ES_HOST || 'http://127.0.0.1:9200',
  auth: process.env.ES_USERNAME && process.env.ES_PASSWORD ? {
    username: process.env.ES_USERNAME,
    password: process.env.ES_PASSWORD,
  } : undefined,
});

export default {
  query,
  legacyCatalogQuery,
  analyticsQuery,
  scrapingQuery,
  getClient,
  getLegacyCatalogClient,
  getAnalyticsClient,
  getScrapingClient,
  redis,
  elastic
};
