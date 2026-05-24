const db = require("../config/db");

const getStatsAnalyticsService = async (userId) => {
  try {
    /*
    ---------------------------------------
    1. XP / Misconception Points
    ---------------------------------------
    */
    const xpQuery = `
      SELECT COALESCE(total_xp, 0) as total_xp
      FROM user_stats
      WHERE user_id = $1
    `;

    /*
    ---------------------------------------
    2. Misconceptions fixed
    quiz failed before + passed later
    ---------------------------------------
    */
    const recoveryQuery = `
      WITH quiz_recovery AS (
        SELECT
          quiz_id,
          BOOL_OR(passed = false) AS ever_failed,
          BOOL_OR(passed = true) AS ever_passed
        FROM user_quiz_attempts
        WHERE user_id = $1
        GROUP BY quiz_id
      )
      SELECT COUNT(*) AS fixed_count
      FROM quiz_recovery
      WHERE ever_failed = true
      AND ever_passed = true
    `;

    /*
    ---------------------------------------
    3. Error Patterns
    repeated low-score topics
    ---------------------------------------
    */
    const errorPatternQuery = `
      SELECT
        t.id AS topic_id,
        t.title AS topic_name,
        COUNT(*) AS weak_attempts
      FROM user_quiz_attempts uqa
      JOIN topics t ON t.id = uqa.topic_id
      WHERE uqa.user_id = $1
      AND uqa.score < 60
      GROUP BY t.id, t.title
      ORDER BY weak_attempts DESC
      LIMIT 5
    `;

    /*
    ---------------------------------------
    4. Progress by Subject
    ---------------------------------------
    */
    const subjectProgressQuery = `
      SELECT
        s.id,
        s.name AS subject_name,
        ROUND(AVG(utp.progress_percent)) AS progress
      FROM user_topic_progress utp
      JOIN topics t ON t.id = utp.topic_id
      JOIN subjects s ON s.id = t.subject_id
      WHERE utp.user_id = $1
      GROUP BY s.id, s.name
      ORDER BY s.name
    `;

    /*
    ---------------------------------------
    5. Study Time
    ---------------------------------------
    */
    const studyTimeQuery = `
      SELECT
        COALESCE(SUM(time_spent_seconds), 0) AS total_seconds
      FROM user_quiz_attempts
      WHERE user_id = $1
    `;

    /*
    ---------------------------------------
    6. Accuracy %
    Latest quiz score avg
    ---------------------------------------
    */
    const accuracyQuery = `
      WITH latest_attempts AS (
        SELECT DISTINCT ON (quiz_id)
          quiz_id,
          score
        FROM user_quiz_attempts
        WHERE user_id = $1
        ORDER BY quiz_id, submitted_at DESC
      )
      SELECT COALESCE(AVG(score), 0) AS avg_score
      FROM latest_attempts
    `;

    /*
    ---------------------------------------
    7. Best Timing (Cognitive Peak)
    based on started_at
    ---------------------------------------
    */
    const cognitivePeakQuery = `
      SELECT
        EXTRACT(HOUR FROM started_at) AS hour,
        ROUND(AVG(score)::numeric, 2) AS avg_score,
        COUNT(*) AS attempts
      FROM user_quiz_attempts
      WHERE user_id = $1
      AND started_at IS NOT NULL
      GROUP BY hour
      HAVING COUNT(*) >= 2
      ORDER BY avg_score DESC
      LIMIT 1
    `;

    /*
    ---------------------------------------
    8. Historical Load Analysis
    topic-wise
    ---------------------------------------
    */
    const loadAnalysisQuery = `
      SELECT
        t.id,
        t.title AS topic_name,
        COUNT(uqa.id) AS attempts,
        ROUND(AVG(uqa.score)) AS avg_score,
        ROUND(AVG(uqa.time_spent_seconds)/60) AS avg_time_minutes
      FROM user_quiz_attempts uqa
      JOIN topics t ON t.id = uqa.topic_id
      WHERE uqa.user_id = $1
      GROUP BY t.id, t.title
      ORDER BY attempts DESC
      LIMIT 6
    `;

    const [
      xpRes,
      recoveryRes,
      errorRes,
      subjectRes,
      studyRes,
      accuracyRes,
      peakRes,
      loadRes
    ] = await Promise.all([
      db.query(xpQuery, [userId]),
      db.query(recoveryQuery, [userId]),
      db.query(errorPatternQuery, [userId]),
      db.query(subjectProgressQuery, [userId]),
      db.query(studyTimeQuery, [userId]),
      db.query(accuracyQuery, [userId]),
      db.query(cognitivePeakQuery, [userId]),
      db.query(loadAnalysisQuery, [userId])
    ]);

    /*
    ---------------------------------------
    Format Response
    ---------------------------------------
    */

    const totalXP =
      Number(xpRes.rows[0]?.total_xp || 0);

    const fixedCount =
      Number(recoveryRes.rows[0]?.fixed_count || 0);

    const totalSeconds =
      Number(studyRes.rows[0]?.total_seconds || 0);

    const studyHours =
      `${(totalSeconds / 3600).toFixed(1)}h`;

    const accuracy =
      `${Math.round(
        accuracyRes.rows[0]?.avg_score || 0
      )}%`;

    const peakHour =
      peakRes.rows.length
        ? `${peakRes.rows[0].hour}:00`
        : null;

    /*
    Error Pattern Formatting
    */
    const errorPatterns =
      errorRes.rows.map(row => ({
        topic_id: row.topic_id,
        topic_name: row.topic_name,
        occurrences: Number(row.weak_attempts),
        status:
          row.weak_attempts >= 3
            ? "critical"
            : "improving"
      }));

    /*
    Historical Load
    */
    const historicalLoad =
      loadRes.rows.map(row => {
        const load =
          Math.min(
            100,
            row.attempts * 10 +
              row.avg_time_minutes * 2
          );

        const pressure =
          Math.min(
            100,
            (100 - row.avg_score) +
              row.avg_time_minutes
          );

        return {
          topic_name: row.topic_name,
          load,
          pressure
        };
      });

    /*
    AI Suggestion
    */
    let aiSuggestion =
      "Great consistency. Keep learning.";

    if (errorPatterns.length > 0) {
      aiSuggestion =
        `${errorPatterns[0].topic_name} seems challenging right now. Revisiting this topic may improve performance.`;
    }

    return {
      misconception_points: totalXP,

      correction_streak: {
        fixed_count: fixedCount
      },

      error_patterns: errorPatterns,

      subject_progress:
        subjectRes.rows,

      key_metrics: {
        study_time: studyHours,
        accuracy,
        cognitive_peak: peakHour
      },

      historical_load_analysis:
        historicalLoad,

      ai_suggestion: aiSuggestion
    };

  } catch (error) {
    console.error(
      "Stats analytics error:",
      error
    );
    throw error;
  }
};

module.exports = {
  getStatsAnalyticsService
};