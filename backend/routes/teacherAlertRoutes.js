const express = require("express");
const router = express.Router();

const teacherAlertController = require("../controllers/teacherAlertController");
const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/",
  authMiddleware,
  teacherAlertController.getTeacherAlerts
);

router.post(
  "/remind",
  authMiddleware,
  teacherAlertController.remindAlert
);

router.post(
  "/dismiss",
  authMiddleware,
  teacherAlertController.dismissAlert
);


module.exports = router;