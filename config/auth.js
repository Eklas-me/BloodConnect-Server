import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { db } from "./db.js";
import * as dotenv from "dotenv";

dotenv.config();

export const auth = betterAuth({
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
