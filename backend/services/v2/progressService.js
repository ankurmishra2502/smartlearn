const pool = require("../../config/db");

// Mirrors quizService.completeStage: level = floor(total_xp / 500) + 1
const XP_PER_LEVEL = 500;

// Badge shown for each level band. Adjust thresholds to match design.
const LEVEL_BADGES = [
  { key: "rookie", label: "Rookie", minLevel: 1 },
  { key: "skilled", label: "Skilled", minLevel: 3 },
  { key: "expert", label: "Expert", minLevel: 5 },
  { key: "mastermind", label: "Mastermind", minLevel: 7 },
  { key: "legend", label: "Legend", minLevel: 9 },
  { key: "king", label: "King", minLevel: 10 },
];

// "How you earn points" card: mirrors STAGE_SCORING in quizService.
const XP_RULES = [
  { key: "easy", label: "Correct answer, easy stage", xp: 50, per: "stage passed" },
  { key: "medium", label: "Correct answer, medium stage", xp: 100, per: "stage passed" },
  { key: "hard", label: "Correct answer, hard stage", xp: 150, per: "stage passed" },
];

const badgeForLevel = (level) =>
  [...LEVEL_BADGES].reverse().find((b) => level >= b.minLevel) || LEVEL_BADGES[0];

const initialsOf = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

const intensityOf = (questions) =>
  questions <= 0 ? 0 : questions < 5 ? 1 : questions < 10 ? 2 : questions < 20 ? 3 : 4;

const levelFromXp = (xp) => Math.floor(Number(xp) / XP_PER_LEVEL) + 1;

const levelProgress = (totalXp) => {
  const xp = Number(totalXp) || 0;
  const level = levelFromXp(xp);
  const current = xp - (level - 1) * XP_PER_LEVEL;
  return {
    level,
    totalXp: xp,
    currentLevelXp: current,
    xpForNextLevel: XP_PER_LEVEL,
    xpToNextLevel: XP_PER_LEVEL - current,
    percent: Math.floor((current / XP_PER_LEVEL) * 100),
  };
};

// Streaks from distinct days a user answered at least one question.
// Returns per-user { current_streak, longest_streak }.
const STREAKS_CTE = `
  days AS (
    SELECT DISTINCT user_id, (answered_at AT TIME ZONE 'UTC')::date AS d
    FROM v2_question_attempts
    WHERE answered_at IS NOT NULL
  ),
  grp AS (
    SELECT user_id, d,
           d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS g
    FROM days
  ),
  runs AS (
    SELECT user_id, MIN(d) AS start_d, MAX(d) AS end_d, COUNT(*)::int AS len
    FROM grp GROUP BY user_id, g
  ),
  streaks AS (
    SELECT user_id,
           MAX(len) AS longest_streak,
           COALESCE(MAX(len) FILTER (
             WHERE end_d >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1
           ), 0) AS current_streak
    FROM runs GROUP BY user_id
  )
`;

// goalParam: SQL placeholder (e.g. "$4") holding a goal uuid, or null for all learners.
const boardCte = (goalParam) => `
  ${STREAKS_CTE},
  acc AS (
    SELECT user_id,
           COUNT(*) FILTER (WHERE status = 'answered')::int AS answered,
           COUNT(*) FILTER (WHERE is_correct)::int AS correct,
           AVG(time_taken_ms) FILTER (WHERE status = 'answered' AND time_taken_ms <= 600000) AS avg_ms
    FROM v2_question_attempts GROUP BY user_id
  ),
  board AS (
    SELECT RANK() OVER (ORDER BY s.total_xp DESC, u.created_at ASC)::int AS rank,
           u.id AS user_id,
           u.first_name, u.last_name, u.profile_picture,
           s.total_xp, s.level,
           g.name AS goal_name,
           ad.district AS city,
           COALESCE(st.current_streak, 0)::int AS streak,
           COALESCE(a.answered, 0) AS answered,
           COALESCE(a.correct, 0) AS correct,
           CASE WHEN COALESCE(a.answered, 0) = 0 THEN 0
                ELSE ROUND(a.correct * 100.0 / a.answered) END::int AS accuracy,
           CASE WHEN a.avg_ms IS NULL THEN NULL
                ELSE ROUND(a.avg_ms / 1000.0)::int END AS avg_time_seconds
    FROM v2_user_stats s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_goals ug ON ug.user_id = s.user_id AND ug.is_primary
    LEFT JOIN goals g ON g.id = ug.goal_id
    LEFT JOIN user_academic_details ad ON ad.user_id = s.user_id
    LEFT JOIN streaks st ON st.user_id = s.user_id
    LEFT JOIN acc a ON a.user_id = s.user_id
    ${goalParam ? `WHERE ${goalParam}::uuid IS NULL OR ug.goal_id = ${goalParam}::uuid` : ""}
  )
`;
const BOARD_CTE = boardCte(null);

const mapRow = (r, myId) => {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
  const displayName = name || "Learner";
  return {
  rank: r.rank,
  isTop3: r.rank <= 3,
  userId: r.user_id,
  name,
  displayName,
  initials: initialsOf(displayName),
  profilePicture: r.profile_picture,
  level: r.level,
  levelTitle: badgeForLevel(r.level).label,
  goalName: r.goal_name || null,
  city: r.city || null,
  subtitle: [r.goal_name, r.city].filter(Boolean).join(" · "),
  points: r.total_xp,
  questionsAnswered: r.answered,
  correctAnswers: r.correct,
  streakDays: r.streak,
  accuracyPercent: r.accuracy,
  avgTimePerQuestionSeconds: r.avg_time_seconds,
  avgTimePerQuestionMinutes: r.avg_time_seconds === null ? null : Math.round(r.avg_time_seconds / 60),
  isMe: r.user_id === myId,
  };
};

// Tab "All learners": learners who share my primary goal. My own row comes
// back separately as `me` (pinned on top); `learners` lists everyone else by rank.
const getLeaderboard = async ({ userId, limit = 20, offset = 0, search = "", goalId = null }) => {
  const term = `%${search.trim()}%`;

  let goal = null;
  if (goalId) {
    const g = await pool.query(`SELECT id, name FROM goals WHERE id = $1`, [goalId]);
    goal = g.rows[0] || null;
  } else {
    const g = await pool.query(
      `SELECT g.id, g.name FROM user_goals ug JOIN goals g ON g.id = ug.goal_id
       WHERE ug.user_id = $1 AND ug.is_primary
       ORDER BY ug.updated_at DESC LIMIT 1`,
      [userId]
    );
    goal = g.rows[0] || null;
  }
  const goalValue = goal ? goal.id : null;
  const cte = boardCte("$1");

  const list = await pool.query(
    `WITH ${cte}
     SELECT * FROM board
     WHERE user_id <> $2
       AND ($5 = '%%' OR (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE $5)
     ORDER BY rank, user_id
     LIMIT $3 OFFSET $4`,
    [goalValue, userId, limit, offset, term]
  );
  const total = await pool.query(
    `WITH ${cte} SELECT COUNT(*)::int AS n FROM board`,
    [goalValue]
  );
  const me = await pool.query(
    `WITH ${cte} SELECT * FROM board WHERE user_id = $2`,
    [goalValue, userId]
  );
  const myRow = me.rows[0] || null;

  let rankChange = null;
  let nextAbove = null;
  let weeklyPoints = 0;
  let behind = 0;
  if (myRow) {
    // Rank a week ago = rank by (total_xp - xp earned since Monday), same cohort.
    const wk = await pool.query(
      `WITH cohort AS (
         SELECT s.user_id, s.total_xp
         FROM v2_user_stats s
         LEFT JOIN user_goals ug ON ug.user_id = s.user_id AND ug.is_primary
         WHERE $1::uuid IS NULL OR ug.goal_id = $1::uuid
       ),
       w AS (
         SELECT c.user_id,
                c.total_xp - COALESCE(SUM(x.xp) FILTER (
                  WHERE x.created_at >= date_trunc('week', CURRENT_TIMESTAMP)), 0) AS prev_xp,
                COALESCE(SUM(x.xp) FILTER (
                  WHERE x.created_at >= date_trunc('week', CURRENT_TIMESTAMP)), 0)::int AS week_xp
         FROM cohort c LEFT JOIN v2_xp_transactions x ON x.user_id = c.user_id
         GROUP BY c.user_id, c.total_xp
       )
       SELECT (SELECT COUNT(*) + 1 FROM w o WHERE o.prev_xp > w.prev_xp)::int AS prev_rank,
              w.week_xp,
              (SELECT COUNT(*) FROM w o WHERE o.prev_xp < w.prev_xp)::int AS behind
       FROM w WHERE w.user_id = $2`,
      [goalValue, userId]
    );
    const row = wk.rows[0];
    if (row) {
      weeklyPoints = row.week_xp;
      rankChange = row.prev_rank - myRow.rank; // positive = moved up
    }
    const above = await pool.query(
      `WITH ${cte}
       SELECT total_xp FROM board WHERE total_xp > $2 ORDER BY total_xp ASC LIMIT 1`,
      [goalValue, myRow.total_xp]
    );
    nextAbove = above.rows[0] ? above.rows[0].total_xp - myRow.total_xp : null;
    const bh = await pool.query(
      `WITH ${cte} SELECT COUNT(*)::int AS n FROM board WHERE total_xp < $2`,
      [goalValue, myRow.total_xp]
    );
    behind = bh.rows[0].n;
  }

  const cohortSize = total.rows[0].n;
  return {
    goal: goal ? { id: goal.id, name: goal.name } : null,
    title: goal ? `${goal.name} learners` : "All learners",
    subtitle: "Ranked by points earned. Updated every hour.",
    totalLearners: cohortSize,
    limit,
    offset,
    hasMore: offset + list.rows.length < cohortSize - (myRow ? 1 : 0),
    search: search.trim(),
    sortedBy: "points",
    me: myRow ? mapRow(myRow, userId) : null,
    learners: list.rows.map((r) => mapRow(r, userId)),
    myRankSummary: myRow
      ? {
          rank: myRow.rank,
          rankChangeThisWeek: rankChange,
          pointsThisWeek: weeklyPoints,
          pointsToNextRank: nextAbove,
          percentile: cohortSize ? Math.round(((cohortSize - myRow.rank) / cohortSize) * 100) : 0,
        }
      : null,
    youAreAheadOf: behind,
  };
};

// Tab "My best"
const getPersonalBests = async (userId) => {
  const overall = await pool.query(
    `WITH ${STREAKS_CTE},
     per_attempt AS (
       SELECT qa.id, COUNT(*) FILTER (WHERE q.is_correct)::int AS correct,
              COUNT(*)::int AS total,
              SUM(q.time_taken_ms) FILTER (WHERE q.time_taken_ms <= 600000) AS total_ms
       FROM v2_quiz_attempts qa
       JOIN v2_question_attempts q ON q.quiz_attempt_id = qa.id
       WHERE qa.user_id = $1 AND qa.status = 'completed'
       GROUP BY qa.id
     )
     SELECT
       (SELECT correct FROM per_attempt ORDER BY correct DESC, total ASC LIMIT 1) AS best_correct,
       (SELECT total   FROM per_attempt ORDER BY correct DESC, total ASC LIMIT 1) AS best_total,
       (SELECT ROUND(MIN(total_ms) / 1000.0)::int FROM per_attempt WHERE total_ms IS NOT NULL) AS fastest_seconds,
       (SELECT ROUND(MAX(correct * 100.0 / NULLIF(total,0)))::int FROM per_attempt) AS best_accuracy,
       COALESCE((SELECT longest_streak FROM streaks WHERE user_id = $1), 0) AS longest_streak,
       COALESCE((SELECT current_streak FROM streaks WHERE user_id = $1), 0) AS current_streak`,
    [userId]
  );

  const byTopic = await pool.query(
    `WITH per_attempt AS (
       SELECT qz.topic_name, qa.id,
              COUNT(*) FILTER (WHERE q.is_correct)::int AS correct,
              COUNT(*)::int AS total
       FROM v2_quiz_attempts qa
       JOIN v2_quizzes qz ON qz.id = qa.quiz_id
       JOIN v2_question_attempts q ON q.quiz_attempt_id = qa.id
       WHERE qa.user_id = $1 AND qa.status = 'completed'
       GROUP BY qz.topic_name, qa.id
     ),
     ranked AS (
       SELECT topic_name, correct, total,
              ROW_NUMBER() OVER (PARTITION BY topic_name ORDER BY correct DESC, total ASC) AS rn,
              COUNT(*) OVER (PARTITION BY topic_name)::int AS attempts
       FROM per_attempt
     )
     SELECT topic_name, correct, total, attempts FROM ranked WHERE rn = 1
     ORDER BY correct * 1.0 / NULLIF(total,0) DESC NULLS LAST
     LIMIT 20`,
    [userId]
  );

  // "Where you are": the learners ranked directly around me.
  const around = await pool.query(
    `WITH ${BOARD_CTE},
     mine AS (SELECT rank FROM board WHERE user_id = $1)
     SELECT b.* FROM board b, mine m
     WHERE b.rank BETWEEN m.rank - 2 AND m.rank + 2
     ORDER BY b.rank, b.user_id LIMIT 5`,
    [userId]
  );

  const totals = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'answered')::int AS answered,
            COUNT(*) FILTER (WHERE is_correct)::int AS correct,
            ROUND(AVG(time_taken_ms) FILTER (WHERE status = 'answered' AND time_taken_ms <= 600000) / 1000.0)::int AS avg_seconds,
            COUNT(DISTINCT quiz_attempt_id)::int AS attempts,
            COUNT(DISTINCT (answered_at AT TIME ZONE 'UTC')::date)::int AS active_days
     FROM v2_question_attempts WHERE user_id = $1`,
    [userId]
  );
  const t = totals.rows[0];
  const completed = await pool.query(
    `SELECT COUNT(*)::int AS n FROM v2_quiz_attempts WHERE user_id = $1 AND status = 'completed'`,
    [userId]
  );

  const o = overall.rows[0];
  return {
    totals: {
      quizzesCompleted: completed.rows[0].n,
      questionsAnswered: t.answered,
      correctAnswers: t.correct,
      overallAccuracyPercent: t.answered ? Math.round((t.correct * 100) / t.answered) : 0,
      avgTimePerQuestionSeconds: t.avg_seconds,
      activeDays: t.active_days,
    },
    bestScore: o.best_correct === null ? null : { correct: o.best_correct, total: o.best_total },
    fastestQuizSeconds: o.fastest_seconds,
    bestAccuracyPercent: o.best_accuracy,
    longestStreakDays: Number(o.longest_streak),
    currentStreakDays: Number(o.current_streak),
    recordsByTopic: byTopic.rows.map((r) => ({
      topic: r.topic_name,
      bestCorrect: r.correct,
      total: r.total,
      attempts: r.attempts,
    })),
    whereYouAre: around.rows.map((r) => mapRow(r, userId)),
  };
};

// Tab "Levels": points, level, badges, activity heatmap, XP rules
const getLevelsAndBadges = async (userId, { days = 84 } = {}) => {
  const statsRes = await pool.query(
    `SELECT total_xp FROM v2_user_stats WHERE user_id = $1`,
    [userId]
  );
  const totalXp = statsRes.rows[0] ? statsRes.rows[0].total_xp : 0;
  const progress = levelProgress(totalXp);

  const streakRes = await pool.query(
    `WITH ${STREAKS_CTE}
     SELECT COALESCE(current_streak,0)::int AS cs FROM streaks WHERE user_id = $1`,
    [userId]
  );

  const heat = await pool.query(
    `WITH q AS (
       SELECT (answered_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS questions
       FROM v2_question_attempts
       WHERE user_id = $1 AND answered_at >= CURRENT_DATE - $2::int
       GROUP BY 1
     ),
     x AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(xp)::int AS xp
       FROM v2_xp_transactions
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - $2::int
       GROUP BY 1
     )
     SELECT to_char(COALESCE(q.day, x.day), 'YYYY-MM-DD') AS day,
            COALESCE(q.questions, 0) AS questions,
            COALESCE(x.xp, 0) AS xp
     FROM q FULL JOIN x ON x.day = q.day
     ORDER BY 1`,
    [userId, days]
  );

  const week = await pool.query(
    `SELECT COALESCE(SUM(xp),0)::int AS xp FROM v2_xp_transactions
     WHERE user_id = $1 AND created_at >= date_trunc('week', CURRENT_TIMESTAMP)`,
    [userId]
  );

  const wd = await pool.query(
    `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'UTC')::int AS dow, SUM(xp)::int AS xp
     FROM v2_xp_transactions
     WHERE user_id = $1 AND created_at >= date_trunc('week', CURRENT_TIMESTAMP)
     GROUP BY 1`,
    [userId]
  );
  const wdMap = Object.fromEntries(wd.rows.map((r) => [r.dow, r.xp]));
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({
    day: label,
    xp: wdMap[i + 1] || 0,
  }));

  const badges = LEVEL_BADGES.map((b, i) => {
    const earned = progress.level >= b.minLevel;
    const next = LEVEL_BADGES[i + 1];
    return {
      key: b.key,
      label: b.label,
      minLevel: b.minLevel,
      xpRequired: (b.minLevel - 1) * XP_PER_LEVEL,
      xpToUnlock: Math.max((b.minLevel - 1) * XP_PER_LEVEL - progress.totalXp, 0),
      levelsToUnlock: Math.max(b.minLevel - progress.level, 0),
      earned,
      current: earned && (!next || progress.level < next.minLevel),
    };
  });

  const maxShown = Math.max(progress.level + 2, 10);
  const levels = Array.from({ length: maxShown }, (_, i) => {
    const lvl = i + 1;
    return {
      level: lvl,
      title: badgeForLevel(lvl).label,
      fromXp: (lvl - 1) * XP_PER_LEVEL,
      toXp: lvl * XP_PER_LEVEL - 1,
      unlocksBadge: LEVEL_BADGES.some((b) => b.minLevel === lvl)
        ? LEVEL_BADGES.find((b) => b.minLevel === lvl).label
        : null,
      status: lvl < progress.level ? "done" : lvl === progress.level ? "current" : "locked",
    };
  });

  return {
    progress,
    streakDays: streakRes.rows[0] ? streakRes.rows[0].cs : 0,
    badgesEarned: badges.filter((b) => b.earned).length,
    badgesTotal: badges.length,
    badges,
    levels,
    xpThisWeek: week.rows[0].xp,
    xpByWeekday: weekdays,
    currentBadge: badges.find((b) => b.current) || null,
    nextBadge: badges.find((b) => !b.earned) || null,
    activeDays: heat.rows.filter((r) => r.questions > 0).length,
    activityHeatmap: heat.rows.map((r) => ({
      date: r.day,
      questions: r.questions,
      xp: r.xp,
      intensity: intensityOf(r.questions),
    })),
    howYouEarnPoints: XP_RULES,
  };
};

module.exports = { getLeaderboard, getPersonalBests, getLevelsAndBadges, levelProgress };
