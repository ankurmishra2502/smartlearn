const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const transporter = require("../config/mailer");
const sendTeacherEmail = require("../config/mailer")

// ADMIN CREATE TEACHER
exports.createTeacher = async (req, res) => {

  try {

    const { first_name, last_name, email, mobile_number } = req.body;

    const password = crypto.randomBytes(4).toString("hex");

    const hashedPassword = await bcrypt.hash(password, 10);

    const teacher = await pool.query(
      `INSERT INTO teachers 
      (first_name,last_name,email,mobile_number,password)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *`,
      [first_name,last_name,email,mobile_number,hashedPassword]
    );

    await sendTeacherEmail(email, first_name, password);
    res.json({
      success: true,
      message: "Teacher created and email sent"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({ error: "Teacher creation failed" });

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

    const match = await bcrypt.compare(password,user.password);

    if(!match)
      return res.status(401).json({error:"Invalid password"});

    const token = jwt.sign(
      { id:user.id, role:"teacher" },
      process.env.JWT_SECRET,
      { expiresIn:"7d" }
    );

    res.json({
      success:true,
      token,
      firstLogin:user.is_first_login
    });

  }catch(error){

    console.error(error);
    res.status(500).json({error:"Login failed"});

  }

};



// CHANGE PASSWORD (FIRST LOGIN)
exports.changePassword = async(req,res)=>{

  try{

    const teacherId = req.user.id;

    const { new_password } = req.body;

    const hashed = await bcrypt.hash(new_password,10);

    await pool.query(
      `UPDATE teachers 
       SET password=$1,is_first_login=false
       WHERE id=$2`,
      [hashed,teacherId]
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

    await transporter.sendMail({
      to: email,
      subject: "Password Reset OTP",
      text: `Hi ${teacher.rows[0].first_name},\n Your OTP is ${otp}. Valid for 5 minutes. /n\nRegards,\nSmartLearn Team
      `
    });

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

    const hashed = await bcrypt.hash(new_password,10);

    await pool.query(
      `UPDATE teachers SET password=$1 WHERE email=$2`,
      [hashed,email]
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