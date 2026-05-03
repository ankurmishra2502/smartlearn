const axios = require("axios");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const bcrypt = require("bcrypt");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.googleAuth = async (req, res) => {

  try {

    const { token,role } = req.body;

    if(!token){
      return res.status(400).json({
        success: false,
        message: "Token is required"
      });
    }
   
    const ticket = await axios.get(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
        }
    );
    
    
    const payload = ticket.data;

const { email, name, picture, sub } = payload;

const names = name.split(" ");
const firstName = names[0];
const lastName = names.slice(1).join(" ");

const existingUser = await pool.query(
  `SELECT * FROM users WHERE email=$1`,
  [email]
);

let user;

if (existingUser.rows.length > 0) {

  user = existingUser.rows[0];

  await pool.query(
    `UPDATE users 
     SET last_login = NOW(), role = $2
     WHERE id = $1`,
    [user.id, role]
  );

} else {

  const newUser = await pool.query(
    `INSERT INTO users
    (email, google_id, first_name, last_name, profile_picture, role,auth_provider, last_login)
    VALUES ($1,$2,$3,$4,$5,$6,'google',NOW())
    RETURNING *`,
    [email, sub, firstName, lastName, picture,role]
  );

  user = newUser.rows[0];
}

    const jwtToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      isNewUser: existingUser.rows.length === 0,
      token: jwtToken,
      user
    });

  } catch (error) {

    console.error(error);

    res.status(401).json({
      error: "Google authentication failed"
    });

  }

};

exports.teacherLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM teachers WHERE email=$1`,
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const teacher = result.rows[0];

    const isMatch = await bcrypt.compare(password, teacher.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      {
        id: teacher.id,
        role: "teacher"
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      teacher
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login error" });
  }
};