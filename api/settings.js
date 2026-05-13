import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "dashboard_settings";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const supabase = getSupabaseClient();

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from(TABLE).select("key, value_encrypted");
      if (error) throw error;
      // We don't decrypt here for safety; the calling API will decrypt when needed.
      // We only return the keys that are set.
      return res.status(200).json(data.map(d => ({ key: d.key, isSet: true })));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ error: "Key and value required" });

    try {
      const { encryptPayload } = await import("./supabaseClient.js");
      const encrypted = encryptPayload(value);
      
      const { error } = await supabase.from(TABLE).upsert({
        key,
        value_encrypted: encrypted,
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });
      
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
