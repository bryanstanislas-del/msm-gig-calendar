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
const GENRES = ["Indie Rock","Electronic","Folk","Shoegaze","Jazz","Metal","Hip-Hop","Pop","Classical","Punk","Country","Blues","Reggae","Soul","R&B","Acoustic","Alternative","Rock","Hard Rock","Dance","Americana","World Music","Comedy","Spoken Word","Other"];
const MONTHS  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS    = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

const GENRE_COLORS = {
  "Indie Rock":   "#e8203a",
  "Electronic":   "#9b5de5",
  "Folk":         "#f4a261",
  "Shoegaze":     "#c77dff",
  "Jazz":         "#43aa8b",
  "Metal":        "#ff595e",
  "Hip-Hop":      "#ff9f1c",
  "Pop":          "#ff6b9d",
  "Classical":    "#90e0ef",
  "Punk":         "#ff4d00",
  "Country":      "#c9a227",
  "Blues":        "#1a78c2",
  "Reggae":       "#2dc653",
  "Soul":         "#e040fb",
  "R&B":          "#ce93d8",
  "Acoustic":     "#a5d6a7",
  "Alternative":  "#ef5350",
  "Rock":         "#ff7043",
  "Hard Rock":    "#b71c1c",
  "Dance":        "#00e5ff",
  "Americana":    "#d4a373",
  "World Music":  "#52b788",
  "Comedy":       "#ffd600",
  "Spoken Word":  "#90a4ae",
  "Other":        "#888888",
};

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

// ── DB abstraction (mock or real) ──────────────────────────────────
const DB = {
  async signUp(email, password, profile) {
    if (USE_MOCK) {
      const id = `user_${Date.now()}`;
      MOCK_USERS[email] = { id, email, password, role:"band", band_name: profile.band_name };
      MOCK_USER    = { id, email };
      MOCK_PROFILE = { id, role:"band", ...profile };
      return { user: MOCK_USER, profile: MOCK_PROFILE };
    }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { band_name: profile.band_name } }
    });
    if (error) throw new Error(error.message);
    const user = data.user;
    if (!user) throw new Error("Account created! Please sign in.");
    try {
      // Generate slug from band name
      const { data: slugData } = await supabase.rpc("generate_band_slug", { band_name: profile.band_name });
      await supabase.from("profiles").upsert({ id: user.id, ...profile, band_slug: slugData, band_status: "active" });
    } catch(e) { console.warn("Profile update failed", e); }
    return { user, profile: { role:"band", ...profile } };
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
    const user = data.user;
    let profile = { role:"band", band_name:"" };
    try {
      const { data: profiles } = await supabase.from("profiles").select("*").eq("id", user.id);
      if (profiles && profiles.length > 0) profile = profiles[0];
    } catch(e) { console.warn("Profile fetch failed", e); }
    return { user, profile, token: data.session?.access_token };
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

  async updateProfile(userId, updates) {
    if (USE_MOCK) return updates;
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select();
    if (error) throw new Error(error.message);
    return data[0];
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
      { id:"band1", band_name:"The Velvet Wolves", city:"London", genre:"Indie Rock", website:"https://example.com", instagram:"@velvetwolves", facebook:"", twitter:"", spotify:"", phone:"07700900123", bio:"Indie rock four-piece from London.", photo_url:"", role:"band" },
    ];
    let query = supabase.from("profiles").select("*").eq("role","band").order("band_name");
    if (!includeDisabled) query = query.or("disabled.is.null,disabled.eq.false");
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
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

  async getVenueBySlug(slug) {
    if (USE_MOCK) return null;
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .eq("slug", slug);
    if (error || !data || data.length === 0) return null;
    return data[0];
  },

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

  async deleteGig(gigId) {
    if (USE_MOCK) { MOCK_GIGS = MOCK_GIGS.filter(g => g.id !== gigId); return; }
    const { error } = await supabase.from("gigs").delete().eq("id", gigId);
    if (error) throw new Error(error.message);
  },
};

// ── MSM Logo ────────────────────────────────────────────────────────
// Uses the exact uploaded brand asset.
// showWordmark=true  → full logo (monogram + MUSIC SCENE MAGAZINE)
// showWordmark=false → monogram crop only (top ~60% of image)
const MSM_LOGO_SRC = "data:image/png;base64,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4KILIGAUhSMrRu6++56f/uRnvu+xZU97IvLKV75yw4YNZ511FjN7FbJsPM/72te/Nj4+rpUSEZtqCqJSmVtZJJMKPFfNDlODMe5eFDpmJunyjEjFTl0a1I5peFX+cWpNNWJbYq31tH7wwQff+pa3HXPM0WeedealX770zj/dGUShX/K1r50LtNY6RKLWen5+/thjn/mh//yg42RJB7DYz2mQljC0277oLqTsfjU/P+80YR0Ho7VcqVQGBqqS1bTMAac2wg7pt84pWUdJemVaRTd80kBwjW1r7ZcuvfRZzzruhBP+9qKLPvr73/9ufHzcUWs5xjsTRiaywKBQRTVrQv7IRz6y9z77sLUqRfWJOReUzgrcUkQunSInS40AUB2olitlFhYn3dx2/Yjdi+HYM0XuwCulMZMJBQYg4tTk5PZt27dv3759+7bt27fv2LHj8ccff3zn4zt27Ni+fce2HTse37lzbGxsenamv5p02yWlejjuOLh/uwJjtVr92c9//p//+eFSyQ/CwDEmhmH47//+70c//elTU1OuCNSMpBOPijk679itrNi8StKx3KOATE9NPf7446PuNTY2NjY2Ojo6Njq2c+fO7Tu2b9u2dfv27WPj4/Nzc0vvYgAWNdFLyXMKOoJisq+os8qzLRq/y1Kb7A6i6WussEHY05daeYbcdusmizdiUp347Gc/89KXnYwEpAgRj3nGMZdccsmKFSssW0VKlExPT3/5sssQMYyiNuwZ5RNUdIgJZjckYspHaubrkTHQxAJkA3/irjsiKQQDKaJ0VxfvMRcqLfr1SeU9pg9WALh9+45vX/ntb1/57XK5fMABBxx11FHHHXfcs5/97IMOOig+80Is7OlyFNozzzzzwx/68Lbt20hRY3RJuj6XWPJeloQ7ztNR27nz8ZnZ6cHBIQeaiKxZtXLV4Ycf/vDDj7Rlk80IsaH+iA04H3e23QuORWSmRH31hDDzyzrWydm+MIquu+766667Xiu11957H3744UcfffQznvGMpx7+1DVr11jD1hiXyNWD2qqVq84959Uf/OCHFCkLFtsrGR3N7BbYIoyPjc3MTK8YGTHWIqootKtXrdp77722bNmKRJBqr3YytCEhITW1HqEblK5goxUBiTAMje/7H/jgB6741hWeX7Imcg/SYUMsM1sGFEJCoqnpKU0kbBFbnhT2ahmm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M9bF5WPTPv7ss88Ow8haW1tYiMLIGmsiU68HDecRqxUaY601kQnqoRN1u/6664aGhnKL3gVYP5qt2dZD0QYTK+JcMfkIp4v7jGc84+GHHxaRMIxrnq6SbyLb9rzqQRCGURSZMFGv/cAHP9hY2JzeLXaj3kZURI645y1veUv8LQu1oB5EYeRijvZNa4y1HEVmYaHmruG//usjAFAq+aoTudD1scauqFQGgEu/dKmLC2NuaWujMArD0EU9URSZKArDMAyjMAiDelAPwnoQBmE4MzNjjDn//PMBoOJp6glnaHPDpRIAvP9973OlUWvZncRzzz0XAPy2KjqiI2O75NOfdnubrTjZQhdJn3veuQBQ8v0GQUGPAiY218HF9640GgahNdYa47B+URhFLjqIojAIgyAI47WIwjAKw7Beq0dR9Nhjj+61156uX5jdnlxUCoS5sV0hD4B9BIfdKvmZP9RaF6VYawF9ZQCHuqWibTP8xQECPW9yKQAk9zlujMZGNgojawxbbtyMqxHd9ee7XvGKV77u9a//+7//+9e//vWnnXb69m3bQdIcieTKdzbecjYykRvEya0bd7Cata05M3ta33777S972cseevihSqWsNIlYAFFKIWAD++Bmh4VZhH3fq1YrP/zhD1/xilc65R1pSr20r1oLD1nHTDlbG5noLf/4lje/6U1jY6Olsq89JcCIMQ+hMc6kRMbEY2euRFwqlf7nf/7n5S9/+ejozoYSVQN/6GYUsDuNX1L0dpRQjq3GOn8fmbw91pNFzr0ziiLf97/1rW+dfvpp27ZtK1cqSitHner0umMuLmtF4toaC/slr87+SGUAAIF2SURBVFIpf/3rXzv95afPzc01phQ6fVgm60c8lNl6JW2HogUmJhkX32kwGgSExlql9E033fS85z3vhz/4oef57kbYslIKqUmv5TwQueqYiOfpcrn8qYs/+f73/YfWmt0UXYMfKs2V0UUYLgHZWmN837/44otPO/XULVseK1XKjbV1ARlzrGPtTCSzBZBKpUxE//Iv7/qXf3mnUioMIyvtTGuZEQO0r7YAgLtRp/bAzGy5OW0ljrwweQ4ISKgcG07q3AGAFWiHjxYaJQSnwWKlsYlsFIUA7cNDIsLWaM/7t3/7tztuv71cLodh4K7cJLEXNNlPeqozxlCeFk4oFmtjGGxM9yHxJIVLz1ts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yr0bPHjQ2ed8dfas2bt27kLGEEBKOezII8ecOW758uWrV67SdYEEppR9+va94IKJixcv/nzN54yhzLa7U1qK4cQLJ/bt29dIGohoShMBdV1njMfj8bpNm2bMmMEZAlmSUBJIKYcMGXL++eefeuqppmkuWLBg+ozpTY1N6hQcfbLM5pSVlV046cLKikouBBdcWpayUCRJXY+tXLHik08+yfjll1x6qWEkp02dxjkDAs7BkhiPx79+ycU7d+6er9jBkoAopTzvvAmDBg2WQAhIJBljDJmm6w31+9566y3DtMDmvufsAAHUApyHXCATRLPJ3KXcMgAEOBd4FUOd4HOSa5A4ADImiQYQnEFoAM4B80Ca8TnAOSgGE64Ccwmm3AtK+50nIT8J2WBiCaJNAPO4bADJ0h63umYksqOBbyD5aadbmFKHJlBvYOeiGEQsBrAJYB4YO8niAFYhVcQ4tyyrR88eF0+++PTTTxea9unixTNnzarbtIkxZo9tMATGmGnJwYMHX/C1C0aNHp1IJhYuXDht2tSmxibBmWlJAFBhqqOOOurss89KRwwoFYYhShrGO2+/09LSouxsSfK0kaedeNLJM95/b8+XezjnQBI4tyzroosu0jT9jddfA8CMGDn77LOOOeYYIkAVUiEkklzwhvqGN998yzRNIukiNcOETCPUfKV4riZECTrLhHV6IrYUfOSEGDIuRLdutUs++yyRSBx91FHK9FZCtqK8Ys3q1c0tLUcffbRIDepgAHDEEUNnTJ9ORJu3bF6wYMGXX+4hojfffLNP375KZyCAxrmmafF4vG5z3caNG+OxmKZryusQQtTW1Nbv3Td16juZx8ViMQCYMmUKEW3atHHTpk11m+vqNtft27ePiKZOndqzZy/GmBDczbtS1uigQYNM0zQMY9euXbt37965c+eOnTt27d61ffu2o485JhMA6NWj594v9yQSidVrVq35fM269es21W1qaWkhogf/9CchhPKo7HbumDPGrFy5kog+//zzRYsWNTU1EdGf/vQnTdM452qHlds6bNiwxqZGIrriiisAIB7TlfF77IgRRPSTn/wEAHRdB4Bjjz12w4YNW7dt3bZ9W0NDAxG1trZu3bp148aNO3ft+vZNN+V7QpgKqKKmaZWVlWvXrrWkXLd+3aZNGzdsWrd+w9qDBw8Q0UMPP8w5F0LwdOhU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";

function MSMLogo({ height = 80, showWordmark = true }) {
  // The logo image has a black background and ~4:3 ratio (1390×1042px source).
  // We clip to the top 62% when showWordmark=false to show monogram only.
  const aspectRatio = 1390 / 1042;
  const imgHeight = showWordmark ? height : height / 0.62;
  const imgWidth  = imgHeight * aspectRatio;
  return (
    <div style={{
      height,
      width: showWordmark ? imgWidth : imgWidth * 0.62,
      overflow: "hidden",
      flexShrink: 0,
      display: "flex",
      alignItems: "flex-start",
    }}>
      <img
        src={MSM_LOGO_SRC}
        alt="Music Scene Magazine"
        style={{
          height: imgHeight,
          width:  imgWidth,
          objectFit: "cover",
          objectPosition: "top center",
          display: "block",
        }}
      />
    </div>
  );
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

// ── Profile completeness ───────────────────────────────────────────
function getProfileCompleteness(profile) {
  const fields = [
    { key:"band_name",  label:"Band Name",  weight:20 },
    { key:"city",       label:"City",       weight:10 },
    { key:"genre",      label:"Genre",      weight:10 },
    { key:"bio",        label:"Bio",        weight:15 },
    { key:"website",    label:"Website",    weight:10 },
    { key:"spotify",    label:"Spotify",    weight:15 },
    { key:"instagram",  label:"Instagram",  weight:10 },
    { key:"facebook",   label:"Facebook",   weight:5  },
    { key:"photo_url",  label:"Photo",      weight:5  },
  ];
  const completed  = fields.filter(f => profile?.[f.key]);
  const score      = completed.reduce((acc, f) => acc + f.weight, 0);
  const missing    = fields.filter(f => !profile?.[f.key]).map(f => f.label);
  return { score, missing, completed: completed.length, total: fields.length };
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
const C = {
  bg:"#0d0d0d", surface:"#111", surfaceHigh:"#161616",
  border:"rgba(255,255,255,0.07)", borderStrong:"rgba(255,255,255,0.12)",
  red:"#e8203a", redDim:"rgba(232,32,58,0.15)",
  white:"#fff", muted:"#555", dim:"#333",
  green:"#43aa8b", amber:"#f4a261",
};
const F = { display:"'Bebas Neue',sans-serif", body:"'Barlow',sans-serif" };

const inputCss = {
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
const SectionLabel = ({ children }) => (
  <div style={{ marginBottom:20 }}>
    <div style={{ fontFamily:F.display, fontSize:18, color:C.red, letterSpacing:3 }}>{children}</div>
    <div style={{ width:28, height:2, background:C.red, marginTop:5 }} />
  </div>
);

const Badge = ({ label, color }) => (
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

const Btn = ({ children, onClick, variant="primary", style={}, disabled=false }) => (
  <button onClick={onClick} disabled={disabled}
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
//  AUTH PANEL
// ════════════════════════════════════════════════════════════════════
function AuthPanel({ onAuth, onBack }) {
  const [mode, setMode]   = useState("login");
  const [err,   setErr]   = useState("");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");

  // Register fields
  const emptyReg = { band_name:"", city:"", website:"", instagram:"", facebook:"", twitter:"", spotify:"", genre:"Indie Rock", phone:"", bio:"", photo_url:"" };
  const [reg, setReg] = useState(emptyReg);
  const [regEmail, setRegEmail] = useState("");
  const [regPass,  setRegPass]  = useState("");
  const [regPass2, setRegPass2] = useState("");

  const setR = k => e => setReg(r=>({...r,[k]:e.target.value}));

  const submit = async () => {
    setErr(""); setLoading(true);
    try {
      if (mode === "login") {
        const result = await DB.signIn(email, pass);
        onAuth(result);
      } else {
        if (!reg.band_name.trim()) { setErr("Band name is required"); setLoading(false); return; }
        if (!regEmail.trim())      { setErr("Email is required"); setLoading(false); return; }
        if (regPass.length < 6)    { setErr("Password must be at least 6 characters"); setLoading(false); return; }
        if (regPass !== regPass2)  { setErr("Passwords don't match"); setLoading(false); return; }
        const result = await DB.signUp(regEmail, regPass, reg);
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
            {[["login","SIGN IN"],["register","REGISTER BAND"]].map(([m,l]) => (
              <button key={m} onClick={()=>{ setMode(m); setErr(""); }}
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
              <div style={{ fontFamily:F.display, fontSize:13, color:C.red, letterSpacing:2, marginBottom:4 }}>ACCOUNT DETAILS</div>
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
            </div>
          )}

          {err && <div style={{ color:C.red, fontSize:12, marginTop:12 }}>{err}</div>}

          <Btn onClick={submit} disabled={loading} style={{ width:"100%", marginTop:20, padding:"13px" }}>
            {loading ? "PLEASE WAIT..." : mode==="login" ? "SIGN IN →" : "CREATE ACCOUNT →"}
          </Btn>
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

  const { score, missing } = getProfileCompleteness(profile);

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
            Missing: <span style={{ color:C.amber }}>{missing.join(", ")}</span>
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
function AdminPanel({ allGigs, onRefresh }) {
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState({});

  const visible = allGigs.filter(g => filter === "all" ? true : g.status === filter);

  const action = async (gigId, status) => {
    setLoading(l=>({...l,[gigId]:true}));
    await DB.updateGigStatus(gigId, status);
    await onRefresh();
    setLoading(l=>({...l,[gigId]:false}));
  };

  const remove = async (gigId) => {
    if (!confirm("Delete this gig permanently?")) return;
    setLoading(l=>({...l,[gigId]:true}));
    await DB.deleteGig(gigId);
    await onRefresh();
  };

  const counts = { all:allGigs.length, pending:allGigs.filter(g=>g.status==="pending").length, approved:allGigs.filter(g=>g.status==="approved").length, rejected:allGigs.filter(g=>g.status==="rejected").length };

  return (
    <div>
      <SectionLabel>ADMIN — MODERATION PANEL</SectionLabel>

      {/* Filter tabs */}
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

      {visible.length === 0 && (
        <div style={{ color:C.dim, fontSize:13, padding:"24px 0" }}>No gigs in this category.</div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {visible.map(g => {
          const color = GENRE_COLORS[g.genre]||"#888";
          const spin  = loading[g.id];
          return (
            <div key={g.id} style={{
              background:C.surfaceHigh, border:`1px solid ${C.border}`,
              borderLeft:`3px solid ${color}`, borderRadius:6, padding:"14px 16px",
            }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:200 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:4 }}>
                    {(() => { const bp = bands.find(b=>b.band_name?.toLowerCase()===g.band_name?.toLowerCase()); return bp?.band_slug ? <Link to={`/artist/${bp.band_slug}`} style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color:C.white, textDecoration:"none" }} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.white}>{g.band_name}</Link> : <span style={{ fontFamily:F.display, fontSize:16, letterSpacing:1.5, color:C.white }}>{g.band_name}</span>; })()}
                    <StatusBadge status={g.status} />
                    <Badge label={g.genre} color={color} />
              {g.is_recurring && <Badge label="↻" color={C.amber} />}
                  </div>
                  <div style={{ fontSize:12, color:C.muted }}>{g.venue} · {g.city}</div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{fmtDate(g.date)} at {g.time}{g.notes ? ` · ${g.notes}` : ""}</div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  {g.status !== "approved"  && <Btn variant="success" onClick={()=>action(g.id,"approved")}  disabled={spin}>✓ APPROVE</Btn>}
                  {g.status !== "rejected"  && <Btn variant="ghost"   onClick={()=>action(g.id,"rejected")}  disabled={spin}>✗ REJECT</Btn>}
                  <Btn variant="danger" onClick={()=>remove(g.id)} disabled={spin}>🗑</Btn>
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
function CalendarView({ gigs, onGigClick, bands=[] }) {
  const todayStr = today();
  const [y, setY] = useState(new Date().getFullYear());
  const [m, setM] = useState(new Date().getMonth());

  const gigMap = useMemo(() => {
    const map = {};
    gigs.forEach(g => {
      // Generate all dates between start and end
      const start = new Date(g.date);
      const end   = g.end_date ? new Date(g.end_date) : start;
      const cur   = new Date(start);
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
        <button onClick={prevM} style={{ background:"none", border:`1px solid ${C.border}`, color:C.white, width:36, height:36, borderRadius:5, cursor:"pointer", fontSize:20 }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div className="msm-month-title" style={{ fontFamily:F.display, fontSize:30, letterSpacing:4, color:C.white }}>{MONTHS[m].toUpperCase()} {y}</div>
          <div style={{ width:36, height:2, background:C.red, margin:"4px auto 0" }} />
        </div>
        <button onClick={nextM} style={{ background:"none", border:`1px solid ${C.border}`, color:C.white, width:36, height:36, borderRadius:5, cursor:"pointer", fontSize:20 }}>›</button>
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
                  <div key={g.id} onClick={()=>onGigClick(g)}
                    className="msm-gig-label"
                    style={{
                      display:"flex", alignItems:"center", gap:4,
                      background:`${GENRE_COLORS[g.genre]||"#888"}40`,
                      borderLeft:`3px solid ${GENRE_COLORS[g.genre]||"#888"}`,
                      borderRadius:2, padding:"3px 6px",
                      cursor:"pointer",
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
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="msm-legend" style={{ marginTop:20, display:"flex", flexWrap:"wrap", gap:"12px 24px" }}>
        {Object.entries(GENRE_COLORS).map(([g,c])=>(
          <div key={g} style={{ display:"flex", alignItems:"center", gap:8, fontSize:15, color:C.muted }}>
            <span style={{ width:14, height:14, borderRadius:"50%", background:c, display:"inline-block", flexShrink:0, boxShadow:`0 0 6px ${c}99` }} />
            {g}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  LIST VIEW
// ════════════════════════════════════════════════════════════════════
function ListView({ gigs, onGigClick, bands=[] }) {
  const sorted = [...gigs].sort((a,b)=>a.date.localeCompare(b.date));
  if (!sorted.length) return <div style={{ color:C.dim, fontSize:13, padding:"24px 0" }}>No gigs match your filters.</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {sorted.map(g => {
        const color = GENRE_COLORS[g.genre]||"#888";
        return (
          <div key={g.id} onClick={()=>onGigClick(g)} style={{
            display:"flex", alignItems:"center", gap:14, padding:"13px 16px",
            background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${color}`, borderRadius:6, cursor:"pointer",
          }}
            onMouseEnter={e=>e.currentTarget.style.background=C.redDim}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
          >
            <div style={{ flex:1 }}>
              {(() => { const bp = bands.find(b=>b.band_name?.toLowerCase()===g.band_name?.toLowerCase()); return bp?.band_slug ? <Link to={`/artist/${bp.band_slug}`} style={{ fontFamily:F.display, fontSize:15, letterSpacing:1.5, color:C.white, textDecoration:"none", display:"block" }} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.white}>{g.band_name}</Link> : <div style={{ fontFamily:F.display, fontSize:15, letterSpacing:1.5, color:C.white }}>{g.band_name}</div>; })()}
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{g.venue} · {g.city}</div>
            </div>
            <Badge label={g.genre} color={color} />
            <div style={{ textAlign:"right", minWidth:90 }}>
              <div style={{ fontSize:12, color:C.red, fontFamily:F.display, letterSpacing:1 }}>
                {fmtDate(g.date)}{g.end_date ? ` — ${fmtDate(g.end_date)}` : ""}
              </div>
              <div style={{ fontSize:11, color:C.dim }}>{g.time}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  GIG MODAL
// ════════════════════════════════════════════════════════════════════
function GigModal({ gig, onClose, bands=[] }) {
  if (!gig) return null;
  const color    = GENRE_COLORS[gig.genre]||"#888";
  // Find matching band profile for artist page link
  const bandProfile = bands.find(b =>
    b.band_name?.toLowerCase() === gig.band_name?.toLowerCase()
  );
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
          {bandProfile?.band_slug
            ? <Link to={`/artist/${bandProfile.band_slug}`} onClick={onClose}
                style={{ color:C.white, textDecoration:"none" }}
                onMouseEnter={e=>e.currentTarget.style.color=C.red}
                onMouseLeave={e=>e.currentTarget.style.color=C.white}
              >{gig.band_name}</Link>
            : gig.band_name
          }
        </div>
        {bandProfile?.band_slug && (
          <Link to={`/artist/${bandProfile.band_slug}`} onClick={onClose}
            style={{ fontSize:11, color:C.red, textDecoration:"none", letterSpacing:1 }}
          >VIEW ARTIST PAGE →</Link>
        )}
        <div style={{ fontSize:13, color:C.muted, margin:"6px 0 20px" }}>{gig.venue} · {gig.city}</div>
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
//  ADMIN BANDS
// ════════════════════════════════════════════════════════════════════
function AdminBands({ bands, onRefresh }) {
  const [view,       setView]       = useState("list"); // list | create | edit
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState(null);
  const [creating,   setCreating]   = useState(false);
  const [msg,        setMsg]        = useState({ text:"", type:"" });

  // ── Create band form state ──
  const emptyCreate = { band_name:"", email:"", password:"" };
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

      // Upsert profile
      const { error: profileError } = await supabase.from("profiles").upsert({
        id:            user.id,
        band_name:     createForm.band_name,
        role:          "band",
        band_slug:     slugData,
        band_status:   "active",
        admin_created: true,
        disabled:      false,
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
      bio:                 band.bio                 || "",
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
      showMsg("✓ Profile updated successfully");
      setView("list");
      if (onRefresh) onRefresh();
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
          const color     = GENRE_COLORS[b.primary_genre||b.genre] || "#888";
          const { score } = getProfileCompleteness(b);
          const scoreCol  = score===100 ? C.green : score>=60 ? C.amber : C.red;
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
                  {/* Completeness bar */}
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
                    <div style={{ width:60, background:"rgba(255,255,255,0.08)", borderRadius:3, height:3 }}>
                      <div style={{ width:`${score}%`, height:"100%", background:scoreCol, borderRadius:3 }} />
                    </div>
                    <span style={{ fontSize:10, color:scoreCol }}>{score}%</span>
                    {score < 60 && <span style={{ fontSize:10, color:C.amber }}>⚠ Incomplete</span>}
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
    <div style={{ maxWidth:560 }}>
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
          Creates a Supabase auth account and band profile. The band can log in immediately using these credentials and update their own profile.
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="BAND / ARTIST NAME" value={createForm.band_name} onChange={setC("band_name")} required />
          <Input label="EMAIL ADDRESS" type="email" value={createForm.email} onChange={setC("email")} required />
          <Input label="TEMPORARY PASSWORD" type="text" value={createForm.password} onChange={setC("password")} required />
          <div style={{ fontSize:11, color:C.dim }}>
            💡 Use a simple temporary password. Advise the band to change it after first login.
          </div>
        </div>
        <Btn onClick={handleCreate} disabled={creating} style={{ width:"100%", marginTop:20, padding:"13px" }}>
          {creating ? "CREATING..." : "CREATE BAND ACCOUNT →"}
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
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ display:"block", fontSize:13, color:C.white, letterSpacing:2, marginBottom:6, fontFamily:F.display }}>BIO</label>
            <textarea value={editForm.bio} onChange={setE("bio")} rows={4}
              style={{ ...inputCss, resize:"vertical" }}
              placeholder="Band biography..."
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
    genre:               profile?.genre               || "Indie Rock",
    primary_genre:       profile?.primary_genre       || "",
    secondary_genre:     profile?.secondary_genre     || "",
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
  });
  const [status, setStatus] = useState("idle");
  const [msg,    setMsg]    = useState("");

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const { score, missing } = getProfileCompleteness(form);

  const save = async () => {
    setStatus("loading");
    try {
      const updated = await DB.updateProfile(user.id, { ...form, claimed: true });
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
    ? `https://musicscenemagazine.co.uk/artist/${profile.band_slug}`
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
            Missing: <span style={{ color:C.amber }}>{missing.join(", ")}</span>
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
//  PUBLIC BAND PROFILE PAGE
// ════════════════════════════════════════════════════════════════════
function BandProfilePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [band, setBand]   = useState(null);
  const [gigs, setGigs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const b = await DB.getBandBySlug(slug);
      if (!b) { setLoading(false); return; }
      setBand(b);
      const g = await DB.getGigsByBand(b.band_name, b.id);
      setGigs(g);
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
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16, alignItems:"center" }}>
              {band.primary_genre && <Badge label={band.primary_genre} color={color} />}
              {band.secondary_genre && <Badge label={band.secondary_genre} color={C.muted} />}
              {band.city && <span style={{ fontSize:13, color:"#cccccc" }}>📍 {band.city}</span>}
              {band.formation_year && <span style={{ fontSize:13, color:"#aaaaaa" }}>Est. {band.formation_year}</span>}
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
                  <div style={{ fontFamily:F.display, fontSize:16, color:C.red, letterSpacing:1, minWidth:120 }}>{fmtDate(g.date)}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:15, color:"#ffffff" }}>{g.venue}</div>
                    <div style={{ fontSize:13, color:"#aaaaaa" }}>{g.city}</div>
                  </div>
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
                <div key={g.id} style={{
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
              ))}
            </div>
          </div>
        )}

        {/* Follow placeholder — reserved for future */}
        <div style={{ padding:24, background:"rgba(255,255,255,0.02)", border:`1px dashed ${C.border}`, borderRadius:8, textAlign:"center" }}>
          <div style={{ fontSize:13, color:C.dim, letterSpacing:1 }}>🔔 FOLLOW THIS BAND — Coming Soon</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>Get notified when {band.band_name} adds new gigs</div>
        </div>
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

  const handlePreview = () => {
    if (!text.trim()) return;
    const parsed = parseGigText(text);
    setRows(parsed.map((r, i) => ({
      ...r,
      id:          i,
      time:        r.time || defaultTime,
      genre:       selectedBandObj?.primary_genre || selectedBandObj?.genre || "Other",
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
          genre:           row.genre || "Other",
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
            {selectedBandObj.primary_genre && <> · <span style={{ color:GENRE_COLORS[selectedBandObj.primary_genre]||C.red }}>{selectedBandObj.primary_genre}</span></>}
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
//  ADMIN VENUES
// ════════════════════════════════════════════════════════════════════
function AdminVenues({ venues, allGigs, onRefresh }) {
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
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (v.name||"").toLowerCase().includes(q) ||
           (v.city||"").toLowerCase().includes(q);
  }).sort((a,b) => (gigCounts[b.id]||0) - (gigCounts[a.id]||0));

  const openEdit = (venue) => {
    setSelected(venue);
    setEditForm({
      name:        venue.name        || "",
      city:        venue.city        || "",
      description: venue.description || "",
      website:     venue.website     || "",
      facebook:    venue.facebook    || "",
      instagram:   venue.instagram   || "",
      twitter:     venue.twitter     || "",
      photo_url:   venue.photo_url   || "",
    });
    setView("edit");
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
        <div style={{ fontSize:12, color:C.muted }}>Venues are created automatically from gig data</div>
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
          <div style={{ gridColumn:"1/-1" }}>
            <Input label="CITY / TOWN" value={editForm.city} onChange={setE("city")} required />
          </div>
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
//  GLOBAL CSS
// ════════════════════════════════════════════════════════════════════
const GLOBAL_CSS = `
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
    .msm-header { height:56px !important; padding:0 14px !important; }
    .msm-logo-wrap img { height:40px !important; }
    .msm-tagline { padding:7px 14px !important; flex-wrap:wrap; gap:6px !important; }
    .msm-tagline span { font-size:10px !important; }
    .msm-nav { padding:0 8px !important; gap:0 !important; overflow-x:auto; }
    .msm-nav button { padding:12px 10px !important; font-size:12px !important; white-space:nowrap; }
    .msm-main { padding:16px 10px !important; }
    .msm-filters { flex-direction:column !important; gap:8px !important; padding:12px !important; }
    .msm-filters > div { flex:unset !important; width:100% !important; }
    .msm-filter-btns { width:100% !important; justify-content:stretch !important; }
    .msm-filter-btns button { flex:1 !important; }
    .msm-cal-cell { min-height:60px !important; padding:4px 3px !important; }
    .msm-cal-day { font-size:10px !important; }
    .msm-gig-label { padding:2px 3px !important; }
    .msm-gig-label span:last-child { font-size:9px !important; }
    .msm-gig-dot { width:5px !important; height:5px !important; }
    .msm-legend { gap:6px 12px !important; margin-top:12px !important; }
    .msm-legend > div { font-size:11px !important; }
    .msm-month-title { font-size:20px !important; }
    .msm-day-header { font-size:9px !important; }
    .msm-signin-btn { font-size:11px !important; padding:6px 10px !important; }
    .msm-account { display:none !important; }
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
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

function MainApp() {
  const [auth,    setAuth]    = useState(null); // { user, profile, token }
  const [gigs,    setGigs]    = useState([]);
  const [allGigs, setAllGigs] = useState([]);   // admin only
  const [bands,   setBands]   = useState([]);    // admin only
  const [venues,  setVenues]  = useState([]);    // admin only
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("calendar"); // calendar | list | submit | admin
  const [selGig,  setSelGig]  = useState(null);
  const [filters, setFilters] = useState({ city:"All", venue:"All", genre:"All", dateFrom:"", dateTo:"" });
  const [search, setSearch]   = useState("");

  const isAdmin = auth?.profile?.role === "admin";

  // Load public gigs and bands on mount
  useEffect(() => {
    DB.getApprovedGigs().then(data=>{ setGigs(data); setLoading(false); });
    DB.getBands().then(setBands);
  }, []);

  // Load all gigs when admin logs in
  useEffect(() => {
    if (isAdmin) {
      DB.getAllGigs().then(setAllGigs);
      DB.getBands(true).then(setBands);
      DB.getVenues().then(setVenues);
    }
  }, [isAdmin, auth]);

  const refreshAdmin = useCallback(async () => {
    const fresh = await DB.getAllGigs();
    setAllGigs(fresh);
    const approvedFresh = fresh.filter(g=>g.status==="approved");
    setGigs(approvedFresh);
    const freshBands = await DB.getBands(true);
    setBands(freshBands);
    const freshVenues = await DB.getVenues();
    setVenues(freshVenues);
  }, [auth]);

  const handleAuth = (result) => { setAuth(result); setTab("submit"); };
  const handleSignOut = async () => { 
    try { await DB.signOut(); } catch(e) { console.warn("Sign out error", e); }
    setAuth(null); 
    setTab("calendar");
  };

  // Apply filters to public gigs
  const filteredGigs = useMemo(() => gigs.filter(g => {
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
  }), [gigs, filters, search]);

  // If user clicked Submit Gig or Admin tab and isn't logged in, show auth panel
  if (!auth && (tab === "submit" || tab === "admin")) {
    return <AuthPanel onAuth={handleAuth} onBack={()=>setTab("calendar")} />;
  }

  const tabDef = [
    { id:"calendar", label:"CALENDAR" },
    { id:"list",     label:"LIST VIEW" },
    { id:"stats",    label:"STATS" },
    { id:"submit",   label:"SUBMIT GIG" },
    ...(auth ? [{ id:"profile", label:"MY PROFILE" }] : []),
    ...(isAdmin ? [
      { id:"admin",  label:`ADMIN (${allGigs.filter(g=>g.status==="pending").length})` },
      { id:"bands",  label:`BANDS (${bands.length})` },
      { id:"import", label:"BULK IMPORT" },
      { id:"venues", label:`VENUES (${venues.length})` },
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
          <MSMLogo height={56} showWordmark={true} />
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
            <Btn variant="ghost" onClick={()=>setTab("submit")} className="msm-signin-btn" style={{ fontSize:13, padding:"9px 18px" }}>BAND LOGIN</Btn>
          )}
        </div>
      </header>

      {/* ── Hero tagline ── */}
      <div className="msm-tagline" style={{ background:"linear-gradient(90deg,#1a0000,#0d0d0d 40%,#0d0d0d 60%,#0a0018)", borderBottom:`1px solid rgba(232,32,58,0.2)`, padding:"10px 28px", display:"flex", alignItems:"center", gap:10 }}>
        {["REAL MUSIC.","REAL PEOPLE.","REAL SCENES."].map((s,i)=>(
          <span key={i} style={{ fontSize:13, color:C.red, letterSpacing:3, fontFamily:F.display }}>{s}{i<2&&<span style={{ color:"rgba(255,255,255,0.1)", margin:"0 8px" }}>|</span>}</span>
        ))}
        <div style={{ marginLeft:"auto", fontSize:13, color:C.dim, letterSpacing:1 }}>{gigs.length} GIGS LIVE</div>
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

        {/* VENUES */}
        {tab==="venues" && isAdmin && (
          <AdminVenues venues={venues} allGigs={allGigs} onRefresh={refreshAdmin} />
        )}

        {/* BULK IMPORT */}
        {tab==="import" && isAdmin && (
          <BulkImport bands={bands} onImported={refreshAdmin} />
        )}

        {/* BANDS */}
        {tab==="bands" && isAdmin && (
          <AdminBands bands={bands} onRefresh={refreshAdmin} />
        )}

        {/* ADMIN */}
        {tab==="admin" && isAdmin && (
          <AdminPanel allGigs={allGigs} onRefresh={refreshAdmin} />
        )}

        {/* MY PROFILE */}
        {tab==="profile" && auth && (
          <EditProfile user={auth.user} profile={auth.profile} onSaved={(updatedProfile)=>{
            setAuth(a => ({ ...a, profile: updatedProfile }));
          }} />
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
                  <FiltersBar
                    gigs={gigs}
                    filters={filters}
                    setFilters={setFilters}
                    onExport={()=>exportICal(filteredGigs)}
                  />
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

      <GigModal gig={selGig} bands={bands} onClose={()=>setSelGig(null)} />
    </div>
  );
}
