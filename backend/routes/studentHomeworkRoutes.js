const express = require("express");
const router = express.Router();

const studentController = require("../controllers/studentHomeworkController");

const authMiddleware = require("../middleware/authMiddleware");

router.get("/homeworks", authMiddleware, studentController.getStudentHomeworks);
router.get("/homework/:id", authMiddleware, studentController.getHomeworkDetail);
router.post("/homework/:id/answer", authMiddleware, studentController.saveAnswer);
router.post("/homework/:id/submit", authMiddleware, studentController.submitHomework);

module.exports = router;