/**
 * AdminHallOfFame.jsx — Phase 5A-2
 * MSM Gig Calendar | Hall of Fame Management
 * Permanent editorial recognition — non-purchasable.
 * Records are never deleted, only visibility controlled.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice, StatGrid, StatCard,
  AdminCard, FormHeader, FormSection, FieldRow, Field, Label, HelpText,
  TextInput, Select, Textarea, RadioGrid, RadioOption, ToggleSetting,
  ActionsRow, PrimaryButton, SecondaryButton, SmallActionButton,
  FilterBar, ResultsPanel, EmptyState, Pill, Toast,
  SearchDropdown, SearchOption, SearchEmpty,
} from './adminUI';

const ACCENT = ACCENTS.hallOfFame;

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtYear  = (d) => d ? new Date(d).getFullYear() : '—';
const slugify  = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
const autoSlug = (name, date) => `hall-of-fame-${slugify(name||'unknown')}-${date ? new Date(date).getFullYear() : new Date().getFullYear()}`;

// ─── Subject search ───────────────────────────────────────────────────────────

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
    : `${item.band_name}${item.city ? ` — ${item.city}` : ''}`;

  const select = (item) => {
    onChange({ id: item.id, label: labelFor(item), name: item.band_name });
    setQ(labelFor(item));
    setOpen(false);
  };

  return (
    <div style={{ position:'relative' }}>
      <TextInput accent={ACCENT} type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder={targetType === 'gig' ? 'Search gigs…' : 'Search bands, artists, festivals…'} />
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

// ─── Induction form ───────────────────────────────────────────────────────────

const EMPTY = {
  target_type:     'profile',
  subject:         null,
  awarded_at:      new Date().toISOString().slice(0,10),
  published_at:    '',
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

function InductionForm({ hofTypeId, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.subject && !initial) {
      set('slug', autoSlug(form.subject.name, form.awarded_at));
    }
  }, [form.subject?.id, form.awarded_at]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.subject) { alert('Select an inductee.'); return; }
    onSave({ ...form, hofTypeId });
  };

  return (
    <AdminCard accent={ACCENT}>
      <form onSubmit={handleSubmit}>
        <FormHeader icon="🏆" title={initial ? 'Edit Hall of Fame Entry' : 'Induct into MSM Hall of Fame'} onCancel={onCancel} />

        <div style={{ margin:'-8px 0 24px', padding:'12px 16px', background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.3)', borderRadius:10, fontSize:12.5, color:'#eab308', lineHeight:1.6 }}>
          Hall of Fame inductions are <strong>permanent editorial recognition</strong>. Records are never deleted — only visibility can be toggled. Non-purchasable.
        </div>

        {/* 1. Inductee */}
        <FormSection title="Inductee" first>
          <Field>
            <Label required>Inductee type</Label>
            <RadioGrid minWidth={200}>
              {[['profile','Band / Artist / Festival'],['gig','Specific gig / performance']].map(([v,l]) => (
                <RadioOption key={v} name="target_type" accent={ACCENT}
                  checked={form.target_type===v}
                  onChange={() => { set('target_type',v); set('subject',null); }}
                >{l}</RadioOption>
              ))}
            </RadioGrid>
          </Field>

          <Field>
            <Label required>{form.target_type==='gig' ? 'Select gig / performance' : 'Select inductee'}</Label>
            <SubjectSearch key={form.target_type} targetType={form.target_type} value={form.subject} onChange={v => set('subject', v)} />
          </Field>
        </FormSection>

        {/* 2. Content */}
        <FormSection title="Content">
          <Field>
            <Label>Induction headline</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
              placeholder={`e.g. "Pioneering the Southampton indie scene since 2012"`} />
          </Field>
          <Field>
            <Label>Citation / biography</Label>
            <Textarea accent={ACCENT} rows={5} value={form.body_text} onChange={e => set('body_text', e.target.value)}
              placeholder="Editorial citation, biography, or reason for induction. Shown on the Hall of Fame archive page." />
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
              <img src={form.image_url} alt={form.image_alt||''} style={{ height:96, width:'auto', borderRadius:10, border:'1px solid rgba(255,255,255,0.09)', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
            </Field>
          )}
        </FormSection>

        {/* 3. Feature link, schedule & slug */}
        <FormSection title="Feature Link, Schedule & Slug">
          <Field>
            <Label>MSM feature / tribute URL</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.review_url} onChange={e => set('review_url', e.target.value)}
              placeholder="https://musicscenemagazine.co.uk/features/…" />
            <HelpText>Strongly recommended — shown as "Read Feature" on the archive page.</HelpText>
          </Field>

          <Field>
            <FieldRow>
              <div>
                <Label required>Induction date</Label>
                <TextInput accent={ACCENT} wide type="date" value={form.awarded_at} onChange={e => set('awarded_at', e.target.value)} required />
              </div>
              <div>
                <Label>Publish date / time</Label>
                <TextInput accent={ACCENT} wide type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
                <HelpText>Blank = publish immediately.</HelpText>
              </div>
            </FieldRow>
          </Field>

          <Field>
            <Label>Archive slug</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.slug} onChange={e => set('slug', e.target.value)} style={{ fontFamily:'monospace', fontSize:12.5 }}
              placeholder="hall-of-fame-band-name-2026" />
            <HelpText>Permanent URL: /editorial-archive/{form.slug || '…'}</HelpText>
          </Field>
        </FormSection>

        {/* 4. Display Options */}
        <FormSection title="Display Options">
          <FieldRow>
            <div>
              <Label>Display order</Label>
              <TextInput accent={ACCENT} wide type="number" value={form.display_order} min="0"
                onChange={e => set('display_order', parseInt(e.target.value)||0)} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:18, paddingTop:2 }}>
              <ToggleSetting accent={ACCENT} checked={form.is_pinned} onChange={v => set('is_pinned', v)} label="Pin to top" />
              <ToggleSetting accent={ACCENT} checked={form.archive_visible} onChange={v => set('archive_visible', v)}
                label="Visible in Hall of Fame" hint="Uncheck only to suppress temporarily" />
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
          <PrimaryButton type="submit" accent={ACCENT} disabled={saving||!form.subject}>
            {saving ? 'Saving…' : initial ? 'Save changes' : '🏆 Induct into Hall of Fame'}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={onCancel}>Cancel</SecondaryButton>
        </ActionsRow>
      </form>
    </AdminCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminHallOfFame() {
  const [hofTypeId, setHofTypeId]   = useState(null);
  const [inductees, setInductees]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [filterYear, setFilterYear] = useState('all');
  const [filterVis, setFilterVis]   = useState('all');
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  useEffect(() => {
    supabase.from('editorial_award_types').select('id').eq('slug','hall_of_fame').single()
      .then(({ data }) => { if (data) setHofTypeId(data.id); });
  }, []);

  const load = async () => {
    if (!hofTypeId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_editorial_features', { p_award_type_slug: 'hall_of_fame' });
      if (error) throw error;
      setInductees(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [hofTypeId]);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        award_type_id:   form.hofTypeId,
        gig_id:          form.target_type==='gig'     ? form.subject.id : null,
        profile_id:      form.target_type==='profile' ? form.subject.id : null,
        awarded_by:      user.id,
        awarded_at:      form.awarded_at,
        published_at:    form.published_at  || null,
        headline:        form.headline      || null,
        body_text:       form.body_text     || null,
        review_url:      form.review_url    || null,
        image_url:       form.image_url     || null,
        image_alt:       form.image_alt     || null,
        slug:            form.slug          || null,
        notes:           form.notes         || null,
        archive_visible: form.archive_visible,
        is_pinned:       form.is_pinned,
        display_order:   form.display_order,
        active:          true,
      };
      if (editItem) {
        row.updated_by = user.id;
        const { error } = await supabase.from('editorial_features').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Entry updated.');
      } else {
        row.created_by = user.id;
        const { error } = await supabase.from('editorial_features').insert(row);
        if (error) throw error;
        showToast(`${form.subject.name} inducted into the MSM Hall of Fame.`);
      }
      setShowForm(false); setEditItem(null);
      await load();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleVisibility = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ archive_visible: !current }).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    showToast(`Entry ${!current?'shown in':'hidden from'} public Hall of Fame.`);
    await load();
  };

  const togglePin = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ is_pinned: !current }).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    await load();
  };

  const openEdit = (i) => {
    setEditItem(i);
    setShowForm(true);
  };

  const toForm = (i) => ({
    target_type:     i.gig_id ? 'gig' : 'profile',
    subject:         i.gig_id
      ? { id: i.gig_id, label: `${i.gig_band_name} @ ${i.gig_venue}`, name: i.gig_band_name }
      : { id: i.profile_id, label: i.profile_name, name: i.profile_name },
    awarded_at:      i.awarded_at ? new Date(i.awarded_at).toISOString().slice(0,10) : '',
    published_at:    i.published_at ? new Date(i.published_at).toISOString().slice(0,16) : '',
    headline:        i.headline    || '',
    body_text:       i.body_text   || '',
    review_url:      i.review_url  || '',
    image_url:       i.image_url   || '',
    image_alt:       i.image_alt   || '',
    slug:            i.slug        || '',
    notes:           i.notes       || '',
    archive_visible: i.archive_visible,
    is_pinned:       i.is_pinned,
    display_order:   i.display_order || 0,
  });

  const subjectLabel = (i) => i.gig_id ? `${i.gig_band_name} @ ${i.gig_venue}` : (i.profile_name||'—');
  const years = [...new Set(inductees.map(i => fmtYear(i.awarded_at)))].sort((a,b)=>b-a);

  const filtered = inductees.filter(i => {
    if (filterYear !== 'all' && fmtYear(i.awarded_at) !== parseInt(filterYear)) return false;
    if (filterVis  === 'visible' && !i.archive_visible) return false;
    if (filterVis  === 'hidden'  &&  i.archive_visible) return false;
    return true;
  });

  return (
    <AdminPage>
      <AdminHeader
        icon="🏆" title="MSM Hall of Fame" subtitle="Permanent editorial recognition — non-purchasable"
        action={!showForm && (
          <PrimaryButton accent={ACCENT} disabled={!hofTypeId} onClick={() => { setShowForm(true); setEditItem(null); }}>🏆 Induct</PrimaryButton>
        )}
      />

      <SystemNotice accent={ACCENT}>
        <strong>EDITORIAL SYSTEM — HALL OF FAME</strong> — Inductions are permanent. Records are never deleted — only visibility can be toggled. Non-purchasable and separate from all commercial systems.
      </SystemNotice>

      <StatGrid minWidth={160}>
        <StatCard value={inductees.length} label="Total inductees" />
        <StatCard value={inductees.filter(i=>i.archive_visible).length} label="Publicly visible" />
        <StatCard value={years.length} label="Years represented" />
      </StatGrid>

      <Toast toast={toast} />

      {showForm && hofTypeId && (
        <InductionForm
          hofTypeId={hofTypeId}
          initial={editItem ? toForm(editItem) : null}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
          saving={saving}
        />
      )}

      <ResultsPanel title="Inductees" count={`${filtered.length} inductee${filtered.length!==1?'s':''}`}>
        <FilterBar>
          <Select accent={ACCENT} value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ maxWidth:140 }}>
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select accent={ACCENT} value={filterVis} onChange={e => setFilterVis(e.target.value)} style={{ maxWidth:180 }}>
            <option value="all">All visibility</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </Select>
        </FilterBar>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : error ? (
          <div style={{ fontSize:13, color:'#f87171', padding:'14px 16px', background:'rgba(248,113,113,0.1)', borderRadius:10 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🏆">No inductees yet. Use the button above to induct.</EmptyState>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {filtered.map(i => (
              <div key={i.id} style={{
                background:'#141414', border:`1px solid ${i.archive_visible ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius:14, padding:20, opacity: i.archive_visible ? 1 : 0.6,
              }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
                  {i.image_url && (
                    <img src={i.image_url} alt={i.image_alt||''} style={{ width:64, height:64, borderRadius:10, objectFit:'cover', border:'1px solid rgba(255,255,255,0.09)', flexShrink:0 }} onError={e=>e.target.style.display='none'} />
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                      <div>
                        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, marginBottom:8 }}>
                          {i.is_pinned && <span style={{ fontSize:12 }}>📌</span>}
                          <Pill color="#eab308">{fmtYear(i.awarded_at)}</Pill>
                          {!i.archive_visible && <Pill>Hidden</Pill>}
                        </div>
                        <p style={{ fontWeight:700, color:'#fff', margin:0 }}>{subjectLabel(i)}</p>
                        {i.headline && <p style={{ fontSize:14, color:'#eab308', fontWeight:600, margin:'6px 0 0' }}>{i.headline}</p>}
                        {i.body_text && <p style={{ fontSize:12.5, color:'#8a8a8a', margin:'8px 0 0', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{i.body_text}</p>}
                        {i.slug && <p style={{ fontSize:11, color:'#666', fontFamily:'monospace', margin:'8px 0 0' }}>/editorial-archive/{i.slug}</p>}
                      </div>
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap', flexShrink:0 }}>
                        <SmallActionButton onClick={() => openEdit(i)}>Edit</SmallActionButton>
                        <SmallActionButton tone={i.archive_visible ? 'neutral' : 'positive'} onClick={() => toggleVisibility(i.id, i.archive_visible)}>
                          {i.archive_visible ? 'Hide' : 'Show'}
                        </SmallActionButton>
                        <SmallActionButton tone={i.is_pinned ? 'accent' : 'neutral'} accent="#eab308" onClick={() => togglePin(i.id, i.is_pinned)}>
                          {i.is_pinned?'Unpin':'Pin'}
                        </SmallActionButton>
                        {i.review_url && (
                          <SmallActionButton tone="accent" accent={ACCENT} onClick={() => window.open(i.review_url, '_blank', 'noopener,noreferrer')}>
                            Feature ↗
                          </SmallActionButton>
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize:11.5, color:'#666', margin:'14px 0 0' }}>Inducted {fmtDate(i.awarded_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ResultsPanel>

      {inductees.length > 0 && (
        <p style={{ marginTop:28, fontSize:12, color:'#666', textAlign:'center', lineHeight:1.7 }}>
          Hall of Fame records are permanent. Entries cannot be deleted — only hidden from public view.
        </p>
      )}
    </AdminPage>
  );
}
