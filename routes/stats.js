import express from "express";
import { db } from "../config/db.js";
import { verifyToken, verifyAdminOrVolunteer } from "../middleware/auth.js";

const router = express.Router();
const usersCollection = db.collection("user");
const donationRequestsCollection = db.collection("donationRequests");
const fundsCollection = db.collection("funds");

// Get statistics summary (Admin/Volunteer only)
router.get("/stats", verifyToken, verifyAdminOrVolunteer, async (req, res) => {
  try {
    const totalDonors = await usersCollection.countDocuments({ role: "donor" });
    const totalRequests = await donationRequestsCollection.countDocuments();

    const fundingAgg = await fundsCollection
      .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
      .toArray();
    const totalFunding = fundingAgg[0]?.total || 0;

    res.json({ totalDonors, totalRequests, totalFunding });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
