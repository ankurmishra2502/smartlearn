const { Server } = require("socket.io");
const Redis = require("ioredis");
const crypto = require("crypto");

const pub = new Redis(process.env.REDIS_URL);
const sub = new Redis(process.env.REDIS_URL);

const redis = require("../config/redis"); // 🔥 THIS FIXES YOUR ERROR
const pool = require("../config/db");


const { getAIResponse } = require("../services/aiService");

const hashPrompt = (text) =>
  crypto
    .createHash("sha256")
    .update(text.trim().toLowerCase())
    .digest("hex");


async function saveMessage({
  conversationId,
  senderType,
  message
}) {
  const role =
    senderType === "ai"
      ? "assistant"
      : "user";

  const result =
    await pool.query(
      `
      INSERT INTO ai_messages (
        conversation_id,
        role,
        content
      )
      VALUES ($1,$2,$3)
      RETURNING *
      `,
      [
        conversationId,
        role,
        message
      ]
    );

  return result.rows[0];
}


async function getOrCreateConversation(
  roomId,
  userId
) {
  const existing =
    await pool.query(
      `
      SELECT id
      FROM ai_conversations
      WHERE room_id=$1
      AND user_id=$2
      LIMIT 1
      `,
      [roomId, userId]
    );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created =
    await pool.query(
      `
      INSERT INTO ai_conversations (
        room_id,
        user_id
      )
      VALUES ($1,$2)
      RETURNING id
      `,
      [roomId, userId]
    );

  return created.rows[0].id;
}




let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    console.log("🟢 User connected:", socket.id);

    socket.on("join_room", async ({ roomId, userId }) => {
      console.log("JOIN EVENT:", { roomId, userId });

      const participantCheck = await pool.query(
  `
  SELECT 1
  FROM room_participants
  WHERE room_id=$1
  AND user_id=$2
  `,
  [roomId, userId]
);

if (!participantCheck.rows.length) {
  return socket.emit("room_error", {
    message: "You are not part of this room"
  });
}

      const roomKey = String(roomId);

      socket.join(roomKey);

      socket.roomId = roomKey;
      socket.userId = userId;

      // 🔥 Now redis is defined
      await redis.sadd(`room:${roomKey}:users`, userId);

      const connkey = `user_conn:${userId}`;
      const count = await redis.incr(connkey);
      if(count === 1){
        await redis.sadd("online_users", userId);
      }
      
      const users = await redis.smembers(`room:${roomKey}:users`);

      console.log("REDIS USERS:", users);

      io.to(roomKey).emit("presence_update", users);
    });

    socket.on( "send_message", async ({ roomId, userId, message }) => {
        try {
          const roomKey = String(roomId);

          const conversationId =
            await getOrCreateConversation(
              roomId,
              userId
            );

          const savedMessage =
            await saveMessage({
              conversationId,
              senderType: "user",
              message
            });

          io.to(roomKey).emit(
            "receive_message",
            savedMessage
          );

        } catch (error) {
          console.error(
            "send_message error:",
            error
          );
        }
      }
    );

    socket.on( "ask_ai", async ({ roomId, userId, message }) => {
        try {
          console.log("AI REQUEST:", {
            roomId,
            userId,
            message
          });

          const roomKey = String(roomId);
          const conversationId =
            await getOrCreateConversation(
              roomId,
              userId
            );

          // save user prompt
          await saveMessage({
            conversationId,
            senderType: "user",
            message
          });

          // fetch previous conversation history
          const previousMessages =
  await pool.query(
    `
    SELECT role, content
    FROM ai_messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
    LIMIT 20
    `,
    [conversationId]
  );

          // real AI response
          const aiResponse =
            await getAIResponse({
              message,
              roomId,
              userId,
              conversationId,
              chatHistory:
                previousMessages.rows
            });

          // save AI reply
          const savedAiMessage =
            await saveMessage({
              conversationId,
              senderType: "ai",
              message: aiResponse
            });
        const feedRes = await pool.query(
  `
  INSERT INTO host_ai_feed (
    room_id,
    host_id,
    prompt,
    response,
    chat_date
  )
  VALUES ($1,$2,$3,$4,CURRENT_DATE)
  RETURNING *
  `,
  [
    roomId,
    userId,
    message,
    aiResponse
  ]
);
          // emit only to current room
          io.to(roomKey).emit(
            "new_host_chat",
            feedRes.rows[0]
          );

        } catch (error) {
          console.error(
            "ask_ai error:",
            error
          );

          socket.emit("ai_error", {
           success: false,
           message: 
              error.message ||
              "Failed to get AI response"
          });
        }
      }
    );



    socket.on("disconnect", async () => {
      if (socket.roomId && socket.userId) {
        await redis.srem(`room:${socket.roomId}:users`, socket.userId);
        const connkey = `user_conn:${socket.userId}`;
        const count = await redis.decr(connkey);
        if(count <= 0){
          await redis.srem("online_users", socket.userId);
          await redis.del(connkey);
        }

        const users = await redis.smembers(`room:${socket.roomId}:users`);

        io.to(socket.roomId).emit("presence_update", users);
      }

      console.log("🔴 User disconnected:", socket.id);
    });
  });

  // 🔥 Redis Pub/Sub
  sub.subscribe("host_ai_updates");

  sub.on("message", (channel, message) => {
    if (channel === "host_ai_updates") {
       console.log("📡 REDIS EVENT:", channel, message); 
       const { roomId, data } = JSON.parse(message);

      if (io) {
       io.to(String(roomId)).emit(
  "new_host_chat",
  data
);
      }
    }
  });
};

module.exports = { initSocket };