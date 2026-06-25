import express from "express";
import { ObjectId } from "mongodb";
import { db } from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();
const usersCollection = db.collection("user");

// Get logged-in user profile details
router.get("/", verifyToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { hashedPassword: 0 } }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update profile details
router.patch("/", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
