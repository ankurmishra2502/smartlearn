require("dotenv").config();

const { Worker } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null
  }
);

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:8000";

const worker = new Worker(
  "quiz-generation",

  async (job) => {
    const {
      quizId,
      stageId,
      stageAttemptId,
      generationRunId
    } = job.data;

    console.log("\n");
    console.log("==================================================");
    console.log("🚀 QUIZ GENERATION JOB STARTED");
    console.log("==================================================");

    console.log("🆔 Job ID:", job.id);
    console.log("📝 Job Name:", job.name);
    console.log("🎯 Quiz ID:", quizId);
    console.log("📚 Stage ID:", stageId);
    console.log(
      "🔄 Generation Run ID:",
      generationRunId
    );

    try {
      console.log(
        "\n🧠 Calling Python AI service..."
      );
      console.log("📤 Quiz generation request payload:", {
  quizId,
  stageId,
  stageAttemptId,
  generationRunId,
});

      const response = await fetch(
        `${AI_SERVICE_URL}/internal/v1/quiz/stages/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            quizId,
            stageId,
            stageAttemptId,
            generationRunId
          })
        }
      );

      const responseText = await response.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch (error) {
        throw new Error(
          `AI service returned invalid JSON: ${responseText}`
        );
      }

      if (!response.ok) { const errorDetails = data.detail || data.message || data.error || data; console.error("❌ AI service request failed:", { status: response.status, statusText: response.statusText, details: errorDetails, quizId, stageId, stageAttemptId, generationRunId, }); throw new Error( `AI service failed with status ${response.status}: ${ typeof errorDetails === "string" ? errorDetails : JSON.stringify(errorDetails) }` ); }

      console.log(
        "✅ Python AI service completed successfully"
      );

      console.log(
        "📊 AI service response:",
        JSON.stringify(data, null, 2)
      );

      console.log("==================================================");
      console.log("🎉 QUIZ GENERATION JOB COMPLETED");
      console.log("==================================================\n");

      return data;

    } catch (error) {

      console.error("\n");
      console.error("==================================================");
      console.error("❌ QUIZ GENERATION JOB FAILED");
      console.error("==================================================");

      console.error("🆔 Job ID:", job.id);
      console.error("🎯 Quiz ID:", quizId);
      console.error("📚 Stage ID:", stageId);
      console.error("❌ Error:", error.message);

      console.error("==================================================\n");

      throw error;
    }
  },

  {
    connection,
    concurrency: 1
  }
);

worker.on("completed", (job) => {
  console.log(
    `✅ Quiz generation worker completed job ${job.id}`
  );
});

worker.on("failed", (job, error) => {
  console.error(
    `❌ Quiz generation worker failed job ${job?.id}:`,
    error.message
  );
});

console.log(
  "👷 Quiz Generation Worker is running..."
);
console.log(
  "📡 Queue: quiz-generation"
);
console.log(
  "🤖 AI Service:",
  AI_SERVICE_URL
);