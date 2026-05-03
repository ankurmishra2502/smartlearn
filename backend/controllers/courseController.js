const pool = require("../config/db");
const xpService = require("../services/xpService");
const { updateSubjectStreak } = require("../services/streakService"); 
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
  const Subresult = await pool.query("SELECT * FROM subjects");
  const topicResult = await pool.query("SELECT * FROM topics");
  const subjects = Subresult.rows;
    const topics = topicResult.rows;

    // ✅ 3. Map topics to subjects
    const subjectMap = {};

    subjects.forEach(sub => {
      subjectMap[sub.id] = {
        ...sub,
        topics: []
      };
    });

    topics.forEach(topic => {
      if (subjectMap[topic.subject_id]) {
        subjectMap[topic.subject_id].topics.push(topic);
      }
    });

    // ✅ 4. Final array
    const result = Object.values(subjectMap);

    res.json(result);
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

// exports.createQuiz = async (req, res) => {
//   try {
//     const { topic_id, title } = req.body;

//     const result = await pool.query(
//       "INSERT INTO quizzes (topic_id, title) VALUES ($1, $2) RETURNING *",
//       [topic_id, title]
//     );

//     res.json(result.rows[0]);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };
exports.createQuiz = async (req, res) => {
  try {
    const {
      topic_id,
      title,
      difficulty,
      passing_score
    } = req.body;

    let xp_reward;
    if (difficulty === 'easy') xp_reward = 50;
    else if (difficulty === 'medium') xp_reward = 100;
    else if (difficulty === 'hard') xp_reward = 150;
    else xp_reward = 50; // default
    
    let max_attempts_per_day = 3; // default
    const result = await pool.query(
      `INSERT INTO quizzes 
       (topic_id, title, difficulty, passing_score, xp_reward, max_attempts_per_day)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        topic_id,
        title,
        difficulty,
        passing_score || 50,
        xp_reward,
        max_attempts_per_day 
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getQuizByTopicId = async (req, res) => {
  try {
    // const user_id = req.user.userId; // important
    const { topic_id } = req.params;

    const result = await pool.query(
      `SELECT 
         q.id,
         q.title,
         q.difficulty,
         q.passing_score,
         q.xp_reward,
         q.max_attempts_per_day,
         COALESCE(p.passed, false) as passed,
         COALESCE(p.total_attempts, 0) as total_attempts
       FROM quizzes q
       LEFT JOIN user_quiz_progress p
         ON q.id = p.quiz_id
       WHERE q.topic_id = $1
       ORDER BY 
         CASE q.difficulty
           WHEN 'easy' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'hard' THEN 3
         END`,
      [ topic_id]
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

// exports.getQuestionByQuizId = async (req, res) => {
//   try {
//     const { quiz_id } = req.params;

//     const result = await pool.query(
//       `SELECT qq.*, 
//               json_agg(json_build_object('id', qo.id, 'option_text', qo.option_text, 'is_correct', qo.is_correct)) AS options
//        FROM quiz_questions qq
//        LEFT JOIN quiz_options qo ON qq.id = qo.question_id
//        WHERE qq.quiz_id = $1
//        GROUP BY qq.id
//        ORDER BY qq.id`,
//       [quiz_id]
//     );

//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


// =========================
// 🎯 QUIZ SUBMISSION
// =========================
// exports.submitQuiz = async (req, res) => {
//   try {
//     const { answers } = req.body;
//     const user_id = req.user.userId;
//     const { quiz_id } = req.params;
//     const user = await pool.query(
//       `SELECT email FROM users WHERE id = $1`,
//       [user_id]
//     );

//     console.log("Received quiz submission:", { email: user.rows[0].email, user_id, quiz_id, answers });
//     // ✅ Step 1: Get quiz details
//     const quiz = await pool.query(
//       "SELECT topic_id, passing_score FROM quizzes WHERE id = $1",
//       [quiz_id]
//     );

//     if (quiz.rows.length === 0) {
//       return res.status(404).json({ error: "Quiz not found" });
//     }

//     const topic_id = quiz.rows[0].topic_id;
//     const passing_score = quiz.rows[0].passing_score;

//     // ✅ Step 2: Check if already passed
//     const progressCheck = await pool.query(
//       `SELECT passed FROM user_quiz_progress 
//        WHERE user_id = $1 AND quiz_id = $2`,
//       [user_id, quiz_id]
//     );

//     if (progressCheck.rows[0]?.passed) {
//       return res.status(400).json({
//         error: "Quiz already passed. No more attempts allowed."
//       });
//     }

//     // ✅ Step 3: Check today's attempts (limit = 3)
//     const attemptsToday = await pool.query(
//       `SELECT COUNT(*) FROM user_quiz_attempts
//        WHERE user_id = $1 
//          AND quiz_id = $2
//          AND attempt_date = CURRENT_DATE`,
//       [user_id, quiz_id]
//     );

//     if (parseInt(attemptsToday.rows[0].count) >= 3) {
//       return res.status(400).json({
//         error: "Daily attempt limit reached (3 attempts)"
//       });
//     }

//     // ✅ Step 4: Evaluate quiz (your existing logic)
//     let correct = 0;

//     for (let ans of answers) {
//       const correctOptions = await pool.query(
//         `SELECT id FROM quiz_options 
//          WHERE question_id = $1 AND is_correct = true`,
//         [ans.question_id]
//       );

//       const correctIds = correctOptions.rows.map(o => o.id).sort();
//       const selectedIds = ans.selected_option_ids.sort();

//       const isCorrect =
//         JSON.stringify(correctIds) === JSON.stringify(selectedIds);

//       if (isCorrect) correct++;
//     }

//     const totalQuestions = answers.length;
//     const score = (correct / totalQuestions) * 100;
//     const incorrect = totalQuestions - correct;

//     const passed = score >= passing_score;

//     // ✅ Step 5: Insert into attempts table
//     await pool.query(
//       `INSERT INTO user_quiz_attempts 
//        (user_id, topic_id, quiz_id, score, passed)
//        VALUES ($1, $2, $3, $4, $5)`,
//       [user_id, topic_id, quiz_id, score, passed]
//     );

//     // ✅ Step 6: Upsert quiz progress
//     await pool.query(
//       `INSERT INTO user_quiz_progress
//        (user_id, topic_id, quiz_id, latest_score, passed, total_attempts, last_attempted_at)
//        VALUES ($1, $2, $3, $4, $5, 1, NOW())
//        ON CONFLICT (user_id, quiz_id)
//        DO UPDATE SET
//          latest_score = EXCLUDED.latest_score,
//          passed = EXCLUDED.passed,
//          total_attempts = user_quiz_progress.total_attempts + 1,
//          last_attempted_at = NOW()`,
//       [user_id, topic_id, quiz_id, score, passed]
//     );

//     // ✅ Step 7: Get subject_id for the topic
//     const subjectResult = await pool.query(
//       `SELECT subject_id FROM topics WHERE id = $1`,
//       [topic_id]
//     );

//     const subject_id = subjectResult.rows[0].subject_id;

//     // ✅ Step 8: Check if all topics in subject have completed quizzes
//     const allTopicsInSubject = await pool.query(
//       `SELECT id FROM topics WHERE subject_id = $1`,
//       [subject_id]
//     );

//     const topicIds = allTopicsInSubject.rows.map(t => t.id);

//     // Check completion status for all topics
//     let allTopicsCompleted = true;
//     let completedTopicsCount = 0;
//     const topicCompletionStatus = {};

//     for (let tId of topicIds) {
//       // Check if quiz exists for this topic
//       const quizExistsResult = await pool.query(
//         `SELECT COUNT(*) as quiz_count FROM quizzes WHERE topic_id = $1`,
//         [tId]
//       );

//       const quizExists = quizExistsResult.rows[0].quiz_count > 0;

//       if (!quizExists) {
//         topicCompletionStatus[tId] = {
//           completed: false,
//           passed_quizzes: 0,
//           total_quizzes: 0,
//           quizExists: false
//         };
//         continue;
//       }

//       const topicCompletion = await pool.query(
//         `SELECT COUNT(*) as total_quizzes, 
//                 SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) as passed_quizzes
//          FROM user_quiz_progress 
//          WHERE user_id = $1 AND topic_id = $2`,
//         [user_id, tId]
//       );

//       const { total_quizzes, passed_quizzes } = topicCompletion.rows[0];
//       const isTopicCompleted = total_quizzes > 0 && total_quizzes == passed_quizzes;
      
//       topicCompletionStatus[tId] = {
//         completed: isTopicCompleted,
//         passed_quizzes: parseInt(passed_quizzes) || 0,
//         total_quizzes: parseInt(total_quizzes) || 0
//       };

//       if (isTopicCompleted) completedTopicsCount++;
//       else allTopicsCompleted = false;
//     }

//    // Console log topics which are not completed
//     const incompleteTopics = Object.entries(topicCompletionStatus)
//       .filter(([_, status]) => !status.completed)
//       .map(([tId, status]) => ({ topicId: tId, ...status }));
    
//     if (incompleteTopics.length > 0) {
//       console.log("Incomplete topics:", incompleteTopics);
//     }

//     // Check if quiz exists for all incomplete topics
//     const topicsWithoutQuiz = incompleteTopics.filter(topic => topic.quizExists === false);
//     if (topicsWithoutQuiz.length > 0) {
//       console.log("Topics without quiz:", topicsWithoutQuiz);
//     }

//     let xpResultTopic = null;
//     const referTypeTopic = await pool.query(
//       `SELECT title FROM topics WHERE id = $1`,
//       [topic_id]
//     );


//     if(allTopicsCompleted){
//        xpResultTopic = await xpService.assignXP({
//         userId: user_id,
//         eventType: "TOPIC_COMPLETED",  
//         referenceType: referTypeTopic.rows[0].title+" Completion.",
//         sourceId: quiz_id,
//         metadata: {
//           topic_id,
//           score
//         } 
//     });
//     }


//     const referType = await pool.query(
//       `SELECT title FROM quizzes WHERE id = $1 and topic_id = $2`,
//       [quiz_id,topic_id]
//     );
//     let xpResult = null;

//     if(passed){
//       xpResult = await xpService.assignXP({
//         userId: user_id,
//         eventType: "QUIZ_COMPLETED",  
//         referenceType: referType.rows[0].title+" Completion.",
//         sourceId: quiz_id,
//         metadata: {
//           topic_id,
//           score
//         } 
//     });
//   }

//   if(passed){
//     const subjectQuery = await pool.query(
//       `SELECT subject_id FROM topics WHERE id = $1`,
//       [topic_id]
//     );
//     const subjectId = subjectQuery.rows[0].subject_id;
//     if(subjectId){
//     await updateSubjectStreak(pool, user_id, subjectId);
//     }
//   }
//     // ✅ Final response
//     res.json({
//       score,
//       correct,
//       incorrect,
//       totalQuestions,
//       passed,
//       attempts_today: parseInt(attemptsToday.rows[0].count) + 1,
//       xp_awarded: xpResult ? xpResult.awarded : false,
//       message: passed
//     ? xpResult?.awarded
//       ? `🎉 Quiz passed! You earned ${xpResult.xp} XP`
//       : "Quiz passed, but XP already awarded earlier"
//     : "Quiz not passed. Try again!",
//       topic_completion: allTopicsCompleted ? xpResultTopic?.awarded ? `🎉 Topic completed! You earned ${xpResultTopic.xp} XP` : "Topic completed, but XP already awarded earlier" : "Topic not completed yet",

//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };
exports.getQuestionByQuizId = async (req, res) => {
  try {
    const { quiz_id } = req.params;

    const result = await pool.query(
      `SELECT 
          qq.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', qo.id,
                'option_text', qo.option_text,
                'is_correct', qo.is_correct
              )
              ORDER BY qo.id
            ) FILTER (WHERE qo.id IS NOT NULL),
            '[]'
          ) AS options
       FROM quiz_questions qq
       LEFT JOIN quiz_options qo 
         ON qq.id = qo.question_id
       WHERE qq.quiz_id = $1
       GROUP BY qq.id
       ORDER BY qq.order_index, qq.id`,
      [quiz_id]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.submitQuiz = async (req, res) => {
  try {
    
    const { answers ,time_spent} = req.body;
    const user_id = req.user.userId;
    const { quiz_id } = req.params;
    console.log("Received quiz submission:", { user_id, quiz_id, answers,time_spent });
    // 1️⃣ Quiz details
    const quiz = await pool.query(
      `SELECT topic_id, passing_score,difficulty, xp_reward, max_attempts_per_day
       FROM quizzes WHERE id = $1`,
      [quiz_id]
    );

    if (!quiz.rows.length) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const {
      topic_id,
      passing_score,
      difficulty,
      xp_reward,
      max_attempts_per_day
    } = quiz.rows[0];

    // 2️⃣ Already passed check
    const progressCheck = await pool.query(
      `SELECT passed FROM user_quiz_progress 
       WHERE user_id = $1 AND quiz_id = $2`,
      [user_id, quiz_id]
    );

    if (progressCheck.rows[0]?.passed) {
      return res.status(400).json({
        error: "Quiz already passed"
      });
    }

    // 3️⃣ Attempt limit
    const attemptsToday = await pool.query(
      `SELECT COUNT(*) FROM user_quiz_attempts
       WHERE user_id = $1 
         AND quiz_id = $2
         AND attempt_date = CURRENT_DATE`,
      [user_id, quiz_id]
    );

    if (parseInt(attemptsToday.rows[0].count) >= max_attempts_per_day) {
      return res.status(400).json({
        error: `Daily limit reached (${max_attempts_per_day})`
      });
    }

    // 4️⃣ BULK fetch correct answers
    const questionIds = answers.map(a => a.question_id);

    const correctOptions = await pool.query(
      `SELECT question_id, id 
       FROM quiz_options 
       WHERE question_id = ANY($1) AND is_correct = true`,
      [questionIds]
    );

    const correctMap = {};
    correctOptions.rows.forEach(row => {
      if (!correctMap[row.question_id]) {
        correctMap[row.question_id] = [];
      }
      correctMap[row.question_id].push(row.id);
    });

    // 5️⃣ Evaluate
    let correct = 0;

    for (let ans of answers) {
      const correctIds = (correctMap[ans.question_id] || []).sort();
      const selectedIds = ans.selected_option_ids.sort();

      if (JSON.stringify(correctIds) === JSON.stringify(selectedIds)) {
        correct++;
      }
    }

    const totalQuestions = answers.length;
    const score = (correct / totalQuestions) * 100;
    const incorrect = totalQuestions - correct;
    const passed = score >= passing_score;

    // 6️⃣ Save attempt
    await pool.query(
      `INSERT INTO user_quiz_attempts 
       (user_id, topic_id, quiz_id, score, passed, time_spent_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, topic_id, quiz_id, score, passed, time_spent]
    );

    // 7️⃣ Upsert progress
    await pool.query(
      `INSERT INTO user_quiz_progress
       (user_id, topic_id, quiz_id, latest_score, passed, total_attempts, last_attempted_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (user_id, quiz_id)
       DO UPDATE SET
         latest_score = EXCLUDED.latest_score,
         passed = user_quiz_progress.passed OR EXCLUDED.passed,
         total_attempts = user_quiz_progress.total_attempts + 1,
         last_attempted_at = NOW()`,
      [user_id, topic_id, quiz_id, score, passed]
    );

    // 8️⃣ Topic completion (FIXED)
const topicCheck = await pool.query(
  `SELECT 
     COUNT(q.id) AS total,
     COUNT(DISTINCT CASE WHEN uqp.passed = true THEN uqp.quiz_id END) AS passed
   FROM quizzes q
   LEFT JOIN user_quiz_progress uqp
     ON q.id = uqp.quiz_id AND uqp.user_id = $2
   WHERE q.topic_id = $1`,
  [topic_id, user_id]
);

const total = parseInt(topicCheck.rows[0].total || 0);
const passedCount = parseInt(topicCheck.rows[0].passed || 0);

const topicCompleted = total > 0 && total === passedCount;

const referType = await pool.query(
       `SELECT title FROM quizzes WHERE id = $1 and topic_id = $2`,
       [quiz_id,topic_id]
     );

    if(passed){
      const subjectQuery = await pool.query(
        `SELECT subject_id FROM topics WHERE id = $1`,
        [topic_id]
      );
      const subjectId = subjectQuery.rows[0].subject_id;
      if(subjectId){
        await updateSubjectStreak(pool, user_id, subjectId);
      }
    }
    let eventType = null;
    if (passed) {
      if(difficulty === 'easy') eventType = "EASY_COMPLETED";
      else if(difficulty === 'medium') eventType = "MEDIUM_COMPLETED";
      else if(difficulty === 'hard') eventType = "HARD_COMPLETED";
    }

    // 9️⃣ XP (same logic retained)
    let xpResult = null;
    if (passed) {
      xpResult = await xpService.assignXP({
        userId: user_id,
        eventType: eventType || "QUIZ_COMPLETED",
        referenceType: referType.rows[0]?.title,
        sourceId: quiz_id,
        metadata: { topic_id, score }
      });
    }

    const referTypeTopic = await pool.query(
      `SELECT title FROM topics WHERE id = $1`,
      [topic_id]
    );

    if(topicCompleted){
      xpResultTopic = await xpService.assignXP({
        userId: user_id,
        eventType: "TOPIC_COMPLETED",
        referenceType: referTypeTopic.rows[0]?.title,
        sourceId: topic_id
      });
    }


    res.json({
      score,
      correct,
      incorrect,
      totalQuestions,
      passed,
      time_spent_seconds: time_spent,
      attempts_today: parseInt(attemptsToday.rows[0].count) + 1,
      xp_awarded: xpResult ? xpResult.awarded : false,
      message: passed
        ? `🎉 Passed! +${xp_reward} XP`
        : "Try again!",
      topic_completed: topicCompleted
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


// exports.submitQuiz = async (req, res) => {
//   try {
//     const { answers } = req.body;
//     const user_id = req.user.userId;
//     const { quiz_id } = req.params;

//     let correct = 0;

//     for (let ans of answers) {
//       const correctOptions = await pool.query(
//         `SELECT id FROM quiz_options 
//          WHERE question_id = $1 AND is_correct = true`,
//         [ans.question_id]
//       );

//       const correctIds = correctOptions.rows.map(o => o.id).sort();
//       const selectedIds = ans.selected_option_ids.sort();

//       const isCorrect =
//         JSON.stringify(correctIds) === JSON.stringify(selectedIds);

//       if (isCorrect) correct++;
//     }

//     const totalQuestions = answers.length;
//     const score = (correct / totalQuestions) * 100;
//     const incorrect = totalQuestions - correct;
//     // Get topic_id
//     const quiz = await pool.query(
//       "SELECT topic_id, passing_score FROM quizzes WHERE id = $1",
//       [quiz_id]
//     );

//     const topic_id = quiz.rows[0].topic_id;
//     const passing_score = quiz.rows[0].passing_score;

//     const passed = score >= passing_score;

//     // Update Progress
//     await pool.query(
//       `INSERT INTO user_topic_progress 
//        (user_id, topic_id, quiz_completed, quiz_score, completed_at)
//        VALUES ($1, $2, $3, $4, NOW())
//        ON CONFLICT (user_id, topic_id)
//        DO UPDATE SET
//          quiz_completed = $3,
//          quiz_score = $4,
//          completed_at = NOW()`,
//       [user_id, topic_id, passed, score]
//     );

//     res.json({
//       score,
//       correct,
//       incorrect,
//       totalQuestions,
//       passed
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

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

      // ✅ GET ALL QUIZZES (easy, medium, hard)
      const quizzes = await pool.query(
        "SELECT * FROM quizzes WHERE topic_id = $1",
        [topic.id]
      );

      const quizMap = {
        easy: null,
        medium: null,
        hard: null
      };

      for (let quiz of quizzes.rows) {

        // ✅ Fetch questions for each quiz
        const questionsRes = await pool.query(
          "SELECT * FROM quiz_questions WHERE quiz_id = $1",
          [quiz.id]
        );

        const questions = [];

        for (let ques of questionsRes.rows) {

          const optionsRes = await pool.query(
            "SELECT * FROM quiz_options WHERE question_id = $1",
            [ques.id]
          );

          questions.push({
            ...ques,
            options: optionsRes.rows
          });
        }

        // ✅ Map by difficulty
        quizMap[quiz.difficulty] = {
          ...quiz,
          questions
        };
      }

      result.push({
        topic,
        video: video.rows[0] || null,
        quizzes: quizMap
      });
    }

    res.json({
      subject: subject.rows[0],
      topics: result
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
// exports.getFullCourse = async (req, res) => {
//   try {
//     const { subject_id } = req.params;

//     const subject = await pool.query(
//       "SELECT * FROM subjects WHERE id = $1",
//       [subject_id]
//     );

//     const topics = await pool.query(
//       "SELECT * FROM topics WHERE subject_id = $1 ORDER BY order_index",
//       [subject_id]
//     );

//     const result = [];

//     for (let topic of topics.rows) {
//       const video = await pool.query(
//         "SELECT * FROM topic_videos WHERE topic_id = $1",
//         [topic.id]
//       );

//       const quiz = await pool.query(
//         "SELECT * FROM quizzes WHERE topic_id = $1",
//         [topic.id]
//       );

//       let questions = [];

//       if (quiz.rows.length) {
//         const q = await pool.query(
//           "SELECT * FROM quiz_questions WHERE quiz_id = $1",
//           [quiz.rows[0].id]
//         );

//         for (let ques of q.rows) {
//           const options = await pool.query(
//             "SELECT * FROM quiz_options WHERE question_id = $1",
//             [ques.id]
//           );

//           questions.push({
//             ...ques,
//             options: options.rows
//           });
//         }
//       }

//       result.push({
//         topic,
//         video: video.rows[0],
//         quiz: {
//           ...quiz.rows[0],
//           questions
//         }
//       });
//     }

//     res.json({
//       subject: subject.rows[0],
//       topics: result
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// exports.getRemainingAttempts = async (req, res) => {
//   try {
//     const user_id = req.user.userId; // UUID
//     const { topic_id } = req.params;

//     // ✅ Step 1: Get quiz_id
//     const quizResult = await pool.query(
//       `SELECT id FROM quizzes WHERE topic_id = $1`,
//       [topic_id]
//     );

//     if (quizResult.rows.length === 0) {
//       return res.status(404).json({ error: "Quiz not found for this topic" });
//     }

//     const quiz_id = quizResult.rows[0].id;

//     // ✅ Step 2: Check if already completed (passed)
//     const progress = await pool.query(
//       `SELECT passed FROM user_quiz_progress
//        WHERE user_id = $1 AND quiz_id = $2`,
//       [user_id, quiz_id]
//     );

//     if (progress.rows[0]?.passed) {
//       return res.json({
//         quiz_id,
//         status: "completed",
//         attempts_used: 0,
//         attempts_left: 0
//       });
//     }

//     // ✅ Step 3: Count today's attempts
//     const attemptsResult = await pool.query(
//       `SELECT COUNT(*) FROM user_quiz_attempts
//        WHERE user_id = $1
//          AND quiz_id = $2
//          AND attempt_date = CURRENT_DATE`,
//       [user_id, quiz_id]
//     );

//     const attemptsUsed = parseInt(attemptsResult.rows[0].count);
//     const MAX_ATTEMPTS = 3;

//     const attempts_left = Math.max(0, MAX_ATTEMPTS - attemptsUsed);

//     // ✅ Step 4: Return proper status
//     res.json({
//       quiz_id,
//       status: attempts_left === 0 ? "limit_reached" : "available",
//       attempts_used: attemptsUsed,
//       attempts_left
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

exports.getRemainingAttempts = async (req, res) => {
  try {
    const user_id = req.user.userId;
    const { topic_id, difficulty } = req.params;

    const quizResult = await pool.query(
      `SELECT id, max_attempts_per_day 
       FROM quizzes 
       WHERE topic_id = $1 AND difficulty = $2`,
      [topic_id, difficulty]
    );

    if (!quizResult.rows.length) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const quiz_id = quizResult.rows[0].id;
    const MAX_ATTEMPTS = quizResult.rows[0].max_attempts_per_day || 3;

    const progress = await pool.query(
      `SELECT passed FROM user_quiz_progress
       WHERE user_id = $1 AND quiz_id = $2`,
      [user_id, quiz_id]
    );

    if (progress.rows[0]?.passed) {
      return res.json({
        quiz_id,
        status: "completed",
        attempts_left: 0
      });
    }

    const attempts = await pool.query(
      `SELECT COUNT(*) FROM user_quiz_attempts
       WHERE user_id = $1
       AND quiz_id = $2
       AND attempt_date = CURRENT_DATE`,
      [user_id, quiz_id]
    );

    const used = parseInt(attempts.rows[0].count);
    const left = Math.max(0, MAX_ATTEMPTS - used);

    res.json({
      quiz_id,
      status: left === 0 ? "limit_reached" : "available",
      attempts_used: used,
      attempts_left: left
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};