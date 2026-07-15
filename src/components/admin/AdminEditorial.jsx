/**
 * AdminEditorial.jsx — Phase 5A-2
 * MSM Gig Calendar | Editorial Awards Management
 * Covers: Record of the Week · Album of the Month · Editor's Choice · MSM Recommended
 * Hall of Fame is managed separately in AdminHallOfFame.jsx
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice, StatGrid, StatCard,
  AdminCard, FormHeader, FormSection, FieldRow, Field, Label, HelpText,
  TextInput, Select, Textarea, RadioGrid, RadioOption, ToggleSetting,
  ActionsRow, PrimaryButton, SecondaryButton, SmallActionButton,
  FilterBar, ResultsPanel, EmptyState, TableShell, Th, Td, Tr,
  Pill, StatusPill, Toast, SearchDropdown, SearchOption, SearchEmpty,
} from './adminUI';

const ACCENT = ACCENTS.editorial;

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const toDateInput = (d) => d ? new Date(d).toISOString().slice(0,10) : '';
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
const autoSlug = (awardSlug, name, date) =>
  `${awardSlug}-${slugify(name||'unknown')}-${date ? new Date(date).getFullYear() : new Date().getFullYear()}`;

// ─── Subject search (gig or profile) ─────────────────────────────────────────

function SubjectSearch({ targetType, value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (query) => {
    setLoading(true);
    try {
      const fn = targetType === 'gig' ? 'admin_search_gigs' : 'admin_search_profiles';
      const { data, error } = await supabase.rpc(fn, { p_query: query, p_limit: 10 });
      if (error) throw error;
      setResults(data || []);
      setOpen(true);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [targetType]);

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  const labelFor = (item) => targetType === 'gig'
    ? `${item.band_name} @ ${item.venue} (${fmtDate(item.date)})`
    : `${item.band_name}${item.city ? ` — ${item.city}` : ''}${item.profile_type ? ` [${item.profile_type}]` : ''}`;

  const select = (item) => {
    onChange({ id: item.id, label: labelFor(item), name: item.band_name });
    setQ(labelFor(item));
    setOpen(false);
  };

  return (
    <div style={{ position:'relative' }}>
      <TextInput
        accent={ACCENT}
        type="text" value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={targetType === 'gig' ? 'Search approved gigs…' : 'Search bands, artists, festivals…'}
      />
      {loading && <div style={{ marginTop:6, fontSize:12, color:'#8a8a8a' }}>Searching…</div>}
      {open && results.length > 0 && (
        <SearchDropdown>
          {results.map(item => (
            <SearchOption key={item.id} onClick={() => select(item)}>{labelFor(item)}</SearchOption>
          ))}
        </SearchDropdown>
      )}
      {open && !loading && results.length === 0 && <SearchEmpty>No results</SearchEmpty>}
      {value && <p style={{ marginTop:8, fontSize:12, color:ACCENT, fontWeight:600 }}>✓ {value.label}</p>}
    </div>
  );
}

// ─── Editorial form ───────────────────────────────────────────────────────────

const EMPTY = {
  award_type_id:   '',
  target_type:     'profile',
  subject:         null,
  awarded_at:      new Date().toISOString().slice(0,10),
  published_at:    '',
  expires_at:      '',
  headline:        '',
  body_text:       '',
  review_url:      '',
  image_url:       '',
  image_alt:       '',
  slug:            '',
  notes:           '',
  archive_visible: true,
  is_pinned:       false,
  display_order:   0,
};

function EditorialForm({ awardTypes, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedType = awardTypes.find(a => a.id === form.award_type_id);

  // Auto-generate slug when key fields change
  useEffect(() => {
    if (selectedType && form.subject && !initial) {
      set('slug', autoSlug(selectedType.slug, form.subject.name, form.awarded_at));
    }
  }, [form.award_type_id, form.subject?.id, form.awarded_at]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.award_type_id) { alert('Select an award type.'); return; }
    if (!form.subject)        { alert('Select a subject (gig or profile).'); return; }
    onSave(form);
  };

  return (
    <AdminCard accent={ACCENT}>
      <form onSubmit={handleSubmit}>
        <FormHeader icon="🏅" title={initial ? 'Edit Award' : 'Assign Editorial Award'} onCancel={onCancel} />

        {/* 1. Award Type & Subject */}
        <FormSection title="Award Type & Subject" first>
          <Field>
            <Label required>Award type</Label>
            <RadioGrid minWidth={190}>
              {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
                <RadioOption key={a.id} name="award_type" accent={ACCENT}
                  checked={form.award_type_id === a.id}
                  onChange={() => set('award_type_id', a.id)}
                  dot={`#${a.color_hex}`}
                  badge={a.singleton ? 'SINGLETON' : null}
                >{a.label}</RadioOption>
              ))}
            </RadioGrid>
            {selectedType?.singleton && (
              <p style={{ marginTop:14, fontSize:12.5, background:'rgba(251,146,60,0.1)', border:'1px solid rgba(251,146,60,0.35)', color:'#fb923c', borderRadius:9, padding:'11px 14px', lineHeight:1.6 }}>
                ⚠ Singleton — only one active {selectedType.label} at a time. Assigning will deactivate the current one.
              </p>
            )}
          </Field>

          <Field>
            <Label required>Award applies to</Label>
            <RadioGrid minWidth={200}>
              {[['profile','Band / Artist / Festival'],['gig','Specific gig / performance']].map(([v,l]) => (
                <RadioOption key={v} name="target_type" accent={ACCENT}
                  checked={form.target_type === v}
                  onChange={() => { set('target_type', v); set('subject', null); }}
                >{l}</RadioOption>
              ))}
            </RadioGrid>
          </Field>

          <Field>
            <Label required>{form.target_type === 'gig' ? 'Select gig' : 'Select band / artist / festival'}</Label>
            <SubjectSearch targetType={form.target_type} value={form.subject} onChange={v => set('subject', v)} />
          </Field>
        </FormSection>

        {/* 2. Content */}
        <FormSection title="Content">
          <Field>
            <Label>Headline</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
              placeholder="Short editorial headline (optional — subject name used if blank)" />
          </Field>
          <Field>
            <Label>Editorial body text</Label>
            <Textarea accent={ACCENT} rows={4} value={form.body_text} onChange={e => set('body_text', e.target.value)}
              placeholder="Editorial copy for this entry. Shown on archive page and public entry." />
          </Field>
          <Field>
            <FieldRow>
              <div>
                <Label>Image URL</Label>
                <TextInput accent={ACCENT} wide type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)}
                  placeholder="https://…" />
              </div>
              <div>
                <Label>Image alt text</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)}
                  placeholder="Describe the image" />
              </div>
            </FieldRow>
          </Field>
          {form.image_url && (
            <Field>
              <img src={form.image_url} alt={form.image_alt || ''} style={{ height:96, width:'auto', borderRadius:10, border:'1px solid rgba(255,255,255,0.09)', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
            </Field>
          )}
        </FormSection>

        {/* 3. Schedule */}
        <FormSection title="Schedule">
          <Field>
            <Label>Review / article URL</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.review_url} onChange={e => set('review_url', e.target.value)}
              placeholder="https://musicscenemagazine.co.uk/reviews/…" />
            <HelpText>Shown as "Read Review" link on the archive page.</HelpText>
          </Field>

          <Field>
            <FieldRow minWidth={180}>
              <div>
                <Label required>Award date</Label>
                <TextInput accent={ACCENT} wide type="date" value={form.awarded_at} onChange={e => set('awarded_at', e.target.value)} required />
              </div>
              <div>
                <Label>Publish date</Label>
                <TextInput accent={ACCENT} wide type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
                <HelpText>Leave blank to publish immediately.</HelpText>
              </div>
              <div>
                <Label>Expiry date</Label>
                <TextInput accent={ACCENT} wide type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
                <HelpText>Leave blank for no expiry.</HelpText>
              </div>
            </FieldRow>
          </Field>

          <Field>
            <Label>Archive slug</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.slug} onChange={e => set('slug', e.target.value)}
              placeholder="auto-generated — edit if needed" style={{ fontFamily:'monospace', fontSize:12.5 }} />
            <HelpText>Public URL: /editorial-archive/{form.slug || '…'}</HelpText>
          </Field>
        </FormSection>

        {/* 4. Display Options */}
        <FormSection title="Display Options">
          <FieldRow>
            <div>
              <Label>Display order</Label>
              <TextInput accent={ACCENT} wide type="number" value={form.display_order} onChange={e => set('display_order', parseInt(e.target.value)||0)}
                min="0" placeholder="0" />
              <HelpText>Lower = higher position. 0 = default.</HelpText>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:18, paddingTop:2 }}>
              <ToggleSetting accent={ACCENT} checked={form.is_pinned} onChange={v => set('is_pinned', v)}
                label="Pin to top" hint="Overrides display order" />
              <ToggleSetting accent={ACCENT} checked={form.archive_visible} onChange={v => set('archive_visible', v)}
                label="Show in archive" hint="Historical record visible publicly" />
            </div>
          </FieldRow>
        </FormSection>

        {/* 5. Internal/Admin Notes */}
        <FormSection title="Internal / Admin Notes">
          <Field>
            <Label>Internal notes</Label>
            <Textarea accent={ACCENT} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Admin-only notes — not shown publicly" />
          </Field>
        </FormSection>

        {/* 6. Actions */}
        <ActionsRow>
          <PrimaryButton type="submit" accent={ACCENT} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Assign award'}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={onCancel}>Cancel</SecondaryButton>
        </ActionsRow>
      </form>
    </AdminCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminEditorial() {
  const [awardTypes, setAwardTypes] = useState([]);
  const [features, setFeatures]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAwardTypes = async () => {
    const { data } = await supabase.from('editorial_award_types').select('*').eq('active', true).order('sort_order');
    setAwardTypes(data || []);
  };

  const loadFeatures = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_editorial_features');
      if (error) throw error;
      setFeatures(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAwardTypes(); loadFeatures(); }, []);

  // Singleton conflict handling
  const handleSingletonConflict = async (awardTypeId) => {
    const type = awardTypes.find(a => a.id === awardTypeId);
    if (!type?.singleton) return true;
    const active = features.filter(f => f.award_type_id === awardTypeId && f.active);
    if (active.length === 0) return true;
    if (!window.confirm(`There is already an active "${type.label}".\n\nThe existing award will be deactivated. Continue?`)) return false;
    const { error } = await supabase.from('editorial_features').update({ active: false }).eq('award_type_id', awardTypeId).eq('active', true);
    if (error) { showToast(error.message, 'error'); return false; }
    return true;
  };

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const ok = await handleSingletonConflict(form.award_type_id);
      if (!ok) { setSaving(false); return; }

      const { data: { user } } = await supabase.auth.getUser();

      const row = {
        award_type_id:   form.award_type_id,
        gig_id:          form.target_type === 'gig'     ? form.subject.id : null,
        profile_id:      form.target_type === 'profile' ? form.subject.id : null,
        awarded_by:      user.id,
        created_by:      user.id,
        awarded_at:      form.awarded_at,
        published_at:    form.published_at || null,
        expires_at:      form.expires_at   || null,
        headline:        form.headline     || null,
        body_text:       form.body_text    || null,
        review_url:      form.review_url   || null,
        image_url:       form.image_url    || null,
        image_alt:       form.image_alt    || null,
        slug:            form.slug         || null,
        notes:           form.notes        || null,
        archive_visible: form.archive_visible,
        is_pinned:       form.is_pinned,
        display_order:   form.display_order,
        active:          true,
      };

      if (editItem) {
        row.updated_by = user.id;
        const { error } = await supabase.from('editorial_features').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Award updated.');
      } else {
        const { error } = await supabase.from('editorial_features').insert(row);
        if (error) throw error;
        showToast('Award assigned.');
      }

      setShowForm(false);
      setEditItem(null);
      await loadFeatures();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, current) => {
    const { data: { user } } = await supabase.auth.getUser();
    const update = current
      ? { active: false, deactivated_by: user.id }
      : { active: true,  deactivated_by: null };
    const { error } = await supabase.from('editorial_features').update(update).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(`Award ${current ? 'deactivated' : 'activated'}.`);
    await loadFeatures();
  };

  const toggleArchive = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ archive_visible: !current }).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(`Archive visibility ${!current ? 'enabled' : 'disabled'}.`);
    await loadFeatures();
  };

  const togglePin = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ is_pinned: !current }).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    await loadFeatures();
  };

  const openEdit = (f) => {
    setEditItem(f);
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditItem(null); };

  // Map feature to form shape for editing
  const featureToForm = (f) => ({
    award_type_id:   f.award_type_id,
    target_type:     f.gig_id ? 'gig' : 'profile',
    subject:         f.gig_id
      ? { id: f.gig_id, label: `${f.gig_band_name} @ ${f.gig_venue}`, name: f.gig_band_name }
      : { id: f.profile_id, label: f.profile_name, name: f.profile_name },
    awarded_at:      toDateInput(f.awarded_at),
    published_at:    f.published_at ? new Date(f.published_at).toISOString().slice(0,16) : '',
    expires_at:      f.expires_at   ? new Date(f.expires_at).toISOString().slice(0,16)   : '',
    headline:        f.headline        || '',
    body_text:       f.body_text       || '',
    review_url:      f.review_url      || '',
    image_url:       f.image_url       || '',
    image_alt:       f.image_alt       || '',
    slug:            f.slug            || '',
    notes:           f.notes           || '',
    archive_visible: f.archive_visible,
    is_pinned:       f.is_pinned,
    display_order:   f.display_order   || 0,
  });

  const filtered = features.filter(f => {
    if (f.is_hall_of_fame) return false;
    if (filterType !== 'all' && f.award_slug !== filterType) return false;
    if (filterStatus === 'active'   && !f.active) return false;
    if (filterStatus === 'inactive' &&  f.active) return false;
    return true;
  });

  const subjectLabel = (f) => f.gig_id ? `${f.gig_band_name} @ ${f.gig_venue}` : (f.profile_name || '—');

  // Singleton summary cards
  const singletons = awardTypes.filter(a => a.singleton && !a.is_hall_of_fame);

  return (
    <AdminPage>
      <AdminHeader
        icon="🏅" title="Editorial Awards" subtitle="Non-purchasable — editorial assignment only"
        action={!showForm && (
          <PrimaryButton accent={ACCENT} onClick={() => { setShowForm(true); setEditItem(null); }}>+ Assign award</PrimaryButton>
        )}
      />

      <SystemNotice accent={ACCENT}>
        <strong>EDITORIAL SYSTEM</strong> — Awards are non-purchasable. Strict firewall from commercial Featured Listings.
      </SystemNotice>

      {/* Singleton summary */}
      {singletons.length > 0 && (
        <StatGrid minWidth={220}>
          {singletons.map(a => {
            const current = features.find(f => f.award_type_id === a.id && f.active);
            return (
              <div key={a.id} style={{ padding:'16px 18px', background:'#141414', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, display:'flex', alignItems:'flex-start', gap:12, textAlign:'left' }}>
                <span style={{ width:11, height:11, borderRadius:'50%', marginTop:4, flexShrink:0, background:`#${a.color_hex}` }} />
                <div style={{ minWidth:0 }}>
                  <p style={{ fontSize:11, fontWeight:700, color:'#8a8a8a', textTransform:'uppercase', letterSpacing:'0.06em', margin:0 }}>{a.label}</p>
                  {current ? (
                    <>
                      <p style={{ fontSize:14, fontWeight:700, color:'#fff', margin:'6px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{subjectLabel(current)}</p>
                      {current.headline && <p style={{ fontSize:12, color:'#8a8a8a', margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{current.headline}</p>}
                      <p style={{ fontSize:12, color:'#8a8a8a', margin:'3px 0 0' }}>{fmtDate(current.awarded_at)}</p>
                    </>
                  ) : (
                    <p style={{ fontSize:13, color:'#8a8a8a', fontStyle:'italic', margin:'6px 0 0' }}>None assigned</p>
                  )}
                </div>
              </div>
            );
          })}
        </StatGrid>
      )}

      <Toast toast={toast} />

      {/* Form */}
      {showForm && (
        <EditorialForm
          awardTypes={awardTypes}
          initial={editItem ? featureToForm(editItem) : null}
          onSave={handleSave}
          onCancel={cancelForm}
          saving={saving}
        />
      )}

      <ResultsPanel title="Assigned Awards" count={`${filtered.length} award${filtered.length !== 1 ? 's' : ''}`}>
        {/* Filters -- visually separated from the results below */}
        <FilterBar>
          <Select accent={ACCENT} value={filterType} onChange={e => setFilterType(e.target.value)} style={{ maxWidth:220 }}>
            <option value="all">All award types</option>
            {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
              <option key={a.id} value={a.slug}>{a.label}</option>
            ))}
          </Select>
          <Select accent={ACCENT} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth:180 }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FilterBar>

        {/* Table */}
        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : error ? (
          <div style={{ fontSize:13, color:'#f87171', padding:'14px 16px', background:'rgba(248,113,113,0.1)', borderRadius:10 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🏅">No awards found. Assign one above.</EmptyState>
        ) : (
          <TableShell minWidth={900}>
            <thead>
              <tr>
                {['Award','Subject','Headline','Date','Status','Archive','Actions'].map(h => <Th key={h}>{h}</Th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <Tr key={f.id} dim={!f.active}>
                  <Td>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      {f.is_pinned && <span style={{ fontSize:12 }}>📌</span>}
                      <span style={{ display:'inline-flex', alignItems:'center', padding:'4px 11px', borderRadius:999, fontSize:11, fontWeight:700, color:'#0d0d0d', whiteSpace:'nowrap', background:`#${f.award_color_hex}` }}>
                        {f.award_label}
                      </span>
                    </div>
                    {f.display_order > 0 && <p style={{ fontSize:11, color:'#8a8a8a', margin:'6px 0 0' }}>Order: {f.display_order}</p>}
                  </Td>
                  <Td>
                    <p style={{ fontWeight:600, color:'#fff', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', margin:0 }}>{subjectLabel(f)}</p>
                    {f.image_url && <p style={{ fontSize:11, color:'#8a8a8a', margin:'4px 0 0' }}>📷 Image set</p>}
                  </Td>
                  <Td style={{ maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#8a8a8a', fontSize:12.5 }}>{f.headline || '—'}</Td>
                  <Td style={{ whiteSpace:'nowrap', fontSize:12, color:'#8a8a8a', lineHeight:1.7 }}>
                    <p style={{margin:0}}>{fmtDate(f.awarded_at)}</p>
                    {f.published_at && <p style={{margin:0, color:'#4ade80'}}>Pub: {fmtDate(f.published_at)}</p>}
                    {f.expires_at   && <p style={{margin:0, color:'#fbbf24'}}>Exp: {fmtDate(f.expires_at)}</p>}
                  </Td>
                  <Td><StatusPill active={f.active} /></Td>
                  <Td>
                    <span style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', color: f.archive_visible ? '#4ade80' : '#8a8a8a' }}>
                      {f.archive_visible ? '✓ Visible' : '— Hidden'}
                    </span>
                  </Td>
                  <Td>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                      <SmallActionButton onClick={() => openEdit(f)}>Edit</SmallActionButton>
                      <SmallActionButton onClick={() => toggleActive(f.id, f.active)}>{f.active ? 'Deactivate' : 'Activate'}</SmallActionButton>
                      <SmallActionButton onClick={() => toggleArchive(f.id, f.archive_visible)}>{f.archive_visible ? 'Hide' : 'Show'}</SmallActionButton>
                      <SmallActionButton tone={f.is_pinned ? 'accent' : 'neutral'} accent="#fbbf24" onClick={() => togglePin(f.id, f.is_pinned)}>{f.is_pinned ? 'Unpin' : 'Pin'}</SmallActionButton>
                      {f.review_url && (
                        <SmallActionButton as="a" tone="accent" accent={ACCENT}
                          onClick={() => window.open(f.review_url, '_blank', 'noopener,noreferrer')}>
                          Review ↗
                        </SmallActionButton>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </ResultsPanel>
    </AdminPage>
  );
}
