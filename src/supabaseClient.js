import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtbGFhaW9scXdrbm93aHRkZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTk2MTUsImV4cCI6MjA5NjMzNTYxNX0.0RyMAC4JVxGSErcAzTZaaWkWtzSpGpz8laaFye7r2Go";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
