/**
 * AdminVenueEnrichment.jsx — Venue Research, Phase 3B (read-only display)
 * + Phase 3C (individual Approve/Reject)
 *
 * Displays staged venue_enrichment_candidates research suggestions
 * (Phase 1/2) in a BATCH → VENUE → FIELD CANDIDATE hierarchy for admin
 * review, and (Phase 3C) lets an admin individually approve or reject a
 * single PENDING candidate. Neither action, nor anything else in this
 * file, ever writes to public.venues -- the only two candidate-status-
 * changing calls anywhere in this file are approveCandidate()/
 * rejectCandidate() (venueEnrichmentReview.js), which call the two
 * admin-gated SECURITY DEFINER RPCs added in
 * 20260918150000_venue_enrichment_candidates_review.sql. There is no
 * direct `.update()`/`.delete()` on venue_enrichment_candidates anywhere
 * in this file, and no Apply-to-venues functionality of any kind.
 *
 * Data-read approach: the full venue_enrichment_candidates table is
 * small (tens of rows across the one pilot batch today) and admin-only
 * (RLS: venue_enrichment_candidates_admin_select/_admin_insert -- see the
 * Phase 3C migration for why the old single admin-FOR-ALL policy was
 * split and narrowed), so it's fetched in full once on mount -- the same
 * "load everything, filter/group client-side" approach AdminPanel's own
 * Moderation screen already uses for gigs. Live public.venues rows are
 * fetched only for the venues actually referenced by the currently open
 * batch (venue list) or the single venue currently open (venue review)
 * -- never a full venues table scan.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice,
  AdminCard, FormSection, HelpText, Pill, SmallActionButton, PrimaryButton,
  ActionsRow, EmptyState,
} from './adminUI';
import {
  groupCandidatesByBatch, groupCandidatesByVenue, attachVenueInfo,
  splitProposedAndSkipped, isGeneratedCandidate, isStaleCandidate,
  getStatusLabel, isValidHttpUrl, fetchAllCandidates,
  isReviewableCandidate, isStaleConflictOutcome, approveCandidate, rejectCandidate,
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

function StaleConflictBanner({ existingValue, liveValue }) {
  return (
    <div style={{
      marginTop: 14, padding: '12px 16px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6,
      background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24',
    }}>
      <strong>⚠ THE LIVE VENUE DATA HAS CHANGED SINCE THIS RESEARCH WAS CREATED.</strong>
      <div style={{ marginTop: 4 }}>THIS SUGGESTION WAS NOT APPROVED.</div>
      <div style={{ marginTop: 6, color: '#fde68a' }}>
        At research time: <em>{existingValue == null || existingValue === '' ? '— not set —' : existingValue}</em>
        {' · '}Live now: <em>{liveValue == null || liveValue === '' ? '— not set —' : liveValue}</em>
      </div>
    </div>
  );
}

function ProposedCandidateCard({ candidate, liveVenue }) {
  // reviewResult holds the RPC's own returned outcome after a successful
  // Approve/Reject call this session -- e.g. { outcome:'approved',
  // status:'approved', reviewed_at:'...' } or { outcome:'stale_conflict',
  // existing_value, live_value }. Purely local/per-card: the database is
  // always the real source of truth (candidate.status/.reviewed_at from
  // the last fetch), this just reflects a just-made decision immediately
  // without a full re-fetch of the batch -- exactly the same "reflect
  // success state immediately" pattern AdminPromoSlots.jsx's per-slot
  // save already uses.
  const [reviewResult, setReviewResult] = useState(null);
  const [confirming, setConfirming] = useState(null); // null | 'approve' | 'reject'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const effectiveStatus = reviewResult?.status || candidate.status;
  const effectiveReviewedAt = reviewResult?.reviewed_at || candidate.reviewed_at;
  const reviewable = isReviewableCandidate({ status: effectiveStatus });

  const liveValue = liveVenue ? liveVenue[candidate.field] : undefined;
  const stale = isStaleCandidate(candidate.existing_value, liveValue);
  const generated = isGeneratedCandidate(candidate);

  // Prevents double submission structurally, not just via a disabled
  // prop: a second call while `saving` is already true is simply not
  // issued at all, mirroring AdminPromoSlots.jsx's savingSlot guard.
  const runReview = async (action) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const fn = action === 'approve' ? approveCandidate : rejectCandidate;
      const result = await fn(supabase, candidate.id);
      setReviewResult(result);
      setConfirming(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard accent={ACCENT}>
      <FormSection title={fieldLabel(candidate.field)} first>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pill tone="neutral">{getStatusLabel(effectiveStatus)}</Pill>
          {/* CORRECTION (independent review, PR #41): generated and confidence
              are independent facts about a candidate -- a generated row still
              carries a real confidence tier (e.g. Platform Tavern's HIGH-
              confidence generated SEO rows) and must show both, not one or
              the other. */}
          {generated && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999,
              fontSize: 11, fontWeight: 700, background: 'rgba(167,139,250,0.16)', color: '#c4b5fd',
            }}>
              GENERATED FROM VERIFIED FACTS
            </span>
          )}
          {candidate.confidence && <Pill tone={CONFIDENCE_TONE[candidate.confidence] || 'neutral'}>{candidate.confidence}</Pill>}
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

        {/* The pre-emptive, client-computed warning (Phase 3B) only makes
            sense before any review attempt -- once a real Approve attempt
            has server-confirmed staleness, the more specific banner below
            replaces it rather than showing both. */}
        {stale && !reviewResult && <StaleWarning existingValue={candidate.existing_value} liveValue={liveValue} />}

        {/* Covers both a stale_conflict just detected THIS session (reviewResult
            from the RPC's own return value) and one already persisted from an
            earlier session (candidate.status fetched straight from the DB) --
            either way the banner explains why no review controls remain. */}
        {(isStaleConflictOutcome(reviewResult) || (!reviewResult && candidate.status === 'stale_conflict')) && (
          <StaleConflictBanner
            existingValue={reviewResult?.existing_value ?? candidate.existing_value}
            liveValue={reviewResult ? reviewResult.live_value : liveValue}
          />
        )}

        <SourceLine candidate={candidate} />

        {error && (
          <div style={{ marginTop: 14 }}>
            <SystemNotice accent="#f87171">{error}</SystemNotice>
          </div>
        )}

        {reviewable && (
          <ActionsRow>
            {confirming === 'approve' ? (
              <>
                <span style={{ fontSize: 13, color: '#b3b3b3', alignSelf: 'center' }}>Approve this researched value?</span>
                <PrimaryButton accent={ACCENT} onClick={() => runReview('approve')} disabled={saving}>
                  {saving ? 'APPROVING…' : 'CONFIRM APPROVE'}
                </PrimaryButton>
                <SmallActionButton onClick={() => setConfirming(null)} disabled={saving}>CANCEL</SmallActionButton>
              </>
            ) : confirming === 'reject' ? (
              <>
                <span style={{ fontSize: 13, color: '#b3b3b3', alignSelf: 'center' }}>Reject this researched value?</span>
                <SmallActionButton tone="danger" onClick={() => runReview('reject')} disabled={saving}>
                  {saving ? 'REJECTING…' : 'CONFIRM REJECT'}
                </SmallActionButton>
                <SmallActionButton onClick={() => setConfirming(null)} disabled={saving}>CANCEL</SmallActionButton>
              </>
            ) : (
              <>
                <PrimaryButton accent={ACCENT} onClick={() => setConfirming('approve')} disabled={saving}>APPROVE</PrimaryButton>
                <SmallActionButton tone="danger" onClick={() => setConfirming('reject')} disabled={saving}>REJECT</SmallActionButton>
              </>
            )}
          </ActionsRow>
        )}

        {!reviewable && (effectiveStatus === 'approved' || effectiveStatus === 'rejected') && (
          <div style={{ marginTop: 14, fontSize: 12, color: '#8a8a8a' }}>
            Reviewed{effectiveReviewedAt ? ` ${fmtDate(effectiveReviewedAt)}` : ''} — this decision is final in Phase 3C.
          </div>
        )}
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
            title={liveVenue?.name || venueGroup.venue?.name || 'Unknown venue'}
            subtitle={`${liveVenue?.city || venueGroup.venue?.city || ''} · batch ${batchId}${retrievedDates.length ? ` · researched ${fmtDate(retrievedDates[0])}–${fmtDate(retrievedDates[retrievedDates.length - 1])}` : ''}`}
          />
          <p style={{ fontSize: 11, color: '#555', marginTop: -18, marginBottom: 20 }}>venue_id: {venueGroup.venue_id}</p>

          {/* CORRECTION (independent review, PR #41): venueGroup.venue can
              legitimately be null (attachVenueInfo's own documented/tested
              behaviour when the bulk venue-list fetch didn't resolve this
              venue) -- optional-chained so a missing venue record degrades
              to "Unknown venue"/no claimed badge instead of crashing the
              whole review screen. */}
          {(liveVenue?.claimed || venueGroup.venue?.claimed) && <ClaimedVenueWarning />}

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
    //
    // CORRECTION (independent review, PR #41): a bare `.select('*')` here
    // silently truncates at Supabase/PostgREST's default 1000-row ceiling
    // once the table's total row count (across every research batch, not
    // just one) grows past it -- the same bug class App.jsx's own
    // fetchAllPages() already fixed for DB.getAllGigs()/getApprovedGigs()/
    // getVenues(). fetchAllCandidates() reuses that exact, already-reviewed
    // mechanism (still SELECT-only -- see its own comment) instead of a
    // second pagination implementation.
    fetchAllCandidates(supabase)
      .then((data) => { if (!cancelled) setRows(data || []); })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); })
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
