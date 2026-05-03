const { Server } = require("socket.io");
const Redis = require("ioredis");

const pub = new Redis(process.env.REDIS_URL);
const sub = new Redis(process.env.REDIS_URL);

const redis = require("../config/redis"); // 🔥 THIS FIXES YOUR ERROR

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    console.log("🟢 User connected:", socket.id);

    socket.on("join_room", async ({ roomId, userId }) => {
      console.log("JOIN EVENT:", { roomId, userId });

      socket.join(roomId);

      socket.roomId = roomId;
      socket.userId = userId;

      // 🔥 Now redis is defined
      await redis.sadd(`room:${roomId}:users`, userId);

      const connkey = `user_conn:${userId}`;
      const count = await redis.incr(connkey);
      if(count === 1){
        await redis.sadd("online_users", userId);
      }
      
      const users = await redis.smembers(`room:${roomId}:users`);

      console.log("REDIS USERS:", users);

      io.to(roomId).emit("presence_update", users);
    });

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
  sub.subscribe("ai_updates");

  sub.on("message", (channel, message) => {
    if (channel === "ai_updates") {
       console.log("📡 REDIS EVENT:", channel, message); 
       const { roomId, data } = JSON.parse(message);

      if (io) {
        io.to(roomId).emit("new_shared_feed", data);
      }
    }
  });
};

module.exports = { initSocket };