/**
 * ClaimDirectoryPage.jsx — Stage 1 (Public Claim UI)
 * MSM Gig Calendar | "Claim an Artist or Venue Profile"
 *
 * Public, unauthenticated directory of unclaimed / claim-pending artist and
 * venue profiles. Reuses the exact shared style constants/components from
 * App.jsx (C, F, Badge, ClaimStatusBadge, SectionLabel, MSMLogo, GLOBAL_CSS,
 * inputCss) rather than duplicating them, so this page stays visually
 * identical to the rest of the site with a single source of truth.
 *
 * Fetching is deliberately narrow-column and server-side paginated/searched
 * (via Supabase .select() column lists, .ilike(), .range()) instead of
 * loading every profile/venue into memory client-side. This is designed to
 * scale the same way whether there are dozens of rows (today) or tens of
 * thousands (later) — each interaction fetches one page of just the columns
 * this page actually renders, never a full-table select("*").
 *
 * profiles and venues are separate tables with no shared key. A true
 * unified, single-query pagination across both would need a new backend
 * view or RPC, which is out of scope for a frontend-only stage (and outside
 * the "no further schema changes" instruction for this phase). Instead,
 * "All" runs both queries in parallel, each independently paginated, and
 * merges the two current pages client-side for display. "Artists" and
 * "Venues" each page through a single table normally.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { C, F, Badge, ClaimStatusBadge, SectionLabel, MSMLogo, GLOBAL_CSS, inputCss } from '../App';

const PAGE_SIZE_SINGLE = 24;   // "Artists" or "Venues" filter, one table
const PAGE_SIZE_COMBINED = 12; // "All" filter, per table, merged client-side
const SEARCH_DEBOUNCE_MS = 350;

const PROFILE_TYPE_LABEL = {
  band: 'BAND',
  solo_artist: 'SOLO ARTIST',
  festival: 'FESTIVAL',
  promoter: 'PROMOTER',
};

function profileLinkPath(row) {
  if (row.profile_type === 'festival') return `/festival/${row.band_slug}`;
  if (row.profile_type === 'promoter') return `/promoter/${row.band_slug}`;
  return `/artist/${row.band_slug}`;
}

async function fetchProfilesPage({ page, pageSize, term }) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  let query = supabase
    .from('profiles')
    .select('id, band_name, city, photo_url, band_slug, profile_type, claim_status', { count: 'exact' })
    .neq('claim_status', 'claimed')
    .or('disabled.is.null,disabled.eq.false')
    .order('band_name')
    .range(from, to);
  if (term) query = query.ilike('band_name', `%${term}%`);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: data || [], count: count || 0 };
}

async function fetchVenuesPage({ page, pageSize, term }) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  let query = supabase
    .from('venues')
    .select('id, name, city, photo_url, slug, claim_status', { count: 'exact' })
    .neq('claim_status', 'claimed')
    .order('name')
    .range(from, to);
  if (term) query = query.ilike('name', `%${term}%`);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: data || [], count: count || 0 };
}

function DirectoryCard({ kind, row }) {
  const name = kind === 'venue' ? row.name : row.band_name;
  const linkTo = kind === 'venue' ? `/venue/${row.slug}` : profileLinkPath(row);
  const typeLabel = kind === 'venue' ? 'VENUE' : (PROFILE_TYPE_LABEL[row.profile_type] || 'ARTIST');

  return (
    <div style={{
      background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 16, display: 'flex', gap: 14, alignItems: 'center',
    }}>
      {row.photo_url ? (
        <img src={row.photo_url} alt={name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 56, height: 56, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>
          {kind === 'venue' ? '📍' : '🎸'}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontFamily: F.display, fontSize: 16, letterSpacing: 1, color: C.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <Badge label={typeLabel} color={C.muted} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {row.city && <span style={{ fontSize: 12, color: C.muted }}>📍 {row.city}</span>}
          <ClaimStatusBadge claimStatus={row.claim_status} entityType={kind === 'venue' ? 'venue' : row.profile_type} />
        </div>
      </div>
      <Link to={linkTo} style={{
        flexShrink: 0, textDecoration: 'none', fontFamily: F.display, fontSize: 11, letterSpacing: 1.5,
        color: '#fff', background: row.claim_status === 'pending' ? C.muted : C.red,
        borderRadius: 5, padding: '9px 14px', whiteSpace: 'nowrap',
      }}>
        {row.claim_status === 'pending' ? 'VIEW STATUS' : 'CLAIM THIS PROFILE'}
      </Link>
    </div>
  );
}

export default function ClaimDirectoryPage() {
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState('all'); // all | artists | venues
  const [searchInput, setSearchInput] = useState('');
  const [term, setTerm] = useState('');

  const [profilePage, setProfilePage] = useState(0);
  const [venuePage, setVenuePage] = useState(0);
  const [profileRows, setProfileRows] = useState([]);
  const [venueRows, setVenueRows] = useState([]);
  const [profileCount, setProfileCount] = useState(0);
  const [venueCount, setVenueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const requestId = useRef(0);

  // Debounce the search box so typing doesn't fire a query per keystroke --
  // matters once the directory has more than a handful of rows.
  useEffect(() => {
    const t = setTimeout(() => setTerm(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 0 whenever the filter or the (debounced) search term changes.
  useEffect(() => {
    setProfilePage(0);
    setVenuePage(0);
  }, [filterMode, term]);

  const loadPage = useCallback(async ({ append }) => {
    const myRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const wantProfiles = filterMode === 'all' || filterMode === 'artists';
      const wantVenues   = filterMode === 'all' || filterMode === 'venues';
      const pageSize     = filterMode === 'all' ? PAGE_SIZE_COMBINED : PAGE_SIZE_SINGLE;

      const [profilesResult, venuesResult] = await Promise.all([
        wantProfiles ? fetchProfilesPage({ page: profilePage, pageSize, term }) : Promise.resolve({ rows: [], count: 0 }),
        wantVenues   ? fetchVenuesPage({ page: venuePage, pageSize, term })     : Promise.resolve({ rows: [], count: 0 }),
      ]);

      if (myRequest !== requestId.current) return; // a newer request superseded this one

      setProfileCount(profilesResult.count);
      setVenueCount(venuesResult.count);
      setProfileRows(prev => (append && wantProfiles ? [...prev, ...profilesResult.rows] : profilesResult.rows));
      setVenueRows(prev => (append && wantVenues ? [...prev, ...venuesResult.rows] : venuesResult.rows));
    } catch (e) {
      if (myRequest === requestId.current) setError(e.message);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [filterMode, term, profilePage, venuePage]);

  // Fresh load whenever filter/search changes (pages already reset to 0 above).
  useEffect(() => {
    loadPage({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, term]);

  const loadMore = () => {
    const pageSize = filterMode === 'all' ? PAGE_SIZE_COMBINED : PAGE_SIZE_SINGLE;
    if (filterMode !== 'venues' && (profilePage + 1) * pageSize < profileCount) setProfilePage(p => p + 1);
    if (filterMode !== 'artists' && (venuePage + 1) * pageSize < venueCount) setVenuePage(p => p + 1);
  };
  // loadMore bumps page state; fetch the newly-added page and append.
  useEffect(() => {
    if (profilePage === 0 && venuePage === 0) return;
    loadPage({ append: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilePage, venuePage]);

  const combined = [
    ...(filterMode !== 'venues' ? profileRows.map(r => ({ kind: 'profile', row: r })) : []),
    ...(filterMode !== 'artists' ? venueRows.map(r => ({ kind: 'venue', row: r })) : []),
  ].sort((a, b) => {
    const nameA = a.kind === 'venue' ? a.row.name : a.row.band_name;
    const nameB = b.kind === 'venue' ? b.row.name : b.row.band_name;
    return (nameA || '').localeCompare(nameB || '');
  });

  const pageSize = filterMode === 'all' ? PAGE_SIZE_COMBINED : PAGE_SIZE_SINGLE;
  const hasMore =
    (filterMode !== 'venues' && (profilePage + 1) * pageSize < profileCount) ||
    (filterMode !== 'artists' && (venuePage + 1) * pageSize < venueCount);

  const totalCount =
    (filterMode !== 'venues' ? profileCount : 0) +
    (filterMode !== 'artists' ? venueCount : 0);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.white, fontFamily: F.body }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ background: '#0a0a0a', borderBottom: `1px solid ${C.border}`, padding: '0 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 70 }}>
        <span onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
          <MSMLogo height={50} showWordmark={true} />
        </span>
        <span onClick={() => navigate('/')} style={{ fontSize: 12, color: C.muted, cursor: 'pointer', letterSpacing: 1 }}>
          ← BACK TO CALENDAR
        </span>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: 3, fontFamily: F.display, marginBottom: 8 }}>MSM GIG CALENDAR</div>
        <div style={{ fontFamily: F.display, fontSize: 42, letterSpacing: 2, color: C.white, lineHeight: 1, marginBottom: 16 }}>
          CLAIM AN ARTIST OR VENUE PROFILE
        </div>
        <div style={{ fontSize: 15, color: '#cccccc', lineHeight: 1.7, maxWidth: 640, marginBottom: 32 }}>
          Are you a member or authorised representative of an artist or venue listed on the calendar?
          Find the existing profile below and claim it — this links your account to the listing our
          team already created; it never creates a new one.
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: C.muted, pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ ...inputCss, paddingLeft: 42 }}
            onFocus={e => e.target.style.borderColor = C.red}
            onBlur={e => e.target.style.borderColor = C.border}
          />
        </div>

        {/* Type filter */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
          {[['all', 'ALL'], ['artists', 'ARTISTS'], ['venues', 'VENUES']].map(([id, label]) => (
            <button key={id} onClick={() => setFilterMode(id)} style={{
              padding: '8px 16px', border: 'none', borderRadius: 5, cursor: 'pointer',
              fontFamily: F.display, letterSpacing: 1.5, fontSize: 12,
              background: filterMode === id ? C.red : 'rgba(255,255,255,0.05)',
              color: filterMode === id ? '#fff' : C.muted,
            }}>{label}</button>
          ))}
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(232,32,58,0.1)', border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 13, color: C.red }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>
          {loading && combined.length === 0 ? 'Loading…' : `${totalCount} unclaimed or pending listing${totalCount !== 1 ? 's' : ''}`}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {combined.map(({ kind, row }) => (
            <DirectoryCard key={`${kind}-${row.id}`} kind={kind} row={row} />
          ))}
        </div>

        {!loading && combined.length === 0 && !error && (
          <div style={{ color: C.dim, fontSize: 14, marginTop: 12 }}>
            No unclaimed or pending listings match your search.
          </div>
        )}

        {hasMore && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <button onClick={loadMore} disabled={loading} style={{
              padding: '10px 24px', border: `1px solid ${C.border}`, borderRadius: 5,
              background: 'none', color: C.muted, cursor: loading ? 'default' : 'pointer',
              fontFamily: F.display, letterSpacing: 2, fontSize: 12,
            }}>
              {loading ? 'LOADING…' : 'LOAD MORE'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
