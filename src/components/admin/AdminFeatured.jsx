/**
 * AdminFeatured.jsx — Phase 5A-2
 * MSM Gig Calendar | Commercial Featured Listings
 * Covers: Featured Gigs · Featured Bands · Featured Venues · Featured Festivals
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

const ACCENT = ACCENTS.featured;

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { value: 'gig',      label: 'Gigs',      icon: '🎵' },
  { value: 'band',     label: 'Bands',     icon: '🎸' },
  { value: 'venue',    label: 'Venues',    icon: '📍' },
  { value: 'festival', label: 'Festivals', icon: '🎪' },
];

const LISTING_TYPES = [
  { value: 'gold', label: '★ Gold', desc: 'Premium — homepage spotlight' },
  { value: 'blue', label: '◆ Blue', desc: 'Standard — calendar badge'   },
];

const TODAY = new Date().toISOString().split('T')[0];

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const toInput  = (d) => d ? new Date(d).toISOString().slice(0,10) : '';

// ─── Entity search ────────────────────────────────────────────────────────────

function EntitySearch({ entityType, value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (query) => {
    setLoading(true);
    try {
      let data, error;
      if (entityType === 'venue')
        ({ data, error } = await supabase.rpc('admin_search_venues',   { p_query: query, p_limit: 10 }));
      else if (entityType === 'gig')
        ({ data, error } = await supabase.rpc('admin_search_gigs',     { p_query: query, p_limit: 10 }));
      else
        ({ data, error } = await supabase.rpc('admin_search_profiles', { p_query: query, p_profile_type: entityType, p_limit: 10 }));
      if (error) throw error;
      setResults(data || []);
      setOpen(true);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [entityType]);

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  const labelFor = (item) => {
    if (entityType === 'gig')   return `${item.band_name} @ ${item.venue} (${fmtDate(item.date)})`;
    if (entityType === 'venue') return `${item.name} — ${item.city}`;
    return `${item.band_name}${item.city ? ` — ${item.city}` : ''}`;
  };

  const select = (item) => {
    onChange({ id: item.id, label: labelFor(item), name: item.band_name || item.name });
    setQ(labelFor(item));
    setOpen(false);
  };

  return (
    <div style={{ position:'relative' }}>
      <TextInput accent={ACCENT} type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder={`Search ${entityType}s…`} />
      {loading && <div style={{ marginTop:6, fontSize:12, color:'#8a8a8a' }}>Searching…</div>}
      {open && results.length > 0 && (
        <SearchDropdown>
          {results.map(item => <SearchOption key={item.id} onClick={() => select(item)}>{labelFor(item)}</SearchOption>)}
        </SearchDropdown>
      )}
      {open && !loading && results.length === 0 && <SearchEmpty>No results</SearchEmpty>}
      {value && <p style={{ marginTop:8, fontSize:12, color:ACCENT, fontWeight:600 }}>✓ {value.label}</p>}
    </div>
  );
}

// ─── Featured form ────────────────────────────────────────────────────────────

const EMPTY = {
  entity_type:     'band',
  listing_type:    'blue',
  entity:          null,
  start_date:      TODAY,
  end_date:        '',
  published_at:    '',
  expires_at:      '',
  headline:        '',
  body_text:       '',
  image_url:       '',
  image_alt:       '',
  notes:           '',
  archive_visible: true,
  is_pinned:       false,
  display_order:   0,
};

function FeaturedForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.entity) { alert('Select an entity to feature.'); return; }
    if (!form.start_date) { alert('Start date is required.'); return; }
    onSave(form);
  };

  return (
    <AdminCard accent={ACCENT}>
      <form onSubmit={handleSubmit}>
        <FormHeader icon="⭐" title={initial ? 'Edit Featured Listing' : 'New Featured Listing'} onCancel={onCancel} />

        {/* 1. Listing Type & Subject */}
        <FormSection title="Listing Type & Subject" first>
          <Field>
            <Label required>Featured type</Label>
            <RadioGrid minWidth={140}>
              {ENTITY_TYPES.map(et => (
                <RadioOption key={et.value} name="entity_type" accent={ACCENT}
                  checked={form.entity_type === et.value}
                  onChange={() => { set('entity_type', et.value); set('entity', null); }}
                >{et.icon} {et.label}</RadioOption>
              ))}
            </RadioGrid>
          </Field>

          <Field>
            <Label required>Select {form.entity_type}</Label>
            <EntitySearch key={form.entity_type} entityType={form.entity_type} value={form.entity} onChange={v => set('entity', v)} />
          </Field>
        </FormSection>

        {/* 2. Listing Tier */}
        <FormSection title="Listing Tier">
          <Field>
            <Label required>Listing tier</Label>
            <RadioGrid minWidth={220}>
              {LISTING_TYPES.map(lt => (
                <RadioOption key={lt.value} name="listing_type" accent={ACCENT}
                  checked={form.listing_type === lt.value}
                  onChange={() => set('listing_type', lt.value)}
                >
                  <span style={{ display:'block', fontWeight:700 }}>{lt.label}</span>
                  <span style={{ display:'block', fontSize:11, color:'#8a8a8a', fontWeight:400, marginTop:2 }}>{lt.desc}</span>
                </RadioOption>
              ))}
            </RadioGrid>
          </Field>
        </FormSection>

        {/* 3. Content */}
        <FormSection title="Content">
          <Field>
            <Label>Headline</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
              placeholder="Optional — entity name used if blank" />
          </Field>
          <Field>
            <Label>Body text</Label>
            <Textarea accent={ACCENT} rows={4} value={form.body_text} onChange={e => set('body_text', e.target.value)}
              placeholder="Optional editorial copy for this listing" />
          </Field>
          <Field>
            <FieldRow>
              <div>
                <Label>Image URL</Label>
                <TextInput accent={ACCENT} wide type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <Label>Image alt text</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)} placeholder="Describe the image" />
              </div>
            </FieldRow>
          </Field>
          {form.image_url && (
            <Field>
              <img src={form.image_url} alt={form.image_alt||''} style={{ height:80, width:'auto', borderRadius:10, border:'1px solid rgba(255,255,255,0.09)', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
            </Field>
          )}
        </FormSection>

        {/* 4. Schedule */}
        <FormSection title="Schedule">
          <FieldRow minWidth={200}>
            <div>
              <Label required>Start date</Label>
              <TextInput accent={ACCENT} wide type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} required />
            </div>
            <div>
              <Label>End date</Label>
              <TextInput accent={ACCENT} wide type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} min={form.start_date} />
              <HelpText>Leave blank for ongoing.</HelpText>
            </div>
            <div>
              <Label>Publish date / time</Label>
              <TextInput accent={ACCENT} wide type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
              <HelpText>Blank = publish immediately.</HelpText>
            </div>
            <div>
              <Label>Expiry date / time</Label>
              <TextInput accent={ACCENT} wide type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
              <HelpText>Blank = no expiry.</HelpText>
            </div>
          </FieldRow>
        </FormSection>

        {/* 5. Display Options */}
        <FormSection title="Display Options">
          <FieldRow>
            <div>
              <Label>Display order</Label>
              <TextInput accent={ACCENT} wide type="number" value={form.display_order} min="0"
                onChange={e => set('display_order', parseInt(e.target.value)||0)} />
              <HelpText>Lower = higher position.</HelpText>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:18, paddingTop:2 }}>
              <ToggleSetting accent={ACCENT} checked={form.is_pinned} onChange={v => set('is_pinned', v)} label="Pin to top" hint="Overrides display order" />
              <ToggleSetting accent={ACCENT} checked={form.archive_visible} onChange={v => set('archive_visible', v)} label="Show in archive" />
            </div>
          </FieldRow>
        </FormSection>

        {/* 6. Internal/Admin Notes */}
        <FormSection title="Internal / Admin Notes">
          <Field>
            <Label>Internal notes</Label>
            <Textarea accent={ACCENT} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Admin-only notes — not shown publicly" />
          </Field>
        </FormSection>

        {/* 7. Actions */}
        <ActionsRow>
          <PrimaryButton type="submit" accent={ACCENT} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create listing'}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={onCancel}>Cancel</SecondaryButton>
        </ActionsRow>
      </form>
    </AdminCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminFeatured() {
  const [listings, setListings]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_featured_listings');
      if (error) throw error;
      setListings(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        entity_type:     form.entity_type,
        listing_type:    form.listing_type,
        start_date:      form.start_date,
        end_date:        form.end_date        || null,
        published_at:    form.published_at    || null,
        expires_at:      form.expires_at      || null,
        headline:        form.headline        || null,
        body_text:       form.body_text       || null,
        image_url:       form.image_url       || null,
        image_alt:       form.image_alt       || null,
        notes:           form.notes           || null,
        archive_visible: form.archive_visible,
        is_pinned:       form.is_pinned,
        display_order:   form.display_order,
        active:          true,
      };
      if (form.entity_type === 'gig')      row.gig_id     = form.entity.id;
      if (form.entity_type === 'venue')    row.venue_id   = form.entity.id;
      if (form.entity_type === 'band')     row.profile_id = form.entity.id;
      if (form.entity_type === 'festival') row.profile_id = form.entity.id;

      if (editItem) {
        row.updated_by = user.id;
        const { error } = await supabase.from('featured_listings').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Listing updated.');
      } else {
        row.created_by = user.id;
        const { error } = await supabase.from('featured_listings').insert(row);
        if (error) throw error;
        showToast('Listing created.');
      }
      setShowForm(false); setEditItem(null);
      await load();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, current) => {
    const { data: { user } } = await supabase.auth.getUser();
    const update = current ? { active: false, deactivated_by: user.id } : { active: true, deactivated_by: null };
    const { error } = await supabase.from('featured_listings').update(update).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    showToast(`Listing ${current?'deactivated':'activated'}.`);
    await load();
  };

  const togglePin = async (id, current) => {
    const { error } = await supabase.from('featured_listings').update({ is_pinned: !current }).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    await load();
  };

  const deleteListing = async (id) => {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    const { error } = await supabase.from('featured_listings').delete().eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    showToast('Listing deleted.');
    await load();
  };

  const openEdit = (l) => {
    setEditItem(l);
    setShowForm(true);
  };

  const toForm = (l) => ({
    entity_type:     l.entity_type,
    listing_type:    l.listing_type,
    entity: l.entity_type === 'venue'
      ? { id: l.venue_id, label: `${l.venue_name} — ${l.venue_city}`, name: l.venue_name }
      : l.entity_type === 'gig'
      ? { id: l.gig_id, label: `${l.gig_band_name} @ ${l.gig_venue}`, name: l.gig_band_name }
      : { id: l.profile_id, label: l.profile_name, name: l.profile_name },
    start_date:      toInput(l.start_date),
    end_date:        toInput(l.end_date),
    published_at:    l.published_at ? new Date(l.published_at).toISOString().slice(0,16) : '',
    expires_at:      l.expires_at   ? new Date(l.expires_at).toISOString().slice(0,16)   : '',
    headline:        l.headline     || '',
    body_text:       l.body_text    || '',
    image_url:       l.image_url    || '',
    image_alt:       l.image_alt    || '',
    notes:           l.notes        || '',
    archive_visible: l.archive_visible,
    is_pinned:       l.is_pinned,
    display_order:   l.display_order || 0,
  });

  const entityLabel = (l) => {
    if (l.entity_type === 'gig')   return `${l.gig_band_name} @ ${l.gig_venue}`;
    if (l.entity_type === 'venue') return `${l.venue_name} — ${l.venue_city}`;
    return l.profile_name || '—';
  };

  const filtered = listings.filter(l => {
    if (filterType   !== 'all' && l.entity_type !== filterType) return false;
    if (filterStatus === 'active'   && !l.active) return false;
    if (filterStatus === 'inactive' &&  l.active) return false;
    return true;
  });

  // Summary counts
  const counts = ENTITY_TYPES.reduce((acc, et) => {
    acc[et.value] = listings.filter(l => l.entity_type === et.value && l.active).length;
    return acc;
  }, {});

  return (
    <AdminPage>
      <AdminHeader
        icon="⭐" title="Featured Listings" subtitle="Commercial system — Gigs, Bands, Venues, Festivals"
        action={!showForm && (
          <PrimaryButton accent={ACCENT} onClick={() => { setShowForm(true); setEditItem(null); }}>+ New listing</PrimaryButton>
        )}
      />

      <SystemNotice accent={ACCENT}>
        <strong>COMMERCIAL SYSTEM</strong> — Featured listings are paid placements. Strict firewall from Editorial Awards.
      </SystemNotice>

      {/* Summary counts */}
      <StatGrid minWidth={130}>
        {ENTITY_TYPES.map(et => <StatCard key={et.value} value={counts[et.value]} label={`${et.icon} ${et.label}`} />)}
      </StatGrid>

      <Toast toast={toast} />

      {showForm && (
        <FeaturedForm
          initial={editItem ? toForm(editItem) : null}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
          saving={saving}
        />
      )}

      <ResultsPanel title="Featured Listings" count={`${filtered.length} listing${filtered.length!==1?'s':''}`}>
        {/* Filters -- visually separated from the results below */}
        <FilterBar>
          <Select accent={ACCENT} value={filterType} onChange={e => setFilterType(e.target.value)} style={{ maxWidth:180 }}>
            <option value="all">All types</option>
            {ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.icon} {et.label}</option>)}
          </Select>
          <Select accent={ACCENT} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth:180 }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FilterBar>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : error ? (
          <div style={{ fontSize:13, color:'#f87171', padding:'14px 16px', background:'rgba(248,113,113,0.1)', borderRadius:10 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⭐">No listings found. Create one above.</EmptyState>
        ) : (
          <TableShell minWidth={820}>
            <thead>
              <tr>{['Type','Entity','Headline','Tier','Dates','Status','Actions'].map(h => <Th key={h}>{h}</Th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <Tr key={l.id} dim={!l.active}>
                  <Td style={{ fontWeight:600, color:'#b3b3b3', whiteSpace:'nowrap', fontSize:12.5 }}>
                    {l.is_pinned && <span style={{ marginRight:4 }}>📌</span>}
                    {ENTITY_TYPES.find(e=>e.value===l.entity_type)?.icon} {l.entity_type}
                  </Td>
                  <Td>
                    <p style={{ fontWeight:600, color:'#fff', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', margin:0 }}>{entityLabel(l)}</p>
                    {l.image_url && <p style={{ fontSize:11, color:'#8a8a8a', margin:'4px 0 0' }}>📷 Image</p>}
                  </Td>
                  <Td style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#8a8a8a', fontSize:12.5 }}>{l.headline||'—'}</Td>
                  <Td>
                    <Pill color={l.listing_type==='gold' ? '#fbbf24' : '#60a5fa'}>{l.listing_type==='gold'?'★ Gold':'◆ Blue'}</Pill>
                  </Td>
                  <Td style={{ whiteSpace:'nowrap', fontSize:12, color:'#8a8a8a', lineHeight:1.7 }}>
                    <p style={{margin:0}}>{fmtDate(l.start_date)}</p>
                    <p style={{margin:0}}>{l.end_date ? `→ ${fmtDate(l.end_date)}` : '→ ongoing'}</p>
                    {l.expires_at && <p style={{margin:0, color:'#fbbf24'}}>Exp: {fmtDate(l.expires_at)}</p>}
                  </Td>
                  <Td><StatusPill active={l.active} /></Td>
                  <Td>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                      <SmallActionButton onClick={() => openEdit(l)}>Edit</SmallActionButton>
                      <SmallActionButton onClick={() => toggleActive(l.id, l.active)}>{l.active?'Deactivate':'Activate'}</SmallActionButton>
                      <SmallActionButton tone={l.is_pinned ? 'accent' : 'neutral'} accent="#fbbf24" onClick={() => togglePin(l.id, l.is_pinned)}>{l.is_pinned?'Unpin':'Pin'}</SmallActionButton>
                      <SmallActionButton tone="danger" onClick={() => deleteListing(l.id)}>Delete</SmallActionButton>
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
