const pool = require("../config/db");


// ===============================
// ✅ CREATE HOMEWORK
// ===============================
exports.createHomework = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({ message: "Teacher access required" });
    }

    const { title, subject, classId, deadline } = req.body;

    const result = await pool.query(
      `INSERT INTO homeworks 
       (title, subject, class, due_date, teacher_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [title, subject, classId, deadline, req.teacher.teacherId]
    );

    res.json(result.rows[0]);

  } catch {
    res.status(500).json({ message: "Error creating homework" });
  }
};



// ===============================
// ✅ ADD QUESTION
// ===============================
exports.addQuestion = async (req, res) => {
  const homeworkId = req.params.id;
  const { question, type, points, options, question_meta } = req.body;

  if (!req.teacher) {
    return res.status(403).json({ message: "Teacher access required" });
  }

  const allowedTypes = ["MCQ", "WRITTEN", "VOICE", "FILE"];

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ message: "Invalid question type" });
  }

  if (!question || !question.trim()) {
    return res.status(400).json({ message: "Question required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT teacher_id FROM homeworks WHERE id=$1`,
      [homeworkId]
    );

    if (!check.rows.length) throw new Error("Homework not found");

    if (check.rows[0].teacher_id !== req.teacher.teacherId) {
      throw new Error("Unauthorized");
    }

    const q = await client.query(
      `INSERT INTO homework_questions
      (homework_id, question, type, points, question_meta, order_index)
      VALUES (
        $1,$2,$3,$4,$5,
        (SELECT COALESCE(MAX(order_index),0)+1 FROM homework_questions WHERE homework_id=$1)
      )
      RETURNING *`,
      [
        homeworkId,
        question.trim(),
        type,
        points || 10,
        question_meta || null
      ]
    );

    const questionId = q.rows[0].id;

    // MCQ
    if (type === "MCQ") {
      if (!options || options.length < 2) {
        throw new Error("MCQ needs options");
      }

      const correct = options.filter(o => o.is_correct);
      if (correct.length !== 1) {
        throw new Error("One correct option required");
      }

      for (let opt of options) {
        await client.query(
          `INSERT INTO homework_options (question_id, option_text, is_correct)
           VALUES ($1,$2,$3)`,
          [questionId, opt.text, opt.is_correct]
        );
      }
    }

    await client.query(
      `UPDATE homeworks
       SET total_questions = total_questions + 1,
           total_points = total_points + $2
       WHERE id=$1`,
      [homeworkId, points || 10]
    );

    await client.query("COMMIT");

    res.json({ message: "Question added", questionId });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });

  } finally {
    client.release();
  }
};



// ===============================
// ✅ PUBLISH
// ===============================
exports.publishHomework = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({ message: "Teacher access required" });
    }

    const homeworkId = req.params.id;

    const check = await pool.query(
      `SELECT teacher_id, total_questions FROM homeworks WHERE id=$1`,
      [homeworkId]
    );

    if (!check.rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    if (check.rows[0].teacher_id !== req.teacher.teacherId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (check.rows[0].total_questions === 0) {
      return res.status(400).json({ message: "Add questions first" });
    }

    await pool.query(
      `UPDATE homeworks SET is_published = true WHERE id=$1`,
      [homeworkId]
    );

    res.json({ message: "Published" });

  } catch {
    res.status(500).json({ message: "Error publishing" });
  }
};



// ===============================
// ✅ GET SUBMISSIONS
// ===============================
exports.getHomeworkSubmissions = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({ message: "Teacher access required" });
    }

    const homeworkId = req.params.id;

    const result = await pool.query(
      `SELECT 
        hs.id as submission_id,
        hs.status,
        hs.score,
        hs.submitted_at,
        u.first_name,
        u.last_name
       FROM homework_submissions hs
       JOIN users u ON u.id = hs.student_id
       WHERE hs.homework_id = $1
       ORDER BY hs.submitted_at DESC`,
      [homeworkId]
    );

    res.json(result.rows);

  } catch {
    res.status(500).json({ message: "Error fetching submissions" });
  }
};



// ===============================
// ✅ GET SUBMISSION DETAIL
// ===============================
exports.getSubmissionDetail = async (req, res) => {
  try {
    if (!req.teacher) {
      return res.status(403).json({ message: "Teacher access required" });
    }

    const submissionId = req.params.id;

    const sub = await pool.query(
      `SELECT hs.*, h.teacher_id
       FROM homework_submissions hs
       JOIN homeworks h ON h.id = hs.homework_id
       WHERE hs.id=$1`,
      [submissionId]
    );

    if (!sub.rows.length) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (sub.rows[0].teacher_id !== req.teacher.teacherId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const questions = await pool.query(
      `SELECT 
        q.id,
        q.question,
        q.type,
        q.points,
        a.written_answer,
        a.marks_awarded,
        a.is_correct
       FROM homework_questions q
       LEFT JOIN homework_answers a
         ON a.question_id = q.id
        AND a.submission_id = $1
       WHERE q.homework_id = $2
       ORDER BY q.order_index`,
      [submissionId, sub.rows[0].homework_id]
    );

    res.json({
      submission: sub.rows[0],
      questions: questions.rows.map(q => ({
        ...q,
        evaluation_status:
          q.type === "MCQ"
            ? "AUTO_EVALUATED"
            : q.marks_awarded === null
            ? "PENDING"
            : "GRADED"
      }))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching submission" });
  }
};


// ===============================
// ✅ GRADE SUBMISSION
// ===============================
exports.gradeSubmission = async (req, res) => {
  const submissionId = req.params.id;
  const { grades } = req.body;

  if (!req.teacher) {
    return res.status(403).json({ message: "Teacher access required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sub = await client.query(
      `SELECT hs.*, h.teacher_id
       FROM homework_submissions hs
       JOIN homeworks h ON h.id = hs.homework_id
       WHERE hs.id=$1`,
      [submissionId]
    );

    if (!sub.rows.length) throw new Error("Submission not found");

    if (sub.rows[0].teacher_id !== req.teacher.teacherId) {
      throw new Error("Unauthorized");
    }

    // 🔥 update each grade
    for (let g of grades) {

      // get max marks
      const q = await client.query(
        `SELECT points FROM homework_questions WHERE id=$1`,
        [g.question_id]
      );

      if (!q.rows.length) continue;

      const maxMarks = q.rows[0].points;

      if (g.marks > maxMarks) {
        throw new Error(`Marks exceed limit for question ${g.question_id}`);
      }

      await client.query(
        `UPDATE homework_answers
         SET marks_awarded = $1
         WHERE submission_id = $2 AND question_id = $3`,
        [g.marks, submissionId, g.question_id]
      );
    }

    // 🔥 recompute total
    const total = await client.query(
      `SELECT COALESCE(SUM(marks_awarded),0) as total
       FROM homework_answers
       WHERE submission_id=$1`,
      [submissionId]
    );

    const finalScore = Number(total.rows[0].total);

    await client.query(
      `UPDATE homework_submissions
       SET score = $1,
           evaluated_at = NOW()
       WHERE id = $2`,
      [finalScore, submissionId]
    );

    await client.query("COMMIT");

    res.json({
      message: "Graded",
      score: finalScore
    });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });

  } finally {
    client.release();
  }
};