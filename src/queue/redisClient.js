import 'dotenv/config';

export const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

console.log(`🔴 Redis: ${redisConnection.host}:${redisConnection.port}`);
