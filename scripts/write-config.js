// Writes config.js from environment variables (used on Vercel).
const fs = require("fs");
const path = require("path");

const supabaseUrl =
  process.env.supabase_url ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "";
const supabaseAnonKey =
  process.env.supabase_anon_key ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";
const adminPin =
  process.env.admin_pin || process.env.ADMIN_PIN || "cos2026";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[write-config] supabase_url / supabase_anon_key missing — writing placeholder config (local-only mode)."
  );
}

const out = `// Generated at build time — do not edit by hand on Vercel.
window.COS_CONFIG = {
  supabaseUrl: ${JSON.stringify(supabaseUrl || "https://YOUR_PROJECT_REF.supabase.co")},
  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey || "YOUR_SUPABASE_ANON_KEY")},
  adminPin: ${JSON.stringify(adminPin)},
};
`;

fs.writeFileSync(path.join(__dirname, "..", "config.js"), out, "utf8");
console.log("[write-config] Wrote config.js");
