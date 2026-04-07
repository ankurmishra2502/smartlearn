const pool = require("../config/db");
const {updateGlobalStreak} = require("./streakService");

// Get XP value from rules
async function getXPValue(client, eventType) {
  const res = await client.query(
    `SELECT xp_value FROM xp_rules WHERE event_type = $1 AND is_active = true`,
    [eventType]
  );

  if (res.rows.length === 0) {
    throw new Error(`No XP rule found for ${eventType}`);
  }

  return res.rows[0].xp_value;
}



async function assignXP({
  userId,
  eventType,
  referenceType = null,
  sourceId = null,
  metadata = {}
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const xpValue = await getXPValue(client, eventType);

    const insert = await client.query(
      `INSERT INTO xp_transactions 
       (user_id, event_type, reference_type, source_id, xp, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING xp`,
      [userId, eventType, referenceType, sourceId, xpValue, metadata]
    );

    if (insert.rowCount === 0) {
      await client.query("COMMIT");
      return { awarded: false };
    }

    // ✅ Ensure user exists
    await client.query(
      `INSERT INTO user_stats (user_id, total_xp, level, last_active_date, updated_at)
       VALUES ($1, 0, 0, NULL, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    let globalStreakResult = null;

    // 🔥 STREAK FIRST
    if (eventType === "DAILY_ACTIVE") {
      globalStreakResult = await updateGlobalStreak(client, userId);
    }

    // 🔥 XP UPDATE
    const updatedStats = await client.query(
      `UPDATE user_stats
       SET total_xp = total_xp + $1,
           level = FLOOR((total_xp + $1) / 100),
           updated_at = NOW()
       WHERE user_id = $2
       RETURNING total_xp, level`,
      [xpValue, userId]
    );

    await client.query("COMMIT");

    return {
      awarded: true,
      xp: xpValue,
      total_xp: updatedStats.rows[0].total_xp,
      level: updatedStats.rows[0].level,

      global_streak_updated: globalStreakResult?.updated ?? false,
      current_global_streak: globalStreakResult?.streak ?? null
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
// Assign XP (generic)
// async function assignXP({
//   userId,
//   eventType,
//   referenceType = null,
//   sourceId = null,
//   metadata = {}
// }) {
//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     const xpValue = await getXPValue(client, eventType);

//     const insert = await client.query(
//       `INSERT INTO xp_transactions 
//        (user_id, event_type, reference_type, source_id, xp, metadata)
//        VALUES ($1, $2, $3, $4, $5, $6)
//        ON CONFLICT DO NOTHING
//        RETURNING xp`,
//       [userId, eventType, referenceType, sourceId, xpValue, metadata]
//     );

//     // If already rewarded
//     if (insert.rowCount === 0) {
//       await client.query("COMMIT");
//       return { awarded: false };
//     }

//     // Check if user exists in user_stats
//     const userStatsCheck = await client.query(
//       `SELECT user_id FROM user_stats WHERE user_id = $1`,
//       [userId]
//     );
//     let globalStreakResult = null;
//     if (userStatsCheck.rows.length === 0) {
//       // Insert new user_stats if doesn't exist
//       await client.query(
//         `INSERT INTO user_stats (user_id, total_xp, level, last_active_date, updated_at)
//          VALUES ($1, $2, FLOOR($2 / 100), CURRENT_DATE, NOW())`,
//         [userId, xpValue]
//       );
//       globalStreakResult=await updateGlobalStreak(client, userId);
//     } else if (eventType === "DAILY_ACTIVE") {
        
//       await client.query(
//         `UPDATE user_stats
//          SET last_active_date = CURRENT_DATE, level = FLOOR((total_xp + $1) / 100), updated_at = NOW()
//          WHERE user_id = $2`,
//         [10,userId]
//       );
      
//       globalStreakResult=await updateGlobalStreak(client, userId);
//     }    
//     else {
//       // Update total XP
//       await client.query(
//         `UPDATE user_stats
//          SET total_xp = total_xp + $1, level = FLOOR((total_xp + $1) / 100), last_active_date = CURRENT_DATE,
//              updated_at = NOW()
//          WHERE user_id = $2`,
//         [xpValue, userId]
//       );
//     }

    
    
//     await client.query("COMMIT");

//     return { awarded: true, xp: xpValue, global_streak_updated: globalStreakResult?.updated || false, current_global_streak: globalStreakResult?.streak || null};

//   } catch (err) {
//     await client.query("ROLLBACK");
//     throw err;
//   } finally {
//     client.release();
//   }
// }

module.exports = {
  assignXP
};