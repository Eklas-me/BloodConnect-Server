import jwt from "jsonwebtoken";
import { db } from "../config/db.js";
import * as dotenv from "dotenv";

dotenv.config();

const usersCollection = db.collection("user");

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Access token missing" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const dbUser = await usersCollection.findOne({ email: decoded.email });
    if (!dbUser) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }

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

export const verifyAdmin = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }
  next();
};

export const verifyAdminOrVolunteer = async (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "volunteer") {
    return res.status(403).json({ message: "Forbidden: Admins and Volunteers only" });
  }
  next();
};
