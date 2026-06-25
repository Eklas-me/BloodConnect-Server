import express from "express";
import { db } from "../config/db.js";
import { verifyToken, verifyAdminOrVolunteer } from "../middleware/auth.js";

const router = express.Router();
const usersCollection = db.collection("user");
const donationRequestsCollection = db.collection("donationRequests");
const fundsCollection = db.collection("funds");

// Public stats
router.get("/public-stats", async (req, res) => {
  try {
    const [
      activeDonors,
      totalRequests,
      livesSaved,
      fundingAgg,
    ] = await Promise.all([
      usersCollection.countDocuments({ role: "donor", status: "active" }),
      donationRequestsCollection.countDocuments(),
      donationRequestsCollection.countDocuments({ status: "done" }),
      fundsCollection
        .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
        .toArray(),
    ]);

    const totalFunding = fundingAgg[0]?.total || 0;

    res.json({
      activeDonors,
      totalRequests,
      livesSaved,
      totalFunding,
    });
  } catch (err) {
    console.error("Public stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin and volunteer stats
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
