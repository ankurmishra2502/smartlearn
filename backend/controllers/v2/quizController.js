const quizService = require("../../services/v2/quizService");
const quizGenerationQueue = require("../../queues/quizGenerationQueue");
const aiTutorService = require("../../queues/aiTutorQueue");
const pool = require("../../config/db");

const createQuiz = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      topicName,
      description,
      sourceType,
      timePerQuestionSeconds,
      stages
    } = req.body;

    if (!topicName) {
      return res.status(400).json({
        success: false,
        message: "topicName is required"
      });
    }

    const allowedSourceTypes = [
      "topic",
      "file",
      "scan",
      "mixed"
    ];

    if (
      !sourceType ||
      !allowedSourceTypes.includes(sourceType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid sourceType"
      });
    }


    if (
      !Number.isInteger(timePerQuestionSeconds) ||
      timePerQuestionSeconds <= 0 ||
      timePerQuestionSeconds > 60
    ) {
      return res.status(400).json({
        success: false,
        message:
          "timePerQuestionSeconds must be between 1 and 60"
      });
    }

    const quiz = await quizService.createQuiz({
      userId,
      topicName,
      description,
      sourceType,
      timePerQuestionSeconds,
      stages
    });

    return res.status(201).json({
      success: true,
      message: "Quiz created successfully",
      data: quiz
    });

  } catch (error) {
    console.error(
      "Create V2 quiz error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to create quiz"
    });
  }
};

const getQuiz = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;

    const quiz = await quizService.getQuizById({
      quizId,
      userId
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: quiz
    });
  } catch (error) {
    console.error("Get V2 quiz error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get quiz"
    });
  }
};


const addQuizSource = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;

    const {
      sourceType,
      originalFileName,
      mimeType,
      fileSizeBytes,
      s3Bucket,
      s3Key
    } = req.body;

    if (!sourceType) {
      return res.status(400).json({
        success: false,
        message: "sourceType is required"
      });
    }

    if (!["file", "scan"].includes(sourceType)) {
      return res.status(400).json({
        success: false,
        message: "sourceType must be file or scan"
      });
    }

    if (!originalFileName) {
      return res.status(400).json({
        success: false,
        message: "originalFileName is required"
      });
    }

    if (!mimeType) {
      return res.status(400).json({
        success: false,
        message: "mimeType is required"
      });
    }

    const source = await quizService.addQuizSource({
      quizId,
      userId,
      sourceType,
      originalFileName,
      mimeType,
      fileSizeBytes,
      s3Bucket,
      s3Key
    });

    return res.status(201).json({
      success: true,
      message: "Quiz source added successfully",
      data: source
    });
  } catch (error) {
    console.error("Add V2 quiz source error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add quiz source"
    });
  }
};


const getQuizSources = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;

    const sources = await quizService.getQuizSources({
      quizId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: sources
    });
  } catch (error) {
    console.error("Get V2 quiz sources error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get quiz sources"
    });
  }
};

const deleteQuizSource = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId, sourceId } = req.params;

    const source = await quizService.deleteQuizSource({
      quizId,
      sourceId,
      userId
    });

    return res.status(200).json({
      success: true,
      message: "Quiz source deleted successfully",
      data: source
    });
  } catch (error) {
    console.error("Delete V2 quiz source error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete quiz source"
    });
  }
};

const getUserQuizzes = async (req, res) => {
  try {
    const userId = req.user.id;

    const quizzes = await quizService.getUserQuizzes({
      userId
    });

    return res.status(200).json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    console.error("Get V2 user quizzes error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get quizzes"
    });
  }
};

const getQuizStages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;

    const stages = await quizService.getQuizStages({
      quizId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: stages
    });
  } catch (error) {
    console.error(
      "Get V2 quiz stages error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to get quiz stages"
    });
  }
};

const generateStage = async (req, res) => {
try {
const userId = req.user.id;
const { quizId, stageId } = req.params;

const result = await quizService.startStageGeneration({
  quizId,
  stageId,
  userId
});

await quizGenerationQueue.add(
  "generate-quiz-stage",
  {
    quizId,
    stageId,
    generationRunId: result.generationRun.id
  },
  {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: true,
    removeOnFail: false
  }
);

return res.status(202).json({
  success: true,
  message: "Stage generation started",
  data: {
    stage: result.stage,
    generationRun: result.generationRun
  }
});

} catch (error) {
console.error("Start V2 stage generation error:", error);

return res.status(error.statusCode || 500).json({
  success: false,
  message: error.message || "Failed to start stage generation"
});

}
};

const getStage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stageId } = req.params;

    const stage = await quizService.getStageById({
      stageId,
      userId,
    });

    return res.status(200).json({
      success: true,
      data: {
        stage,
      },
    });
  } catch (error) {
    console.error(
      "Get V2 stage error:",
      error
    );

    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const getStageQuestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stageId } = req.params;

    const questions =
      await quizService.getStageQuestions({
        stageId,
        userId,
      });

    return res.status(200).json({
      success: true,
      data: {
        questions,
      },
    });
  } catch (error) {
    console.error(
      "Get V2 stage questions error:",
      error
    );

    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const getQuestion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { questionId } = req.params;

    const result = await quizService.getQuestionById({
      questionId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Get V2 question error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get question"
    });
  }
};

const startQuiz = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;

    const result = await quizService.startQuizAttempt({
      quizId,
      userId
    });

    return res.status(200).json({
      success: true,
      message: result.resumed
        ? "Quiz attempt resumed"
        : "Quiz attempt started",
      data: result
    });
  } catch (error) {
    console.error("Start V2 quiz error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to start quiz"
    });
  }
};


const answerQuestion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { questionId } = req.params;

    const {
      quizAttemptId,
      stageAttemptId,
      selectedOptionId,
      questionStartedAt,
      status = "answered"
    } = req.body;

    if (!quizAttemptId) {
      return res.status(400).json({
        success: false,
        message: "quizAttemptId is required"
      });
    }

    if (!stageAttemptId) {
      return res.status(400).json({
        success: false,
        message: "stageAttemptId is required"
      });
    }

    if (!["answered", "skipped", "timeout"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid answer status"
      });
    }

    if (status === "answered" && !selectedOptionId) {
      return res.status(400).json({
        success: false,
        message: "selectedOptionId is required"
      });
    }

    const result = await quizService.answerQuestion({
      questionId,
      userId,
      quizAttemptId,
      stageAttemptId,
      selectedOptionId,
      questionStartedAt,
      status
    });

    return res.status(201).json({
      success: true,
      message: "Answer recorded successfully",
      data: result
    });
  } catch (error) {
    console.error("Answer V2 question error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to record answer"
    });
  }
};

const completeStage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stageId } = req.params;

    const {
      quizAttemptId,
      stageAttemptId
    } = req.body;

    if (!quizAttemptId) {
      return res.status(400).json({
        success: false,
        message: "quizAttemptId is required"
      });
    }

    if (!stageAttemptId) {
      return res.status(400).json({
        success: false,
        message: "stageAttemptId is required"
      });
    }

    const result = await quizService.completeStage({
      stageId,
      userId,
      quizAttemptId,
      stageAttemptId
    });

    // If another stage exists, start its AI generation
    if (result.nextStage) {
      const generationResult =
        await quizService.startStageGeneration({
          quizId: result.nextStage.quiz_id,
          stageId: result.nextStage.id,
          userId
        });

      await quizGenerationQueue.add(
        "generate-quiz-stage",
        {
          quizId: result.nextStage.quiz_id,
          stageId: result.nextStage.id,
          generationRunId: generationResult.generationRun.id
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      );

      result.nextStage = generationResult.stage;
      result.generationRun = generationResult.generationRun;
    }

    return res.status(200).json({
      success: true,
      message: "Stage completed successfully",
      data: result
    });
  } catch (error) {
    console.error(
      "Complete V2 stage error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to complete stage"
    });
  }
};

const retryStage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stageId } = req.params;
    const { quizAttemptId } = req.body;

    if (!quizAttemptId) {
      return res.status(400).json({ success: false, message: 'quizAttemptId is required' });
    }

    // Create the next stage attempt after validating retry eligibility.
    const result = await quizService.retryStageAttempt({
      stageId,
      userId,
      quizAttemptId
    });

    // Start a fresh AI generation run for this retry.
    const generationResult = await quizService.startStageGeneration({
      quizId: result.quizId,
      stageId,
      userId,
      allowRetry: true
    });

    const job = await quizGenerationQueue.add(
  "generate-quiz-stage",
  {
    quizId: result.quizId,
    stageId,
    stageAttemptId: result.stageAttempt.id,
    generationRunId: generationResult.generationRun.id
  },
  {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: true,
    removeOnFail: false
  }
);

    return res.status(202).json({
      success: true,
      message: "Stage retry accepted; AI question generation started",
      data: {
        stage: generationResult.stage,
        generationRun: generationResult.generationRun,
        stageAttempt: result.stageAttempt,
        attemptNumber: result.attemptNumber,
        maxAttempts: result.maxAttempts,
        jobId: job.id
      }
    });
  } catch (error) {
    console.error('Retry V2 stage error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to retry stage'
    });
  }
};

const completeQuiz = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quizId } = req.params;
    const { quizAttemptId } = req.body;

    if (!quizAttemptId) {
      return res.status(400).json({
        success: false,
        message: "quizAttemptId is required"
      });
    }

    const result = await quizService.completeQuiz({
      quizId,
      userId,
      quizAttemptId
    });

    return res.status(200).json({
      success: true,
      message: "Quiz completed successfully",
      data: result
    });
  } catch (error) {
    console.error(
      "Complete V2 quiz error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to complete quiz"
    });
  }
};

const getReviewSession = async (req, res) => {
  try {
    const { quizAttemptId } = req.params;
    const userId = req.user.id;

    const data = await quizService.getReviewSession({
      quizAttemptId,
      userId
    });

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Get review session error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get review session"
    });
  }
};

const updateQuestionReview = async (req, res) => {
  try {
    const { questionId } = req.params;
    const userId = req.user.id;

    const data = await quizService.updateQuestionReview({
      questionId,
      userId,
      mistakeCategory: req.body.mistakeCategory,
      reviewStatus: req.body.reviewStatus
    });

    return res.status(200).json({
      success: true,
      message: "Review updated successfully",
      data
    });
  } catch (error) {
    console.error("Update question review error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update review"
    });
  }
};

const getQuestionAnswerStatistics = async (req, res) => {
  try {
    const { questionId } = req.params;

    const data =
      await quizService.getQuestionAnswerStatistics({
        questionId
      });

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Get answer statistics error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Failed to get answer statistics"
    });
  }
};

const askAI = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      questionId = null,
      quizAttemptId = null,
      action,
      userMessage = null,
      conversationId = null,
      conversationType = "ai_tutor",
    } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: "action is required",
      });
    }

    if (action === "ask_question" && !userMessage?.trim()) {
      return res.status(400).json({
        success: false,
        message: "userMessage is required for ask_question",
      });
    }

    if (conversationType === "ai_tutor" && !questionId) {
      return res.status(400).json({
        success: false,
        message: "questionId is required for AI Tutor",
      });
    }

    if (
      conversationType === "general_chatbot" &&
      action !== "ask_question"
    ) {
      return res.status(400).json({
        success: false,
        message: "general_chatbot only supports ask_question",
      });
    }

    const result = await quizService.askAI({
      userId,
      questionId,
      quizAttemptId,
      action,
      userMessage,
      conversationId,
      conversationType,
    });

    return res.status(202).json({
      success: true,
      message: "AI request queued successfully",
      data: result,
    });
  } catch (error) {
    console.error("AI Tutor request error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to queue AI request",
    });
  }
};


const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const result = await quizService.getJobStatus(jobId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("AI Tutor job status error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.statusCode
          ? error.message
          : "Failed to retrieve AI Tutor job status",
    });
  }
};



const getAIConversationHistory = async ({ userId, conversationId }) => {
  const conversationResult = await pool.query(
    `SELECT *
     FROM v2_ai_tutor_conversations
     WHERE id = $1
       AND user_id = $2`,
    [conversationId, userId]
  );

  if (conversationResult.rows.length === 0) {
    return {
      conversation: null,
      messages: [],
    };
  }

  const conversation = conversationResult.rows[0];

  const messagesResult = await pool.query(
    `SELECT *
     FROM v2_ai_tutor_messages
     WHERE conversation_id = $1
       AND user_id = $2
     ORDER BY created_at ASC, id ASC`,
    [conversationId, userId]
  );

  return {
    conversation,
    messages: messagesResult.rows,
  };
};

const getAIConversationHistoryHandler = async (req, res) => {
  try {
    const { conversationId } = req.query;
    const userId = req.user.id;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "conversationId is required",
      });
    }

    const result = await getAIConversationHistory({
      userId,
      conversationId,
    });

    if (!result.conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get AI conversation history error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversation history",
    });
  }
};




module.exports = {
  createQuiz,
  getQuiz,
  addQuizSource,
  getQuizSources,
  deleteQuizSource,
    getUserQuizzes,
    getQuizStages,
    generateStage,
    getStage,
    getStageQuestions,
    getQuestion,
    startQuiz,
    answerQuestion,
    completeStage,
    retryStage,
    completeQuiz,
    getReviewSession,
    updateQuestionReview,
    getQuestionAnswerStatistics,
    askAI,
    getJobStatus,
    getAIConversationHistoryHandler
};