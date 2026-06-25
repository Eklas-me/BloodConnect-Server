import express from "express";
import { ObjectId } from "mongodb";
import { db } from "../config/db.js";
import { verifyToken, verifyAdminOrVolunteer } from "../middleware/auth.js";

const router = express.Router();
const usersCollection = db.collection("user");
const donationRequestsCollection = db.collection("donationRequests");

// Create blood donation request
router.post("/donation-requests", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all PENDING donation requests (public)
router.get("/donation-requests", async (req, res) => {
  try {
    const requests = await donationRequestsCollection
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get specific request details
router.get("/donation-requests/:id", verifyToken, async (req, res) => {
  try {
    const request = await donationRequestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Edit request
router.patch("/donation-requests/:id", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Delete request
router.delete("/donation-requests/:id", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update request status (done, canceled, etc.)
router.patch("/donation-requests/:id/status", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Confirm donation (shift pending -> inprogress)
router.patch("/donation-requests/:id/donate", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get logged-in user requests
router.get("/my-donation-requests", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get 3 recent logged-in user requests
router.get("/my-donation-requests/recent", verifyToken, async (req, res) => {
  try {
    const requests = await donationRequestsCollection
      .find({ requesterEmail: req.user.email })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all requests globally (Admin/Volunteer only)
router.get("/all-donation-requests", verifyToken, verifyAdminOrVolunteer, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
