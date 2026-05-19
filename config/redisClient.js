const Redis = require('ioredis');
const{ Queue, QueueEvents } = require('bullmq');
require('dotenv').config();

const connectionOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
};

const redisClient = new Redis(connectionOptions);
const txQueue = new Queue('mempool-queue', { connection: connectionOptions });

//coda di eventi per il frontend
const mempoolQueueEvents = new QueueEvents('mempool-queue', { connection: connectionOptions });

module.exports = {
  redisClient,
  txQueue,
  mempoolQueueEvents,
  connectionOptions
}