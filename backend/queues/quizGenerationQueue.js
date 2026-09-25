const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null
  }
);

const quizGenerationQueue = new Queue(
  "quiz-generation",
  {
    connection
  }
);

module.exports = quizGenerationQueue;