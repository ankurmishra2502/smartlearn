const express = require("express");

const quizController = require("../../controllers/v2/quizController");

// Use the SAME authentication middleware
// already used by your V2 routes.
const authMiddleware = require("../../middleware/v2/authMiddleware");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  quizController.createQuiz
);

router.get(
  "/:quizId",
  authMiddleware,
  quizController.getQuiz
);

router.post(
  "/:quizId/sources",
  authMiddleware,
  quizController.addQuizSource
);

router.get(
  "/:quizId/sources",
  authMiddleware,
  quizController.getQuizSources
);

router.delete(
  "/:quizId/sources/:sourceId",
  authMiddleware,
  quizController.deleteQuizSource
);

router.get(
  "/",
  authMiddleware,
  quizController.getUserQuizzes
);

router.get(
  "/:quizId/stages",
  authMiddleware,
  quizController.getQuizStages
);

router.post(
  "/:quizId/stages/:stageId/generate",
  authMiddleware,
  quizController.generateStage
);

router.get(
  "/stages/:stageId",
    authMiddleware,
  quizController.getStage
);

router.get(
  "/stages/:stageId/questions",
    authMiddleware,
  quizController.getStageQuestions
);

router.get(
  "/questions/:questionId",
    authMiddleware,
  quizController.getQuestion
);

router.post(
  "/:quizId/start",
  authMiddleware,
  quizController.startQuiz
);

router.post(
  "/questions/:questionId/answer",
  authMiddleware,
  quizController.answerQuestion
);

router.post(
  "/stages/:stageId/complete",
  authMiddleware,
  quizController.completeStage
);

router.post(
  "/stages/:stageId/retry",
  authMiddleware,
  quizController.retryStage
);

router.post(
  "/:quizId/complete",
  authMiddleware,
  quizController.completeQuiz
);


module.exports = router;