const pool = require("../config/db");
const certificateService = require("../services/certificateService");
const statsService = require("../services/statsService");

exports.getStudentDashboardOverview = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const userId = req.user.userId;

    /*
    =========================================
    1. CONTINUE LEARNING
    subject wise progress from user_quiz_progress
    =========================================
    */

    const continueLearningResult =
      await pool.query(
        `
        SELECT
          s.id AS subject_id,
          s.name AS subject_name,
          s.icon,

          ROUND(
            AVG(
              COALESCE(uqp.latest_score, 0)
            )
          ) AS progress_percent

        FROM subjects s

        INNER JOIN topics t
          ON t.subject_id = s.id

        INNER JOIN user_quiz_progress uqp
          ON uqp.topic_id = t.id

        WHERE
          uqp.user_id = $1

        GROUP BY
          s.id,
          s.name,
          s.icon

        ORDER BY s.name ASC
      `,
        [userId]
      );

    const continueLearning =
      continueLearningResult.rows.map(
        (row) => ({
          subject_id: row.subject_id,
          subject_name:
            row.subject_name,
          icon: row.icon,
          progress_percent: Number(
            row.progress_percent || 0
          ),
        })
      );

    /*
    =========================================
    2. COURSES COMPLETED
    if all quizzes of all topics in subject passed
    subject completed
    =========================================
    */

    const subjectsResult =
      await pool.query(`
      SELECT id, name
      FROM subjects
      ORDER BY name ASC
    `);

    let coursesCompleted = 0;

    for (const subject of subjectsResult.rows) {
      const topicResult =
        await pool.query(
          `
          SELECT id
          FROM topics
          WHERE subject_id = $1
        `,
          [subject.id]
        );

      let subjectCompleted = true;

      for (const topic of topicResult.rows) {
        const topicCheck =
          await pool.query(
            `
            SELECT
              COUNT(q.id) AS total,

              COUNT(
                DISTINCT CASE
                  WHEN uqp.passed = true
                  THEN uqp.quiz_id
                END
              ) AS passed

            FROM quizzes q

            LEFT JOIN user_quiz_progress uqp
              ON q.id = uqp.quiz_id
              AND uqp.user_id = $2

            WHERE q.topic_id = $1
          `,
            [topic.id, userId]
          );

        const total = parseInt(
          topicCheck.rows[0].total || 0
        );

        const passed = parseInt(
          topicCheck.rows[0].passed || 0
        );

        if (
          total === 0 ||
          total !== passed
        ) {
          subjectCompleted = false;
          break;
        }
      }

      if (subjectCompleted) {
        coursesCompleted++;
      }
    }

    /*
    =========================================
    3. CERTIFICATES
    =========================================
    */

    const certificateData =
      await certificateService.getCertificatesService(
        userId
      );

    const certificatesEarned =
      certificateData?.summary
        ?.certified || 0;

    /*
    =========================================
    4. GLOBAL RANK
    =========================================
    */

    const rankResult =
      await pool.query(
        `
      WITH ranked AS (
        SELECT
          u.id,
          RANK() OVER (
            ORDER BY us.total_xp DESC
          ) AS current_rank
        FROM user_stats us
        JOIN users u
          ON u.id = us.user_id
      )
      SELECT current_rank
      FROM ranked
      WHERE id = $1
      `,
        [userId]
      );

    const globalRank = Number(
      rankResult.rows[0]
        ?.current_rank || 0
    );

    /*
    =========================================
    5. COGNITIVE
    =========================================
    */

    const analytics =
      await statsService.getStatsAnalyticsService(
        userId
      );

    const efficiency =
      analytics?.key_metrics
        ?.accuracy || 0;

    /*
    =========================================
    HOURS LEARNED
    from user_quiz_attempts
    =========================================
    */

    const studyTimeResult =
      await pool.query(
        `
        SELECT
          COALESCE(
            SUM(time_spent_seconds),
            0
          ) AS total_seconds
        FROM user_quiz_attempts
        WHERE user_id = $1
      `,
        [userId]
      );

    const totalSeconds = Number(
      studyTimeResult.rows[0]
        ?.total_seconds || 0
    );

    const hoursLearned = (
      totalSeconds / 3600
    ).toFixed(1);

    /*
    =========================================
    RESPONSE
    =========================================
    */

    return res.status(200).json({
      success: true,
      data: {
        continue_learning:
          continueLearning,

        progress_summary: {
          courses_completed:
            coursesCompleted,
          certificates_earned:
            certificatesEarned,
          global_rank: globalRank,
        },

        cognitive_metrics: {
          efficiency,
          hours_learned:
            Number(hoursLearned),
        },
      },
    });
  } catch (error) {
    console.error(
      "getStudentDashboardOverview error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
};