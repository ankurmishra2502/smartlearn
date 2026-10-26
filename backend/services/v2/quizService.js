const pool = require("../../config/db");
const aiTutorQueue = require("../../queues/aiTutorQueue");

const createQuiz = async ({
  userId,
  topicName,
  description,
  sourceType,
  timePerQuestionSeconds,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Fixed stage configuration
    const stageDefinitions = [
      {
        difficulty: "easy",
        displayOrder: 1,
        questionCount: 10,
        pointsPerQuestion: 2,
      },
      {
        difficulty: "medium",
        displayOrder: 2,
        questionCount: 20,
        pointsPerQuestion: 3,
      },
      {
        difficulty: "hard",
        displayOrder: 3,
        questionCount: 40,
        pointsPerQuestion: 4,
      },
    ];

    // Create quiz
    const quizResult = await client.query(
      `
      INSERT INTO v2_quizzes (
        user_id,
        topic_name,
        description,
        source_type,
        status,
        time_per_question_seconds
      )
      VALUES ($1, $2, $3, $4, 'draft', $5)
      RETURNING *
      `,
      [
        userId,
        topicName,
        description || null,
        sourceType,
        timePerQuestionSeconds,
      ]
    );

    const quiz = quizResult.rows[0];
    const stagesResult = [];

    // Create stages using fixed configuration
    for (const stage of stageDefinitions) {
      const result = await client.query(
        `
        INSERT INTO v2_quiz_stages (
          quiz_id,
          difficulty,
          display_order,
          question_count,
          points_per_question,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING *
        `,
        [
          quiz.id,
          stage.difficulty,
          stage.displayOrder,
          stage.questionCount,
          stage.pointsPerQuestion,
        ]
      );

      stagesResult.push(result.rows[0]);
    }

    await client.query("COMMIT");

    return {
      ...quiz,
      passingPercentage: 70,
      stages: stagesResult,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};


const getQuizById = async ({ quizId, userId }) => {
  const result = await pool.query(
    `
    SELECT
      q.*,

      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', s.id,
            'difficulty', s.difficulty,
            'displayOrder', s.display_order,
            'questionCount', s.question_count
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS stages

    FROM v2_quizzes q

    LEFT JOIN v2_quiz_stages s
      ON s.quiz_id = q.id

    WHERE q.id = $1
      AND q.user_id = $2

    GROUP BY q.id
    `,
    [quizId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

const addQuizSource = async ({
  quizId,
  userId,
  sourceType,
  originalFileName,
  mimeType,
  fileSizeBytes,
  s3Bucket,
  s3Key
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify quiz belongs to current user
    const quizResult = await client.query(
      `
      SELECT id, source_type
      FROM v2_quizzes
      WHERE id = $1
        AND user_id = $2
      `,
      [quizId, userId]
    );

    if (quizResult.rows.length === 0) {
      const error = new Error("Quiz not found");
      error.statusCode = 404;
      throw error;
    }

    const quiz = quizResult.rows[0];
    

    if (!["file", "scan"].includes(sourceType)) {
      const error = new Error(
        "sourceType must be file or scan"
      );
      error.statusCode = 400;
      throw error;
    }

    const result = await client.query(
      `
      INSERT INTO v2_quiz_sources (
        quiz_id,
        source_type,
        original_file_name,
        mime_type,
        file_size_bytes,
        s3_bucket,
        s3_key,
        processing_status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'uploaded'
      )
      RETURNING *
      `,
      [
        quizId,
        sourceType,
        originalFileName || null,
        mimeType || null,
        fileSizeBytes || null,
        s3Bucket || null,
        s3Key || null
      ]
    );

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};


const getQuizSources = async ({ quizId, userId }) => {
  const result = await pool.query(
    `
    SELECT
      s.*
    FROM v2_quiz_sources s
    INNER JOIN v2_quizzes q
      ON q.id = s.quiz_id
    WHERE s.quiz_id = $1
      AND q.user_id = $2
    ORDER BY s.created_at ASC
    `,
    [quizId, userId]
  );

  return result.rows;
};

const deleteQuizSource = async ({ quizId, sourceId, userId }) => {
  const result = await pool.query(
    `
    DELETE FROM v2_quiz_sources
    WHERE id = $1
      AND quiz_id = $2
      AND quiz_id IN (
        SELECT id
        FROM v2_quizzes
        WHERE id = $2
          AND user_id = $3
      )
    RETURNING *
    `,
    [sourceId, quizId, userId]
  );

  if (result.rows.length === 0) {
    const error = new Error("Quiz source not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
};

const getUserQuizzes = async ({ userId }) => {
  const result = await pool.query(
    `
    SELECT
      q.*,
      COUNT(DISTINCT s.id)::INTEGER AS stage_count,
      COUNT(DISTINCT qa.id)::INTEGER AS attempt_count
    FROM v2_quizzes q

    LEFT JOIN v2_quiz_stages s
      ON s.quiz_id = q.id

    LEFT JOIN v2_quiz_attempts qa
      ON qa.quiz_id = q.id
      AND qa.user_id = $1

    WHERE q.user_id = $1

    GROUP BY q.id
    ORDER BY q.created_at DESC
    `,
    [userId]
  );

  return result.rows;
};

const getQuizStages = async ({
  quizId,
  userId
}) => {
  const result = await pool.query(
    `
    SELECT
      s.id,
      s.quiz_id,
      s.difficulty,
      s.display_order,
      s.question_count,
      s.status,
      s.created_at,
      s.updated_at
    FROM v2_quiz_stages s
    INNER JOIN v2_quizzes q
      ON q.id = s.quiz_id
    WHERE s.quiz_id = $1
      AND q.user_id = $2
    ORDER BY s.display_order ASC
    `,
    [quizId, userId]
  );

  return result.rows;
};

const startStageGeneration = async ({
  quizId,
  stageId,
  userId,
  allowRetry = false
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Verify quiz belongs to user
    const quizResult = await client.query(
      `
      SELECT
        id,
        status
      FROM v2_quizzes
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [quizId, userId]
    );

    if (quizResult.rows.length === 0) {
      const error = new Error("Quiz not found");
      error.statusCode = 404;
      throw error;
    }

    const quiz = quizResult.rows[0];

    // 2. Get the requested stage
    const stageResult = await client.query(
      `
      SELECT
        id,
        quiz_id,
        difficulty,
        display_order,
        question_count,
        status
      FROM v2_quiz_stages
      WHERE id = $1
        AND quiz_id = $2
      FOR UPDATE
      `,
      [stageId, quizId]
    );

    if (stageResult.rows.length === 0) {
      const error = new Error("Quiz stage not found");
      error.statusCode = 404;
      throw error;
    }

    const stage = stageResult.rows[0];

    // 3. Prevent invalid generation states
    if (stage.status === "generating") {
      const error = new Error(
        "Stage generation is already in progress"
      );
      error.statusCode = 409;
      throw error;
    }

    if (stage.status === "ready" && !allowRetry) {
      const error = new Error(
        "Stage has already been generated"
      );
      error.statusCode = 409;
      throw error;
    }

    // A retry may regenerate a ready stage after its previous attempt failed.
    // Normal generation still cannot run for in-progress or completed stages.
    if (
      stage.status === "in_progress" ||
      stage.status === "completed" ||
      (allowRetry && stage.status !== "ready")
    ) {
      const error = new Error(
        "Stage cannot be generated in its current state"
      );
      error.statusCode = 400;
      throw error;
    }

    // 4. Get next generation run number
    const runNumberResult = await client.query(
      `
      SELECT
        COALESCE(MAX(run_number), 0) + 1 AS next_run_number
      FROM v2_quiz_generation_runs
      WHERE quiz_id = $1
      `,
      [quizId]
    );

    const runNumber =
      runNumberResult.rows[0].next_run_number;

    // 5. Create generation run
    const generationRunResult = await client.query(
      `
      INSERT INTO v2_quiz_generation_runs (
        quiz_id,
        stage_id,
        run_number,
        status,
        started_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'started',
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        quizId,
        stageId,
        runNumber
      ]
    );

    const generationRun =
      generationRunResult.rows[0];

    // 6. Mark stage as generating
    const updatedStageResult = await client.query(
      `
      UPDATE v2_quiz_stages
      SET
        status = 'generating',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [stageId]
    );

    const updatedStage =
      updatedStageResult.rows[0];

    await client.query("COMMIT");

    return {
      quiz,
      stage: updatedStage,
      generationRun
    };

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getStageById = async ({ stageId, userId }) => {
  const query = `
    SELECT
      s.id,
      s.quiz_id,
      s.difficulty,
      s.display_order,
      s.question_count,
      s.status,
      s.created_at,
      s.updated_at
    FROM v2_quiz_stages s
    INNER JOIN v2_quizzes q
      ON q.id = s.quiz_id
    WHERE s.id = $1
      AND q.user_id = $2
  `;

  const { rows } = await pool.query(query, [
    stageId,
    userId,
  ]);

  if (!rows.length) {
    throw new Error("Quiz stage not found.");
  }

  return rows[0];
};
const getStageQuestions = async ({
  stageId,
  userId,
}) => {
  const stageQuery = `
    SELECT
      s.id
    FROM v2_quiz_stages s
    INNER JOIN v2_quizzes q
      ON q.id = s.quiz_id
    WHERE s.id = $1
      AND q.user_id = $2
  `;

  const stageResult = await pool.query(
    stageQuery,
    [stageId, userId]
  );

  if (!stageResult.rows.length) {
    throw new Error("Quiz stage not found.");
  }

  const query = `
    SELECT
      q.id,
      q.display_order,
      q.question_text,
      q.question_type,
      q.topic_name,
      q.topic_key,
      q.subtopic_name,
      q.subtopic_key
    FROM v2_quiz_questions q
    WHERE q.stage_id = $1
    ORDER BY q.display_order ASC
  `;

  const questionResult = await pool.query(
    query,
    [stageId]
  );

  if (!questionResult.rows.length) {
    return [];
  }

  const questionIds = questionResult.rows.map(
    (question) => question.id
  );

  const optionsQuery = `
    SELECT
      id,
      question_id,
      option_key,
      option_text,
      display_order
    FROM v2_quiz_options
    WHERE question_id = ANY($1::uuid[])
    ORDER BY display_order ASC
  `;

  const optionsResult = await pool.query(
    optionsQuery,
    [questionIds]
  );

  const optionsByQuestion = {};

  for (const option of optionsResult.rows) {
    if (!optionsByQuestion[option.question_id]) {
      optionsByQuestion[option.question_id] = [];
    }

    optionsByQuestion[option.question_id].push({
      id: option.id,
      optionKey: option.option_key,
      optionText: option.option_text,
      displayOrder: option.display_order,
    });
  }

  return questionResult.rows.map((question) => ({
    id: question.id,
    displayOrder: question.display_order,
    questionText: question.question_text,
    questionType: question.question_type,
    topicName: question.topic_name,
    topicKey: question.topic_key,
    subtopicName: question.subtopic_name,
    subtopicKey: question.subtopic_key,
    options: optionsByQuestion[question.id] || [],
  }));
};

const getQuestionById = async ({
  questionId,
  userId,
}) => {
  const query = `
    SELECT
      q.id,
      q.stage_id,
      q.display_order,
      q.question_text,
      q.question_type,
      q.topic_name,
      q.topic_key,
      q.subtopic_name,
      q.subtopic_key
    FROM v2_quiz_questions q
    INNER JOIN v2_quiz_stages s
      ON s.id = q.stage_id
    INNER JOIN v2_quizzes quiz
      ON quiz.id = s.quiz_id
    WHERE q.id = $1
      AND quiz.user_id = $2
  `;

  const { rows } = await pool.query(
    query,
    [questionId, userId]
  );

  if (!rows.length) {
    throw new Error("Question not found.");
  }

  const question = rows[0];

  const optionsQuery = `
    SELECT
      id,
      option_key,
      option_text,
      display_order
    FROM v2_quiz_options
    WHERE question_id = $1
    ORDER BY display_order ASC
  `;

  const optionsResult = await pool.query(
    optionsQuery,
    [questionId]
  );

  return {
    id: question.id,
    stageId: question.stage_id,
    displayOrder: question.display_order,
    questionText: question.question_text,
    questionType: question.question_type,
    topicName: question.topic_name,
    topicKey: question.topic_key,
    subtopicName: question.subtopic_name,
    subtopicKey: question.subtopic_key,
    options: optionsResult.rows.map((option) => ({
      id: option.id,
      optionKey: option.option_key,
      optionText: option.option_text,
      displayOrder: option.display_order,
    })),
  };
};

const startQuizAttempt = async ({ quizId, userId }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Verify quiz belongs to user
    const quizResult = await client.query(
      `
      SELECT
        id,
        topic_name,
        description,
        source_type,
        status,
        time_per_question_seconds
      FROM v2_quizzes
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [quizId, userId]
    );

    if (!quizResult.rows.length) {
      const error = new Error("Quiz not found");
      error.statusCode = 404;
      throw error;
    }

    const quiz = quizResult.rows[0];

    // 2. Check for an existing active quiz attempt
    const existingAttemptResult = await client.query(
      `
      SELECT *
      FROM v2_quiz_attempts
      WHERE quiz_id = $1
        AND user_id = $2
        AND status IN ('started', 'in_progress')
      ORDER BY started_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [quizId, userId]
    );

    if (existingAttemptResult.rows.length) {
      const attempt = existingAttemptResult.rows[0];

      // Find the currently active stage attempt
      const stageAttemptResult = await client.query(
        `
        SELECT
          sa.*,
          s.difficulty,
          s.display_order,
          s.question_count,
          s.status AS stage_status
        FROM v2_stage_attempts sa
        INNER JOIN v2_quiz_stages s
          ON s.id = sa.stage_id
        WHERE sa.quiz_attempt_id = $1
          AND sa.user_id = $2
          AND sa.status = 'in_progress'
        ORDER BY s.display_order ASC
        LIMIT 1
        FOR UPDATE
        `,
        [attempt.id, userId]
      );

      await client.query("COMMIT");

      return {
        quiz,
        attempt,
        stageAttempt: stageAttemptResult.rows[0] || null,
        resumed: true
      };
    }

    // 3. Get first stage
    const firstStageResult = await client.query(
      `
      SELECT
        id,
        quiz_id,
        difficulty,
        display_order,
        question_count,
        status
      FROM v2_quiz_stages
      WHERE quiz_id = $1
      ORDER BY display_order ASC
      LIMIT 1
      FOR UPDATE
      `,
      [quizId]
    );

    if (!firstStageResult.rows.length) {
      const error = new Error("Quiz has no stages");
      error.statusCode = 400;
      throw error;
    }

    const firstStage = firstStageResult.rows[0];

    // First stage must have generated questions
    if (firstStage.status !== "ready") {
      const error = new Error(
        `First stage is not ready. Current status: ${firstStage.status}`
      );
      error.statusCode = 409;
      throw error;
    }

    // 4. Get next quiz attempt number
    const attemptNumberResult = await client.query(
      `
      SELECT
        COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
      FROM v2_quiz_attempts
      WHERE quiz_id = $1
        AND user_id = $2
      `,
      [quizId, userId]
    );

    const attemptNumber =
      attemptNumberResult.rows[0].attempt_number;

    // 5. Create quiz attempt
    const attemptResult = await client.query(
      `
      INSERT INTO v2_quiz_attempts (
        quiz_id,
        user_id,
        attempt_number,
        status,
        started_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'started',
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        quizId,
        userId,
        attemptNumber
      ]
    );

    const attempt = attemptResult.rows[0];

    // 6. Create first stage attempt
    const stageAttemptNumberResult = await client.query(
      `
      SELECT
        COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
      FROM v2_stage_attempts
      WHERE quiz_attempt_id = $1
        AND stage_id = $2
        AND user_id = $3
      `,
      [
        attempt.id,
        firstStage.id,
        userId
      ]
    );

    const stageAttemptNumber =
      stageAttemptNumberResult.rows[0].attempt_number;

    const stageAttemptResult = await client.query(
      `
      INSERT INTO v2_stage_attempts (
        quiz_attempt_id,
        stage_id,
        user_id,
        attempt_number,
        status,
        started_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'in_progress',
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        attempt.id,
        firstStage.id,
        userId,
        stageAttemptNumber
      ]
    );

    const stageAttempt = stageAttemptResult.rows[0];

    // 7. Move quiz to in_progress
    const updatedAttemptResult = await client.query(
      `
      UPDATE v2_quiz_attempts
      SET
        status = 'in_progress',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [attempt.id]
    );

    await client.query("COMMIT");

    return {
      quiz,
      attempt: updatedAttemptResult.rows[0],
      stage: firstStage,
      stageAttempt,
      resumed: false
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const answerQuestion = async ({
  questionId,
  userId,
  quizAttemptId,
  stageAttemptId,
  selectedOptionId,
  questionStartedAt,
  status = "answered"
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validate active stage attempt belongs to user
    const stageAttemptResult = await client.query(
      `
      SELECT
        sa.id,
        sa.quiz_attempt_id,
        sa.stage_id,
        sa.user_id,
        sa.status AS stage_attempt_status,
        qa.status AS quiz_attempt_status
      FROM v2_stage_attempts sa
      INNER JOIN v2_quiz_attempts qa
        ON qa.id = sa.quiz_attempt_id
      WHERE sa.id = $1
        AND sa.quiz_attempt_id = $2
        AND sa.user_id = $3
      FOR UPDATE
      `,
      [
        stageAttemptId,
        quizAttemptId,
        userId
      ]
    );

    if (!stageAttemptResult.rows.length) {
      const error = new Error("Stage attempt not found");
      error.statusCode = 404;
      throw error;
    }

    const stageAttempt = stageAttemptResult.rows[0];

    if (stageAttempt.stage_attempt_status !== "in_progress") {
      const error = new Error("Stage attempt is not active");
      error.statusCode = 409;
      throw error;
    }

    if (
      !["started", "in_progress"].includes(
        stageAttempt.quiz_attempt_status
      )
    ) {
      const error = new Error("Quiz attempt is not active");
      error.statusCode = 409;
      throw error;
    }

    // 2. Get question and correct answer
    const questionResult = await client.query(
      `
      SELECT
        q.id,
        q.stage_id,
        q.correct_option_key
      FROM v2_quiz_questions q
      WHERE q.id = $1
        AND q.stage_id = $2
      `,
      [
        questionId,
        stageAttempt.stage_id
      ]
    );

    if (!questionResult.rows.length) {
      const error = new Error("Question not found");
      error.statusCode = 404;
      throw error;
    }

    const question = questionResult.rows[0];

    // 3. Validate selected option
    let selectedOption = null;
    let isCorrect = null;

    if (status === "answered") {
      if (!selectedOptionId) {
        const error = new Error(
          "selectedOptionId is required when status is answered"
        );
        error.statusCode = 400;
        throw error;
      }

      const optionResult = await client.query(
        `
        SELECT
          id,
          question_id,
          option_key
        FROM v2_quiz_options
        WHERE id = $1
          AND question_id = $2
        `,
        [
          selectedOptionId,
          questionId
        ]
      );

      if (!optionResult.rows.length) {
        const error = new Error("Selected option not found");
        error.statusCode = 400;
        throw error;
      }

      selectedOption = optionResult.rows[0];

      // Correctness is determined by DB, not frontend/LLM
      isCorrect =
        selectedOption.option_key ===
        question.correct_option_key;
    }

    // 4. Calculate time taken using server time
    const answeredAt = new Date();

    let timeTakenMs = null;

    if (questionStartedAt) {
      const startedAt = new Date(questionStartedAt);

      if (!Number.isNaN(startedAt.getTime())) {
        timeTakenMs =
          answeredAt.getTime() - startedAt.getTime();

        if (timeTakenMs < 0) {
          timeTakenMs = 0;
        }
      }
    }

    // 5. Prevent duplicate answer for same question
    const existingAttemptResult = await client.query(
      `
      SELECT id
      FROM v2_question_attempts
      WHERE stage_attempt_id = $1
        AND question_id = $2
      `,
      [
        stageAttemptId,
        questionId
      ]
    );

    if (existingAttemptResult.rows.length) {
      const error = new Error(
        "Question has already been answered"
      );
      error.statusCode = 409;
      throw error;
    }

    // 6. Save raw question attempt
    const questionAttemptResult = await client.query(
      `
      INSERT INTO v2_question_attempts (
        stage_attempt_id,
        question_id,
        quiz_attempt_id,
        user_id,
        status,
        selected_option_id,
        is_correct,
        question_started_at,
        answered_at,
        time_taken_ms
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10
      )
      RETURNING *
      `,
      [
        stageAttemptId,
        questionId,
        quizAttemptId,
        userId,
        status,
        selectedOption
          ? selectedOption.id
          : null,
        isCorrect,
        questionStartedAt
          ? new Date(questionStartedAt)
          : null,
        answeredAt,
        timeTakenMs
      ]
    );

    await client.query("COMMIT");

    return {
      questionAttempt:
        questionAttemptResult.rows[0],
      isCorrect,
      timeTakenMs
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const STAGE_SCORING = {
  easy: { pointsPerQuestion: 2, passingPercentage: 70, xp: 50 },
  medium: { pointsPerQuestion: 3, passingPercentage: 70, xp: 100 },
  hard: { pointsPerQuestion: 4, passingPercentage: 70, xp: 150 }
};

const completeStage = async ({
  stageId,
  userId,
  quizAttemptId,
  stageAttemptId
}) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const attemptResult = await client.query(
      `SELECT sa.id, sa.quiz_attempt_id, sa.stage_id, sa.user_id,
              sa.attempt_number, sa.status AS stage_attempt_status,
              s.quiz_id, s.display_order, s.question_count, s.difficulty,
              s.status AS stage_status, qa.status AS quiz_attempt_status
       FROM v2_stage_attempts sa
       JOIN v2_quiz_stages s ON s.id = sa.stage_id
       JOIN v2_quiz_attempts qa ON qa.id = sa.quiz_attempt_id
       WHERE sa.id = $1 AND sa.stage_id = $2
         AND sa.quiz_attempt_id = $3 AND sa.user_id = $4
       FOR UPDATE OF sa, s, qa`,
      [stageAttemptId, stageId, quizAttemptId, userId]
    );

    if (!attemptResult.rows.length) {
      const error = new Error('Stage attempt not found'); error.statusCode = 404; throw error;
    }
    const stageAttempt = attemptResult.rows[0];
    if (stageAttempt.stage_attempt_status !== 'in_progress') {
      const error = new Error('Stage attempt is not active'); error.statusCode = 409; throw error;
    }
    if (!['started', 'in_progress'].includes(stageAttempt.quiz_attempt_status)) {
      const error = new Error('Quiz attempt is not active'); error.statusCode = 409; throw error;
    }

    const scoring = STAGE_SCORING[String(stageAttempt.difficulty).toLowerCase()];
    if (!scoring) {
      const error = new Error(`Unsupported stage difficulty: ${stageAttempt.difficulty}`); error.statusCode = 500; throw error;
    }
   
    console.log("DEBUG: Running statsResult query", {
  stageAttemptId,
  userId,
});

console.log("DEBUG: Testing statsResult minimal query");

const statsResult = await client.query( `SELECT COUNT(*)::INTEGER AS total_recorded, COUNT(*) FILTER ( WHERE status = 'answered' )::INTEGER AS answered_count, COUNT(*) FILTER ( WHERE status = 'answered' AND is_correct IS TRUE )::INTEGER AS correct_count, COUNT(*) FILTER ( WHERE status = 'answered' AND is_correct IS FALSE )::INTEGER AS incorrect_count, COUNT(*) FILTER ( WHERE status = 'skipped' )::INTEGER AS skipped_count, COUNT(*) FILTER ( WHERE status = 'timeout' )::INTEGER AS timeout_count, COALESCE(SUM(time_taken_ms), 0)::BIGINT AS total_time_taken_ms, COALESCE( AVG(time_taken_ms) FILTER ( WHERE time_taken_ms IS NOT NULL ), 0 )::NUMERIC(12, 2) AS average_time_taken_ms FROM v2_question_attempts WHERE stage_attempt_id = $1::UUID AND user_id = $2::UUID`, [stageAttemptId, userId] );

console.log("DEBUG: Minimal query succeeded", statsResult.rows[0]);
    const stats = statsResult.rows[0];
    const attemptedCount = Number(stats.total_recorded);
    if (attemptedCount !== Number(stageAttempt.question_count)) {
      const error = new Error(`Stage is not complete. ${attemptedCount} of ${stageAttempt.question_count} questions have recorded outcomes`);
      error.statusCode = 409; throw error;
    }

    const correctCount = Number(stats.correct_count);
    const totalMarks = Number(stageAttempt.question_count) * scoring.pointsPerQuestion;
    const score = correctCount * scoring.pointsPerQuestion;
    const passingMarks = Math.ceil(totalMarks * scoring.passingPercentage / 100);
    const passed = score >= passingMarks;
    const stageStatus = passed ? 'passed' : 'failed';
    const marksLost = totalMarks - score;
    const percentage = totalMarks > 0 ? Number((score / totalMarks * 100).toFixed(2)) : 0;

    const completedAttemptResult = await client.query(
      `UPDATE v2_stage_attempts SET status = $2, completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [stageAttemptId, stageStatus]
    );
    const completedStageAttempt = completedAttemptResult.rows[0];

    // A failed attempt does not complete the stage; the stage remains ready for a retry.
    let completedStage = stageAttempt.stage_status;
    if (passed) {
      const stageResult = await client.query(
        `UPDATE v2_quiz_stages SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`, [stageId]
      );
      completedStage = stageResult.rows[0];
    } else {
      const stageResult = await client.query(`SELECT * FROM v2_quiz_stages WHERE id = $1`, [stageId]);
      completedStage = stageResult.rows[0];
    }

    // Topic-wise marks lost, including skipped and timed-out questions.
    const topicResult = await client.query(
      `SELECT COALESCE(NULLIF(BTRIM(q.topic_name), ''), 'Uncategorized') AS topic_name,
              COUNT(*)::INTEGER AS question_count,
              COUNT(*) FILTER (WHERE qa.status = 'answered' AND qa.is_correct IS TRUE)::INTEGER AS correct_count,
              COUNT(*) FILTER (WHERE qa.status = 'answered' AND qa.is_correct IS FALSE)::INTEGER AS incorrect_count,
              COUNT(*) FILTER (WHERE qa.status = 'skipped')::INTEGER AS skipped_count,
              COUNT(*) FILTER (WHERE qa.status = 'timeout')::INTEGER AS timeout_count
       FROM v2_question_attempts qa
       JOIN v2_quiz_questions q ON q.id = qa.question_id
       WHERE qa.stage_attempt_id = $1 AND qa.user_id = $2
       GROUP BY COALESCE(NULLIF(BTRIM(q.topic_name), ''), 'Uncategorized')
       ORDER BY question_count DESC, topic_name ASC`,
      [stageAttemptId, userId]
    );
    const topicBreakdown = topicResult.rows.map(row => {
      const topicQuestions = Number(row.question_count);
      const topicCorrect = Number(row.correct_count);
      return {
        topicName: row.topic_name,
        questionCount: topicQuestions,
        correct: topicCorrect,
        incorrect: Number(row.incorrect_count),
        skipped: Number(row.skipped_count),
        timeout: Number(row.timeout_count),
        marksLost: (topicQuestions - topicCorrect) * scoring.pointsPerQuestion
      };
    });

    // Compare against the immediately previous attempt of this same stage in this quiz attempt.
    const previousResult = await client.query(
  `SELECT sa.id, sa.attempt_number, sa.status,
          COUNT(qa.id)::INTEGER AS question_count,
          COUNT(qa.id) FILTER (
            WHERE qa.status = 'answered'
              AND qa.is_correct IS TRUE
          )::INTEGER AS correct_count
   FROM v2_stage_attempts sa
   LEFT JOIN v2_question_attempts qa
     ON qa.stage_attempt_id = sa.id
   WHERE sa.quiz_attempt_id = $1
     AND sa.stage_id = $2
     AND sa.user_id = $3
     AND sa.attempt_number < $4::INTEGER
   GROUP BY sa.id
   ORDER BY sa.attempt_number DESC
   LIMIT 1`,
  [
    quizAttemptId,
    stageId,
    userId,
    Number(stageAttempt.attempt_number)
  ]
);
    let previousAttempt = null;
    if (previousResult.rows.length) {
      const prev = previousResult.rows[0];
      const prevCorrect = Number(prev.correct_count);
      previousAttempt = {
        stageAttemptId: prev.id,
        attemptNumber: Number(prev.attempt_number),
        status: prev.status,
        score: prevCorrect * scoring.pointsPerQuestion,
        totalMarks,
        percentage: totalMarks > 0 ? Number((prevCorrect * scoring.pointsPerQuestion / totalMarks * 100).toFixed(2)) : 0
      };
    }

    let xpTransaction = null;
    let xpAwarded = 0;
    let updatedUserStats = null;
    if (passed) {
      const xpResult = await client.query(
        `INSERT INTO v2_xp_transactions
           (user_id, xp, source_type, source_id, quiz_id, quiz_attempt_id, stage_id, difficulty, metadata)
         VALUES ($1, $2, 'stage_pass', $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (source_id) WHERE source_type = 'stage_pass' AND source_id IS NOT NULL
         DO NOTHING RETURNING *`,
        [userId, scoring.xp, stageAttemptId, stageAttempt.quiz_id, quizAttemptId,
          stageId, stageAttempt.difficulty, JSON.stringify({ difficulty: stageAttempt.difficulty, score, totalMarks, passingMarks, questionCount: Number(stageAttempt.question_count) })]
      );
      if (xpResult.rows.length) {
        xpTransaction = xpResult.rows[0];
        xpAwarded = Number(xpTransaction.xp);
        const userStatsResult = await client.query(
  `INSERT INTO v2_user_stats (user_id, total_xp, level)
   VALUES (
     $1::UUID,
     $2::INTEGER,
     FLOOR($2::NUMERIC / 500)::INTEGER + 1
   )
   ON CONFLICT (user_id)
   DO UPDATE SET
     total_xp = v2_user_stats.total_xp + EXCLUDED.total_xp,
     level = FLOOR(
       (v2_user_stats.total_xp::NUMERIC + EXCLUDED.total_xp::NUMERIC) / 500
     )::INTEGER + 1,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`,
  [userId, xpAwarded]
);
        updatedUserStats = userStatsResult.rows[0];
      }
    }

    let nextStage = null;
    let nextStageAttempt = null;
    if (passed) {
      const nextResult = await client.query(
        `SELECT * FROM v2_quiz_stages WHERE quiz_id = $1 AND display_order > $2
         ORDER BY display_order ASC LIMIT 1 FOR UPDATE`,
        [stageAttempt.quiz_id, stageAttempt.display_order]
      );
      nextStage = nextResult.rows[0] || null;
      if (nextStage) {
        // Do not duplicate an already-created next-stage attempt.
        const existingNext = await client.query(
          `SELECT * FROM v2_stage_attempts WHERE quiz_attempt_id = $1 AND stage_id = $2 AND user_id = $3
           ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE`,
          [quizAttemptId, nextStage.id, userId]
        );
        if (existingNext.rows.length) {
          nextStageAttempt = existingNext.rows[0];
        } else {
          const numberResult = await client.query(
            `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
             FROM v2_stage_attempts WHERE quiz_attempt_id = $1 AND stage_id = $2 AND user_id = $3`,
            [quizAttemptId, nextStage.id, userId]
          );
          const insertResult = await client.query(
            `INSERT INTO v2_stage_attempts (quiz_attempt_id, stage_id, user_id, attempt_number, status, started_at)
             VALUES ($1, $2, $3, $4, 'in_progress', CURRENT_TIMESTAMP) RETURNING *`,
            [quizAttemptId, nextStage.id, userId, Number(numberResult.rows[0].attempt_number)]
          );
          nextStageAttempt = insertResult.rows[0];
        }
      }
    }

    const attemptsUsed = Number(stageAttempt.attempt_number);
    const maxAttempts = 3;
    const canRetry = !passed && attemptsUsed < maxAttempts;
    const answeredCount = Number(stats.answered_count);
    const accuracy = answeredCount > 0 ? Number((correctCount / answeredCount * 100).toFixed(2)) : 0;

    await client.query('COMMIT');
    return {
      stage: completedStage,
      stageAttempt: completedStageAttempt,
      summary: {
        difficulty: stageAttempt.difficulty,
        status: stageStatus,
        passed,
        attemptNumber: attemptsUsed,
        maxAttempts,
        attemptsRemaining: Math.max(0, maxAttempts - attemptsUsed),
        questionCount: Number(stageAttempt.question_count),
        attempted: attemptedCount,
        answered: answeredCount,
        correct: correctCount,
        incorrect: Number(stats.incorrect_count),
        skipped: Number(stats.skipped_count),
        timeout: Number(stats.timeout_count),
        pointsPerQuestion: scoring.pointsPerQuestion,
        score,
        totalMarks,
        percentage,
        passingPercentage: scoring.passingPercentage,
        passingMarks,
        marksLost,
        marksRemaining: Math.max(0, totalMarks - score),
        accuracy,
        totalTimeTakenMs: Number(stats.total_time_taken_ms),
        averageTimeTakenMs: Number(stats.average_time_taken_ms),
        topicBreakdown,
        previousAttempt
      },
      xp: {
        awarded: xpAwarded,
        transaction: xpTransaction,
        totalXP: updatedUserStats ? Number(updatedUserStats.total_xp) : null,
        level: updatedUserStats ? Number(updatedUserStats.level) : null
      },
      nextStage,
      nextStageAttempt,
      canRetry,
      canContinue: passed && Boolean(nextStage),
      quizCompleted: passed && !nextStage
    };
    } catch (error) {
  console.error("completeStage failed:", {
    message: error.message,
    code: error.code,
    position: error.position,
    detail: error.detail,
    stack: error.stack,
  });

  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
};
//   } catch (error) {
//     await client.query('ROLLBACK');
//     throw error;
//   } finally {
//     client.release();
//   }
// };

const retryStageAttempt = async ({ stageId, userId, quizAttemptId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT qa.id AS quiz_attempt_id, qa.status AS quiz_status, qa.quiz_id,
              s.id AS stage_id, s.difficulty, s.display_order, s.status AS stage_status,
              sa.id AS latest_stage_attempt_id, sa.attempt_number, sa.status AS latest_status
       FROM v2_quiz_attempts qa
       JOIN v2_quiz_stages s ON s.quiz_id = qa.quiz_id AND s.id = $1
       LEFT JOIN LATERAL (
         SELECT id, attempt_number, status FROM v2_stage_attempts
         WHERE quiz_attempt_id = qa.id AND stage_id = s.id AND user_id = qa.user_id
         ORDER BY attempt_number DESC LIMIT 1
       ) sa ON TRUE
       WHERE qa.id = $2 AND qa.user_id = $3
       FOR UPDATE OF qa, s`,
      [stageId, quizAttemptId, userId]
    );
    if (!currentResult.rows.length) {
      const error = new Error('Stage or quiz attempt not found'); error.statusCode = 404; throw error;
    }
    const current = currentResult.rows[0];
    if (!['started', 'in_progress'].includes(current.quiz_status)) {
      const error = new Error('Quiz attempt is not active'); error.statusCode = 409; throw error;
    }
    if (current.latest_status !== 'failed') {
      const error = new Error('Only a failed stage attempt can be retried'); error.statusCode = 409; throw error;
    }
    if (Number(current.attempt_number) >= 3) {
      const error = new Error('Maximum of 3 attempts reached for this stage'); error.statusCode = 409; throw error;
    }
    const activeResult = await client.query(
      `SELECT id FROM v2_stage_attempts WHERE quiz_attempt_id = $1 AND user_id = $2 AND status = 'in_progress' FOR UPDATE`,
      [quizAttemptId, userId]
    );
    if (activeResult.rows.length) {
      const error = new Error('Another stage attempt is already active'); error.statusCode = 409; throw error;
    }
    const retryResult = await client.query(
      `INSERT INTO v2_stage_attempts (quiz_attempt_id, stage_id, user_id, attempt_number, status, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress', CURRENT_TIMESTAMP) RETURNING *`,
      [quizAttemptId, stageId, userId, Number(current.attempt_number) + 1]
    );
    await client.query('COMMIT');
    return { quizId: current.quiz_id, stageId, quizAttemptId, stageAttempt: retryResult.rows[0], attemptNumber: Number(current.attempt_number) + 1, maxAttempts: 3 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const completeQuiz = async ({
  quizId,
  userId,
  quizAttemptId
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validate quiz attempt belongs to user and quiz
    const attemptResult = await client.query(
      `
      SELECT
        qa.*,
        q.topic_name,
        q.time_per_question_seconds
      FROM v2_quiz_attempts qa
      INNER JOIN v2_quizzes q
        ON q.id = qa.quiz_id
      WHERE qa.id = $1
        AND qa.quiz_id = $2
        AND qa.user_id = $3
      FOR UPDATE
      `,
      [quizAttemptId, quizId, userId]
    );

    if (!attemptResult.rows.length) {
      const error = new Error("Quiz attempt not found");
      error.statusCode = 404;
      throw error;
    }

    const quizAttempt = attemptResult.rows[0];

    // 2. Quiz attempt must still be active
    if (!["started", "in_progress"].includes(quizAttempt.status)) {
      const error = new Error(
        `Quiz attempt cannot be completed. Current status: ${quizAttempt.status}`
      );
      error.statusCode = 409;
      throw error;
    }

    // 3. Verify all stages are completed
    const stagesResult = await client.query(
      `
      SELECT
        s.id,
        s.difficulty,
        s.display_order,
        s.question_count,
        s.status,
        sa.id AS stage_attempt_id,
        sa.status AS stage_attempt_status,
        sa.completed_at
      FROM v2_quiz_stages s
      LEFT JOIN LATERAL (
        SELECT
          id,
          status,
          completed_at
        FROM v2_stage_attempts
        WHERE stage_id = s.id
          AND quiz_attempt_id = $1
          AND user_id = $2
        ORDER BY attempt_number DESC
        LIMIT 1
      ) sa ON true
      WHERE s.quiz_id = $3
      ORDER BY s.display_order ASC
      `,
      [quizAttemptId, userId, quizId]
    );

    const stages = stagesResult.rows;

    if (!stages.length) {
      const error = new Error("Quiz has no stages");
      error.statusCode = 409;
      throw error;
    }

    const incompleteStage = stages.find(
      (stage) =>
        stage.status !== "completed" ||
        stage.stage_attempt_status !== "passed"
    );

    if (incompleteStage) {
      const error = new Error(
        `Quiz is not complete. ${incompleteStage.difficulty} stage is not completed`
      );
      error.statusCode = 409;
      throw error;
    }

    // 4. Calculate final quiz numbers from raw question attempts
    const statsResult = await client.query(
      `
      SELECT
        COUNT(*)::INTEGER AS total_questions,
        COUNT(*) FILTER (
          WHERE status = 'answered'
        )::INTEGER AS answered_count,
        COUNT(*) FILTER (
          WHERE status = 'skipped'
        )::INTEGER AS skipped_count,
        COUNT(*) FILTER (
          WHERE status = 'timeout'
        )::INTEGER AS timeout_count,
        COUNT(*) FILTER (
          WHERE status = 'answered'
            AND is_correct = TRUE
        )::INTEGER AS correct_count,
        COUNT(*) FILTER (
          WHERE status = 'answered'
            AND is_correct = FALSE
        )::INTEGER AS incorrect_count,
        COALESCE(
          SUM(time_taken_ms),
          0
        )::BIGINT AS total_time_taken_ms,
        COALESCE(
          AVG(time_taken_ms) FILTER (
            WHERE status = 'answered'
              AND time_taken_ms IS NOT NULL
          ),
          0
        )::NUMERIC(12,2) AS average_time_taken_ms
      FROM v2_question_attempts
      WHERE quiz_attempt_id = $1
        AND user_id = $2
      `,
      [quizAttemptId, userId]
    );

    const stats = statsResult.rows[0];

    const totalQuestions = Number(stats.total_questions);
    const answeredCount = Number(stats.answered_count);
    const correctCount = Number(stats.correct_count);
    const incorrectCount = Number(stats.incorrect_count);
    const skippedCount = Number(stats.skipped_count);
    const timeoutCount = Number(stats.timeout_count);

    const accuracy =
      answeredCount > 0
        ? Number(
            ((correctCount / answeredCount) * 100).toFixed(2)
          )
        : 0;

    // 5. Complete quiz attempt
    const completedAttemptResult = await client.query(
      `
      UPDATE v2_quiz_attempts
      SET
        status = 'completed',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [quizAttemptId]
    );

    const completedAttempt =
      completedAttemptResult.rows[0];

    // 6. Build stage summary
    const stageSummary = [];

    for (const stage of stages) {
      const stageStatsResult = await client.query(
        `
        SELECT
          COUNT(*)::INTEGER AS total_questions,
          COUNT(*) FILTER (
            WHERE qa.status = 'answered'
          )::INTEGER AS answered_count,
          COUNT(*) FILTER (
            WHERE qa.status = 'answered'
              AND qa.is_correct = TRUE
          )::INTEGER AS correct_count,
          COUNT(*) FILTER (
            WHERE qa.status = 'answered'
              AND qa.is_correct = FALSE
          )::INTEGER AS incorrect_count,
          COUNT(*) FILTER (
            WHERE qa.status = 'skipped'
          )::INTEGER AS skipped_count,
          COUNT(*) FILTER (
            WHERE qa.status = 'timeout'
          )::INTEGER AS timeout_count,
          COALESCE(
            SUM(qa.time_taken_ms),
            0
          )::BIGINT AS total_time_taken_ms
        FROM v2_question_attempts qa
        WHERE qa.stage_attempt_id = $1
          AND qa.user_id = $2
        `,
        [stage.stage_attempt_id, userId]
      );

      const stageStats = stageStatsResult.rows[0];

      const stageAnswered = Number(
        stageStats.answered_count
      );

      const stageCorrect = Number(
        stageStats.correct_count
      );

      stageSummary.push({
        stageId: stage.id,
        stageAttemptId: stage.stage_attempt_id,
        difficulty: stage.difficulty,
        displayOrder: stage.display_order,
        questionCount: stage.question_count,
        status: stage.status,
        totalQuestions: Number(
          stageStats.total_questions
        ),
        answered: stageAnswered,
        correct: stageCorrect,
        incorrect: Number(
          stageStats.incorrect_count
        ),
        skipped: Number(
          stageStats.skipped_count
        ),
        timeout: Number(
          stageStats.timeout_count
        ),
        accuracy:
          stageAnswered > 0
            ? Number(
                (
                  (stageCorrect / stageAnswered) *
                  100
                ).toFixed(2)
              )
            : 0,
        totalTimeTakenMs: Number(
          stageStats.total_time_taken_ms
        )
      });
    }

    await client.query("COMMIT");

    return {
      quizAttempt: completedAttempt,

      summary: {
        totalQuestions,
        answered: answeredCount,
        correct: correctCount,
        incorrect: incorrectCount,
        skipped: skippedCount,
        timeout: timeoutCount,
        accuracy,
        totalTimeTakenMs: Number(
          stats.total_time_taken_ms
        ),
        averageTimeTakenMs: Number(
          stats.average_time_taken_ms
        )
      },

      stages: stageSummary
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getReviewSession = async ({ quizAttemptId, userId }) => {
  const result = await pool.query(
    `
    SELECT
      qa.id AS question_attempt_id,
      qa.quiz_attempt_id,
      qa.stage_attempt_id,
      qa.question_id,
      qa.status AS answer_status,
      qa.selected_option_id,
      qa.is_correct,
      qa.time_taken_ms,
      qa.answered_at,

      q.display_order,
      q.question_text,
      q.question_type,
      q.topic_name,
      q.explanation,
      q.correct_option_key,

      selected.option_key AS selected_option_key,
      selected.option_text AS selected_option_text,

      correct.option_text AS correct_option_text,

      COALESCE(
        options.all_options,
        '[]'::jsonb
      ) AS options,

      qr.mistake_category,
      COALESCE(
        qr.review_status,
        'needs_review'
      ) AS review_status

    FROM v2_question_attempts qa

    INNER JOIN v2_quiz_attempts quiz_attempt
      ON quiz_attempt.id = qa.quiz_attempt_id

    INNER JOIN v2_quiz_questions q
      ON q.id = qa.question_id

    LEFT JOIN v2_quiz_options selected
      ON selected.id = qa.selected_option_id

    LEFT JOIN v2_quiz_options correct
      ON correct.question_id = q.id
     AND correct.option_key = q.correct_option_key

    LEFT JOIN v2_question_reviews qr
      ON qr.question_id = qa.question_id
     AND qr.user_id = qa.user_id

    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'key', o.option_key,
          'text', o.option_text,
          'displayOrder', o.display_order
        )
        ORDER BY o.display_order
      ) AS all_options
      FROM v2_quiz_options o
      WHERE o.question_id = q.id
    ) options ON TRUE

    WHERE qa.quiz_attempt_id = $1
      AND qa.user_id = $2
      AND quiz_attempt.user_id = $2

    ORDER BY
      qa.created_at ASC,
      q.display_order ASC
    `,
    [quizAttemptId, userId]
  );

  return {
    questions: result.rows.map((row) => ({
      questionAttemptId: row.question_attempt_id,
      quizAttemptId: row.quiz_attempt_id,
      stageAttemptId: row.stage_attempt_id,
      questionId: row.question_id,

      displayOrder: row.display_order,
      questionText: row.question_text,
      questionType: row.question_type,
      topicName: row.topic_name,
      explanation: row.explanation,

      answerStatus: row.answer_status,
      isCorrect: row.is_correct,

      selectedOptionId: row.selected_option_id,
      selectedOptionKey: row.selected_option_key,
      selectedOptionText: row.selected_option_text,

      correctOptionKey: row.correct_option_key,
      correctOptionText: row.correct_option_text,

      options: row.options,

      timeTakenMs:
        row.time_taken_ms === null
          ? null
          : Number(row.time_taken_ms),

      answeredAt: row.answered_at,

      mistakeCategory: row.mistake_category,
      reviewStatus: row.review_status
    }))
  };
};


const updateQuestionReview = async ({
  questionId,
  userId,
  mistakeCategory,
  reviewStatus
}) => {
  const allowedCategories = [
    "concept",
    "calculation",
    "misread",
    "guess",
    "time"
  ];

  const allowedStatuses = [
    "needs_review",
    "understood",
    "practice_again"
  ];

  if (
    mistakeCategory !== undefined &&
    mistakeCategory !== null &&
    !allowedCategories.includes(mistakeCategory)
  ) {
    const error = new Error("Invalid mistake category");
    error.statusCode = 400;
    throw error;
  }

  if (
    reviewStatus !== undefined &&
    !allowedStatuses.includes(reviewStatus)
  ) {
    const error = new Error("Invalid review status");
    error.statusCode = 400;
    throw error;
  }

  if (
    mistakeCategory === undefined &&
    reviewStatus === undefined
  ) {
    const error = new Error(
      "Provide mistakeCategory or reviewStatus"
    );
    error.statusCode = 400;
    throw error;
  }

  // A review tag is permitted only for a question
  // the authenticated user has answered incorrectly.
  const attemptResult = await pool.query(
    `
    SELECT 1
    FROM v2_question_attempts
    WHERE question_id = $1
      AND user_id = $2
      AND status = 'answered'
      AND is_correct = FALSE
    LIMIT 1
    `,
    [questionId, userId]
  );

  if (!attemptResult.rows.length) {
    const error = new Error(
      "No incorrect answer found for this question"
    );
    error.statusCode = 404;
    throw error;
  }

  const result = await pool.query(
    `
    INSERT INTO v2_question_reviews (
      user_id,
      question_id,
      mistake_category,
      review_status
    )
    VALUES (
      $1,
      $2,
      $3,
      $4
    )
    ON CONFLICT (user_id, question_id)
    DO UPDATE SET
      mistake_category = CASE
        WHEN $5::boolean THEN EXCLUDED.mistake_category
        ELSE v2_question_reviews.mistake_category
      END,
      review_status = CASE
        WHEN $6::boolean THEN EXCLUDED.review_status
        ELSE v2_question_reviews.review_status
      END,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      userId,
      questionId,
      mistakeCategory ?? null,
      reviewStatus ?? "needs_review",
      mistakeCategory !== undefined,
      reviewStatus !== undefined
    ]
  );

  return result.rows[0];
};

const getQuestionAnswerStatistics = async ({
  questionId
}) => {
  const result = await pool.query(
    `
    SELECT
      o.id AS option_id,
      o.option_key,
      o.option_text,
      o.display_order,

      COUNT(qa.id)::INTEGER AS answer_count

    FROM v2_quiz_options o

    LEFT JOIN v2_question_attempts qa
      ON qa.question_id = o.question_id
     AND qa.selected_option_id = o.id
     AND qa.status = 'answered'
     AND qa.is_correct IS NOT NULL

    WHERE o.question_id = $1

    GROUP BY
      o.id,
      o.option_key,
      o.option_text,
      o.display_order

    ORDER BY o.display_order ASC
    `,
    [questionId]
  );

  if (!result.rows.length) {
    const error = new Error("Question not found");
    error.statusCode = 404;
    throw error;
  }

  const totalAnswers = result.rows.reduce(
    (sum, row) => sum + Number(row.answer_count),
    0
  );

  return {
    questionId,
    totalAnswers,
    options: result.rows.map((row) => ({
      optionId: row.option_id,
      optionKey: row.option_key,
      optionText: row.option_text,
      answerCount: Number(row.answer_count),
      percentage:
        totalAnswers > 0
          ? Number(
              (
                Number(row.answer_count) /
                totalAnswers *
                100
              ).toFixed(2)
            )
          : 0
    }))
  };
};


const SUPPORTED_ACTIONS = [
  "why_is_my_answer_wrong",
  "show_steps",
  "explain_simpler",
  "similar_question",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


const validateRequest = ({
  questionId,
  quizAttemptId,
  action,
}) => {
  if (!UUID_REGEX.test(questionId || "")) {
    const error = new Error("Invalid questionId");
    error.statusCode = 400;
    throw error;
  }

  if (
    quizAttemptId &&
    !UUID_REGEX.test(quizAttemptId)
  ) {
    const error = new Error("Invalid quizAttemptId");
    error.statusCode = 400;
    throw error;
  }

  if (!SUPPORTED_ACTIONS.includes(action)) {
    const error = new Error(
      `Unsupported action. Allowed actions: ${SUPPORTED_ACTIONS.join(", ")}`
    );

    error.statusCode = 400;
    throw error;
  }
};


/**
 * Fetch authoritative question context from PostgreSQL.
 *
 * Never trust frontend-supplied correct answers or selected answers.
 * The authenticated user must own the question attempt.
 */


const getQuestionContext = async ({
  userId,
  questionId,
  quizAttemptId,
}) => {
  const query = `
    SELECT
      q.id AS question_id,
      q.question_text,
      q.explanation,
      q.topic_key,
      q.correct_option_key,

      qa.quiz_attempt_id,
      qa.selected_option_id,
      qa.is_correct,
      qa.created_at AS attempt_created_at,

      COALESCE(
        json_agg(
          json_build_object(
            'optionId', o.id,
            'optionKey', o.option_key,
            'optionText', o.option_text
          )
          ORDER BY o.option_key
        ) FILTER (WHERE o.id IS NOT NULL),
        '[]'::json
      ) AS options

    FROM v2_quiz_questions q

    JOIN v2_question_attempts qa
      ON qa.question_id = q.id

    LEFT JOIN v2_quiz_options o
      ON o.question_id = q.id

    WHERE q.id = $1::uuid
      AND qa.user_id = $2::uuid
      AND (
        $3::uuid IS NULL
        OR qa.quiz_attempt_id = $3::uuid
      )

    GROUP BY
      q.id,
      q.question_text,
      q.explanation,
      q.topic_key,
      q.correct_option_key,
      qa.quiz_attempt_id,
      qa.selected_option_id,
      qa.is_correct,
      qa.created_at

    ORDER BY qa.created_at DESC

    LIMIT 1
  `;

  const result = await pool.query(query, [
    questionId,
    userId,
    quizAttemptId || null,
  ]);

  if (result.rows.length === 0) {
    const error = new Error(
      "Question attempt not found for this user"
    );

    error.statusCode = 404;
    throw error;
  }

  const row = result.rows[0];

  const options =
    typeof row.options === "string"
      ? JSON.parse(row.options)
      : row.options;

  const selectedOption = options.find(
    (option) =>
      String(option.optionId) ===
      String(row.selected_option_id)
  );

  const correctOptionKey = row.correct_option_key
    ? String(row.correct_option_key)
    : "";

  const correctOption = options.find(
    (option) =>
      String(option.optionKey) === correctOptionKey
  );

  return {
    questionId: String(row.question_id),

    topicId: row.topic_key
      ? String(row.topic_key)
      : null,

    questionText: row.question_text,

    explanation: row.explanation,

    options,

    selectedOptionId: selectedOption
      ? String(selectedOption.optionId)
      : null,

    selectedAnswer: selectedOption
      ? String(selectedOption.optionKey)
      : null,

    correctOptionKey,

    correctAnswer: correctOptionKey,

    mistakeCategory: null,

    isCorrect: row.is_correct,

    quizAttemptId: row.quiz_attempt_id
      ? String(row.quiz_attempt_id)
      : null,
  };
};





const askAI = async ({
  userId,
  questionId = null,
  quizAttemptId = null,
  action,
  userMessage = null,
  conversationId = null,
  conversationType = "ai_tutor",
}) => {
  const supportedActions = [
    "why_is_my_answer_wrong",
    "show_steps",
    "explain_simpler",
    "similar_question",
    "ask_question",
  ];

  if (!supportedActions.includes(action)) {
    const error = new Error("Unsupported AI Tutor action");
    error.statusCode = 400;
    throw error;
  }

  if (!["ai_tutor", "general_chatbot"].includes(conversationType)) {
    const error = new Error("Invalid conversationType");
    error.statusCode = 400;
    throw error;
  }

  if (
    action === "ask_question" &&
    (!userMessage || !userMessage.trim())
  ) {
    const error = new Error("userMessage is required for ask_question");
    error.statusCode = 400;
    throw error;
  }

  if (conversationType === "ai_tutor" && !questionId) {
    const error = new Error(
      "questionId is required for an AI Tutor quiz conversation"
    );
    error.statusCode = 400;
    throw error;
  }

  if (conversationType === "general_chatbot" && action !== "ask_question") {
    const error = new Error(
      "General chatbot currently supports ask_question only"
    );
    error.statusCode = 400;
    throw error;
  }

  let questionContext = null;

  if (conversationType === "ai_tutor") {
    questionContext = await getQuestionContext({
      userId,
      questionId,
      quizAttemptId,
    });
  }

  const client = await pool.connect();

  let resolvedConversationId;

  try {
    await client.query("BEGIN");

    if (conversationId) {
      const existing = await client.query(
        `SELECT id, user_id, conversation_type, question_id, quiz_attempt_id
         FROM v2_ai_tutor_conversations
         WHERE id = $1::uuid
           AND user_id = $2::uuid
         FOR UPDATE`,
        [conversationId, userId]
      );

      if (!existing.rows.length) {
        const error = new Error("Conversation not found");
        error.statusCode = 404;
        throw error;
      }

      const conversation = existing.rows[0];

      if (conversation.conversation_type !== conversationType) {
        const error = new Error("Conversation type does not match");
        error.statusCode = 400;
        throw error;
      }

      if (
        conversationType === "ai_tutor" &&
        String(conversation.question_id) !== String(questionId)
      ) {
        const error = new Error(
          "Conversation does not belong to this question"
        );
        error.statusCode = 400;
        throw error;
      }

      resolvedConversationId = conversation.id;

      await client.query(
        `UPDATE v2_ai_tutor_conversations
         SET updated_at = NOW()
         WHERE id = $1::uuid`,
        [resolvedConversationId]
      );
    } else {
      const title =
        userMessage?.trim().slice(0, 100) ||
        questionContext?.questionText?.slice(0, 100) ||
        "New conversation";

      const created = await client.query(
        `INSERT INTO v2_ai_tutor_conversations (
           user_id,
           conversation_type,
           question_id,
           quiz_attempt_id,
           title
         )
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5)
         RETURNING id`,
        [
          userId,
          conversationType,
          questionId,
          quizAttemptId,
          title,
        ]
      );

      resolvedConversationId = created.rows[0].id;
    }

    // Store the student's custom message.
    // Predefined actions do not require a user message.
    if (userMessage?.trim()) {
      await client.query(
        `INSERT INTO v2_ai_tutor_messages (
           user_id,
           question_id,
           quiz_attempt_id,
           conversation_id,
           role,
           content,
           action,
           created_at
         )
         VALUES (
           $1::uuid,
           $2::uuid,
           $3::uuid,
           $4::uuid,
           'user',
           $5,
           $6,
           NOW()
         )`,
        [
          userId,
          questionId,
          quizAttemptId,
          resolvedConversationId,
          userMessage.trim(),
          action,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Load prior messages for this conversation.

const historyResult = await pool.query(
  `SELECT role, content
   FROM (
     SELECT id, role, content, created_at
     FROM v2_ai_tutor_messages
     WHERE conversation_id = $1::uuid
       AND user_id = $2::uuid
     ORDER BY created_at DESC, id DESC
     LIMIT 50
   ) recent_messages
   ORDER BY created_at ASC, id ASC`,
  [resolvedConversationId, userId]
);

const conversation = historyResult.rows;


  console.log(
    "AI Tutor request:",
    JSON.stringify(
      {
        userId,
        questionId,
        action,
        conversationId: resolvedConversationId,
        conversationType,
        questionContext,
        conversation,
        userMessage,
      },
      null,
      2
    )
  );

  const job = await aiTutorQueue.add(
    "ai-tutor-response",
    {
      userId: String(userId),
      questionId: questionId ? String(questionId) : null,
      quizAttemptId: quizAttemptId ? String(quizAttemptId) : null,
      conversationId: String(resolvedConversationId),
      conversationType,
      action,
      userMessage: userMessage?.trim() || "",
      questionContext,
      conversation,
    },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
      },
    }
  );

  return {
    jobId: String(job.id),
    status: "queued",
    questionId: questionId ? String(questionId) : null,
    conversationId: String(resolvedConversationId),
    conversationType,
    action,
  };
};






/**
 * Retrieve the status and result of an existing AI Tutor job.
 */
const getJobStatus = async (jobId) => {
  if (!jobId || typeof jobId !== "string") {
    const error = new Error("Invalid jobId");
    error.statusCode = 400;
    throw error;
  }

  const job = await aiTutorQueue.getJob(jobId);

  if (!job) {
    const error = new Error(
      "AI Tutor job not found. It may have expired or been removed."
    );

    error.statusCode = 404;
    throw error;
  }

  const state = await job.getState();

  const response = {
    jobId: String(job.id),
    name: job.name,
    status: state,
    questionId: job.data.questionId,
    action: job.data.action,
  };

  if (state === "completed") {
    response.result = job.returnvalue;
  }

  if (state === "failed") {
    response.error = job.failedReason;
  }

  if (state === "active" || state === "waiting") {
    response.progress = job.progress;
  }

  return response;
};



module.exports = {
  createQuiz,
  getQuizById,
  addQuizSource,
  getQuizSources,
  deleteQuizSource,
    getUserQuizzes,
    getQuizStages,
    startStageGeneration,
    getStageById,
    getStageQuestions,
    getQuestionById,
    startQuizAttempt,
    answerQuestion,
    completeStage,
    retryStageAttempt,
    completeQuiz,
    getReviewSession,
    updateQuestionReview,
    getQuestionAnswerStatistics,
    askAI,
    getJobStatus,
    getQuestionContext,
};