require("dotenv").config();

const { Worker } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:8000";

const worker = new Worker(
  "ai-tutor",
  async (job) => {
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
        result.message || "AI Tutor service returned an unsuccessful response"
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

worker.on("completed", (job, result) => {
  console.log(`AI Tutor job completed: ${job.id}`, {
    conversationId: result?.conversationId,
  });
});

worker.on("failed", (job, error) => {
  console.error(
    `AI Tutor job failed: ${job?.id}`,
    error.message
  );
});

console.log("AI Tutor worker is running");
console.log("Queue: ai-tutor");
console.log("AI Service:", AI_SERVICE_URL);

