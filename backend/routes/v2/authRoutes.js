const express = require("express");

const router = express.Router();

const {
  googleAuth,
  emailLogin
} = require("../../controllers/v2/authController");

router.post("/google", googleAuth);

router.post("/login",emailLogin);

module.exports = router;