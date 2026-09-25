const pool = require("../../config/db");

const createQuiz = async ({
  userId,
  topicName,
  description,
  sourceType,
  timePerQuestionSeconds,
  stages
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const easyCount = stages?.easy;
    const mediumCount = stages?.medium;
    const hardCount = stages?.hard;

    // Validate stage configuration
    for (const [difficulty, count] of Object.entries({
      easy: easyCount,
      medium: mediumCount,
      hard: hardCount
    })) {
      if (
        !Number.isInteger(count) ||
        count <= 0
      ) {
        const error = new Error(
          `${difficulty} question count must be a positive integer`
        );
        error.statusCode = 400;
        throw error;
      }
    }

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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'draft',
        $5
      )
      RETURNING *
      `,
      [
        userId,
        topicName,
        description || null,
        sourceType,
        timePerQuestionSeconds
      ]
    );

    const quiz = quizResult.rows[0];

    // Create stages
    const stageDefinitions = [
      {
        difficulty: "easy",
        displayOrder: 1,
        questionCount: easyCount
      },
      {
        difficulty: "medium",
        displayOrder: 2,
        questionCount: mediumCount
      },
      {
        difficulty: "hard",
        displayOrder: 3,
        questionCount: hardCount
      }
    ];

    const stagesResult = [];

    for (const stage of stageDefinitions) {
      const result = await client.query(
        `
        INSERT INTO v2_quiz_stages (
          quiz_id,
          difficulty,
          display_order,
          question_count,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'pending'
        )
        RETURNING *
        `,
        [
          quiz.id,
          stage.difficulty,
          stage.displayOrder,
          stage.questionCount
        ]
      );

      stagesResult.push(result.rows[0]);
    }

    await client.query("COMMIT");

    return {
      ...quiz,
      stages: stagesResult
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
  userId
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

    if (stage.status === "ready") {
      const error = new Error(
        "Stage has already been generated"
      );
      error.statusCode = 409;
      throw error;
    }

    if (
      stage.status === "in_progress" ||
      stage.status === "completed"
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

const completeStage = async ({
  stageId,
  userId,
  quizAttemptId,
  stageAttemptId
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validate active stage attempt
    const stageAttemptResult = await client.query(
      `
      SELECT
        sa.id,
        sa.quiz_attempt_id,
        sa.stage_id,
        sa.user_id,
        sa.status AS stage_attempt_status,
        s.quiz_id,
        s.display_order,
        s.question_count,
        s.status AS stage_status,
        qa.status AS quiz_attempt_status
      FROM v2_stage_attempts sa
      INNER JOIN v2_quiz_stages s
        ON s.id = sa.stage_id
      INNER JOIN v2_quiz_attempts qa
        ON qa.id = sa.quiz_attempt_id
      WHERE sa.id = $1
        AND sa.stage_id = $2
        AND sa.quiz_attempt_id = $3
        AND sa.user_id = $4
      FOR UPDATE
      `,
      [
        stageAttemptId,
        stageId,
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

    // 2. Count attempted questions
    const attemptedResult = await client.query(
      `
      SELECT COUNT(*)::INTEGER AS attempted_count
      FROM v2_question_attempts
      WHERE stage_attempt_id = $1
      `,
      [stageAttemptId]
    );

    const attemptedCount =
      attemptedResult.rows[0].attempted_count;

    if (attemptedCount < stageAttempt.question_count) {
      const error = new Error(
        `Stage is not complete. ${attemptedCount} of ${stageAttempt.question_count} questions attempted`
      );
      error.statusCode = 409;
      throw error;
    }

    // 3. Complete stage attempt
    const completedStageAttemptResult = await client.query(
      `
      UPDATE v2_stage_attempts
      SET
        status = 'passed',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [stageAttemptId]
    );

    const completedStageAttempt =
      completedStageAttemptResult.rows[0];

    // 4. Mark stage completed
    const completedStageResult = await client.query(
      `
      UPDATE v2_quiz_stages
      SET
        status = 'completed',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [stageId]
    );

    const completedStage =
      completedStageResult.rows[0];

    // 5. Find next stage
    const nextStageResult = await client.query(
      `
      SELECT *
      FROM v2_quiz_stages
      WHERE quiz_id = $1
        AND display_order > $2
      ORDER BY display_order ASC
      LIMIT 1
      FOR UPDATE
      `,
      [
        stageAttempt.quiz_id,
        stageAttempt.display_order
      ]
    );

    const nextStage = nextStageResult.rows[0] || null;

    // 6. If another stage exists, create its stage attempt
    let nextStageAttempt = null;

    if (nextStage) {
      const attemptNumberResult = await client.query(
        `
        SELECT
          COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
        FROM v2_stage_attempts
        WHERE quiz_attempt_id = $1
          AND stage_id = $2
          AND user_id = $3
        `,
        [
          quizAttemptId,
          nextStage.id,
          userId
        ]
      );

      const attemptNumber =
        attemptNumberResult.rows[0].attempt_number;

      const nextStageAttemptResult = await client.query(
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
          quizAttemptId,
          nextStage.id,
          userId,
          attemptNumber
        ]
      );

      nextStageAttempt =
        nextStageAttemptResult.rows[0];
    }

    await client.query("COMMIT");

    return {
      stage: completedStage,
      stageAttempt: completedStageAttempt,
      attemptedCount,
      nextStage,
      nextStageAttempt
    };
  } catch (error) {
    await client.query("ROLLBACK");
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
    completeQuiz

};