const express = require("express");
const router = express.Router();

const { saveAcademicDetails } = require("../controllers/userController");

router.post("/save-academic-details", saveAcademicDetails);


module.exports = router;