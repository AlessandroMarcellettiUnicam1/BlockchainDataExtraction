const Redis = require('ioredis');
const{ Queue } = require('bullmq');
require('dotenv').config();

const connectionOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
};

const redisClient = new Redis(connectionOptions);
const txQueue = new Queue('mempool-queue', { connection: connectionOptions });

module.exports = {
  redisClient,
  txQueue,
  connectionOptions
}