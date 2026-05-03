const db = require('../config/db');

const getProgressSummaryService = async (userId) => {
  const query = `
    WITH quiz_data AS (
      SELECT 
        q.id AS quiz_id,
        q.topic_id,
        q.difficulty,
        q.max_attempts_per_day,

        COALESCE(uqp.passed, false) AS passed,
        COALESCE(uqp.total_attempts, 0) AS total_attempts,
        uqp.last_attempted_at

      FROM quizzes q
      LEFT JOIN user_quiz_progress uqp
        ON q.id = uqp.quiz_id 
        AND uqp.user_id = $1
    ),

    topic_agg AS (
      SELECT 
        topic_id,

        COUNT(*) AS total_quizzes,

        SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed_quizzes,

        -- 🎯 mastery %
        SUM(
          CASE 
            WHEN passed THEN 
              CASE 
                WHEN difficulty = 'easy' THEN 20
                WHEN difficulty = 'medium' THEN 30
                WHEN difficulty = 'hard' THEN 50
              END
            ELSE 0
          END
        ) AS mastery,

        -- 🎯 attempts today
        SUM(
          CASE 
            WHEN DATE(last_attempted_at) = CURRENT_DATE 
            THEN total_attempts 
            ELSE 0
          END
        ) AS attempts_today,

        -- 🎯 max attempts allowed (from quiz table)
        MAX(max_attempts_per_day) AS max_attempts_per_day,

        COUNT(*) FILTER (
          WHERE last_attempted_at IS NOT NULL
        ) AS attempted_quizzes

      FROM quiz_data
      GROUP BY topic_id
    )

    SELECT 
      t.id AS topic_id,
      t.title AS topic_name,   -- ✅ FIXED
      s.name AS subject_name,

      COALESCE(ta.mastery, 0) AS mastery,

      CASE
        -- ✅ MASTERED
        WHEN ta.passed_quizzes = ta.total_quizzes 
             AND ta.total_quizzes > 0
        THEN 'MASTERED'

        -- 🔴 NEEDS WORK (dynamic limit)
        WHEN ta.attempts_today >= ta.max_attempts_per_day
        THEN 'NEEDS_WORK'

        -- 🟡 IN PROGRESS
        WHEN ta.attempted_quizzes > 0
        THEN 'IN_PROGRESS'

        -- ⚪ NOT STARTED
        ELSE 'NOT_STARTED'
      END AS status

    FROM topics t
    JOIN subjects s ON t.subject_id = s.id
    LEFT JOIN topic_agg ta ON t.id = ta.topic_id
    WHERE t.is_active = true;
  `;

  const { rows } = await db.query(query, [userId]);

  // -------- Aggregation --------

  const counts = {
    mastered: 0,
    in_progress: 0,
    needs_work: 0,
    not_started: 0,
  };

  let totalMastery = 0;

  const topics = rows.map(row => {
    const statusKey = row.status.toLowerCase();

    if (counts[statusKey] !== undefined) {
      counts[statusKey]++;
    }

    const mastery = Number(row.mastery || 0);
    totalMastery += mastery;

    return {
      topic_id: row.topic_id,
      topic_name: row.topic_name,
      subject: row.subject_name,
      mastery,
      status: row.status,
    };
  });

  const overall_mastery = topics.length
    ? Math.round(totalMastery / topics.length)
    : 0;

  return {
    overall_mastery,
    counts,
    topics,
  };
};

const getDashboardService = async (userId) => {

  // ------------------ 1. WEEKLY TIME ------------------
  const timeQuery = `
    SELECT 
      COALESCE(SUM(LEAST(time_spent_seconds, 1800)), 0) AS seconds
    FROM user_quiz_attempts
    WHERE user_id = $1
    AND attempt_date >= NOW() - INTERVAL '7 days'
    AND time_spent_seconds > 0;
  `;

  const timeRes = await db.query(timeQuery, [userId]);
  const totalSeconds = Number(timeRes.rows[0].seconds || 0);
  const weeklyTime = `${(totalSeconds / 3600).toFixed(1)}h`;

  // ------------------ 2. AVG SCORE (FIXED LOGIC) ------------------
  const scoreQuery = `
    WITH latest_attempts AS (
      SELECT DISTINCT ON (quiz_id)
        quiz_id,
        score
      FROM user_quiz_attempts
      WHERE user_id = $1
      AND attempt_date >= NOW() - INTERVAL '7 days'
      ORDER BY quiz_id, attempt_date DESC
    )
    SELECT COALESCE(AVG(score), 0) AS avg_score
    FROM latest_attempts;
  `;

  const scoreRes = await db.query(scoreQuery, [userId]);
  const avgScore = Math.round(scoreRes.rows[0].avg_score || 0);

  // ------------------ 3. TOPICS DONE (YOUR LOGIC OPTIMIZED) ------------------
  const topicsQuery = `
    WITH topic_status AS (
      SELECT 
        q.topic_id,
        COUNT(q.id) AS total_quizzes,
        COUNT(DISTINCT CASE 
          WHEN uqp.passed = true THEN uqp.quiz_id 
        END) AS passed_quizzes
      FROM quizzes q
      LEFT JOIN user_quiz_progress uqp
        ON q.id = uqp.quiz_id 
        AND uqp.user_id = $1
      GROUP BY q.topic_id
    )
    SELECT COUNT(*) AS completed_topics
    FROM topic_status
    WHERE total_quizzes > 0
    AND total_quizzes = passed_quizzes;
  `;

  const totalTopicsQuery = `
    SELECT COUNT(*) AS total 
    FROM topics 
    WHERE is_active = true;
  `;

  const [topicsRes, totalTopicsRes] = await Promise.all([
    db.query(topicsQuery, [userId]),
    db.query(totalTopicsQuery)
  ]);

  const topicsDone = Number(topicsRes.rows[0].completed_topics || 0);
  const totalTopics = Number(totalTopicsRes.rows[0].total || 0);

  // ------------------ 4. STREAK (FROM user_stats) ------------------
  const streakQuery = `
    SELECT current_streak 
    FROM user_stats 
    WHERE user_id = $1
  `;

  const streakRes = await db.query(streakQuery, [userId]);
  const streak = Number(streakRes.rows[0]?.current_streak || 0);

  // ------------------ FINAL RESPONSE ------------------
  return {
    weekly_time: {
      value: weeklyTime
    },
    avg_score: {
      value: `${avgScore}%`
    },
    topics_done: {
      value: topicsDone,
      remaining: totalTopics - topicsDone
    },
    streak: {
      value: `${streak} days`
    }
  };
};

const getAnalyticsService = async (userId) => {

  // =========================
  // 1️⃣ WEEKLY ACTIVITY (Study Minutes)
  // =========================
  const weeklyQuery = `
    SELECT 
      TO_CHAR(DATE(attempt_date), 'Dy') AS day,
      SUM(time_spent_seconds)/60 AS minutes
    FROM user_quiz_attempts
    WHERE user_id = $1
      AND attempt_date >= CURRENT_DATE - INTERVAL '6 days'
    GROUP BY DATE(attempt_date)
    ORDER BY DATE(attempt_date);
  `;

  const weeklyRes = await db.query(weeklyQuery, [userId]);

  // Fill missing days
  const daysOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weeklyMap = {};

  weeklyRes.rows.forEach(r => {
    weeklyMap[r.day] = Math.round(r.minutes);
  });

  const weekly_activity = daysOrder.map(day => ({
    day,
    value: weeklyMap[day] || 0
  }));


  // =========================
  // 2️⃣ SUBJECT MASTERY
  // =========================
  const masteryQuery = `
    WITH topic_mastery AS (
      SELECT 
        t.id AS topic_id,
        t.subject_id,

        COUNT(q.id) AS total_quizzes,

        COUNT(DISTINCT CASE 
          WHEN uqp.passed = true THEN uqp.quiz_id 
        END) AS passed_quizzes

      FROM topics t
      JOIN quizzes q ON q.topic_id = t.id
      LEFT JOIN user_quiz_progress uqp
        ON uqp.quiz_id = q.id AND uqp.user_id = $1
      GROUP BY t.id, t.subject_id
    )

    SELECT 
      s.name AS subject,
      ROUND(
        AVG(
          CASE 
            WHEN total_quizzes = 0 THEN 0
            ELSE (passed_quizzes::decimal / total_quizzes) * 100
          END
        )
      ) AS mastery
    FROM topic_mastery tm
    JOIN subjects s ON s.id = tm.subject_id
    GROUP BY s.name;
  `;

  const masteryRes = await db.query(masteryQuery, [userId]);

  const subject_mastery = masteryRes.rows.map(r => ({
    subject: r.subject,
    value: Number(r.mastery)
  }));


  // =========================
  // 3️⃣ XP GROWTH
  // =========================

  // ✅ CASE A: If you have xp_transactions
  let xp_growth = [];

  try {
    const xpQuery = `
      SELECT 
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        SUM(xp) AS total_xp
      FROM xp_transactions
      WHERE user_id = $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
      LIMIT 4;
    `;

    const xpRes = await db.query(xpQuery, [userId]);

    xp_growth = xpRes.rows.map((r, i) => ({
      week: `Week ${i + 1}`,
      xp: Number(r.total_xp)
    }));

  } catch (err) {
    // ❗ fallback if table doesn't exist
    xp_growth = [
      { week: "Week 1", xp: 0 },
      { week: "Week 2", xp: 0 },
      { week: "Week 3", xp: 0 },
      { week: "Week 4", xp: 0 }
    ];
  }

  // =========================
  // FINAL RESPONSE
  // =========================
  return {
    weekly_activity,
    subject_mastery,
    xp_growth
  };
};


const getCertificatesService = async (userId) => {
  const query = `
    WITH latest_per_quiz AS (
      SELECT
        q.topic_id,
        q.id AS quiz_id,
        COALESCE(uqp.latest_score, 0) AS latest_score,
        COALESCE(uqp.passed, false) AS passed,
        uqp.last_attempted_at
      FROM quizzes q
      LEFT JOIN user_quiz_progress uqp
        ON uqp.quiz_id = q.id
        AND uqp.user_id = $1
    ),

    topic_agg AS (
      SELECT
        topic_id,
        COUNT(*) AS total_quizzes,
        COUNT(*) FILTER (WHERE passed = true) AS passed_quizzes,
        ROUND(AVG(latest_score)) AS avg_score,
        MAX(last_attempted_at) AS completed_at
      FROM latest_per_quiz
      GROUP BY topic_id
    )

    SELECT
      t.id AS topic_id,
      t.title AS topic,
      s.name AS subject,
      ta.avg_score,
      ta.completed_at
    FROM topic_agg ta
    JOIN topics t ON t.id = ta.topic_id
    JOIN subjects s ON s.id = t.subject_id
    WHERE ta.total_quizzes > 0
      AND ta.total_quizzes = ta.passed_quizzes
    ORDER BY ta.completed_at DESC NULLS LAST
    LIMIT 4;
  `;

  const { rows } = await db.query(query, [userId]);

  const certificates = rows.map(r => ({
    topic: r.topic,
    subject: r.subject,
    score: Number(r.avg_score || 0),
    date: r.completed_at, // format on frontend if needed
    distinction: Number(r.avg_score) >= 90
  }));

  return { certificates };
};


module.exports = {
  getProgressSummaryService,
  getDashboardService,
  getAnalyticsService,
  getCertificatesService
};