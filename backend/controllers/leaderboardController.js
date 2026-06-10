const pool = require("../config/db");

exports.getClassLeaderboard = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const userId = req.user.userId;

    /*
    ---------------------------------------
    Get student's class
    ---------------------------------------
    */
    const student = await pool.query(
      `
      SELECT class
      FROM user_academic_details
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!student.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    const studentClass = student.rows[0].class;

    /*
    ---------------------------------------
    Class Leaderboard
    ---------------------------------------
    */
    const result = await pool.query(
      `
      WITH ranked AS (
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.profile_picture,

          us.total_xp,
          us.level,
          us.previous_rank,

          RANK() OVER (
            ORDER BY us.total_xp DESC
          ) AS current_rank

        FROM users u

        INNER JOIN user_academic_details ua
          ON ua.user_id = u.id

        INNER JOIN user_stats us
          ON us.user_id = u.id

        WHERE ua.class = $1
      )

      SELECT *,
        COALESCE(previous_rank, current_rank) - current_rank AS rank_change
      FROM ranked
      ORDER BY current_rank
      `,
      [studentClass]
    );

    const leaderboard = result.rows.map((user) => {
      const change = Number(user.rank_change || 0);

      let rankMeta = {
        text: "-",
        color: "gray",
      };

      if (change > 0) {
        rankMeta = {
          text: "up",
          color: "green",
        };
      } else if (change < 0) {
        rankMeta = {
          text: "down",
          color: "red",
        };
      }

      const nextLevelXP =
        (Number(user.level) + 1) * 100;

      const xpNeeded =
        nextLevelXP - Number(user.total_xp);

      return {
        id: user.id,

        first_name: user.first_name,
        last_name: user.last_name,

        name: `${user.first_name} ${user.last_name}`,

        profile_image: user.profile_picture,

        rank: Number(user.current_rank),

        xp: Number(user.total_xp),

        level: Number(user.level),

        rank_change: rankMeta.text,
        rank_color: rankMeta.color,

        xp_to_next_level:
          xpNeeded > 0 ? xpNeeded : 0,

        is_current_user:
          user.id === userId,
      };
    });

    /*
    ---------------------------------------
    Current User
    ---------------------------------------
    */
    const myRank =
      leaderboard.find(
        (item) => item.id === userId
      ) || null;

    /*
    ---------------------------------------
    Top 3
    ---------------------------------------
    */
    const topThree = leaderboard.slice(0, 3);

    /*
    ---------------------------------------
    Remaining Leaderboard
    (Starts from Rank #4)
    ---------------------------------------
    */
    const remainingLeaderboard =
      leaderboard.slice(3);

    return res.status(200).json({
      success: true,

      class: studentClass,

      my_rank: myRank,

      top_three: topThree,

      leaderboard: remainingLeaderboard,
    });

  } catch (err) {
    console.error("getClassLeaderboard:", err);

    return res.status(500).json({
      success: false,
      message: "Error fetching leaderboard",
    });
  }
};

