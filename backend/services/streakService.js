const client = require("../config/db");

async function updateSubjectStreak(client, userId, subjectId) {
  const data = await client.query(
    `SELECT current_streak, last_activity_date
     FROM user_subject_streaks
     WHERE user_id = $1 AND subject_id = $2`,
    [userId, subjectId]
  );

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  let newStreak = 1;

  if (data.rows.length > 0) {
    const { current_streak, last_activity_date } = data.rows[0];

    // ✅ SAME DAY → DO NOTHING
    if (last_activity_date) {
      const lastDateStr = new Date(last_activity_date)
        .toISOString()
        .split("T")[0];

      if (lastDateStr === todayStr) {
        return { updated: false }; // 🚀 STOP HERE
      }
    }

    // Calculate difference
    if (last_activity_date) {
      const lastDate = new Date(last_activity_date);

      const diffDays = Math.floor(
        (today - lastDate) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        newStreak = current_streak + 1;
      } else {
        newStreak = 1; // missed day reset
      }
    }
  }

  await client.query(
    `INSERT INTO user_subject_streaks 
     (user_id, subject_id, current_streak, longest_streak, last_activity_date)
     VALUES ($1, $2, $3, $3, CURRENT_DATE)
     ON CONFLICT (user_id, subject_id)
     DO UPDATE SET
       current_streak = $3,
       longest_streak = GREATEST(user_subject_streaks.longest_streak, $3),
       last_activity_date = CURRENT_DATE`,
    [userId, subjectId, newStreak]
  );

  return { updated: true, streak: newStreak };
}

async function updateGlobalStreak(client, userId) {
    console.log("Updating global streak for user:", userId);
  // ✅ Ensure user_stats row exists
  await client.query(
    `INSERT INTO user_stats (user_id, current_streak, longest_streak)
     VALUES ($1, 0, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const data = await client.query(
    `SELECT current_streak, last_active_date 
     FROM user_stats 
     WHERE user_id = $1`,
    [userId]
  );

  const row = data.rows[0];

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  let newStreak = 1;

  // ✅ FIRST TIME (no last_active_date)
  if (!row.last_active_date) {
    newStreak = 1;

    await client.query(
      `UPDATE user_stats
       SET current_streak = 1,
           longest_streak = 1,
           last_active_date = CURRENT_DATE
       WHERE user_id = $1`,
      [userId]
    );

    return { updated: true, streak: 1 };
  }

  const lastDateStr = new Date(row.last_active_date)
    .toISOString()
    .split("T")[0];

  // ❌ SAME DAY → DO NOTHING
  if (lastDateStr === todayStr) {
    return {
      updated: false,
      streak: row.current_streak
    };
  }

  const lastDate = new Date(row.last_active_date);

  const diffDays = Math.floor(
    (today - lastDate) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 1) {
    newStreak = row.current_streak + 1;
  } else {
    newStreak = 1; // missed day reset
  }

  await client.query(
    `UPDATE user_stats
     SET current_streak = $1,
         longest_streak = GREATEST(longest_streak, $1),
         last_active_date = CURRENT_DATE
     WHERE user_id = $2`,
    [newStreak, userId]
  );

  return { updated: true, streak: newStreak };
}


module.exports = {
  updateSubjectStreak,
  updateGlobalStreak
};