import express from "express";
import { ObjectId } from "mongodb";
import { db } from "../config/db.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";

const router = express.Router();
const usersCollection = db.collection("user");

// Get all users (Admin only)
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const users = await usersCollection
      .find(filter, { projection: { hashedPassword: 0 } })
      .toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update user status active/blocked (Admin only)
router.patch("/:id/status", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: `User ${status === "blocked" ? "blocked" : "unblocked"} successfully` });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update user role donor/volunteer/admin (Admin only)
router.patch("/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: `User role updated to ${role}` });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
