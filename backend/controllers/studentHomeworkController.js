const pool = require("../config/db");
const { assignXP } = require("../services/xpService");


// ===============================
// ✅ GET STUDENT HOMEWORK LIST
// ===============================
exports.getStudentHomeworks = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({ message: "Student access required" });
    }

    const studentId = req.user.userId;
    console.log("Fetching homeworks for student ID:", studentId);

    const student = await pool.query(
      `SELECT class FROM user_academic_details WHERE user_id=$1`,
      [studentId]
    );

    const result = await pool.query(
      `SELECT 
        h.*,
        hs.status,
        hs.score,
        hs.evaluated_at,
        CASE 
          WHEN hs.status IS NULL THEN 'NOT_STARTED'
          WHEN hs.status = 'SUBMITTED' AND hs.evaluated_at IS NULL THEN 'PENDING_EVALUATION'
          WHEN hs.status = 'SUBMITTED' AND hs.evaluated_at IS NOT NULL THEN 'EVALUATED'
          ELSE hs.status
        END as evaluation_status
       FROM homeworks h
       LEFT JOIN homework_submissions hs 
       ON h.id = hs.homework_id AND hs.student_id=$1
       WHERE h.class=$2 AND h.is_published=true
       ORDER BY h.due_date ASC`,
      [studentId, student.rows[0].class]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ message: "Error fetching homeworks" });
  }
};



// ===============================
// ✅ GET HOMEWORK DETAIL
// ===============================
exports.getHomeworkDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({ message: "Student access required" });
    }

    const homeworkId = req.params.id;
    const studentId = req.user.userId;

    const hw = await pool.query(
      `SELECT class FROM homeworks WHERE id=$1`,
      [homeworkId]
    );

    const student = await pool.query(
      `SELECT class FROM user_academic_details WHERE user_id=$1`,
      [studentId]
    );

    if (hw.rows[0].class !== student.rows[0].class) {
      return res.status(403).json({ message: "Not allowed" });
    }

    let sub = await pool.query(
      `SELECT * FROM homework_submissions WHERE homework_id=$1 AND student_id=$2`,
      [homeworkId, studentId]
    );

    if (!sub.rows.length) {
      sub = await pool.query(
        `INSERT INTO homework_submissions (homework_id, student_id)
         VALUES ($1,$2) RETURNING *`,
        [homeworkId, studentId]
      );
    }

    const submission = sub.rows[0];

    const questions = await pool.query(
      `SELECT q.*, json_agg(o.*) as options
       FROM homework_questions q
       LEFT JOIN homework_options o ON q.id=o.question_id
       WHERE q.homework_id=$1
       GROUP BY q.id
       ORDER BY q.order_index`,
      [homeworkId]
    );

    const answers = await pool.query(
      `SELECT * FROM homework_answers WHERE submission_id=$1`,
      [submission.id]
    );

    const map = {};
    answers.rows.forEach(a => {
      map[a.question_id] = a.written_answer;
    });

    res.json({
      submission,
      evaluation_status: submission.evaluated_at ? "EVALUATED" : "PENDING",
      questions: questions.rows.map(q => ({
        ...q,
        answer: map[q.id] || null
      }))
    });

  } catch (err) {
    res.status(500).json({ message: "Error fetching homework" });
  }
};



// ===============================
// ✅ SAVE ANSWER
// ===============================
exports.saveAnswer = async (req, res) => {
  const { id } = req.params;
  const { question_id, answer } = req.body;

  if (!req.user) {
    return res.status(403).json({ message: "Student access required" });
  }

  const studentId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let sub = await client.query(
      `SELECT * FROM homework_submissions 
       WHERE homework_id=$1 AND student_id=$2`,
      [id, studentId]
    );

    if (sub.rows[0]?.status === "SUBMITTED") {
      throw new Error("Cannot modify after submission");
    }

    if (!sub.rows.length) {
      sub = await client.query(
        `INSERT INTO homework_submissions (homework_id, student_id, status)
         VALUES ($1,$2,'IN_PROGRESS') RETURNING *`,
        [id, studentId]
      );
    }

    await client.query(
      `INSERT INTO homework_answers (submission_id, question_id, written_answer)
       VALUES ($1,$2,$3)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET written_answer = EXCLUDED.written_answer`,
      [sub.rows[0].id, question_id, JSON.stringify(answer)]
    );

    await client.query("COMMIT");

    res.json({ message: "Answer saved" });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });

  } finally {
    client.release();
  }
};



// ===============================
// ✅ SUBMIT HOMEWORK (UPDATED)
// ===============================
exports.submitHomework = async (req, res) => {
  if (!req.user) {
    return res.status(403).json({ message: "Student access required" });
  }

  const { id } = req.params;
  const studentId = req.user.userId;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sub = await client.query(
      `SELECT * FROM homework_submissions 
       WHERE homework_id=$1 AND student_id=$2`,
      [id, studentId]
    );

    if (!sub.rows.length) throw new Error("No submission found");

    const submission = sub.rows[0];

    if (submission.status === "SUBMITTED") {
      throw new Error("Already submitted");
    }

    const answers = await client.query(
      `SELECT * FROM homework_answers WHERE submission_id=$1`,
      [submission.id]
    );

    let score = 0;

    for (let a of answers.rows) {
      const data = a.written_answer;

      // 🔥 Only MCQ evaluated here
      if (data?.type === "MCQ") {

        const correct = await client.query(
          `SELECT id FROM homework_options 
           WHERE question_id=$1 AND is_correct=true`,
          [a.question_id]
        );

        const q = await client.query(
          `SELECT points FROM homework_questions WHERE id=$1`,
          [a.question_id]
        );

        const marks = q.rows[0]?.points || 0;

        if (correct.rows[0]?.id === data.selected_option_id) {
          score += marks;

          await client.query(
            `UPDATE homework_answers
             SET marks_awarded=$1, is_correct=true
             WHERE id=$2`,
            [marks, a.id]
          );
        } else {
          await client.query(
            `UPDATE homework_answers
             SET marks_awarded=0, is_correct=false
             WHERE id=$1`,
            [a.id]
          );
        }

      } else {
        // WRITTEN / VOICE / FILE → pending grading
        await client.query(
          `UPDATE homework_answers
           SET marks_awarded=0
           WHERE id=$1`,
          [a.id]
        );
      }
    }

    await client.query(
      `UPDATE homework_submissions
       SET score=$1,
           status='SUBMITTED',
           submitted_at=NOW()
       WHERE id=$2`,
      [score, submission.id]
    );

    // 🔥 XP (for now on submit)
    const xp = await assignXP({
      userId: studentId,
      eventType: "HOMEWORK_SUBMIT",
      sourceId: submission.id
    });

    await client.query("COMMIT");

    res.json({
      message: "Submitted successfully",
      mcq_score: score,
      final_score: null,
      evaluation_status: "PENDING_EVALUATION",
      xp
    });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });

  } finally {
    client.release();
  }
};