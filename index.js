// ─── Fix TLS issues on Windows + Node.js v26 (local dev only) ───────────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { toNodeHandler } from "better-auth/node";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── MongoDB Client ───────────────────────────────────────────────────────────
const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mongodb.net/?retryWrites=true&w=majority`;

const mongoClient = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // Workaround for TLS handshake issues on Windows + Node.js 22+/24+
  // This disables hostname verification locally; not needed on Vercel Linux
  tls: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
});

const db = mongoClient.db("bloodDonationDB");

// ─── Better Auth Setup ────────────────────────────────────────────────────────
const auth = betterAuth({
  database: mongodbAdapter(db),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:5174",
    process.env.CLIENT_URL,
  ].filter(Boolean),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  user: {
    additionalFields: {
      bloodGroup: { type: "string", required: false, defaultValue: "" },
      district: { type: "string", required: false, defaultValue: "" },
      upazila: { type: "string", required: false, defaultValue: "" },
      avatar: { type: "string", required: false, defaultValue: "" },
      role: { type: "string", required: false, defaultValue: "donor" },
      status: { type: "string", required: false, defaultValue: "active" },
    },
  },
  session: {
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
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

// Mount Better Auth handler — handles /api/auth/* routes
app.all("/api/auth/*splat", toNodeHandler(auth));

// JSON body parser (after Better Auth handler)
app.use(express.json());

// ─── Collections ─────────────────────────────────────────────────────────────
const usersCollection = db.collection("user"); // Better Auth uses "user" collection
const donationRequestsCollection = db.collection("donationRequests");
const fundsCollection = db.collection("funds");

// ─── JWT Token Endpoint ──────────────────────────────────────────────────────
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

// ─── Auth Middleware (JWT Verification) ──────────────────────────────────────
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Access token missing" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Find the user from the Better Auth "user" collection by email
    const dbUser = await usersCollection.findOne({ email: decoded.email });
    if (!dbUser) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }

    // Set req.user to match expected object structure in the route handlers
    req.user = {
      id: dbUser._id.toString(),
      email: dbUser.email,
      role: dbUser.role || "donor",
      status: dbUser.status || "active",
      name: dbUser.name,
    };
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};


// ─── Role Middleware ──────────────────────────────────────────────────────────
const verifyAdmin = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }
  next();
};

const verifyAdminOrVolunteer = async (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "volunteer") {
    return res.status(403).json({ message: "Forbidden: Admins and Volunteers only" });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/profile", verifyToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { hashedPassword: 0 } }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/profile", verifyToken, async (req, res) => {
  try {
    const { name, avatar, bloodGroup, district, upazila } = req.body;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { name, avatar, bloodGroup, district, upazila, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "Profile updated successfully" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT ROUTES (Admin only)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const users = await usersCollection
      .find(filter, { projection: { hashedPassword: 0 } })
      .toArray();
    res.json(users);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/users/:id/status", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status } }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ message: "User not found" });
    res.json({ message: `User ${status === "blocked" ? "blocked" : "unblocked"} successfully` });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role } }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ message: "User not found" });
    res.json({ message: `User role updated to ${role}` });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DONATION REQUEST ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/donation-requests", verifyToken, async (req, res) => {
  try {
    const dbUser = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
    if (!dbUser || dbUser.status === "blocked") {

      return res.status(403).json({ message: "Blocked users cannot create donation requests" });
    }

    const {
      requesterName, requesterEmail, recipientName,
      recipientDistrict, recipientUpazila, hospitalName,
      fullAddress, bloodGroup, donationDate, donationTime, requestMessage,
    } = req.body;

    const newRequest = {
      requesterName, requesterEmail, recipientName,
      recipientDistrict, recipientUpazila, hospitalName,
      fullAddress, bloodGroup, donationDate, donationTime,
      requestMessage, status: "pending",
      donorName: null, donorEmail: null,
      createdAt: new Date(),
    };

    const result = await donationRequestsCollection.insertOne(newRequest);
    res.status(201).json({ message: "Donation request created", id: result.insertedId });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all PENDING donation requests (public)
app.get("/api/donation-requests", async (req, res) => {
  try {
    const requests = await donationRequestsCollection
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(requests);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/donation-requests/:id", verifyToken, async (req, res) => {
  try {
    const request = await donationRequestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/donation-requests/:id", verifyToken, async (req, res) => {
  try {
    const {
      recipientName, recipientDistrict, recipientUpazila,
      hospitalName, fullAddress, bloodGroup, donationDate,
      donationTime, requestMessage,
    } = req.body;

    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id), requesterEmail: req.user.email },
      {
        $set: {
          recipientName, recipientDistrict, recipientUpazila,
          hospitalName, fullAddress, bloodGroup, donationDate,
          donationTime, requestMessage, updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Request not found or not authorized" });
    }
    res.json({ message: "Donation request updated" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/donation-requests/:id", verifyToken, async (req, res) => {
  try {
    const query = { _id: new ObjectId(req.params.id) };
    if (req.user?.role !== "admin") {
      query.requesterEmail = req.user.email;
    }
    const result = await donationRequestsCollection.deleteOne(query);
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Request not found or not authorized" });
    }
    res.json({ message: "Donation request deleted" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/donation-requests/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const query = { _id: new ObjectId(req.params.id) };
    if (req.user?.role !== "admin" && req.user?.role !== "volunteer") {
      query.requesterEmail = req.user.email;
    }
    const result = await donationRequestsCollection.updateOne(query, {
      $set: { status, updatedAt: new Date() },
    });
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Request not found or not authorized" });
    }
    res.json({ message: `Status updated to ${status}` });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/donation-requests/:id/donate", verifyToken, async (req, res) => {
  try {
    const { donorName, donorEmail } = req.body;
    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id), status: "pending" },
      { $set: { status: "inprogress", donorName, donorEmail, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(400).json({ message: "Request not found or already in progress" });
    }
    res.json({ message: "Donation confirmed! Status changed to inprogress." });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/my-donation-requests", verifyToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter = { requesterEmail: req.user.email };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await donationRequestsCollection.countDocuments(filter);
    const requests = await donationRequestsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.json({ requests, total, page: parseInt(page), limit: parseInt(limit) });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/my-donation-requests/recent", verifyToken, async (req, res) => {
  try {
    const requests = await donationRequestsCollection
      .find({ requesterEmail: req.user.email })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();
    res.json(requests);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/all-donation-requests", verifyToken, verifyAdminOrVolunteer, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter = status ? { status } : {};

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await donationRequestsCollection.countDocuments(filter);
    const requests = await donationRequestsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.json({ requests, total, page: parseInt(page), limit: parseInt(limit) });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH ROUTE (public)
// ═══════════════════════════════════════════════════════════════════════════

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
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FUNDING ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/funds", verifyToken, async (req, res) => {
  try {
    const funds = await fundsCollection.find().sort({ date: -1 }).toArray();
    res.json(funds);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/funds", verifyToken, async (req, res) => {
  try {
    const { userName, userEmail, amount, transactionId } = req.body;
    const fund = {
      userName, userEmail,
      amount: parseFloat(amount),
      transactionId,
      date: new Date(),
    };
    const result = await fundsCollection.insertOne(fund);
    res.status(201).json({ message: "Fund recorded", id: result.insertedId });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/create-payment-intent", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: Math.round(parseFloat(amount) * 100),
      currency: "usd",
      payment_method_types: ["card"],
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ message: "Payment initialization failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATS ROUTE
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/stats", verifyToken, verifyAdminOrVolunteer, async (req, res) => {
  try {
    const totalDonors = await usersCollection.countDocuments({ role: "donor" });
    const totalRequests = await donationRequestsCollection.countDocuments();

    const fundingAgg = await fundsCollection
      .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
      .toArray();
    const totalFunding = fundingAgg[0]?.total || 0;

    res.json({ totalDonors, totalRequests, totalFunding });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ message: "Blood Donation Platform Server is running 🩸" });
});

// ─── Start Server + Connect MongoDB ──────────────────────────────────────────
// Server starts first, MongoDB connects in background (prevents crash on local dev)
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

async function connectDB() {
  try {
    await mongoClient.connect();
    console.log("✅ Connected to MongoDB & Better Auth ready");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.log("⏳ Retrying in 5 seconds...");
    setTimeout(connectDB, 5000);
  }
}

connectDB();
