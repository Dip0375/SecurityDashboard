import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "audit_logs";

// ─── Cleanup logic (flush logs older than 48 hours) ───────────────────────────
async function flushOldLogs(supabase) {
  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .lt("ts", fortyEightHoursAgo);
    if (error) console.error("[api/audit] Flush error:", error);
  } catch (err) {
    console.error("[api/audit] Flush exception:", err);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const supabase = getSupabaseClient();

  // Run cleanup on every request (or could be a cron)
  await flushOldLogs(supabase);

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("id,ts,user,email,role,action,detail,status,ip")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json(data || []);
    } catch (err) {
      console.error("[api/audit] GET error:", err);
      return res.status(500).json({ error: err.message || "Unable to load audit logs." });
    }
  }

  if (req.method === "POST") {
    const { ts, user, email, role, action, detail, status = "info", ip = "-" } = req.body || {};
    if (!action || !user) {
      return res.status(400).json({ error: "Action and user are required." });
    }
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from(TABLE).insert([{ ts: ts || now, user, email, role, action, detail, status, ip }]);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[api/audit] POST error:", err);
      return res.status(500).json({ error: err.message || "Unable to save audit event." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
