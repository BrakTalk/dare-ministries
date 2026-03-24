// Exposes environment variables to Nunjucks templates.
// The Supabase anon key is intentionally public — it is secured by Row Level Security policies.
module.exports = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
};
