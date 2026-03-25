const pool = require("../config/db");


// =========================
// 📘 SUBJECT CONTROLLERS
// =========================

exports.createSubject = async (req, res) => {
  try {
    const { name, icon } = req.body;

    const result = await pool.query(
      "INSERT INTO subjects (name, icon) VALUES ($1, $2) RETURNING *",
      [name, icon]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSubjects = async (req, res) => {
  const result = await pool.query("SELECT * FROM subjects");
  res.json(result.rows);
};


// =========================
// 📗 TOPIC CONTROLLERS
// =========================

exports.createTopic = async (req, res) => {
  try {
    let { subject_id, title, description, difficulty, order_index } = req.body;
    
    if (!order_index) {
      const result = await pool.query(
        `SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM topics WHERE subject_id = $1`,
        [subject_id]
      );
      order_index = result.rows[0].next_order;
    }

    const result = await pool.query(
      `INSERT INTO topics 
      (subject_id, title, description, difficulty, order_index) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [subject_id, title, description, difficulty, order_index]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTopicsBySubject = async (req, res) => {
  const { subject_id } = req.params;

  const result = await pool.query(
    "SELECT * FROM topics WHERE subject_id = $1 ORDER BY order_index",
    [subject_id]
  );

  res.json(result.rows);
};


// =========================
// 🎥 VIDEO CONTROLLER
// =========================

exports.addVideo = async (req, res) => {
  try {
    const { topic_id, youtube_video_id, duration} = req.body;

    const result = await pool.query(
      `INSERT INTO topic_videos (topic_id, youtube_video_id, duration)
       VALUES ($1, $2, $3) RETURNING *`,
      [topic_id, youtube_video_id, duration]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVideoByTopicId = async (req, res) => {
  try {
    const { topic_id } = req.params;

    const result = await pool.query(
      "SELECT * FROM topic_videos WHERE topic_id = $1",
      [topic_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// 🧠 QUIZ CONTROLLERS
// =========================

exports.createQuiz = async (req, res) => {
  try {
    const { topic_id, title } = req.body;

    const result = await pool.query(
      "INSERT INTO quizzes (topic_id, title) VALUES ($1, $2) RETURNING *",
      [topic_id, title]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getQuizByTopicId = async (req, res) => {
  try {
    const { topic_id } = req.params;

    const result = await pool.query(
      "SELECT * FROM quizzes WHERE topic_id = $1",
      [topic_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// =========================
// ❓ QUESTION + OPTIONS
// =========================

exports.addQuestion = async (req, res) => {
  try {
    const { quiz_id, question_text, question_type, options } = req.body;

    // Insert Question
    const question = await pool.query(
      `INSERT INTO quiz_questions (quiz_id, question_text, question_type)
       VALUES ($1, $2, $3) RETURNING *`,
      [quiz_id, question_text, question_type]
    );

    const question_id = question.rows[0].id;

    // Insert Options
    for (let opt of options) {
      await pool.query(
        `INSERT INTO quiz_options (question_id, option_text, is_correct)
         VALUES ($1, $2, $3)`,
        [question_id, opt.text, opt.is_correct]
      );
    }

    res.json({ message: "Question added successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getQuestionByQuizId = async (req, res) => {
  try {
    const { quiz_id } = req.params;

    const result = await pool.query(
      `SELECT qq.*, 
              json_agg(json_build_object('id', qo.id, 'option_text', qo.option_text, 'is_correct', qo.is_correct)) AS options
       FROM quiz_questions qq
       LEFT JOIN quiz_options qo ON qq.id = qo.question_id
       WHERE qq.quiz_id = $1
       GROUP BY qq.id
       ORDER BY qq.id`,
      [quiz_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// 🎯 QUIZ SUBMISSION
// =========================

exports.submitQuiz = async (req, res) => {
  try {
    const { answers } = req.body;
    const user_id = 1;
    const { quiz_id } = req.params;

    let correct = 0;

    for (let ans of answers) {
      const correctOptions = await pool.query(
        `SELECT id FROM quiz_options 
         WHERE question_id = $1 AND is_correct = true`,
        [ans.question_id]
      );

      const correctIds = correctOptions.rows.map(o => o.id).sort();
      const selectedIds = ans.selected_option_ids.sort();

      const isCorrect =
        JSON.stringify(correctIds) === JSON.stringify(selectedIds);

      if (isCorrect) correct++;
    }

    const totalQuestions = answers.length;
    const score = (correct / totalQuestions) * 100;

    // Get topic_id
    const quiz = await pool.query(
      "SELECT topic_id, passing_score FROM quizzes WHERE id = $1",
      [quiz_id]
    );

    const topic_id = quiz.rows[0].topic_id;
    const passing_score = quiz.rows[0].passing_score;

    const passed = score >= passing_score;

    // Update Progress
    await pool.query(
      `INSERT INTO user_topic_progress 
       (user_id, topic_id, quiz_completed, quiz_score, completed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, topic_id)
       DO UPDATE SET
         quiz_completed = $3,
         quiz_score = $4,
         completed_at = NOW()`,
      [user_id, topic_id, passed, score]
    );

    res.json({
      score,
      passed
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.checkAnswer = async (req, res) => {
  try {
    const { answers } = req.body;

    if (
      !answers ||
      !answers.question_id ||
      !Array.isArray(answers.selected_option_ids)
    ) {
      return res.status(400).json({
        error: "Invalid payload"
      });
    }

    const { question_id, selected_option_ids } = answers;

    // ✅ Fetch ALL options (not just correct ones)
    const optionsRes = await pool.query(
      `SELECT id, is_correct FROM quiz_options 
       WHERE question_id = $1`,
      [question_id]
    );

    if (!optionsRes.rows.length) {
      return res.status(404).json({
        error: "Question not found"
      });
    }

    const options = optionsRes.rows;

    const selectedSet = new Set(selected_option_ids);

    // ✅ Build feedback per option
    const options_feedback = options.map(opt => ({
      option_id: opt.id,
      is_correct: opt.is_correct,
      selected: selectedSet.has(opt.id)
    }));

    // ✅ Determine overall correctness
    const correctIds = options
      .filter(o => o.is_correct)
      .map(o => o.id)
      .sort();

    const selectedIds = [...selected_option_ids].sort();

    const isCorrect =
      JSON.stringify(correctIds) === JSON.stringify(selectedIds);

    res.json({
      correct: isCorrect,
      options_feedback
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// =========================
// 📡 FULL COURSE FETCH
// =========================

exports.getFullCourse = async (req, res) => {
  try {
    const { subject_id } = req.params;

    const subject = await pool.query(
      "SELECT * FROM subjects WHERE id = $1",
      [subject_id]
    );

    const topics = await pool.query(
      "SELECT * FROM topics WHERE subject_id = $1 ORDER BY order_index",
      [subject_id]
    );

    const result = [];

    for (let topic of topics.rows) {
      const video = await pool.query(
        "SELECT * FROM topic_videos WHERE topic_id = $1",
        [topic.id]
      );

      const quiz = await pool.query(
        "SELECT * FROM quizzes WHERE topic_id = $1",
        [topic.id]
      );

      let questions = [];

      if (quiz.rows.length) {
        const q = await pool.query(
          "SELECT * FROM quiz_questions WHERE quiz_id = $1",
          [quiz.rows[0].id]
        );

        for (let ques of q.rows) {
          const options = await pool.query(
            "SELECT * FROM quiz_options WHERE question_id = $1",
            [ques.id]
          );

          questions.push({
            ...ques,
            options: options.rows
          });
        }
      }

      result.push({
        topic,
        video: video.rows[0],
        quiz: {
          ...quiz.rows[0],
          questions
        }
      });
    }

    res.json({
      subject: subject.rows[0],
      topics: result
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

