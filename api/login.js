import { getSupabaseClient } from "./supabaseClient.js";

function normalizeEnvJson(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getDashboardCredentials() {
  const raw = normalizeEnvJson(
    process.env.DASHBOARD_CREDENTIALS || process.env.VITE_DEFAULT_CREDENTIALS
  );
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[login] Could not parse dashboard credentials:", err);
    return [];
  }
}

async function getUserFromDatabase(email) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("dashboard_users")
      .select("email,name,role,password,last_login")
      .eq("email", email)
      .limit(1)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn("[login] Supabase user lookup failed:", err.message || err);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const credentials = getDashboardCredentials();
  let user = await getUserFromDatabase(email);
  if (user) {
    if (user.password !== password) {
      user = null;
    }
  }

  if (!user && credentials.length === 0) {
    return res.status(503).json({
      error: "Dashboard login credentials are not configured in Vercel.",
    });
  }

  if (!user) {
    user = credentials.find(
      (cred) => cred.email === email && cred.password === password
    );
  }

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { password: _password, ...safeUser } = user;
  return res.status(200).json({ user: safeUser });
}
