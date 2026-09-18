/**
 * AdminVenueEnrichment.jsx — Venue Research, Phase 3B (READ-ONLY)
 *
 * Displays staged venue_enrichment_candidates research suggestions
 * (Phase 1/2) in a BATCH → VENUE → FIELD CANDIDATE hierarchy for admin
 * review. This screen cannot write anything: there is no insert/update/
 * delete/upsert/RPC call anywhere in this file, and no code path reaches
 * public.venues except a plain `.select()`. Approving or rejecting a
 * candidate, and any eventual application of an approved value to
 * public.venues, are separate, not-yet-authorised future phases (see the
 * Phase 3A architecture audit this screen implements).
 *
 * Data-read approach: the full venue_enrichment_candidates table is
 * small (tens of rows across the one pilot batch today) and admin-only
 * (RLS: venue_enrichment_candidates_admin_all), so it's fetched in full
 * once on mount -- the same "load everything, filter/group client-side"
 * approach AdminPanel's own Moderation screen already uses for gigs. Live
 * public.venues rows are fetched only for the venues actually referenced
 * by the currently open batch (venue list) or the single venue currently
 * open (venue review) -- never a full venues table scan.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice,
  AdminCard, FormSection, HelpText, Pill, SmallActionButton, EmptyState,
} from './adminUI';
import {
  groupCandidatesByBatch, groupCandidatesByVenue, attachVenueInfo,
  splitProposedAndSkipped, isGeneratedCandidate, isStaleCandidate,
  getStatusLabel, isValidHttpUrl,
} from '../../venueEnrichment/venueEnrichmentReview.js';

const ACCENT = ACCENTS.festivals; // cyan -- not yet used by any other admin panel, keeps this screen visually distinct from the commercial (amber) and editorial (green) panels

const FIELD_LABELS = {
  address: 'Address', postcode: 'Postcode', website: 'Website', phone: 'Phone',
  contact_email: 'Contact email', facebook: 'Facebook', instagram: 'Instagram',
  twitter: 'Twitter / X', capacity: 'Capacity', description: 'Description',
  photo_url: 'Photo URL', seo_title: 'SEO title', seo_description: 'SEO description',
  seo_search_phrases: 'SEO search phrases',
};
const fieldLabel = (field) => FIELD_LABELS[field] || field;

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

const CONFIDENCE_TONE = { HIGH: 'positive', MEDIUM: 'warning', LOW: 'negative' };

function ReadOnlyNotice() {
  return (
    <SystemNotice accent={ACCENT}>
      <strong>RESEARCH REVIEW — READ ONLY.</strong> These are staged research
      suggestions from <code>venue_enrichment_candidates</code>. Nothing shown
      here has been applied to the live venue, and this screen has no
      capability to change venue or candidate data — approving or rejecting a
      suggestion is a separate, not-yet-built phase.
    </SystemNotice>
  );
}

function ClaimedVenueWarning() {
  return (
    <div style={{
      marginBottom: 24, padding: '16px 20px', borderRadius: 10,
      background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.5)',
      color: '#fca5a5', fontSize: 14, fontWeight: 700, lineHeight: 1.6,
    }}>
      ⚠ CLAIMED VENUE — MANUAL REVIEW REQUIRED
      <div style={{ fontSize: 12.5, fontWeight: 500, color: '#fecaca', marginTop: 6 }}>
        This venue has an active owner/manager. Proposed values here may
        overlap with information the claimant supplied directly — verify
        carefully. Nothing on this screen can be applied to the live listing
        regardless.
      </div>
    </div>
  );
}

function StaleWarning({ existingValue, liveValue }) {
  return (
    <div style={{
      marginTop: 10, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6,
      background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24',
    }}>
      <strong>⚠ STALE — venue data has changed since research.</strong>
      <div style={{ marginTop: 4, color: '#fde68a' }}>
        At research time: <em>{existingValue == null || existingValue === '' ? '— not set —' : existingValue}</em>
        {' · '}Live now: <em>{liveValue == null || liveValue === '' ? '— not set —' : liveValue}</em>
      </div>
    </div>
  );
}

function SourceLine({ candidate }) {
  const { source_type, source_url, retrieved_at, notes } = candidate;
  const safeUrl = isValidHttpUrl(source_url);
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, color: '#b3b3b3', lineHeight: 1.7 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {source_type && <Pill>{source_type}</Pill>}
        {source_url ? (
          safeUrl ? (
            <a href={source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#67e8f9' }}>
              OPEN SOURCE ↗
            </a>
          ) : (
            <span style={{ color: '#f87171' }}>Source URL not shown (unsafe/invalid link)</span>
          )
        ) : null}
        {retrieved_at && <span>researched {fmtDate(retrieved_at)}</span>}
      </div>
      {notes && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{notes}</div>}
    </div>
  );
}

function ProposedCandidateCard({ candidate, liveVenue }) {
  const liveValue = liveVenue ? liveVenue[candidate.field] : undefined;
  const stale = isStaleCandidate(candidate.existing_value, liveValue);
  const generated = isGeneratedCandidate(candidate);

  return (
    <AdminCard accent={ACCENT}>
      <FormSection title={fieldLabel(candidate.field)} first>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pill tone="neutral">{getStatusLabel(candidate.status)}</Pill>
          {generated ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999,
              fontSize: 11, fontWeight: 700, background: 'rgba(167,139,250,0.16)', color: '#c4b5fd',
            }}>
              GENERATED FROM VERIFIED FACTS
            </span>
          ) : (
            candidate.confidence && <Pill tone={CONFIDENCE_TONE[candidate.confidence] || 'neutral'}>{candidate.confidence}</Pill>
          )}
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8a8a8a', letterSpacing: '0.08em', marginBottom: 6 }}>
              CURRENT (LIVE)
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 8, background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.09)',
              color: '#ffffff', fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 20,
            }}>
              {liveValue == null || liveValue === '' ? <em style={{ color: '#666' }}>— not set —</em> : String(liveValue)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: ACCENT, letterSpacing: '0.08em', marginBottom: 6 }}>
              PROPOSED
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 8, background: 'rgba(34,211,238,0.08)', border: `1px solid rgba(34,211,238,0.35)`,
              color: '#ffffff', fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 20,
            }}>
              {String(candidate.suggested_value)}
            </div>
          </div>
        </div>

        {stale && <StaleWarning existingValue={candidate.existing_value} liveValue={liveValue} />}

        <SourceLine candidate={candidate} />
      </FormSection>
    </AdminCard>
  );
}

function SkippedCandidateRow({ candidate }) {
  const ambiguous = candidate.status === 'skipped_ambiguous';
  return (
    <div style={{
      marginBottom: 12, padding: ambiguous ? '14px 18px' : '10px 16px', borderRadius: 10,
      background: ambiguous ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${ambiguous ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.07)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{fieldLabel(candidate.field)}</span>
        <Pill tone={ambiguous ? 'warning' : 'neutral'}>{getStatusLabel(candidate.status)}</Pill>
      </div>
      {candidate.notes && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: ambiguous ? '#fde68a' : '#8a8a8a', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {candidate.notes}
        </div>
      )}
    </div>
  );
}

function VenueReviewScreen({ batchId, venueGroup, onBack }) {
  const [liveVenue, setLiveVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.from('venues').select('*').eq('id', venueGroup.venue_id)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); return; }
        setLiveVenue(data?.[0] || null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [venueGroup.venue_id]);

  const { proposed, skipped } = useMemo(() => splitProposedAndSkipped(venueGroup.candidates), [venueGroup.candidates]);
  const retrievedDates = venueGroup.candidates.map((c) => c.retrieved_at).filter(Boolean).sort();

  return (
    <AdminPage>
      <SmallActionButton onClick={onBack} style={{ marginBottom: 20 }}>← BACK TO VENUES</SmallActionButton>

      {loading && <p style={{ color: '#8a8a8a', fontSize: 13.5 }}>Loading venue…</p>}
      {error && <SystemNotice accent="#f87171">{error}</SystemNotice>}

      {!loading && (
        <>
          <AdminHeader
            title={liveVenue?.name || venueGroup.venue.name || 'Unknown venue'}
            subtitle={`${liveVenue?.city || venueGroup.venue.city || ''} · batch ${batchId}${retrievedDates.length ? ` · researched ${fmtDate(retrievedDates[0])}–${fmtDate(retrievedDates[retrievedDates.length - 1])}` : ''}`}
          />
          <p style={{ fontSize: 11, color: '#555', marginTop: -18, marginBottom: 20 }}>venue_id: {venueGroup.venue_id}</p>

          {(liveVenue?.claimed || venueGroup.venue.claimed) && <ClaimedVenueWarning />}

          <ReadOnlyNotice />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
            {Object.entries(venueGroup.statusCounts).filter(([, n]) => n > 0).map(([status, n]) => (
              <Pill key={status} tone={status === 'skipped_ambiguous' ? 'warning' : 'neutral'}>
                {getStatusLabel(status)}: {n}
              </Pill>
            ))}
          </div>

          {proposed.length === 0 && skipped.length === 0 && (
            <EmptyState>No candidates for this venue in this batch.</EmptyState>
          )}

          {proposed.map((candidate) => (
            <ProposedCandidateCard key={candidate.id} candidate={candidate} liveVenue={liveVenue} />
          ))}

          {skipped.length > 0 && (
            <FormSection title="SKIPPED — NO PROPOSED VALUE">
              {skipped.map((candidate) => <SkippedCandidateRow key={candidate.id} candidate={candidate} />)}
            </FormSection>
          )}
        </>
      )}
    </AdminPage>
  );
}

function VenueListScreen({ batchId, allRows, onBack, onOpenVenue }) {
  const [venuesById, setVenuesById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const venueGroups = useMemo(() => groupCandidatesByVenue(allRows, batchId), [allRows, batchId]);

  useEffect(() => {
    let cancelled = false;
    const ids = venueGroups.map((g) => g.venue_id);
    if (ids.length === 0) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    supabase.from('venues').select('id,name,city,claimed,claim_status').in('id', ids)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); return; }
        setVenuesById(Object.fromEntries((data || []).map((v) => [v.id, v])));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const withInfo = attachVenueInfo(venueGroups, venuesById);

  return (
    <AdminPage>
      <SmallActionButton onClick={onBack} style={{ marginBottom: 20 }}>← BACK TO BATCHES</SmallActionButton>
      <AdminHeader title="VENUES IN THIS BATCH" subtitle={batchId} />
      {loading && <p style={{ color: '#8a8a8a', fontSize: 13.5 }}>Loading venues…</p>}
      {error && <SystemNotice accent="#f87171">{error}</SystemNotice>}
      {!loading && withInfo.map((group) => (
        <AdminCard key={group.venue_id} accent={ACCENT}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
                {group.venue?.name || 'Unknown venue'}
                {group.venue?.claimed && (
                  <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 800, color: '#f87171' }}>CLAIMED</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#8a8a8a', marginTop: 2 }}>{group.venue?.city}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {Object.entries(group.statusCounts).filter(([, n]) => n > 0).map(([status, n]) => (
                  <Pill key={status} tone={status === 'skipped_ambiguous' ? 'warning' : 'neutral'}>{getStatusLabel(status)}: {n}</Pill>
                ))}
              </div>
            </div>
            <SmallActionButton tone="accent" accent={ACCENT} onClick={() => onOpenVenue(group)}>REVIEW →</SmallActionButton>
          </div>
        </AdminCard>
      ))}
      {!loading && withInfo.length === 0 && <EmptyState>No venues in this batch.</EmptyState>}
    </AdminPage>
  );
}

function BatchListScreen({ batches, onOpenBatch }) {
  return (
    <AdminPage>
      <AdminHeader
        title="VENUE RESEARCH"
        subtitle="Read-only review of staged venue enrichment research (venue_enrichment_candidates). Nothing here is applied to public.venues."
      />
      <ReadOnlyNotice />
      {batches.length === 0 && <EmptyState>No research batches found.</EmptyState>}
      {batches.map((batch) => (
        <AdminCard key={batch.batch_id} accent={ACCENT}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{batch.batch_id}</div>
              <div style={{ fontSize: 13, color: '#8a8a8a', marginTop: 2 }}>
                {batch.venueCount} venue{batch.venueCount === 1 ? '' : 's'} · {batch.candidateCount} candidate row{batch.candidateCount === 1 ? '' : 's'}
                {batch.earliestRetrievedAt && ` · researched ${fmtDate(batch.earliestRetrievedAt)}–${fmtDate(batch.latestRetrievedAt)}`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {Object.entries(batch.statusCounts).filter(([, n]) => n > 0).map(([status, n]) => (
                  <Pill key={status} tone={status === 'skipped_ambiguous' ? 'warning' : 'neutral'}>{getStatusLabel(status)}: {n}</Pill>
                ))}
              </div>
            </div>
            <SmallActionButton tone="accent" accent={ACCENT} onClick={() => onOpenBatch(batch.batch_id)}>OPEN →</SmallActionButton>
          </div>
        </AdminCard>
      ))}
    </AdminPage>
  );
}

export default function AdminVenueEnrichment() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ screen: 'batches' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Read-only: RLS (venue_enrichment_candidates_admin_all) is the real
    // access boundary here, exactly as for every other admin table read in
    // this app -- no service-role key, no elevated client.
    supabase.from('venue_enrichment_candidates').select('*')
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); return; }
        setRows(data || []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const batches = useMemo(() => groupCandidatesByBatch(rows), [rows]);

  if (loading) return <AdminPage><p style={{ color: '#8a8a8a', fontSize: 13.5 }}>Loading venue research…</p></AdminPage>;
  if (error) return <AdminPage><SystemNotice accent="#f87171">{error}</SystemNotice></AdminPage>;

  if (view.screen === 'venues') {
    return (
      <VenueListScreen
        batchId={view.batchId}
        allRows={rows}
        onBack={() => setView({ screen: 'batches' })}
        onOpenVenue={(group) => setView({ screen: 'venue', batchId: view.batchId, venueGroup: group })}
      />
    );
  }

  if (view.screen === 'venue') {
    return (
      <VenueReviewScreen
        batchId={view.batchId}
        venueGroup={view.venueGroup}
        onBack={() => setView({ screen: 'venues', batchId: view.batchId })}
      />
    );
  }

  return <BatchListScreen batches={batches} onOpenBatch={(batchId) => setView({ screen: 'venues', batchId })} />;
}
