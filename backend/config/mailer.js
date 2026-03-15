// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 587,           // IMPORTANT: works on Render
//   secure: false,       // must be false for port 587
//   auth: {
//     user: process.env.MAIL_USER,
//     pass: process.env.MAIL_PASS
//   },
//   tls: {
//     rejectUnauthorized: false
//   }
// });

// module.exports = transporter;

const { MailerSend, EmailParams, Sender, Recipient } = require("mailersend");

const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY
});

const sendTeacherEmail = async (email, first_name, password) => {

  const sentFrom = new Sender("test@test-r9084zv6mojgw63d.mlsender.net", "SmartLearn");

  const recipients = [
    new Recipient(email, first_name)
  ];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject("Teacher Account Created")
    .setText(`Hi ${first_name},

Your account has been created.

Email: ${email}
Password: ${password}

Please change your password after login.

Regards,
SmartLearn Team`);

  await mailerSend.email.send(emailParams);
};

module.exports = sendTeacherEmail;

const sendOTPEmail = async (email, first_name, otp) => {
  const sentFrom = new Sender("test@test-r9084zv6mojgw63d.mlsender.net", "SmartLearn");

  const recipients = [
    new Recipient(email, first_name)
  ];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject("Password Reset OTP")
    .setText(`Hi ${first_name},

Your OTP is ${otp}. Valid for 5 minutes.

Regards,
SmartLearn Team`);

  await mailerSend.email.send(emailParams);

};

module.exports= sendOTPEmail;