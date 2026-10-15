import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtbGFhaW9scXdrbm93aHRkZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTk2MTUsImV4cCI6MjA5NjMzNTYxNX0.0RyMAC4JVxGSErcAzTZaaWkWtzSpGpz8laaFye7r2Go";

// Optional build-time override so an isolated Vercel PREVIEW (with
// preview/branch-scoped env vars) can point at a staging Supabase project
// instead of production. Both must be set; otherwise the production values
// above are used exactly as before.
const OVERRIDE_URL = import.meta.env?.VITE_SUPABASE_URL;
const OVERRIDE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
const useOverride = Boolean(OVERRIDE_URL && OVERRIDE_KEY);

export const supabase = createClient(useOverride ? OVERRIDE_URL : SUPABASE_URL, useOverride ? OVERRIDE_KEY : SUPABASE_ANON_KEY);
