const pool = require("../config/db");

exports.savePersonalInfo = async (req, res) => {

  try {

    const { first_name, last_name, mobile_number } = req.body;

    await pool.query(
      `UPDATE users
       SET first_name=$1, last_name=$2, mobile_number=$3
       WHERE id=$4`,
      [
        first_name,
        last_name,
        mobile_number,
        req.user.userId
      ]
    );

    res.json({
      message: "Personal info saved"
    });

  } catch (error) {

    res.status(500).json({
      message: "Failed to save data"
    });

  }

};

exports.saveAcademicDetails = async (req, res) => {

  try {

    const userId = req.body.id;

    const contactInfo = req.body.contact_number;
    const { school_name, district, state, country } = req.body;

    await pool.query(
      `INSERT INTO user_academic_details
       (user_id, school_name, district, state, country)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, school_name, district, state, country]
    );

    await pool.query(
      `UPDATE users SET is_onboarded = true WHERE id = $1`,
      [userId]
    );
    await pool.query(
      `UPDATE users SET mobile_number = $1 WHERE id = $2`,
      [contactInfo, userId]
    );

    res.json({
      success: true,
      message: "Academic details saved"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Failed to save academic details"
    });

  }

};