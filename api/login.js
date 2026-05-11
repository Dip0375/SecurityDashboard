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

  const user = getDashboardCredentials().find(
    (cred) => cred.email === email && cred.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { password: _password, ...safeUser } = user;
  return res.status(200).json({ user: safeUser });
}
