const pool = require("../config/db");

exports.getTeacherDashboardAnalytics = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher access required",
      });
    }

    const teacherId = req.teacher.teacherId;

    /*
    -----------------------------------------
    GET TEACHER
    -----------------------------------------
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

    const teacherClasses =
      teacherResult.rows[0].classes || [];

    const teacherSubjects =
      teacherResult.rows[0].subjects || [];

    /*
    -----------------------------------------
    GET STUDENTS
    -----------------------------------------
    */
    const studentsResult = await pool.query(
      `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.profile_picture,
        uad.class,

        us.last_active_date,
        us.current_streak,

        COALESCE(
          AVG(uqp.latest_score),
          0
        ) AS avg_score,

        COALESCE(
          SUM(uqa.time_spent_seconds),
          0
        ) AS total_time_seconds

      FROM user_academic_details uad

      INNER JOIN users u
        ON u.id = uad.user_id

      LEFT JOIN user_stats us
        ON us.user_id = u.id

      LEFT JOIN user_quiz_progress uqp
        ON uqp.user_id = u.id

      LEFT JOIN user_quiz_attempts uqa
        ON uqa.user_id = u.id

      WHERE
        uad.class = ANY($1)

      GROUP BY
        u.id,
        u.first_name,
        u.last_name,
        u.profile_picture,
        uad.class,
        us.last_active_date,
        us.current_streak

      ORDER BY u.first_name ASC
      `,
      [teacherClasses]
    );

    const students = studentsResult.rows;

    /*
    -----------------------------------------
    SUMMARY
    -----------------------------------------
    */
    const totalStudents = students.length;

    const activeToday = students.filter(
      (student) =>
        student.last_active_date &&
        new Date(student.last_active_date)
          .toDateString() ===
          new Date().toDateString()
    ).length;

    const avgScore =
      totalStudents > 0
        ? Math.round(
            students.reduce(
              (sum, student) =>
                sum +
                Number(student.avg_score || 0),
              0
            ) / totalStudents
          )
        : 0;

    /*
    -----------------------------------------
    AT RISK
    inactive > 3 OR avg_score < 60
    -----------------------------------------
    */
    const atRiskCount = students.filter(
      (student) => {
        const daysInactive =
          student.last_active_date
            ? Math.floor(
                (new Date() -
                  new Date(
                    student.last_active_date
                  )) /
                  (1000 * 60 * 60 * 24)
              )
            : 999;

        return (
          daysInactive >= 3 ||
          Number(student.avg_score) < 60
        );
      }
    ).length;

    /*
    -----------------------------------------
    WEEKLY ENGAGEMENT
    -----------------------------------------
    */
    const weekDays = [
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ];

    const weeklyEngagement = weekDays.map(
      (day) => ({
        day,
        active: 0,
        inactive: 0,
      })
    );

    students.forEach((student) => {
      if (!student.last_active_date) return;

      const d = new Date(
        student.last_active_date
      );

      const dayIndex =
        d.getDay() === 0
          ? 6
          : d.getDay() - 1;

      weeklyEngagement[dayIndex].active += 1;
    });

    weeklyEngagement.forEach((item) => {
      item.inactive =
        totalStudents - item.active;
    });

    /*
    -----------------------------------------
    STUDENT ROSTER
    -----------------------------------------
    */
    const studentData = students.map(
      (student) => {
        const daysInactive =
          student.last_active_date
            ? Math.floor(
                (new Date() -
                  new Date(
                    student.last_active_date
                  )) /
                  (1000 * 60 * 60 * 24)
              )
            : 999;

        let status = "inactive";

        if (daysInactive === 0) {
          status = "active";
        }

        let riskLevel = "low";

        if (
          daysInactive >= 5 &&
          Number(student.avg_score) < 50
        ) {
          riskLevel = "critical";
        } else if (
          daysInactive >= 3 ||
          Number(student.avg_score) < 60
        ) {
          riskLevel = "high";
        } else if (
          Number(student.avg_score) < 75
        ) {
          riskLevel = "medium";
        }

        return {
          user_id: student.id,
          student_name: `${student.first_name} ${student.last_name}`,
          profile_picture:
            student.profile_picture,
          class: student.class,
          status,
          last_active_date:
            student.last_active_date,
          streak:
            student.current_streak || 0,
          avg_score: Math.round(
            Number(student.avg_score || 0)
          ),
          time_hours: Math.round(
            Number(
              student.total_time_seconds || 0
            ) / 3600
          ),
          risk_level: riskLevel,
        };
      }
    );

    /*
    -----------------------------------------
    SUBJECT PERFORMANCE
    -----------------------------------------
    */
    const subjectPerformanceResult = await pool.query(
  `
  SELECT
    s.id AS subject_id,
    s.name AS subject_name,

    COALESCE(
      MAX(uqp.latest_score),
      0
    ) AS top_score,

    COALESCE(
      ROUND(AVG(uqp.latest_score)),
      0
    ) AS avg_score,

    COALESCE(
      MIN(uqp.latest_score),
      0
    ) AS bottom_score

  FROM subjects s

  INNER JOIN topics t
    ON t.subject_id = s.id

  INNER JOIN user_quiz_progress uqp
    ON uqp.topic_id = t.id

  INNER JOIN user_academic_details uad
    ON uad.user_id = uqp.user_id

  WHERE
    uad.class = ANY($1)

    AND LOWER(TRIM(s.name)) IN (
      SELECT LOWER(
        TRIM(
          unnest($2::text[])
        )
      )
    )

  GROUP BY
    s.id,
    s.name

  ORDER BY s.name ASC
  `,
  [teacherClasses, teacherSubjects]
);

    const subjectPerformance =
      subjectPerformanceResult.rows.map(
        (row) => ({
          subject_id: row.subject_id,
          subject_name:
            row.subject_name,
          top_score: Number(
            row.top_score || 0
          ),
          avg_score: Number(
            row.avg_score || 0
          ),
          bottom_score: Number(
            row.bottom_score || 0
          ),
        })
      );

    /*
    -----------------------------------------
    RESPONSE
    -----------------------------------------
    */
    return res.status(200).json({
      success: true,
      data: {
        summary: {
          total_students:
            totalStudents,
          active_today: activeToday,
          at_risk: atRiskCount,
          avg_score: avgScore,
        },
        weekly_engagement:
          weeklyEngagement,
        students: studentData,
        subject_performance:
          subjectPerformance,
      },
    });

  } catch (error) {
    console.error(
      "getTeacherDashboardAnalytics error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
};