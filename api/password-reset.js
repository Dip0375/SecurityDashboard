import { getSupabaseClient } from "./supabaseClient.js";
import { sendEmail } from "./send-email.js";
import { randomBytes } from "crypto";

const TABLE = "dashboard_users";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });

  const supabase = getSupabaseClient();

  try {
    // 1. Check if user exists
    const { data: user, error: userError } = await supabase
      .from(TABLE)
      .select("email, name")
      .eq("email", email)
      .single();

    if (userError || !user) {
      // Don't reveal if user exists or not for security, but we'll return success anyway
      return res.status(200).json({ success: true, message: "If the account exists, a reset link has been sent." });
    }

    // 2. Generate a token (simulated for this dashboard)
    const token = randomBytes(32).toString("hex");
    const resetLink = `${process.env.ALLOWED_ORIGIN || "http://localhost:5173"}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    // 3. Send Email
    await sendEmail({
      to: email,
      subject: "Password Reset Request - AWS Secure View",
      html: `
        <div style="font-family: sans-serif; max-width: 600px;">
          <h2 style="color: #ff3b5c;">Password Reset Request</h2>
          <p>Hello ${user.name || "User"},</p>
          <p>We received a request to reset your password for the AWS Secure View dashboard.</p>
          <p>Click the link below to set a new password:</p>
          <div style="margin: 20px 0;">
            <a href="${resetLink}" style="background: #00d4ff; color: #05080f; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
          </div>
          <p>If you didn't request this, you can safely ignore this email.</p>
          <br/>
          <p>Best regards,<br/>The Security Team</p>
        </div>
      `
    });

    return res.status(200).json({ success: true, message: "Reset link sent." });

  } catch (err) {
    console.error("[api/password-reset] Error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
