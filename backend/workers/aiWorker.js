require("dotenv").config();

const { Worker } = require("bullmq");
const Redis = require("ioredis");
const crypto = require("crypto");
const pool = require("../config/db");
const openai = require("../config/openai");

// Redis connections
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const pub = new Redis(process.env.REDIS_URL);

// 🔥 Normalize + hash
const hashPrompt = (text) =>
  crypto
    .createHash("sha256")
    .update(text.trim().toLowerCase())
    .digest("hex");

new Worker(
  "ai-processing",
  async (job) => {
    const { conversationId, prompt, share, userId } = job.data;

    console.log("\n==============================");
    console.log("🧠 Processing:", prompt);
    console.log("👤 userId:", userId);
    console.log("🔗 conversationId:", conversationId);
    console.log("📤 share:", share);

    try {
      // 🔥 1. GET ROOM ID
      const convo = await pool.query(
        `SELECT room_id FROM ai_conversations WHERE id=$1`,
        [conversationId]
      );

      if (convo.rows.length === 0) {
        console.log("❌ No conversation found");
        return;
      }

      const roomId = convo.rows[0].room_id;
      console.log("🏠 roomId:", roomId);

      const cacheKey = `ai:cache:${hashPrompt(prompt)}`;
      console.log("🔑 cacheKey:", cacheKey);

      let answer = null;

      // 🔥 2. CHECK CACHE
      const cached = await pub.get(cacheKey);

      console.log("⚡ cache exists:", !!cached);

      if (cached) {
        console.log("⚡ Cache HIT");

        try {
          const parsed = JSON.parse(cached);

          if (!parsed || !parsed.content) {
            console.log("❌ Invalid cache structure");
          } else {
            answer = parsed.content;
          }

        } catch (err) {
          console.log("❌ Cache parse error:", err.message);
        }
      }

      // 🔥 3. CACHE MISS → CALL AI
      if (!answer) {
        console.log("🧠 Cache MISS → calling OpenAI");

        const messages = await pool.query(
          `SELECT role, content FROM ai_messages
           WHERE conversation_id=$1
           ORDER BY created_at ASC`,
          [conversationId]
        );

        const chatHistory = messages.rows.map((m) => ({
          role: m.role,
          content: m.content
        }));

        const aiRes = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            ...chatHistory,
            { role: "user", content: prompt }
          ]
        });

        answer = aiRes.choices[0].message.content;

        // 🔥 Save conversation memory
        await pool.query(
          `INSERT INTO ai_messages (conversation_id, role, content)
           VALUES ($1,'assistant',$2)`,
          [conversationId, answer]
        );

        // 🔥 Save cache
        await pub.setex(
          cacheKey,
          3600,
          JSON.stringify({
            room_id: roomId,
            content: answer
          })
        );

        console.log("💾 Cached response saved");
      }

      // 🚨 SAFETY CHECK
      if (!answer) {
        console.log("❌ No answer generated, skipping...");
        return;
      }

      // 🔥 4. ALWAYS SAVE TO FEED IF SHARE TRUE
      if (share === true) {
        console.log("💾 Saving to shared_ai_feed...");

        try {
          const res = await pool.query(
            `INSERT INTO shared_ai_feed (room_id, user_id, title, content)
             VALUES ($1,$2,$3,$4)
             RETURNING *`,
            [
              roomId,
              userId,
              prompt.slice(0, 50),
              answer
            ]
          );

          console.log("✅ Feed saved:", res.rows[0].id);

          // 🔥 5. REALTIME EVENT
          console.log("📡 Publishing to Redis...");

          await pub.publish(
            "ai_updates",
            JSON.stringify({
              roomId,
              data: res.rows[0]
            })
          );

        } catch (err) {
          console.error("❌ DB INSERT ERROR:", err.message);
        }
      } else {
        console.log("⚠️ share is false → skipping feed save");
      }

    } catch (err) {
      console.error("❌ Worker error:", err.message);
    }

    console.log("==============================\n");
  },
  {
    connection
  }
);