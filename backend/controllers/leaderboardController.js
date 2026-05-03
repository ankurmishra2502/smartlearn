const pool = require("../config/db");

exports.getClassLeaderboard = async (req, res) => {
   try {
    if (!req.user) {
      return res.status(403).json({ message: "Student access required" });
    }

    const userId = req.user.userId;

    // 🔹 Get student class
    const student = await pool.query(
      `SELECT class FROM user_academic_details WHERE user_id=$1`,
      [userId]
    );

    if (!student.rows.length) {
      return res.status(404).json({ message: "Student not found" });
    }

    const studentClass = student.rows[0].class;

    // 🔥 Leaderboard (ALL TIME XP)
    const result = await pool.query(
  `SELECT 
    u.id,
    u.first_name,
    u.last_name,
    us.total_xp,
    RANK() OVER (ORDER BY us.total_xp DESC) AS rank
   FROM users u
   JOIN user_academic_details ua ON ua.user_id = u.id
   JOIN user_stats us ON us.user_id = u.id
   WHERE ua.class = $1
   ORDER BY us.total_xp DESC`,
  [studentClass]
);

    // 🔥 Get current user rank
    const myRank = result.rows.find(r => r.id === userId);

    res.json({
      class: studentClass,
      my_rank: myRank || null,
      leaderboard: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
};

