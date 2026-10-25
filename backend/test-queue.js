const twilio = require("twilio");
require("dotenv").config();


const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
console.log("SID:", process.env.TWILIO_ACCOUNT_SID);
console.log("TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "Loaded" : "Missing");
client.messages
  .create({
    from: "whatsapp:+14155238886",
    to: "whatsapp:+919667597231",
    body: "Hello from SmartLearn!"
  })
  .then(message => console.log(message.sid))
  .catch(console.error);