import { getSupabaseClient } from "./supabaseClient.js";
import { sendEmail } from "./send-email.js";

const TABLE = "dashboard_users";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const supabase = getSupabaseClient();

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("email,name,role,last_login,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json(data || []);
    } catch (err) {
      console.error("[api/users] GET error:", err);
      return res.status(500).json({ error: err.message || "Unable to load users." });
    }
  }

  if (req.method === "POST") {
    const {
      email, password, role = "viewer", name = "User",
      notifyEmail, notificationsEnabled,
      notify_failed_login, notify_new_login, notify_password_change,
      notify_user_add, notify_critical_alert,
    } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    try {
      const now = new Date().toISOString();
      const payload = {
        email,
        role,
        name,
        updated_at: now,
      };

      // Persist notification preferences if provided
      if (notifyEmail !== undefined) payload.notify_email = notifyEmail;
      if (notificationsEnabled !== undefined) payload.notifications_enabled = notificationsEnabled;
      if (notify_failed_login !== undefined) payload.notify_failed_login = notify_failed_login;
      if (notify_new_login !== undefined) payload.notify_new_login = notify_new_login;
      if (notify_password_change !== undefined) payload.notify_password_change = notify_password_change;
      if (notify_user_add !== undefined) payload.notify_user_add = notify_user_add;
      if (notify_critical_alert !== undefined) payload.notify_critical_alert = notify_critical_alert;

      // Only set/update password if provided (prevents overwriting with empty)
      if (password) {
        payload.password = password;
      } else {
        // If it's a new user and no password, we still need it
        const { data: existing } = await supabase.from(TABLE).select("email").eq("email", email).single();
        if (!existing && !password) {
          return res.status(400).json({ error: "Password is required for new users." });
        }
      }

      const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: "email" });
      if (error) throw error;

      // Send Welcome Email
      try {
        await sendEmail({
          to: email,
          subject: "Welcome to AWS Secure View",
          html: `
            <div style="font-family: sans-serif; max-width: 600px;">
              <h2 style="color: #00d4ff;">Welcome to AWS Secure View!</h2>
              <p>Hello ${name},</p>
              <p>Your account has been successfully onboarded to the AWS Secure View dashboard.</p>
              <p><strong>Role:</strong> ${role}</p>
              <p>You can now login and monitor your AWS accounts.</p>
              <br/>
              <p>Best regards,<br/>The Security Team</p>
            </div>
          `
        });
      } catch (emailErr) {
        console.warn("[api/users] Welcome email failed:", emailErr.message);
      }

      return res.status(200).json({ email, role, name, lastLogin: now });
    } catch (err) {
      console.error("[api/users] POST error:", err);
      return res.status(500).json({ error: err.message || "Unable to save user." });
    }
  }

  if (req.method === "DELETE") {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required." });

    try {
      const { error } = await supabase.from(TABLE).delete().eq("email", email);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[api/users] DELETE error:", err);
      return res.status(500).json({ error: err.message || "Unable to delete user." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
