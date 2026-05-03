const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const aiQueue = new Queue("ai-processing", {
  connection
});

module.exports = aiQueue;