# Venue Enrichment — research batch contract

This is the contract a future Claude research batch (or any other
research process) must follow when given a RESEARCH INPUT batch (built by
`buildResearchInputBatch()`, see `researchExport.js`) and asked to produce
a RESEARCH OUTPUT batch (validated by `validateResearchOutputBatch()`, see
`researchFormat.js`). It documents Phase 0's own safety findings as
concrete rules, not new policy.

This file describes a workflow. Nothing in this repository yet calls a
research process automatically, and nothing yet writes a candidate to
`public.venues` — see Phase 1's own PR description for the current scope
boundary.

## Identity

- `venue_id` is immutable identity, supplied by the input batch. Never
  invent one, never alter one, never substitute a different venue's id
  because a name looked similar — see the Phase 0 audit's own Venue
  Identity & Matching findings (PRs #31–#35): only an exact venue UUID is
  ever authoritative, precisely the same rule already enforced for gigs.
- Never create a new venue. If a venue described in the input doesn't
  seem to match what a source describes, that's an **ambiguous identity**
  case (see below), not a reason to propose a different venue.
- Never substitute another venue's data because it seems similar (a
  same-named venue in a different city, a rebranded/renamed venue, a
  venue that has since closed) — flag it, don't guess.
- Venue deletion is `ON DELETE RESTRICT` against this table: a venue with
  any candidate rows (of any status) cannot be deleted until those rows
  are explicitly removed first. This is deliberate — the table is
  intended to become provenance/audit history once candidates can reach
  `approved`/`applied`, and a venue deletion must never silently destroy
  that history.

## Scope of research

- Research only the fields listed in that venue's own `missing_fields`.
  `current_values` is there so a source that also restates an
  already-populated fact isn't mistaken for new information — it is
  **never** a target for a new suggestion. See "Existing data wins" below.
- A venue with no `missing_fields` should not appear in the input batch at
  all (`buildResearchInputBatch()` already filters these out) — if one
  does, skip it.

## Sourcing

- A factual claim (postcode, address, capacity, contact_email, phone,
  website, facebook, instagram, twitter, photo_url) requires a
  `source_url`. **No source, no factual candidate** — if nothing reliable
  is found, return that field with `outcome: "skipped_no_source"` and
  `suggested_value: null`, never a guess.
- Prefer sources in this order, per the Phase 0 audit: (1) the venue's own
  official website, (2) the venue's own official social profile, (3) an
  operator/company website, (4) a recognised ticketing/event platform,
  (5) reputable local/industry press, (6) other web sources only when
  nothing above exists. Do not treat a generic directory as authoritative
  when a better source is available.
- **Ambiguity is never resolved by guessing.** If two sources conflict, or
  the venue's identity relative to a source is unclear (same name,
  different city; a venue that may have closed/rebranded), return
  `outcome: "skipped_ambiguous"` and explain why in `notes`.
- Every non-skip candidate (`outcome: "found"`) must carry both
  `source_type` and `confidence` — this is enforced at the database layer
  (`venue_enrichment_candidates_found_has_provenance`), not only by the JS
  validator: a "found" candidate with no provenance is rejected outright,
  it can never reach staging as a bare, unsourced value.

## Confidence

- `HIGH`: the venue's own official site or official social profile
  directly states the fact.
- `MEDIUM`: a reputable external source states it and venue identity is
  unambiguous.
- `LOW`: ambiguous, conflicting, inferred, or a weak source.
- **LOW and MEDIUM confidence both require manual review** — see
  `requiresManualReview()`. Nothing in this phase (or the next) treats
  MEDIUM as safe to auto-apply.

## Capacity

- Propose a single `capacity` value only when a source clearly states one
  unambiguous whole-venue number.
- Standing vs. seated, or multiple named rooms with different capacities:
  do not pick one, do not average, do not infer a "typical" number.
  Either return the detail as descriptive text in `suggested_value` (for
  manual interpretation — the staging column is `text`, not `integer`,
  precisely so this is possible) with `confidence: "LOW"` or "MEDIUM"
  and a `notes` explanation, or return `outcome: "skipped_ambiguous"` if
  no single figure can be responsibly proposed at all.

## Photo

- A `photo_url` candidate **always requires manual review, regardless of
  confidence** (`requiresManualReview()` returns `true` for this field
  unconditionally). Never propose a generic web image search result, a
  stock photo, or any image whose licence/ownership isn't clear. Preferred
  sources, in order: venue-provided/claimed-owner media, the venue's own
  official website's own hosted image, MSM-owned photography, an existing
  WordPress Media Library asset already used for that venue. If none of
  these apply, skip the field.

## Generated editorial/SEO fields

- `description`, `seo_title`, `seo_description`, `seo_search_phrases` use
  `source_type: "generated"`, never a real `source_url` — they aren't
  fetched from one page.
- `notes` **must** state which of this same venue's verified factual
  candidates (or pre-existing `current_values`) the generated text is
  built from. Generated text must never state a fact that isn't backed by
  one of those — no invented accolades, history, capacity, or features.
- UK English. Useful, specific prose — not templated boilerplate that
  reads the same across hundreds of venues.
- `seo_title` ≤ 60 characters, `seo_description` ≤ 160 characters —
  enforced by `validateCandidate()` (`SEO_TITLE_MAX_LENGTH`/
  `SEO_DESCRIPTION_MAX_LENGTH`). An over-length value is **rejected
  outright, never silently truncated** — the research process must
  produce a candidate that actually fits rather than losing text to a
  hidden cut.

## Claimed venues

- The input batch flags `claimed`/`claim_status`. Research proceeds
  normally for a claimed venue's missing fields, but **every candidate for
  a claimed venue requires manual review**, independent of confidence — a
  claimed venue's blanks may be a deliberate owner choice, not an
  oversight.

## Existing data wins

- `current_values` is authoritative. A suggestion is never a request to
  overwrite it, and nothing in Phase 1 (or the format itself) provides any
  mechanism to do so — nothing here writes to `public.venues` at all yet.

## Batch identity

- `batch` (the research run's own label, e.g. `"VENUE-ENRICH-001"`) must
  be non-blank — enforced both by the JS output validator and by the
  database (`venue_enrichment_candidates_batch_id_not_blank`). An empty or
  whitespace-only batch label is rejected.

## Future Phase 2 considerations (not implemented yet)

Two items the independent review of this contract raised, intentionally
left for the actual ingestion path rather than designed speculatively
here:

- Having the research output echo each venue's `name`/`city` back
  alongside its `candidates`, so a human reviewer can visually cross-check
  the echoed identity against the `venue_id` — today's `venue_id`
  cross-check (`validateVenueIdsPreserved()`) already blocks an invented
  or cross-batch-substituted id, but can't detect a within-batch mix-up
  (venue A's fact mislabelled with venue B's id when both are in the same
  batch).
- Cross-checking a candidate's own `existing_value` against the original
  input batch's `current_values[field]` snapshot, to catch a research
  output that misreports what was already on file.

## Output shape

See `researchFormat.js` for the enforced structure; summarised:

```json
{
  "batch": "VENUE-ENRICH-001",
  "venues": [
    {
      "venue_id": "…the exact uuid supplied in the input…",
      "candidates": [
        {
          "field": "postcode",
          "outcome": "found",
          "suggested_value": "SO14 3AB",
          "source_url": "https://example-venue.co.uk/contact",
          "source_type": "official_site",
          "confidence": "HIGH",
          "notes": "Stated on the venue's own Contact page."
        },
        {
          "field": "capacity",
          "outcome": "skipped_ambiguous",
          "suggested_value": null,
          "source_url": null,
          "source_type": null,
          "confidence": null,
          "notes": "Source states 450 standing / 280 seated with no single overall figure — needs manual review."
        }
      ]
    }
  ]
}
```
