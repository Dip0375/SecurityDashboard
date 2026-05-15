/**
 * api/accounts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * This file intentionally delegates to api/accounts/index.js which is the
 * canonical handler for all /api/accounts routes.
 *
 * Vercel resolves /api/accounts to api/accounts/index.js when the directory
 * exists, so this file should never be reached. It is kept here only to
 * prevent a 404 in edge cases and to document the routing intent.
 */
export { default } from "./accounts/index.js";
