const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const aiTutorQueue = new Queue("ai-tutor", {
  connection,
});

module.exports = aiTutorQueue;