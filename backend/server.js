require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { initSocket } = require("./sockets/socket");
console.log("REDIS_URL:", process.env.REDIS_URL);

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
//const setupRoutes = require("./routes/setupRoutes");
const CourseRoutes = require("./routes/courseRoutes");
const xpRoutes = require("./routes/xpRoutes");
const progressRoutes = require('./routes/progressRoutes');
const aiRoutes = require("./routes/aiRoutes");
const roomRoutes = require("./routes/roomRoutes");
const teacherHomeworkRoutes = require("./routes/teacherHomeworkRoutes"); 
const studentHomeworkRoutes = require("./routes/studentHomeworkRoutes");
const leaderboardRoutes = require("./routes/leaderboardRoutes");
const statsRoutes = require("./routes/statsRoutes");
const certificateRoutes = require("./routes/certificateRoutes");
const pinMessageRoutes = require("./routes/pinMessageRoutes");
const academicRoutes = require("./routes/academicRoutes");
const teacherAlertRoutes = require("./routes/teacherAlertRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const teacherAnalyticsRoutes = require("./routes/teacherAnalyticsRoutes");
const homeScreenRoutes = require("./routes/homeScreenRoutes");
const { Server } = require("net");
const app = express();




const allowedOrigins = [
  "http://localhost:5173", // frontend
  "http://localhost:5000", // backend (optional)
  "https://ed-tech-mocha.vercel.app", // production frontend
  "https://mastishq.vandanpatel.in",
  "https://mastishq.vandanpatel.in/",
  "http://mastishq.vandanpatel.in",
  "https://www.mastishq.vandanpatel.in",
  "mastishq.vandanpatel.in",
  "www.mastishq.vandanpatel.in"
];

// app.use(
//   cors({
//     origin: "*",
//     credentials: true
//   })
// );

app.use(cors({
  origin: function (origin, callback) {

    // Allow Postman / curl (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],

  allowedHeaders: ["Content-Type", "Authorization"],

  credentials: true
}));

app.use(express.json());
app.use("/api", require("./routes/teacherRoutes"));
app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/course", CourseRoutes);
app.use("/xp", xpRoutes);
app.use("/progress", progressRoutes);
app.use("/academic", academicRoutes);
app.use("/ai", aiRoutes);
app.use("/room", roomRoutes);
app.use("/teacher", teacherHomeworkRoutes);
app.use("/student", studentHomeworkRoutes);
app.use("/leaderboard", leaderboardRoutes);
app.use("/stats", statsRoutes);
app.use("/certificates", certificateRoutes);
app.use("/message", pinMessageRoutes);
app.use("/alerts", teacherAlertRoutes);
app.use("/notifications", notificationRoutes);
app.use("/analytics", teacherAnalyticsRoutes);
app.use("/home", homeScreenRoutes);
app.get("/", (req, res) => {
  res.send("Server running");
});

//app.use("/api/setup", setupRoutes);


const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
