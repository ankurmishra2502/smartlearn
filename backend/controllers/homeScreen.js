const pool = require("../config/db");

const getRecommendedTopics = async (userId) => {
  const query = `
    SELECT 
      t.id AS topic_id,
      t.name AS topic_name,
      s.name AS subject_name
    FROM topics t
    JOIN subjects s ON t.subject_id = s.id
    ORDER BY RANDOM()
    LIMIT 4;
  `;

  const { rows } = await pool.query(query);
  return rows;
};

exports.getContinueLearning = async (req, res) => {
  try {
    const userId = req.user.userId;

    const query = `
      SELECT 
        utp.topic_id,
        t.name AS topic_name,
        s.name AS subject_name,
        utp.progress_percent,
        utp.last_accessed_at
      FROM user_topic_progress utp
      JOIN topics t ON utp.topic_id = t.id
      JOIN subjects s ON t.subject_id = s.id
      WHERE utp.user_id = $1
      AND utp.is_completed = FALSE
      ORDER BY utp.last_accessed_at DESC
      LIMIT 4;
    `;

    const { rows } = await pool.query(query, [userId]);

    // 🧠 CASE 3: First-time user
    if (rows.length === 0) {
      const recommended = await getRecommendedTopics(userId);

      return res.json({
        latest: null,
        continue_learning: [],
        recommended
      });
    }

    // 🧠 Split latest + grid
    const latest = rows[0];
    const continueLearning = rows.slice(1, 4);

    return res.json({
      latest,
      continue_learning: continueLearning
    });

  } catch (error) {
    console.error("Home API Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.updateTopicProgress = async (req, res) => {
  try {
    const { topic_id, progress_percent } = req.body;
    const userId = req.user.userId;

    const isCompleted = progress_percent >= 100;

    const query = `
      INSERT INTO user_topic_progress (
        user_id, topic_id, progress_percent, last_accessed_at, is_completed, updated_at
      )
      VALUES ($1, $2, $3, NOW(), $4, NOW())
      ON CONFLICT (user_id, topic_id)
      DO UPDATE SET
        progress_percent = EXCLUDED.progress_percent,
        last_accessed_at = NOW(),
        is_completed = EXCLUDED.is_completed,
        updated_at = NOW();
    `;

    await pool.query(query, [
      userId,
      topic_id,
      progress_percent,
      isCompleted
    ]);

    res.json({ message: "Progress updated" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};