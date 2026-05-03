const aiService = require("../services/aiService");
const aiQueue = require("../queues/aiQueue");
const pool = require("../config/db");
exports.askAI = async (req, res) => {
  try {
    const data = await aiService.askAI({
      roomId: req.body.roomId,
      userId: req.user.userId,
      prompt: req.body.prompt,
      share: req.body.share
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOrCreateConversation = async (req, res) => {
  const { roomId } = req.body;
  const userId = req.user?.userId || "test-user";
  console.log("GET/CREATE CONVO:", { roomId, userId });

  let convo = await pool.query(
    `SELECT * FROM ai_conversations WHERE room_id=$1 AND user_id=$2`,
    [roomId, userId]
  );

  if (convo.rows.length === 0) {
    convo = await pool.query(
      `INSERT INTO ai_conversations (room_id, user_id)
       VALUES ($1,$2) RETURNING *`,
      [roomId, userId]
    );
  }

  res.json(convo.rows[0]);
};

exports.sendMessage = async (req, res) => {
  const { conversationId, prompt, share } = req.body;
  const userId = req.user?.userId || "test-user";

  await pool.query(
    `INSERT INTO ai_messages (conversation_id, role, content)
     VALUES ($1,'user',$2)`,
    [conversationId, prompt]
  );

  await aiQueue.add("ai-job", {
    conversationId,
    prompt,
    share,
    userId
  });

  res.json({ message: "Processing..." });
};

exports.getMessages = async (req, res) => {
  const msgs = await pool.query(
    `SELECT * FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
    [req.params.id]
  );

  res.json(msgs.rows);
};