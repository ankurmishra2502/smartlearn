const express = require("express");
const router = express.Router();

const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/",
  authMiddleware,
  notificationController.getStudentNotifications
);

router.patch(
  "/:id/read",
  authMiddleware,
  notificationController.markNotificationRead
);

router.post(
  "/:notificationId/accept-invite",
  authMiddleware,
  notificationController.acceptInvite
);

router.post(
  "/:notificationId/reject-invite",
  authMiddleware,
  notificationController.rejectInvite
);

module.exports = router;