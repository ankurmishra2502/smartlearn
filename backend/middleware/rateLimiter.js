const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const rateLimiter = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const key = `rate:${userId}`;

    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60); // 1 minute window
    }

    if (count > 10) {
      return res.status(429).json({
        error: "Too many requests. Try again later."
      });
    }

    next();

  } catch (err) {
    console.error("Rate limiter error:", err);
    next(); // don't block request
  }
};

module.exports = rateLimiter;