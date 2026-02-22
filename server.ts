import express from "express";
import { createServer as createViteServer } from "vite";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import dotenv from "dotenv";
import { generateCyberQuestion, getChatbotResponse } from "./src/services/aiService";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/CCG2";
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-guardiq";

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB (CCG2)"))
  .catch((err) => console.error("MongoDB connection error:", err));

// MongoDB Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  xp: { type: Number, default: 0 },
  level: { type: String, default: 'Rookie 🌱' },
  total_score: { type: Number, default: 0 },
  games_played: { type: Number, default: 0 },
  consecutive_correct: { type: Number, default: 0 },
  difficulty_level: { type: String, default: 'Easy' },
  completed_guides: { type: [String], default: [] },
  badges: { type: [String], default: [] }
}, { collection: 'ccg2' });

const User = mongoose.model('User', userSchema);

const app = express();
app.use(express.json());

const PORT = 3000;

// Middleware to protect routes
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  });
};

// Auth Routes
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
    });

    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

    // Convert to object and handle the type safely
    const userObj = user.toObject();
    const { password: _, ...userResponse } = userObj;

    res.json({ token, user: userResponse });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API Routes (Protected)
app.get("/api/user", authenticateToken, async (req: any, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("Error in /api/user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/generate-question", async (req, res) => {
  try {
    const { difficulty } = req.query;
    const question = await generateCyberQuestion(difficulty as string || 'Easy');
    res.json(question);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate question" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const response = await getChatbotResponse(message);
    res.json({ response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Chatbot error" });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const topUsers = await User.find()
      .select("username xp level")
      .sort({ xp: -1 })
      .limit(10);

    if (topUsers.length === 0) {
      return res.json([
        { username: "Cyber King 👑", xp: 1250, level: "Cyber Guardian" },
        { username: "Security Pro 🛡️", xp: 980, level: "Cyber Guardian" },
        { username: "Scam Buster ⚔️", xp: 720, level: "Cyber Guard" },
        { username: "Digital Shield 🛡️", xp: 640, level: "Cyber Guard" },
        { username: "Byte Defender 🛡️", xp: 510, level: "Defender" },
      ]);
    }
    res.json(topUsers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

app.post("/api/complete-guide", authenticateToken, async (req: any, res) => {
  try {
    const { guideTitle } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.completed_guides.includes(guideTitle)) {
      return res.json({ success: false, message: "Guide already completed" });
    }

    user.completed_guides.push(guideTitle);
    user.xp += 15;
    user.total_score += 15;

    await user.save();

    res.json({
      success: true,
      user: { xp: user.xp, total_score: user.total_score, completed_guides: user.completed_guides }
    });
  } catch (error) {
    console.error("Error in /api/complete-guide:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post("/api/update-progress", authenticateToken, async (req: any, res) => {
  try {
    const { correct, xp_gained, difficulty } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ error: "User not found" });

    const parsedXp = Math.abs(Number(xp_gained) || 0);
    const xpDelta = correct ? parsedXp : -parsedXp;

    user.xp = Math.max(0, user.xp + xpDelta);
    user.total_score += (correct ? Math.max(0, xpDelta) : 0);
    user.games_played += 1;
    user.consecutive_correct = correct ? user.consecutive_correct + 1 : 0;

    if (user.consecutive_correct >= 3) {
      if (user.difficulty_level === 'Easy') user.difficulty_level = 'Medium';
      else if (user.difficulty_level === 'Medium') user.difficulty_level = 'Hard';
      user.consecutive_correct = 0;
    }

    if (user.xp >= 600) user.level = 'Cyber Guardian 🛡️';
    else if (user.xp >= 300) user.level = 'Cyber Guard ⚔️';
    else if (user.xp >= 100) user.level = 'Defender 🛡️';
    else user.level = 'Rookie 🌱';

    const addBadge = (name: string) => {
      if (!user.badges.includes(name)) {
        user.badges.push(name);
        return true;
      }
      return false;
    };

    const newBadges = [];
    if (user.games_played >= 1 && addBadge("First Steps")) newBadges.push("First Steps");
    if (user.total_score >= 100 && addBadge("Century")) newBadges.push("Century");
    if (user.xp >= 50 && addBadge("Cyber Scout")) newBadges.push("Cyber Scout");
    if (correct && parsedXp >= 30 && addBadge("Quick Thinker")) newBadges.push("Quick Thinker");
    if (user.consecutive_correct >= 3 && addBadge("Triple Threat")) newBadges.push("Triple Threat");

    await user.save();

    res.json({
      success: true,
      user: { xp: user.xp, level: user.level, total_score: user.total_score, difficulty_level: user.difficulty_level, badges: user.badges },
      newBadges
    });
  } catch (error) {
    console.error("Error in /api/update-progress:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

async function startServer() {
  const __dirname = path.resolve();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
