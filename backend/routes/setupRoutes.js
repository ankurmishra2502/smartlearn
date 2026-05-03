const express = require("express");
const router = express.Router();
const db = require("../config/db");

router.get("/create-tables", async (req, res) => {
 try {
    // Ensure the email column is unique
    const result = await db.query(`ALTER TABLE xp_transactions
ADD COLUMN source_id INT;`);
    res.json({ success: true, message: "Columns added to user_academic_details table", result: result.rows });
//res.json({ success: true, message: "user table exists", data: result.rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;