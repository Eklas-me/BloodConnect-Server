import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
import { db, connectDB } from "./config/db.js";
import { auth } from "./config/auth.js";
import profileRouter from "./routes/profile.js";
import usersRouter from "./routes/users.js";
import donationRequestsRouter from "./routes/donationRequests.js";
import fundsRouter from "./routes/funds.js";
import statsRouter from "./routes/stats.js";

// Local development only workaround for node v26 tls issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const usersCollection = db.collection("user");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      process.env.CLIENT_URL,
    ].filter(Boolean),
    credentials: true,
  })
);

app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

app.post("/api/jwt", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: "JWT generation failed" });
  }
});

app.get("/api/search/donors", async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;
    const filter = { role: "donor", status: "active" };
    if (bloodGroup) filter.bloodGroup = bloodGroup;
    if (district) filter.district = district;
    if (upazila) filter.upazila = upazila;

    const donors = await usersCollection
      .find(filter, { projection: { hashedPassword: 0 } })
      .toArray();
    res.json(donors);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.use("/api/profile", profileRouter);
app.use("/api/users", usersRouter);
app.use("/api", donationRequestsRouter);
app.use("/api", fundsRouter);
app.use("/api", statsRouter);

app.get("/", (req, res) => {
  res.json({ message: "Blood Donation Platform Server is running 🩸" });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

connectDB();
