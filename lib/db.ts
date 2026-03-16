import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Client as ElasticClient } from '@elastic/elasticsearch';

// 1. PostgreSQL подключение
const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

// 2. Redis подключение (для сброса кеша)
export const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  lazyConnect: true, // не падать сразу, если нет соединения
});

redis.on('error', (err) => console.warn('Redis error in admin:', err.message));

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
  getClient,
  redis,
  elastic
};
