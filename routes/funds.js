import express from "express";
import Stripe from "stripe";
import { db } from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";
import * as dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const fundsCollection = db.collection("funds");
const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);

// Get all funding history
router.get("/funds", verifyToken, async (req, res) => {
  try {
    const funds = await fundsCollection.find().sort({ date: -1 }).toArray();
    res.json(funds);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Record a new fund transaction
router.post("/funds", verifyToken, async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create payment intent for Stripe
router.post("/create-payment-intent", verifyToken, async (req, res) => {
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

export default router;
