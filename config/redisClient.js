const Redis = require('ioredis');
const{ Queue, QueueEvents } = require('bullmq');
require('dotenv').config();

const connectionOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
};

// Redis è attivo di default: si disattiva solo con REDIS_ENABLED=false
const redisEnabled = process.env.REDIS_ENABLED !== 'false';

let redisClient = null;
let txQueue = null;
let mempoolQueueEvents = null;
let baselineQueue = null;
let baselineQueueEvents = null;

if (redisEnabled) {
  redisClient = new Redis(connectionOptions);
  txQueue = new Queue('mempool-queue', { connection: connectionOptions });
  //coda di eventi per il frontend
  mempoolQueueEvents = new QueueEvents('mempool-queue', { connection: connectionOptions });

  // nuova coda per l'aggiornamento dello xes base, con annessa conda di eventi per il frontend
  baselineQueue = new Queue('baseline-queue', { connection: connectionOptions });
  baselineQueueEvents = new QueueEvents('baseline-queue', { connection: connectionOptions });
}

module.exports = {
  redisEnabled,
  redisClient,
  txQueue,
  mempoolQueueEvents,
  baselineQueue,       
  baselineQueueEvents,
  connectionOptions
}