const express = require("express");
const router = express.Router();
const controller = require("../controllers/roomController");
const auth = require("../middleware/authMiddleware");

router.post("/", auth, controller.createRoom);
router.get("/", auth, controller.getRooms);

router.get("/dashboard", controller.getDashboardStats);
router.get("/discover",auth,controller.getDiscoverRooms);
router.get("/:id/invite-users", auth, controller.getInviteUsers);
router.post("/:id/invite", auth, controller.inviteUser);
router.post("/:id/join", auth, controller.joinRoom);
router.post("/:id/leave", auth, controller.leaveRoom);
router.get("/:id", auth, controller.getRoomDetails);
router.get("/user/:id",controller.getOnlineUsers);
module.exports = router;