const quizService = require("../../services/v2/quizService");
const quizGenerationQueue = require("../../queues/quizGenerationQueue");
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
      !stages ||
      !Number.isInteger(stages.easy) ||
      !Number.isInteger(stages.medium) ||
      !Number.isInteger(stages.hard)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "stages.easy, stages.medium and stages.hard are required"
      });
    }

    if (
      stages.easy <= 0 ||
      stages.medium <= 0 ||
      stages.hard <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Stage question counts must be greater than 0"
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

    const {
      quizId,
      stageId
    } = req.params;

    // Start the generation lifecycle in PostgreSQL
    const result =
      await quizService.startStageGeneration({
        quizId,
        stageId,
        userId
      });

    // Add AI generation job to BullMQ
    await quizGenerationQueue.add(
      "generate-quiz-stage",
      {
        quizId,
        stageId,
        generationRunId:
          result.generationRun.id
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
    console.error(
      "Start V2 stage generation error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to start stage generation"
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
    completeQuiz
};