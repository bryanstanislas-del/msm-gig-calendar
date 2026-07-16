/**
 * AdminFestivals.jsx
 * MSM Gig Calendar | Festival Management
 *
 * Festivals are not a separate table -- they are public.profiles rows with
 * profile_type = 'festival' (this type already existed in the schema and
 * check constraint; this component is the first admin UI that can create
 * or edit them directly, alongside the existing public claim workflow).
 *
 * A festival profile can exist fully unowned/unclaimed (user_id = null),
 * exactly like the 3 pre-existing festival profiles (New Forest Folk
 * Festival, Hampshire Bowman Beer Festival, Wickham Festival) -- no auth
 * account is created or required here. Ownership can be established later
 * through the existing claim workflow (unchanged).
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice, StatGrid, StatCard,
  AdminCard, FormHeader, FormSection, FieldRow, Field, Label, HelpText,
  TextInput, Textarea,
  ActionsRow, PrimaryButton, SecondaryButton, SmallActionButton,
  FilterBar, ResultsPanel, EmptyState, Toast,
} from './adminUI';

const ACCENT = ACCENTS.festivals;

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const toInput = (d) => d ? new Date(d).toISOString().slice(0,10) : '';

const EMPTY = {
  band_name: '', festival_start_date: '', festival_end_date: '',
  city: '', postcode: '', what3words: '',
  website: '', facebook: '', instagram: '', twitter: '', tiktok_url: '',
  photo_url: '', bio: '',
};

function FestivalForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.band_name.trim()) { alert('Festival name is required.'); return; }
    if (form.festival_start_date && form.festival_end_date && form.festival_end_date < form.festival_start_date) {
      alert('End date cannot be before the start date.'); return;
    }
    onSave(form);
  };

  return (
    <AdminCard accent={ACCENT}>
      <form onSubmit={handleSubmit}>
        <FormHeader icon="🎪" title={initial ? 'Edit Festival' : 'Add Festival'} onCancel={onCancel} />

        {/* 1. Festival details */}
        <FormSection title="Festival Details" first>
          <Field>
            <Label required>Festival name</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.band_name} onChange={e => set('band_name', e.target.value)}
              placeholder="e.g. New Forest Folk Festival" />
          </Field>

          <Field>
            <FieldRow minWidth={180}>
              <div>
                <Label>Start date</Label>
                <TextInput accent={ACCENT} wide type="date" value={form.festival_start_date} onChange={e => set('festival_start_date', e.target.value)} />
              </div>
              <div>
                <Label>End date</Label>
                <TextInput accent={ACCENT} wide type="date" value={form.festival_end_date} min={form.festival_start_date} onChange={e => set('festival_end_date', e.target.value)} />
                <HelpText>Leave blank for a single-day event.</HelpText>
              </div>
            </FieldRow>
          </Field>
        </FormSection>

        {/* 2. Location */}
        <FormSection title="Location">
          <Field>
            <Label>Venue / site & town</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.city} onChange={e => set('city', e.target.value)}
              placeholder="e.g. Powells Farm, Romsey" />
            <HelpText>Site/farm name and nearest town — shown publicly as the festival's location.</HelpText>
          </Field>
          <Field>
            <FieldRow minWidth={180}>
              <div>
                <Label>Postcode</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.postcode} onChange={e => set('postcode', e.target.value)}
                  placeholder="e.g. SO51 6EE" />
              </div>
              <div>
                <Label>what3words <span style={{ fontWeight:400 }}>(optional)</span></Label>
                <TextInput accent={ACCENT} wide type="text" value={form.what3words} onChange={e => set('what3words', e.target.value)}
                  placeholder="e.g. ///table.lamp.spoon" />
                <HelpText>For rural/large sites — pinpoint the correct entrance, press gate, camping entrance or accreditation point where a postcode alone isn't precise enough. Stored and displayed only — not linked to any mapping API.</HelpText>
              </div>
            </FieldRow>
          </Field>
        </FormSection>

        {/* 3. Content */}
        <FormSection title="Content">
          <Field>
            <Label>Description</Label>
            <Textarea accent={ACCENT} rows={4} value={form.bio} onChange={e => set('bio', e.target.value)}
              placeholder="Public description of the festival" />
          </Field>
          <Field>
            <Label>Image / logo URL</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.photo_url} onChange={e => set('photo_url', e.target.value)} placeholder="https://…" />
          </Field>
          {form.photo_url && (
            <Field>
              <img src={form.photo_url} alt="" style={{ height:80, width:'auto', borderRadius:10, border:'1px solid rgba(255,255,255,0.09)', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
            </Field>
          )}
        </FormSection>

        {/* 4. Website & socials */}
        <FormSection title="Website & Social Links">
          <Field>
            <Label>Website</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" />
          </Field>
          <Field>
            <FieldRow>
              <div>
                <Label>Facebook</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.facebook} onChange={e => set('facebook', e.target.value)} placeholder="https://facebook.com/…" />
              </div>
              <div>
                <Label>Instagram</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.instagram} onChange={e => set('instagram', e.target.value)} placeholder="https://instagram.com/…" />
              </div>
              <div>
                <Label>Twitter / X</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.twitter} onChange={e => set('twitter', e.target.value)} placeholder="https://x.com/…" />
              </div>
              <div>
                <Label>TikTok</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.tiktok_url} onChange={e => set('tiktok_url', e.target.value)} placeholder="https://tiktok.com/@…" />
              </div>
            </FieldRow>
          </Field>
        </FormSection>

        {/* 5. Actions */}
        <ActionsRow>
          <PrimaryButton type="submit" accent={ACCENT} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create festival'}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={onCancel}>Cancel</SecondaryButton>
        </ActionsRow>
      </form>
    </AdminCard>
  );
}

export default function AdminFestivals() {
  const [festivals, setFestivals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('profile_type','festival').order('band_name');
      if (error) throw error;
      setFestivals(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const row = {
        band_name:           form.band_name.trim(),
        festival_start_date: form.festival_start_date || null,
        festival_end_date:   form.festival_end_date   || null,
        city:                form.city      || null,
        postcode:            form.postcode  || null,
        what3words:          form.what3words || null,
        website:             form.website   || null,
        facebook:            form.facebook  || null,
        instagram:           form.instagram || null,
        twitter:             form.twitter   || null,
        tiktok_url:          form.tiktok_url || null,
        photo_url:           form.photo_url || null,
        bio:                 form.bio       || null,
      };

      if (editItem) {
        const { error } = await supabase.from('profiles').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Festival updated.');
      } else {
        const { data: slugData } = await supabase.rpc('generate_band_slug', { band_name: row.band_name });
        row.profile_type   = 'festival';
        row.band_slug       = slugData;
        row.band_status     = 'active';
        row.admin_created   = true;
        const { error } = await supabase.from('profiles').insert(row);
        if (error) throw error;
        showToast(`${row.band_name} created.`);
      }
      setShowForm(false); setEditItem(null);
      await load();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openEdit = (f) => { setEditItem(f); setShowForm(true); };

  const toForm = (f) => ({
    band_name:           f.band_name || '',
    festival_start_date: toInput(f.festival_start_date),
    festival_end_date:   toInput(f.festival_end_date),
    city:                f.city || '', postcode: f.postcode || '', what3words: f.what3words || '',
    website:             f.website || '', facebook: f.facebook || '', instagram: f.instagram || '',
    twitter:             f.twitter || '', tiktok_url: f.tiktok_url || '',
    photo_url:           f.photo_url || '', bio: f.bio || '',
  });

  const filtered = festivals.filter(f => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.band_name||'').toLowerCase().includes(q) || (f.city||'').toLowerCase().includes(q) || (f.postcode||'').toLowerCase().includes(q);
  });

  const now = new Date().toISOString().slice(0,10);
  const upcoming = festivals.filter(f => !f.festival_end_date || f.festival_end_date >= now).length;

  return (
    <AdminPage>
      <AdminHeader
        icon="🎪" title="Festivals" subtitle="Festival profiles — profiles.profile_type = 'festival'"
        action={!showForm && (
          <PrimaryButton accent={ACCENT} onClick={() => { setShowForm(true); setEditItem(null); }}>+ Add festival</PrimaryButton>
        )}
      />

      <SystemNotice accent={ACCENT}>
        Festivals are first-class profiles, same as bands, venues and promoters. A festival can exist unclaimed (no owner) — ownership can be established later through the existing claim workflow.
      </SystemNotice>

      <StatGrid minWidth={140}>
        <StatCard value={festivals.length} label="Total festivals" />
        <StatCard value={upcoming} label="Upcoming / ongoing" />
      </StatGrid>

      <Toast toast={toast} />

      {showForm && (
        <FestivalForm
          initial={editItem ? toForm(editItem) : null}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
          saving={saving}
        />
      )}

      <ResultsPanel title="Festival Directory" count={`${filtered.length} festival${filtered.length!==1?'s':''}`}>
        <FilterBar>
          <TextInput accent={ACCENT} type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, town or postcode…" style={{ maxWidth:280 }} />
        </FilterBar>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : error ? (
          <div style={{ fontSize:13, color:'#f87171', padding:'14px 16px', background:'rgba(248,113,113,0.1)', borderRadius:10 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🎪">No festivals found. Add one above.</EmptyState>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {filtered.map(f => (
              <div key={f.id} style={{ background:'#141414', border:'1px solid rgba(255,255,255,0.09)', borderRadius:14, padding:20 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
                  {f.photo_url && (
                    <img src={f.photo_url} alt="" style={{ width:64, height:64, borderRadius:10, objectFit:'cover', border:'1px solid rgba(255,255,255,0.09)', flexShrink:0 }} onError={e=>e.target.style.display='none'} />
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                      <div>
                        <p style={{ fontWeight:700, color:'#fff', margin:0, fontSize:16 }}>{f.band_name}</p>
                        <p style={{ fontSize:12.5, color:ACCENT, margin:'6px 0 0' }}>
                          {fmtDate(f.festival_start_date)}{f.festival_end_date ? ` – ${fmtDate(f.festival_end_date)}` : ''}
                        </p>
                        {(f.city || f.postcode) && (
                          <p style={{ fontSize:12.5, color:'#8a8a8a', margin:'4px 0 0' }}>
                            {[f.city, f.postcode].filter(Boolean).join(' · ')}
                            {f.what3words && <span style={{ marginLeft:8 }}>///{f.what3words.replace(/^\/+/, '')}</span>}
                          </p>
                        )}
                        <p style={{ fontSize:12, color: f.claimed ? '#4ade80' : '#8a8a8a', margin:'6px 0 0' }}>
                          {f.claimed ? '✓ Claimed' : 'Unclaimed'}
                        </p>
                      </div>
                      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                        <SmallActionButton onClick={() => openEdit(f)}>Edit</SmallActionButton>
                        {f.band_slug && (
                          <SmallActionButton tone="accent" accent={ACCENT} onClick={() => window.open(`/festival/${f.band_slug}`, '_blank', 'noopener,noreferrer')}>
                            View page ↗
                          </SmallActionButton>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ResultsPanel>
    </AdminPage>
  );
}
