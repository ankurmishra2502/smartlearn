const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const pinnedMessageController = require("../controllers/pinMessageController");


router.post(
  "/pin-message",
  authMiddleware,
  pinnedMessageController.createPinnedMessage
);


router.get(
  "/pinned-messages",
  authMiddleware,
  pinnedMessageController.getStudentPinnedMessages
);


module.exports = router;