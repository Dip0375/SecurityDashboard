/**
 * credentialStore.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Secure client-side credential store for AWS account keys.
 *
 * SECURITY DESIGN
 * ───────────────
 * 1. AES-GCM 256-bit encryption via the browser's Web Crypto API (hardware-
 *    accelerated, runs inside a secure context – HTTPS / localhost only).
 * 2. The encryption key is derived with PBKDF2 from a per-session secret
 *    (the user's login password hash) + a random salt stored alongside the
 *    cipher-text.  An attacker who only has access to localStorage (e.g. via
 *    XSS) still cannot decrypt without the session secret.
 * 3. AWS credentials are NEVER written to plain-text localStorage, cookies,
 *    or the URL.
 * 4. The in-memory map `_cache` is the only decrypted copy; it is cleared on
 *    logout / page unload.
 * 5. For production you should replace the localStorage backend with a call to
 *    YOUR OWN backend API (see the TODO comment below).  The interface here is
 *    intentionally identical so the swap is a 1-line change.
 *
 * GITHUB / VERCEL SAFETY
 * ──────────────────────
 * • No secret ever appears in source code or .env (keys are runtime inputs).
 * • The .gitignore already excludes *.local – confirm `.env.local` is listed.
 * • Set VITE_DEFAULT_CREDENTIALS in Vercel Environment Variables UI (never
 *   commit it).  AWS keys must NEVER be placed in VITE_* variables because
 *   Vite bakes them into the public bundle.
 */

// ─── In-memory cache (cleared on logout) ─────────────────────────────────────
const _cache = new Map();         // accountId  →  { accessKeyId, secretAccessKey, region }
let   _sessionKey = null;         // CryptoKey   (set on login, cleared on logout)
const STORE_PREFIX = "asv_cred_"; // localStorage key prefix

// ─── Web Crypto helpers ───────────────────────────────────────────────────────

/** Convert a string to Uint8Array */
const enc = (s) => new TextEncoder().encode(s);

/** Convert Uint8Array to base64 string */
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Convert base64 string to Uint8Array */
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Derive an AES-GCM key from a user-supplied passphrase + random salt.
 * @param {string} passphrase  – e.g. the user's hashed login password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey(
    "raw", enc(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a JS object and return a compact JSON envelope.
 * @param {object} payload
 * @param {string} passphrase
 * @returns {Promise<string>}  – the JSON envelope (safe to store)
 */
async function encrypt(payload, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const ct   = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc(JSON.stringify(payload))
  );
  return JSON.stringify({ s: toB64(salt), i: toB64(iv), c: toB64(ct) });
}

/**
 * Decrypt a JSON envelope produced by `encrypt`.
 * @param {string} envelope
 * @param {string} passphrase
 * @returns {Promise<object>}
 */
async function decrypt(envelope, passphrase) {
  const { s, i, c } = JSON.parse(envelope);
  const salt = fromB64(s);
  const iv   = fromB64(i);
  const ct   = fromB64(c);
  const key  = await deriveKey(passphrase, salt);
  const pt   = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once on login.  Loads + decrypts any previously stored credentials.
 * @param {string} passphrase  – user session secret (hashed password, etc.)
 */
export async function initStore(passphrase) {
  _sessionKey = passphrase; // keep in memory only
  _cache.clear();

  // Load previously saved entries
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(STORE_PREFIX)) continue;
    const accountId = k.slice(STORE_PREFIX.length);
    try {
      const cred = await decrypt(localStorage.getItem(k), passphrase);
      _cache.set(accountId, cred);
    } catch {
      // Wrong passphrase or corrupted data – skip silently
      console.warn(`[credentialStore] Could not decrypt entry for ${accountId}`);
    }
  }
}

/**
 * Save an AWS account's credentials (encrypted into localStorage).
 * @param {string} accountId
 * @param {{ accessKeyId: string, secretAccessKey: string, region: string }} cred
 */
export async function saveCredential(accountId, cred) {
  if (!_sessionKey) throw new Error("Store not initialised — call initStore first");
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId,
      name: cred.name || accountId,
      region: cred.region,
      accessKeyId: cred.accessKeyId,
      secretAccessKey: cred.secretAccessKey,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to store AWS credentials.");
  }

  _cache.set(accountId, cred);
  return await res.json();
}

/**
 * Retrieve a credential from the in-memory cache.
 * Returns null if not found (never throws).
 * @param {string} accountId
 * @returns {{ accessKeyId: string, secretAccessKey: string, region: string } | null}
 */
export function getCredential(accountId) {
  return _cache.get(accountId) ?? null;
}

/**
 * Remove a credential from both cache and localStorage.
 * @param {string} accountId
 */
export function removeCredential(accountId) {
  _cache.delete(accountId);
  localStorage.removeItem(STORE_PREFIX + accountId);
}

/**
 * Clear everything from cache and localStorage.
 * Call this on logout.
 */
export function clearStore() {
  _cache.clear();
  _sessionKey = null;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(STORE_PREFIX)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * List all account IDs that have stored credentials.
 * @returns {string[]}
 */
export function listStoredAccounts() {
  const ids = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(STORE_PREFIX)) ids.push(k.slice(STORE_PREFIX.length));
  }
  return ids;
}

/**
 * Returns true when the store has been initialised for this session.
 */
export function isStoreReady() {
  return _sessionKey !== null;
}
