const pool = require("../config/db");

/* =========================================================================
   GET TEACHER ALERTS
========================================================================= */
exports.getTeacherAlerts = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher access required",
      });
    }

    const teacherId = req.teacher.teacherId;

    /*
    --------------------------------------------------
    GET TEACHER
    --------------------------------------------------
    */
    const teacherResult = await pool.query(
      `
      SELECT classes, subjects
      FROM teachers
      WHERE id = $1
      LIMIT 1
      `,
      [teacherId]
    );

    if (!teacherResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const teacherClasses = teacherResult.rows[0].classes || [];
    const teacherSubjects = teacherResult.rows[0].subjects || [];

    /*
    --------------------------------------------------
    GET ALERT UI STATE
    teacher_alerts stores:
    dismissed / reminded
    --------------------------------------------------
    */
    const alertStateResult = await pool.query(
      `
      SELECT
        student_id,
        alert_type,
        quiz_id,
        status
      FROM teacher_alerts
      WHERE teacher_id = $1
      `,
      [teacherId]
    );

    const dismissedSet = new Set();
    const remindedSet = new Set();

    alertStateResult.rows.forEach((row) => {
      const key =
        `${row.student_id}_${row.alert_type}_${row.quiz_id || "null"}`;

      if (row.status === "dismissed") {
        dismissedSet.add(key);
      }

      if (row.status === "reminded") {
        remindedSet.add(key);
      }
    });

    /*
    --------------------------------------------------
    INACTIVE ALERTS
    CLASS ONLY
    --------------------------------------------------
    */
    const inactiveResult = await pool.query(
      `
      SELECT
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.profile_picture,
        uad.class,

        us.last_active_date,
        CURRENT_DATE - us.last_active_date AS days_inactive

      FROM user_academic_details uad

      INNER JOIN users u
        ON u.id = uad.user_id

      INNER JOIN user_stats us
        ON us.user_id = u.id

      WHERE
        uad.class = ANY($1)
        AND us.last_active_date <= CURRENT_DATE - INTERVAL '3 days'

      ORDER BY us.last_active_date ASC
      `,
      [teacherClasses]
    );

    /*
    --------------------------------------------------
    FAILED TWICE ALERTS
    using:
    user_quiz_attempts + user_quiz_progress
    --------------------------------------------------
    */
    const failedResult = await pool.query(
      `
      WITH failed_attempts AS (
        SELECT
          user_id,
          quiz_id,
          COUNT(*) AS failed_attempt_count,
          MAX(attempt_date) AS last_attempt_date

        FROM user_quiz_attempts

        WHERE passed = false

        GROUP BY user_id, quiz_id

        HAVING COUNT(*) >= 2
      )

      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.profile_picture,

        uad.class,

        s.name AS subject_name,
        t.title AS topic_title,
        q.title AS quiz_title,
        q.id AS quiz_id,

        fa.failed_attempt_count,
        fa.last_attempt_date

      FROM failed_attempts fa

      INNER JOIN user_quiz_progress uqp
        ON uqp.user_id = fa.user_id
       AND uqp.quiz_id = fa.quiz_id

      INNER JOIN quizzes q
        ON q.id = fa.quiz_id

      INNER JOIN topics t
        ON t.id = q.topic_id

      INNER JOIN subjects s
        ON s.id = t.subject_id

      INNER JOIN users u
        ON u.id = fa.user_id

      INNER JOIN user_academic_details uad
        ON uad.user_id = u.id

      WHERE
        uqp.passed = false
        AND uad.class = ANY($1)
        AND LOWER(s.name) = ANY (
          SELECT LOWER(unnest($2::text[]))
        )

      ORDER BY fa.last_attempt_date DESC
      `,
      [teacherClasses, teacherSubjects]
    );

    /*
    --------------------------------------------------
    FORMAT INACTIVE
    --------------------------------------------------
    */
    const inactiveAlerts = inactiveResult.rows
      .map((row) => {
        const key =
          `${row.user_id}_inactive_null`;

        return {
          type: "inactive",
          user_id: row.user_id,
          student_name:
            `${row.first_name} ${row.last_name}`,
          profile_picture: row.profile_picture,
          class: row.class,
          days_inactive: Number(row.days_inactive),
          last_active_date: row.last_active_date,
          is_reminded: remindedSet.has(key),
          quiz_id: null,
        };
      })
      .filter(
        (row) =>
          !dismissedSet.has(
            `${row.user_id}_inactive_null`
          )
      );

    /*
    --------------------------------------------------
    FORMAT FAILED
    --------------------------------------------------
    */
    const failedAlerts = failedResult.rows
      .map((row) => {
        const key =
          `${row.user_id}_failed_twice_${row.quiz_id}`;

        return {
          type: "failed_twice",
          user_id: row.user_id,
          student_name:
            `${row.first_name} ${row.last_name}`,
          profile_picture: row.profile_picture,
          class: row.class,
          subject_name: row.subject_name,
          topic_title: row.topic_title,
          quiz_title: row.quiz_title,
          quiz_id: row.quiz_id,
          failed_attempt_count:
            Number(row.failed_attempt_count),
          last_attempt_date: row.last_attempt_date,
          is_reminded: remindedSet.has(key),
        };
      })
      .filter(
        (row) =>
          !dismissedSet.has(
            `${row.user_id}_failed_twice_${row.quiz_id}`
          )
      );

    /*
    --------------------------------------------------
    MERGE
    --------------------------------------------------
    */
    const alerts = [
      ...inactiveAlerts,
      ...failedAlerts,
    ];

    return res.status(200).json({
      success: true,
      summary: {
        total_alerts: alerts.length,
        inactive_count: inactiveAlerts.length,
        failed_twice_count: failedAlerts.length,
      },
      alerts,
    });

  } catch (error) {
    console.error("getTeacherAlerts error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


/* =========================================================================
   REMIND ALERT
========================================================================= */
// exports.remindAlert = async (req, res) => {
//   try {
//     const teacherId = req.teacher.teacherId;

//     const {
//       student_id,
//       alert_type,
//       quiz_id = null,
//     } = req.body;

//     await pool.query(
//       `
//       INSERT INTO teacher_alerts (
//         teacher_id,
//         student_id,
//         alert_type,
//         quiz_id,
//         status,
//         created_at,
//         updated_at
//       )
//       VALUES (
//         $1, $2, $3, $4,
//         'reminded',
//         NOW(),
//         NOW()
//       )
//       ON CONFLICT DO NOTHING
//       `,
//       [
//         teacherId,
//         student_id,
//         alert_type,
//         quiz_id,
//       ]
//     );

//     return res.status(200).json({
//       success: true,
//       message: "Reminder saved successfully",
//     });

//   } catch (error) {
//     console.error("remindAlert error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

exports.remindAlert = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher access required",
      });
    }

    const teacherId = req.teacher.teacherId;

    const {
      student_id,
      alert_type,
      quiz_id = null,
    } = req.body;

    if (!student_id || !alert_type) {
      return res.status(400).json({
        success: false,
        message: "student_id and alert_type are required",
      });
    }

    /*
    -----------------------------------------
    UPDATE teacher alert status
    -----------------------------------------
    */
    await pool.query(
      `
      INSERT INTO teacher_alerts (
        teacher_id,
        student_id,
        alert_type,
        quiz_id,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'reminded',
        NOW(),
        NOW()
      )
      ON CONFLICT (teacher_id, student_id, alert_type, quiz_id)
      DO UPDATE SET
        status = 'reminded',
        updated_at = NOW()
      `,
      [
        teacherId,
        student_id,
        alert_type,
        quiz_id,
      ]
    );

    /*
    -----------------------------------------
    Build notification
    -----------------------------------------
    */
    let title = "";
    let message = "";

    if (alert_type === "inactive") {
      title = "Your teacher sent you a reminder";
      message =
        "You’ve been inactive recently. Continue learning and stay on track.";
    }

    if (alert_type === "failed_twice") {
      const quizResult = await pool.query(
        `
        SELECT title
        FROM quizzes
        WHERE id = $1
        LIMIT 1
        `,
        [quiz_id]
      );

      const quizTitle =
        quizResult.rows[0]?.title || "your quiz";

      title = "Quiz Retry Reminder";
      message = `Your teacher asked you to retry ${quizTitle}.`;
    }

    /*
    -----------------------------------------
    CREATE student notification
    -----------------------------------------
    */
    await pool.query(
      `
      INSERT INTO student_notifications
      (
        user_id,
        teacher_id,
        type,
        title,
        message,
        reference_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      `,
      [
        student_id,
        teacherId,
        "teacher_reminder",
        title,
        message,
        quiz_id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Reminder sent successfully",
    });

  } catch (error) {
    console.error("remindAlert error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
/* =========================================================================
   DISMISS ALERT
========================================================================= */
exports.dismissAlert = async (req, res) => {
  try {
    const teacherId = req.teacher.teacherId;

    const {
      student_id,
      alert_type,
      quiz_id = null,
    } = req.body;

    await pool.query(
      `
      INSERT INTO teacher_alerts (
        teacher_id,
        student_id,
        alert_type,
        quiz_id,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4,
        'dismissed',
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
      `,
      [
        teacherId,
        student_id,
        alert_type,
        quiz_id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Alert dismissed successfully",
    });

  } catch (error) {
    console.error("dismissAlert error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};