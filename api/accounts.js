import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "aws_accounts";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const supabase = getSupabaseClient();

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json(data || []);
    } catch (err) {
      console.error("[api/accounts] GET error:", err);
      return res.status(500).json({ error: err.message || "Unable to load accounts." });
    }
  }

  if (req.method === "POST") {
    const { id, name, region, hasCredentials = true } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: "Account ID and Name are required." });

    try {
      const { data, error } = await supabase
        .from(TABLE)
        .upsert({
          id,
          name,
          region,
          has_credentials: hasCredentials,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select();

      if (error) throw error;
      return res.status(200).json(data?.[0]);
    } catch (err) {
      console.error("[api/accounts] POST error:", err);
      return res.status(500).json({ error: err.message || "Unable to save account metadata." });
    }
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Account ID is required." });

    try {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      
      // Also delete credentials
      await supabase.from("aws_account_credentials").delete().eq("account_id", id);

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[api/accounts] DELETE error:", err);
      return res.status(500).json({ error: err.message || "Unable to delete account." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
