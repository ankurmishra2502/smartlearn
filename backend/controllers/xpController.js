const xpService = require("../services/xpService");
const pool = require("../config/db");

// DAILY ACTIVITY
exports.handleDailyActivity = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await xpService.assignXP({
      userId,
      eventType: "DAILY_ACTIVE",
      referenceType: "Daily Login"
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to assign daily XP"
    });
  }
};


// QUIZ COMPLETION
exports.handleQuizCompletion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.body;

    const result = await xpService.assignXP({
      userId,
      eventType: "QUIZ_COMPLETED",
      referenceType: "QUIZ",
      sourceId: quizId
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to assign quiz XP"
    });
  }
};


// XP HISTORY
exports.getXPHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log("Fetching XP history for user:", userId);
    const result = await pool.query(
      `SELECT event_type, reference_type, source_id, xp, created_at
       FROM xp_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch history"
    });
  }
};


// USER STATS
exports.getUserStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT total_xp, level, last_active_date
       FROM user_stats
       WHERE user_id = $1`,
      [userId]
    );

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats"
    });
  }
};

exports.getGlobalRanking = async (req, res) => {
  try {
    const updateRankQuery = `
      UPDATE user_stats us
      SET previous_rank = sub.rank
      FROM (
        SELECT user_id,
               RANK() OVER (ORDER BY total_xp DESC) as rank
        FROM user_stats
      ) sub
      WHERE us.user_id = sub.user_id;
    `;

    await pool.query(updateRankQuery);

    const userId = req.user.userId;
    console.log("Fetching global ranking for user:", userId);
    const result = await pool.query(`
         SELECT 
        u.id,
        u.first_name,
        u.profile_picture,
        us.total_xp,
        us.level,
        RANK() OVER (ORDER BY us.total_xp DESC) as rank
      FROM user_stats us
      JOIN users u ON u.id = us.user_id
      ORDER BY us.total_xp DESC
      LIMIT 50`);

      const leaderboard = result.rows.map(user => ({
        ...user,
        is_current_user: user.id === userId
      }));

      res.json({
        success: true,
        data: leaderboard
      });

  } catch (err) {
    console.error(err);
    res.status(500).json({
        success: false,
        message: "Failed to fetch leaderboard"
    });
  } 
};

function getRankMeta(change) {
  if (change > 0) return { text: `+${change}`, color: "green" };
  if (change < 0) return { text: `${change}`, color: "red" };
  return { text: "+0", color: "green" };
}


exports.getLeaderboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      WITH ranked AS (
        SELECT 
          u.id,
          u.first_name,
          u.profile_picture,
          us.total_xp,
          us.level,
          us.previous_rank,

          RANK() OVER (ORDER BY us.total_xp DESC) AS current_rank

        FROM user_stats us
        JOIN users u ON u.id = us.user_id
      )
      SELECT *,
        (previous_rank - current_rank) AS rank_change
      FROM ranked
      ORDER BY current_rank
      LIMIT 5
    `);

    const leaderboard = result.rows.map(user => {
      const change = user.rank_change || 0;

      const rankMeta = getRankMeta(change);

      const nextLevelXP = (user.level + 1) * 100;
      const xpNeeded = nextLevelXP - user.total_xp;

      return {
        id: user.id,
        name: user.first_name,
        profile_image: user.profile_picture,

        rank: user.current_rank,
        xp: user.total_xp,
        level: user.level,

        rank_change: rankMeta.text,
        rank_color: rankMeta.color,

        xp_to_next_level: xpNeeded > 0 ? xpNeeded : 0,

        is_current_user: user.id === userId
      };
    });
    const rivalQuery = await pool.query(`
 WITH ranked AS (
  SELECT 
    u.id,
    u.first_name,
    u.profile_picture,
    us.total_xp,
    us.level,
    RANK() OVER (ORDER BY us.total_xp DESC) AS rank
  FROM user_stats us
  JOIN users u ON u.id = us.user_id
)

SELECT 
  r.id,
  r.first_name,
  r.profile_picture,
  r.total_xp,
  r.level,
  r.rank,

  (r.total_xp - cu.total_xp) AS xp_ahead

FROM ranked r
JOIN ranked cu ON cu.id = $1
WHERE r.rank = cu.rank - 1;
`, [userId]);

 let rival = null;

if (rivalQuery.rows.length > 0) {
  const r = rivalQuery.rows[0];

  rival = {
    id: r.id,
    name: r.first_name,
    profile_image: r.profile_picture,

    rank: r.rank,
    xp: r.total_xp,
    level: r.level,

    xp_ahead: r.xp_ahead > 0 ? r.xp_ahead : 0
  };
}

    res.json({
      success: true,
      data: leaderboard,
      weekly_rival: rival
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Leaderboard error"
    });
  }
};

exports.getStreakDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Global streak
    const global = await pool.query(
      `SELECT current_streak FROM user_stats WHERE user_id = $1`,
      [userId]
    );

    // Subject streaks
    const subjects = await pool.query(
      `SELECT 
         s.id,
         s.name,
         s.icon,
         uss.current_streak
       FROM user_subject_streaks uss
       JOIN subjects s ON s.id = uss.subject_id
       WHERE uss.user_id = $1`,
      [userId]
    );

     const topStreaks = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.profile_picture,
        us.current_streak,
        RANK() OVER (ORDER BY us.current_streak DESC) as rank
      FROM user_stats us
      JOIN users u ON u.id = us.user_id
      ORDER BY us.current_streak DESC
      LIMIT 5
    `);

    // 🔥 4. User percentile
    const percentileData = await pool.query(`
      WITH ranked AS (
        SELECT 
          user_id,
          current_streak,
          RANK() OVER (ORDER BY current_streak DESC) as rank,
          COUNT(*) OVER () as total_users
        FROM user_stats
      )
      SELECT 
        rank,
        total_users,
        ROUND((rank::decimal / total_users) * 100) as percentile
      FROM ranked
      WHERE user_id = $1
    `, [userId]);

    const percentile = percentileData.rows[0]?.percentile || 100;

    // 🔹 Highlight current user in leaderboard
    const leaderboard = topStreaks.rows.map(user => ({
      ...user,
      is_current_user: user.id === userId
    }));

    res.json({
      success: true,
      data: {
        global_streak: global.rows[0]?.current_streak || 0,
        subjects: subjects.rows,
        top_streaks: leaderboard,
        user_percentile: percentile
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch streak data"
    });
  }
};