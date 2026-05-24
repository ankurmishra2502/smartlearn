const db = require("../config/db");

const CERTIFIED_THRESHOLD = 85;

const getCertificatesService = async (userId) => {
  try {
    /*
    ---------------------------------------
    Fetch all active subjects
    ---------------------------------------
    */
    const subjectQuery = `
      SELECT id, name, icon
      FROM subjects
      ORDER BY id
    `;

    const subjectsRes = await db.query(subjectQuery);
    const subjects = subjectsRes.rows;

    const subjectCards = [];

    let certifiedCount = 0;
    let pendingCount = 0;
    let totalCompletedTopics = 0;

    for (const subject of subjects) {
      /*
      ---------------------------------------
      Total topics in subject
      ---------------------------------------
      */
      const topicsRes = await db.query(
        `
        SELECT id, title
        FROM topics
        WHERE subject_id = $1
        AND is_active = true
        `,
        [subject.id]
      );

      const topics = topicsRes.rows;
      const totalTopics = topics.length;

      let completedTopics = 0;

      /*
      ---------------------------------------
      Check topic completion
      Reusing your existing topic logic
      ---------------------------------------
      */
      for (const topic of topics) {
        const topicCheck = await db.query(
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

        const total = Number(
          topicCheck.rows[0]?.total || 0
        );

        const passed = Number(
          topicCheck.rows[0]?.passed || 0
        );

        const topicCompleted =
          total > 0 && total === passed;

        if (topicCompleted) {
          completedTopics++;
        }
      }

      /*
      ---------------------------------------
      Progress %
      ---------------------------------------
      */
      const progressPercent =
        totalTopics > 0
          ? Math.round(
              (completedTopics / totalTopics) *
                100
            )
          : 0;

      /*
      ---------------------------------------
      Subject score for grade
      ---------------------------------------
      */
      const scoreRes = await db.query(
        `
        SELECT
          COALESCE(
            ROUND(AVG(uqp.latest_score)::numeric, 0),
            0
          ) AS avg_score
        FROM user_quiz_progress uqp
        JOIN topics t
          ON t.id = uqp.topic_id
        WHERE uqp.user_id = $1
        AND t.subject_id = $2
        `,
        [userId, subject.id]
      );

      const avgScore = Number(
        scoreRes.rows[0]?.avg_score || 0
      );

      /*
      ---------------------------------------
      Status
      ---------------------------------------
      */
      const certified =
        progressPercent >= CERTIFIED_THRESHOLD;

      if (certified) {
        certifiedCount++;
      } else {
        pendingCount++;
      }

      totalCompletedTopics += completedTopics;

      /*
      ---------------------------------------
      Grade
      ---------------------------------------
      */
      let grade = null;

      if (certified) {
        if (avgScore >= 95) grade = "A+";
        else if (avgScore >= 85) grade = "A";
        else if (avgScore >= 75) grade = "B+";
        else if (avgScore >= 65) grade = "B";
        else grade = "C";
      }

      subjectCards.push({
        subject_id: subject.id,
        subject_name: subject.name,
        icon: subject.icon,

        completed_topics: completedTopics,
        total_topics: totalTopics,

        progress_percent: progressPercent,

        status: certified
          ? "certified"
          : "pending",

        grade,

        remaining_topics:
          totalTopics - completedTopics
      });
    }

    return {
      summary: {
        certified: certifiedCount,
        pending: pendingCount,
        topics_completed:
          totalCompletedTopics
      },

      certificates: subjectCards
    };

  } catch (error) {
    console.error(
      "Certificate analytics error:",
      error
    );
    throw error;
  }
};

module.exports = {
  getCertificatesService
};