const express = require("express");
const router = express.Router();
const controller = require("../controllers/courseController");
const auth = require("../middleware/authMiddleware");

router.post("/admin/subject", controller.createSubject);
router.post("/admin/topic", controller.createTopic);
router.post("/admin/video", controller.addVideo);
router.post("/admin/quiz", controller.createQuiz);
router.post("/admin/question", controller.addQuestion);
router.post("/topic", auth, controller.createAITopic);
router.post("/generate",auth, controller.generateAIQuiz);
router.post("/publish", auth, controller.publishAIQuiz);

router.post("/quiz/:quiz_id/submit",auth, controller.submitQuiz);

router.get("/course/:subject_id", controller.getFullCourse);

router.post("/quiz/check-answer", controller.checkAnswer);
router.get("/subjects", controller.getSubjects);
router.get("/topics/:subject_id", controller.getTopicsBySubject);
router.get("/video/:topic_id", controller.getVideoByTopicId);
router.get("/quiz/:topic_id", auth, controller.getQuizByTopicId);
router.get("/question/:quiz_id", controller.getQuestionByQuizId);
router.get("/status/:topic_id", auth, controller.getRemainingAttempts);


module.exports = router;