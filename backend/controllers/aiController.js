const aiService = require("../services/aiService");
const aiQueue = require("../queues/aiQueue");
const pool = require("../config/db");
const openai = require("../config/openai");
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
  const { conversationId, prompt } = req.body;
  const userId = req.user.userId;

  try {
    // Get conversation room
    const convoRes = await pool.query(
      `SELECT room_id FROM ai_conversations WHERE id=$1`,
      [conversationId]
    );

    if (!convoRes.rows.length) {
      return res.status(404).json({
        error: "Conversation not found"
      });
    }

    const roomId = convoRes.rows[0].room_id;

    // Get room details
    const roomRes = await pool.query(
      `SELECT host_id, topic
       FROM study_rooms
       WHERE id=$1`,
      [roomId]
    );

    const room = roomRes.rows[0];

    // ONLY HOST CAN ASK AI
    if (room.host_id !== userId) {
      return res.status(403).json({
        error: "Only host can chat with AI"
      });
    }

    // Fetch goals
    const goalsRes = await pool.query(
      `SELECT goal FROM session_goals WHERE room_id=$1`,
      [roomId]
    );

  const goals = goalsRes.rows.map(g => g.goal);

const validationRes = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  temperature: 0,
  messages: [
    {
      role: "system",
      content: `
You are a strict academic validator.

Room Topic:
${room.topic}

Room Goals:
${goals.join(", ")}

Rules:
- Allow ONLY directly related academic questions
- Reject off-topic questions
- Return ONLY:
ALLOWED
or
BLOCKED
      `
    },
    {
      role: "user",
      content: prompt
    }
  ]
});

const decision =
  validationRes.choices[0].message.content.trim();

if (decision !== "ALLOWED") {
  return res.status(400).json({
    error:
      "This room only allows questions related to the topic and goals."
  });
}

    await pool.query(
      `INSERT INTO ai_messages
       (conversation_id, role, content)
       VALUES ($1,'user',$2)`,
      [conversationId, prompt]
    );

    await aiQueue.add("ai-job", {
      conversationId,
      prompt,
      userId,
      roomId,
      isHostChat: true
    });

    res.json({
      success: true,
      message: "AI processing started"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to process AI chat"
    });
  }
};

exports.getMessages = async (req, res) => {
  const msgs = await pool.query(
    `SELECT * FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
    [req.params.id]
  );

  res.json(msgs.rows);
};