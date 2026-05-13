import { getSupabaseClient } from "../../supabaseClient.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: "Account id is required." });
  const supabase = getSupabaseClient();

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("aws_account_credentials")
        .select("account_id")
        .eq("account_id", id)
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return res.status(200).json({ hasCredentials: !!data });
    } catch (err) {
      console.error("[api/accounts/[id]/credentials] GET error:", err);
      return res.status(500).json({ error: err.message || "Unable to load credentials metadata." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
