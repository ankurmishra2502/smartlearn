require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
//const setupRoutes = require("./routes/setupRoutes");
const app = express();

const allowedOrigins = [
  "http://localhost:5173", // frontend
  "http://localhost:5000", // backend (optional)
  "https://ed-tech-mocha.vercel.app" // production frontend
];

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
app.get("/", (req, res) => {
  res.send("Server running");
});

//app.use("/api/setup", setupRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});