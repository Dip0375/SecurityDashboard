import { getSupabaseClient, encryptPayload } from "./supabaseClient.js";

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
    const { id, accountId, name, region, accessKeyId, secretAccessKey, hasCredentials = true } = req.body || {};
    const finalId = id || accountId;

    if (!finalId || !name) {
      return res.status(400).json({ error: "Account ID and Name are required." });
    }

    try {
      // 1. Store/Update Account Metadata
      const { data: accData, error: accErr } = await supabase
        .from(TABLE)
        .upsert({
          id: finalId,
          name,
          region,
          has_credentials: !!(accessKeyId && secretAccessKey) || hasCredentials,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select();

      if (accErr) throw accErr;

      // 2. If keys are provided, encrypt and store them
      if (accessKeyId && secretAccessKey) {
        const encrypted = encryptPayload({ accessKeyId, secretAccessKey, region });
        const { error: credErr } = await supabase
          .from("aws_account_credentials")
          .upsert({
            account_id: finalId,
            encrypted_secret: encrypted,
            created_at: new Date().toISOString()
          }, { onConflict: "account_id" });

        if (credErr) throw credErr;
      }

      return res.status(200).json(accData?.[0]);
    } catch (err) {
      console.error("[api/accounts] POST error:", err);
      return res.status(500).json({ error: err.message || "Unable to save account metadata or credentials." });
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
