const pool = require("../config/db");

/**
 * XP Reward
 */
const getXPReward = (difficulty) => {
  switch (difficulty) {
    case "easy":
      return 50;
    case "medium":
      return 100;
    case "hard":
      return 150;
    default:
      return 50;
  }
};

/**
 * Create Quiz
 */
const createQuiz = async (
  client,
  topicId,
  topicTitle,
  difficulty
) => {

  const quizTitle =
    `${topicTitle} (${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)})`;

  const result = await client.query(
    `
    INSERT INTO quizzes
    (
      topic_id,
      title,
      difficulty,
      passing_score,
      xp_reward,
      max_attempts_per_day
    )
    VALUES
    ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
    [
      topicId,
      quizTitle,
      difficulty,
      50,
      getXPReward(difficulty),
      3
    ]
  );

  return result.rows[0];
};

/**
 * Insert Questions + Options
 */
const insertQuestions = async (
  client,
  quizId,
  questions
) => {

  let orderIndex = 1;

  for (const question of questions) {

    const questionResult = await client.query(
      `
      INSERT INTO quiz_questions
      (
        quiz_id,
        question_text,
        question_text_en,
        question_text_hi,
        question_type,
        order_index
      )
      VALUES
      ($1,$2,$3,$4,$5,$6)
      RETURNING id
      `,
      [
        quizId,
        question.question_en,
        question.question_en,
        question.question_hi,
        "single",
        orderIndex++
      ]
    );

    const questionId = questionResult.rows[0].id;

    for (const option of question.options) {

      await client.query(
        `
        INSERT INTO quiz_options
        (
          question_id,
          option_text,
          option_text_en,
          option_text_hi,
          is_correct
        )
        VALUES
        ($1,$2,$3,$4,$5)
        `,
        [
          questionId,
          option.en,
          option.en,
          option.hi,
          option.is_correct
        ]
      );

    }

  }

};

/**
 * Publish AI Quiz
 */
exports.publishQuiz = async ({
  topic_id,
  questions
}) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    // ====================================
    // Get Topic
    // ====================================

    const topicResult = await client.query(
      `
      SELECT title
      FROM topics
      WHERE id = $1
      `,
      [topic_id]
    );

    if (topicResult.rows.length === 0) {
      throw new Error("Topic not found.");
    }

    const topicTitle = topicResult.rows[0].title;

    // ====================================
    // Prevent Duplicate Quiz
    // ====================================

    const existingQuiz = await client.query(
      `
      SELECT id
      FROM quizzes
      WHERE topic_id = $1
      LIMIT 1
      `,
      [topic_id]
    );

    if (existingQuiz.rows.length > 0) {
      throw new Error(
        "Quiz already exists for this topic."
      );
    }

    // ====================================
    // Create Easy / Medium / Hard
    // ====================================

    const difficulties = ["easy", "medium", "hard"];

    const createdQuizzes = {};

    for (const difficulty of difficulties) {

      const difficultyQuestions = questions[difficulty] || [];

      if (
        !difficultyQuestions ||
        difficultyQuestions.length === 0
      ) {
        continue;
      }

      const quiz = await createQuiz(
        client,
        topic_id,
        topicTitle,
        difficulty
      );

      await insertQuestions(
        client,
        quiz.id,
        difficultyQuestions
      );

    createdQuizzes[difficulty] = {
    id: quiz.id,
    title: quiz.title,
    difficulty: quiz.difficulty
};

    }

    await client.query("COMMIT");

    return createdQuizzes;

  } catch (err) {

    await client.query("ROLLBACK");

    throw err;

  } finally {

    client.release();

  }

};