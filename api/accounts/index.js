import { getSupabaseClient, encryptPayload } from "../supabaseClient.js";

const TABLE = "aws_accounts";
const CREDENTIALS_TABLE = "aws_account_credentials";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from(TABLE)
        .select("account_id,name,region,has_credentials,created_at,updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json((data || []).map((row) => ({
        id: row.account_id,
        name: row.name,
        region: row.region,
        hasCredentials: !!row.has_credentials,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })));
    } catch (err) {
      console.error("[api/accounts] GET error:", err);
      return res.status(500).json({ error: err.message || "Unable to load AWS accounts." });
    }
  }

  if (req.method === "POST") {
    const { accountId, name, region, accessKeyId, secretAccessKey } = req.body || {};
    if (!accountId || !name || !region || !accessKeyId || !secretAccessKey) {
      return res.status(400).json({ error: "accountId, name, region, accessKeyId and secretAccessKey are required." });
    }
    try {
      const supabase = getSupabaseClient();
      const encryptedSecret = encryptPayload({ accessKeyId, secretAccessKey, region });
      const now = new Date().toISOString();
      const { error: accountError } = await supabase.from(TABLE).upsert({
        account_id: accountId,
        name,
        region,
        has_credentials: true,
        updated_at: now,
        created_at: now,
      }, { onConflict: "account_id" });
      if (accountError) throw accountError;
      const { error: credentialsError } = await supabase.from(CREDENTIALS_TABLE).upsert({
        account_id: accountId,
        encrypted_secret: encryptedSecret,
        updated_at: now,
        created_at: now,
      }, { onConflict: "account_id" });
      if (credentialsError) throw credentialsError;
      return res.status(200).json({
        id: accountId,
        name,
        region,
        hasCredentials: true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      console.error("[api/accounts] POST error:", err);
      return res.status(500).json({ error: err.message || "Unable to save AWS account." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
