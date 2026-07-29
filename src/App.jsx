// ════════════════════════════════════════════════════════════════════
//  MUSIC SCENE MAGAZINE — GIG CALENDAR
//  Full-featured: Auth · Admin · Filters · iCal · Supabase-ready
// ════════════════════════════════════════════════════════════════════
//
//  SUPABASE SETUP
//  ─────────────
//  1. Create a project at https://supabase.com
//  2. Run this SQL in the Supabase SQL editor:
//
//  -- Users table (handled by Supabase Auth automatically)
//
//  create table public.profiles (
//    id uuid references auth.users on delete cascade primary key,
//    band_name text,
//    role text default 'band'   -- 'band' | 'admin'
//  );
//
//  create table public.gigs (
//    id uuid default gen_random_uuid() primary key,
//    band_name text not null,
//    venue text not null,
//    city text not null,
//    date date not null,
//    time text not null,
//    genre text not null,
//    tickets text,
//    notes text,
//    status text default 'pending',   -- 'pending' | 'approved' | 'rejected'
//    submitted_by uuid references auth.users,
//    created_at timestamptz default now()
//  );
//
//  -- RLS policies
//  alter table public.gigs enable row level security;
//  create policy "Public approved gigs" on public.gigs for select using (status = 'approved');
//  create policy "Band inserts own gigs" on public.gigs for insert with check (auth.uid() = submitted_by);
//  create policy "Admin all access" on public.gigs for all using (
//    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
//  );
//
//  3. Replace SUPABASE_URL and SUPABASE_ANON_KEY below with your project values.
//  4. To make someone an admin: update public.profiles set role='admin' where id='<uuid>';
//
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import React from "react";
import { BrowserRouter, Routes, Route, useParams, useNavigate, Link } from "react-router-dom";

// ── Supabase config ────────────────────────────────────────────────
const SUPABASE_URL = "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtbGFhaW9scXdrbm93aHRkZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTk2MTUsImV4cCI6MjA5NjMzNTYxNX0.0RyMAC4JVxGSErcAzTZaaWkWtzSpGpz8laaFye7r2Go";
const USE_MOCK = SUPABASE_URL === "YOUR_SUPABASE_URL";

// ── Constants ──────────────────────────────────────────────────────
// ── Genre system ───────────────────────────────────────────────────
// Flat sorted list used for dropdowns and filtering
const GENRES = [
  "Acoustic","Afrobeat","Alternative","Americana","Bluegrass","Blues","Blues Rock",
  "Britpop","Celtic","Classic Rock","Classical","Comedy","Country","Covers","Dance",
  "Electronic","Experimental","Folk","Folk Rock","Funk","Funk Rock","Fusion",
  "Garage Rock","Gospel","Grunge","Hard Rock","Hardcore","Hip-Hop","Indie Rock",
  "Jazz","Jazz-Funk","Latin","Metal","Metalcore","New Wave","Original Music",
  "Pop","Progressive Rock","Psychedelic","Punk","R&B","Reggae","Rock","Shoegaze",
  "Singer-Songwriter","Ska","Ska Punk","Soul","Southern Rock","Spoken Word",
  "Tribute","World Music","Other",
].sort();

const GENRE_COLORS = {
  "Acoustic":          "#a5d6a7",
  "Alternative":       "#ef5350",
  "Americana":         "#d4a373",
  "Blues":             "#1a78c2",
  "Blues Rock":        "#1565c0",
  "Britpop":           "#7986cb",
  "Celtic":            "#66bb6a",
  "Classic Rock":      "#ff8a65",
  "Classical":         "#90e0ef",
  "Comedy":            "#ffd600",
  "Country":           "#c9a227",
  "Covers":            "#bdbdbd",
  "Dance":             "#00e5ff",
  "Electronic":        "#9b5de5",
  "Experimental":      "#78909c",
  "Festival":          "#22d3ee",
  "Folk":              "#f4a261",
  "Folk Rock":         "#ffb74d",
  "Funk":              "#ff6f00",
  "Fusion":            "#26c6da",
  "Garage Rock":       "#ef9a9a",
  "Gospel":            "#fff176",
  "Grunge":            "#8d6e63",
  "Hard Rock":         "#b71c1c",
  "Hip-Hop":           "#ff9f1c",
  "Indie Rock":        "#e8203a",
  "Jazz":              "#43aa8b",
  "Jazz-Funk":         "#00897b",
  "Latin":             "#f06292",
  "Metal":             "#ff595e",
  "Metalcore":         "#c62828",
  "New Wave":          "#ab47bc",
  "Original Music":    "#29b6f6",
  "Pop":               "#ff6b9d",
  "Progressive Rock":  "#5c6bc0",
  "Psychedelic":       "#ce93d8",
  "Punk":              "#ff4d00",
  "R&B":               "#ce93d8",
  "Reggae":            "#2dc653",
  "Rock":              "#ff7043",
  "Shoegaze":          "#c77dff",
  "Singer-Songwriter": "#a1887f",
  "Ska":               "#ffee58",
  "Ska Punk":          "#d4e157",
  "Soul":              "#e040fb",
  "Southern Rock":     "#ffa726",
  "Spoken Word":       "#90a4ae",
  "Tribute":           "#b0bec5",
  "World Music":       "#52b788",
  "Afrobeat":          "#f4a261",
  "Bluegrass":         "#a5c27c",
  "Funk Rock":         "#ff8c42",
  "Hardcore":          "#d32f2f",
  "Ska Punk":          "#d4e157",
  "Other":             "#888888",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// ── Mock DB ────────────────────────────────────────────────────────
let MOCK_GIGS = [
  { id:"1", band_name:"The Velvet Wolves", venue:"The Roundhouse", city:"London",     date:"2026-06-05", time:"20:00", genre:"Indie Rock",  tickets:"https://example.com", notes:"",               status:"approved", submitted_by:"band1" },
  { id:"2", band_name:"Neon Satellites",   venue:"Fabric",          city:"London",     date:"2026-06-12", time:"22:00", genre:"Electronic",  tickets:"",                    notes:"18+ only",       status:"approved", submitted_by:"band2" },
  { id:"3", band_name:"The Copper Foxes",  venue:"Band on the Wall",city:"Manchester", date:"2026-06-12", time:"19:30", genre:"Folk",        tickets:"https://example.com", notes:"",               status:"approved", submitted_by:"band3" },
  { id:"4", band_name:"Static Bloom",      venue:"Stereo",          city:"Glasgow",    date:"2026-06-20", time:"21:00", genre:"Shoegaze",    tickets:"",                    notes:"Support TBC",    status:"pending",  submitted_by:"band4" },
  { id:"5", band_name:"Iron Circuit",      venue:"O2 Ritz",         city:"Manchester", date:"2026-06-18", time:"20:30", genre:"Metal",       tickets:"https://example.com", notes:"",               status:"approved", submitted_by:"band5" },
  { id:"6", band_name:"Jazz Architects",   venue:"Ronnie Scott's",  city:"London",     date:"2026-07-03", time:"19:00", genre:"Jazz",        tickets:"https://example.com", notes:"Sold out soon!", status:"pending",  submitted_by:"band6" },
];
let MOCK_USER = null;
let MOCK_PROFILE = null;
let mockIdCounter = 10;

const MOCK_USERS = {
  "admin@msm.co.uk":  { id:"admin1", email:"admin@msm.co.uk",  password:"admin123",  role:"admin", band_name:"MSM Staff" },
  "band@example.com": { id:"band1",  email:"band@example.com", password:"band123",   role:"band",  band_name:"The Velvet Wolves" },
};

// ── Official Supabase client ────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
const supabase = USE_MOCK ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
import NewsletterAdmin  from './components/admin/NewsletterAdmin';
import AdminFeatured    from './components/admin/AdminFeatured';
import AdminEditorial   from './components/admin/AdminEditorial';
import AdminSupporters  from './components/admin/AdminSupporters';
import AdminHallOfFame  from './components/admin/AdminHallOfFame';
import AdminFestivals   from './components/admin/AdminFestivals';
import ClaimDirectoryPage from './components/ClaimDirectoryPage';

// SPRINT 3: generalized Follow -- table/column routing. entityType
// "band" | "solo_artist" | "festival" (all rows in profiles --
// band_follows.band_profile_id is really just "any followable
// profiles.id") route to band_follows; "venue" routes to venue_follows.
const followTableFor  = (entityType) => entityType === "venue" ? "venue_follows" : "band_follows";
const followColumnFor = (entityType) => entityType === "venue" ? "venue_id" : "band_profile_id";

// ── DB abstraction (mock or real) ──────────────────────────────────
const DB = {
  // PHASE 4 FIX: signUp now passes profile_type in the auth metadata so
  // handle_new_user() knows which kind of account is being created.
  // - band / solo_artist: handle_new_user() auto-creates the profiles row
  //   (id auto-generated, user_id = auth user id). We then fill in the rest
  //   of the registration fields with an UPDATE keyed on user_id (NOT id --
  //   the old code upserted with id:user.id, which doesn't match the
  //   trigger-created row's generated id and silently created a second,
  //   orphaned, unlinked profile row on every signup).
  // - venue / festival / promoter: handle_new_user() deliberately skips
  //   profile creation for these types. Ownership is established later via
  //   the claim_requests approval workflow (see submitNewEntityRequest).
  async signUp(email, password, profile, profileType = "band") {
    if (USE_MOCK) {
      const id = `user_${Date.now()}`;
      MOCK_USERS[email] = { id, email, password, role:"band", band_name: profile.band_name };
      MOCK_USER    = { id, email };
      MOCK_PROFILE = { id, role:"band", profile_type: profileType, ...profile };
      return { user: MOCK_USER, profile: MOCK_PROFILE };
    }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { band_name: profile.band_name, profile_type: profileType } }
    });
    if (error) throw new Error(error.message);
    const user = data.user;
    if (!user) throw new Error("Account created! Please sign in.");

    if (["venue", "festival", "promoter"].includes(profileType)) {
      // No profiles row exists yet for these types -- caller is responsible
      // for submitting a claim_requests entry (see submitNewEntityRequest).
      return { user, profile: null };
    }

    try {
      const { data: slugData } = await supabase.rpc("generate_band_slug", { band_name: profile.band_name });
      await supabase.from("profiles")
        .update({ ...profile, band_slug: slugData, band_status: "active" })
        .eq("user_id", user.id);
    } catch(e) { console.warn("Profile update failed", e); }

    let fullProfile = { role:"band", profile_type: profileType, ...profile };
    try {
      const { data: profiles } = await supabase.from("profiles").select("*").eq("user_id", user.id);
      if (profiles && profiles.length > 0) fullProfile = profiles[0];
    } catch(e) { console.warn("Profile fetch failed", e); }

    return { user, profile: fullProfile };
  },

  // PHASE 4 FIX: was matching on profiles.id, which only ever equals the
  // auth user id for legacy pre-migration rows. Real signups (via the
  // handle_new_user() trigger) get an auto-generated id and a separate
  // user_id column -- match on that instead. Also falls back to the venues
  // table so venue accounts (which never get a profiles row) can sign in
  // and see their venue once a claim/registration has been approved.
  // PHASE 5: shared profile-resolution logic for any already-authenticated
  // Supabase session, whether from an interactive signIn() or from
  // rehydrating a persisted session on page load / navigation (see
  // MainApp's session-restore effect). Keeping this in one place means the
  // two code paths can never drift apart -- same profiles -> venues ->
  // pending-placeholder fallback chain either way, covering bands, solo
  // artists, festivals, promoters, venues and admins identically (role
  // comes straight off the profiles row, same as before).
  // Self-service auth: resolves which entity (if any) the signed-in user
  // can edit, in priority order:
  //   1. A profiles row they directly own (band/solo_artist/festival/
  //      promoter/organisation)
  //   2. A venue they directly own
  //   3. A scoped manager role (user_roles.role like '%_manager') for any
  //      of the above entity types -- venue managed_entity_type maps to
  //      the venues table, every other type maps to profiles
  // Tier 3 is new: previously a manager (as opposed to the literal owner)
  // had no representation here at all, even though RLS has always
  // permitted their updates -- they simply had no way to reach the row.
  async buildAuthFromSession(session) {
    const user = session.user;
    let profile = { role:"band", band_name:"", profile_type:null, pending:true };
    try {
      const { data: profiles } = await supabase.from("profiles").select("*").eq("user_id", user.id);
      if (profiles && profiles.length > 0) {
        profile = profiles[0];
      } else {
        const { data: venues } = await supabase.from("venues").select("*").eq("user_id", user.id);
        if (venues && venues.length > 0) {
          profile = { ...venues[0], profile_type: "venue", band_name: venues[0].name, role: "band" };
        } else {
          const { data: managerRoles } = await supabase
            .from("user_roles")
            .select("managed_entity_type, managed_entity_id")
            .eq("user_id", user.id)
            .like("role", "%_manager")
            .limit(1);
          if (managerRoles && managerRoles.length > 0) {
            const { managed_entity_type, managed_entity_id } = managerRoles[0];
            if (managed_entity_type === "venue") {
              const { data: managedVenue } = await supabase.from("venues").select("*").eq("id", managed_entity_id).single();
              if (managedVenue) profile = { ...managedVenue, profile_type: "venue", band_name: managedVenue.name, role: "band" };
            } else {
              const { data: managedProfile } = await supabase.from("profiles").select("*").eq("id", managed_entity_id).single();
              if (managedProfile) profile = managedProfile;
            }
          }
        }
      }
    } catch(e) { console.warn("Profile fetch failed", e); }
    return { user, profile, token: session?.access_token };
  },

  async signIn(email, password) {
    if (USE_MOCK) {
      const u = MOCK_USERS[email];
      if (!u || u.password !== password) throw new Error("Invalid credentials");
      MOCK_USER    = { id: u.id, email };
      MOCK_PROFILE = { id: u.id, role: u.role, band_name: u.band_name };
      return { user: MOCK_USER, profile: MOCK_PROFILE };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return DB.buildAuthFromSession(data.session);
  },

  async signOut() {
    if (USE_MOCK) { MOCK_USER = null; MOCK_PROFILE = null; return; }
    await supabase.auth.signOut();
  },

  async getBandBySlug(slug) {
    if (USE_MOCK) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("band_slug", slug);
    if (error || !data || data.length === 0) return null;
    return data[0];
  },

  // Fixed: previously matched on user_id, which only ever equals the
  // literal owner's own auth id -- a manager's auth.uid() is never equal
  // to the profile's user_id column, so this always matched zero rows
  // for a manager even though RLS already permits their update. Matching
  // on the profile's own id (its actual identity) works correctly for
  // both the owner and a scoped manager, since RLS independently gates
  // which rows are reachable either way -- the match column itself
  // doesn't need to encode who's allowed to touch it.
  //
  // SEO Step 7 hardening: this is the ordinary owner/manager-facing update
  // path (its only caller is EditProfile) -- RLS already correctly scopes
  // WHICH row can be touched (own profile, or a managed one), but RLS is
  // row-level, not column-level, so it doesn't stop an owner from sending
  // an unexpected key. Confirmed by searching the whole codebase: nothing
  // admin-facing calls this function -- AdminFestivals and AdminVenues
  // both already use their own separate, admin-gated update calls, so
  // restricting this allow-list cannot break anything admin-side.
  async updateProfile(profileId, updates) {
    if (USE_MOCK) return updates;
    const allowedFields = [
      "band_name","city","genre","primary_genre","secondary_genre","tertiary_genre",
      "formation_year","bio","photo_url","website","spotify","instagram","facebook",
      "twitter","tiktok_url","youtube_channel_url","youtube_featured_url",
      "apple_music_url","bandcamp_url","soundcloud_url","booking_email",
      "management_contact","press_contact","phone",
      "seo_title","seo_description","seo_search_phrases",
    ];
    const safeUpdates = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) safeUpdates[key] = updates[key];
    }
    const { data, error } = await supabase
      .from("profiles")
      .update(safeUpdates)
      .eq("id", profileId)
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length !== 1) throw new Error("Update failed — profile not found or you don't have permission to edit it.");
    return data[0];
  },

  // ── PHASE 4: Newsletter opt-in ─────────────────────────────────────
  async recordNewsletterOptIn(email, source, profileId) {
    if (USE_MOCK) return { email, newsletter_opt_in: true };
    const { data, error } = await supabase.rpc("record_newsletter_opt_in", {
      p_email: email, p_source: source, p_profile_id: profileId || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  // ── PHASE 4: Entity search (used for claim + duplicate-prevention) ──
  async searchEntities(entityType, query) {
    if (USE_MOCK) return [];
    const { data, error } = await supabase.rpc("search_entities", {
      p_entity_type: entityType, p_query: query, p_limit: 8,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // ── PHASE 4: Claim requests workflow ────────────────────────────────
  // New-entity request: venue/festival/promoter only (handle_new_user()
  // skips profile creation for these types; nothing exists yet to own).
  async submitNewEntityRequest({ entityType, requestedBy, requesterEmail, proposedName, proposedCity, message }) {
    if (USE_MOCK) return { id: `claim_${Date.now()}` };
    const { data, error } = await supabase.from("claim_requests").insert({
      entity_type:        entityType,
      entity_id:           null,
      requested_by:         requestedBy,
      requester_email:       requesterEmail,
      requester_message:      message || null,
      proposed_name:            proposedName,
      proposed_city:             proposedCity,
    }).select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  // Claim of an existing entity (band/solo_artist/venue/festival/promoter).
  // This is deliberately a standalone authenticated write -- not bundled
  // into signUp() -- so it never triggers handle_new_user()'s auto-create
  // path. See report Outstanding Issues for why claiming an existing band
  // specifically still has a residual edge case.
  async submitClaimRequest({ entityType, entityId, requestedBy, requesterEmail, message }) {
    if (USE_MOCK) return { id: `claim_${Date.now()}` };
    const { data, error } = await supabase.from("claim_requests").insert({
      entity_type:       entityType,
      entity_id:          entityId,
      requested_by:         requestedBy,
      requester_email:        requesterEmail,
      requester_message:        message || null,
    }).select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  async getClaimRequests() {
    if (USE_MOCK) return [];
    const { data, error } = await supabase.from("claim_requests").select("*").order("created_at", { ascending:false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // entity_id set -> claiming an existing venue/profile row.
  async approveClaimRequest(claimId, notes) {
    if (USE_MOCK) return { status:"approved" };
    const { data, error } = await supabase.rpc("approve_claim_request", { p_claim_id: claimId, p_review_notes: notes || null });
    if (error) throw new Error(error.message);
    return data;
  },

  // KNOWN BUG (do not call): the approve_new_entity_request() RPC sets
  // entity_id on the claim_requests row without clearing proposed_name/
  // proposed_city, which violates claim_requests_entity_or_proposed_chk
  // and aborts the whole approval. approve_claim_request() correctly
  // handles the entity_id-IS-NULL case instead -- use that. Kept here only
  // as a wrapper in case the backend function is fixed in a future phase.
  async approveNewEntityRequest(claimId, notes) {
    if (USE_MOCK) return { status:"approved" };
    const { data, error } = await supabase.rpc("approve_new_entity_request", { p_claim_id: claimId, p_review_notes: notes || null });
    if (error) throw new Error(error.message);
    return data;
  },

  async rejectClaimRequest(claimId, notes) {
    if (USE_MOCK) return { status:"rejected" };
    const { data, error } = await supabase.rpc("reject_claim_request", { p_claim_id: claimId, p_review_notes: notes || null });
    if (error) throw new Error(error.message);
    return data;
  },

  async getGigsByBand(bandName, bandProfileId) {
    if (USE_MOCK) return MOCK_GIGS.filter(g => g.band_name === bandName && g.status === "approved");
    // Prefer ID-based lookup, fall back to name match
    let query = supabase.from("gigs").select("*").eq("status","approved").order("date", { ascending: true });
    if (bandProfileId) {
      query = query.eq("band_profile_id", bandProfileId);
    } else {
      query = query.ilike("band_name", bandName.trim());
    }
    const { data, error } = await query;
    if (error) return [];
    return data;
  },

  async getBands(includeDisabled = false) {
    if (USE_MOCK) return [
      { id:"band1", band_name:"The Velvet Wolves", city:"London", genre:"Indie Rock", website:"https://example.com", instagram:"@velvetwolves", facebook:"", twitter:"", spotify:"", phone:"07700900123", bio:"Indie rock four-piece from London.", photo_url:"", role:"band", profile_type:"band" },
    ];
    // FIX 1: Filter on profile_type='band' not role='band'
    // role is an auth/permissions field; profile_type is the entity type discriminator
    let query = supabase.from("profiles").select("*").eq("profile_type","band").order("band_name");
    if (!includeDisabled) query = query.or("disabled.is.null,disabled.eq.false");
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  },

  // FIX 3: New method to fetch festival profiles
  async getFestivals(includeDisabled = false) {
    if (USE_MOCK) return [];
    let query = supabase.from("profiles").select("*").eq("profile_type","festival").order("band_name");
    if (!includeDisabled) query = query.or("disabled.is.null,disabled.eq.false");
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getApprovedGigs() {
    if (USE_MOCK) return MOCK_GIGS.filter(g => g.status === "approved");
    const { data, error } = await supabase.from("gigs").select("*").eq("status","approved").order("date");
    if (error) throw new Error(error.message);
    return data;
  },

  async getAllGigs() {
    if (USE_MOCK) return [...MOCK_GIGS];
    const { data, error } = await supabase.from("gigs").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  },

  async submitGig(gig, userId, bandProfileId) {
    if (USE_MOCK) {
      const newGig = { ...gig, id: String(mockIdCounter++), status:"pending", submitted_by: userId };
      MOCK_GIGS.push(newGig);
      return newGig;
    }
    const { data, error } = await supabase.from("gigs").insert({
      ...gig,
      submitted_by:    userId,
      status:          "pending",
      band_profile_id: bandProfileId || null,
    }).select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  async updateGigStatus(gigId, status) {
    if (USE_MOCK) {
      const g = MOCK_GIGS.find(x => x.id === gigId);
      if (g) g.status = status;
      return g;
    }
    const { data, error } = await supabase.from("gigs").update({ status }).eq("id", gigId).select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  async getVenues() {
    if (USE_MOCK) return [];
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  },

  async getGigBySlug(slug) {
    if (USE_MOCK) return null;
    const { data, error } = await supabase
      .from("gigs")
      .select("*")
      .eq("slug", slug)
      .eq("status", "approved");
    if (error || !data || data.length === 0) return null;
    return data[0];
  },

  async getPrevNextGigs(date, time, currentId) {
    if (USE_MOCK) return { prev: null, next: null };
    const dt = `${date}T${time||"00:00"}`;
    const [{ data: prev }, { data: next }] = await Promise.all([
      supabase.from("gigs").select("id,slug,band_name,venue,city,date,time,genre")
        .eq("status","approved")
        .or(`date.lt.${date},and(date.eq.${date},time.lt.${time||"00:00"})`)
        .neq("id", currentId)
        .order("date", { ascending:false }).order("time", { ascending:false })
        .limit(1),
      supabase.from("gigs").select("id,slug,band_name,venue,city,date,time,genre")
        .eq("status","approved")
        .or(`date.gt.${date},and(date.eq.${date},time.gt.${time||"00:00"})`)
        .neq("id", currentId)
        .order("date", { ascending:true }).order("time", { ascending:true })
        .limit(1),
    ]);
    return { prev: prev?.[0] || null, next: next?.[0] || null };
  },

  async getVenueBySlug(slug) {
    if (USE_MOCK) return null;
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .eq("slug", slug);
    if (error || !data || data.length === 0) return null;
    return data[0];
  },

  // Admin-only privileged update path (AdminVenues is the sole caller,
  // gated by isAdmin). Deliberately left unrestricted, exactly as before
  // -- kept entirely separate from updateVenueSelfService below so admin
  // access is never affected by the self-service allow-list.
  async updateVenue(venueId, updates) {
    if (USE_MOCK) return updates;
    const { data, error } = await supabase
      .from("venues")
      .update(updates)
      .eq("id", venueId)
      .select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  // Ordinary owner/manager-facing update path (EditVenue is the sole
  // caller) -- separate function, separate allow-list, from updateVenue
  // above. RLS ("Venue owner can update own venue" / "Venue manager can
  // update assigned venue") already gates WHICH row can be touched; this
  // allow-list gates WHICH COLUMNS, the same defence-in-depth pattern
  // already applied to updateProfile. Matches by the venue's own id, not
  // user_id, so it works correctly for both the literal owner and a
  // scoped manager (the same fix applied to updateProfile).
  async updateVenueSelfService(venueId, updates) {
    if (USE_MOCK) return updates;
    const allowedFields = [
      "name","city","description","address","postcode","capacity",
      "contact_email","phone","website","facebook","instagram","twitter",
      "photo_url","seo_title","seo_description","seo_search_phrases",
    ];
    const safeUpdates = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) safeUpdates[key] = updates[key];
    }
    const { data, error } = await supabase
      .from("venues")
      .update(safeUpdates)
      .eq("id", venueId)
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length !== 1) throw new Error("Update failed — venue not found or you don't have permission to edit it.");
    return data[0];
  },

  async getGigsByVenue(venueId) {
    if (USE_MOCK) return [];
    const { data, error } = await supabase
      .from("gigs")
      .select("*")
      .eq("venue_id", venueId)
      .eq("status", "approved")
      .order("date", { ascending: true });
    if (error) return [];
    return data;
  },

  // Public Lineup / Performances section on a festival profile. Reads
  // gigs.festival_profile_id -- independent of band_profile_id (the
  // performing artist) -- so this never touches or depends on the older
  // "festival name as the gig's own band_name" pattern some legacy gigs
  // still use.
  async getGigsByFestival(festivalProfileId) {
    if (USE_MOCK) return [];
    const { data, error } = await supabase
      .from("gigs")
      .select("*")
      .eq("festival_profile_id", festivalProfileId)
      .eq("status", "approved")
      .order("date", { ascending: true });
    if (error) return [];
    return data;
  },

  async deleteBand(bandId) {
    if (USE_MOCK) return;
    // Orphan related gigs (set band_profile_id to null)
    await supabase.from("gigs").update({ band_profile_id: null }).eq("band_profile_id", bandId);
    const { error } = await supabase.from("profiles").delete().eq("id", bandId);
    if (error) throw new Error(error.message);
  },

  async deleteVenue(venueId) {
    if (USE_MOCK) return;
    // Orphan related gigs
    await supabase.from("gigs").update({ venue_id: null }).eq("venue_id", venueId);
    const { error } = await supabase.from("venues").delete().eq("id", venueId);
    if (error) throw new Error(error.message);
  },

  async updateGig(gigId, updates) {
    if (USE_MOCK) return updates;
    const { data, error } = await supabase.from("gigs").update(updates).eq("id", gigId).select();
    if (error) throw new Error(error.message);
    return data[0];
  },

  async deleteGig(gigId) {
    if (USE_MOCK) { MOCK_GIGS = MOCK_GIGS.filter(g => g.id !== gigId); return; }
    const { error } = await supabase.from("gigs").delete().eq("id", gigId);
    if (error) throw new Error(error.message);
  },

  // ── PUBLIC EDITORIAL AWARDS (Stage 1, revised for singleton history) ──
  // Single filtered query against editorial_features, embedding the
  // related editorial_award_types row via the existing FK so callers get
  // everything needed in one round trip (no N+1, no admin RPC).
  //
  // Despite the name, this now returns two kinds of rows, not just the
  // current holder:
  //   - active = true               (the current active award, if any)
  //   - active = false AND
  //     archive_visible = true      (a former singleton holder etc. whose
  //                                   historical recognition must keep
  //                                   showing on their own profile, per
  //                                   the singleton-history requirement)
  // RLS mirrors this exact condition (active OR archive_visible), so a
  // deactivated row with archive_visible = false stays invisible to the
  // public at the database level, not just filtered out here. Callers
  // that only want the current holder(s) should filter the result on
  // `.active` themselves (see EditorialAwardStrip) -- this function
  // deliberately returns the full current+historical set so a single
  // fetch can power both the hero badge strip and the Current/Previous
  // split in MSMCoverageSection without a second round trip.
  // Pass profileId, gigId, or both -- a single award can be linked to a
  // gig AND its performing artist, so passing both returns the combined,
  // de-duplicated set in one query rather than two separate requests.
  async getActiveAwards({ profileId = null, gigId = null } = {}) {
    if (USE_MOCK) return [];
    if (!profileId && !gigId) return [];
    const nowIso = new Date().toISOString();
    let query = supabase
      .from("editorial_features")
      .select("*, editorial_award_types(*)")
      .or("active.eq.true,archive_visible.eq.true")
      .or(`published_at.is.null,published_at.lte.${nowIso}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("awarded_at", { ascending: false });

    if (profileId && gigId) {
      query = query.or(`profile_id.eq.${profileId},gig_id.eq.${gigId}`);
    } else if (profileId) {
      query = query.eq("profile_id", profileId);
    } else {
      query = query.eq("gig_id", gigId);
    }

    const { data, error } = await query;
    if (error) { console.warn("Awards fetch failed", error); return []; }

    // Defensive de-dupe by id -- the schema allows a single row to carry
    // both profile_id and gig_id, so guard against ever double-counting it.
    const seen = new Set();
    return (data || []).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  },

  // ── FAN FEATURES PHASE 1: Follow a Band ────────────────────────────
  // Fan accounts are intentionally minimal: an auth.users row plus an
  // optional display_name kept in that user's own auth metadata. No
  // profiles/venues row is ever created for a fan -- handle_new_user()
  // is currently a no-op (profile creation only happens via the Admin/
  // claim-approval paths), so this mirrors that: auth signUp is the
  // entire "account", nothing else to create or clean up.
  async signUpFan(email, password, displayName) {
    if (USE_MOCK) {
      const id = `fan_${Date.now()}`;
      MOCK_USER = { id, email };
      return { user: MOCK_USER };
    }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { profile_type: "fan", display_name: displayName || null } },
    });
    if (error) throw new Error(error.message);
    return { user: data.user };
  },

  async isFollowingBand(userId, bandProfileId) {
    if (USE_MOCK || !userId || !bandProfileId) return false;
    const { data, error } = await supabase
      .from("band_follows")
      .select("id")
      .eq("user_id", userId)
      .eq("band_profile_id", bandProfileId)
      .maybeSingle();
    if (error) { console.warn("Follow status check failed", error); return false; }
    return !!data;
  },

  async followBand(userId, bandProfileId) {
    if (USE_MOCK) return;
    const { error } = await supabase
      .from("band_follows")
      .insert({ user_id: userId, band_profile_id: bandProfileId });
    // 23505 = unique_violation -- a double-click/race against the
    // (user_id, band_profile_id) unique constraint. Treat as success:
    // the end state (following) is exactly what the user wanted.
    if (error && error.code !== "23505") throw new Error(error.message);
  },

  async unfollowBand(userId, bandProfileId) {
    if (USE_MOCK) return;
    const { error } = await supabase
      .from("band_follows")
      .delete()
      .eq("user_id", userId)
      .eq("band_profile_id", bandProfileId);
    if (error) throw new Error(error.message);
  },

  // ── SPRINT 3: generalized Follow (Artists, Venues, Festivals) ──────
  // Extends Phase 1 (band_follows) to venues via the parallel
  // venue_follows table -- venues live in their own `venues` table, not
  // `profiles`, so band_follows.band_profile_id genuinely can't reference
  // one. isFollowingBand/followBand/unfollowBand above are untouched and
  // still used directly by FollowBandPanel/BandProfilePage.

  async isFollowing(userId, entityType, entityId) {
    if (USE_MOCK || !userId || !entityId) return false;
    const { data, error } = await supabase
      .from(followTableFor(entityType))
      .select("id")
      .eq("user_id", userId)
      .eq(followColumnFor(entityType), entityId)
      .maybeSingle();
    if (error) { console.warn("Follow status check failed", error); return false; }
    return !!data;
  },

  async followEntity(userId, entityType, entityId) {
    if (USE_MOCK) return;
    const { error } = await supabase
      .from(followTableFor(entityType))
      .insert({ user_id: userId, [followColumnFor(entityType)]: entityId });
    // 23505 = unique_violation -- a double-click/race against the unique
    // constraint. Treat as success: the end state (following) is exactly
    // what the user wanted.
    if (error && error.code !== "23505") throw new Error(error.message);
  },

  async unfollowEntity(userId, entityType, entityId) {
    if (USE_MOCK) return;
    const { error } = await supabase
      .from(followTableFor(entityType))
      .delete()
      .eq("user_id", userId)
      .eq(followColumnFor(entityType), entityId);
    if (error) throw new Error(error.message);
  },

  // Fetches everything a fan follows, grouped and joined with enough detail
  // (name/slug) for "My Following" and "Upcoming From Following" to render
  // links and filter gigs without a second round trip. Festivals come back
  // out of band_follows (they're profiles rows) but are split into their
  // own group by profile_type, same grouping "My Following" needs.
  async getUserFollows(userId) {
    if (USE_MOCK || !userId) return { artists: [], festivals: [], venues: [] };
    const [bandRes, venueRes] = await Promise.all([
      supabase.from("band_follows")
        .select("id, created_at, profiles:band_profile_id(id, band_name, band_slug, profile_type)")
        .eq("user_id", userId).order("created_at", { ascending:false }),
      supabase.from("venue_follows")
        .select("id, created_at, venues:venue_id(id, name, slug)")
        .eq("user_id", userId).order("created_at", { ascending:false }),
    ]);
    if (bandRes.error)  throw new Error(bandRes.error.message);
    if (venueRes.error) throw new Error(venueRes.error.message);

    const artists = [], festivals = [];
    (bandRes.data || []).forEach(row => {
      const p = row.profiles;
      if (!p) return; // followed profile since deleted -- nothing to show/link to
      const item = { followId: row.id, id: p.id, entityType: p.profile_type, name: p.band_name, slug: p.band_slug, followedAt: row.created_at };
      (p.profile_type === "festival" ? festivals : artists).push(item);
    });
    const venues = (venueRes.data || [])
      .filter(row => row.venues)
      .map(row => ({ followId: row.id, id: row.venues.id, entityType: "venue", name: row.venues.name, slug: row.venues.slug, followedAt: row.created_at }));

    return { artists, festivals, venues };
  },

  // ── SPRINT 3: notification foundation ──────────────────────────────
  // Append-only event log for future notifications -- no fan-out, push or
  // email yet (see notification_events table comment). Best-effort and
  // never throws: recording an event must never break the real action
  // (gig approval, deletion, festival save) that triggered it.
  async recordNotificationEvent({ eventType, entityType, entityId, gigId=null, metadata={} }) {
    if (USE_MOCK || !entityId) return;
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("notification_events").insert({
        event_type: eventType, entity_type: entityType, entity_id: entityId,
        gig_id: gigId, metadata, created_by: userData?.user?.id || null,
      });
      if (error) console.warn("recordNotificationEvent failed", error);
    } catch(e) { console.warn("recordNotificationEvent failed", e); }
  },
};

// ── MSM Logo ────────────────────────────────────────────────────────
// Uses the exact uploaded brand asset.
// showWordmark=true  → full logo (monogram + MUSIC SCENE MAGAZINE)
// showWordmark=false → monogram crop only (top ~60% of image)
const MSM_LOGO_SRC = "/brand/MSM-Logo-Master.png";

// Tracks whether the viewport is at/under `breakpoint` (matches the app's
// existing 600px mobile cutoff used throughout GLOBAL_CSS). Used for the
// handful of cases -- logo size, initial view -- that need a real JS value
// rather than a CSS override, since scaling an already-computed
// width/height pair via CSS alone would distort the aspect ratio.
function useIsMobile(breakpoint = 600) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}

// MSM-Logo-Master.png (public/brand/) is a 1254×1254 square canvas with
// generous black padding around the actual monogram + "MUSIC SCENE
// MAGAZINE" wordmark, measured directly off the asset (row-by-row scan for
// non-black pixels):
//   monogram only:        y 26.6% – 56.7% of the image height
//   monogram + wordmark:  y 26.6% – 75.0% of the image height
// CROP below pads each band by a few points on top/bottom for breathing
// room while still cutting the empty canvas out of the rendered logo.
const MSM_LOGO_CROP = {
  full:     { top: 0.24, height: 0.56 }, // showWordmark=true
  monogram: { top: 0.24, height: 0.35 }, // showWordmark=false
};

export function MSMLogo({ height = 80, showWordmark = true }) {
  const crop = showWordmark ? MSM_LOGO_CROP.full : MSM_LOGO_CROP.monogram;
  // Source is square, so scaling it up until `crop.height` of it equals the
  // wrapper height scales width and height uniformly -- nothing is
  // stretched. Shifting the scaled image up by `crop.top` of that size then
  // brings the desired band to the top of the (overflow:hidden) wrapper.
  const scaledSize = height / crop.height;
  return (
    <div style={{
      height,
      width: scaledSize,
      overflow: "hidden",
      flexShrink: 0,
      position: "relative",
    }}>
      <img
        src={MSM_LOGO_SRC}
        alt="Music Scene Magazine"
        style={{
          position: "absolute",
          top: -(crop.top * scaledSize),
          left: 0,
          width: scaledSize,
          height: scaledSize,
          display: "block",
        }}
      />
    </div>
  );
}

// ── Venue link helper ──────────────────────────────────────────────
function VenueLink({ gig, venues=[] }) {
  const venue = venues.find(v => v.id === gig.venue_id);
  if (venue?.slug) {
    return (
      <span style={{ fontSize:13, color:C.muted, display:"inline-flex", alignItems:"center", gap:8 }}>
        <Link to={`/venue/${venue.slug}`}
          style={{ color:C.muted, textDecoration:"none" }}
          onMouseEnter={e=>e.currentTarget.style.color=C.red}
          onMouseLeave={e=>e.currentTarget.style.color=C.muted}
        >{gig.venue}</Link> · {gig.city}
        {/* STAGE 1: surface claim status inline; the actual claim action lives on the venue's profile page */}
        {venue.admin_created && venue.claim_status !== "claimed" && (
          <Link to={`/venue/${venue.slug}`} style={{ textDecoration:"none" }}>
            <ClaimStatusBadge claimStatus={venue.claim_status} entityType="venue" />
          </Link>
        )}
      </span>
    );
  }
  return <span style={{ fontSize:13, color:C.muted }}>{gig.venue} · {gig.city}</span>;
}

// ── Band name link ─────────────────────────────────────────────────
// Wraps a band name with a link to their profile if slug available
function BandLink({ name, slug, style={} }) {
  if (!slug) return <span style={style}>{name}</span>;
  return (
    <Link to={`/artist/${slug}`} style={{ ...style, textDecoration:"none", color:"inherit" }}
      onMouseEnter={e=>e.currentTarget.style.color=C.red}
      onMouseLeave={e=>e.currentTarget.style.color=style.color||"inherit"}
    >{name}</Link>
  );
}

// ── Activity logger ────────────────────────────────────────────────
async function logActivity(action, entityType, entityName, entityId) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    let performedByName = "Administrator";
    if (userId) {
      const { data: p } = await supabase.from("profiles").select("band_name").eq("id", userId);
      if (p?.[0]?.band_name) performedByName = p[0].band_name;
    }
    await supabase.from("activity_log").insert({
      action, entity_type: entityType, entity_name: entityName,
      entity_id: entityId || null, performed_by: userId, performed_by_name: performedByName,
    });
  } catch(e) { console.warn("Activity log failed:", e); }
}

// ── Canonical base URL ─────────────────────────────────────────────
// Uses Vercel deployment URL so shared links and OG tags work correctly.
// When a custom domain is pointed at this Vercel app, update this value.
// Public base URL for canonical links, OG/share URLs and (future) SEO
// generation. Single source of truth: set VITE_BASE_URL in Vercel's
// project environment variables to change this everywhere at once,
// across the React app and both api/gig.js and api/og.js -- Vercel
// exposes the same env var to the Vite build and to serverless
// functions, so one value covers all three. Falls back to the correct
// canonical domain if the env var isn't set.
const BASE_URL = import.meta.env.VITE_BASE_URL || "https://calendar.musicscenemagazine.co.uk";

// Shared fallback share image, used wherever a profile/gig has no photo of
// its own -- matches the same URL api/og.js and api/gig.js already use.
const FALLBACK_IMAGE = "https://musicscenemagazine.co.uk/wp-content/uploads/msm-share.jpg";

// Shared client-side SEO metadata management for public profile/gig
// pages (gig, artist, venue, festival) -- keeps human-facing metadata in
// sync with the crawler-facing api/og.js / api/gig.js patterns. Always
// finds and updates an existing tag rather than creating a new one, so
// repeated calls (e.g. re-running on slug change) never produce
// duplicates. resetPageMeta() fully removes everything this sets and
// restores the generic site title, and is called from every page's
// effect cleanup so navigating away (to another profile, or back to the
// calendar) never leaves stale metadata behind.
function applyPageMeta({ title, description, canonicalUrl, image }) {
  document.title = title;

  const setMeta = (attr, key, val) => {
    let el = document.querySelector(`meta[${attr}="${key}"]`);
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
    el.setAttribute("content", val);
  };
  const setLink = (rel, href) => {
    let el = document.querySelector(`link[rel="${rel}"]`);
    if (!el) { el = document.createElement("link"); el.setAttribute("rel", rel); document.head.appendChild(el); }
    el.setAttribute("href", href);
  };

  setMeta("name", "description", description);
  setLink("canonical", canonicalUrl);

  setMeta("property", "og:title",       title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url",         canonicalUrl);
  setMeta("property", "og:image",       image);
  setMeta("property", "og:type",        "website");
  setMeta("property", "og:site_name",   "Music Scene Magazine");

  setMeta("name", "twitter:card",        "summary_large_image");
  setMeta("name", "twitter:title",       title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image",       image);
}

function resetPageMeta() {
  document.title = "Music Scene Magazine";
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.remove();
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.remove();
  ["og:title","og:description","og:url","og:image","og:type","og:site_name"].forEach(prop => {
    const el = document.querySelector(`meta[property="${prop}"]`);
    if (el) el.remove();
  });
  ["twitter:card","twitter:title","twitter:description","twitter:image"].forEach(name => {
    const el = document.querySelector(`meta[name="${name}"]`);
    if (el) el.remove();
  });
}

// Shared client-side Schema.org JSON-LD management -- one identifiable
// <script id="msm-jsonld"> element, found-or-created and never
// duplicated. Its content is fully replaced (not appended) on every call,
// so navigating between profiles can never accumulate stale blocks, and
// removeJsonLd() (called from every page's cleanup, alongside
// resetPageMeta()) deletes it entirely when navigating away.
function applyJsonLd(data) {
  let el = document.getElementById("msm-jsonld");
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "msm-jsonld";
    document.head.appendChild(el);
  }
  // textContent (not innerHTML) is used deliberately -- the browser never
  // HTML-parses it, so a literal "</script>" inside a data value poses no
  // injection risk here, unlike the server-rendered HTML-string case in
  // api/og.js / api/gig.js, which needs its own separate escaping.
  el.textContent = JSON.stringify(data);
}
function removeJsonLd() {
  const el = document.getElementById("msm-jsonld");
  if (el) el.remove();
}

// Entity-to-JSON-LD builders, deliberately mirroring api/og.js / api/gig.js
// field-for-field so crawler and human-facing structured data describe
// the same entity consistently. Never fabricates a property that isn't
// actually present in the loaded data.
function buildArtistJsonLd(b) {
  const canonicalUrl = `${BASE_URL}/artist/${b.band_slug}`;
  const sameAs = [b.website, b.facebook, b.instagram, b.twitter, b.tiktok_url].filter(Boolean);
  const data = {
    "@context": "https://schema.org",
    "@type": b.profile_type === "solo_artist" ? "Person" : "MusicGroup",
    name: b.band_name,
    url: canonicalUrl,
  };
  if (b.bio) data.description = b.bio;
  if (b.photo_url) data.image = b.photo_url;
  const genre = b.primary_genre || b.genre;
  if (genre) data.genre = genre;
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}
function buildVenueJsonLd(v) {
  const canonicalUrl = `${BASE_URL}/venue/${v.slug}`;
  const sameAs = [v.website, v.facebook, v.instagram, v.twitter].filter(Boolean);
  const data = { "@context": "https://schema.org", "@type": "MusicVenue", name: v.name, url: canonicalUrl };
  if (v.description) data.description = v.description;
  if (v.photo_url) data.image = v.photo_url;
  if (v.address || v.city || v.postcode) {
    data.address = {
      "@type": "PostalAddress",
      ...(v.address  ? { streetAddress:   v.address }  : {}),
      ...(v.city     ? { addressLocality: v.city }     : {}),
      ...(v.postcode ? { postalCode:      v.postcode } : {}),
    };
  }
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}
function buildFestivalJsonLd(e) {
  const canonicalUrl = `${BASE_URL}/festival/${e.band_slug}`;
  const sameAs = [e.website, e.facebook, e.instagram, e.twitter, e.tiktok_url].filter(Boolean);
  const data = { "@context": "https://schema.org", "@type": "Festival", name: e.band_name, url: canonicalUrl };
  if (e.festival_start_date) data.startDate = e.festival_start_date;
  if (e.festival_end_date)   data.endDate   = e.festival_end_date;
  if (e.bio) data.description = e.bio;
  if (e.photo_url) data.image = e.photo_url;
  if (e.city || e.postcode) {
    data.location = {
      "@type": "Place",
      name: e.band_name,
      address: {
        "@type": "PostalAddress",
        ...(e.city     ? { addressLocality: e.city }     : {}),
        ...(e.postcode ? { postalCode:      e.postcode } : {}),
      },
    };
  }
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}
// MusicGroup covers a solo musician too (schema.org's own definition:
// "such as a band, an orchestra, or a choir... can also be a solo
// musician"), so the gig's performer sub-object doesn't need to know
// band vs solo_artist -- only the artist's own /artist/:slug page does.
function buildGigJsonLd(g, band, venue) {
  const canonicalUrl = `${BASE_URL}/gig/${g.slug}`;
  const isoTime = (g.time && /^\d{2}:\d{2}$/.test(g.time)) ? `${g.date}T${g.time}:00` : g.date;
  const data = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: `${g.band_name} at ${g.venue}`,
    startDate: isoTime,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: canonicalUrl,
    location: {
      "@type": "MusicVenue",
      name: g.venue,
      ...(venue?.slug ? { url: `${BASE_URL}/venue/${venue.slug}` } : {}),
      ...(g.city ? { address: { "@type": "PostalAddress", addressLocality: g.city } } : {}),
    },
    performer: {
      "@type": "MusicGroup",
      name: g.band_name,
      ...(band?.band_slug ? { url: `${BASE_URL}/artist/${band.band_slug}` } : {}),
    },
  };
  if (g.description || g.notes) data.description = g.description || g.notes;
  if (g.end_date) data.endDate = g.end_date;
  if (g.poster_url) data.image = g.poster_url;
  if (g.tickets && /^https?:\/\//i.test(g.tickets)) data.offers = { "@type": "Offer", url: g.tickets };
  return data;
}
// FIX 4: Type-aware completion scoring.
// Band/solo_artist fields include genre and Spotify (music-specific).
// Festival, venue, promoter, organisation scored on universal fields only.
// Weights are recalculated to always total 100 for each type's field set.
function getProfileCompleteness(profile) {
  const type = profile?.profile_type || "band";

  const universalFields = [
    { key:"band_name",     label:"Name",
      weight:15, check: p => !!(p?.band_name && p.band_name.trim()) },
    { key:"city",          label:"City / Location",
      weight:10, check: p => !!(p?.city && p.city.trim()) },
    { key:"bio",           label:"Biography",
      weight:20, check: p => !!(p?.bio && p.bio.trim()) },
    { key:"photo_url",     label:"Profile Photo",
      weight:15, check: p => !!(p?.photo_url && p.photo_url.trim()) },
    { key:"web_social",    label:"Website or Social Media",
      weight:15, check: p => !!(p?.website || p?.facebook || p?.instagram || p?.tiktok_url || p?.twitter) },
    { key:"booking_email", label:"Contact / Booking Email",
      weight:10, check: p => !!(p?.booking_email && p.booking_email.trim()) },
  ];

  const bandOnlyFields = [
    { key:"primary_genre", label:"Primary Genre",
      weight:10, check: p => !!(p?.primary_genre || p?.genre) },
    { key:"genre2_spotify",label:"Secondary Genre or Spotify",
      weight:5,  check: p => !!(p?.secondary_genre || p?.spotify) },
  ];

  const fields = (type === "band" || type === "solo_artist")
    ? [...universalFields, ...bandOnlyFields]
    : universalFields;

  // Recalculate weights so they always sum to 100 for any field set
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  const scaledFields = fields.map(f => ({
    ...f,
    weight: Math.round((f.weight / totalWeight) * 100),
  }));

  let score = 0;
  const done    = [];
  const missing = [];

  for (const f of scaledFields) {
    if (f.check(profile)) { score += f.weight; done.push(f.label); }
    else                   { missing.push(f.label); }
  }

  return { score: Math.min(100, score), missing, done, completed: done.length, total: fields.length };
}

// ── iCal export ────────────────────────────────────────────────────
function exportICal(gigs) {
  const esc = s => (s||"").replace(/[\\;,]/g, c=>`\\${c}`).replace(/\n/g,"\\n");
  const dt  = (date, time) => {
    const [y,m,d] = date.split("-");
    const [hh,mm] = (time||"00:00").split(":");
    return `${y}${m}${d}T${hh}${mm}00`;
  };
  const uid = g => `gig-${g.id}@musicsceenemagazine.co.uk`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Music Scene Magazine//Gig Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Music Scene Magazine Gigs",
    "X-WR-TIMEZONE:Europe/London",
  ];
  gigs.forEach(g => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid(g)}`,
      `DTSTART:${dt(g.date, g.time)}`,
      `DTEND:${dt(g.date, g.time)}`,   // same time; no duration known
      `SUMMARY:${esc(g.band_name)} @ ${esc(g.venue)}`,
      `LOCATION:${esc(g.venue + ", " + g.city)}`,
      `DESCRIPTION:${esc([g.genre, g.notes, g.tickets].filter(Boolean).join(" | "))}`,
      `CATEGORIES:${esc(g.genre)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type:"text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url; a.download = "msm-gigs.ics"; a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ────────────────────────────────────────────────────────
const pad    = n => String(n).padStart(2,"0");
const fmtDate = s => { if (!s) return ""; const [y,m,d]=s.split("-"); return `${d} ${MONTHS[+m-1]} ${y}`; };
const getDays = (y,m) => new Date(y,m+1,0).getDate();
const getFirst= (y,m) => new Date(y,m,1).getDay();
const today   = () => new Date().toISOString().slice(0,10);

// ════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ════════════════════════════════════════════════════════════════════
export const C = {
  bg:"#0d0d0d", surface:"#111", surfaceHigh:"#161616",
  border:"rgba(255,255,255,0.07)", borderStrong:"rgba(255,255,255,0.12)",
  red:"#e8203a", redDim:"rgba(232,32,58,0.15)",
  white:"#fff",
  // ACCESSIBILITY PASS: muted/dim were #555/#333 -- 2.6:1 and 1.5:1 against
  // the dark backgrounds above, both well under the WCAG AA 4.5:1 minimum
  // for normal text (verified against bg/surface/surfaceHigh). Raised so
  // secondary info (muted) and placeholder/disabled/inactive text (dim)
  // stay visually subordinate to near-white primary text and to each
  // other, while both are now comfortably readable:
  //   white  #fff     ~18-19:1  (primary content, unchanged)
  //   muted  #9a9a9a  ~6.4-6.9:1  (secondary info -- was #555 at ~2.6:1)
  //   dim    #828282  ~4.7-5.1:1  (placeholder / disabled / inactive -- was #333 at ~1.5:1,
  //                                 then #787878 at ~4.1-4.4:1 which still fell just under
  //                                 AA on the lightest surface; #828282 clears 4.5:1 with
  //                                 margin on bg/surface/surfaceHigh alike, since dim is also
  //                                 used for genuinely readable secondary content -- e.g. gig
  //                                 info labels, notes -- not only inert/disabled controls)
  muted:"#9a9a9a", dim:"#828282",
  green:"#43aa8b", amber:"#f4a261",
};
export const F = { display:"'Bebas Neue',sans-serif", body:"'Barlow',sans-serif" };

export const inputCss = {
  width:"100%", padding:"12px 14px",
  background:"rgba(255,255,255,0.10)",
  border:`1px solid rgba(255,255,255,0.2)`,
  borderRadius:5, color:"#ffffff", fontSize:15,
  outline:"none", boxSizing:"border-box",
  fontFamily:F.body, transition:"border-color 0.2s",
};
const btnCss = (variant="primary") => ({
  padding:"10px 20px", border:"none", borderRadius:5,
  cursor:"pointer", fontFamily:F.display, letterSpacing:3, fontSize:14,
  transition:"opacity 0.2s",
  ...(variant==="primary"  ? { background:C.red,   color:"#fff" } : {}),
  ...(variant==="secondary"? { background:"rgba(255,255,255,0.06)", color:C.muted } : {}),
  ...(variant==="success"  ? { background:C.green, color:"#fff" } : {}),
  ...(variant==="danger"   ? { background:"#c0392b", color:"#fff" } : {}),
  ...(variant==="ghost"    ? { background:"none", color:C.muted, border:`1px solid ${C.border}` } : {}),
});

// ════════════════════════════════════════════════════════════════════
//  SHARED UI
// ════════════════════════════════════════════════════════════════════
export const SectionLabel = ({ children }) => (
  <div style={{ marginBottom:20 }}>
    <div style={{ fontFamily:F.display, fontSize:18, color:C.red, letterSpacing:3 }}>{children}</div>
    <div style={{ width:28, height:2, background:C.red, marginTop:5 }} />
  </div>
);

export const Badge = ({ label, color }) => (
  <span style={{
    fontSize:9, fontFamily:F.display, letterSpacing:1.5,
    border:`1px solid ${color||C.border}`, color:color||C.muted,
    borderRadius:3, padding:"2px 7px", whiteSpace:"nowrap",
  }}>{label}</span>
);

const StatusBadge = ({ status }) => {
  const map = { approved:[C.green,"LIVE"], pending:[C.amber,"PENDING"], rejected:[C.red,"REJECTED"] };
  const [color,label] = map[status]||[C.muted,"UNKNOWN"];
  return <Badge label={label} color={color} />;
};

// STAGE 1: public claim-status badge, keyed off the profiles/venues.claim_status
// column (Phase A/B). entityType is the raw profile_type ("band","solo_artist",
// "festival","promoter") or the literal "venue" -- used only to choose the
// VERIFIED label; "venue" always renders VERIFIED VENUE, everything else
// renders VERIFIED ARTIST.
export const ClaimStatusBadge = ({ claimStatus, entityType }) => {
  if (!claimStatus || claimStatus === "unclaimed") return <Badge label="UNCLAIMED" color={C.amber} />;
  if (claimStatus === "pending") return <Badge label="CLAIM PENDING" color={C.amber} />;
  if (claimStatus === "claimed") {
    return <Badge label={entityType === "venue" ? "VERIFIED VENUE" : "VERIFIED ARTIST"} color={C.green} />;
  }
  return null;
};

const Btn = ({ children, onClick, variant="primary", style={}, disabled=false, className }) => (
  <button onClick={onClick} disabled={disabled} className={className}
    style={{ ...btnCss(variant), opacity:disabled?0.4:1, ...style }}
    onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.opacity=0.8; }}
    onMouseLeave={e=>{ e.currentTarget.style.opacity=1; }}
  >{children}</button>
);

const Input = ({ label, value, onChange, type="text", required, error, placeholder }) => (
  <div>
    {label && <label style={{ display:"block", fontSize:13, color:error?"#e8203a":"#ffffff", letterSpacing:2, marginBottom:6, fontFamily:F.display }}>
      {label}{required && " *"}
    </label>}
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{ ...inputCss, borderColor: error?C.red:C.border }}
      onFocus={e => e.target.style.borderColor = C.red}
      onBlur={e  => e.target.style.borderColor = error ? C.red : C.border}
    />
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div>
    {label && <label style={{ display:"block", fontSize:13, color:"#ffffff", letterSpacing:2, marginBottom:6, fontFamily:F.display }}>{label}</label>}
    <select value={value} onChange={onChange} style={{ ...inputCss, cursor:"pointer" }}>
      {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  </div>
);

// ════════════════════════════════════════════════════════════════════
//  PUBLIC EDITORIAL AWARDS -- shared read-only display components
// ════════════════════════════════════════════════════════════════════
// Awards are assigned entirely through the existing Admin Editorial
// workflow (AdminEditorial.jsx, unchanged). These components only render
// rows already fetched via DB.getActiveAwards() -- no writes, and never
// the admin_get_editorial_features RPC (that RPC intentionally ignores
// active/publish-window filtering, so it must stay admin-only).
const fmtAwardDate = ts => {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
};

const awardColor = (type) => type?.color_hex ? `#${String(type.color_hex).replace(/^#/, "")}` : C.red;

// Compact single-line pill for page heroes (artist/festival/promoter
// profiles, gig pages) -- deliberately small so a handful of awards never
// overwhelm the header. Uses the award type's short label where available.
const EditorialAwardPill = ({ award }) => {
  const type  = award.editorial_award_types || {};
  const color = awardColor(type);
  const label = type.label_short || type.label || "MSM AWARD";
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
      padding:"6px 12px", borderRadius:6,
      background:`${color}1a`, border:`1px solid ${color}66`,
    }}>
      {type.image_url && (
        <img src={type.image_url} alt="" style={{ width:18, height:18, objectFit:"contain", flexShrink:0 }} />
      )}
      <span style={{ fontFamily:F.display, fontSize:12, letterSpacing:1.5, color:C.white }}>{label}</span>
      {award.awarded_at && (
        <span style={{ fontSize:11, color:"#ccc" }}>{fmtAwardDate(award.awarded_at)}</span>
      )}
      {award.review_url && (
        <a href={award.review_url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize:11, fontFamily:F.display, letterSpacing:1, color, textDecoration:"none", borderBottom:`1px solid ${color}` }}
        >READ REVIEW ↗</a>
      )}
    </div>
  );
};

// Row of pills, newest first (DB.getActiveAwards already orders this way).
// Renders nothing when there are no CURRENT awards -- historical/former
// singleton holders no longer show as a hero pill (they get their own
// "Previous Editorial Awards" section in MSMCoverageSection instead), so
// this never leaves a gap in the hero for profiles/gigs that don't
// currently hold one.
export const EditorialAwardStrip = ({ awards, style={} }) => {
  const current = (awards || []).filter(a => a.active);
  if (current.length === 0) return null;
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap", ...style }}>
      {current.map(a => <EditorialAwardPill key={a.id} award={a} />)}
    </div>
  );
};

// Fuller card used inside the MSM Coverage section: image, award type,
// headline, date and a clear link through to the full article on
// musicscenemagazine.co.uk (review_url). Never renders body_text as a
// substitute for the WordPress article.
//
// When a review_url is present, the ENTIRE card is clickable (not just a
// small button) -- this is a system-wide behaviour driven purely by
// whether this specific award row has a URL, so it applies identically to
// every award type (Record of the Week, MSM Essential Artist, MSM
// Feature, Editor's Choice, MSM Recommended, Hall of Fame) with no
// per-type or per-artist special-casing. When review_url is absent, the
// card renders as a plain (non-clickable) div exactly as before -- no
// dead/empty links.
const EditorialCoverageCard = ({ award }) => {
  const type  = award.editorial_award_types || {};
  const color = awardColor(type);
  const image = award.image_url || type.image_url;
  const hasLink = !!award.review_url;
  const [hover, setHover] = useState(false);

  const cardStyle = {
    display:"flex", gap:16, padding:18, background:C.surface,
    border:`1px solid ${hover && hasLink ? color : C.border}`, borderLeft:`3px solid ${color}`,
    borderRadius:8, flexWrap:"wrap",
    textDecoration:"none", color:"inherit",
    transition:"border-color 0.15s",
    cursor: hasLink ? "pointer" : "default",
  };

  const content = (
    <>
      {image && (
        <img src={image} alt={award.image_alt || type.label || ""}
          style={{ width:72, height:72, borderRadius:6, objectFit:"cover", flexShrink:0 }}
        />
      )}
      <div style={{ flex:1, minWidth:180 }}>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:6 }}>
          <Badge label={type.label || "MSM EDITORIAL"} color={color} />
          {award.awarded_at && <span style={{ fontSize:12, color:"#aaa" }}>{fmtAwardDate(award.awarded_at)}</span>}
        </div>
        {award.headline && (
          <div style={{ fontFamily:F.display, fontSize:17, letterSpacing:0.5, color:C.white, marginBottom:6, lineHeight:1.3 }}>
            {award.headline}
          </div>
        )}
        {hasLink && (
          <span style={{ display:"inline-block", marginTop:4, padding:"8px 16px", background:color, color:"#fff", borderRadius:5, fontFamily:F.display, fontSize:11, letterSpacing:2 }}>
            READ REVIEW →
          </span>
        )}
      </div>
    </>
  );

  if (hasLink) {
    return (
      <a href={award.review_url} target="_blank" rel="noopener noreferrer"
        style={cardStyle}
        onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      >
        {content}
      </a>
    );
  }

  return <div style={cardStyle}>{content}</div>;
};

// Small uppercase sub-heading used to separate Current Recognition from
// Previous Editorial Awards within the coverage section -- deliberately
// lighter than SectionLabel (no underline bar) so it reads as a subgroup,
// not a whole new page section.
const CoverageGroupLabel = ({ children }) => (
  <div style={{ fontSize:11, fontFamily:F.display, letterSpacing:2, color:C.muted, marginBottom:10 }}>
    {children}
  </div>
);

// Full MSM Coverage section -- replaces the old static placeholder.
// Awards fetched via DB.getActiveAwards() now include both the current
// active award(s) AND historical (deactivated) awards that remain
// archive_visible=true -- e.g. a previous Record of the Week holder whose
// recognition must keep showing on their own profile after a new artist
// takes over the singleton. Split them here into two clearly labelled
// groups rather than mixing current and historical recognition together.
// Keeps the friendly empty-state copy when there's no coverage at all, so
// the section's presence/behaviour looks the same as before on profiles
// and gigs that don't have any.
export const MSMCoverageSection = ({ awards, subjectLabel = "this artist" }) => {
  const current  = (awards || []).filter(a => a.active);
  const previous = (awards || []).filter(a => !a.active);
  const hasAny = current.length > 0 || previous.length > 0;

  return (
    <div style={{ marginBottom:48 }}>
      <SectionLabel>MSM COVERAGE</SectionLabel>
      {!hasAny ? (
        <div style={{ padding:24, background:"rgba(255,255,255,0.02)", border:`1px dashed ${C.border}`, borderRadius:8 }}>
          <div style={{ fontSize:13, color:C.dim }}>
            Reviews, interviews and features related to {subjectLabel} will appear here.
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:28 }}>
          {current.length > 0 && (
            <div>
              <CoverageGroupLabel>CURRENT RECOGNITION</CoverageGroupLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {current.map(a => <EditorialCoverageCard key={a.id} award={a} />)}
              </div>
            </div>
          )}
          {previous.length > 0 && (
            <div>
              <CoverageGroupLabel>PREVIOUS EDITORIAL AWARDS</CoverageGroupLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {previous.map(a => <EditorialCoverageCard key={a.id} award={a} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════
//  FAN FEATURES -- PHASE 1: FOLLOW A BAND
// ════════════════════════════════════════════════════════════════════
// Fan accounts are auth-only: DB.signUpFan creates nothing but the
// auth.users row (plus an optional display_name in that user's own auth
// metadata) -- no profiles/venues row is ever created for a fan, exactly
// mirroring how venue/festival/promoter signups already skip profile
// creation. Sign-in and fan sign-up both happen right here, inline, on
// the band profile page -- no redirect-and-return flow needed, and no
// existing routing touched. Follow state is read fresh from band_follows
// (RLS-scoped to the signed-in user's own rows) on mount, so it's
// correct across sessions and devices, not just this tab.
// Shared inline sign-in / free-account-creation prompt. Used wherever a
// signed-out visitor needs to authenticate to finish an action right where
// they are (Follow a Band, claiming a profile) without navigating away or
// losing their place -- the caller re-renders its own authenticated branch
// once onAuthed fires, so whatever the visitor was about to do continues
// against the exact same entity, no re-search required. Fan accounts are
// auth-only (see DB.signUpFan) -- no profile row is ever created.
function InlineAuthPrompt({ accent = C.red, actionLabel = "CONTINUE", onAuthed, onCancel }) {
  const [uiMode, setUiMode]           = useState("signin"); // signin | fanSignup
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [info, setInfo]               = useState("");

  const handleSignIn = async () => {
    setError(""); setBusy(true);
    try {
      const { user } = await DB.signIn(email, password);
      onAuthed(user);
    } catch(e) { setError(e.message); setBusy(false); }
  };

  const handleFanSignUp = async () => {
    setError("");
    if (!email.trim())     { setError("Email is required"); return; }
    if (password.length<6) { setError("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      const { user } = await DB.signUpFan(email.trim(), password, displayName.trim());
      if (user) {
        onAuthed(user);
      } else {
        // Email confirmation required before a session exists yet.
        setInfo("Check your email to confirm your account, then come back to continue.");
        setBusy(false);
      }
    } catch(e) { setError(e.message); setBusy(false); }
  };

  if (info) return <div style={{ color:C.green, fontSize:13 }}>✓ {info}</div>;

  return (
    <div>
      <div style={{ display:"flex", gap:16, marginBottom:14 }}>
        {[["signin","SIGN IN"],["fanSignup","CREATE FREE ACCOUNT"]].map(([m,l]) => (
          <span key={m} onClick={()=>{ setUiMode(m); setError(""); }}
            style={{
              fontFamily:F.display, fontSize:12, letterSpacing:2, cursor:"pointer",
              color: uiMode===m ? accent : C.muted,
              borderBottom: uiMode===m ? `2px solid ${accent}` : "2px solid transparent",
              paddingBottom:6,
            }}
          >{l}</span>
        ))}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:360 }}>
        <Input label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <Input label="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
        {uiMode==="fanSignup" && (
          <Input label="Display name (optional)" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="How we'll greet you -- optional" />
        )}
        {error && <div style={{ color:C.red, fontSize:12 }}>{error}</div>}
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          <Btn onClick={uiMode==="signin" ? handleSignIn : handleFanSignUp} disabled={busy} style={{ fontSize:11, padding:"9px 18px" }}>
            {busy ? "PLEASE WAIT..." : uiMode==="signin" ? `SIGN IN & ${actionLabel}` : `CREATE ACCOUNT & ${actionLabel}`}
          </Btn>
          <span onClick={onCancel} style={{ fontSize:12, color:C.muted, cursor:"pointer" }}>Cancel</span>
        </div>
      </div>
    </div>
  );
}

// SPRINT 3: per-entityType copy for the generalized FollowPanel below.
// solo_artist intentionally shares band's copy -- both read as "artist" to
// a fan and both route through band_follows (see followTableFor).
const FOLLOW_COPY = {
  band:        { noun:"artist",   button:"FOLLOW THIS ARTIST",   prompt:n=>`🔔 Get notified about new ${n} gigs`,     successTail:"We'll email you when they announce a new gig." },
  solo_artist: { noun:"artist",   button:"FOLLOW THIS ARTIST",   prompt:n=>`🔔 Get notified about new ${n} gigs`,     successTail:"We'll email you when they announce a new gig." },
  venue:       { noun:"venue",    button:"FOLLOW THIS VENUE",    prompt:n=>`🔔 Get notified about new gigs at ${n}`,  successTail:"We'll email you when they announce a new gig." },
  festival:    { noun:"festival", button:"FOLLOW THIS FESTIVAL", prompt:n=>`🔔 Get notified about ${n} updates`,      successTail:"We'll email you about festival updates." },
};

// SPRINT 3: the one consistent Follow component used on every followable
// profile page (artist, venue, festival). entityType/entityId/entityName
// drive both the DB calls (via DB.isFollowing/followEntity/unfollowEntity,
// which route to the right table per entityType) and the copy. Structure,
// state machine and styling are unchanged from the Phase 1 band-only
// version below -- FollowBandPanel is now a thin wrapper over this so
// BandProfilePage's existing usage/behaviour is preserved exactly.
function FollowPanel({ entityType, entityId, entityName }) {
  const copy = FOLLOW_COPY[entityType] || FOLLOW_COPY.band;
  const [authUser, setAuthUser]   = useState(undefined); // undefined=checking, null=signed out
  const [following, setFollowing] = useState(null);       // null=checking/unknown
  const [uiMode, setUiMode]       = useState("idle");      // idle | auth
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (USE_MOCK) { if (!cancelled) setAuthUser(null); return; }
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user || null;
        if (cancelled) return;
        setAuthUser(user);
        if (user) {
          const isFollowing = await DB.isFollowing(user.id, entityType, entityId);
          if (!cancelled) setFollowing(isFollowing);
        }
      } catch(e) { if (!cancelled) setAuthUser(null); }
    }
    load();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  const doFollow = async (userId) => {
    setBusy(true); setError("");
    try {
      await DB.followEntity(userId, entityType, entityId);
      setFollowing(true);
      setSuccess(`You're now following ${entityName}. ${copy.successTail}`);
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const handleUnfollow = async () => {
    setBusy(true); setError(""); setSuccess("");
    try {
      await DB.unfollowEntity(authUser.id, entityType, entityId);
      setFollowing(false);
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const wrap = children => (
    <div style={{ padding:20, background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:8 }}>
      {children}
    </div>
  );

  // Loading: initial auth check, or (once signed in) the follow-state check
  if (authUser === undefined || (authUser && following === null)) {
    return wrap(<div style={{ fontSize:13, color:C.dim, letterSpacing:1 }}>LOADING...</div>);
  }

  // Signed-out visitor -- registration nudge, encouraged not forced
  if (authUser === null) {
    if (uiMode === "idle") {
      return wrap(
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ fontSize:13, color:C.muted, letterSpacing:1 }}>🔔 Follow this {copy.noun} to receive future gig updates.</div>
          <Btn onClick={()=>setUiMode("auth")} style={{ fontSize:11, padding:"10px 18px" }}>
            SIGN IN TO FOLLOW
          </Btn>
        </div>
      );
    }
    return wrap(
      <InlineAuthPrompt
        accent={C.red}
        actionLabel="FOLLOW"
        onCancel={()=>setUiMode("idle")}
        onAuthed={async (user) => { setAuthUser(user); setUiMode("idle"); await doFollow(user.id); }}
      />
    );
  }

  // Signed in
  return wrap(
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        {following ? (
          <>
            <Badge label="✓ FOLLOWING" color={C.green} />
            <Btn variant="ghost" onClick={handleUnfollow} disabled={busy} style={{ fontSize:11, padding:"9px 16px" }}>
              {busy ? "..." : "UNFOLLOW"}
            </Btn>
          </>
        ) : (
          <>
            <div style={{ fontSize:13, color:C.muted, letterSpacing:1 }}>{copy.prompt(entityName)}</div>
            <Btn onClick={()=>doFollow(authUser.id)} disabled={busy} style={{ fontSize:11, padding:"10px 18px" }}>
              {busy ? "..." : copy.button}
            </Btn>
          </>
        )}
      </div>
      {error   && <div style={{ color:C.red,   fontSize:12, marginTop:10 }}>{error}</div>}
      {success && <div style={{ color:C.green, fontSize:12, marginTop:10 }}>✓ {success}</div>}
    </div>
  );
}

// Thin wrapper preserving FollowBandPanel's exact original prop API
// (bandProfileId, bandName) so BandProfilePage's existing usage is
// untouched. entityType defaults to "band" but BandProfilePage passes the
// real profile_type ("band" | "solo_artist") the same way it already does
// for ClaimEntityBox just below it.
function FollowBandPanel({ bandProfileId, bandName, entityType = "band" }) {
  return <FollowPanel entityType={entityType} entityId={bandProfileId} entityName={bandName} />;
}

// ════════════════════════════════════════════════════════════════════
//  AUTH PANEL
// ════════════════════════════════════════════════════════════════════
function AuthPanel({ onAuth, onBack }) {
  const [mode, setMode]   = useState("login");
  const [err,   setErr]   = useState("");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");

  // Register fields (band / solo_artist)
  const emptyReg = { band_name:"", city:"", website:"", instagram:"", facebook:"", twitter:"", spotify:"", genre:"Indie Rock", phone:"", bio:"", photo_url:"" };
  const [reg, setReg] = useState(emptyReg);
  const [regEmail, setRegEmail] = useState("");
  const [regPass,  setRegPass]  = useState("");
  const [regPass2, setRegPass2] = useState("");

  // PHASE 4: account type selector + new-entity (venue/festival/promoter) fields
  const [regType, setRegType] = useState("band");
  const [entityName, setEntityName] = useState("");
  const [entityCity, setEntityCity] = useState("");
  const [entityMessage, setEntityMessage] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [entitySubmitted, setEntitySubmitted] = useState(false);

  // PHASE 4: newsletter opt-in -- unticked by default, applies to all registration paths
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);

  const isNewEntityType = ["venue", "festival", "promoter"].includes(regType);

  const setR = k => e => setReg(r=>({...r,[k]:e.target.value}));

  const resetRegisterExtras = () => {
    setSearchResults([]); setSearchDone(false); setEntitySubmitted(false);
  };

  const runEntitySearch = async () => {
    if (entityName.trim().length < 2) { setErr("Enter at least 2 characters to search"); return; }
    setErr(""); setSearching(true);
    try {
      const results = await DB.searchEntities(regType, entityName.trim());
      setSearchResults(results || []);
    } catch(e) { setErr(e.message); }
    setSearching(false); setSearchDone(true);
  };

  const submit = async () => {
    setErr(""); setLoading(true);
    try {
      if (mode === "login") {
        const result = await DB.signIn(email, pass);
        onAuth(result);
      } else if (isNewEntityType) {
        if (!entityName.trim()) { setErr(`${regType} name is required`); setLoading(false); return; }
        if (!entityCity.trim()) { setErr("City is required"); setLoading(false); return; }
        if (!regEmail.trim())   { setErr("Email is required"); setLoading(false); return; }
        if (regPass.length < 6) { setErr("Password must be at least 6 characters"); setLoading(false); return; }
        if (regPass !== regPass2) { setErr("Passwords don't match"); setLoading(false); return; }

        const { user } = await DB.signUp(regEmail, regPass, { band_name: entityName }, regType);
        await DB.submitNewEntityRequest({
          entityType:   regType,
          requestedBy:   user.id,
          requesterEmail: regEmail,
          proposedName:    entityName,
          proposedCity:     entityCity,
          message:           entityMessage,
        });
        if (newsletterOptIn) {
          try { await DB.recordNewsletterOptIn(regEmail, "registration", null); }
          catch(e) { console.warn("Newsletter opt-in failed:", e); }
        }
        setEntitySubmitted(true);
      } else {
        if (!reg.band_name.trim()) { setErr("Band name is required"); setLoading(false); return; }
        if (!regEmail.trim())      { setErr("Email is required"); setLoading(false); return; }
        if (regPass.length < 6)    { setErr("Password must be at least 6 characters"); setLoading(false); return; }
        if (regPass !== regPass2)  { setErr("Passwords don't match"); setLoading(false); return; }
        const result = await DB.signUp(regEmail, regPass, reg, regType);
        // Send registration notification to MSM
        try {
          await fetch("/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "registration",
              band_name: reg.band_name,
              email: regEmail,
              city: reg.city,
              genre: reg.genre,
              phone: reg.phone,
              website: reg.website,
              spotify: reg.spotify,
              instagram: reg.instagram,
              facebook: reg.facebook,
              bio: reg.bio,
            }),
          });
        } catch(e) { console.warn("Registration notification failed:", e); }
        if (newsletterOptIn) {
          try { await DB.recordNewsletterOptIn(regEmail, "registration", result.profile?.id || null); }
          catch(e) { console.warn("Newsletter opt-in failed:", e); }
        }
        onAuth(result);
      }
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"40px 24px" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width:"100%", maxWidth: mode==="register" ? 620 : 420 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <MSMLogo height={130} showWordmark={true} />
          <div style={{ fontSize:10, color:C.muted, letterSpacing:2, marginTop:14 }}>GIG CALENDAR PORTAL</div>
        </div>

        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:28 }}>
          {/* Tabs */}
          <div style={{ display:"flex", gap:6, marginBottom:24 }}>
            {[["login","SIGN IN"],["register","REGISTER"]].map(([m,l]) => (
              <button key={m} onClick={()=>{ setMode(m); setErr(""); resetRegisterExtras(); }}
                style={{ flex:1, padding:"9px", border:"none", borderRadius:5, cursor:"pointer",
                  fontFamily:F.display, letterSpacing:2, fontSize:13,
                  background: mode===m ? C.red : "rgba(255,255,255,0.05)",
                  color: mode===m ? "#fff" : C.muted }}
              >{l}</button>
            ))}
          </div>

          {/* ── LOGIN ── */}
          {mode === "login" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <Input label="EMAIL ADDRESS" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
              <Input label="PASSWORD" type="password" value={pass} onChange={e=>setPass(e.target.value)} required />
            </div>
          )}

          {/* ── REGISTER ── */}
          {mode === "register" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginBottom:4 }}>ACCOUNT TYPE</div>
              <Select
                label="I AM REGISTERING AS A..."
                value={regType}
                onChange={e=>{ setRegType(e.target.value); resetRegisterExtras(); setErr(""); }}
                options={[
                  { value:"band",         label:"Band / Artist" },
                  { value:"solo_artist",  label:"Solo Artist" },
                  { value:"venue",        label:"Venue" },
                  { value:"festival",     label:"Festival" },
                  { value:"promoter",     label:"Promoter" },
                ]}
              />

              {entitySubmitted ? (
                <div style={{ padding:16, background:"rgba(46,196,140,0.08)", border:`1px solid ${C.green}`, borderRadius:6 }}>
                  <div style={{ color:C.green, fontSize:14, fontFamily:F.display, letterSpacing:1, marginBottom:6 }}>✓ REQUEST SUBMITTED</div>
                  <div style={{ fontSize:13, color:"#ccc", lineHeight:1.6 }}>
                    Your account has been created and your {regType} registration request is pending review by our team.
                    You'll be able to sign in once it's approved.
                  </div>
                </div>
              ) : isNewEntityType ? (
                <>
                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>
                    {regType.toUpperCase()} DETAILS
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={{ gridColumn:"1/-1" }}>
                      <Input label={`${regType.toUpperCase()} NAME`} value={entityName}
                        onChange={e=>{ setEntityName(e.target.value); setSearchDone(false); }} required />
                    </div>
                    <Input label="CITY" value={entityCity} onChange={e=>setEntityCity(e.target.value)} required />
                  </div>

                  <Btn variant="ghost" onClick={runEntitySearch} disabled={searching || !entityName.trim()}
                    style={{ fontSize:12, alignSelf:"flex-start", padding:"8px 16px" }}>
                    {searching ? "SEARCHING..." : "CHECK IF IT ALREADY EXISTS"}
                  </Btn>

                  {searchDone && searchResults.length > 0 && (
                    <div style={{ padding:12, background:"rgba(244,162,97,0.08)", border:`1px solid ${C.amber}`, borderRadius:6 }}>
                      <div style={{ fontSize:12, color:C.amber, marginBottom:8, lineHeight:1.6 }}>
                        We found {searchResults.length} possible match{searchResults.length!==1?"es":""}. If one of these is yours,
                        sign in (or close this form) and use the "Claim this listing" button on its page instead of registering a new one:
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {searchResults.map(r => (
                          <div key={r.id} style={{ fontSize:13, color:"#fff" }}>
                            • {r.name}{r.city ? ` — ${r.city}` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {searchDone && searchResults.length === 0 && (
                    <div style={{ fontSize:12, color:C.green }}>No existing match found — you can register it below.</div>
                  )}

                  <div style={{ gridColumn:"1/-1" }}>
                    <label style={{ display:"block", fontSize:9, color:C.muted, letterSpacing:2, marginBottom:5 }}>MESSAGE FOR OUR TEAM (OPTIONAL)</label>
                    <textarea
                      value={entityMessage} onChange={e=>setEntityMessage(e.target.value)}
                      placeholder="Anything that helps us verify and review this request"
                      rows={2}
                      style={{ ...inputCss, resize:"vertical" }}
                    />
                  </div>

                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>ACCOUNT DETAILS</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={{ gridColumn:"1/-1" }}>
                      <Input label="EMAIL ADDRESS" type="email" value={regEmail} onChange={e=>setRegEmail(e.target.value)} required />
                    </div>
                    <Input label="PASSWORD" type="password" value={regPass} onChange={e=>setRegPass(e.target.value)} required />
                    <Input label="CONFIRM PASSWORD" type="password" value={regPass2} onChange={e=>setRegPass2(e.target.value)} required />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>ACCOUNT DETAILS</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={{ gridColumn:"1/-1" }}>
                      <Input label="BAND / ARTIST NAME" value={reg.band_name} onChange={setR("band_name")} required />
                    </div>
                    <Input label="EMAIL ADDRESS" type="email" value={regEmail} onChange={e=>setRegEmail(e.target.value)} required />
                    <Select label="MAIN GENRE" value={reg.genre} onChange={setR("genre")} options={GENRES} />
                    <Input label="PASSWORD" type="password" value={regPass} onChange={e=>setRegPass(e.target.value)} required />
                    <Input label="CONFIRM PASSWORD" type="password" value={regPass2} onChange={e=>setRegPass2(e.target.value)} required />
                  </div>

                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>BAND DETAILS</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <Input label="BASE CITY" value={reg.city} onChange={setR("city")} />
                    <Input label="CONTACT NUMBER" type="tel" value={reg.phone} onChange={setR("phone")} />
                    <div style={{ gridColumn:"1/-1" }}>
                      <Input label="WEBSITE URL" type="url" value={reg.website} onChange={setR("website")} placeholder="https://" />
                    </div>
                    <div style={{ gridColumn:"1/-1" }}>
                      <label style={{ display:"block", fontSize:9, color:C.muted, letterSpacing:2, marginBottom:5 }}>BIO</label>
                      <textarea
                        value={reg.bio} onChange={setR("bio")}
                        placeholder="Tell us about your band..."
                        rows={3}
                        style={{ ...inputCss, resize:"vertical" }}
                      />
                    </div>
                  </div>

                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>SOCIAL MEDIA</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                    <Input label="INSTAGRAM" value={reg.instagram} onChange={setR("instagram")} placeholder="@handle" />
                    <Input label="FACEBOOK" value={reg.facebook} onChange={setR("facebook")} placeholder="@handle" />
                    <Input label="X / TWITTER" value={reg.twitter} onChange={setR("twitter")} placeholder="@handle" />
                  </div>
                  <div style={{ marginTop:12 }}>
                    <Input label="SPOTIFY ARTIST URL" type="url" value={reg.spotify} onChange={setR("spotify")} placeholder="https://open.spotify.com/artist/..." />
                  </div>

                  <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8, marginBottom:4 }}>PROFILE PHOTO</div>
                  <Input label="PHOTO URL (link to an image)" type="url" value={reg.photo_url} onChange={setR("photo_url")} placeholder="https://..." />
                  <div style={{ fontSize:11, color:C.dim }}>Tip: Upload your photo to Instagram or your website and paste the image link here.</div>
                </>
              )}

              {/* PHASE 4: newsletter opt-in -- shown for every registration path, unticked by default */}
              {!entitySubmitted && (
                <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginTop:6, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
                  <input type="checkbox" id="msm-newsletter-optin" checked={newsletterOptIn}
                    onChange={e=>setNewsletterOptIn(e.target.checked)}
                    style={{ marginTop:3, cursor:"pointer" }} />
                  <label htmlFor="msm-newsletter-optin" style={{ fontSize:12, color:C.muted, lineHeight:1.5, cursor:"pointer" }}>
                    Add my email to the MSM newsletter so I can hear about gigs, features and opportunities.
                  </label>
                </div>
              )}
            </div>
          )}

          {err && <div style={{ color:C.red, fontSize:12, marginTop:12 }}>{err}</div>}

          {!entitySubmitted && (
            <Btn onClick={submit} disabled={loading} style={{ width:"100%", marginTop:20, padding:"13px" }}>
              {loading ? "PLEASE WAIT..." : mode==="login" ? "SIGN IN →" : isNewEntityType ? "SUBMIT REQUEST →" : "CREATE ACCOUNT →"}
            </Btn>
          )}
        </div>

        {onBack && (
          <div style={{ marginTop:16, textAlign:"center" }}>
            <span onClick={onBack} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>
              ← Back to calendar
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  SUBMIT GIG FORM
// ════════════════════════════════════════════════════════════════════
function SubmitGigForm({ user, profile, onSubmitted, onEditProfile }) {
  const empty = { band_name: profile?.band_name||"", venue:"", city:"", date:"", end_date:"", time:"20:00", genre:"Indie Rock", tickets:"", notes:"", is_recurring:false, recurrence:"none", spotify: profile?.spotify||"" };
  const [form, setForm]     = useState(empty);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [msg, setMsg]       = useState("");

  const set = k => e => setForm(f=>({...f,[k]:e.target.value}));

  const submit = async () => {
    const e = {};
    if (!form.band_name) e.band_name = true;
    if (!form.venue)     e.venue     = true;
    if (!form.city)      e.city      = true;
    if (!form.date)      e.date      = true;
    if (Object.keys(e).length) { setErrors(e); return; }
    setStatus("loading");
    try {
      await DB.submitGig(form, user.id, profile?.id);
      // Send email notification
      try {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } catch(emailErr) { console.warn("Email notification failed:", emailErr); }
      setStatus("success");
      setMsg("Gig submitted! It will appear on the calendar once approved by our team.");
      setForm(empty);
      setErrors({});
      if (onSubmitted) onSubmitted();
    } catch(err) { setStatus("error"); setMsg(err.message); }
  };

  const { score, missing, done } = getProfileCompleteness(profile);

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
      <SectionLabel>SUBMIT YOUR GIG</SectionLabel>

      {/* Profile completeness bar */}
      <div style={{ marginBottom:20, padding:14, background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:6 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:12, color:C.white, fontFamily:F.display, letterSpacing:1 }}>PROFILE COMPLETENESS</div>
          <div style={{ fontSize:14, fontFamily:F.display, color: score===100 ? C.green : score>=60 ? C.amber : C.red }}>{score}%</div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:4, height:8, overflow:"hidden" }}>
          <div style={{
            width:`${score}%`, height:"100%", borderRadius:4,
            background: score===100 ? C.green : score>=60 ? C.amber : C.red,
            transition:"width 0.5s ease",
          }} />
        </div>
        {missing.length > 0 && (
          <div style={{ marginTop:8, fontSize:11, color:C.muted }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
              {done.map(f    => <span key={f} style={{ fontSize:11, color:C.green }}>✓ {f}</span>)}
              {missing.map(f => <span key={f} style={{ fontSize:11, color:C.red   }}>✗ {f}</span>)}
            </div>
          </div>
        )}
        {score < 60 && (
          <div style={{ marginTop:10, padding:"8px 12px", background:"rgba(244,162,97,0.1)", border:`1px solid ${C.amber}`, borderRadius:5, fontSize:12, color:C.amber }}>
            ⚠️ Your profile is incomplete — fans won't be able to find you online.{" "}
            <span style={{ color:C.white, textDecoration:"underline", cursor:"pointer" }} onClick={onEditProfile}>
              Update your profile →
            </span>
          </div>
        )}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div style={{ gridColumn:"1/-1" }}>
          <Input label="BAND / ARTIST NAME" value={form.band_name} onChange={set("band_name")} required error={errors.band_name} />
        </div>
        <Input label="VENUE" value={form.venue} onChange={set("venue")} required error={errors.venue} />
        <Input label="CITY" value={form.city} onChange={set("city")} required error={errors.city} />
        <Input label="START DATE" type="date" value={form.date} onChange={set("date")} required error={errors.date} />
        <Input label="END DATE (OPTIONAL — FOR MULTI-DAY EVENTS)" type="date" value={form.end_date} onChange={set("end_date")} />
        <Input label="DOORS / START TIME" type="time" value={form.time} onChange={set("time")} />
        <div style={{ gridColumn:"1/-1" }}>
          <Select label="GENRE" value={form.genre} onChange={set("genre")} options={GENRES} />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <Input label="TICKET LINK (OPTIONAL)" type="url" value={form.tickets} onChange={set("tickets")} placeholder="https://" />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <Input label="SPOTIFY ARTIST URL (OPTIONAL)" type="url" value={form.spotify} onChange={set("spotify")} placeholder="https://open.spotify.com/artist/..." />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <Input label="NOTES (OPTIONAL)" value={form.notes} onChange={set("notes")} placeholder="Support acts, age restrictions, etc." />
        </div>

        {/* Recurring */}
        <div style={{ gridColumn:"1/-1", background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:6, padding:"14px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: form.is_recurring ? 14 : 0 }}>
            <div>
              <div style={{ fontSize:13, color:C.white, fontFamily:F.display, letterSpacing:1 }}>RECURRING GIG</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>Does this gig happen regularly?</div>
            </div>
            <div
              onClick={()=>setForm(f=>({...f, is_recurring:!f.is_recurring, recurrence: f.is_recurring ? "none" : "weekly"}))}
              style={{
                width:48, height:26, borderRadius:13, cursor:"pointer", transition:"background 0.2s",
                background: form.is_recurring ? C.red : "rgba(255,255,255,0.1)",
                position:"relative", flexShrink:0,
              }}
            >
              <div style={{
                width:20, height:20, borderRadius:"50%", background:"#fff",
                position:"absolute", top:3,
                left: form.is_recurring ? 25 : 3,
                transition:"left 0.2s",
              }} />
            </div>
          </div>
          {form.is_recurring && (
            <Select
              label="HOW OFTEN?"
              value={form.recurrence}
              onChange={set("recurrence")}
              options={[
                { value:"weekly",      label:"Weekly" },
                { value:"fortnightly", label:"Fortnightly (every 2 weeks)" },
                { value:"monthly",     label:"Monthly" },
              ]}
            />
          )}
        </div>
      </div>

      <Btn onClick={submit} disabled={status==="loading"} style={{ width:"100%", marginTop:18, padding:"13px" }}>
        {status==="loading" ? "SUBMITTING..." : "SUBMIT FOR APPROVAL"}
      </Btn>

      {status==="success" && <div style={{ marginTop:12, color:C.green, fontSize:12, display:"flex", gap:8, alignItems:"center" }}><span>✓</span>{msg}</div>}
      {status==="error"   && <div style={{ marginTop:12, color:C.red,   fontSize:12 }}>{msg}</div>}

      <div style={{ marginTop:16, paddingTop:14, borderTop:`1px solid ${C.border}`, fontSize:10, color:C.dim, lineHeight:1.8 }}>
        All gig submissions are reviewed by the MSM team before going live on the calendar.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ════════════════════════════════════════════════════════════════════
function AdminPanel({ allGigs, onRefresh, bands=[] }) {
  const [filter,  setFilter]  = useState("pending");
  const [loading, setLoading] = useState({});
  const [editing, setEditing] = useState(null); // gig being edited
  const [editForm, setEditForm] = useState({});
  const [saving,  setSaving]  = useState(false);
  const [editMsg, setEditMsg] = useState("");
  const [festivalOptions, setFestivalOptions] = useState([]); // for "Part of a festival?" picker

  useEffect(() => { DB.getFestivals(true).then(setFestivalOptions); }, []);

  const visible = allGigs.filter(g => filter === "all" ? true : g.status === filter);
  const counts  = { all:allGigs.length, pending:allGigs.filter(g=>g.status==="pending").length, approved:allGigs.filter(g=>g.status==="approved").length, rejected:allGigs.filter(g=>g.status==="rejected").length };

  const action = async (gigId, status) => {
    setLoading(l=>({...l,[gigId]:true}));
    const gig = allGigs.find(g=>g.id===gigId);
    await DB.updateGigStatus(gigId, status);
    await logActivity(`gig_${status}`, "gig", gig?.band_name, gigId);
    await onRefresh();
    setLoading(l=>({...l,[gigId]:false}));
  };

  const remove = async (gigId, bandName) => {
    if (!confirm(`Delete "${bandName}" permanently? This cannot be undone.`)) return;
    setLoading(l=>({...l,[gigId]:true}));
    await DB.deleteGig(gigId);
    await logActivity("gig_deleted", "gig", bandName, gigId);
    await onRefresh();
  };

  const openEdit = (g) => {
    setEditing(g);
    setEditForm({
      band_name:    g.band_name    || "",
      venue:        g.venue        || "",
      city:         g.city         || "",
      date:         g.date         || "",
      time:         g.time         || "20:00",
      genre:        g.genre        || "Other",
      status:       g.status       || "pending",
      notes:        g.notes        || "",
      description:  g.description  || "",
      tickets:      g.tickets      || "",
      poster_url:   g.poster_url   || "",
      featured:     g.featured     || false,
      spotify:      g.spotify      || "",
      festival_profile_id: g.festival_profile_id || "",
    });
    setEditMsg("");
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      // Re-link band_profile_id if band_name changed
      let extra = {};
      if (editForm.band_name !== editing.band_name) {
        const { data: bp } = await supabase.from("profiles").select("id").ilike("band_name", editForm.band_name.trim()).limit(1);
        extra.band_profile_id = bp?.[0]?.id || null;
      }
      // venue_id handled by trigger on venue/city update
      await DB.updateGig(editing.id, { ...editForm, ...extra, festival_profile_id: editForm.festival_profile_id || null });
      await logActivity("gig_edited", "gig", editForm.band_name, editing.id);
      setEditMsg("✓ Gig updated");
      await onRefresh();
      setTimeout(() => { setEditing(null); setEditMsg(""); }, 1000);
    } catch(e) {
      setEditMsg(e.message);
    }
    setSaving(false);
  };

  // ── EDIT VIEW ──
  if (editing) return (
    <div style={{ maxWidth:700 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, flexWrap:"wrap" }}>
        <span onClick={()=>setEditing(null)} style={{ color:C.muted, cursor:"pointer", fontSize:13 }}>← Back to moderation</span>
        <div style={{ fontFamily:F.display, fontSize:20, color:C.white, letterSpacing:2 }}>EDIT GIG</div>
      </div>
      {editMsg && (
        <div style={{ marginBottom:16, padding:12, background: editMsg.startsWith("✓") ? "rgba(67,170,139,0.1)" : "rgba(232,32,58,0.1)", border:`1px solid ${editMsg.startsWith("✓")?C.green:C.red}`, borderRadius:6, fontSize:13, color: editMsg.startsWith("✓")?C.green:C.red }}>
          {editMsg}
        </div>
      )}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2 }}>GIG DETAILS</div>
          <div style={{ gridColumn:"1/-1" }}><Input label="BAND / ARTIST NAME" value={editForm.band_name} onChange={e=>setEditForm(f=>({...f,band_name:e.target.value}))} /></div>
          <Input label="VENUE"  value={editForm.venue} onChange={e=>setEditForm(f=>({...f,venue:e.target.value}))} />
          <Input label="CITY"   value={editForm.city}  onChange={e=>setEditForm(f=>({...f,city:e.target.value}))} />
          <Input label="DATE"   type="date" value={editForm.date} onChange={e=>setEditForm(f=>({...f,date:e.target.value}))} />
          <Input label="TIME"   type="time" value={editForm.time} onChange={e=>setEditForm(f=>({...f,time:e.target.value}))} />
          <Select label="GENRE" value={editForm.genre} onChange={e=>setEditForm(f=>({...f,genre:e.target.value}))} options={GENRES} />
          <Select label="STATUS" value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))}
            options={[{value:"pending",label:"Pending"},{value:"approved",label:"Approved"},{value:"rejected",label:"Rejected"}]}
          />
          <div style={{ gridColumn:"1/-1" }}><Input label="TICKET LINK" type="url" value={editForm.tickets} onChange={e=>setEditForm(f=>({...f,tickets:e.target.value}))} placeholder="https://..." /></div>
          <div style={{ gridColumn:"1/-1" }}><Input label="POSTER URL"  type="url" value={editForm.poster_url} onChange={e=>setEditForm(f=>({...f,poster_url:e.target.value}))} placeholder="https://..." /></div>
          <div style={{ gridColumn:"1/-1" }}><Input label="SPOTIFY URL" type="url" value={editForm.spotify} onChange={e=>setEditForm(f=>({...f,spotify:e.target.value}))} placeholder="https://open.spotify.com/artist/..." /></div>
          <div style={{ gridColumn:"1/-1" }}>
            <Select label="PART OF A FESTIVAL? (OPTIONAL)" value={editForm.festival_profile_id}
              onChange={e=>setEditForm(f=>({...f,festival_profile_id:e.target.value}))}
              options={[{value:"",label:"— Not part of a festival —"}, ...festivalOptions.map(fe=>({value:fe.id,label:fe.band_name}))]}
            />
            <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>Independent of the performing artist above — a gig can have both.</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>NOTES</label>
            <textarea value={editForm.notes} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} rows={3} style={{ ...inputCss, resize:"vertical" }} />
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>DESCRIPTION</label>
            <textarea value={editForm.description} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))} rows={4} style={{ ...inputCss, resize:"vertical" }} />
          </div>
          <div style={{ gridColumn:"1/-1", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:6 }}>
            <div>
              <div style={{ fontSize:13, color:C.white, fontFamily:F.display, letterSpacing:1 }}>FEATURED GIG</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>Highlighted on the calendar</div>
            </div>
            <div onClick={()=>setEditForm(f=>({...f,featured:!f.featured}))}
              style={{ width:48, height:26, borderRadius:13, cursor:"pointer", background: editForm.featured ? C.red : "rgba(255,255,255,0.1)", position:"relative", flexShrink:0, transition:"background 0.2s" }}
            >
              <div style={{ width:20, height:20, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left: editForm.featured ? 25 : 3, transition:"left 0.2s" }} />
            </div>
          </div>
        </div>
        <Btn onClick={saveEdit} disabled={saving} style={{ width:"100%", marginTop:20, padding:"13px" }}>
          {saving ? "SAVING..." : "SAVE GIG"}
        </Btn>
      </div>
    </div>
  );

  // ── LIST VIEW ──
  return (
    <div>
      <SectionLabel>MODERATION PANEL</SectionLabel>
      <div style={{ display:"flex", gap:6, marginBottom:20, flexWrap:"wrap" }}>
        {[["all","ALL"],["pending","PENDING"],["approved","APPROVED"],["rejected","REJECTED"]].map(([k,l]) => (
          <button key={k} onClick={()=>setFilter(k)} style={{
            padding:"7px 14px", border:"none", borderRadius:5, cursor:"pointer",
            fontFamily:F.display, letterSpacing:2, fontSize:12,
            background: filter===k ? C.red : "rgba(255,255,255,0.05)",
            color: filter===k ? "#fff" : C.muted,
          }}>
            {l} <span style={{ fontSize:10, opacity:0.7 }}>({counts[k]})</span>
          </button>
        ))}
      </div>
      {visible.length === 0 && <div style={{ color:C.dim, fontSize:13, padding:"24px 0" }}>No gigs in this category.</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {visible.map(g => {
          const color = GENRE_COLORS[g.genre]||"#888";
          const spin  = loading[g.id];
          return (
            <div key={g.id} style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderLeft:`3px solid ${color}`, borderRadius:6, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:200 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:4 }}>
                    {(() => { const bp = g.band_profile_id ? bands.find(b=>b.id===g.band_profile_id) : bands.find(b=>b.band_name?.toLowerCase()===g.band_name?.toLowerCase()); return bp?.band_slug ? <Link to={`/artist/${bp.band_slug}`} style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color:C.white, textDecoration:"none" }} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.white}>{g.band_name}</Link> : <span style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color:C.white }}>{g.band_name}</span>; })()}
                    <StatusBadge status={g.status} />
                    <Badge label={g.genre} color={color} />
                    {g.featured && <Badge label="★ FEATURED" color={C.amber} />}
                    {g.is_recurring && <Badge label="↻" color={C.amber} />}
                  </div>
                  <div style={{ fontSize:12, color:C.muted }}>{g.venue} · {g.city}</div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{fmtDate(g.date)} at {g.time}{g.notes ? ` · ${g.notes}` : ""}</div>
                  {g.slug && <div style={{ fontSize:10, color:C.dim, marginTop:2, fontFamily:"monospace" }}>/gig/{g.slug}</div>}
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  <Btn variant="ghost" onClick={()=>openEdit(g)} disabled={spin} style={{ fontSize:11, padding:"6px 12px" }}>✏️ EDIT</Btn>
                  {g.slug && <Link to={`/gig/${g.slug}`} target="_blank" style={{ ...btnCss("ghost"), fontSize:11, padding:"6px 12px", textDecoration:"none" }}>👁 VIEW</Link>}
                  {g.status !== "approved" && <Btn variant="success" onClick={()=>action(g.id,"approved")} disabled={spin}>✓ APPROVE</Btn>}
                  {g.status !== "rejected" && <Btn variant="ghost"   onClick={()=>action(g.id,"rejected")} disabled={spin}>✗ REJECT</Btn>}
                  <Btn variant="danger" onClick={()=>remove(g.id, g.band_name)} disabled={spin}>🗑</Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
//  FILTERS BAR
// ════════════════════════════════════════════════════════════════════
function FiltersBar({ gigs, filters, setFilters, onExport }) {
  const cities  = ["All", ...Array.from(new Set(gigs.map(g=>g.city))).sort()];
  const genres  = ["All", ...GENRES];
  const venues  = ["All", ...Array.from(new Set(gigs.map(g=>g.venue))).sort()];

  return (
    <div className="msm-filters" style={{
      background:C.surfaceHigh, border:`1px solid ${C.border}`,
      borderRadius:8, padding:"14px 18px",
      display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end",
      marginBottom:24,
    }}>
      <div style={{ flex:1, minWidth:130 }}>
        <Select label="CITY" value={filters.city} onChange={e=>setFilters(f=>({...f,city:e.target.value}))} options={cities} />
      </div>
      <div style={{ flex:1, minWidth:130 }}>
        <Select label="VENUE" value={filters.venue} onChange={e=>setFilters(f=>({...f,venue:e.target.value}))} options={venues} />
      </div>
      <div style={{ flex:1, minWidth:130 }}>
        <Select label="GENRE" value={filters.genre} onChange={e=>setFilters(f=>({...f,genre:e.target.value}))} options={genres} />
      </div>
      <div style={{ flex:1, minWidth:130 }}>
        <Input label="FROM DATE" type="date" value={filters.dateFrom} onChange={e=>setFilters(f=>({...f,dateFrom:e.target.value}))} />
      </div>
      <div style={{ flex:1, minWidth:130 }}>
        <Input label="TO DATE" type="date" value={filters.dateTo} onChange={e=>setFilters(f=>({...f,dateTo:e.target.value}))} />
      </div>
      <div className="msm-filter-btns" style={{ display:"flex", gap:8 }}>
        <Btn variant="ghost" onClick={()=>{ setFilters({ city:"All", venue:"All", genre:"All", dateFrom:"", dateTo:"" }); }}>CLEAR</Btn>
        <Btn variant="secondary" onClick={onExport} style={{ whiteSpace:"nowrap" }}>⬇ iCAL</Btn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  CALENDAR VIEW
// ════════════════════════════════════════════════════════════════════
// Maps active, dated festival profiles into the same shape CalendarView/
// ListView already expect for gigs, WITHOUT ever creating a gigs row.
// Duplicate suppression against legacy festival-as-gig rows (New Forest
// Folk Festival, Hampshire Bowman Beer Festival) uses the safest match
// first: either relationship column pointing at the festival's own
// profile id (this is exactly how those two legacy rows are already
// linked -- band_profile_id was set to the festival's own profile id
// before festival_profile_id existed). Only if no UUID match exists does
// it fall back to a conservative normalised-name + overlapping-date-range
// check, so a festival is never silently hidden just because no gig
// happens to reference it directly.
const normaliseFestivalName = s => (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

function buildFestivalCalendarItems(festivalProfiles, gigs) {
  return festivalProfiles
    .filter(f => !f.disabled && f.festival_start_date && f.festival_end_date)
    .filter(f => {
      const hasUuidMatch = gigs.some(g => g.festival_profile_id === f.id || g.band_profile_id === f.id);
      if (hasUuidMatch) return false;

      const fName = normaliseFestivalName(f.band_name);
      const hasNameDateMatch = gigs.some(g => {
        if (normaliseFestivalName(g.band_name) !== fName) return false;
        const gStart = g.date, gEnd = g.end_date || g.date;
        return gStart <= f.festival_end_date && f.festival_start_date <= gEnd;
      });
      return !hasNameDateMatch;
    })
    .map(f => ({
      id: `festival-${f.id}`,
      band_name: f.band_name,
      date: f.festival_start_date,
      end_date: f.festival_end_date,
      genre: "Festival",
      venue: "", city: "", time: "",
      status: "approved",
      isFestivalItem: true,
      festival_slug: f.band_slug,
    }));
}

function CalendarView({ gigs, onGigClick, bands=[] }) {
  const navigate = useNavigate();
  const todayStr = today();
  const [y, setY] = useState(new Date().getFullYear());
  const [m, setM] = useState(new Date().getMonth());
  const [showGenreKey, setShowGenreKey] = useState(false); // Genre Key: collapsed by default

  const gigMap = useMemo(() => {
    const map = {};
    gigs.forEach(g => {
      // Generate all dates between start and end
      const start = new Date(g.date);
      let end = g.end_date ? new Date(g.end_date) : start;
      // Defensive: a corrupted/mis-entered end_date earlier than the start
      // date must never silently remove the gig from the calendar (this is
      // exactly what happened previously -- the while loop below simply
      // never ran). Fall back to a single-day event instead.
      if (end < start) end = start;
      const cur = new Date(start);
      while (cur <= end) {
        const ds = cur.toISOString().slice(0,10);
        if (!map[ds]) map[ds] = [];
        map[ds].push(g);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [gigs]);

  const prevM = () => { if (m===0){setM(11);setY(y=>y-1);}else setM(m=>m-1); };
  const nextM = () => { if (m===11){setM(0);setY(y=>y+1);}else setM(m=>m+1); };

  const cells = [];
  for (let i=0;i<getFirst(y,m);i++) cells.push(null);
  for (let d=1;d<=getDays(y,m);d++) cells.push(d);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <button onClick={prevM} className="msm-cal-nav" style={{ background:"none", border:`1px solid ${C.border}`, color:C.white, width:36, height:36, borderRadius:5, cursor:"pointer", fontSize:20 }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div className="msm-month-title" style={{ fontFamily:F.display, fontSize:30, letterSpacing:4, color:C.white }}>{MONTHS[m].toUpperCase()} {y}</div>
          <div style={{ width:36, height:2, background:C.red, margin:"4px auto 0" }} />
        </div>
        <button onClick={nextM} className="msm-cal-nav" style={{ background:"none", border:`1px solid ${C.border}`, color:C.white, width:36, height:36, borderRadius:5, cursor:"pointer", fontSize:20 }}>›</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
        {DAYS.map(d=><div key={d} className="msm-day-header" style={{ textAlign:"center", fontSize:13, color:C.dim, letterSpacing:1.5, padding:"6px 0", fontFamily:F.display }}>{d}</div>)}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
        {cells.map((day,i) => {
          if (!day) return <div key={`e${i}`} />;
          const ds = `${y}-${pad(m+1)}-${pad(day)}`;
          const dayGigs = gigMap[ds]||[];
          const isToday = ds===todayStr;
          return (
            <div key={ds} className="msm-cal-cell" style={{
              minHeight:120, background: isToday?"rgba(232,32,58,0.1)":"rgba(255,255,255,0.02)",
              border: isToday?`1px solid ${C.red}`:`1px solid ${C.border}`,
              borderRadius:4, padding:"9px 8px 6px",
              verticalAlign:"top",
            }}>
              <div className="msm-cal-day" style={{ fontSize:13, color:isToday?C.red:C.dim, fontFamily:F.display, letterSpacing:1, marginBottom:3 }}>{day}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:2, marginTop:4 }}>
                {dayGigs.map(g=>(
                  <Link key={g.id} to={g.isFestivalItem ? `/festival/${g.festival_slug}` : `/gig/${g.slug}`}
                    onClick={e=>{ if (!g.isFestivalItem) { e.preventDefault(); onGigClick(g); } }}
                    className="msm-gig-label"
                    style={{
                      display:"flex", alignItems:"center", gap:4,
                      background:`${GENRE_COLORS[g.genre]||"#888"}40`,
                      borderLeft:`3px solid ${GENRE_COLORS[g.genre]||"#888"}`,
                      borderRadius:2, padding:"3px 6px",
                      cursor:"pointer", textDecoration:"none",
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${GENRE_COLORS[g.genre]||"#888"}65`}
                    onMouseLeave={e=>e.currentTarget.style.background=`${GENRE_COLORS[g.genre]||"#888"}40`}
                  >
                    <span className="msm-gig-dot" style={{
                      width:6, height:6, borderRadius:"50%", flexShrink:0,
                      background:GENRE_COLORS[g.genre]||"#888",
                      display:"inline-block",
                    }} />
                    <span style={{
                      fontSize:13, color:"#ffffff", fontFamily:F.display,
                      letterSpacing:1, lineHeight:1.2, fontWeight:"bold",
                    }}>{g.is_recurring ? "↻ " : ""}{g.band_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Genre Key -- collapsed by default to save screen space */}
      <div style={{ marginTop:20 }}>
        <button
          type="button"
          onClick={() => setShowGenreKey(v => !v)}
          aria-expanded={showGenreKey}
          style={{
            display:"inline-flex", alignItems:"center", gap:8,
            background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
            borderRadius:6, padding:"8px 14px", cursor:"pointer",
            fontFamily:F.display, fontSize:12, letterSpacing:2, color:C.muted,
          }}
          onMouseEnter={e=>e.currentTarget.style.color=C.white}
          onMouseLeave={e=>e.currentTarget.style.color=C.muted}
        >
          <span style={{ display:"inline-block", transition:"transform 0.15s", transform: showGenreKey ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
          {showGenreKey ? "HIDE GENRE KEY" : "SHOW GENRE KEY"}
        </button>

        {showGenreKey && (
          <div className="msm-legend" style={{ marginTop:16, display:"flex", flexWrap:"wrap", gap:"12px 24px", maxWidth:"100%" }}>
            {Object.entries(GENRE_COLORS).map(([g,c])=>(
              <div key={g} style={{ display:"flex", alignItems:"center", gap:8, fontSize:15, color:C.muted }}>
                <span style={{ width:14, height:14, borderRadius:"50%", background:c, display:"inline-block", flexShrink:0, boxShadow:`0 0 6px ${c}99` }} />
                {g}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  LIST VIEW
// ════════════════════════════════════════════════════════════════════
function ListView({ gigs, onGigClick, bands=[] }) {
  const navigate = useNavigate();
  const sorted = [...gigs].sort((a,b)=>a.date.localeCompare(b.date));
  if (!sorted.length) return <div style={{ color:C.dim, fontSize:13, padding:"24px 0" }}>No gigs match your filters.</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {sorted.map(g => {
        const color = GENRE_COLORS[g.genre]||"#888";
        return (
          <Link key={g.id} to={g.isFestivalItem ? `/festival/${g.festival_slug}` : `/gig/${g.slug}`}
            onClick={e=>{ if (!g.isFestivalItem) { e.preventDefault(); onGigClick(g); } }}
            style={{
              display:"flex", alignItems:"center", gap:14, padding:"13px 16px",
              background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
              borderLeft:`3px solid ${color}`, borderRadius:6, cursor:"pointer",
              textDecoration:"none", color:"inherit",
            }}
            onMouseEnter={e=>e.currentTarget.style.background=C.redDim}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
          >
            <div style={{ flex:1 }}>
              <div className="msm-list-artist" style={{ fontFamily:F.display, fontSize:15, letterSpacing:1.5, color:C.white }}>{g.band_name}</div>
              <div className="msm-list-venue" style={{ fontSize:11, color:C.muted, marginTop:2 }}>{g.venue} · {g.city}</div>
            </div>
            <Badge label={g.genre} color={color} />
            <div style={{ textAlign:"right", minWidth:90 }}>
              <div className="msm-list-date" style={{ fontSize:12, color:C.red, fontFamily:F.display, letterSpacing:1 }}>
                {fmtDate(g.date)}{g.end_date ? ` — ${fmtDate(g.end_date)}` : ""}
              </div>
              <div className="msm-list-time" style={{ fontSize:11, color:C.dim }}>{g.time}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  GIG MODAL
// ════════════════════════════════════════════════════════════════════
function GigModal({ gig, onClose, bands=[], venues=[] }) {
  if (!gig) return null;
  const color    = GENRE_COLORS[gig.genre]||"#888";
  // Find matching band profile for artist page link
  // Prefer ID-based lookup, fall back to name matching
  const bandProfile = gig.band_profile_id
    ? bands.find(b => b.id === gig.band_profile_id)
    : bands.find(b => b.band_name?.toLowerCase() === gig.band_name?.toLowerCase());
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:300,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:C.surface, border:`1px solid ${C.borderStrong}`, borderTop:`3px solid ${C.red}`,
        borderRadius:10, padding:32, maxWidth:440, width:"100%", position:"relative",
        boxShadow:`0 0 60px rgba(232,32,58,0.15)`,
      }}>
        <button onClick={onClose} style={{ position:"absolute", top:14, right:16, background:"none", border:"none", color:C.muted, fontSize:20, cursor:"pointer" }}>✕</button>
        <Badge label={gig.genre} color={color} />
        {gig.is_recurring && <Badge label={`↻ ${gig.recurrence}`} color={C.amber} />}
        <div style={{ fontFamily:F.display, fontSize:30, letterSpacing:2, color:C.white, marginTop:10, lineHeight:1 }}>
          {gig.slug
            ? <Link to={`/gig/${gig.slug}`} onClick={onClose}
                style={{ color:C.white, textDecoration:"none" }}
                onMouseEnter={e=>e.currentTarget.style.color=C.red}
                onMouseLeave={e=>e.currentTarget.style.color=C.white}
              >{gig.band_name}</Link>
            : bandProfile?.band_slug
              ? <Link to={`/artist/${bandProfile.band_slug}`} onClick={onClose}
                  style={{ color:C.white, textDecoration:"none" }}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red}
                  onMouseLeave={e=>e.currentTarget.style.color=C.white}
                >{gig.band_name}</Link>
              : gig.band_name
          }
        </div>
        {/* VIEW FULL GIG PAGE */}
        {gig.slug && (
          <Link to={`/gig/${gig.slug}`} onClick={onClose} style={{
            display:"inline-block", marginTop:8, marginBottom:4,
            padding:"7px 16px", background:C.red, color:"#fff",
            textDecoration:"none", borderRadius:5,
            fontFamily:F.display, fontSize:12, letterSpacing:2,
          }}>VIEW FULL GIG PAGE →</Link>
        )}
        {bandProfile?.band_slug && (
          <Link to={
            bandProfile.profile_type === "festival" ? `/festival/${bandProfile.band_slug}`
            : bandProfile.profile_type === "promoter" ? `/promoter/${bandProfile.band_slug}`
            : bandProfile.profile_type === "venue" ? `/venue/${bandProfile.band_slug}`
            : `/artist/${bandProfile.band_slug}`
          } onClick={onClose}
            style={{ fontSize:11, color:C.muted, textDecoration:"none", letterSpacing:1, display:"block", marginTop:4 }}
          >{/* FIX 5 / PHASE 4: label and target both reflect actual profile type */}
            {bandProfile.profile_type === "festival"     ? "VIEW FESTIVAL PAGE →"
            : bandProfile.profile_type === "venue"       ? "VIEW VENUE PAGE →"
            : bandProfile.profile_type === "solo_artist" ? "VIEW ARTIST PAGE →"
            : bandProfile.profile_type === "promoter"    ? "VIEW PROMOTER PAGE →"
            : "VIEW ARTIST PAGE →"}
          </Link>
        )}
        {/* STAGE 1: claim status/link -- action itself lives on the profile page */}
        {bandProfile?.band_slug && bandProfile.admin_created && bandProfile.claim_status !== "claimed" && (
          <div style={{ marginTop:6 }}>
            <Link to={
              bandProfile.profile_type === "festival" ? `/festival/${bandProfile.band_slug}`
              : bandProfile.profile_type === "promoter" ? `/promoter/${bandProfile.band_slug}`
              : `/artist/${bandProfile.band_slug}`
            } onClick={onClose} style={{ textDecoration:"none" }}>
              <ClaimStatusBadge claimStatus={bandProfile.claim_status} entityType={bandProfile.profile_type || "band"} />
            </Link>
          </div>
        )}
        <VenueLink gig={gig} venues={venues} />
        <div style={{ display:"flex", gap:24, marginBottom:20 }}>
          <div>
            <div style={{ fontSize:9, color:C.dim, letterSpacing:2, marginBottom:3 }}>{gig.end_date ? "FROM" : "DATE"}</div>
            <div style={{ fontFamily:F.display, fontSize:18, letterSpacing:1, color:C.red }}>{fmtDate(gig.date)}</div>
          </div>
          {gig.end_date && (
            <div>
              <div style={{ fontSize:9, color:C.dim, letterSpacing:2, marginBottom:3 }}>TO</div>
              <div style={{ fontFamily:F.display, fontSize:18, letterSpacing:1, color:C.red }}>{fmtDate(gig.end_date)}</div>
            </div>
          )}
          <div>
            <div style={{ fontSize:9, color:C.dim, letterSpacing:2, marginBottom:3 }}>DOORS</div>
            <div style={{ fontFamily:F.display, fontSize:18, letterSpacing:1, color:C.red }}>{gig.time}</div>
          </div>
        </div>
        {gig.notes && <div style={{ color:C.muted, fontSize:12, marginBottom:20, fontStyle:"italic", paddingLeft:12, borderLeft:`2px solid ${C.border}` }}>{gig.notes}</div>}
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {gig.tickets
            ? <a href={gig.tickets} target="_blank" rel="noreferrer" style={{ ...btnCss("primary"), textDecoration:"none", fontFamily:F.display, letterSpacing:3, fontSize:14, padding:"12px 24px" }}>GET TICKETS →</a>
            : <span style={{ fontSize:12, color:C.dim, fontStyle:"italic" }}>No ticket link provided</span>
          }
          <Btn variant="ghost" onClick={()=>exportICal([gig])} style={{ fontSize:12 }}>⬇ ADD TO CALENDAR</Btn>
          {gig.spotify && (
            <a href={gig.spotify} target="_blank" rel="noreferrer" style={{
              ...btnCss("secondary"), textDecoration:"none",
              fontFamily:F.display, letterSpacing:2, fontSize:13,
              padding:"12px 20px", display:"flex", alignItems:"center", gap:8,
              background:"#1DB954", color:"#fff",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              LISTEN ON SPOTIFY
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  STATS PANEL
// ════════════════════════════════════════════════════════════════════
function StatsPanel({ gigs }) {
  // Top cities
  const cityCounts = gigs.reduce((acc, g) => { acc[g.city] = (acc[g.city]||0)+1; return acc; }, {});
  const topCities  = Object.entries(cityCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Top genres
  const genreCounts = gigs.reduce((acc, g) => { acc[g.genre] = (acc[g.genre]||0)+1; return acc; }, {});
  const topGenres   = Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]);

  // Top bands
  const bandCounts  = gigs.reduce((acc, g) => { acc[g.band_name] = (acc[g.band_name]||0)+1; return acc; }, {});
  const topBands    = Object.entries(bandCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Gigs per month
  const monthCounts = gigs.reduce((acc, g) => {
    const m = g.date.slice(0,7); // YYYY-MM
    acc[m] = (acc[m]||0)+1; return acc;
  }, {});
  const months = Object.entries(monthCounts).sort((a,b)=>a[0].localeCompare(b[0])).slice(-6);
  const maxMonth = Math.max(...months.map(([,v])=>v), 1);

  const StatCard = ({ label, value, sub }) => (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:"20px 24px" }}>
      <div style={{ fontSize:11, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{label}</div>
      <div style={{ fontSize:48, fontFamily:F.display, color:C.red, lineHeight:1.1, marginTop:4 }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:C.dim, marginTop:4 }}>{sub}</div>}
    </div>
  );

  const Bar = ({ label, count, max, color }) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
      <div style={{ width:140, fontSize:13, color:C.white, fontFamily:F.display, letterSpacing:1, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
      <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:3, height:24, position:"relative", overflow:"hidden" }}>
        <div style={{
          width:`${(count/max)*100}%`, height:"100%",
          background: color || C.red,
          borderRadius:3, transition:"width 0.5s ease",
          minWidth:4,
        }} />
        <span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", fontSize:11, color:C.white, fontFamily:F.display }}>{count}</span>
      </div>
    </div>
  );

  return (
    <div>
      <SectionLabel>GIG CALENDAR STATS</SectionLabel>

      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px,1fr))", gap:16, marginBottom:36 }}>
        <StatCard label="TOTAL GIGS" value={gigs.length} sub="approved & live" />
        <StatCard label="CITIES" value={Object.keys(cityCounts).length} sub="across the UK" />
        <StatCard label="BANDS" value={Object.keys(bandCounts).length} sub="registered artists" />
        <StatCard label="GENRES" value={Object.keys(genreCounts).length} sub="music styles" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:32, marginBottom:36 }}>

        {/* Top Cities */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24 }}>
          <SectionLabel>TOP CITIES</SectionLabel>
          {topCities.length === 0 && <div style={{ color:C.dim, fontSize:13 }}>No data yet</div>}
          {topCities.map(([city, count]) => (
            <Bar key={city} label={city} count={count} max={topCities[0]?.[1]||1} color={C.red} />
          ))}
        </div>

        {/* Top Bands */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24 }}>
          <SectionLabel>MOST ACTIVE BANDS</SectionLabel>
          {topBands.length === 0 && <div style={{ color:C.dim, fontSize:13 }}>No data yet</div>}
          {topBands.map(([band, count]) => (
            <Bar key={band} label={band} count={count} max={topBands[0]?.[1]||1} color="#9b5de5" />
          ))}
        </div>
      </div>

      {/* Genres */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24, marginBottom:32 }}>
        <SectionLabel>GIGS BY GENRE</SectionLabel>
        {topGenres.length === 0 && <div style={{ color:C.dim, fontSize:13 }}>No data yet</div>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 32px" }}>
          {topGenres.map(([genre, count]) => (
            <Bar key={genre} label={genre} count={count} max={topGenres[0]?.[1]||1} color={GENRE_COLORS[genre]||C.red} />
          ))}
        </div>
      </div>

      {/* Gigs per month */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24 }}>
        <SectionLabel>GIGS PER MONTH</SectionLabel>
        {months.length === 0 && <div style={{ color:C.dim, fontSize:13 }}>No data yet</div>}
        <div style={{ display:"flex", alignItems:"flex-end", gap:12, height:160, paddingBottom:24, position:"relative" }}>
          {months.map(([month, count]) => {
            const [y,m] = month.split("-");
            const label = `${MONTHS[+m-1].slice(0,3)} ${y}`;
            const heightPct = (count/maxMonth)*100;
            return (
              <div key={month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                <div style={{ fontSize:12, color:C.white, fontFamily:F.display }}>{count}</div>
                <div style={{
                  width:"100%", background:C.red, borderRadius:"4px 4px 0 0",
                  height:`${heightPct}%`, minHeight:4, transition:"height 0.5s ease",
                }} />
                <div style={{ fontSize:10, color:C.muted, textAlign:"center", whiteSpace:"nowrap" }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════════
function AdminDashboard({ bands, festivals=[], allGigs, venues, onNav, onEditGig }) {
  const today      = new Date();
  const todayStr   = today.toISOString().slice(0,10);
  const weekStr    = new Date(today.getTime() + 7*24*60*60*1000).toISOString().slice(0,10);
  const monthStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-01`;
  const monthEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0).toISOString().slice(0,10);
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    supabase.from("activity_log").select("*").order("created_at", { ascending:false }).limit(20)
      .then(({ data }) => { setActivity(data||[]); setLoadingActivity(false); });
  }, []);

  const approvedGigs    = allGigs.filter(g => g.status === "approved");
  const pendingGigs     = allGigs.filter(g => g.status === "pending");
  const upcomingWeek    = approvedGigs.filter(g => g.date >= todayStr && g.date <= weekStr);
  const thisMonth       = approvedGigs.filter(g => g.date >= monthStart && g.date <= monthEnd);
  const upcoming10      = approvedGigs.filter(g => g.date >= todayStr).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)).slice(0,10);
  const incompleteBands  = bands.filter(b => getProfileCompleteness(b).score < 60 && !b.disabled);
  const completeBands    = bands.filter(b => getProfileCompleteness(b).score >= 60 && !b.disabled);
  const incompleteVenues = venues.filter(v => !v.description && !v.website);
  const disabledBands    = bands.filter(b => b.disabled);

  // Backup health
  const lastExportISO = localStorage.getItem("msm_last_export_iso");
  const backupDays    = lastExportISO ? Math.floor((Date.now()-new Date(lastExportISO).getTime())/(1000*60*60*24)) : null;
  const backupHealth  = !lastExportISO ? { icon:"🔴", label:"NO BACKUP", color:C.red }
    : backupDays < 7  ? { icon:"🟢", label:"HEALTHY", color:C.green }
    : backupDays < 30 ? { icon:"🟠", label:"WARNING", color:C.amber }
    : { icon:"🔴", label:"CRITICAL", color:C.red };
  const backupDateStr = lastExportISO
    ? new Date(lastExportISO).toLocaleString("en-GB", { day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : null;

  // Profile completion stats
  const activeBands       = bands.filter(b => !b.disabled);
  const completeCount     = completeBands.length;
  const incompleteCount   = incompleteBands.length;
  const completePct       = activeBands.length > 0 ? Math.round((completeCount/activeBands.length)*100) : 0;

  const StatCard = ({ icon, label, val, sub, color=C.red, onClick, alert=false, badge=null }) => (
    <div onClick={onClick} style={{
      background: alert ? "rgba(244,162,97,0.08)" : C.surfaceHigh,
      border:`1px solid ${alert ? C.amber : C.border}`,
      borderTop:`3px solid ${alert ? C.amber : color}`,
      borderRadius:8, padding:"16px 18px",
      cursor: onClick ? "pointer" : "default",
      transition:"background 0.2s",
    }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.background=C.surface; }}
      onMouseLeave={e=>{ if(onClick) e.currentTarget.style.background=alert?"rgba(244,162,97,0.08)":C.surfaceHigh; }}
    >
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:20 }}>{icon}</span>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{label}</div>
        </div>
        {badge && <Badge label={badge.text} color={badge.color} />}
      </div>
      <div style={{ fontSize:28, fontFamily:F.display, color, lineHeight:1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{sub}</div>}
      {onClick && <div style={{ fontSize:10, color:C.muted, marginTop:6, letterSpacing:1 }}>TAP TO MANAGE →</div>}
    </div>
  );

  const actionIcon = { band:"🎸", venue:"📍", gig:"📅", backup:"💾", import:"📥", edit:"✏️", approve:"✓", reject:"✗", delete:"🗑", create:"➕" };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, flexWrap:"wrap", gap:12 }}>
        <SectionLabel>ADMIN DASHBOARD</SectionLabel>
        <div style={{ fontSize:12, color:C.muted }}>{today.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:24, padding:"14px 16px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display, width:"100%", marginBottom:4 }}>QUICK ACTIONS</div>
        <Btn onClick={()=>onNav("bands")}   style={{ fontSize:12, padding:"8px 16px" }}>➕ CREATE BAND</Btn>
        <Btn onClick={()=>onNav("venues")}  style={{ fontSize:12, padding:"8px 16px" }}>➕ CREATE VENUE</Btn>
        <Btn onClick={()=>onNav("admin")}   variant="ghost" style={{ fontSize:12, padding:"8px 16px" }}>📋 REVIEW GIGS</Btn>
        <Btn onClick={()=>onNav("import")}  variant="ghost" style={{ fontSize:12, padding:"8px 16px" }}>📥 IMPORT GIGS</Btn>
        <Btn onClick={()=>onNav("backups")} variant="ghost" style={{ fontSize:12, padding:"8px 16px" }}>💾 BACKUP NOW</Btn>
      </div>

      {/* ── ATTENTION REQUIRED ── */}
      {(pendingGigs.length > 0 || incompleteBands.length > 0 || !lastExportISO || backupDays >= 7) && (
        <div style={{ marginBottom:24, padding:16, background:"rgba(244,162,97,0.06)", border:`1px solid ${C.amber}`, borderRadius:8 }}>
          <div style={{ fontFamily:F.display, fontSize:13, color:C.amber, letterSpacing:2, marginBottom:10 }}>⚠ REQUIRES ATTENTION</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {pendingGigs.length > 0 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, color:"#ccc" }}>📋 {pendingGigs.length} gig{pendingGigs.length!==1?"s":""} pending approval</span>
                <Btn variant="ghost" onClick={()=>onNav("admin")} style={{ fontSize:11, padding:"5px 12px" }}>REVIEW →</Btn>
              </div>
            )}
            {incompleteBands.length > 0 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, color:"#ccc" }}>🎸 {incompleteBands.length} band{incompleteBands.length!==1?"s":""} with incomplete profiles</span>
                <Btn variant="ghost" onClick={()=>onNav("bands")} style={{ fontSize:11, padding:"5px 12px" }}>MANAGE →</Btn>
              </div>
            )}
            {(!lastExportISO || backupDays >= 7) && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, color:"#ccc" }}>💾 {!lastExportISO ? "No backup on record" : `Last backup ${backupDays} days ago`}</span>
                <Btn variant="ghost" onClick={()=>onNav("backups")} style={{ fontSize:11, padding:"5px 12px" }}>BACKUP →</Btn>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PLATFORM OVERVIEW ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>PLATFORM OVERVIEW</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px,1fr))", gap:12, marginBottom:24 }}>
        {/* FIX 2: Count uses profile_type to separate bands from festivals */}
        <StatCard icon="🎸" label="TOTAL BANDS"     val={bands.filter(b=>!b.disabled).length}   color={C.red}   onClick={()=>onNav("bands")}  sub={`${disabledBands.length} disabled`} />
        <StatCard icon="🎪" label="TOTAL FESTIVALS"  val={festivals ? festivals.filter(f=>!f.disabled).length : 0} color="#9b5de5" onClick={()=>onNav("festivals")} sub="festival profiles" />
        <StatCard icon="📍" label="TOTAL VENUES" val={venues.length}  color={C.amber} onClick={()=>onNav("venues")} sub={`${incompleteVenues.length} need info`} />
        <StatCard icon="📅" label="TOTAL GIGS"   val={allGigs.length} color={C.red}   sub={`${approvedGigs.length} approved`} />
        <StatCard icon="⏳" label="PENDING"       val={pendingGigs.length}
          color={pendingGigs.length>0?C.amber:C.green}
          onClick={pendingGigs.length>0?()=>onNav("admin"):null}
          alert={pendingGigs.length>0}
          badge={pendingGigs.length>0?{text:"ACTION",color:C.amber}:null}
        />
      </div>

      {/* ── UPCOMING ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>UPCOMING GIGS</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px,1fr))", gap:12, marginBottom:24 }}>
        <StatCard icon="📆" label="NEXT 7 DAYS" val={upcomingWeek.length} color={C.green} sub="upcoming gigs" />
        <StatCard icon="🗓" label="THIS MONTH"  val={thisMonth.length}    color={C.green} sub={today.toLocaleDateString("en-GB",{month:"long"})} />
      </div>

      {/* ── PROFILE HEALTH ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>PROFILE HEALTH</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px,1fr))", gap:12, marginBottom:24 }}>
        {/* Profile completion card */}
        <div style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderTop:`3px solid ${completePct>=80?C.green:C.amber}`, borderRadius:8, padding:"16px 18px", gridColumn:"span 2" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:20 }}>📊</span>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>PROFILE COMPLETION</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:10 }}>
            <div style={{ fontSize:36, fontFamily:F.display, color:completePct>=80?C.green:C.amber, lineHeight:1 }}>{completePct}%</div>
            <div style={{ flex:1 }}>
              <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:4, height:8, overflow:"hidden" }}>
                <div style={{ width:`${completePct}%`, height:"100%", background:completePct>=80?C.green:C.amber, borderRadius:4, transition:"width 0.5s" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11 }}>
                <span style={{ color:C.green }}>✓ {completeCount} complete</span>
                <span style={{ color:C.amber }}>⚠ {incompleteCount} incomplete</span>
              </div>
            </div>
          </div>
          {incompleteCount > 0 && (
            <Btn variant="ghost" onClick={()=>onNav("bands")} style={{ fontSize:11, padding:"6px 14px" }}>VIEW INCOMPLETE →</Btn>
          )}
        </div>
        {/* Incomplete venues — clickable to filtered view */}
        <div onClick={()=>onNav("venues-incomplete")} style={{
          background: incompleteVenues.length>0?"rgba(244,162,97,0.08)":C.surfaceHigh,
          border:`1px solid ${incompleteVenues.length>0?C.amber:C.border}`,
          borderTop:`3px solid ${incompleteVenues.length>0?C.amber:C.green}`,
          borderRadius:8, padding:"16px 18px", cursor:"pointer",
        }}
          onMouseEnter={e=>e.currentTarget.style.background=C.surface}
          onMouseLeave={e=>e.currentTarget.style.background=incompleteVenues.length>0?"rgba(244,162,97,0.08)":C.surfaceHigh}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <span style={{ fontSize:20 }}>⚠</span>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>INCOMPLETE VENUES</div>
          </div>
          <div style={{ fontSize:28, fontFamily:F.display, color:incompleteVenues.length>0?C.amber:C.green }}>{incompleteVenues.length}</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>no desc or website</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:6, letterSpacing:1 }}>TAP TO MANAGE →</div>
        </div>
      </div>

      {/* ── BACKUP STATUS ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>BACKUP STATUS</div>
      <div style={{ marginBottom:24, padding:"16px 20px", background:C.surfaceHigh, border:`1px solid ${backupHealth.color}40`, borderTop:`3px solid ${backupHealth.color}`, borderRadius:8, cursor:"pointer" }}
        onClick={()=>onNav("backups")}
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:28 }}>{backupHealth.icon}</span>
            <div>
              <div style={{ fontFamily:F.display, fontSize:16, color:backupHealth.color, letterSpacing:2 }}>{backupHealth.label}</div>
              {backupDateStr
                ? <div style={{ fontSize:12, color:"#ccc", marginTop:3 }}>Last backup: {backupDateStr}</div>
                : <div style={{ fontSize:12, color:C.red, marginTop:3 }}>No backup on record — export now</div>
              }
            </div>
          </div>
          <Btn variant="ghost" onClick={e=>{e.stopPropagation();onNav("backups");}} style={{ fontSize:12, padding:"8px 16px" }}>💾 BACKUP NOW</Btn>
        </div>
      </div>

      {/* ── UPCOMING GIGS TABLE ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>NEXT 10 UPCOMING GIGS</div>
      <div style={{ marginBottom:28, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
        {upcoming10.length === 0 ? (
          <div style={{ padding:20, color:C.dim, fontSize:13 }}>No upcoming gigs.</div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}`, background:"rgba(255,255,255,0.02)" }}>
                {["DATE","BAND","VENUE","CITY","GENRE",""].map((h,i)=>(
                  <th key={i} style={{ padding:"10px 14px", textAlign:"left", fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upcoming10.map(g => {
                const color = GENRE_COLORS[g.genre]||"#888";
                return (
                  <tr key={g.id} style={{ borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    onClick={()=>onEditGig && onEditGig(g)}
                  >
                    <td style={{ padding:"10px 14px", fontFamily:F.display, color:C.red, whiteSpace:"nowrap" }}>{fmtDate(g.date)}</td>
                    <td style={{ padding:"10px 14px", color:C.white }}>{g.band_name}</td>
                    <td style={{ padding:"10px 14px", color:"#ccc" }}>{g.venue}</td>
                    <td style={{ padding:"10px 14px", color:C.muted }}>{g.city}</td>
                    <td style={{ padding:"10px 14px" }}><Badge label={g.genre} color={color} /></td>
                    <td style={{ padding:"10px 14px" }}>
                      {g.slug && <Link to={`/gig/${g.slug}`} target="_blank" onClick={e=>e.stopPropagation()} style={{ fontSize:11, color:C.muted, textDecoration:"none" }}>↗</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── RECENT ACTIVITY ── */}
      <div style={{ fontFamily:F.display, fontSize:11, color:C.muted, letterSpacing:3, marginBottom:12 }}>RECENT ACTIVITY</div>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
        {loadingActivity ? (
          <div style={{ padding:20, color:C.dim, fontSize:13 }}>Loading...</div>
        ) : activity.length === 0 ? (
          <div style={{ padding:20, color:C.dim, fontSize:13 }}>No activity logged yet. Actions will appear here.</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column" }}>
            {activity.map((a,i) => (
              <div key={a.id} style={{
                display:"flex", alignItems:"center", gap:14, padding:"10px 16px",
                borderBottom: i<activity.length-1 ? `1px solid ${C.border}` : "none",
                background: i%2===0 ? "transparent" : "rgba(255,255,255,0.01)",
              }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{actionIcon[a.action?.split("_")[0]] || "•"}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:C.white }}>{a.action?.replace(/_/g," ")}{a.entity_name ? ` — ${a.entity_name}` : ""}</div>
                  {a.performed_by_name && <div style={{ fontSize:11, color:C.dim }}>by {a.performed_by_name}</div>}
                </div>
                <div style={{ fontSize:11, color:C.dim, whiteSpace:"nowrap", flexShrink:0 }}>
                  {new Date(a.created_at).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  ADMIN BANDS
// ════════════════════════════════════════════════════════════════════
function AdminBands({ bands, onRefresh }) {
  const [view,       setView]       = useState("list"); // list | create | edit
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState(null);
  const [creating,   setCreating]   = useState(false);
  const [msg,        setMsg]        = useState({ text:"", type:"" });

  // ── Create band form state ──
  const emptyCreate = {
    band_name:"", email:"", password:"",
    city:"", bio:"", primary_genre:"", secondary_genre:"", tertiary_genre:"",
    website:"", facebook:"", instagram:"", tiktok_url:"", twitter:"",
    spotify:"", youtube_channel_url:"", booking_email:"", phone:"",
    photo_url:"",
  };
  const [createForm, setCreateForm] = useState(emptyCreate);
  const setC = k => e => setCreateForm(f=>({...f,[k]:e.target.value}));

  // ── Edit form state ──
  const [editForm, setEditForm] = useState({});
  const setE = k => e => setEditForm(f=>({...f,[k]:e.target.value}));

  const showMsg = (text, type="success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text:"", type:"" }), 4000);
  };

  const filtered = bands.filter(b => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (b.band_name||"").toLowerCase().includes(q) ||
           (b.city||"").toLowerCase().includes(q) ||
           (b.primary_genre||b.genre||"").toLowerCase().includes(q);
  });

  // ── Create band ──
  const handleCreate = async () => {
    if (!createForm.band_name || !createForm.email || !createForm.password) {
      showMsg("Band name, email and password are required", "error"); return;
    }
    setCreating(true);
    try {
      // Create auth user via Supabase Admin API using service role
      // We use signUp here — band will use this to log in
      const { data, error } = await supabase.auth.signUp({
        email:    createForm.email,
        password: createForm.password,
        options:  { data: { band_name: createForm.band_name } }
      });
      if (error) throw new Error(error.message);
      const user = data.user;
      if (!user) throw new Error("User creation failed");

      // Generate slug
      const { data: slugData } = await supabase.rpc("generate_band_slug", {
        band_name: createForm.band_name
      });

      // Upsert profile with all fields
      const { error: profileError } = await supabase.from("profiles").upsert({
        id:                  user.id,
        band_name:           createForm.band_name,
        role:                "band",
        band_slug:           slugData,
        band_status:         "active",
        admin_created:       true,
        disabled:            false,
        city:                createForm.city           || null,
        bio:                 createForm.bio            || null,
        primary_genre:       createForm.primary_genre  || null,
        secondary_genre:     createForm.secondary_genre|| null,
        tertiary_genre:      createForm.tertiary_genre || null,
        website:             createForm.website        || null,
        facebook:            createForm.facebook       || null,
        instagram:           createForm.instagram      || null,
        tiktok_url:          createForm.tiktok_url     || null,
        twitter:             createForm.twitter        || null,
        spotify:             createForm.spotify        || null,
        youtube_channel_url: createForm.youtube_channel_url || null,
        booking_email:       createForm.booking_email  || null,
        phone:               createForm.phone          || null,
        photo_url:           createForm.photo_url      || null,
      });
      if (profileError) throw new Error(profileError.message);

      showMsg(`✓ Band account created! Slug: ${slugData}`);
      setCreateForm(emptyCreate);

      // Fetch fresh band data and go straight to edit
      const { data: newBand } = await supabase.from("profiles").select("*").eq("id", user.id);
      if (onRefresh) await onRefresh();
      if (newBand && newBand[0]) {
        openEdit(newBand[0]);
      } else {
        setView("list");
      }
    } catch(e) {
      showMsg(e.message, "error");
    }
    setCreating(false);
  };

  // ── Open edit ──
  const openEdit = (band) => {
    setSelected(band);
    setEditForm({
      band_name:           band.band_name           || "",
      city:                band.city                || "",
      primary_genre:       band.primary_genre       || "",
      secondary_genre:     band.secondary_genre     || "",
      tertiary_genre:      band.tertiary_genre      || "",
      bio:                 band.bio                 || "",
      photo_url:           band.photo_url           || "",
      website:             band.website             || "",
      spotify:             band.spotify             || "",
      instagram:           band.instagram           || "",
      facebook:            band.facebook            || "",
      tiktok_url:          band.tiktok_url          || "",
      twitter:             band.twitter             || "",
      youtube_channel_url: band.youtube_channel_url || "",
      booking_email:       band.booking_email       || "",
      phone:               band.phone               || "",
      band_status:         band.band_status         || "active",
      disabled:            band.disabled            || false,
    });
    setView("edit");
  };

  // ── Save edit ──
  const handleSave = async () => {
    try {
      const { error } = await supabase.from("profiles")
        .update(editForm)
        .eq("id", selected.id);
      if (error) throw new Error(error.message);
      await logActivity("band_edited", "band", editForm.band_name, selected.id);
      showMsg("✓ Profile saved successfully", "success");
      if (onRefresh) onRefresh();
      // Stay on edit page briefly so user sees confirmation
      setTimeout(() => setView("list"), 2000);
    } catch(e) {
      showMsg(e.message, "error");
    }
  };

  // ── Toggle disabled ──
  const toggleDisabled = async (band) => {
    const newVal = !band.disabled;
    try {
      const { error } = await supabase.from("profiles")
        .update({ disabled: newVal })
        .eq("id", band.id);
      if (error) throw new Error(error.message);
      showMsg(`✓ Band ${newVal ? "disabled" : "re-enabled"}`);
      if (onRefresh) onRefresh();
    } catch(e) {
      showMsg(e.message, "error");
    }
  };

  // ── Delete band ──
  const handleDelete = async (band) => {
    const gigCount = await supabase.from("gigs").select("id", { count:"exact" }).eq("band_profile_id", band.id);
    const count    = gigCount.count || 0;
    const msg = count > 0
      ? `Delete "${band.band_name}"?\n\n⚠ WARNING: This will orphan ${count} linked gig${count!==1?"s":""}.\n\nConsider disabling instead of deleting.\n\nType DELETE to confirm.`
      : `Delete "${band.band_name}"?\n\nThis cannot be undone. Type DELETE to confirm.`;
    const confirm = prompt(msg);
    if (confirm !== "DELETE") { if (confirm !== null) alert("Deletion cancelled — type DELETE exactly."); return; }
    try {
      await DB.deleteBand(band.id);
      showMsg(`✓ Band deleted`);
      if (onRefresh) onRefresh();
    } catch(e) {
      showMsg(e.message, "error");
    }
  };

  // ── Reset password ──
  const resetPassword = async (band) => {
    const newPass = prompt(`Set new password for ${band.band_name}:`);
    if (!newPass || newPass.length < 6) { alert("Password must be at least 6 characters"); return; }
    try {
      // Use Supabase admin to update password
      const { error } = await supabase.auth.admin?.updateUserById?.(band.id, { password: newPass });
      if (error) throw new Error(error.message);
      showMsg(`✓ Password updated for ${band.band_name}`);
    } catch(e) {
      // If admin API not available, show SQL instruction
      showMsg(`Run in Supabase SQL: UPDATE auth.users SET encrypted_password = crypt('${newPass}', gen_salt('bf')) WHERE id = '${band.id}';`, "error");
    }
  };

  // ══ LIST VIEW ══
  if (view === "list") return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <SectionLabel>BAND MANAGEMENT</SectionLabel>
        <Btn onClick={()=>setView("create")} style={{ padding:"10px 20px" }}>+ CREATE BAND</Btn>
      </div>

      {/* Stats strip */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(120px,1fr))", gap:12, marginBottom:20 }}>
        {[
          { label:"TOTAL BANDS",  val: bands.length },
          { label:"ACTIVE",       val: bands.filter(b=>!b.disabled).length },
          { label:"DISABLED",     val: bands.filter(b=>b.disabled).length },
          { label:"UNCLAIMED",    val: bands.filter(b=>b.admin_created && !b.claimed).length },
          { label:"COMPLETE",     val: bands.filter(b=>getProfileCompleteness(b).score===100).length },
        ].map(({ label, val }) => (
          <div key={label} style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6, padding:"10px 14px" }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{label}</div>
            <div style={{ fontSize:24, fontFamily:F.display, color:C.red, lineHeight:1.2 }}>{val}</div>
          </div>
        ))}
      </div>

      {msg.text && (
        <div style={{ marginBottom:16, padding:12, background: msg.type==="error" ? "rgba(232,32,58,0.1)" : "rgba(67,170,139,0.1)", border:`1px solid ${msg.type==="error"?C.red:C.green}`, borderRadius:6, fontSize:13, color: msg.type==="error" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      {/* Search */}
      <div style={{ position:"relative", marginBottom:20 }}>
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, color:C.muted }}>🔍</span>
        <input type="text" placeholder="Search bands..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...inputCss, paddingLeft:42 }}
          onFocus={e=>e.target.style.borderColor=C.red}
          onBlur={e=>e.target.style.borderColor=C.border}
        />
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.length === 0 && <div style={{ color:C.dim, fontSize:13 }}>No bands found.</div>}
        {filtered.map(b => {
          const color                   = GENRE_COLORS[b.primary_genre||b.genre] || "#888";
          const { score, done, missing } = getProfileCompleteness(b);
          const scoreCol                = score===100 ? C.green : score>=60 ? C.amber : C.red;
          const [showBreakdown, setShowBreakdown] = [false, ()=>{}]; // inline expand handled below
          return (
            <div key={b.id} style={{
              background: b.disabled ? "rgba(255,255,255,0.01)" : C.surfaceHigh,
              border:`1px solid ${b.disabled ? C.dim : C.border}`,
              borderLeft:`3px solid ${b.disabled ? C.dim : color}`,
              borderRadius:8, padding:"14px 18px",
              opacity: b.disabled ? 0.6 : 1,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                {/* Photo */}
                {b.photo_url
                  ? <img src={b.photo_url} style={{ width:44, height:44, borderRadius:"50%", objectFit:"cover", border:`2px solid ${color}`, flexShrink:0 }} />
                  : <div style={{ width:44, height:44, borderRadius:"50%", background:`${color}22`, border:`2px solid ${color}44`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:20 }}>🎸</div>
                }
                {/* Info */}
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color: b.disabled ? C.muted : C.white }}>{b.band_name}</span>
                    {b.admin_created && !b.claimed && <Badge label="UNCLAIMED" color={C.amber} />}
                    {b.claimed      && <Badge label="CLAIMED"   color={C.green} />}
                    {b.disabled     && <Badge label="DISABLED"  color={C.dim}   />}
                    {b.band_status !== "active" && b.band_status && <Badge label={b.band_status.toUpperCase().replace("-"," ")} color={C.muted} />}
                  </div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                    {[b.city, b.primary_genre||b.genre].filter(Boolean).join(" · ")}
                    {b.band_slug && <span style={{ color:C.dim, marginLeft:8 }}>/{b.band_slug}</span>}
                  </div>
                  {/* Completeness bar + score */}
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
                    <div style={{ width:80, background:"rgba(255,255,255,0.08)", borderRadius:3, height:4 }}>
                      <div style={{ width:`${score}%`, height:"100%", background:scoreCol, borderRadius:3, transition:"width 0.3s" }} />
                    </div>
                    <span style={{ fontSize:11, color:scoreCol, fontFamily:F.display }}>{score}%</span>
                  </div>
                  {/* Completion breakdown */}
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
                    {done.map(f    => <span key={f} style={{ fontSize:10, color:C.green }}>✓ {f}</span>)}
                    {missing.map(f => <span key={f} style={{ fontSize:10, color:C.red   }}>✗ {f}</span>)}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <Btn variant="ghost" onClick={()=>openEdit(b)} style={{ fontSize:11, padding:"6px 12px" }}>✏️ EDIT</Btn>
                  {b.band_slug && (
                    <a href={`/artist/${b.band_slug}`} target="_blank" rel="noreferrer"
                      style={{ ...btnCss("ghost"), fontSize:11, padding:"6px 12px", textDecoration:"none", display:"inline-block" }}
                    >👁 PROFILE</a>
                  )}
                  <Btn variant="ghost" onClick={()=>{ setView("list"); window.scrollTo(0,0); }} style={{ fontSize:11, padding:"6px 12px" }}
                    onClick={()=>{ /* switch to bulk import with this band pre-selected */ }}
                  >🎸 GIGS</Btn>
                  <Btn
                    variant={b.disabled ? "success" : "ghost"}
                    onClick={()=>toggleDisabled(b)}
                    style={{ fontSize:11, padding:"6px 12px" }}
                  >{b.disabled ? "ENABLE" : "DISABLE"}</Btn>
                  <Btn variant="ghost" onClick={()=>resetPassword(b)} style={{ fontSize:11, padding:"6px 12px" }}>🔑</Btn>
                  <Btn variant="danger" onClick={()=>handleDelete(b)} style={{ fontSize:11, padding:"6px 12px" }}>🗑</Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ══ CREATE VIEW ══
  if (view === "create") return (
    <div style={{ maxWidth:700 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24 }}>
        <span onClick={()=>setView("list")} style={{ color:C.muted, cursor:"pointer", fontSize:13 }}>← Back</span>
        <SectionLabel>CREATE BAND ACCOUNT</SectionLabel>
      </div>

      {msg.text && (
        <div style={{ marginBottom:16, padding:12, background: msg.type==="error" ? "rgba(232,32,58,0.1)" : "rgba(67,170,139,0.1)", border:`1px solid ${msg.type==="error"?C.red:C.green}`, borderRadius:6, fontSize:13, color: msg.type==="error" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ fontSize:12, color:C.muted, marginBottom:20, lineHeight:1.7 }}>
          Creates a Supabase auth account and complete band profile in one step.
          The band can log in immediately using these credentials.
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          {/* Account */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2 }}>ACCOUNT</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="BAND / ARTIST NAME *" value={createForm.band_name} onChange={setC("band_name")} required />
          </div>
          <Input label="EMAIL ADDRESS *"     type="email" value={createForm.email}    onChange={setC("email")}    required />
          <Input label="TEMPORARY PASSWORD *" type="text"  value={createForm.password} onChange={setC("password")} required />
          <div style={{ gridColumn:"1/-1", fontSize:11, color:C.dim }}>
            💡 Use a simple temporary password. Advise the band to change it after first login.
          </div>

          {/* Band info */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>BAND INFORMATION</div>
          <Input label="BASE CITY" value={createForm.city} onChange={setC("city")} />
          <Input label="CONTACT NUMBER" type="tel" value={createForm.phone} onChange={setC("phone")} />
          <Select label="PRIMARY GENRE"            value={createForm.primary_genre}   onChange={setC("primary_genre")}   options={["", ...GENRES]} />
          <Select label="SECONDARY GENRE"          value={createForm.secondary_genre} onChange={setC("secondary_genre")} options={["", ...GENRES]} />
          <Select label="TERTIARY GENRE"           value={createForm.tertiary_genre}  onChange={setC("tertiary_genre")}  options={["", ...GENRES]} />
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>BIO / ABOUT</label>
            <textarea value={createForm.bio} onChange={setC("bio")} rows={4}
              placeholder="Tell fans about this band..."
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          {/* Photo */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>PROFILE PHOTO</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="PHOTO URL" type="url" value={createForm.photo_url} onChange={setC("photo_url")} placeholder="https://..." />
            {createForm.photo_url && (
              <img src={createForm.photo_url} alt="Preview"
                style={{ marginTop:8, width:70, height:70, borderRadius:"50%", objectFit:"cover", border:`2px solid ${C.red}` }}
              />
            )}
          </div>

          {/* Social */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SOCIAL & MUSIC</div>
          <Input label="WEBSITE"   type="url" value={createForm.website}   onChange={setC("website")}   placeholder="https://..." />
          <Input label="FACEBOOK"  type="url" value={createForm.facebook}  onChange={setC("facebook")}  placeholder="https://facebook.com/..." />
          <Input label="INSTAGRAM" type="url" value={createForm.instagram} onChange={setC("instagram")} placeholder="https://instagram.com/..." />
          <Input label="TIKTOK"    type="url" value={createForm.tiktok_url} onChange={setC("tiktok_url")} placeholder="https://tiktok.com/@..." />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="SPOTIFY ARTIST URL" type="url" value={createForm.spotify} onChange={setC("spotify")} placeholder="https://open.spotify.com/artist/..." />
          </div>

          {/* Contact */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>CONTACT</div>
          <Input label="BOOKING EMAIL" type="email" value={createForm.booking_email} onChange={setC("booking_email")} placeholder="booking@..." />
          <Input label="YOUTUBE CHANNEL" type="url" value={createForm.youtube_channel_url} onChange={setC("youtube_channel_url")} placeholder="https://youtube.com/@..." />

        </div>

        <Btn onClick={handleCreate} disabled={creating} style={{ width:"100%", marginTop:24, padding:"14px" }}>
          {creating ? "CREATING..." : "CREATE BAND →"}
        </Btn>
      </div>
    </div>
  );

  // ══ EDIT VIEW ══
  if (view === "edit" && selected) return (
    <div style={{ maxWidth:700 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, flexWrap:"wrap" }}>
        <span onClick={()=>setView("list")} style={{ color:C.muted, cursor:"pointer", fontSize:13 }}>← Back to bands</span>
        <div style={{ fontFamily:F.display, fontSize:20, color:C.white, letterSpacing:2 }}>EDITING: {selected.band_name}</div>
        {selected.band_slug && (
          <a href={`/artist/${selected.band_slug}`} target="_blank" rel="noreferrer"
            style={{ fontSize:11, color:C.red, textDecoration:"none" }}
          >↗ View public page</a>
        )}
      </div>

      {msg.text && (
        <div style={{ marginBottom:16, padding:12, background: msg.type==="error" ? "rgba(232,32,58,0.1)" : "rgba(67,170,139,0.1)", border:`1px solid ${msg.type==="error"?C.red:C.green}`, borderRadius:6, fontSize:13, color: msg.type==="error" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2 }}>BAND INFORMATION</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="BAND / ARTIST NAME" value={editForm.band_name} onChange={setE("band_name")} required />
          </div>
          <Input label="BASE CITY" value={editForm.city} onChange={setE("city")} />
          <Select label="BAND STATUS" value={editForm.band_status} onChange={setE("band_status")}
            options={[
              {value:"active",    label:"Active"},
              {value:"inactive",  label:"Inactive"},
              {value:"on-hiatus", label:"On Hiatus"},
              {value:"disbanded", label:"Disbanded"},
            ]}
          />
          <Select label="PRIMARY GENRE"            value={editForm.primary_genre}   onChange={setE("primary_genre")}   options={["", ...GENRES]} />
          <Select label="SECONDARY GENRE"          value={editForm.secondary_genre} onChange={setE("secondary_genre")} options={["", ...GENRES]} />
          <Select label="TERTIARY GENRE"           value={editForm.tertiary_genre||""} onChange={setE("tertiary_genre")}  options={["", ...GENRES]} />
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>BIO</label>
            <textarea value={editForm.bio} onChange={setE("bio")} rows={4}
              style={{ ...inputCss, resize:"vertical" }}
              placeholder="Band biography..."
            />
          </div>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>PROFILE PHOTO</div>
          <div style={{ gridColumn:"1/-1" }}>
            <PhotoUpload
              userId={selected.id}
              currentUrl={editForm.photo_url}
              onUploaded={(url) => setEditForm(f=>({...f, photo_url:url}))}
            />
          </div>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SOCIAL & MUSIC</div>
          <Input label="WEBSITE"   type="url" value={editForm.website}   onChange={setE("website")}   placeholder="https://..." />
          <Input label="SPOTIFY"   type="url" value={editForm.spotify}   onChange={setE("spotify")}   placeholder="https://open.spotify.com/artist/..." />
          <Input label="INSTAGRAM" type="url" value={editForm.instagram} onChange={setE("instagram")} placeholder="https://instagram.com/..." />
          <Input label="FACEBOOK"  type="url" value={editForm.facebook}  onChange={setE("facebook")}  placeholder="https://facebook.com/..." />
          <Input label="TIKTOK"    type="url" value={editForm.tiktok_url} onChange={setE("tiktok_url")} placeholder="https://tiktok.com/@..." />
          <Input label="YOUTUBE"   type="url" value={editForm.youtube_channel_url} onChange={setE("youtube_channel_url")} placeholder="https://youtube.com/@..." />

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>CONTACT</div>
          <Input label="BOOKING EMAIL" type="email" value={editForm.booking_email} onChange={setE("booking_email")} />
          <Input label="PHONE"         type="tel"   value={editForm.phone}         onChange={setE("phone")} />

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>VISIBILITY</div>
          <div style={{ gridColumn:"1/-1", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:6 }}>
            <div>
              <div style={{ fontSize:13, color:C.white, fontFamily:F.display, letterSpacing:1 }}>DISABLE PROFILE</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>Hides from public calendar and artist directory. Data is preserved.</div>
            </div>
            <div onClick={()=>setEditForm(f=>({...f, disabled:!f.disabled}))}
              style={{ width:48, height:26, borderRadius:13, cursor:"pointer", transition:"background 0.2s",
                background: editForm.disabled ? C.red : "rgba(255,255,255,0.1)", position:"relative", flexShrink:0 }}
            >
              <div style={{ width:20, height:20, borderRadius:"50%", background:"#fff", position:"absolute", top:3,
                left: editForm.disabled ? 25 : 3, transition:"left 0.2s" }} />
            </div>
          </div>
        </div>

        <Btn onClick={handleSave} style={{ width:"100%", marginTop:24, padding:"13px" }}>SAVE CHANGES</Btn>
      </div>
    </div>
  );

  return null;
}

// ════════════════════════════════════════════════════════════════════
//  PHOTO UPLOAD
// ════════════════════════════════════════════════════════════════════
function PhotoUpload({ userId, currentUrl, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState("");
  const inputRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      // Upload to Supabase Storage — store under userId/filename
      const ext      = file.name.split(".").pop();
      const filePath = `${userId}/profile.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("band-photos")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      // Get public URL
      const { data } = supabase.storage
        .from("band-photos")
        .getPublicUrl(filePath);
      onUploaded(data.publicUrl);
    } catch(e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:10, fontFamily:F.display }}>
        PROFILE PHOTO
      </label>
      <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
        {/* Preview */}
        <div style={{
          width:90, height:90, borderRadius:"50%", flexShrink:0,
          background:"rgba(255,255,255,0.05)", border:`2px solid ${currentUrl ? C.red : C.border}`,
          overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          {currentUrl
            ? <img src={currentUrl} alt="Profile" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            : <span style={{ fontSize:32 }}>🎸</span>
          }
        </div>

        {/* Upload button */}
        <div style={{ flex:1 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            style={{ display:"none" }}
          />
          <Btn
            variant={currentUrl ? "ghost" : "primary"}
            onClick={() => inputRef.current.click()}
            disabled={uploading}
            style={{ marginBottom:8 }}
          >
            {uploading ? "UPLOADING..." : currentUrl ? "CHANGE PHOTO" : "UPLOAD PHOTO"}
          </Btn>
          <div style={{ fontSize:11, color:C.dim }}>
            JPG, PNG or WebP · Max 5MB
          </div>
          {error && <div style={{ fontSize:12, color:C.red, marginTop:6 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  EDIT PROFILE
// ════════════════════════════════════════════════════════════════════
function EditProfile({ user, profile, onSaved }) {
  const [form, setForm] = useState({
    band_name:           profile?.band_name           || "",
    city:                profile?.city                || "",
    genre:               profile?.genre               || "",
    primary_genre:       profile?.primary_genre       || "",
    secondary_genre:     profile?.secondary_genre     || "",
    tertiary_genre:      profile?.tertiary_genre      || "",
    formation_year:      profile?.formation_year      || "",
    bio:                 profile?.bio                 || "",
    photo_url:           profile?.photo_url           || "",
    website:             profile?.website             || "",
    spotify:             profile?.spotify             || "",
    instagram:           profile?.instagram           || "",
    facebook:            profile?.facebook            || "",
    twitter:             profile?.twitter             || "",
    tiktok_url:          profile?.tiktok_url          || "",
    youtube_channel_url: profile?.youtube_channel_url || "",
    youtube_featured_url:profile?.youtube_featured_url|| "",
    apple_music_url:     profile?.apple_music_url     || "",
    bandcamp_url:        profile?.bandcamp_url        || "",
    soundcloud_url:      profile?.soundcloud_url      || "",
    booking_email:       profile?.booking_email       || "",
    management_contact:  profile?.management_contact  || "",
    press_contact:       profile?.press_contact       || "",
    phone:               profile?.phone               || "",
    seo_title:           profile?.seo_title            || "",
    seo_description:     profile?.seo_description       || "",
    seo_search_phrases:  profile?.seo_search_phrases    || "",
  });
  const [status, setStatus] = useState("idle");
  const [msg,    setMsg]    = useState("");

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { score, missing, done } = getProfileCompleteness(form);

  const save = async () => {
    setStatus("loading");
    try {
      // PHASE 4 FIX: previously forced claimed:true on every save. Claimed
      // status now comes exclusively from the claim_requests approval
      // workflow (approve_claim_request / approve_new_entity_request).
      //
      // Fixed: was passing user.id (the signed-in user's own auth id),
      // which only matches profiles.user_id for the literal owner. A
      // manager's auth id is never equal to that column, so this silently
      // failed for managers. profile.id (the row's own identity) works
      // for both, since RLS -- not this match -- is what actually gates
      // who's allowed to touch the row.
      const updated = await DB.updateProfile(profile.id, { ...form });
      setStatus("success");
      setMsg("Profile updated successfully!");
      if (updated) {
        setForm(f => ({ ...f, ...updated }));
        onSaved({ ...profile, ...updated });
      } else {
        onSaved({ ...profile, ...form });
      }
      setTimeout(() => setStatus("idle"), 3000);
    } catch(e) {
      setStatus("error");
      setMsg(e.message);
    }
  };

  const profileUrl = profile?.band_slug
    ? `${BASE_URL}/artist/${profile.band_slug}`
    : null;

  return (
    <div style={{ maxWidth:700 }}>
      <SectionLabel>MY PROFILE</SectionLabel>

      {/* Completeness bar */}
      <div style={{ marginBottom:24, padding:16, background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:13, color:C.white, fontFamily:F.display, letterSpacing:1 }}>PROFILE COMPLETENESS</div>
          <div style={{ fontSize:16, fontFamily:F.display, color: score===100 ? C.green : score>=60 ? C.amber : C.red }}>{score}%</div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:4, height:10, overflow:"hidden" }}>
          <div style={{
            width:`${score}%`, height:"100%", borderRadius:4,
            background: score===100 ? C.green : score>=60 ? C.amber : C.red,
            transition:"width 0.3s ease",
          }} />
        </div>
        {missing.length > 0 && (
          <div style={{ marginTop:8, fontSize:12, color:C.muted }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
              {done.map(f    => <span key={f} style={{ fontSize:11, color:C.green }}>✓ {f}</span>)}
              {missing.map(f => <span key={f} style={{ fontSize:11, color:C.red   }}>✗ {f}</span>)}
            </div>
          </div>
        )}
        {score === 100 && (
          <div style={{ marginTop:8, fontSize:12, color:C.green }}>✓ Profile complete! Fans can find everything they need about you.</div>
        )}
      </div>

      {/* Profile URL */}
      {profileUrl && (
        <div style={{ marginBottom:20, padding:14, background:"rgba(232,32,58,0.06)", border:`1px solid ${C.red}`, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>YOUR PUBLIC PROFILE URL</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <code style={{ fontSize:13, color:C.red, flex:1 }}>{profileUrl}</code>
            <Btn variant="ghost" style={{ fontSize:11, padding:"6px 12px" }} onClick={()=>navigator.clipboard.writeText(profileUrl)}>COPY</Btn>
            <a href={`/artist/${profile.band_slug}`} target="_blank" rel="noreferrer"
              style={{ fontSize:11, fontFamily:F.display, letterSpacing:2, background:C.red, color:"#fff", textDecoration:"none", borderRadius:4, padding:"6px 12px" }}
            >VIEW →</a>
          </div>
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          {/* BAND INFO */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2 }}>BAND INFORMATION</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="BAND / ARTIST NAME" value={form.band_name} onChange={set("band_name")} required />
          </div>
          <Input label="BASE CITY" value={form.city} onChange={set("city")} />
          <Input label="FORMATION YEAR" value={form.formation_year} onChange={set("formation_year")} placeholder="e.g. 2018" />
          <Select label="PRIMARY GENRE" value={form.primary_genre} onChange={set("primary_genre")} options={["", ...GENRES]} />
          <Select label="SECONDARY GENRE (OPTIONAL)" value={form.secondary_genre} onChange={set("secondary_genre")} options={["", ...GENRES]} />
          <Select label="TERTIARY GENRE (OPTIONAL)"  value={form.tertiary_genre||""} onChange={set("tertiary_genre")}  options={["", ...GENRES]} />
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>BIO</label>
            <textarea value={form.bio} onChange={set("bio")} rows={5}
              placeholder="Tell fans about your band — history, sound, influences..."
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          {/* PROFILE PHOTO */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>PROFILE PHOTO</div>
          <div style={{ gridColumn:"1/-1" }}>
            <PhotoUpload
              userId={user.id}
              currentUrl={form.photo_url}
              onUploaded={(url) => setForm(f => ({ ...f, photo_url: url }))}
            />
          </div>

          {/* SEARCH ENGINE LISTING */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SEARCH ENGINE LISTING</div>
          <div style={{ gridColumn:"1/-1", fontSize:13, color:C.muted, lineHeight:1.6, marginTop:-8, marginBottom:4 }}>
            These are optional. If you leave them blank, we'll automatically generate a good title and description for you from the rest of your profile.
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEO TITLE</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>The title that may appear for your page in search engines. Recommended length: around 60 characters.</div>
            <input type="text" value={form.seo_title} onChange={set("seo_title")}
              placeholder="Leave blank to use our automatic title"
              style={inputCss}
            />
            <div style={{ fontSize:11, color: form.seo_title.length > 60 ? C.amber : C.dim, marginTop:4 }}>{form.seo_title.length}/60</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEO DESCRIPTION</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>The short description that may appear beneath your title in search results. Recommended length: around 155–160 characters.</div>
            <textarea value={form.seo_description} onChange={set("seo_description")} rows={3}
              placeholder="Leave blank to use our automatic description"
              style={{ ...inputCss, resize:"vertical" }}
            />
            <div style={{ fontSize:11, color: form.seo_description.length > 160 ? C.amber : C.dim, marginTop:4 }}>{form.seo_description.length}/160</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEARCH PHRASES</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>How might people search for you? For example: blues band Southampton, live folk music Hampshire.</div>
            <textarea value={form.seo_search_phrases} onChange={set("seo_search_phrases")} rows={2}
              placeholder="Optional — a few phrases, separated by commas"
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          {/* SOCIAL MEDIA */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SOCIAL MEDIA</div>
          <Input label="INSTAGRAM URL" type="url" value={form.instagram} onChange={set("instagram")} placeholder="https://instagram.com/..." />
          <Input label="FACEBOOK URL"  type="url" value={form.facebook}  onChange={set("facebook")}  placeholder="https://facebook.com/..." />
          <Input label="TIKTOK URL"    type="url" value={form.tiktok_url} onChange={set("tiktok_url")} placeholder="https://tiktok.com/@..." />
          <Input label="X / TWITTER URL" type="url" value={form.twitter} onChange={set("twitter")} placeholder="https://x.com/..." />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="YOUTUBE CHANNEL URL" type="url" value={form.youtube_channel_url} onChange={set("youtube_channel_url")} placeholder="https://youtube.com/@..." />
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="FEATURED VIDEO URL (optional — a specific video to highlight)" type="url" value={form.youtube_featured_url} onChange={set("youtube_featured_url")} placeholder="https://youtube.com/watch?v=..." />
          </div>

          {/* MUSIC PLATFORMS */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>MUSIC PLATFORMS</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="SPOTIFY ARTIST URL" type="url" value={form.spotify} onChange={set("spotify")} placeholder="https://open.spotify.com/artist/..." />
          </div>
          <Input label="APPLE MUSIC URL"  type="url" value={form.apple_music_url}  onChange={set("apple_music_url")}  placeholder="https://music.apple.com/..." />
          <Input label="BANDCAMP URL"      type="url" value={form.bandcamp_url}     onChange={set("bandcamp_url")}     placeholder="https://yourband.bandcamp.com" />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="SOUNDCLOUD URL"  type="url" value={form.soundcloud_url}   onChange={set("soundcloud_url")}   placeholder="https://soundcloud.com/..." />
          </div>

          {/* WEBSITE & CONTACT */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>WEBSITE & CONTACT</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="OFFICIAL WEBSITE" type="url" value={form.website} onChange={set("website")} placeholder="https://..." />
          </div>
          <Input label="BOOKING EMAIL"       type="email" value={form.booking_email}       onChange={set("booking_email")}       placeholder="booking@..." />
          <Input label="CONTACT NUMBER"      type="tel"   value={form.phone}               onChange={set("phone")}               placeholder="+44..." />
          <Input label="MANAGEMENT CONTACT"  value={form.management_contact} onChange={set("management_contact")} placeholder="Name / email / phone" />
          <Input label="PRESS CONTACT"       value={form.press_contact}      onChange={set("press_contact")}      placeholder="Name / email / phone" />

        </div>

        <Btn onClick={save} disabled={status==="loading"} style={{ width:"100%", marginTop:24, padding:"14px" }}>
          {status==="loading" ? "SAVING..." : "SAVE PROFILE"}
        </Btn>

        {status==="success" && <div style={{ marginTop:12, color:C.green, fontSize:13 }}>✓ {msg}</div>}
        {status==="error"   && <div style={{ marginTop:12, color:C.red,   fontSize:13 }}>{msg}</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  EDIT VENUE (self-service, for a claimed venue owner or scoped manager)
// ════════════════════════════════════════════════════════════════════
// Mirrors EditProfile's structure/styling exactly (same components, same
// tokens) so it reads as part of the same product, not a separate system.
// Reached the same way EditProfile is: whichever entity buildAuthFromSession
// resolved for the signed-in user -- an unclaimed venue with no owner and
// no manager role never resolves here at all, so there's nothing extra to
// gate for that case.
function EditVenue({ user, profile, onSaved }) {
  const [form, setForm] = useState({
    name:                profile?.name                 || "",
    city:                profile?.city                 || "",
    address:             profile?.address              || "",
    postcode:            profile?.postcode             || "",
    capacity:            profile?.capacity             || "",
    contact_email:       profile?.contact_email        || "",
    phone:               profile?.phone                || "",
    description:         profile?.description          || "",
    website:             profile?.website              || "",
    facebook:            profile?.facebook             || "",
    instagram:           profile?.instagram            || "",
    twitter:             profile?.twitter              || "",
    photo_url:           profile?.photo_url            || "",
    seo_title:           profile?.seo_title            || "",
    seo_description:     profile?.seo_description       || "",
    seo_search_phrases:  profile?.seo_search_phrases     || "",
  });
  const [status, setStatus] = useState("idle");
  const [msg,    setMsg]    = useState("");

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setStatus("loading");
    try {
      const updated = await DB.updateVenueSelfService(profile.id, { ...form });
      setStatus("success");
      setMsg("Venue updated successfully!");
      if (updated) {
        setForm(f => ({ ...f, ...updated }));
        onSaved({ ...profile, ...updated, profile_type: "venue", band_name: updated.name });
      } else {
        onSaved({ ...profile, ...form });
      }
      setTimeout(() => setStatus("idle"), 3000);
    } catch(e) {
      setStatus("error");
      setMsg(e.message);
    }
  };

  const venueUrl = profile?.slug ? `${BASE_URL}/venue/${profile.slug}` : null;

  return (
    <div style={{ maxWidth:700 }}>
      <SectionLabel>MY VENUE</SectionLabel>

      {venueUrl && (
        <div style={{ marginBottom:20, padding:14, background:"rgba(232,32,58,0.06)", border:`1px solid ${C.red}`, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>YOUR PUBLIC VENUE URL</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <code style={{ fontSize:13, color:C.red, flex:1 }}>{venueUrl}</code>
            <Btn variant="ghost" style={{ fontSize:11, padding:"6px 12px" }} onClick={()=>navigator.clipboard.writeText(venueUrl)}>COPY</Btn>
            <a href={`/venue/${profile.slug}`} target="_blank" rel="noreferrer"
              style={{ fontSize:11, fontFamily:F.display, letterSpacing:2, background:C.red, color:"#fff", textDecoration:"none", borderRadius:4, padding:"6px 12px" }}
            >VIEW →</a>
          </div>
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          <div style={{ gridColumn:"1/-1" }}>
            <Input label="VENUE NAME" value={form.name} onChange={set("name")} required />
          </div>
          <Input label="CITY / TOWN" value={form.city} onChange={set("city")} />
          <Input label="POSTCODE"    value={form.postcode} onChange={set("postcode")} placeholder="PO1 1AA" />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="ADDRESS" value={form.address} onChange={set("address")} placeholder="Street address" />
          </div>
          <Input label="CAPACITY"      type="number" value={form.capacity}      onChange={set("capacity")}      placeholder="e.g. 200" />
          <Input label="CONTACT EMAIL" type="email"  value={form.contact_email} onChange={set("contact_email")} placeholder="info@venue.co.uk" />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="PHONE" type="tel" value={form.phone} onChange={set("phone")} placeholder="+44..." />
          </div>

          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>ABOUT / DESCRIPTION</label>
            <textarea value={form.description} onChange={set("description")} rows={5}
              placeholder="Tell people about your venue — atmosphere, capacity, what makes it special..."
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          {/* PHOTO */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>PHOTO</div>
          <div style={{ gridColumn:"1/-1" }}>
            <PhotoUpload
              userId={user.id}
              currentUrl={form.photo_url}
              onUploaded={(url) => setForm(f => ({ ...f, photo_url: url }))}
            />
          </div>

          {/* SEARCH ENGINE LISTING -- same fields/guidance as EditProfile */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SEARCH ENGINE LISTING</div>
          <div style={{ gridColumn:"1/-1", fontSize:13, color:C.muted, lineHeight:1.6, marginTop:-8, marginBottom:4 }}>
            These are optional. If you leave them blank, we'll automatically generate a good title and description for you from the rest of your venue's profile.
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEO TITLE</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>The title that may appear for your page in search engines. Recommended length: around 60 characters.</div>
            <input type="text" value={form.seo_title} onChange={set("seo_title")}
              placeholder="Leave blank to use our automatic title"
              style={inputCss}
            />
            <div style={{ fontSize:11, color: form.seo_title.length > 60 ? C.amber : C.dim, marginTop:4 }}>{form.seo_title.length}/60</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEO DESCRIPTION</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>The short description that may appear beneath your title in search results. Recommended length: around 155–160 characters.</div>
            <textarea value={form.seo_description} onChange={set("seo_description")} rows={3}
              placeholder="Leave blank to use our automatic description"
              style={{ ...inputCss, resize:"vertical" }}
            />
            <div style={{ fontSize:11, color: form.seo_description.length > 160 ? C.amber : C.dim, marginTop:4 }}>{form.seo_description.length}/160</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEARCH PHRASES</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>How might people search for your venue? For example: live music venue Southampton, gig venue Hampshire.</div>
            <textarea value={form.seo_search_phrases} onChange={set("seo_search_phrases")} rows={2}
              placeholder="Optional — a few phrases, separated by commas"
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          {/* WEBSITE & SOCIAL */}
          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>WEBSITE & SOCIAL</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="WEBSITE" type="url" value={form.website} onChange={set("website")} placeholder="https://..." />
          </div>
          <Input label="FACEBOOK"  type="url" value={form.facebook}  onChange={set("facebook")}  placeholder="https://facebook.com/..." />
          <Input label="INSTAGRAM" type="url" value={form.instagram} onChange={set("instagram")} placeholder="https://instagram.com/..." />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="X / TWITTER" type="url" value={form.twitter} onChange={set("twitter")} placeholder="https://x.com/..." />
          </div>

        </div>

        <Btn onClick={save} disabled={status==="loading"} style={{ width:"100%", marginTop:24, padding:"14px" }}>
          {status==="loading" ? "SAVING..." : "SAVE VENUE"}
        </Btn>

        {status==="success" && <div style={{ marginTop:12, color:C.green, fontSize:13 }}>✓ {msg}</div>}
        {status==="error"   && <div style={{ marginTop:12, color:C.red,   fontSize:13 }}>{msg}</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  GIG DETAIL PAGE
// ════════════════════════════════════════════════════════════════════
function GigDetailPage() {
  const { slug }   = useParams();
  const navigate   = useNavigate();
  const [gig,      setGig]      = useState(null);
  const [band,     setBand]     = useState(null);
  const [venue,    setVenue]    = useState(null);
  const [festival, setFestival] = useState(null);
  const [venueGigs,setVenueGigs]= useState([]);
  const [prevNext, setPrevNext] = useState({ prev:null, next:null });
  const [awards,   setAwards]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [copied,   setCopied]   = useState(false);
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const g = await DB.getGigBySlug(slug);
      if (!g) { setLoading(false); return; }
      setGig(g);

      // SEO title + meta tags, kept in sync with the crawler-facing
      // api/gig.js response for this same gig.
      const pageTitle = `${g.band_name} at ${g.venue}, ${g.city} | ${fmtDate(g.date)} | Music Scene Magazine`;
      const pageDesc  = `See ${g.band_name} live at ${g.venue}, ${g.city} on ${fmtDate(g.date)}. ${g.notes ? g.notes + " " : ""}Find venue details, band info and upcoming gigs on Music Scene Magazine.`;
      const pageUrl   = `${BASE_URL}/gig/${g.slug}`;
      const pageImg   = g.poster_url || FALLBACK_IMAGE;

      applyPageMeta({ title: pageTitle, description: pageDesc, canonicalUrl: pageUrl, image: pageImg });

      // Load band, venue, prev/next and Editorial Awards in parallel.
      // Awards are looked up by gig_id AND the artist's profile_id in a
      // single call (getActiveAwards de-dupes internally) so a gig with
      // its own award and an artist with their own award never double up,
      // and this doesn't need to wait for the band/venue fetch above.
      const [bandData, venueData, festivalData, pn, aw] = await Promise.all([
        g.band_profile_id
          ? supabase.from("profiles").select("*").eq("id", g.band_profile_id).then(r => r.data?.[0] || null)
          : Promise.resolve(null),
        g.venue_id
          ? supabase.from("venues").select("*").eq("id", g.venue_id).then(r => r.data?.[0] || null)
          : Promise.resolve(null),
        g.festival_profile_id
          ? supabase.from("profiles").select("*").eq("id", g.festival_profile_id).then(r => r.data?.[0] || null)
          : Promise.resolve(null),
        DB.getPrevNextGigs(g.date, g.time, g.id),
        DB.getActiveAwards({ profileId: g.band_profile_id || null, gigId: g.id }),
      ]);

      setBand(bandData);
      setVenue(venueData);
      setFestival(festivalData);
      setPrevNext(pn);
      setAwards(aw);

      applyJsonLd(buildGigJsonLd(g, bandData, venueData));

      // Load other gigs at this venue
      if (g.venue_id) {
        const vg = await DB.getGigsByVenue(g.venue_id);
        setVenueGigs(vg.filter(v => v.id !== g.id && v.date >= today).slice(0, 6));
      }

      setLoading(false);
    }
    load();
    return () => { resetPageMeta(); removeJsonLd(); };
  }, [slug]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.muted, fontFamily:F.display, letterSpacing:2 }}>LOADING...</div>
    </div>
  );

  if (!gig) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.white, fontFamily:F.display, fontSize:32, letterSpacing:2 }}>GIG NOT FOUND</div>
      <span onClick={()=>navigate("/")} style={{ color:C.red, cursor:"pointer", fontSize:14 }}>← Back to Calendar</span>
    </div>
  );

  const color   = GENRE_COLORS[gig.genre] || C.red;
  const gigUrl   = `${BASE_URL}/gig/${gig.slug}`;
  const ogUrl    = `${BASE_URL}/api/og?type=gig&slug=${encodeURIComponent(gig.slug)}`;
  const fbShare  = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(ogUrl)}`;
  const xShare   = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${gig.band_name} live at ${gig.venue}, ${gig.city} — ${fmtDate(gig.date)}`)}&url=${encodeURIComponent(ogUrl)}`;
  const mapsUrl  = `https://www.google.com/maps/search/${encodeURIComponent(`${gig.venue} ${gig.city}`)}`;
  const gcalUrl  = (() => {
    const d = gig.date.replace(/-/g,"");
    const [h,m] = (gig.time||"20:00").split(":");
    const start = `${d}T${h}${m}00`;
    const endH  = String(+h+2).padStart(2,"0");
    const end   = `${d}T${endH}${m}00`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${gig.band_name} at ${gig.venue}`)}&dates=${start}/${end}&details=${encodeURIComponent(`${gig.band_name} live at ${gig.venue}, ${gig.city}`)}&location=${encodeURIComponent(`${gig.venue}, ${gig.city}`)}`;
  })();

  const copyLink = () => {
    navigator.clipboard.writeText(gigUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Day of week helper
  const dayName = (dateStr) => new Date(dateStr).toLocaleDateString("en-GB", { weekday:"long" });

  const NavGigCard = ({ g, dir }) => (
    <Link to={`/gig/${g.slug}`} style={{ textDecoration:"none", flex:1, minWidth:200 }}>
      <div style={{
        padding:"14px 18px", background:C.surface, border:`1px solid ${C.border}`,
        borderTop:`2px solid ${GENRE_COLORS[g.genre]||C.red}`, borderRadius:8,
        cursor:"pointer",
        transition:"border-color 0.2s",
      }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=C.red}
        onMouseLeave={e=>e.currentTarget.style.borderColor=GENRE_COLORS[g.genre]||C.red}
      >
        <div style={{ fontSize:10, color:C.dim, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>
          {dir === "prev" ? "← PREVIOUS GIG" : "NEXT GIG →"}
        </div>
        <div style={{ fontFamily:F.display, fontSize:16, color:C.white, letterSpacing:1 }}>{g.band_name}</div>
        <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{g.venue} · {g.city}</div>
        <div style={{ fontSize:12, color:color, marginTop:3, fontFamily:F.display }}>{fmtDate(g.date)}</div>
      </div>
    </Link>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      {/* Header */}
      <header style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:70 }}>
        <span onClick={()=>navigate("/")} style={{ cursor:"pointer" }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={()=>navigate("/")} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>← BACK TO CALENDAR</span>
      </header>

      {/* Hero */}
      <div style={{
        background: gig.poster_url
          ? `linear-gradient(180deg, rgba(0,0,0,0.7) 0%, #0d0d0d 100%), url(${gig.poster_url}) center/cover`
          : `linear-gradient(180deg, ${color}22 0%, #0d0d0d 100%)`,
        borderBottom:`1px solid ${color}44`,
        padding:"48px 32px 40px",
      }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <Badge label={gig.genre} color={color} />
          {gig.is_recurring && <Badge label={`↻ ${gig.recurrence}`} color={C.amber} />}
          <div style={{ fontFamily:F.display, fontSize:52, letterSpacing:2, color:C.white, lineHeight:1, margin:"12px 0 8px" }}>
            {band?.band_slug
              ? <Link to={`/artist/${band.band_slug}`} style={{ color:C.white, textDecoration:"none" }}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red}
                  onMouseLeave={e=>e.currentTarget.style.color=C.white}
                >{gig.band_name}</Link>
              : gig.band_name
            }
          </div>
          <EditorialAwardStrip awards={awards} style={{ marginBottom:14 }} />
          <div style={{ fontSize:18, color:"#cccccc", marginBottom:6 }}>
            {dayName(gig.date)} {fmtDate(gig.date)}
          </div>
          <div style={{ display:"flex", gap:20, flexWrap:"wrap", fontSize:14, color:"#aaaaaa", marginBottom:20 }}>
            <span>📍 {gig.venue}, {gig.city}</span>
            <span>🕐 {gig.time}</span>
          </div>
          {festival?.band_slug && (
            <div style={{ marginBottom:20 }}>
              <Link to={`/festival/${festival.band_slug}`}
                style={{ fontSize:13, color:C.muted, textDecoration:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"6px 12px", display:"inline-flex", alignItems:"center", gap:6 }}
                onMouseEnter={e=>e.currentTarget.style.color=C.white}
                onMouseLeave={e=>e.currentTarget.style.color=C.muted}
              >🎪 Part of {festival.band_name}</Link>
            </div>
          )}
          {/* Action buttons */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {gig.tickets && (
              <a href={gig.tickets} target="_blank" rel="noreferrer"
                style={{ padding:"12px 24px", background:C.red, color:"#fff", textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:13, letterSpacing:2 }}
              >GET TICKETS →</a>
            )}
            <a href={gcalUrl} target="_blank" rel="noreferrer"
              style={{ padding:"12px 20px", background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:12, letterSpacing:2, border:`1px solid ${C.border}` }}
            >📅 GOOGLE CALENDAR</a>
            <button onClick={()=>exportICal([gig])}
              style={{ padding:"12px 20px", background:"rgba(255,255,255,0.08)", color:C.white, border:`1px solid ${C.border}`, borderRadius:5, cursor:"pointer", fontFamily:F.display, fontSize:12, letterSpacing:2 }}
            >⬇ ICAL</button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 32px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:32, marginBottom:48 }}>

          {/* Band section */}
          {band && (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${color}`, borderRadius:8, padding:24 }}>
              <div style={{ fontSize:10, color:C.dim, letterSpacing:3, fontFamily:F.display, marginBottom:14 }}>THE BAND</div>
              <div style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:14 }}>
                {band.photo_url && (
                  <img src={band.photo_url} alt={band.band_name}
                    style={{ width:64, height:64, borderRadius:"50%", objectFit:"cover", border:`2px solid ${color}`, flexShrink:0 }}
                  />
                )}
                <div>
                  <div style={{ fontFamily:F.display, fontSize:20, color:C.white, letterSpacing:1.5 }}>{band.band_name}</div>
                  {(band.primary_genre||band.genre) && <Badge label={band.primary_genre||band.genre} color={color} />}
                  {band.city && <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>📍 {band.city}</div>}
                </div>
              </div>
              {band.bio && (
                <div style={{ fontSize:13, color:"#ccc", lineHeight:1.7, marginBottom:14,
                  display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden"
                }}>{band.bio}</div>
              )}
              {band.band_slug && (
                <Link to={`/artist/${band.band_slug}`}
                  style={{ display:"inline-block", padding:"9px 18px", background:C.red, color:"#fff", textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:11, letterSpacing:2 }}
                >VIEW ARTIST PROFILE →</Link>
              )}
            </div>
          )}

          {/* Venue section */}
          {venue && (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.amber}`, borderRadius:8, padding:24 }}>
              <div style={{ fontSize:10, color:C.dim, letterSpacing:3, fontFamily:F.display, marginBottom:14 }}>THE VENUE</div>
              <div style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:14 }}>
                {venue.photo_url && (
                  <img src={venue.photo_url} alt={venue.name}
                    style={{ width:64, height:64, borderRadius:6, objectFit:"cover", border:`2px solid ${C.amber}`, flexShrink:0 }}
                  />
                )}
                <div>
                  <div style={{ fontFamily:F.display, fontSize:20, color:C.white, letterSpacing:1.5 }}>{venue.name}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>📍 {venue.city}</div>
                </div>
              </div>
              {venue.description && (
                <div style={{ fontSize:13, color:"#ccc", lineHeight:1.7, marginBottom:14,
                  display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden"
                }}>{venue.description}</div>
              )}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {venue.slug && (
                  <Link to={`/venue/${venue.slug}`}
                    style={{ display:"inline-block", padding:"9px 18px", background:C.amber, color:"#000", textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:11, letterSpacing:2 }}
                  >VIEW VENUE PROFILE →</Link>
                )}
                <a href={mapsUrl} target="_blank" rel="noreferrer"
                  style={{ display:"inline-block", padding:"9px 18px", background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:11, letterSpacing:2, border:`1px solid ${C.border}` }}
                >📍 GOOGLE MAPS →</a>
              </div>
            </div>
          )}
        </div>

        {/* Gig info */}
        <div style={{ marginBottom:48 }}>
          <SectionLabel>GIG INFORMATION</SectionLabel>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px,1fr))", gap:16, marginBottom: gig.notes ? 20 : 0 }}>
              {[
                { label:"DATE",  val: `${dayName(gig.date)}, ${fmtDate(gig.date)}` },
                { label:"DOORS", val: gig.time },
                { label:"VENUE", val: gig.venue },
                { label:"CITY",  val: gig.city  },
                { label:"GENRE", val: gig.genre  },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize:9, color:C.dim, letterSpacing:2, fontFamily:F.display, marginBottom:4 }}>{label}</div>
                  <div style={{ fontSize:14, color:"#ddd" }}>{val}</div>
                </div>
              ))}
            </div>
            {gig.notes && (
              <div style={{ marginTop:16, padding:"12px 16px", background:"rgba(255,255,255,0.03)", borderLeft:`3px solid ${color}`, borderRadius:4 }}>
                <div style={{ fontSize:10, color:C.dim, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>NOTES</div>
                <div style={{ fontSize:13, color:"#ccc", lineHeight:1.7 }}>{gig.notes}</div>
              </div>
            )}
            {gig.description && (
              <div style={{ marginTop:12, padding:"12px 16px", background:"rgba(255,255,255,0.03)", borderLeft:`3px solid ${C.muted}`, borderRadius:4 }}>
                <div style={{ fontSize:10, color:C.dim, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>DESCRIPTION</div>
                <div style={{ fontSize:13, color:"#ccc", lineHeight:1.7 }}>{gig.description}</div>
              </div>
            )}
          </div>
        </div>

        {/* Share */}
        <div style={{ marginBottom:48 }}>
          <SectionLabel>SHARE THIS GIG</SectionLabel>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <a href={fbShare} target="_blank" rel="noreferrer"
              style={{ padding:"10px 20px", background:"#1877f2", color:"#fff", textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:12, letterSpacing:2 }}
            >FACEBOOK</a>
            <a href={xShare} target="_blank" rel="noreferrer"
              style={{ padding:"10px 20px", background:"#000", color:"#fff", textDecoration:"none", borderRadius:5, fontFamily:F.display, fontSize:12, letterSpacing:2, border:`1px solid #333` }}
            >X / TWITTER</a>
            <button onClick={copyLink}
              style={{ padding:"10px 20px", background: copied ? C.green : "rgba(255,255,255,0.08)", color:"#fff", border:`1px solid ${C.border}`, borderRadius:5, cursor:"pointer", fontFamily:F.display, fontSize:12, letterSpacing:2 }}
            >{copied ? "✓ COPIED!" : "COPY LINK"}</button>
          </div>
        </div>

        {/* Other gigs at this venue */}
        {venueGigs.length > 0 && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>OTHER GIGS AT {gig.venue.toUpperCase()}</SectionLabel>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {venueGigs.map(g => {
                const gc = GENRE_COLORS[g.genre] || "#888";
                return (
                  <Link key={g.id} to={`/gig/${g.slug}`} style={{ textDecoration:"none" }}>
                    <div style={{
                      display:"flex", alignItems:"center", gap:16, padding:"12px 18px",
                      background:C.surface, border:`1px solid ${C.border}`,
                      borderLeft:`3px solid ${gc}`, borderRadius:8, flexWrap:"wrap",
                      cursor:"pointer",
                    }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.surfaceHigh}
                      onMouseLeave={e=>e.currentTarget.style.background=C.surface}
                    >
                      <div style={{ fontFamily:F.display, fontSize:15, color:C.red, minWidth:110 }}>{fmtDate(g.date)}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, color:C.white }}>{g.band_name}</div>
                        <div style={{ fontSize:11, color:C.muted }}>{g.genre} · {g.time}</div>
                      </div>
                      <Badge label={g.genre} color={gc} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* MSM Coverage -- Editorial Awards (Stage 4) */}
        <MSMCoverageSection awards={awards} subjectLabel={gig.band_name} />

        {/* Prev / Next navigation */}
        {(prevNext.prev || prevNext.next) && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>KEEP EXPLORING</SectionLabel>
            <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
              {prevNext.prev && <NavGigCard g={prevNext.prev} dir="prev" />}
              {prevNext.next && <NavGigCard g={prevNext.next} dir="next" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 4: CLAIM EXISTING ENTITY (shared by all public profile pages)
// ════════════════════════════════════════════════════════════════════
// Public profile pages (Venue/Band/Festival/Promoter) are rendered as
// standalone routes with no access to MainApp's auth state, so this
// checks auth independently via supabase.auth.getUser() -- the same
// pattern already used elsewhere in this file (logActivity, markVerified).
// Submitting a claim is a plain authenticated INSERT into claim_requests;
// it deliberately does NOT call signUp(), so it never triggers the
// handle_new_user() auto-create path and cannot create a duplicate profile.
//
// Eligibility is driven entirely by claim_status, not admin_created.
// admin_created was previously used as an extra gate on the assumption
// that a self-registered profile (admin_created=false) always already has
// a real owner -- but that's not reliably true (e.g. profiles created by
// older import paths can have admin_created=false, claim_status
// ='unclaimed', and no genuine owner, which silently hid the claim box
// entirely for them, including on the "Chicago 9" band profile). Since
// claim_status is the field the whole approve/reject workflow already
// authoritatively maintains, it's the only signal this component needs:
// 'unclaimed' -> show the claim CTA, 'pending' -> show the pending badge,
// 'claimed' -> show nothing.
function ClaimEntityBox({ entityType, entityId, claimStatus }) {
  const [authUser, setAuthUser] = useState(undefined); // undefined = checking, null = signed out
  const [message, setMessage]   = useState("");
  const [status, setStatus]     = useState("idle");
  const [msg, setMsg]           = useState("");
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (USE_MOCK) { if (!cancelled) setAuthUser(null); return; }
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setAuthUser(data?.user || null);
      } catch(e) { if (!cancelled) setAuthUser(null); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (claimStatus === "claimed" || authUser === undefined) return null;

  const nounFor = { band:"band", solo_artist:"artist", venue:"venue", festival:"festival", promoter:"promoter" };
  const noun = nounFor[entityType] || "profile";
  const ctaLabel = entityType === "band" || entityType === "solo_artist" ? "CLAIM THIS BAND PROFILE" : `CLAIM THIS ${noun.toUpperCase()}`;

  if (claimStatus === "pending") {
    return (
      <div style={{ marginTop:24, padding:16, background:"rgba(244,162,97,0.08)", border:`1px solid ${C.amber}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:13, color:C.amber, letterSpacing:2, marginBottom:8 }}>IS THIS YOURS?</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Badge label="CLAIM PENDING" color={C.amber} />
          <span style={{ fontSize:13, color:"#ccc" }}>A claim for this listing is already under review by our team.</span>
        </div>
      </div>
    );
  }

  const submitClaim = async () => {
    setStatus("loading");
    try {
      await DB.submitClaimRequest({
        entityType, entityId,
        requestedBy: authUser.id,
        requesterEmail: authUser.email,
        message,
      });
      setStatus("success");
      setMsg("Claim submitted! Our team will review it shortly.");
    } catch(e) { setStatus("error"); setMsg(e.message); }
  };

  return (
    <div style={{ marginTop:24, padding:16, background:"rgba(244,162,97,0.08)", border:`1px solid ${C.amber}`, borderRadius:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <Badge label="UNCLAIMED" color={C.amber} />
      </div>

      {/* Signed-out visitor: prominent CTA, then inline sign-in/fan-signup on click.
          Continues straight into the claim form below once authenticated --
          same entityType/entityId the whole time, no re-navigation. */}
      {!authUser && status !== "success" && !showAuth && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ fontSize:13, color:"#ccc", lineHeight:1.6 }}>
            Is this your {noun}? Claim this profile to manage your {noun === "artist" ? "artist" : noun} information, links, images and gig listings.
          </div>
          <Btn onClick={()=>setShowAuth(true)} style={{ fontSize:12, alignSelf:"flex-start", padding:"10px 20px" }}>
            {ctaLabel}
          </Btn>
        </div>
      )}
      {!authUser && status !== "success" && showAuth && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ fontSize:13, color:"#ccc", lineHeight:1.6 }}>
            Sign in or create a free account to claim this profile.
          </div>
          <InlineAuthPrompt
            accent={C.amber}
            actionLabel="CLAIM"
            onCancel={()=>setShowAuth(false)}
            onAuthed={(user)=>{ setAuthUser(user); setShowAuth(false); }}
          />
        </div>
      )}

      {/* Signed-in: the actual claim submission form, reusing the existing
          claim_requests workflow exactly as before. */}
      {authUser && status !== "success" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:13, color:"#ccc", lineHeight:1.6 }}>
            Is this your {noun}? Claim this profile to manage your {noun === "artist" ? "artist" : noun} information, links, images and gig listings.
          </div>
          <textarea
            value={message} onChange={e=>setMessage(e.target.value)}
            placeholder="Optional note for our team (e.g. how to verify you're the owner)"
            rows={2}
            style={{ ...inputCss, resize:"vertical" }}
          />
          <Btn onClick={submitClaim} disabled={status==="loading"} style={{ fontSize:12, alignSelf:"flex-start", padding:"10px 20px" }}>
            {status==="loading" ? "SUBMITTING..." : ctaLabel}
          </Btn>
          {status==="error" && <div style={{ color:C.red, fontSize:12 }}>{msg}</div>}
        </div>
      )}

      {status==="success" && <div style={{ color:C.green, fontSize:13 }}>✓ {msg}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PUBLIC VENUE PROFILE PAGE
// ════════════════════════════════════════════════════════════════════
function VenueProfilePage() {
  const { slug }    = useParams();
  const navigate    = useNavigate();
  const [venue,     setVenue]   = useState(null);
  const [gigs,      setGigs]    = useState([]);
  const [awards,    setAwards]  = useState([]);
  const [loading,   setLoading] = useState(true);
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const v = await DB.getVenueBySlug(slug);
      if (!v) { setLoading(false); return; }
      setVenue(v);

      // SEO metadata, kept in sync with api/og.js's type=venue crawler
      // response, including the same fallback text/image when a venue
      // has no description or photo set. SEO Step 7: owner/manager
      // override, title/description display only.
      applyPageMeta({
        title: v.seo_title?.trim() || `${v.name}, ${v.city} | Music Scene Magazine`,
        description: v.seo_description?.trim() || (v.description
          ? v.description.slice(0, 200)
          : `${v.name} in ${v.city}. See upcoming gigs and events on Music Scene Magazine.`),
        canonicalUrl: `${BASE_URL}/venue/${v.slug}`,
        image: v.photo_url || FALLBACK_IMAGE,
      });
      applyJsonLd(buildVenueJsonLd(v));
      // NOTE: editorial_features.profile_id is FK'd to public.profiles.id
      // only -- venues live in a separate public.venues table with its own
      // id space, and the current Admin Editorial subject-search only
      // offers profiles/gigs as award targets. This call is wired up so a
      // venue award will display the moment that becomes possible, but
      // under the current schema/admin workflow it will always resolve to
      // an empty list. Flagged in the implementation notes.
      const [g, aw] = await Promise.all([
        DB.getGigsByVenue(v.id),
        DB.getActiveAwards({ profileId: v.id }),
      ]);
      setGigs(g);
      setAwards(aw);
      setLoading(false);
    }
    load();
    return () => { resetPageMeta(); removeJsonLd(); };
  }, [slug]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.muted, fontSize:16, fontFamily:F.display, letterSpacing:2 }}>LOADING...</div>
    </div>
  );

  if (!venue) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.white, fontFamily:F.display, fontSize:32, letterSpacing:2 }}>VENUE NOT FOUND</div>
      <span onClick={()=>navigate("/")} style={{ color:C.red, cursor:"pointer", fontSize:14 }}>← Back to Calendar</span>
    </div>
  );

  const upcomingGigs = gigs.filter(g => g.date >= today);
  const pastGigs     = gigs.filter(g => g.date <  today).reverse();

  const socialLinks = [
    { url: venue.instagram, icon:"📷", label:"Instagram" },
    { url: venue.facebook,  icon:"👍", label:"Facebook"  },
    { url: venue.twitter,   icon:"🐦", label:"X/Twitter" },
  ].filter(s => s.url);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      {/* Header */}
      <header style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:70 }}>
        <span onClick={()=>navigate("/")} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={()=>navigate("/")} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>
          ← BACK TO CALENDAR
        </span>
      </header>

      {/* Hero */}
      <div style={{
        background: venue.photo_url
          ? `linear-gradient(180deg, rgba(0,0,0,0.6) 0%, #0d0d0d 100%), url(${venue.photo_url}) center/cover`
          : `linear-gradient(180deg, rgba(232,32,58,0.15) 0%, #0d0d0d 100%)`,
        borderBottom:`1px solid rgba(232,32,58,0.3)`,
        padding:"48px 32px 40px",
      }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:3, fontFamily:F.display, marginBottom:8 }}>VENUE</div>
          <div style={{ fontFamily:F.display, fontSize:48, letterSpacing:2, color:C.white, lineHeight:1, marginBottom:10 }}>
            {venue.name}
          </div>
          <EditorialAwardStrip awards={awards} style={{ marginBottom:14 }} />
          <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap", marginBottom:20 }}>
            <span style={{ fontSize:15, color:"#cccccc" }}>📍 {venue.city}</span>
            <span style={{ fontSize:13, color:C.dim }}>🎸 {gigs.length} gig{gigs.length!==1?"s":""} listed</span>
            <ClaimStatusBadge claimStatus={venue.claim_status} entityType="venue" />
          </div>

          {/* Social links */}
          {socialLinks.length > 0 && (
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {socialLinks.map(s => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:C.muted, textDecoration:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 10px", display:"flex", alignItems:"center", gap:5 }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=C.red}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
                >{s.icon} {s.label}</a>
              ))}
            </div>
          )}

          {venue.website && (
            <a href={venue.website} target="_blank" rel="noreferrer"
              style={{ fontSize:12, fontFamily:F.display, letterSpacing:2, background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, padding:"8px 16px", border:`1px solid ${C.border}`, display:"inline-block" }}
            >VISIT WEBSITE</a>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 32px" }}>

        {/* Description */}
        {venue.description && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>ABOUT</SectionLabel>
            <div style={{ fontSize:16, color:"#dddddd", lineHeight:1.8, maxWidth:700 }}>{venue.description}</div>
          </div>
        )}

        {/* MSM Coverage -- Editorial Awards (Stage 4) */}
        <MSMCoverageSection awards={awards} subjectLabel={venue.name} />

        {/* PHASE 4: claim this venue if it's an unclaimed admin-created listing */}
        <ClaimEntityBox entityType="venue" entityId={venue.id} claimStatus={venue.claim_status} />

        {/* SPRINT 3: Follow this venue */}
        <FollowPanel entityType="venue" entityId={venue.id} entityName={venue.name} />

        {/* Upcoming Gigs */}
        <div style={{ marginBottom:48 }}>
          <SectionLabel>UPCOMING GIGS</SectionLabel>
          {upcomingGigs.length === 0 ? (
            <div style={{ color:C.dim, fontSize:14 }}>No upcoming gigs listed.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {upcomingGigs.map(g => {
                const color = GENRE_COLORS[g.genre] || "#888";
                return (
                  <div key={g.id} style={{
                    display:"flex", alignItems:"center", gap:16, padding:"14px 18px",
                    background:C.surface, border:`1px solid ${C.border}`,
                    borderLeft:`3px solid ${color}`, borderRadius:8, flexWrap:"wrap",
                  }}>
                    <Link to={`/gig/${g.slug}`} style={{ display:"flex", alignItems:"center", gap:16, flex:1, minWidth:180, textDecoration:"none", color:"inherit" }}>
                      <div style={{ fontFamily:F.display, fontSize:16, color:C.red, letterSpacing:1, minWidth:120 }}>{fmtDate(g.date)}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, color:C.white }}>{g.band_name}</div>
                        <div style={{ fontSize:12, color:C.muted }}>{g.genre} · {g.time}</div>
                      </div>
                    </Link>
                    <div style={{ display:"flex", gap:8 }}>
                      {g.tickets && (
                        <a href={g.tickets} target="_blank" rel="noreferrer"
                          style={{ fontSize:11, fontFamily:F.display, letterSpacing:2, background:C.red, color:"#fff", textDecoration:"none", borderRadius:4, padding:"6px 12px" }}
                        >TICKETS</a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Past Gigs */}
        {pastGigs.length > 0 && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>PAST GIGS</SectionLabel>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {pastGigs.slice(0,10).map(g => (
                <Link key={g.id} to={`/gig/${g.slug}`} style={{ textDecoration:"none", color:"inherit" }}>
                  <div style={{
                    display:"flex", alignItems:"center", gap:16, padding:"10px 18px",
                    background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
                    borderRadius:6, opacity:0.7, flexWrap:"wrap",
                  }}>
                    <div style={{ fontFamily:F.display, fontSize:14, color:C.dim, minWidth:120 }}>{fmtDate(g.date)}</div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontSize:14, color:"#aaa" }}>{g.band_name}</span>
                      <span style={{ fontSize:12, color:C.dim, marginLeft:8 }}>{g.genre}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PUBLIC BAND PROFILE PAGE
// ════════════════════════════════════════════════════════════════════
function BandProfilePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [band, setBand]   = useState(null);
  const [gigs, setGigs]   = useState([]);
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const b = await DB.getBandBySlug(slug);
      if (!b) { setLoading(false); return; }
      setBand(b);

      // SEO metadata, kept in sync with api/og.js's type=band crawler
      // response. Works identically for profile_type 'band' or
      // 'solo_artist' -- never keyed on role. SEO Step 7: an
      // owner/manager-supplied seo_title/seo_description, when present,
      // overrides only these two display strings -- canonical URL and
      // Schema.org (applyJsonLd below) are untouched by either field.
      applyPageMeta({
        title: b.seo_title?.trim() || `${b.band_name} | Music Scene Magazine`,
        description: b.seo_description?.trim() || (b.bio
          ? (b.bio.length > 200 ? b.bio.slice(0, 200) + "…" : b.bio)
          : `${b.band_name}${b.city ? ` from ${b.city}` : ""}. Find upcoming gigs and more on Music Scene Magazine.`),
        canonicalUrl: `${BASE_URL}/artist/${b.band_slug}`,
        image: b.photo_url || FALLBACK_IMAGE,
      });
      applyJsonLd(buildArtistJsonLd(b));
      // Gigs and awards are independent reads once we have the profile id --
      // fetch them in parallel rather than one after the other.
      const [g, aw] = await Promise.all([
        DB.getGigsByBand(b.band_name, b.id),
        DB.getActiveAwards({ profileId: b.id }),
      ]);
      setGigs(g);
      setAwards(aw);
      setLoading(false);
    }
    load();
    return () => { resetPageMeta(); removeJsonLd(); };
  }, [slug]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.muted, fontSize:16, fontFamily:F.display, letterSpacing:2 }}>LOADING...</div>
    </div>
  );

  if (!band) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.white, fontFamily:F.display, fontSize:32, letterSpacing:2 }}>BAND NOT FOUND</div>
      <span onClick={()=>navigate("/")} style={{ color:C.red, cursor:"pointer", fontSize:14 }}>← Back to Calendar</span>
    </div>
  );

  const upcomingGigs = gigs.filter(g => g.date >= today);
  const pastGigs     = gigs.filter(g => g.date <  today).reverse();
  const color        = GENRE_COLORS[band.primary_genre || band.genre] || C.red;

  const socialLinks = [
    { url: band.instagram,        icon: "📷", label: "Instagram" },
    { url: band.facebook,         icon: "👍", label: "Facebook"  },
    { url: band.tiktok_url,       icon: "🎵", label: "TikTok"    },
    { url: band.youtube_channel_url, icon: "▶️", label: "YouTube" },
    { url: band.twitter,          icon: "🐦", label: "X/Twitter" },
  ].filter(s => s.url);

  const musicLinks = [
    { url: band.spotify,          label: "SPOTIFY",     bg:"#1DB954", color:"#fff" },
    { url: band.apple_music_url,  label: "APPLE MUSIC", bg:"#fc3c44", color:"#fff" },
    { url: band.bandcamp_url,     label: "BANDCAMP",    bg:"#1da0c3", color:"#fff" },
    { url: band.soundcloud_url,   label: "SOUNDCLOUD",  bg:"#ff5500", color:"#fff" },
  ].filter(m => m.url);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      {/* Header */}
      <header style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:70 }}>
        <span onClick={()=>navigate("/")} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={()=>navigate("/")} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>
          ← BACK TO CALENDAR
        </span>
      </header>

      {/* Hero */}
      <div style={{
        background:`linear-gradient(180deg, ${color}22 0%, #0d0d0d 100%)`,
        borderBottom:`1px solid ${color}44`,
        padding:"48px 32px 40px",
      }}>
        <div style={{ maxWidth:900, margin:"0 auto", display:"flex", gap:32, alignItems:"flex-start", flexWrap:"wrap" }}>
          {/* Photo */}
          {band.photo_url ? (
            <img src={band.photo_url} alt={band.band_name}
              style={{ width:140, height:140, borderRadius:8, objectFit:"cover", border:`3px solid ${color}`, flexShrink:0 }}
            />
          ) : (
            <div style={{ width:140, height:140, borderRadius:8, background:`${color}22`, border:`3px solid ${color}44`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:48 }}>🎸</span>
            </div>
          )}

          {/* Info */}
          <div style={{ flex:1, minWidth:200 }}>
            {/* Status badge */}
            {band.band_status !== "active" && (
              <div style={{ display:"inline-block", fontSize:10, color:C.amber, border:`1px solid ${C.amber}`, borderRadius:3, padding:"2px 8px", letterSpacing:2, marginBottom:8, fontFamily:F.display }}>
                {band.band_status.toUpperCase().replace("-"," ")}
              </div>
            )}
            <div style={{ fontFamily:F.display, fontSize:42, letterSpacing:2, color:C.white, lineHeight:1, marginBottom:8 }}>
              {band.band_name}
            </div>
            <EditorialAwardStrip awards={awards} style={{ marginBottom:14 }} />
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16, alignItems:"center" }}>
              {band.primary_genre && <Badge label={band.primary_genre} color={color} />}
              {band.secondary_genre && <Badge label={band.secondary_genre} color={C.muted} />}
              {band.tertiary_genre  && <Badge label={band.tertiary_genre}  color={C.dim}   />}
              {band.city && <span style={{ fontSize:13, color:"#cccccc" }}>📍 {band.city}</span>}
              {band.formation_year && <span style={{ fontSize:13, color:"#aaaaaa" }}>Est. {band.formation_year}</span>}
              <ClaimStatusBadge claimStatus={band.claim_status} entityType={band.profile_type || "band"} />
            </div>

            {/* Social icons */}
            {socialLinks.length > 0 && (
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
                {socialLinks.map(s => (
                  <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                    style={{ fontSize:11, color:C.muted, textDecoration:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 10px", display:"flex", alignItems:"center", gap:5 }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=color}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
                  >
                    {s.icon} {s.label}
                  </a>
                ))}
              </div>
            )}

            {/* Music + Website buttons */}
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              {musicLinks.map(m => (
                <a key={m.label} href={m.url} target="_blank" rel="noreferrer"
                  style={{ fontSize:12, fontFamily:F.display, letterSpacing:2, background:m.bg, color:m.color, textDecoration:"none", borderRadius:5, padding:"8px 16px" }}
                >
                  {m.label}
                </a>
              ))}
              {band.website && (
                <a href={band.website} target="_blank" rel="noreferrer"
                  style={{ fontSize:12, fontFamily:F.display, letterSpacing:2, background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, padding:"8px 16px", border:`1px solid ${C.border}` }}
                >
                  WEBSITE
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 32px" }}>

        {/* Bio */}
        {band.bio && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>ABOUT</SectionLabel>
            <div style={{ fontSize:16, color:"#dddddd", lineHeight:1.8, maxWidth:700 }}>{band.bio}</div>
          </div>
        )}

        {/* MSM Coverage -- Editorial Awards (Stage 4) */}
        <MSMCoverageSection awards={awards} subjectLabel={band.band_name} />

        {/* PHASE 4: claim this listing if it's an unclaimed admin-created profile */}
        <ClaimEntityBox entityType={band.profile_type || "band"} entityId={band.id} claimStatus={band.claim_status} />

        {/* Contact */}
        {(band.booking_email || band.management_contact || band.press_contact) && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>CONTACT</SectionLabel>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px,1fr))", gap:16 }}>
              {band.booking_email && (
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16 }}>
                  <div style={{ fontSize:11, color:"#aaaaaa", letterSpacing:2, marginBottom:8, fontFamily:F.display }}>BOOKING</div>
                  <a href={`mailto:${band.booking_email}`} style={{
                    display:"inline-block", padding:"8px 16px",
                    background:C.red, color:"#fff", textDecoration:"none",
                    borderRadius:5, fontSize:12, fontFamily:F.display, letterSpacing:2,
                  }}>CONTACT BAND</a>
                </div>
              )}
              {band.management_contact && (
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16 }}>
                  <div style={{ fontSize:11, color:"#aaaaaa", letterSpacing:2, marginBottom:8, fontFamily:F.display }}>MANAGEMENT</div>
                  {band.management_contact.includes("@")
                    ? <a href={`mailto:${band.management_contact}`} style={{ display:"inline-block", padding:"8px 16px", background:C.red, color:"#fff", textDecoration:"none", borderRadius:5, fontSize:12, fontFamily:F.display, letterSpacing:2 }}>CONTACT MANAGEMENT</a>
                    : <div style={{ color:"#ffffff", fontSize:15, fontWeight:500 }}>{band.management_contact}</div>
                  }
                </div>
              )}
              {band.press_contact && (
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:16 }}>
                  <div style={{ fontSize:11, color:"#aaaaaa", letterSpacing:2, marginBottom:8, fontFamily:F.display }}>PRESS</div>
                  {band.press_contact.includes("@")
                    ? <a href={`mailto:${band.press_contact}`} style={{ display:"inline-block", padding:"8px 16px", background:C.red, color:"#fff", textDecoration:"none", borderRadius:5, fontSize:12, fontFamily:F.display, letterSpacing:2 }}>PRESS ENQUIRIES</a>
                    : <div style={{ color:"#ffffff", fontSize:15, fontWeight:500 }}>{band.press_contact}</div>
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {/* Upcoming Gigs */}
        <div style={{ marginBottom:48 }}>
          <SectionLabel>UPCOMING GIGS</SectionLabel>
          {upcomingGigs.length === 0 ? (
            <div style={{ color:C.dim, fontSize:14 }}>No upcoming gigs listed.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {upcomingGigs.map(g => (
                <div key={g.id} style={{
                  display:"flex", alignItems:"center", gap:16, padding:"14px 18px",
                  background:C.surface, border:`1px solid ${C.border}`,
                  borderLeft:`3px solid ${color}`, borderRadius:8,
                  flexWrap:"wrap",
                }}>
                  <Link to={`/gig/${g.slug}`} style={{ display:"flex", alignItems:"center", gap:16, flex:1, minWidth:180, textDecoration:"none", color:"inherit" }}>
                    <div style={{ fontFamily:F.display, fontSize:16, color:C.red, letterSpacing:1, minWidth:120 }}>{fmtDate(g.date)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:15, color:"#ffffff" }}>{g.venue}</div>
                      <div style={{ fontSize:13, color:"#aaaaaa" }}>{g.city}</div>
                    </div>
                  </Link>
                  <div style={{ display:"flex", gap:8 }}>
                    {g.tickets && (
                      <a href={g.tickets} target="_blank" rel="noreferrer"
                        style={{ fontSize:11, fontFamily:F.display, letterSpacing:2, background:C.red, color:"#fff", textDecoration:"none", borderRadius:4, padding:"6px 12px" }}
                      >TICKETS</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Past Gigs */}
        {pastGigs.length > 0 && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>PAST GIGS</SectionLabel>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {pastGigs.slice(0,10).map(g => (
                <Link key={g.id} to={`/gig/${g.slug}`} style={{ textDecoration:"none", color:"inherit" }}>
                  <div style={{
                    display:"flex", alignItems:"center", gap:16, padding:"10px 18px",
                    background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
                    borderRadius:6, opacity:0.7, flexWrap:"wrap",
                  }}>
                    <div style={{ fontFamily:F.display, fontSize:14, color:C.dim, minWidth:120 }}>{fmtDate(g.date)}</div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontSize:14, color:"#aaa" }}>{g.venue}</span>
                      <span style={{ fontSize:12, color:C.dim, marginLeft:8 }}>{g.city}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Fan Features Phase 1: Follow this band */}
        <FollowBandPanel bandProfileId={band.id} bandName={band.band_name} entityType={band.profile_type || "band"} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 4: PUBLIC FESTIVAL PROFILE PAGE
// ════════════════════════════════════════════════════════════════════
// Deliberately minimal -- name/city/bio/photo/socials + claim box. Festivals
// and promoters live in the same `profiles` table as bands (profile_type
// discriminates), so this reuses the existing, untouched DB.getBandBySlug.
function FestivalProfilePage() {
  const { slug }    = useParams();
  const navigate    = useNavigate();
  const [entity,    setEntity]  = useState(null);
  const [awards,    setAwards]  = useState([]);
  const [lineup,    setLineup]  = useState([]);
  const [loading,   setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const b = await DB.getBandBySlug(slug);
      const e = b && b.profile_type === "festival" ? b : null;
      setEntity(e);
      if (e) {
        const [aw, lu] = await Promise.all([
          DB.getActiveAwards({ profileId: e.id }),
          DB.getGigsByFestival(e.id),
        ]);
        setAwards(aw);
        setLineup(lu);

        // SEO metadata, kept in sync with api/og.js's type=festival
        // crawler response, including the same date-range formatting.
        const dateRange = e.festival_start_date
          ? (e.festival_end_date && e.festival_end_date !== e.festival_start_date
              ? `${fmtDate(e.festival_start_date)} – ${fmtDate(e.festival_end_date)}`
              : fmtDate(e.festival_start_date))
          : "";
        const locationBits = [e.city, e.postcode].filter(Boolean).join(", ");
        applyPageMeta({
          title: e.seo_title?.trim() || (dateRange ? `${e.band_name} | ${dateRange} | Music Scene Magazine` : `${e.band_name} | Music Scene Magazine`),
          description: e.seo_description?.trim() || (e.bio
            ? (e.bio.length > 200 ? e.bio.slice(0, 200) + "…" : e.bio)
            : `${e.band_name}${dateRange ? `, ${dateRange}` : ""}${locationBits ? ` at ${locationBits}` : ""}. Find festival details and line-up on Music Scene Magazine.`),
          canonicalUrl: `${BASE_URL}/festival/${e.band_slug}`,
          image: e.photo_url || FALLBACK_IMAGE,
        });
        applyJsonLd(buildFestivalJsonLd(e));
      } else {
        setAwards([]);
        setLineup([]);
      }
      setLoading(false);
    }
    load();
    return () => { resetPageMeta(); removeJsonLd(); };
  }, [slug]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.muted, fontSize:16, fontFamily:F.display, letterSpacing:2 }}>LOADING...</div>
    </div>
  );

  if (!entity) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.white, fontFamily:F.display, fontSize:32, letterSpacing:2 }}>FESTIVAL NOT FOUND</div>
      <span onClick={()=>navigate("/")} style={{ color:C.red, cursor:"pointer", fontSize:14 }}>← Back to Calendar</span>
    </div>
  );

  const color = "#9b5de5";
  const socialLinks = [
    { url: entity.instagram, icon:"📷", label:"Instagram" },
    { url: entity.facebook,  icon:"👍", label:"Facebook"  },
    { url: entity.twitter,   icon:"🐦", label:"X/Twitter" },
  ].filter(s => s.url);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:70 }}>
        <span onClick={()=>navigate("/")} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={()=>navigate("/")} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>
          ← BACK TO CALENDAR
        </span>
      </header>

      <div style={{
        background: entity.photo_url
          ? `linear-gradient(180deg, rgba(0,0,0,0.6) 0%, #0d0d0d 100%), url(${entity.photo_url}) center/cover`
          : `linear-gradient(180deg, ${color}22 0%, #0d0d0d 100%)`,
        borderBottom:`1px solid ${color}44`,
        padding:"48px 32px 40px",
      }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:3, fontFamily:F.display, marginBottom:8 }}>FESTIVAL</div>
          <div style={{ fontFamily:F.display, fontSize:48, letterSpacing:2, color:C.white, lineHeight:1, marginBottom:10 }}>
            {entity.band_name}
          </div>
          <EditorialAwardStrip awards={awards} style={{ marginBottom:14 }} />
          <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap", marginBottom:20 }}>
            {(entity.festival_start_date || entity.festival_end_date) && (
              <span style={{ fontSize:15, color:"#cccccc" }}>
                📅 {fmtDate(entity.festival_start_date)}{entity.festival_end_date && entity.festival_end_date !== entity.festival_start_date ? ` – ${fmtDate(entity.festival_end_date)}` : ""}
              </span>
            )}
            {entity.city && <span style={{ fontSize:15, color:"#cccccc" }}>📍 {entity.city}{entity.postcode ? `, ${entity.postcode}` : ""}</span>}
            {entity.what3words && (
              <span style={{ fontSize:13, color:C.muted }}>///{entity.what3words.replace(/^\/+/, "")}</span>
            )}
            <ClaimStatusBadge claimStatus={entity.claim_status} entityType="festival" />
          </div>
          {socialLinks.length > 0 && (
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {socialLinks.map(s => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:C.muted, textDecoration:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 10px", display:"flex", alignItems:"center", gap:5 }}
                >{s.icon} {s.label}</a>
              ))}
            </div>
          )}
          {entity.website && (
            <a href={entity.website} target="_blank" rel="noreferrer"
              style={{ fontSize:12, fontFamily:F.display, letterSpacing:2, background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, padding:"8px 16px", border:`1px solid ${C.border}`, display:"inline-block" }}
            >VISIT WEBSITE</a>
          )}
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 32px" }}>
        {entity.bio && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>ABOUT</SectionLabel>
            <div style={{ fontSize:16, color:"#dddddd", lineHeight:1.8, maxWidth:700 }}>{entity.bio}</div>
          </div>
        )}

        {/* Lineup / Performances -- gigs linked via festival_profile_id */}
        {lineup.length > 0 && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>LINEUP</SectionLabel>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {lineup.map(g => (
                <Link key={g.id} to={`/gig/${g.slug}`}
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10,
                    padding:"14px 16px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8,
                    textDecoration:"none", color:"inherit", cursor: g.slug ? "pointer" : "default",
                  }}
                >
                  <div>
                    <div style={{ fontSize:16, color:C.white, fontWeight:600 }}>{g.band_name}</div>
                    <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>{g.venue}{g.city ? `, ${g.city}` : ""}</div>
                  </div>
                  <div style={{ fontSize:13, color:color, fontFamily:F.display, letterSpacing:1 }}>
                    {fmtDate(g.date)}{g.time ? ` · ${g.time}` : ""}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* MSM Coverage -- Editorial Awards (Stage 4) */}
        <MSMCoverageSection awards={awards} subjectLabel={entity.band_name} />

        <ClaimEntityBox entityType="festival" entityId={entity.id} claimStatus={entity.claim_status} />

        {/* SPRINT 3: Follow this festival */}
        <FollowPanel entityType="festival" entityId={entity.id} entityName={entity.band_name} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 4: PUBLIC PROMOTER PROFILE PAGE
// ════════════════════════════════════════════════════════════════════
function PromoterProfilePage() {
  const { slug }    = useParams();
  const navigate    = useNavigate();
  const [entity,    setEntity]  = useState(null);
  const [awards,    setAwards]  = useState([]);
  const [loading,   setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const b = await DB.getBandBySlug(slug);
      const e = b && b.profile_type === "promoter" ? b : null;
      setEntity(e);
      setAwards(e ? await DB.getActiveAwards({ profileId: e.id }) : []);
      setLoading(false);
    }
    load();
  }, [slug]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.muted, fontSize:16, fontFamily:F.display, letterSpacing:2 }}>LOADING...</div>
    </div>
  );

  if (!entity) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ color:C.white, fontFamily:F.display, fontSize:32, letterSpacing:2 }}>PROMOTER NOT FOUND</div>
      <span onClick={()=>navigate("/")} style={{ color:C.red, cursor:"pointer", fontSize:14 }}>← Back to Calendar</span>
    </div>
  );

  const color = "#2a9d8f";
  const socialLinks = [
    { url: entity.instagram, icon:"📷", label:"Instagram" },
    { url: entity.facebook,  icon:"👍", label:"Facebook"  },
    { url: entity.twitter,   icon:"🐦", label:"X/Twitter" },
  ].filter(s => s.url);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:70 }}>
        <span onClick={()=>navigate("/")} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={()=>navigate("/")} style={{ fontSize:12, color:C.muted, cursor:"pointer", letterSpacing:1 }}>
          ← BACK TO CALENDAR
        </span>
      </header>

      <div style={{
        background: entity.photo_url
          ? `linear-gradient(180deg, rgba(0,0,0,0.6) 0%, #0d0d0d 100%), url(${entity.photo_url}) center/cover`
          : `linear-gradient(180deg, ${color}22 0%, #0d0d0d 100%)`,
        borderBottom:`1px solid ${color}44`,
        padding:"48px 32px 40px",
      }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:3, fontFamily:F.display, marginBottom:8 }}>PROMOTER</div>
          <div style={{ fontFamily:F.display, fontSize:48, letterSpacing:2, color:C.white, lineHeight:1, marginBottom:10 }}>
            {entity.band_name}
          </div>
          <EditorialAwardStrip awards={awards} style={{ marginBottom:14 }} />
          <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap", marginBottom:20 }}>
            {entity.city && <span style={{ fontSize:15, color:"#cccccc" }}>📍 {entity.city}</span>}
            <ClaimStatusBadge claimStatus={entity.claim_status} entityType="promoter" />
          </div>
          {socialLinks.length > 0 && (
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {socialLinks.map(s => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:C.muted, textDecoration:"none", border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 10px", display:"flex", alignItems:"center", gap:5 }}
                >{s.icon} {s.label}</a>
              ))}
            </div>
          )}
          {entity.website && (
            <a href={entity.website} target="_blank" rel="noreferrer"
              style={{ fontSize:12, fontFamily:F.display, letterSpacing:2, background:"rgba(255,255,255,0.08)", color:C.white, textDecoration:"none", borderRadius:5, padding:"8px 16px", border:`1px solid ${C.border}`, display:"inline-block" }}
            >VISIT WEBSITE</a>
          )}
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"40px 32px" }}>
        {entity.bio && (
          <div style={{ marginBottom:48 }}>
            <SectionLabel>ABOUT</SectionLabel>
            <div style={{ fontSize:16, color:"#dddddd", lineHeight:1.8, maxWidth:700 }}>{entity.bio}</div>
          </div>
        )}
        {/* MSM Coverage -- Editorial Awards (Stage 4) */}
        <MSMCoverageSection awards={awards} subjectLabel={entity.band_name} />

        <ClaimEntityBox entityType="promoter" entityId={entity.id} claimStatus={entity.claim_status} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  BULK GIG IMPORT
// ════════════════════════════════════════════════════════════════════

// ── Date parser ──────────────────────────────────────────────────
const MONTH_NAMES = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
  january:0, february:1, march:2, april:3, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11,
};
const DAY_NAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function resolveYear(day, month, explicitYear) {
  if (explicitYear) return explicitYear;
  const now   = new Date();
  const thisY = now.getFullYear();
  const test  = new Date(thisY, month, day);
  // If date is today or future → current year, else next year
  test.setHours(0,0,0,0);
  now.setHours(0,0,0,0);
  return test >= now ? thisY : thisY + 1;
}

function parseDate(str, contextYear) {
  str = str.trim().toLowerCase().replace(/[,]/g,"").replace(/(\d+)(st|nd|rd|th)/g,"$1");
  
  // Try DD/MM/YYYY or DD-MM-YYYY
  let m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return { day:+m[1], month:+m[2]-1, year:+m[3] };

  // Try YYYY-MM-DD
  m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { day:+m[3], month:+m[2]-1, year:+m[1] };

  // Try "6 june 2026" or "june 6 2026"
  m = str.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (m && MONTH_NAMES[m[2]] !== undefined)
    return { day:+m[1], month:MONTH_NAMES[m[2]], year:+m[3] };
  m = str.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m && MONTH_NAMES[m[1]] !== undefined)
    return { day:+m[2], month:MONTH_NAMES[m[1]], year:+m[3] };

  // Try "6 june" or "june 6" (no year)
  m = str.match(/(\d{1,2})\s+([a-z]+)/);
  if (m && MONTH_NAMES[m[2]] !== undefined) {
    const day=+m[1], month=MONTH_NAMES[m[2]];
    return { day, month, year: resolveYear(day, month, contextYear) };
  }
  m = str.match(/([a-z]+)\s+(\d{1,2})/);
  if (m && MONTH_NAMES[m[1]] !== undefined) {
    const day=+m[2], month=MONTH_NAMES[m[1]];
    return { day, month, year: resolveYear(day, month, contextYear) };
  }

  // Try day name only e.g. "saturday"
  const dayIdx = DAY_NAMES.indexOf(str.split(/\s+/)[0]);
  if (dayIdx !== -1) {
    const now  = new Date(); now.setHours(0,0,0,0);
    const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
    const d    = new Date(now); d.setDate(d.getDate() + diff);
    const year = contextYear || d.getFullYear();
    return { day:d.getDate(), month:d.getMonth(), year };
  }

  return null;
}

function formatDateISO(d) {
  return `${d.year}-${String(d.month+1).padStart(2,"0")}-${String(d.day).padStart(2,"0")}`;
}

function formatDateDisplay(d) {
  return `${String(d.day).padStart(2,"0")} ${MONTHS[d.month]} ${d.year}`;
}

// Detect section heading that sets context year
// e.g. "June 2026", "July 2026 Dates"
function detectContextYear(line) {
  const l = line.toLowerCase();
  for (const [name, idx] of Object.entries(MONTH_NAMES)) {
    const m = l.match(new RegExp(name + "\\s+(\\d{4})"));
    if (m) return +m[1];
  }
  // Also match standalone year like "2026 Dates"
  const m = l.match(/\b(20\d{2})\b/);
  if (m) return +m[1];
  return null;
}

// Parse a single gig line
// Format: [date part] - [venue], [city]
//      or [date part] | [venue] | [city]
function parseLine(line, contextYear) {
  line = line.trim();
  if (!line) return null;

  // ── Step 1: Extract time if present anywhere in the line ──
  // Matches: 8:30pm, 8:30 pm, 20:30, 8pm, 8 pm
  let extractedTime = "";
  const timeRegex = /\b(\d{1,2}):(\d{2})\s*([ap]m)?\b|\b(\d{1,2})\s*([ap]m)\b/gi;
  const timeMatches = [...line.matchAll(timeRegex)];
  if (timeMatches.length > 0) {
    const tm = timeMatches[timeMatches.length - 1]; // use last time found
    const raw = tm[0];
    let h, m = "00";
    if (tm[1]) { h = +tm[1]; m = tm[2]; const ampm = tm[3]?.toLowerCase(); if (ampm==="pm" && h<12) h+=12; if (ampm==="am" && h===12) h=0; }
    else        { h = +tm[4]; const ampm = tm[5]?.toLowerCase(); if (ampm==="pm" && h<12) h+=12; if (ampm==="am" && h===12) h=0; }
    extractedTime = `${String(h).padStart(2,"0")}:${m}`;
    // Remove time from line for further parsing
    line = line.replace(raw, "").replace(/\s*-\s*$/, "").trim();
  }

  // ── Step 2: Split date from venue/city ──
  // The date part is everything up to the first separator AFTER the date tokens
  // Strategy: find where date tokens end, then look for - or |
  
  // First try splitting on " - " or " | " (with spaces)
  const sepMatch = line.match(/^(.+?)\s+[-–|]\s+(.+)$/);
  if (!sepMatch) {
    // Try just a dash/pipe
    const simpleSep = line.match(/^(.+?)[-–|](.+)$/);
    if (!simpleSep) return { raw:line, status:"needs_attention", reason:"Can't find separator" };
    var datePart  = simpleSep[1].trim();
    var remainder = simpleSep[2].trim();
  } else {
    var datePart  = sepMatch[1].trim();
    var remainder = sepMatch[2].trim();
  }

  // ── Step 3: Parse the date part ──
  const parsed = parseDate(datePart, contextYear);

  // ── Step 4: Extract venue and city from remainder ──
  // remainder may still contain a trailing time or description after another " - "
  // e.g. "The Cabin, Elmer - special night" → venue=The Cabin, city=Elmer, desc=special night
  let venueCity = remainder;
  let description = "";

  // Check if remainder has another separator (after venue/city)
  const descSep = remainder.match(/^(.+?,\s*.+?)\s*[-–]\s*(.+)$/);
  if (descSep) {
    venueCity   = descSep[1].trim();
    description = descSep[2].trim();
  }

  // Split venue + city on last comma
  const lastComma = venueCity.lastIndexOf(",");
  let venue = venueCity, city = "";
  if (lastComma !== -1) {
    venue = venueCity.slice(0, lastComma).trim();
    city  = venueCity.slice(lastComma + 1).trim();
  }

  // Clean up city — remove any trailing time/description fragments
  city = city.replace(timeRegex, "").trim();

  // ── Step 5: Validate ──
  const issues = [];
  if (!parsed) issues.push("Date unclear");
  if (!venue)  issues.push("No venue");
  if (!city)   issues.push("No city");

  return {
    raw:         line,
    date:        parsed ? formatDateISO(parsed)     : "",
    dateDsp:     parsed ? formatDateDisplay(parsed) : datePart,
    venue,
    city,
    time:        extractedTime, // will override default if found
    description,
    status:      issues.length === 0 ? "valid" : "needs_attention",
    reason:      issues.join(", "),
  };
}

function parseGigText(text, contextYearOverride) {
  const lines   = text.split("\n").map(l=>l.trim()).filter(Boolean);
  const results = [];
  let contextYear = contextYearOverride || null;

  for (const line of lines) {
    // Check if line is a section heading setting year context
    const detectedYear = detectContextYear(line);
    if (detectedYear) {
      // Only treat as heading if line has no separator (not a gig line)
      if (!line.match(/[-|]/)) {
        contextYear = detectedYear;
        continue;
      } else {
        // It's a gig line that happens to contain a year — use detected year
        contextYear = detectedYear;
      }
    }

    const result = parseLine(line, contextYear);
    if (result) results.push(result);
  }
  return results;
}

// ── BulkImport Component ─────────────────────────────────────────
function BulkImport({ bands, onImported }) {
  const [selectedBand, setSelectedBand] = useState("");
  const [defaultTime,  setDefaultTime]  = useState("20:00");
  const [text,         setText]         = useState("");
  const [rows,         setRows]         = useState(null); // null = not yet parsed
  const [importing,    setImporting]    = useState(false);
  const [result,       setResult]       = useState(null);

  const bandOptions = bands.filter(b => b.band_name).sort((a,b)=>a.band_name.localeCompare(b.band_name));
  const selectedBandObj = bandOptions.find(b => b.id === selectedBand);

  const bandGenre = selectedBandObj?.primary_genre || "";

  const handlePreview = () => {
    if (!text.trim()) return;
    // Warn if band has no genre set
    if (!bandGenre) {
      // Don't block — just let the user see the warning in the UI
    }
    const parsed = parseGigText(text);
    setRows(parsed.map((r, i) => ({
      ...r,
      id:          i,
      time:        r.time || defaultTime,
      // Use band profile genre if available, otherwise leave blank to force selection
      genre:       bandGenre || "",
      description: r.description || "",
      editing:     false,
    })));
    setResult(null);
  };

  const updateRow = (id, field, value) => {
    setRows(rows => rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeRow = (id) => {
    setRows(rows => rows.filter(r => r.id !== id));
  };

  const validRows   = rows?.filter(r => r.status === "valid"          ) || [];
  const warningRows = rows?.filter(r => r.status === "needs_attention") || [];

  const handleImport = async () => {
    if (!selectedBand) { alert("Please select a band first"); return; }
    const toImport = rows.filter(r => r.date && r.venue);
    if (!toImport.length) { alert("No valid gigs to import"); return; }

    // Block if any gig has no genre
    const missingGenre = toImport.filter(r => !r.genre);
    if (missingGenre.length > 0) {
      setResult({
        success: 0, errors: missingGenre.length,
        firstError: `Genre required for all gigs before import. ${missingGenre.length} gig${missingGenre.length!==1?"s":""} missing genre.`
      });
      return;
    }

    setImporting(true);
    let successCount = 0, errorCount = 0;

    const userId = (await supabase.auth.getUser()).data.user?.id;
    const errors_list = [];

    for (const row of toImport) {
      try {
        // Generate slug
        let slugData = null;
        try {
          const { data: sd } = await supabase.rpc("generate_gig_slug", {
            band:     selectedBandObj?.band_name || "unknown",
            venue:    row.venue,
            gig_date: row.date,
          });
          slugData = sd;
        } catch(slugErr) { console.warn("Slug generation failed:", slugErr); }

        const { error } = await supabase.from("gigs").insert({
          band_name:       selectedBandObj?.band_name || "",
          venue:           row.venue,
          city:            row.city,
          date:            row.date,
          time:            row.time || "20:00",
          genre:           row.genre || bandGenre || null,
          status:          "approved",
          submitted_by:    userId,
          slug:            slugData || null,
          notes:           row.description || "",
          tickets:         "",
          band_profile_id: selectedBand || null,
        });

        if (error) {
          console.error("Import error:", error.message, row);
          errors_list.push(error.message);
          errorCount++;
        } else successCount++;
      } catch(e) {
        console.error("Import exception:", e.message, row);
        errors_list.push(e.message);
        errorCount++;
      }
    }

    setImporting(false);
    setResult({
      success: successCount,
      errors:  errorCount,
      firstError: errors_list[0] || null,
    });
    if (successCount > 0) {
      if (onImported) onImported();
      setRows(null);
      setText("");
    }
  };

  return (
    <div>
      <SectionLabel>BULK GIG IMPORT</SectionLabel>
      <div style={{ fontSize:13, color:C.muted, marginBottom:24, maxWidth:700 }}>
        Paste a band's gig list from their website. The tool will parse dates, venues and cities automatically.
        All imported gigs are auto-approved and appear immediately on the calendar and artist profile.
      </div>

      {/* Setup */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:24, marginBottom:20 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
          <div>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SELECT BAND *</label>
            <select value={selectedBand} onChange={e=>setSelectedBand(e.target.value)} style={{ ...inputCss, cursor:"pointer" }}>
              <option value="">— Choose a band —</option>
              {bandOptions.map(b => <option key={b.id} value={b.id}>{b.band_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>DEFAULT DOORS TIME</label>
            <input type="time" value={defaultTime} onChange={e=>setDefaultTime(e.target.value)} style={inputCss} />
          </div>
        </div>

        {selectedBandObj && (
          <div style={{ padding:"10px 14px", background:"rgba(232,32,58,0.06)", borderRadius:6, fontSize:12, color:C.muted, marginBottom:16 }}>
            🎸 <span style={{ color:C.white }}>{selectedBandObj.band_name}</span>
            {bandGenre
              ? <> · <span style={{ color:GENRE_COLORS[bandGenre]||C.red }}>{bandGenre}</span> <span style={{ color:C.green, fontSize:10 }}>✓ will be applied to all imported gigs</span></>
              : <> · <span style={{ color:C.amber }}>⚠ No genre set on profile — you will need to set genre manually for each gig</span></>
            }
            {selectedBandObj.city && <> · 📍 {selectedBandObj.city}</>}
          </div>
        )}

        <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>PASTE GIG LIST</label>
        <textarea
          value={text}
          onChange={e=>{ setText(e.target.value); setRows(null); }}
          rows={10}
          placeholder={`Paste gig dates here. Examples:\n\nSaturday 6th June - The Obelisk, Woolston\nSaturday 13th June - Hothampton Arms, Bognor\nFriday 26th June - The Heroes, Waterlooville\n\nOr with year:\nJuly 2026\nSat 5th - The Brook, Southampton\nFri 11th - The Joiners, Southampton`}
          style={{ ...inputCss, resize:"vertical", fontFamily:"monospace", fontSize:13 }}
        />

        <Btn onClick={handlePreview} disabled={!text.trim() || !selectedBand} style={{ marginTop:14, padding:"12px 32px" }}>
          PREVIEW IMPORT →
        </Btn>
      </div>

      {/* Preview */}
      {rows && rows.length > 0 && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:24 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ fontFamily:F.display, fontSize:18, color:C.white, letterSpacing:2 }}>PREVIEW — {rows.length} GIGS FOUND</div>
              <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
                <span style={{ color:C.green }}>✓ {validRows.length} valid</span>
                {warningRows.length > 0 && <span style={{ color:C.amber, marginLeft:12 }}>⚠ {warningRows.length} need attention</span>}
              </div>
            </div>
            <Btn variant="ghost" onClick={()=>setRows(null)}>← EDIT TEXT</Btn>
          </div>

          {/* Table */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                  {["","DATE","VENUE","CITY","TIME","GENRE","NOTES",""].map((h,i) => (
                    <th key={i} style={{ padding:"8px 10px", textAlign:"left", fontSize:10, color:C.muted, letterSpacing:2, fontFamily:F.display, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} style={{ borderBottom:`1px solid rgba(255,255,255,0.04)`, background: row.status==="needs_attention" ? "rgba(244,162,97,0.05)" : "transparent" }}>
                    {/* Status */}
                    <td style={{ padding:"8px 10px", width:30 }}>
                      <span title={row.reason||"Valid"}>
                        {row.status==="valid" ? "✅" : "⚠️"}
                      </span>
                    </td>
                    {/* Date */}
                    <td style={{ padding:"8px 4px", minWidth:130 }}>
                      <input
                        type="date"
                        value={row.date}
                        onChange={e=>updateRow(row.id,"date",e.target.value)}
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12 }}
                      />
                    </td>
                    {/* Venue */}
                    <td style={{ padding:"8px 4px", minWidth:160 }}>
                      <input
                        value={row.venue}
                        onChange={e=>updateRow(row.id,"venue",e.target.value)}
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12 }}
                      />
                    </td>
                    {/* City */}
                    <td style={{ padding:"8px 4px", minWidth:120 }}>
                      <input
                        value={row.city}
                        onChange={e=>updateRow(row.id,"city",e.target.value)}
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12 }}
                      />
                    </td>
                    {/* Time */}
                    <td style={{ padding:"8px 4px", minWidth:90 }}>
                      <input
                        type="time"
                        value={row.time}
                        onChange={e=>updateRow(row.id,"time",e.target.value)}
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12 }}
                      />
                    </td>
                    {/* Genre */}
                    <td style={{ padding:"8px 4px", minWidth:130 }}>
                      <select
                        value={row.genre}
                        onChange={e=>updateRow(row.id,"genre",e.target.value)}
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12, cursor:"pointer" }}
                      >
                        {GENRES.map(g=><option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    {/* Description / Notes */}
                    <td style={{ padding:"8px 4px", minWidth:160 }}>
                      <input
                        value={row.description||""}
                        onChange={e=>updateRow(row.id,"description",e.target.value)}
                        placeholder="Notes..."
                        style={{ ...inputCss, padding:"4px 8px", fontSize:12 }}
                      />
                    </td>
                    {/* Remove */}
                    <td style={{ padding:"8px 4px" }}>
                      <button
                        onClick={()=>removeRow(row.id)}
                        style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:16, padding:"0 4px" }}
                        title="Remove this row"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {warningRows.length > 0 && (
            <div style={{ marginTop:16, padding:12, background:"rgba(244,162,97,0.08)", border:`1px solid ${C.amber}`, borderRadius:6, fontSize:12, color:C.amber }}>
              ⚠️ Rows marked with a warning have missing or unclear data. Please edit them before importing, or remove them.
            </div>
          )}

          {rows && rows.some(r => !r.genre) && (
            <div style={{ marginTop:12, padding:12, background:"rgba(232,32,58,0.08)", border:`1px solid ${C.red}`, borderRadius:6, fontSize:12, color:C.red }}>
              ⚠️ Some gigs have no genre set. Please select a genre for each row before importing.
            </div>
          )}

          <div style={{ marginTop:20, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            <Btn
              onClick={handleImport}
              disabled={importing || rows.filter(r=>r.date&&r.venue).length===0}
              style={{ padding:"13px 32px" }}
            >
              {importing ? "IMPORTING..." : `IMPORT ${rows.filter(r=>r.date&&r.venue).length} GIGS →`}
            </Btn>
            <div style={{ fontSize:12, color:C.dim }}>
              All gigs will be auto-approved and linked to {selectedBandObj?.band_name}
            </div>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div style={{ padding:20, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.amber, fontSize:14 }}>
          ⚠️ No gigs could be parsed from the text. Check the format and try again.
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop:16, padding:16, background: result.errors===0 ? "rgba(67,170,139,0.1)" : "rgba(244,162,97,0.1)", border:`1px solid ${result.errors===0 ? C.green : C.amber}`, borderRadius:8 }}>
          {result.success > 0 && <div style={{ color:C.green, fontSize:14 }}>✓ {result.success} gig{result.success!==1?"s":""} imported successfully!</div>}
          {result.errors  > 0 && <div style={{ color:C.amber, fontSize:14, marginTop:4 }}>⚠ {result.errors} gig{result.errors!==1?"s":""} failed to import.</div>}
          {result.firstError && <div style={{ color:C.red, fontSize:12, marginTop:8, fontFamily:"monospace" }}>{result.firstError}</div>}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 4: ADMIN CLAIM & NEW-ENTITY REQUEST REVIEW
// ════════════════════════════════════════════════════════════════════
function AdminClaims({ claims, onRefresh }) {
  const [filter, setFilter] = useState("pending");
  const [notes, setNotes]   = useState({}); // claim id -> review notes text
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg]       = useState({ text:"", type:"" });

  const showMsg = (text, type="success") => {
    setMsg({ text, type });
    setTimeout(()=>setMsg({ text:"", type:"" }), 4000);
  };

  const counts = {
    all:      claims.length,
    pending:  claims.filter(c=>c.status==="pending").length,
    approved: claims.filter(c=>c.status==="approved").length,
    rejected: claims.filter(c=>c.status==="rejected").length,
  };
  const filtered = claims.filter(c => filter==="all" ? true : c.status===filter);

  // BUGFIX (post-Phase-4): approve_new_entity_request() has a live defect --
  // it sets entity_id on the claim_requests row without clearing
  // proposed_name/proposed_city, which violates the table's
  // claim_requests_entity_or_proposed_chk check constraint and aborts the
  // whole approval. approve_claim_request() has since been extended to
  // fully handle the entity_id-IS-NULL case (venue/festival/promoter)
  // internally, and its own final UPDATE never touches entity_id, so it
  // never hits that constraint. Routing every approval through it avoids
  // the bug entirely with no database change required.
  const approve = async (c) => {
    setBusyId(c.id);
    try {
      await DB.approveClaimRequest(c.id, notes[c.id] || "");
      showMsg("✓ Approved");
      if (onRefresh) await onRefresh();
    } catch(e) { showMsg(e.message, "error"); }
    setBusyId(null);
  };

  const reject = async (c) => {
    setBusyId(c.id);
    try {
      await DB.rejectClaimRequest(c.id, notes[c.id] || "");
      showMsg("✓ Rejected");
      if (onRefresh) await onRefresh();
    } catch(e) { showMsg(e.message, "error"); }
    setBusyId(null);
  };

  const statusBadge = (status) => {
    const map = { approved:[C.green,"APPROVED"], pending:[C.amber,"PENDING"], rejected:[C.red,"REJECTED"] };
    const [color,label] = map[status] || [C.muted, (status||"UNKNOWN").toUpperCase()];
    return <Badge label={label} color={color} />;
  };

  return (
    <div>
      <SectionLabel>CLAIM &amp; REGISTRATION REQUESTS</SectionLabel>
      {msg.text && <div style={{ marginBottom:12, color: msg.type==="error" ? C.red : C.green, fontSize:13 }}>{msg.text}</div>}

      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {[["all","ALL"],["pending","PENDING"],["approved","APPROVED"],["rejected","REJECTED"]].map(([k,l]) => (
          <button key={k} onClick={()=>setFilter(k)} style={{
            padding:"7px 14px", border:"none", borderRadius:5, cursor:"pointer",
            fontFamily:F.display, letterSpacing:1, fontSize:12,
            background: filter===k ? C.red : "rgba(255,255,255,0.05)",
            color: filter===k ? "#fff" : C.muted,
          }}>{l} ({counts[k]})</button>
        ))}
      </div>

      {filtered.length===0 ? (
        <div style={{ color:C.dim, fontSize:14 }}>No requests in this category.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {filtered.map(c => {
            // Small local helper: keeps every label visually distinct from its
            // value (uppercase, dimmer, letter-spaced label vs. larger,
            // near-white value) and gives consistent vertical rhythm between
            // rows. Presentation only -- no data or logic here.
            const MetaRow = ({ label, children }) => (
              <div style={{ marginTop:14 }}>
                <div style={{ fontFamily:F.display, fontSize:11, letterSpacing:1.5, color:"#9a9a9a", textTransform:"uppercase", marginBottom:3 }}>
                  {label}
                </div>
                <div style={{ fontSize:15, color:"#eeeeee", lineHeight:1.5, wordBreak:"break-word" }}>
                  {children}
                </div>
              </div>
            );

            return (
            <div key={c.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"20px 22px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:18 }}>
                <div style={{ flex:1, minWidth:260 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <div style={{ fontFamily:F.display, fontSize:14, color:C.white, letterSpacing:1 }}>
                      {c.entity_id ? "CLAIM EXISTING" : "NEW ENTITY REQUEST"} — {(c.entity_type||"").toUpperCase()}
                    </div>
                    {statusBadge(c.status)}
                  </div>

                  <MetaRow label={c.entity_id ? "Entity ID" : "Proposed"}>
                    {c.entity_id
                      ? c.entity_id
                      : `${c.proposed_name || "—"}${c.proposed_city ? ", " + c.proposed_city : ""}`}
                  </MetaRow>

                  <MetaRow label="Requested by">
                    {c.requester_email}
                  </MetaRow>

                  <MetaRow label="Submitted">
                    {c.created_at ? new Date(c.created_at).toLocaleString() : "—"}
                  </MetaRow>

                  {/* Applicant's comment is the most important thing an admin
                      needs to read to make a decision, so it gets the most
                      prominent treatment on the card: its own clearly labelled
                      section, larger type, and the highest-contrast text. */}
                  {c.requester_message && (
                    <div style={{
                      marginTop:16, padding:"12px 14px",
                      background:"rgba(255,255,255,0.04)",
                      borderLeft:`3px solid ${C.red}`,
                      borderRadius:4,
                    }}>
                      <div style={{ fontFamily:F.display, fontSize:11, letterSpacing:1.5, color:C.red, textTransform:"uppercase", marginBottom:6 }}>
                        Applicant Comment
                      </div>
                      <div style={{ fontSize:16, color:"#ffffff", lineHeight:1.6, wordBreak:"break-word" }}>
                        {c.requester_message}
                      </div>
                    </div>
                  )}

                  {c.review_notes && (
                    <MetaRow label="Review notes">
                      {c.review_notes}
                    </MetaRow>
                  )}
                </div>

                {c.status === "pending" && (
                  <div style={{ display:"flex", flexDirection:"column", gap:6, minWidth:220 }}>
                    <textarea
                      value={notes[c.id] || ""} onChange={e=>setNotes(n=>({ ...n, [c.id]: e.target.value }))}
                      placeholder="Review notes (optional)" rows={2}
                      style={{ ...inputCss, resize:"vertical", fontSize:12 }}
                    />
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn variant="success" onClick={()=>approve(c)} disabled={busyId===c.id} style={{ fontSize:12, padding:"7px 14px" }}>
                        ✓ APPROVE
                      </Btn>
                      <Btn variant="danger" onClick={()=>reject(c)} disabled={busyId===c.id} style={{ fontSize:12, padding:"7px 14px" }}>
                        ✗ REJECT
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  ADMIN VENUES
// ════════════════════════════════════════════════════════════════════
function AdminVenues({ venues, allGigs, onRefresh, filterMode="all", onFilterModeChange }) {
  const [view,     setView]     = useState("list"); // list | edit
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [msg,      setMsg]      = useState({ text:"", type:"" });

  const setE = k => e => setEditForm(f=>({...f,[k]:e.target.value}));

  const showMsg = (text, type="success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text:"", type:"" }), 4000);
  };

  // Gig counts per venue
  const gigCounts = allGigs.reduce((acc, g) => {
    if (g.venue_id) acc[g.venue_id] = (acc[g.venue_id]||0)+1;
    return acc;
  }, {});

  const filtered = venues.filter(v => {
    if (filterMode === "incomplete" && (v.description || v.website)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (v.name||"").toLowerCase().includes(q) ||
           (v.city||"").toLowerCase().includes(q);
  }).sort((a,b) => (gigCounts[b.id]||0) - (gigCounts[a.id]||0));

  const openEdit = (venue) => {
    setSelected(venue);
    setEditForm({
      name:          venue.name          || "",
      city:          venue.city          || "",
      address:       venue.address       || "",
      postcode:      venue.postcode      || "",
      capacity:      venue.capacity      || "",
      contact_email: venue.contact_email || "",
      phone:         venue.phone         || "",
      description:   venue.description   || "",
      website:       venue.website       || "",
      facebook:      venue.facebook      || "",
      instagram:     venue.instagram     || "",
      twitter:       venue.twitter       || "",
      photo_url:     venue.photo_url     || "",
      seo_title:          venue.seo_title          || "",
      seo_description:    venue.seo_description    || "",
      seo_search_phrases: venue.seo_search_phrases  || "",
    });
    setView("edit");
  };

  const handleDeleteVenue = async (venue) => {
    const count = gigCounts[venue.id] || 0;
    const msg = count > 0
      ? `Delete "${venue.name}"?\n\n⚠ WARNING: This will orphan ${count} linked gig${count!==1?"s":""}.\n\nType DELETE to confirm.`
      : `Delete "${venue.name}"?\n\nThis cannot be undone. Type DELETE to confirm.`;
    const conf = prompt(msg);
    if (conf !== "DELETE") { if (conf !== null) alert("Deletion cancelled — type DELETE exactly."); return; }
    try {
      await DB.deleteVenue(venue.id);
      showMsg("✓ Venue deleted");
      if (onRefresh) onRefresh();
    } catch(e) {
      showMsg(e.message, "error");
    }
  };

  const handleSave = async () => {
    try {
      await DB.updateVenue(selected.id, editForm);
      showMsg("✓ Venue updated successfully");
      setView("list");
      if (onRefresh) onRefresh();
    } catch(e) {
      showMsg(e.message, "error");
    }
  };

  // ── LIST VIEW ──
  if (view === "list") return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <SectionLabel>VENUE DIRECTORY</SectionLabel>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={()=>onFilterModeChange?.("all")} style={{ padding:"6px 14px", border:"none", borderRadius:5, cursor:"pointer", fontFamily:F.display, letterSpacing:1, fontSize:11, background:filterMode==="all"?C.red:"rgba(255,255,255,0.05)", color:filterMode==="all"?"#fff":C.muted }}>ALL ({venues.length})</button>
          <button onClick={()=>onFilterModeChange?.("incomplete")} style={{ padding:"6px 14px", border:"none", borderRadius:5, cursor:"pointer", fontFamily:F.display, letterSpacing:1, fontSize:11, background:filterMode==="incomplete"?C.amber:"rgba(255,255,255,0.05)", color:filterMode==="incomplete"?"#000":C.muted }}>
            INCOMPLETE ({venues.filter(v=>!v.description&&!v.website).length})
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(120px,1fr))", gap:12, marginBottom:20 }}>
        {[
          { label:"TOTAL VENUES", val: venues.length },
          { label:"WITH DETAILS", val: venues.filter(v=>v.description||v.website).length },
          { label:"MISSING INFO", val: venues.filter(v=>!v.description&&!v.website).length },
        ].map(({ label, val }) => (
          <div key={label} style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6, padding:"10px 14px" }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{label}</div>
            <div style={{ fontSize:24, fontFamily:F.display, color:C.red, lineHeight:1.2 }}>{val}</div>
          </div>
        ))}
      </div>

      {msg.text && (
        <div style={{ marginBottom:16, padding:12, background: msg.type==="error" ? "rgba(232,32,58,0.1)" : "rgba(67,170,139,0.1)", border:`1px solid ${msg.type==="error"?C.red:C.green}`, borderRadius:6, fontSize:13, color: msg.type==="error" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      {/* Search */}
      <div style={{ position:"relative", marginBottom:20 }}>
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, color:C.muted }}>🔍</span>
        <input type="text" placeholder="Search venues..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...inputCss, paddingLeft:42 }}
        />
      </div>

      {/* Venue list */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.map(v => {
          const count    = gigCounts[v.id] || 0;
          const hasInfo  = v.description || v.website;
          return (
            <div key={v.id} style={{
              background:C.surfaceHigh, border:`1px solid ${C.border}`,
              borderLeft:`3px solid ${hasInfo ? C.green : C.amber}`,
              borderRadius:8, padding:"14px 18px",
              display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
            }}>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color:C.white }}>
                  {v.name}
                </div>
                <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                  📍 {v.city}
                  {v.slug && <span style={{ color:C.dim, marginLeft:8 }}>/{v.slug}</span>}
                </div>
                <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:11, color: count>0 ? C.red : C.dim, fontFamily:F.display }}>
                    🎸 {count} gig{count!==1?"s":""}
                  </span>
                  {!hasInfo && <span style={{ fontSize:11, color:C.amber }}>⚠ Needs info</span>}
                  {v.website && <span style={{ fontSize:11, color:C.green }}>✓ Website</span>}
                  {v.description && <span style={{ fontSize:11, color:C.green }}>✓ Description</span>}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <Btn variant="ghost" onClick={()=>openEdit(v)} style={{ fontSize:11, padding:"6px 12px" }}>✏️ EDIT</Btn>
                {v.slug && (
                  <a href={`/venue/${v.slug}`} target="_blank" rel="noreferrer"
                    style={{ ...btnCss("ghost"), fontSize:11, padding:"6px 12px", textDecoration:"none", display:"inline-block" }}
                  >👁 VIEW</a>
                )}
                <Btn variant="danger" onClick={()=>handleDeleteVenue(v)} style={{ fontSize:11, padding:"6px 12px" }}>🗑</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── EDIT VIEW ──
  if (view === "edit" && selected) return (
    <div style={{ maxWidth:600 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, flexWrap:"wrap" }}>
        <span onClick={()=>setView("list")} style={{ color:C.muted, cursor:"pointer", fontSize:13 }}>← Back to venues</span>
        <div style={{ fontFamily:F.display, fontSize:20, color:C.white, letterSpacing:2 }}>EDITING: {selected.name}</div>
        {selected.slug && (
          <a href={`/venue/${selected.slug}`} target="_blank" rel="noreferrer"
            style={{ fontSize:11, color:C.red, textDecoration:"none" }}
          >↗ View public page</a>
        )}
      </div>

      {msg.text && (
        <div style={{ marginBottom:16, padding:12, background: msg.type==="error" ? "rgba(232,32,58,0.1)" : "rgba(67,170,139,0.1)", border:`1px solid ${msg.type==="error"?C.red:C.green}`, borderRadius:6, fontSize:13, color: msg.type==="error" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:26 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2 }}>VENUE INFORMATION</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="VENUE NAME" value={editForm.name} onChange={setE("name")} required />
          </div>
          <Input label="CITY / TOWN" value={editForm.city}     onChange={setE("city")}     required />
          <Input label="POSTCODE"    value={editForm.postcode} onChange={setE("postcode")} placeholder="PO1 1AA" />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="ADDRESS" value={editForm.address} onChange={setE("address")} placeholder="Street address" />
          </div>
          <Input label="CAPACITY"      type="number" value={editForm.capacity}      onChange={setE("capacity")}      placeholder="e.g. 200" />
          <Input label="CONTACT EMAIL" type="email"  value={editForm.contact_email} onChange={setE("contact_email")} placeholder="info@venue.co.uk" />
          <Input label="PHONE"         type="tel"    value={editForm.phone}         onChange={setE("phone")}         placeholder="+44..." />
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>DESCRIPTION</label>
            <textarea value={editForm.description} onChange={setE("description")} rows={4}
              placeholder="Tell visitors about this venue..."
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>ONLINE</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="WEBSITE" type="url" value={editForm.website} onChange={setE("website")} placeholder="https://..." />
          </div>
          <Input label="FACEBOOK"  type="url" value={editForm.facebook}  onChange={setE("facebook")}  placeholder="https://facebook.com/..." />
          <Input label="INSTAGRAM" type="url" value={editForm.instagram} onChange={setE("instagram")} placeholder="https://instagram.com/..." />
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="X / TWITTER" type="url" value={editForm.twitter} onChange={setE("twitter")} placeholder="https://x.com/..." />
          </div>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>PHOTO</div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="PHOTO URL" type="url" value={editForm.photo_url} onChange={setE("photo_url")} placeholder="https://..." />
            {editForm.photo_url && (
              <img src={editForm.photo_url} alt="Venue"
                style={{ marginTop:10, width:"100%", maxHeight:200, objectFit:"cover", borderRadius:6, border:`1px solid ${C.border}` }}
              />
            )}
          </div>

          <div style={{ gridColumn:"1/-1", fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginTop:8 }}>SEARCH ENGINE LISTING</div>
          <div style={{ gridColumn:"1/-1", fontSize:13, color:C.muted, lineHeight:1.6, marginTop:-8, marginBottom:4 }}>
            Optional. Leave blank to use the automatically generated title/description.
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="SEO TITLE" value={editForm.seo_title} onChange={setE("seo_title")} placeholder="Leave blank to use the automatic title" />
            <div style={{ fontSize:11, color: (editForm.seo_title||"").length > 60 ? C.amber : C.dim, marginTop:4 }}>{(editForm.seo_title||"").length}/60</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEO DESCRIPTION</label>
            <textarea value={editForm.seo_description} onChange={setE("seo_description")} rows={3}
              placeholder="Leave blank to use the automatic description"
              style={{ ...inputCss, resize:"vertical" }}
            />
            <div style={{ fontSize:11, color: (editForm.seo_description||"").length > 160 ? C.amber : C.dim, marginTop:4 }}>{(editForm.seo_description||"").length}/160</div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>SEARCH PHRASES</label>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>How might people search for this venue? For example: live music venue Southampton, gig venue Hampshire.</div>
            <textarea value={editForm.seo_search_phrases} onChange={setE("seo_search_phrases")} rows={2}
              placeholder="Optional — a few phrases, separated by commas"
              style={{ ...inputCss, resize:"vertical" }}
            />
          </div>

          <div style={{ gridColumn:"1/-1", padding:"12px 14px", background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:6, fontSize:11, color:C.dim }}>
            🔗 Public URL: <span style={{ color:C.muted }}>musicscenemagazine.co.uk/venue/{selected.slug}</span>
          </div>
        </div>

        <Btn onClick={handleSave} style={{ width:"100%", marginTop:24, padding:"13px" }}>SAVE VENUE</Btn>
      </div>
    </div>
  );

  return null;
}

// ════════════════════════════════════════════════════════════════════
//  ADMIN BACKUPS
// ════════════════════════════════════════════════════════════════════
function AdminBackups({ bands, allGigs, venues, currentUser }) {
  const [backupHistory,  setBackupHistory]  = useState([]);
  const [verifyLog,      setVerifyLog]      = useState([]);
  const [storageStats,   setStorageStats]   = useState(null);
  const [exporting,      setExporting]      = useState("");
  const [verifying,      setVerifying]      = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // ── Load history and verify log ──
  useEffect(() => {
    async function load() {
      setLoadingHistory(true);
      const { data: hist }   = await supabase.from("backup_log").select("*").order("exported_at", { ascending:false }).limit(10);
      const { data: verify } = await supabase.from("backup_verify_log").select("*").order("verified_at", { ascending:false }).limit(1);
      setBackupHistory(hist || []);
      setVerifyLog(verify || []);
      setLoadingHistory(false);
    }
    load();
    loadStorage();
  }, []);

  async function loadStorage() {
    try {
      const { data: items } = await supabase.storage.from("band-photos").list("", { limit:1000 });
      let total = 0;
      if (items) {
        for (const item of items) {
          if (!item.id) {
            const { data: files } = await supabase.storage.from("band-photos").list(item.name, { limit:100 });
            total += files?.length || 0;
          } else total++;
        }
      }
      setStorageStats({ bandPhotos: total, venuePhotos: 0, total });
    } catch(e) {
      setStorageStats({ bandPhotos: 0, venuePhotos: 0, total: 0 });
    }
  }

  // ── Helpers ──
  const fmtDT = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString("en-GB", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
  };

  const fileTS = () => {
    const d  = new Date();
    const p  = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const nowISO = () => new Date().toISOString();

  const lastExport  = backupHistory[0] || null;
  const lastVerify  = verifyLog[0]     || null;

  // ── Backup health ──
  const health = () => {
    if (!lastExport) return { color:C.red,   icon:"🔴", label:"CRITICAL", desc:"No backup on record — export now" };
    const days = (Date.now() - new Date(lastExport.exported_at).getTime()) / (1000*60*60*24);
    if (days < 7)  return { color:C.green,  icon:"🟢", label:"HEALTHY",  desc:`Last export ${Math.floor(days)} day${Math.floor(days)!==1?"s":""} ago` };
    if (days < 30) return { color:C.amber,  icon:"🟠", label:"WARNING",  desc:`Last export ${Math.floor(days)} days ago — backup recommended` };
    return               { color:C.red,   icon:"🔴", label:"CRITICAL", desc:`Last export ${Math.floor(days)} days ago — backup overdue` };
  };

  const nextBackup = () => {
    if (!lastExport) return "Now";
    const d = new Date(lastExport.exported_at);
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString("en-GB");
  };

  const recoveryFiles = backupHistory.length;

  // ── Log backup to Supabase ──
  const logBackup = async (type, filename, counts) => {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("backup_log").insert({
      export_type:   type,
      filename,
      exported_by:   u?.user?.id || null,
      record_counts: counts,
    });
    const { data: hist } = await supabase.from("backup_log").select("*").order("exported_at", { ascending:false }).limit(10);
    setBackupHistory(hist || []);
  };

  // ── Mark as verified ──
  const markVerified = async () => {
    setVerifying(true);
    const { data: u } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("band_name").eq("id", u?.user?.id || "").single();
    await supabase.from("backup_verify_log").insert({
      verified_by:      u?.user?.id || null,
      verified_by_name: profile?.band_name || u?.user?.email || "Administrator",
      status:           "verified",
    });
    const { data: verify } = await supabase.from("backup_verify_log").select("*").order("verified_at", { ascending:false }).limit(1);
    setVerifyLog(verify || []);
    setVerifying(false);
  };

  // ── Download helpers ──
  const downloadJSON = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = (rows, filename) => {
    if (!rows.length) return;
    const keys   = Object.keys(rows[0]);
    const escape = v => { if (v==null) return ""; const s=String(v).replace(/"/g,'""'); return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s}"`:s; };
    const csv    = [keys.join(","), ...rows.map(r=>keys.map(k=>escape(r[k])).join(","))].join("\n");
    const blob   = new Blob([csv], { type:"text/csv" });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement("a"); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  };

  const wrapMeta = (data, type) => ({
    backup_version: "1.0",
    exported_at:    nowISO(),
    platform:       "Music Scene Magazine",
    type,
    meta: {
      total_bands:   bands.length,
      total_gigs:    allGigs.length,
      total_venues:  venues.length,
    },
    ...data,
  });

  // ── Export functions ──
  const doExport = async (type, label, jsonFn, csvFn, counts) => {
    const fn = jsonFn ? `MSM-${label}-${fileTS()}.json` : `MSM-${label}-${fileTS()}.csv`;
    if (jsonFn) jsonFn(fn); else csvFn(fn);
    await logBackup(type, fn, counts);
  };

  const exportBandsJSON   = async () => { setExporting("bands-json");  const fn=`MSM-Bands-${fileTS()}.json`;   downloadJSON(wrapMeta({bands},"bands"),fn);   await logBackup("bands",fn,{bands:bands.length});   setExporting(""); };
  const exportBandsCSV    = async () => { setExporting("bands-csv");   const fn=`MSM-Bands-${fileTS()}.csv`;    downloadCSV(bands,fn);                         await logBackup("bands",fn,{bands:bands.length});   setExporting(""); };
  const exportGigsJSON    = async () => { setExporting("gigs-json");   const fn=`MSM-Gigs-${fileTS()}.json`;    downloadJSON(wrapMeta({gigs:allGigs},"gigs"),fn); await logBackup("gigs",fn,{gigs:allGigs.length});  setExporting(""); };
  const exportGigsCSV     = async () => { setExporting("gigs-csv");    const fn=`MSM-Gigs-${fileTS()}.csv`;     downloadCSV(allGigs,fn);                        await logBackup("gigs",fn,{gigs:allGigs.length});  setExporting(""); };
  const exportVenuesJSON  = async () => { setExporting("venues-json"); const fn=`MSM-Venues-${fileTS()}.json`;  downloadJSON(wrapMeta({venues},"venues"),fn);   await logBackup("venues",fn,{venues:venues.length}); setExporting(""); };
  const exportVenuesCSV   = async () => { setExporting("venues-csv");  const fn=`MSM-Venues-${fileTS()}.csv`;   downloadCSV(venues,fn);                         await logBackup("venues",fn,{venues:venues.length}); setExporting(""); };

  const exportEverything = async () => {
    setExporting("all");
    // FIX 1: Use profile_type filter (not role) for accurate backup counts
    const { data: profiles } = await supabase.from("profiles").select("*").eq("profile_type","band");
    const bandsWithRel  = allGigs.filter(g=>g.band_profile_id).length;
    const venuesWithRel = allGigs.filter(g=>g.venue_id).length;
    const backup = {
      backup_version: "1.0",
      exported_at:    nowISO(),
      platform:       "Music Scene Magazine",
      type:           "full",
      meta: {
        total_bands:        bands.length,
        total_gigs:         allGigs.length,
        total_venues:       venues.length,
        total_profiles:     profiles?.length || 0,
        band_photos:        storageStats?.bandPhotos || 0,
        gigs_with_band_id:  bandsWithRel,
        gigs_with_venue_id: venuesWithRel,
      },
      bands,
      gigs:     allGigs,
      venues,
      profiles: profiles || [],
    };
    const fn = `MSM-Full-Backup-${fileTS()}.json`;
    downloadJSON(backup, fn);
    await logBackup("full", fn, backup.meta);
    setExporting("");
  };

  const h = health();

  const ExportCard = ({ title, icon, count, unit, onJSON, onCSV, id }) => (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.red}`, borderRadius:8, padding:24 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
        <span style={{ fontSize:28 }}>{icon}</span>
        <div>
          <div style={{ fontFamily:F.display, fontSize:18, color:C.white, letterSpacing:2 }}>{title}</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{count} {unit}</div>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <Btn onClick={onJSON} disabled={!!exporting} style={{ flex:1, padding:"10px" }}>{exporting===`${id}-json`?"...":"↓ JSON"}</Btn>
        <Btn variant="ghost" onClick={onCSV} disabled={!!exporting} style={{ flex:1, padding:"10px" }}>{exporting===`${id}-csv`?"...":"↓ CSV"}</Btn>
      </div>
    </div>
  );

  const typeLabel = t => ({ full:"Full Platform", bands:"Bands", gigs:"Gigs", venues:"Venues" }[t] || t);
  const typeColor = t => ({ full:C.red, bands:"#9b59b6", gigs:C.green, venues:C.amber }[t] || "#888");

  return (
    <div>
      <SectionLabel>BACKUPS & EXPORTS</SectionLabel>

      {/* Migration warning */}
      <div style={{ marginBottom:24, padding:16, background:"rgba(244,162,97,0.08)", border:`1px solid ${C.amber}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:13, color:C.amber, letterSpacing:2, marginBottom:6 }}>⚠ BEFORE ANY SQL MIGRATION OR DATABASE CHANGES</div>
        <div style={{ fontSize:13, color:"#ccc", lineHeight:1.7 }}>
          Always export a full backup before running SQL migrations or making database changes.
          You are on Supabase Free — there are no automated backups. This export is your only safety net.
        </div>
      </div>

      {/* RECOVERY STATUS */}
      <div style={{ marginBottom:24, padding:20, background:C.surface, border:`1px solid ${C.border}`, borderTop:`3px solid ${h.color}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:14, color:C.white, letterSpacing:2, marginBottom:16 }}>RECOVERY STATUS</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px,1fr))", gap:12 }}>
          {/* Health */}
          <div style={{ padding:"12px 14px", background:C.surfaceHigh, border:`1px solid ${h.color}40`, borderRadius:6 }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>BACKUP HEALTH</div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:18 }}>{h.icon}</span>
              <div>
                <div style={{ fontFamily:F.display, fontSize:13, color:h.color }}>{h.label}</div>
                <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{h.desc}</div>
              </div>
            </div>
          </div>
          {/* Last export */}
          <div style={{ padding:"12px 14px", background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6 }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>LAST EXPORT</div>
            <div style={{ fontSize:13, color: lastExport ? C.green : C.amber, fontFamily:F.display }}>
              {lastExport ? fmtDT(lastExport.exported_at) : "NEVER"}
            </div>
            {lastExport && <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>{typeLabel(lastExport.export_type)}</div>}
          </div>
          {/* Last verified */}
          <div style={{ padding:"12px 14px", background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6 }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>LAST VERIFIED RESTORE TEST</div>
            {lastVerify ? (
              <>
                <div style={{ fontSize:13, color:C.green, fontFamily:F.display }}>{fmtDT(lastVerify.verified_at)}</div>
                <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>Verified by {lastVerify.verified_by_name}</div>
              </>
            ) : (
              <div style={{ fontSize:13, color:C.amber, fontFamily:F.display }}>NEVER VERIFIED</div>
            )}
          </div>
          {/* Recovery files */}
          <div style={{ padding:"12px 14px", background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6 }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display, marginBottom:6 }}>RECOVERY FILES</div>
            <div style={{ fontSize:22, fontFamily:F.display, color:C.white }}>{recoveryFiles}</div>
            <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>exports on record</div>
          </div>
        </div>
        {/* Next backup */}
        <div style={{ marginTop:12, fontSize:12, color:C.muted }}>
          Next recommended backup: <span style={{ color:C.white }}>{nextBackup()}</span>
        </div>
      </div>

      {/* Export Everything */}
      <div style={{ marginBottom:24, padding:24, background:"rgba(232,32,58,0.06)", border:`2px solid ${C.red}`, borderRadius:10 }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:F.display, fontSize:22, color:C.white, letterSpacing:2, marginBottom:6 }}>FULL PLATFORM BACKUP</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:12 }}>
              Single JSON file — all bands, gigs, venues, profiles, relationships and metadata.
            </div>
            {/* Coverage summary */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, fontSize:12, color:"#aaa" }}>
              <span>✓ {bands.length} Bands</span>
              <span>✓ {allGigs.length} Gigs</span>
              <span>✓ {venues.length} Venues</span>
              <span>✓ {storageStats?.bandPhotos || 0} Band Photos</span>
              <span>✓ {allGigs.filter(g=>g.band_profile_id).length} Band/Gig Links</span>
              <span>✓ {allGigs.filter(g=>g.venue_id).length} Venue/Gig Links</span>
            </div>
          </div>
          <Btn onClick={exportEverything} disabled={!!exporting} style={{ padding:"14px 32px", fontSize:14, whiteSpace:"nowrap" }}>
            {exporting==="all" ? "EXPORTING..." : "⬇ EXPORT EVERYTHING"}
          </Btn>
        </div>
      </div>

      {/* Individual exports */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px,1fr))", gap:16, marginBottom:24 }}>
        <ExportCard title="BANDS"  icon="🎸" count={bands.length}   unit="profiles" id="bands"  onJSON={exportBandsJSON}  onCSV={exportBandsCSV}  />
        <ExportCard title="GIGS"   icon="📅" count={allGigs.length} unit="gigs"     id="gigs"   onJSON={exportGigsJSON}   onCSV={exportGigsCSV}   />
        <ExportCard title="VENUES" icon="📍" count={venues.length}  unit="venues"   id="venues" onJSON={exportVenuesJSON} onCSV={exportVenuesCSV} />
      </div>

      {/* Verify restore */}
      <div style={{ marginBottom:24, padding:20, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:14, color:C.white, letterSpacing:2, marginBottom:8 }}>RESTORE VERIFICATION</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.7 }}>
          After manually verifying that a backup file can be restored successfully, click below to log the verification.
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
          <Btn variant="ghost" onClick={markVerified} disabled={verifying} style={{ padding:"10px 20px" }}>
            {verifying ? "SAVING..." : "✓ MARK AS VERIFIED"}
          </Btn>
          {lastVerify && (
            <div style={{ fontSize:12, color:C.green }}>
              Last verified: {fmtDT(lastVerify.verified_at)} by {lastVerify.verified_by_name}
            </div>
          )}
        </div>
      </div>

      {/* Backup history */}
      <div style={{ marginBottom:24, padding:20, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:14, color:C.white, letterSpacing:2, marginBottom:16 }}>BACKUP HISTORY</div>
        {loadingHistory ? (
          <div style={{ color:C.dim, fontSize:13 }}>Loading...</div>
        ) : backupHistory.length === 0 ? (
          <div style={{ color:C.dim, fontSize:13 }}>No exports on record yet.</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {backupHistory.map((b,i) => (
              <div key={b.id} style={{
                display:"flex", alignItems:"center", gap:16, padding:"10px 14px",
                background: i===0 ? "rgba(232,32,58,0.05)" : "rgba(255,255,255,0.02)",
                border:`1px solid ${i===0 ? C.red+"40" : C.border}`,
                borderLeft:`3px solid ${typeColor(b.export_type)}`,
                borderRadius:6, flexWrap:"wrap",
              }}>
                <div style={{ fontSize:13, color:C.muted, minWidth:140, fontFamily:"monospace" }}>{fmtDT(b.exported_at)}</div>
                <div style={{ minWidth:100 }}>
                  <Badge label={typeLabel(b.export_type)} color={typeColor(b.export_type)} />
                </div>
                <div style={{ flex:1, fontSize:11, color:C.dim, fontFamily:"monospace" }}>{b.filename}</div>
                {i===0 && <Badge label="LATEST" color={C.green} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Storage stats */}
      <div style={{ marginBottom:24, padding:18, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:13, color:C.white, letterSpacing:2, marginBottom:14 }}>STORAGE</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:12 }}>
          {[
            { label:"BAND PHOTOS",  val: storageStats?.bandPhotos  ?? "—" },
            { label:"VENUE PHOTOS", val: storageStats?.venuePhotos ?? "—" },
            { label:"TOTAL FILES",  val: storageStats?.total       ?? "—" },
          ].map(({ label, val }) => (
            <div key={label} style={{ background:C.surfaceHigh, border:`1px solid ${C.border}`, borderRadius:6, padding:"10px 14px" }}>
              <div style={{ fontSize:9, color:C.muted, letterSpacing:2, fontFamily:F.display }}>{label}</div>
              <div style={{ fontSize:20, fontFamily:F.display, color:C.white, lineHeight:1.3, marginTop:2 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recovery notes */}
      <div style={{ padding:20, background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:8 }}>
        <div style={{ fontFamily:F.display, fontSize:13, color:C.white, letterSpacing:2, marginBottom:12 }}>RECOVERY NOTES</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:12, color:C.muted, lineHeight:1.8 }}>
          <div>📁 <strong style={{ color:"#ccc" }}>Store in:</strong> Google Drive → MSM Backups → [Year] → [Month]</div>
          <div>📅 <strong style={{ color:"#ccc" }}>Schedule:</strong> Full backup every Sunday + before any SQL migration</div>
          <div>🔄 <strong style={{ color:"#ccc" }}>To restore:</strong> Use JSON backup to reimport via Supabase dashboard or future restore tool</div>
          <div>🔑 <strong style={{ color:"#ccc" }}>Project ID:</strong> fmlaaiolqwknowhtdeue</div>
          <div>⚠ <strong style={{ color:C.amber }}>Free tier:</strong> No automated backups — these exports are your only protection</div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  GLOBAL CSS
// ════════════════════════════════════════════════════════════════════
export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  html { font-size: 16px; }
  body { background:#0d0d0d; }
  input[type=date]::-webkit-calendar-picker-indicator,
  input[type=time]::-webkit-calendar-picker-indicator { filter:invert(0.5); cursor:pointer; }
  ::-webkit-scrollbar { width:6px; }
  ::-webkit-scrollbar-track { background:#0d0d0d; }
  ::-webkit-scrollbar-thumb { background:#2a2a2a; border-radius:3px; }
  select option { background:#111; color:#fff; }
  input::placeholder, textarea::placeholder { color:#666666; font-size:14px; }

  /* ── Mobile ── */
  @media (max-width: 600px) {
    /* Header: 80px desktop -> 60px mobile, a ~25% reduction. Logo itself is
       sized in JS (MSMLogo height prop via useIsMobile), not here -- scaling
       only the <img> height through CSS would distort its aspect ratio
       since the wrapper div's width is computed from the height prop. */
    /* min-height, not height: a fixed height fights the safe-area
       padding-top rule below on notched/Dynamic-Island devices (that
       padding eats into a fixed box, squashing the header's content down
       into -- and visually overlapping -- the bar below it). min-height
       keeps a plain 60px box on devices with no inset while letting it
       grow just enough to fit the status-bar inset on ones that have it. */
    .msm-header { min-height:60px !important; height:auto !important; padding:0 14px !important; }
    /* Slogan swapped for the live gig counter alone -- minimises this bar's
       height since there's only one short line left to show. */
    .msm-tagline { padding:6px 14px !important; flex-wrap:nowrap; gap:0 !important; }
    .msm-tagline span { font-size:10px !important; }
    .msm-slogan { display:none !important; }
    .msm-gig-counter { margin-left:0 !important; }
    .msm-nav { padding:0 8px !important; gap:3px !important; overflow-x:auto; }
    .msm-nav button { padding:14px 12px !important; font-size:13px !important; font-weight:600 !important; white-space:nowrap; }
    .msm-main { padding:16px 10px !important; }
    .msm-filters { flex-direction:column !important; gap:8px !important; padding:12px !important; }
    .msm-filters > div { flex:unset !important; width:100% !important; }
    .msm-filters label { font-size:15px !important; }
    .msm-filter-btns { width:100% !important; justify-content:stretch !important; }
    .msm-filter-btns button { flex:1 !important; padding:12px 10px !important; }
    .msm-cal-cell { min-height:60px !important; padding:4px 3px !important; }
    .msm-cal-day { font-size:10px !important; }
    .msm-cal-nav { width:44px !important; height:44px !important; }
    .msm-gig-label { padding:2px 3px !important; }
    .msm-gig-label span:last-child { font-size:10px !important; }
    .msm-gig-dot { width:5px !important; height:5px !important; }
    .msm-legend { gap:6px 12px !important; margin-top:12px !important; }
    .msm-legend > div { font-size:11px !important; }
    .msm-month-title { font-size:20px !important; }
    .msm-day-header { font-size:9px !important; }
    .msm-signin-btn { font-size:12px !important; padding:10px 14px !important; }
    .msm-account { display:none !important; }

    /* Readability: gig artist name, venue/location, date and time in
       ListView rows -- genre badges, fonts and colours are untouched.
       (~10-15% up from the pre-Sprint-2 baseline of 15/11/12/11px.) */
    .msm-list-artist { font-size:17px !important; }
    .msm-list-venue  { font-size:15px !important; }
    .msm-list-date   { font-size:14px !important; }
    .msm-list-time   { font-size:15px !important; }

    /* Search bar: +4px height (12px vertical padding -> 14px), placeholder
       text bumped 14px -> 16px. Value text size (15px) and all other
       styling/behaviour are untouched. */
    .msm-search-input { padding-top:14px !important; padding-bottom:14px !important; }
    .msm-search-input::placeholder { font-size:16px !important; }

    /* Collapsible Search & Filters panel (mobile only). Desktop keeps
       FiltersBar permanently expanded and never shows this toggle -- see
       the un-queried .msm-filters-toggle/.msm-filters-collapse rules below. */
    .msm-filters-toggle { display:flex !important; }
    .msm-filters-collapse {
      display:grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.25s ease;
      overflow: hidden;
    }
    .msm-filters-collapse.open { grid-template-rows: 1fr; }
    .msm-filters-collapse > div { overflow:hidden; min-height:0; }
  }

  /* Search & Filters toggle button -- hidden by default (desktop); the
     mobile media query above switches it to display:flex. The panel itself
     defaults to fully expanded with no collapse behaviour so desktop is
     visually and functionally identical to before this sprint. */
  .msm-filters-toggle {
    display:none;
    align-items:center; gap:8px; width:100%;
    margin-bottom:12px; padding:12px 16px;
    background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07);
    border-radius:8px; color:#9a9a9a;
    font-family:'Bebas Neue',sans-serif; font-size:14px; letter-spacing:2px;
    cursor:pointer;
  }

  /* ── Safe area (notch / Dynamic Island / gesture-nav devices) ──
     Deliberately placed after the mobile media query above: both this rule
     and the one it overrides use !important at equal specificity, so
     source order decides the winner -- this must come last so narrow
     (<=600px) viewports don't lose the safe-area padding to the plainer
     mobile rule. Only the specific padding side needed is overridden on
     .msm-header/.msm-nav (their other values -- height, gap, etc. -- are
     untouched); env() resolves to 0 on devices with no inset, so this is a
     no-op everywhere else. Split into a default (desktop/landscape, 28px
     base) rule and a narrow-viewport (<=600px, 14px/8px base matching the
     mobile block's own padding above) rule, so neither width regresses the
     other's base padding. */
  .msm-header {
    padding-top: env(safe-area-inset-top) !important;
    padding-left: max(28px, env(safe-area-inset-left)) !important;
    padding-right: max(28px, env(safe-area-inset-right)) !important;
  }
  .msm-nav {
    padding-left: max(28px, env(safe-area-inset-left)) !important;
    padding-right: max(28px, env(safe-area-inset-right)) !important;
  }
  @media (max-width: 600px) {
    .msm-header {
      padding-top: env(safe-area-inset-top) !important;
      padding-left: max(14px, env(safe-area-inset-left)) !important;
      padding-right: max(14px, env(safe-area-inset-right)) !important;
    }
    .msm-nav {
      padding-left: max(8px, env(safe-area-inset-left)) !important;
      padding-right: max(8px, env(safe-area-inset-right)) !important;
    }
  }
`;

// ════════════════════════════════════════════════════════════════════
//  ROOT APP
// ════════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/artist/:slug" element={<BandProfilePage />} />
        <Route path="/venue/:slug"  element={<VenueProfilePage />} />
        <Route path="/festival/:slug" element={<FestivalProfilePage />} />
        <Route path="/promoter/:slug" element={<PromoterProfilePage />} />
        <Route path="/gig/:slug"    element={<GigDetailPage />} />
        <Route path="/claim"        element={<ClaimDirectoryPage />} />
        <Route path="/*"            element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

// ════════════════════════════════════════════════════════════════════
//  SPRINT 3: MY FOLLOWING
// ════════════════════════════════════════════════════════════════════
// One row per followed entity, linking straight to its profile page.
// Used for all three groups (artists/venues/festivals) below.
function FollowedGroup({ title, items, linkPrefix }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom:32 }}>
      <SectionLabel>{title} ({items.length})</SectionLabel>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {items.map(item => (
          <Link key={item.followId} to={`${linkPrefix}/${item.slug}`}
            style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"14px 18px", background:"rgba(255,255,255,0.02)",
              border:`1px solid ${C.border}`, borderRadius:8,
              textDecoration:"none", color:"inherit",
            }}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.red}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
          >
            <span style={{ fontFamily:F.display, fontSize:16, letterSpacing:1, color:C.white }}>{item.name}</span>
            <span style={{ fontSize:11, color:C.muted, letterSpacing:1 }}>VIEW →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Authenticated page listing everything the signed-in fan follows, grouped
// by type (Task 2), plus "Upcoming From Following" (Task 3) -- upcoming
// approved gigs from those followed artists/venues/festivals, filtered
// client-side out of the same `gigs` array MainApp already loads for the
// main Calendar/List views, which this is purely additive to and never
// touches.
function MyFollowingPage({ userId, allGigs }) {
  const [follows, setFollows] = useState(null); // null = loading
  const [error, setError]     = useState("");

  useEffect(() => {
    let cancelled = false;
    DB.getUserFollows(userId)
      .then(f => { if (!cancelled) setFollows(f); })
      .catch(e => { if (!cancelled) { setError(e.message); setFollows({ artists:[], festivals:[], venues:[] }); } });
    return () => { cancelled = true; };
  }, [userId]);

  if (follows === null) {
    return <div style={{ color:C.muted, fontSize:16 }}>Loading your follows...</div>;
  }

  const { artists, festivals, venues } = follows;
  const totalFollowed = artists.length + festivals.length + venues.length;

  const artistIds   = new Set(artists.map(a => a.id));
  const festivalIds = new Set(festivals.map(f => f.id));
  const venueIds    = new Set(venues.map(v => v.id));
  const todayStr = today();
  const upcoming = (allGigs || [])
    .filter(g => g.date >= todayStr && (artistIds.has(g.band_profile_id) || venueIds.has(g.venue_id) || festivalIds.has(g.festival_profile_id)))
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0, 20);

  return (
    <div>
      <SectionLabel>MY FOLLOWING</SectionLabel>
      {error && <div style={{ color:C.red, fontSize:13, marginBottom:16 }}>{error}</div>}

      {totalFollowed === 0 ? (
        <div style={{ color:C.dim, fontSize:14, padding:"24px 0" }}>
          You're not following anyone yet. Visit an artist, venue or festival page and hit Follow to see them here.
        </div>
      ) : (
        <>
          <FollowedGroup title="ARTISTS"   items={artists}   linkPrefix="/artist" />
          <FollowedGroup title="VENUES"    items={venues}    linkPrefix="/venue" />
          <FollowedGroup title="FESTIVALS" items={festivals} linkPrefix="/festival" />
        </>
      )}

      {totalFollowed > 0 && (
        <div style={{ marginTop:16 }}>
          <SectionLabel>UPCOMING FROM FOLLOWING</SectionLabel>
          {upcoming.length === 0 ? (
            <div style={{ color:C.dim, fontSize:13, padding:"12px 0" }}>No upcoming gigs from who you follow yet.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {upcoming.map(g => {
                const color = GENRE_COLORS[g.genre] || "#888";
                return (
                  <Link key={g.id} to={g.slug ? `/gig/${g.slug}` : "#"} style={{
                    display:"flex", alignItems:"center", gap:14, padding:"13px 16px",
                    background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
                    borderLeft:`3px solid ${color}`, borderRadius:6,
                    textDecoration:"none", color:"inherit",
                  }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:F.display, fontSize:15, letterSpacing:1.5, color:C.white }}>{g.band_name}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{g.venue} · {g.city}</div>
                    </div>
                    <Badge label={g.genre} color={color} />
                    <div style={{ textAlign:"right", minWidth:90 }}>
                      <div style={{ fontSize:12, color:C.red, fontFamily:F.display, letterSpacing:1 }}>{fmtDate(g.date)}</div>
                      <div style={{ fontSize:11, color:C.dim }}>{g.time}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const [auth,    setAuth]    = useState(null); // { user, profile, token }
  const [gigs,    setGigs]    = useState([]);
  const [allGigs, setAllGigs] = useState([]);   // admin only
  const [bands,     setBands]     = useState([]);    // admin only
  const [festivals, setFestivals] = useState([]);    // FIX 3: festival profiles
  const [venues,  setVenues]  = useState([]);    // admin only
  const [claims,  setClaims]  = useState([]);    // PHASE 4: claim_requests, admin only
  const [venueFilterMode, setVenueFilterMode] = useState("all"); // all | incomplete
  const [loading, setLoading] = useState(true);
  // Mobile opens straight into List View (denser, no calendar grid to
  // scroll past); desktop keeps the existing Calendar default. Lazy
  // initializer so this is only read once, at mount -- the nav tabs remain
  // the only thing driving `tab` afterwards, so switching views still works
  // exactly as before on either breakpoint.
  const [tab,     setTab]     = useState(() =>
    (typeof window !== "undefined" && window.innerWidth <= 600) ? "list" : "calendar"
  ); // calendar | list | submit | admin
  const [selGig,  setSelGig]  = useState(null);
  const [filters, setFilters] = useState({ city:"All", venue:"All", genre:"All", dateFrom:"", dateTo:"" });
  const [search, setSearch]   = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile-only collapsible Search & Filters panel
  const isMobile = useIsMobile();

  const isAdmin = auth?.profile?.role === "admin";

  // PHASE 5 FIX: restore an existing Supabase session on mount. This effect
  // runs every time MainApp mounts -- a hard browser refresh, but also a
  // React Router navigation away to a public profile page and back, since
  // MainApp fully unmounts/remounts in both cases. Previously `auth` was
  // hardcoded to null with nothing reading the session the Supabase client
  // already persists to localStorage by default, so the user appeared
  // logged out every time even though their token was still valid.
  useEffect(() => {
    if (USE_MOCK) return;
    let active = true;

    // 1) Explicit check on startup, per Supabase's recommended pattern.
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active || error || !data.session) return;
      const result = await DB.buildAuthFromSession(data.session);
      if (active) setAuth(result);
    });

    // 2) Keep auth state synchronized with Supabase's own auth state
    // machine going forward -- INITIAL_SESSION (fired once when the client
    // finishes restoring from storage, overlaps with #1 above but kept for
    // robustness), SIGNED_IN (e.g. another tab, magic link), and
    // SIGNED_OUT (e.g. token expiry, signed out in another tab).
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        setAuth(null);
      } else if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && session) {
        const result = await DB.buildAuthFromSession(session);
        if (active) setAuth(result);
      }
    });

    return () => { active = false; listener?.subscription?.unsubscribe(); };
  }, []);

  // Load public gigs and bands on mount
  useEffect(() => {
    DB.getApprovedGigs().then(data=>{ setGigs(data); setLoading(false); });
    DB.getBands().then(setBands);
    DB.getFestivals().then(setFestivals); // FIX 3: load festival profiles
    DB.getVenues().then(setVenues);
  }, []);

  // Load all gigs when admin logs in
  useEffect(() => {
    if (isAdmin) {
      DB.getAllGigs().then(setAllGigs);
      DB.getBands(true).then(setBands);
      DB.getFestivals(true).then(setFestivals); // FIX 3: load all festival profiles for admin
      DB.getVenues().then(setVenues);
      DB.getClaimRequests().then(setClaims); // PHASE 4
    }
  }, [isAdmin, auth]);

  const refreshAdmin = useCallback(async () => {
    const fresh = await DB.getAllGigs();
    setAllGigs(fresh);
    const approvedFresh = fresh.filter(g=>g.status==="approved");
    setGigs(approvedFresh);
    const freshBands = await DB.getBands(true);
    setBands(freshBands);
    const freshFestivals = await DB.getFestivals(true); // FIX 3
    setFestivals(freshFestivals);
    const freshVenues = await DB.getVenues();
    setVenues(freshVenues);
    const freshClaims = await DB.getClaimRequests(); // PHASE 4
    setClaims(freshClaims);
  }, [auth]);

  const handleAuth = (result) => { setAuth(result); setTab(result.profile?.role === "admin" ? "dashboard" : "submit"); };
  const handleSignOut = async () => { 
    try { await DB.signOut(); } catch(e) { console.warn("Sign out error", e); }
    setAuth(null); 
    setTab("calendar");
  };

  // Apply filters to public gigs
  const calendarSource = useMemo(
    () => [...gigs, ...buildFestivalCalendarItems(festivals, gigs)],
    [gigs, festivals]
  );

  const filteredGigs = useMemo(() => calendarSource.filter(g => {
    if (filters.city  !== "All" && g.city  !== filters.city)  return false;
    if (filters.venue !== "All" && g.venue !== filters.venue) return false;
    if (filters.genre !== "All" && g.genre !== filters.genre) return false;
    if (filters.dateFrom && g.date < filters.dateFrom) return false;
    if (filters.dateTo   && g.date > filters.dateTo)   return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!g.band_name.toLowerCase().includes(q) &&
          !g.venue.toLowerCase().includes(q) &&
          !g.city.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [calendarSource, filters, search]);

  // If user clicked Submit Gig or Admin tab and isn't logged in, show auth panel
  if (!auth && (tab === "submit" || tab === "admin")) {
    return <AuthPanel onAuth={handleAuth} onBack={()=>setTab("calendar")} />;
  }

  const tabDef = [
    { id:"calendar", label:"CALENDAR" },
    { id:"list",     label:"LIST VIEW" },
    { id:"stats",    label:"STATS" },
    { id:"submit",   label:"SUBMIT GIG" },
    ...(auth ? [{ id:"profile", label: auth.profile?.profile_type === "venue" ? "MY VENUE" : "MY PROFILE" }] : []),
    ...(auth ? [{ id:"following", label:"MY FOLLOWING" }] : []),
    ...(isAdmin ? [
      { id:"dashboard", label:"DASHBOARD" },
      { id:"admin",     label:`MODERATION (${allGigs.filter(g=>g.status==="pending").length})` },
      { id:"claims",    label:`CLAIMS (${claims.filter(c=>c.status==="pending").length})` },
      { id:"bands",     label:`BANDS (${bands.filter(b=>!b.disabled).length})` },
      { id:"venues",    label:`VENUES (${venues.length})` },
      { id:"import",      label:"BULK IMPORT" },
      { id:"backups",     label:"BACKUPS" },
      { id:"newsletter",    label:"NEWSLETTER" },
      { id:"featured",      label:"FEATURED" },
      { id:"editorial",     label:"EDITORIAL" },
      { id:"supporters",    label:"SUPPORTERS" },
      { id:"hall-of-fame",  label:"HALL OF FAME" },
      { id:"festivals",     label:"FESTIVALS" },
    ] : []),
  ];

  const navTabStyle = (id) => ({
    padding:"18px 24px", border:"none", background:"none", cursor:"pointer",
    fontFamily:F.display, fontSize:16, letterSpacing:2,
    color: tab===id ? C.red : C.muted,
    borderBottom: tab===id ? `3px solid ${C.red}` : "3px solid transparent",
    transition:"all 0.2s",
  });

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.white, fontFamily:F.body }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header ── */}
      <header className="msm-header" style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:80, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <MSMLogo height={isMobile ? 30 : 56} showWordmark={true} />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {auth ? (
            <>
              <div className="msm-account" style={{ textAlign:"right" }}>
                <div style={{ fontSize:15, color:C.white }}>{auth.profile?.band_name}</div>
                <div style={{ fontSize:11, color: isAdmin ? C.red : C.muted, letterSpacing:1 }}>{isAdmin?"ADMINISTRATOR":"BAND ACCOUNT"}</div>
              </div>
              <Btn variant="ghost" onClick={handleSignOut} className="msm-signin-btn" style={{ fontSize:13, padding:"9px 18px" }}>SIGN OUT</Btn>
            </>
          ) : (
            <Btn variant="ghost" onClick={()=>setTab("submit")} className="msm-signin-btn" style={{ fontSize:13, padding:"9px 18px" }}>LOGIN / REGISTER</Btn>
          )}
        </div>
      </header>

      {/* ── Hero tagline ── */}
      <div className="msm-tagline" style={{ background:"linear-gradient(90deg,#1a0000,#0d0d0d 40%,#0d0d0d 60%,#0a0018)", borderBottom:`1px solid rgba(232,32,58,0.2)`, padding:"10px 28px", display:"flex", alignItems:"center", gap:10 }}>
        {/* Desktop: slogan + right-flushed counter, unchanged. Mobile: the
            slogan is hidden (.msm-slogan) and the counter becomes the sole,
            left-aligned content of this bar -- see the mobile media query
            in GLOBAL_CSS for both rules. */}
        <div className="msm-slogan" style={{ display:"flex", alignItems:"center", gap:10 }}>
          {["REAL MUSIC.","REAL PEOPLE.","REAL SCENES."].map((s,i)=>(
            <span key={i} style={{ fontSize:13, color:C.red, letterSpacing:3, fontFamily:F.display }}>{s}{i<2&&<span style={{ color:"rgba(255,255,255,0.1)", margin:"0 8px" }}>|</span>}</span>
          ))}
        </div>
        <div className="msm-gig-counter" style={{ marginLeft:"auto", fontSize:13, color:C.dim, letterSpacing:1 }}>{gigs.length} GIGS LIVE</div>
      </div>

      {/* ── Nav tabs ── */}
      <div className="msm-nav" style={{ background:"#0a0a0a", borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", gap:4, overflowX:"auto", whiteSpace:"nowrap" }}>
        {tabDef.map(({ id, label }) => (
          <button key={id} data-tab={id} onClick={()=>setTab(id)} style={navTabStyle(id)}>{label}</button>
        ))}
      </div>

      {/* ── Main ── */}
      <div className="msm-main" style={{ width:"100%", padding:"32px 48px" }}>

        {/* STATS */}
        {tab==="stats" && (
          <StatsPanel gigs={gigs} />
        )}

        {/* DASHBOARD */}
        {tab==="dashboard" && isAdmin && (
          <AdminDashboard bands={bands} festivals={festivals} allGigs={allGigs} venues={venues}
            onNav={(t) => { if(t==="venues-incomplete"){ setTab("venues"); setVenueFilterMode("incomplete"); } else setTab(t); }}
            onEditGig={(g) => { setTab("admin"); setTimeout(()=>window._editGig&&window._editGig(g),100); }}
          />
        )}

        {/* BACKUPS */}
        {tab==="backups" && isAdmin && (
          <AdminBackups bands={bands} allGigs={allGigs} venues={venues} />
        )}

        {/* VENUES */}
        {tab==="venues" && isAdmin && (
          <AdminVenues venues={venues} allGigs={allGigs} onRefresh={refreshAdmin} filterMode={venueFilterMode} onFilterModeChange={setVenueFilterMode} />
        )}

        {/* BULK IMPORT */}
        {tab==="import" && isAdmin && (
          <BulkImport bands={bands} onImported={refreshAdmin} />
        )}

        {/* BANDS */}
        {tab==="bands" && isAdmin && (
          <AdminBands bands={bands} onRefresh={refreshAdmin} />
        )}

        {/* MODERATION */}
        {tab==="admin" && isAdmin && (
          <AdminPanel allGigs={allGigs} bands={bands} onRefresh={refreshAdmin} />
        )}

        {/* CLAIMS (PHASE 4) */}
        {tab==="claims" && isAdmin && (
          <AdminClaims claims={claims} onRefresh={refreshAdmin} />
        )}

        {/* NEWSLETTER */}
        {tab==="newsletter" && isAdmin && (
          <NewsletterAdmin supabase={supabase} />
        )}

        {/* FEATURED LISTINGS */}
        {tab==="featured" && isAdmin && (
          <AdminFeatured />
        )}

        {/* EDITORIAL AWARDS */}
        {tab==="editorial" && isAdmin && (
          <AdminEditorial />
        )}

        {/* FOUNDING SUPPORTERS */}
        {tab==="supporters" && isAdmin && (
          <AdminSupporters />
        )}

        {/* HALL OF FAME */}
        {tab==="hall-of-fame" && isAdmin && (
          <AdminHallOfFame />
        )}

        {/* FESTIVALS */}
        {tab==="festivals" && isAdmin && (
          <AdminFestivals onRefresh={refreshAdmin} />
        )}

        {/* MY PROFILE / MY VENUE -- which component renders depends entirely
            on what buildAuthFromSession resolved for this signed-in user:
            a profiles-table entity (band/solo_artist/festival/promoter/
            organisation, owned or managed) renders EditProfile; a venue
            (owned or managed) renders EditVenue. An unclaimed venue with no
            owner and no manager role never resolves to profile_type
            "venue" at all, so there's nothing extra to gate here -- the
            auth-resolution step already handles it. */}
        {tab==="profile" && auth && auth.profile?.profile_type === "venue" && (
          <EditVenue user={auth.user} profile={auth.profile} onSaved={(updatedProfile)=>{
            setAuth(a => ({ ...a, profile: updatedProfile }));
          }} />
        )}
        {tab==="profile" && auth && auth.profile?.profile_type !== "venue" && (
          <EditProfile user={auth.user} profile={auth.profile} onSaved={(updatedProfile)=>{
            setAuth(a => ({ ...a, profile: updatedProfile }));
          }} />
        )}

        {/* SPRINT 3: MY FOLLOWING -- followed artists/venues/festivals plus
            an "Upcoming From Following" section. Entirely additive: its
            own tab, doesn't touch the CALENDAR/LIST views below. */}
        {tab==="following" && auth && (
          <MyFollowingPage userId={auth.user.id} allGigs={gigs} />
        )}

        {/* SUBMIT */}
        {tab==="submit" && auth && (
          <div style={{ maxWidth:700 }}>
            <SubmitGigForm user={auth.user} profile={auth.profile} onSubmitted={()=>{}} onEditProfile={()=>setTab("profile")} />
          </div>
        )}

        {/* CALENDAR / LIST */}
        {(tab==="calendar"||tab==="list") && (
          <div>
            {loading
              ? <div style={{ color:C.muted, fontSize:16 }}>Loading gigs...</div>
              : <>
                  {/* Search bar */}
                  <div style={{ marginBottom:12, position:"relative" }}>
                    <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, color:C.muted, pointerEvents:"none" }}>🔍</span>
                    <input
                      type="text"
                      className="msm-search-input"
                      placeholder="Search bands, venues or cities..."
                      value={search}
                      onChange={e=>setSearch(e.target.value)}
                      style={{ ...inputCss, paddingLeft:42, fontSize:15 }}
                      onFocus={e=>e.target.style.borderColor=C.red}
                      onBlur={e=>e.target.style.borderColor=C.border}
                    />
                    {search && (
                      <span onClick={()=>setSearch("")} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", cursor:"pointer", color:C.muted, fontSize:18 }}>✕</span>
                    )}
                  </div>
                  {/* Filters toggle -- CSS-only hidden on desktop (.msm-filters-toggle
                      stays display:none above 600px), so desktop keeps FiltersBar
                      permanently expanded exactly as before. On mobile this is the
                      "▼ Filters" affordance that expands/collapses the panel below. */}
                  <button
                    type="button"
                    className="msm-filters-toggle"
                    onClick={()=>setFiltersOpen(o=>!o)}
                    aria-expanded={filtersOpen}
                    aria-controls="msm-filters-panel"
                  >
                    <span style={{ display:"inline-block", transition:"transform 0.2s ease", transform: filtersOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                    FILTERS
                  </button>
                  <div id="msm-filters-panel" className={`msm-filters-collapse${filtersOpen ? " open" : ""}`}>
                    <div>
                      <FiltersBar
                        gigs={gigs}
                        filters={filters}
                        setFilters={setFilters}
                        onExport={()=>exportICal(filteredGigs)}
                      />
                    </div>
                  </div>
                  {tab==="calendar"
                    ? <CalendarView gigs={filteredGigs} onGigClick={setSelGig} bands={bands} />
                    : <ListView     gigs={filteredGigs} onGigClick={setSelGig} bands={bands} />
                  }
                  <div style={{ marginTop:16, fontSize:13, color:C.dim }}>
                    Showing {filteredGigs.length} of {gigs.length} gigs
                    {filteredGigs.length>0 && (
                      <span> · <span style={{ color:C.red, cursor:"pointer" }} onClick={()=>exportICal(filteredGigs)}>Export all to iCal</span></span>
                    )}
                  </div>
                </>
            }
          </div>
        )}
      </div>

      <GigModal gig={selGig} bands={bands} venues={venues} onClose={()=>setSelGig(null)} />
    </div>
  );
}
