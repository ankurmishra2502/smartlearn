const express = require("express");
const router = express.Router();

const teacherController = require("../controllers/teacherHomeworkController");

const authMiddleware = require("../middleware/authMiddleware");

router.post("/homework", authMiddleware, teacherController.createHomework);
router.post("/homework/:id/question", authMiddleware, teacherController.addQuestion);
router.post("/homework/:id/publish", authMiddleware, teacherController.publishHomework);
router.get("/homework/:id/submissions", authMiddleware, teacherController.getHomeworkSubmissions);
router.get("/submission/:id", authMiddleware, teacherController.getSubmissionDetail);
router.post("/submission/:id/grade", authMiddleware, teacherController.gradeSubmission);
module.exports = router;