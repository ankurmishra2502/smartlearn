const pool = require("../config/db");


exports.createSchool = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const userId = req.user.userId;
    const { name } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "School name is required",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM schools WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name.trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "School already exists",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO schools (name, created_by)
      VALUES ($1, $2)
      RETURNING *
      `,
      [name.trim(), userId]
    );

    return res.status(201).json({
      success: true,
      message: "School created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("createSchool error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};




exports.createClass = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const userId = req.user.userId;
    const { name } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Class name is required",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM classes WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name.trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Class already exists",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO classes (name, created_by)
      VALUES ($1, $2)
      RETURNING *
      `,
      [name.trim(), userId]
    );

    return res.status(201).json({
      success: true,
      message: "Class created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("createClass error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};



exports.getSchools = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name
      FROM schools
      WHERE is_active = true
      ORDER BY name ASC
      `
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("getSchools error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};




exports.getClasses = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name
      FROM classes
      WHERE is_active = true
      ORDER BY name ASC
      `
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("getClasses error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


exports.getStudentProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.mobile_number,

        uad.school_name,
        uad.class,
        uad.district,
        uad.state,
        uad.country,
        uad.pincode

      FROM users u
      LEFT JOIN user_academic_details uad
        ON u.id = uad.user_id

      WHERE u.id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        personal_information: {
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          mobile_number: user.mobile_number,
        },
        school_information: {
          school_name: user.school_name,
          class: user.class,
          district: user.district,
          state: user.state,
          country: user.country,
          pincode: user.pincode,
        },
      },
    });
  } catch (error) {
    console.error("getStudentProfile error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};