import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY;

function ensureSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase server-side environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
}

export function getSupabaseClient() {
  ensureSupabaseEnv();
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "secureview-server" } },
  });
}

function ensureEncryptionKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error(
      "Missing APP_ENCRYPTION_KEY environment variable. Set APP_ENCRYPTION_KEY in Vercel."
    );
  }
}

const PBKDF2_ITERATIONS = 200_000;
const KEY_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";

function deriveKey(passphrase, salt) {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function fromBase64(value) {
  return Buffer.from(value, "base64");
}

export function encryptPayload(payload, passphrase = ENCRYPTION_KEY) {
  ensureEncryptionKey();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    s: toBase64(salt),
    i: toBase64(iv),
    c: toBase64(ciphertext),
    t: toBase64(tag),
  });
}

export function decryptPayload(envelope, passphrase = ENCRYPTION_KEY) {
  ensureEncryptionKey();
  const { s, i, c, t } = JSON.parse(envelope);
  const salt = fromBase64(s);
  const iv = fromBase64(i);
  const ciphertext = fromBase64(c);
  const tag = fromBase64(t);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
