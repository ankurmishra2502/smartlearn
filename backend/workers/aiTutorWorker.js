const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});
console.log("DB diagnostic:", {
  dbUser: process.env.DB_USER,
  dbHost: process.env.DB_HOST,
  dbName: process.env.DB_NAME,
  passwordType: typeof process.env.DB_PASSWORD,
  passwordPresent: Boolean(process.env.DB_PASSWORD),
});

const { Worker } = require("bullmq");
const Redis = require("ioredis");
const pool = require("../config/db");

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:8000";

// ==========================================
// AI TUTOR WORKER
// ==========================================

const worker = new Worker(
  "ai-tutor",
  async (job) => {

    // ==========================================
    // PRACTICE QUESTION GENERATION
    // ==========================================
    console.log("BULLMQ JOB RECEIVED:", {
  jobId: job.id,
  jobName: job.name,
  queueName: job.queueName,
});

    if (job.name === "generate-practice-question") {
      const {
        userId,
        questionId,
        questionContext,
      } = job.data;

      console.log("Practice generation job started", {
        jobId: job.id,
        userId,
        questionId,
      });

      if (!userId || !questionId || !questionContext) {
        throw new Error(
          "userId, questionId and questionContext are required"
        );
      }

      const response = await fetch(
        `${AI_SERVICE_URL}/internal/v1/practice/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: String(userId),
            questionId: String(questionId),
            questionContext,
          }),
          signal: AbortSignal.timeout(120000),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();

        console.error("Practice generation service failed", {
          jobId: job.id,
          status: response.status,
          body: errorBody,
        });

        throw new Error(
          `Practice generation service returned HTTP ${response.status}: ${errorBody}`
        );
      }

      const result = await response.json();

      if (!result.success || !result.question) {
        throw new Error(
          result.message ||
          "Practice question generation failed"
        );
      }

      const generatedQuestion = result.question;

// Persist the generated question.
const insertResult = await pool.query(
  `
  INSERT INTO v2_mistake_practice_attempts (
    user_id,
    original_question_id,
    generated_question
  )
  VALUES (
    $1::uuid,
    $2::uuid,
    $3::jsonb
  )
  RETURNING id, created_at
  `,
  [
    userId,
    questionId,
    JSON.stringify(generatedQuestion),
  ]
);

const practiceAttempt = insertResult.rows[0];

console.log("Practice question generated and saved", {
  jobId: job.id,
  questionId,
  practiceAttemptId: practiceAttempt.id,
});

return {
  success: true,
  userId,
  questionId,
  practiceAttemptId: practiceAttempt.id,
  createdAt: practiceAttempt.created_at,
};

      return result;
    }

    // ==========================================
    // EXISTING AI TUTOR PROCESSING
    // ==========================================

    const {
      userId,
      questionId,
      quizAttemptId,
      conversationId,
      conversationType = "ai_tutor",
      action,
      userMessage,
      questionContext,
      conversation = [],
    } = job.data;

    console.log("AI Tutor job started", {
      jobId: job.id,
      userId,
      questionId,
      conversationId,
      conversationType,
      action,
    });

    // Normalize the question context for the Python service.
    const pythonQuestionContext = questionContext
      ? {
          questionText: questionContext.questionText,
          options: (questionContext.options || []).map((option) => ({
            optionId: option.optionId,
            optionKey: option.optionKey,
            optionText: option.optionText,
          })),
          selectedOptionId: questionContext.selectedOptionId,
          selectedAnswer: questionContext.selectedAnswer,
          correctOptionKey: questionContext.correctOptionKey,
          correctAnswer: questionContext.correctAnswer,
          explanation: questionContext.explanation,
          mistakeCategory: questionContext.mistakeCategory,
          topicName: questionContext.topicName,
        }
      : null;

    const pythonPayload = {
      userId: String(userId),
      questionId: questionId ? String(questionId) : null,
      quizAttemptId: quizAttemptId
        ? String(quizAttemptId)
        : null,
      conversationId: conversationId
        ? String(conversationId)
        : null,
      conversationType,
      action,
      userMessage: userMessage || null,
      questionContext: pythonQuestionContext,
      conversation,
    };

    console.log("AI Tutor Python request", {
      jobId: job.id,
      conversationId,
      conversationType,
      action,
      hasUserMessage: Boolean(userMessage),
      historyMessageCount: conversation.length,
    });

    const response = await fetch(
      `${AI_SERVICE_URL}/internal/v1/ai-tutor/respond`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pythonPayload),
        signal: AbortSignal.timeout(120000),
      }
    );

    // Handle HTTP errors so BullMQ can retry failed jobs.
    if (!response.ok) {
      const errorBody = await response.text();

      console.error("AI Tutor Python service failed", {
        jobId: job.id,
        status: response.status,
        body: errorBody,
      });

      throw new Error(
        `AI Tutor service returned HTTP ${response.status}: ${errorBody}`
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(
        result.message ||
        "AI Tutor service returned an unsuccessful response"
      );
    }

    console.log("AI Tutor Python response received", {
      jobId: job.id,
      questionId: result.questionId,
      conversationId: result.conversationId,
      action: result.action,
    });

    // BullMQ stores this return value for the existing job-status API.
    return result;
  },
  {
    connection,
    concurrency: 3,
  }
);

// ==========================================
// WORKER EVENTS
// ==========================================

worker.on("completed", (job, result) => {
  console.log(`AI Tutor job completed: ${job.id}`, {
    jobName: job.name,
    conversationId: result?.conversationId,
  });
});

worker.on("failed", (job, error) => {
  console.error(
    `AI Tutor job failed: ${job?.id}`,
    error.message
  );
});

worker.on("error", (error) => {
  console.error("AI Tutor worker error:", error);
});

// ==========================================
// WORKER STARTUP
// ==========================================

console.log("AI Tutor worker is running");
console.log("Queue: ai-tutor");
console.log("AI Service:", AI_SERVICE_URL);
