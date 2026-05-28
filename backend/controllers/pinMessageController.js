const pool = require("../config/db");


exports.createPinnedMessage = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher access required",
      });
    }

    const teacher_id = req.teacher.teacherId;
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required",
      });
    }

    await pool.query(
      `
      UPDATE teacher_pinned_messages
      SET
        is_active = false,
        updated_at = NOW()
      WHERE teacher_id = $1
      AND is_active = true
      `,
      [teacher_id]
    );

    const result = await pool.query(
      `
      INSERT INTO teacher_pinned_messages
      (
        teacher_id,
        title,
        message,
        is_active
      )
      VALUES ($1, $2, $3, true)
      RETURNING *
      `,
      [teacher_id, title, message]
    );

    return res.status(201).json({
      success: true,
      message: "Pinned message created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("createPinnedMessage error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


exports.getStudentPinnedMessages = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const studentId = req.user.userId;

    /*
    -----------------------------------------
    GET STUDENT CLASS
    -----------------------------------------
    */
    const studentResult = await pool.query(
      `
      SELECT class
      FROM user_academic_details
      WHERE user_id = $1
      LIMIT 1
      `,
      [studentId]
    );

    if (!studentResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Student academic details not found",
      });
    }

    const studentClass = studentResult.rows[0].class;

    /*
    -----------------------------------------
    GET ONLY CLASS MATCHING PINNED MESSAGES
    -----------------------------------------
    */
    const result = await pool.query(
      `
      SELECT
        pm.id,
        pm.title,
        pm.message,
        pm.created_at,

        t.id AS teacher_id,
        t.first_name,
        t.last_name

      FROM teacher_pinned_messages pm

      INNER JOIN teachers t
        ON t.id = pm.teacher_id

      WHERE
        pm.is_active = true
        AND $1 = ANY(t.classes)

      ORDER BY pm.created_at ASC
      `,
      [studentClass]
    );

    const messages = result.rows.map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      created_at: item.created_at,
      teacher_id: item.teacher_id,
      teacher_name: `${item.first_name} ${item.last_name}`,
    }));

    return res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });

  } catch (error) {
    console.error("getStudentPinnedMessages error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// exports.getStudentPinnedMessages = async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(403).json({
//         success: false,
//         message: "Student access required",
//       });
//     }

//     const studentId = req.user.userId;

//     const result = await pool.query(
//       `
//       SELECT
//         pm.id,
//         pm.title,
//         pm.message,
//         pm.created_at,

//         t.id as teacher_id,
//         t.first_name,
//         t.last_name

//       FROM teacher_pinned_messages pm
//       INNER JOIN teachers t
//         ON t.id = pm.teacher_id

//       WHERE pm.is_active = true

//       ORDER BY pm.created_at ASC
//       `
//     );

//     const messages = result.rows.map((item) => ({
//       id: item.id,
//       title: item.title,
//       message: item.message,
//       created_at: item.created_at,
//       teacher_id: item.teacher_id,
//       teacher_name: `${item.first_name} ${item.last_name}`,
//     }));

//     return res.status(200).json({
//       success: true,
//       count: messages.length,
//       data: messages,
//     });
//   } catch (error) {
//     console.error("getStudentPinnedMessages error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };