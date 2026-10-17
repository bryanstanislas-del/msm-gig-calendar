// The ONE browser Supabase client. Calendar, auth/session, admin and
// advertising screens all import `supabase` from here (enforced by
// tests/supabaseSingleClient.test.js), so an isolated preview can never show
// production data in one screen and staging in another. Project selection
// (production default, or a COMPLETE build-time override) lives in
// ./supabaseConfig.js; a partial override throws instead of mixing projects.
import { createClient } from '@supabase/supabase-js';
import { resolveBrowserSupabase } from './supabaseConfig.js';

export const SUPABASE_PROJECT = resolveBrowserSupabase(import.meta.env || {});
export const supabase = createClient(SUPABASE_PROJECT.url, SUPABASE_PROJECT.anonKey);
