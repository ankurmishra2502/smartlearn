const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const transporter = require("../config/mailer");
const Sender  = require("../config/mailer");

// ADMIN CREATE TEACHER
exports.createTeacher = async (req, res) => {

  try {
    console.log("Received data for new teacher:", req.body);
    const { first_name, last_name, email, mobile_number, classes =[], subject =[]} = req.body;

    console.log("Incoming data:", req.body);

    const tempPassword = crypto.randomBytes(4).toString("hex");

    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    console.log("Generated password:", tempPassword);

    const teacher = await pool.query(
      `INSERT INTO teachers
       (first_name,last_name,email,mobile_number,password,classes, subjects)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [first_name,last_name,email,mobile_number,hashedPassword,classes,subject]
    );

    
    await Sender.sendTeacherEmail(email, first_name, tempPassword);

    res.json({
      success: true,
      message: "Teacher created and email sent",
    });

  } catch (error) {

    console.error("Insert error:", error);

    res.status(500).json({

      error: error.message || "Failed to create teacher"
    });

  }

};
// TEACHER LOGIN
exports.teacherLogin = async (req,res)=>{

  try{

    const { email,password } = req.body;

    const teacher = await pool.query(
      `SELECT * FROM teachers WHERE email=$1`,
      [email]
    );

    if(teacher.rows.length === 0)
      return res.status(404).json({error:"Teacher not found"});

    const user = teacher.rows[0];
    // Compare plain password with hashed password
    console.log(user.password);
    console.log("Entered password:", password);
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if(!isPasswordValid) {
      //console.log("Password mismatch: entered =", password, "stored hash =", user.password);
      return res.status(401).json({error:"Invalid password"});
    }

    const token = jwt.sign(
      { id:user.id, role:"teacher" },
      process.env.JWT_SECRET,
      { expiresIn:"7d" }
    );

    res.json({
      success: true,
      token,
      userId: user.id,
      firstLogin: user.is_first_login
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"Login failed"});

  }

};



// CHANGE PASSWORD (FIRST LOGIN)
exports.changePassword = async(req,res)=>{

  try{

    const { userId,new_password } = req.body;

    const hashed = await bcrypt.hash(new_password,10);

    // Fetch current is_first_login value
    const teacher = await pool.query(
      `SELECT is_first_login FROM teachers WHERE id=$1`,
      [userId]
    );

    if (teacher.rows.length === 0) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    if (!teacher.rows[0].is_first_login) {
      return res.status(400).json({ error: "Password change not allowed after first login" });
    }

    await pool.query(
      `UPDATE teachers 
       SET password=$1, is_first_login=false
       WHERE id=$2`,
      [hashed, userId]
    );

    res.json({
      success:true,
      message:"Password updated"
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"Password change failed"});

  }

};



// FORGOT PASSWORD
exports.forgotPassword = async(req,res)=>{

  try{

    const { email } = req.body;

    const teacher = await pool.query(
      `SELECT * FROM teachers WHERE email=$1`,
      [email]
    );

    if(teacher.rows.length === 0)
      return res.status(404).json({error:"Teacher not found"});

    const otp = Math.floor(100000 + Math.random()*900000);

    const expiry = new Date(Date.now()+5*60*1000);

    await pool.query(
      `INSERT INTO teacher_password_otp
       (email,otp,expires_at)
       VALUES ($1,$2,$3)`,
      [email,otp,expiry]
    );

    await Sender.sendOTPEmail(email, teacher.rows[0].first_name, otp);

    res.json({
      success:true,
      message:"OTP sent"
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"OTP send failed"});

  }

};



// VERIFY OTP
exports.verifyOtp = async(req,res)=>{

  try{

    const { email,otp } = req.body;

    const record = await pool.query(
      `SELECT * FROM teacher_password_otp
       WHERE email=$1 AND otp=$2`,
      [email,otp]
    );

    if(record.rows.length === 0)
      return res.status(400).json({error:"Invalid OTP"});

    if(new Date() > record.rows[0].expires_at)
      return res.status(400).json({error:"OTP expired"});

    res.json({
      success:true,
      message:"OTP verified"
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"OTP verification failed"});

  }

};



// RESET PASSWORD
exports.resetPassword = async(req,res)=>{

  try{

    const { email,new_password } = req.body;

    // Check if OTP exists and is not expired
    const otpRecord = await pool.query(
      `SELECT * FROM teacher_password_otp WHERE email=$1 ORDER BY expires_at DESC LIMIT 1`,
      [email]
    );

    if (otpRecord.rows.length === 0) {
      return res.status(400).json({ error: "No OTP found. Please request a new OTP." });
    }

    if (new Date() > otpRecord.rows[0].expires_at) {
      return res.status(400).json({ error: "OTP expired. Please request a new OTP." });
    }

    const hashed = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE teachers SET password=$1 WHERE email=$2`,
      [hashed, email]
    );

    await pool.query(
      `DELETE FROM teacher_password_otp WHERE email=$1`,
      [email]
    );

    res.json({
      success:true,
      message:"Password reset successful"
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"Password reset failed"});

  }

};

exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    // Find latest OTP for this email
    const otpRecord = await pool.query(
      `SELECT * FROM teacher_password_otp WHERE email=$1 ORDER BY expires_at DESC LIMIT 1`,
      [email]
    );

    if (otpRecord.rows.length > 0) {
      const latestOtp = otpRecord.rows[0];
      const now = new Date();

      if (now < latestOtp.expires_at) {
        // OTP still valid, do not send new OTP
        return res.status(400).json({
          error: "OTP already sent. Please wait before requesting again."
        });
      }
    }

    // Generate new OTP and expiry
    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    // Insert new OTP record
    await pool.query(
      `INSERT INTO teacher_password_otp (email, otp, expires_at) VALUES ($1, $2, $3)`,
      [email, otp, expiry]
    );

    // Fetch teacher's first name for email
    const teacher = await pool.query(
      `SELECT first_name FROM teachers WHERE email=$1`,
      [email]
    );

    if (teacher.rows.length === 0) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    await Sender.sendOTPEmail(email, teacher.rows[0].first_name, otp);

    res.json({
      success: true,
      message: "OTP resent"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Resend OTP failed" });
  }
};
