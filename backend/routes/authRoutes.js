const express = require("express");

const router = express.Router();

const { googleAuth,teacherLogin } = require("../controllers/authController");

router.post("/google", googleAuth);
router.post("/teacher", teacherLogin);

module.exports = router;