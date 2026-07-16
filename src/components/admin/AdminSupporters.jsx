/**
 * AdminSupporters.jsx — Phase 5A-2
 * MSM Gig Calendar | Founding Supporters Management
 * Community recognition — non-purchasable.
 * One record per profile. Permanent — never deleted, only revoked/restored.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice, StatGrid, StatCard,
  AdminCard, FormHeader, FormSection, FieldRow, Field, Label, HelpText,
  TextInput, Select, Textarea, ToggleSetting,
  ActionsRow, PrimaryButton, SecondaryButton, SmallActionButton,
  FilterBar, ResultsPanel, EmptyState, Pill, Toast,
  SearchDropdown, SearchOption, SearchEmpty,
} from './adminUI';

const ACCENT = ACCENTS.supporters;

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTER_LEVELS = [
  'Founding Supporter',
  'Community Supporter',
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'Headline Sponsor',
];

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';

const levelColour = (level) => {
  const map = {
    'Platinum':            '#818cf8',
    'Gold':                '#fbbf24',
    'Silver':               '#9ca3af',
    'Bronze':               '#fb923c',
    'Headline Sponsor':      '#f87171',
    'Community Supporter':   '#2dd4bf',
    'Founding Supporter':    ACCENT,
  };
  return map[level] || ACCENT;
};

// ─── Profile search ───────────────────────────────────────────────────────────

function ProfileSearch({ value, onChange, excludeIds=[] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (query) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_search_profiles', { p_query: query, p_limit: 15 });
      if (error) throw error;
      setResults((data||[]).filter(p => !excludeIds.includes(p.id)));
      setOpen(true);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [excludeIds]);

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  const labelFor = (p) => `${p.band_name}${p.city?` — ${p.city}`:''}${p.profile_type?` [${p.profile_type}]`:''}`;

  const select = (p) => {
    onChange({ id: p.id, label: labelFor(p), name: p.band_name });
    setQ(labelFor(p));
    setOpen(false);
  };

  return (
    <div style={{ position:'relative' }}>
      <TextInput accent={ACCENT} type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search registered bands, artists, festivals…" />
      {loading && <div style={{ marginTop:6, fontSize:12, color:'#8a8a8a' }}>Searching…</div>}
      {open && results.length > 0 && (
        <SearchDropdown>
          {results.map(p => <SearchOption key={p.id} onClick={() => select(p)}>{labelFor(p)}</SearchOption>)}
        </SearchDropdown>
      )}
      {open && !loading && results.length === 0 && <SearchEmpty>No results — profile must be registered in the system</SearchEmpty>}
      {value && <p style={{ marginTop:8, fontSize:12, color:ACCENT, fontWeight:600 }}>✓ {value.label}</p>}
    </div>
  );
}

// ─── Supporter form ───────────────────────────────────────────────────────────

const EMPTY = {
  profile:         null,
  supporter_level: 'Founding Supporter',
  website_url:     '',
  headline:        '',
  body_text:       '',
  image_url:       '',
  image_alt:       '',
  published_at:    '',
  expires_at:      '',
  notes:           '',
  archive_visible: true,
  is_pinned:       false,
  display_order:   0,
};

function SupporterForm({ existingIds, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!initial && !form.profile) { alert('Select a profile.'); return; }
    onSave(form);
  };

  return (
    <AdminCard accent={ACCENT}>
      <form onSubmit={handleSubmit}>
        <FormHeader icon="💜" title={initial ? 'Edit Supporter' : 'Grant Founding Supporter Status'} onCancel={onCancel} />

        {/* 1. Subject & Level */}
        <FormSection title="Subject & Level" first>
          {!initial && (
            <Field>
              <Label required>Profile</Label>
              <ProfileSearch value={form.profile} onChange={v => set('profile', v)} excludeIds={existingIds} />
            </Field>
          )}

          <Field>
            <Label required>Supporter level</Label>
            <Select accent={ACCENT} wide value={form.supporter_level} onChange={e => set('supporter_level', e.target.value)}>
              {SUPPORTER_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </Select>
            <HelpText>Level is for display and filtering only — no automated privileges.</HelpText>
          </Field>

          <Field>
            <Label>Website URL</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.website_url} onChange={e => set('website_url', e.target.value)}
              placeholder="https://…" />
            <HelpText>Shown as an external link on the supporters page.</HelpText>
          </Field>
        </FormSection>

        {/* 2. Content */}
        <FormSection title="Content">
          <Field>
            <Label>Headline / tagline</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
              placeholder={`e.g. "Supporting live music in Southampton since 2020"`} />
          </Field>
          <Field>
            <Label>Description / bio</Label>
            <Textarea accent={ACCENT} rows={4} value={form.body_text} onChange={e => set('body_text', e.target.value)}
              placeholder="Short description or biography for the supporters page." />
          </Field>
          <Field>
            <FieldRow>
              <div>
                <Label>Logo / image URL</Label>
                <TextInput accent={ACCENT} wide type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…" />
                <HelpText>Replaces profile photo on supporters page.</HelpText>
              </div>
              <div>
                <Label>Image alt text</Label>
                <TextInput accent={ACCENT} wide type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)} placeholder="e.g. Company logo" />
              </div>
            </FieldRow>
          </Field>
          {form.image_url && (
            <Field>
              <img src={form.image_url} alt={form.image_alt||''} style={{ height:80, width:'auto', borderRadius:10, border:'1px solid rgba(255,255,255,0.09)', objectFit:'contain', background:'#0a0a0a', padding:4 }} onError={e=>e.target.style.display='none'} />
            </Field>
          )}
        </FormSection>

        {/* 3. Schedule */}
        <FormSection title="Schedule">
          <FieldRow>
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

        {/* 4. Display Options */}
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
              <ToggleSetting accent={ACCENT} checked={form.archive_visible} onChange={v => set('archive_visible', v)} label="Show publicly" />
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

        <div style={{ padding:'12px 16px', background:'rgba(167,139,250,0.08)', border:'1px solid rgba(167,139,250,0.28)', borderRadius:10, fontSize:12.5, color:ACCENT, lineHeight:1.6, marginBottom:8 }}>
          Founding Supporter status is community recognition only. It cannot be purchased and is separate from editorial awards and commercial listings.
        </div>

        {/* 6. Actions */}
        <ActionsRow>
          <PrimaryButton type="submit" accent={ACCENT} disabled={saving || (!initial && !form.profile)}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Grant status'}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={onCancel}>Cancel</SecondaryButton>
        </ActionsRow>
      </form>
    </AdminCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminSupporters() {
  const [supporters, setSupporters]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterLevel, setFilterLevel]   = useState('all');
  const [showForm, setShowForm]         = useState(false);
  const [editItem, setEditItem]         = useState(null);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_founding_supporters');
      if (error) throw error;
      setSupporters(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const grantedIds = supporters.map(s => s.profile_id);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        supporter_level: form.supporter_level,
        website_url:     form.website_url    || null,
        headline:        form.headline       || null,
        body_text:       form.body_text      || null,
        image_url:       form.image_url      || null,
        image_alt:       form.image_alt      || null,
        published_at:    form.published_at   || null,
        expires_at:      form.expires_at     || null,
        notes:           form.notes          || null,
        archive_visible: form.archive_visible,
        is_pinned:       form.is_pinned,
        display_order:   form.display_order,
      };

      if (editItem) {
        row.updated_by = user.id;
        const { error } = await supabase.from('founding_supporters').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Supporter updated.');
      } else {
        row.profile_id  = form.profile.id;
        row.granted_by  = user.id;
        row.created_by  = user.id;
        row.active      = true;
        const { error } = await supabase.from('founding_supporters').insert(row);
        if (error) {
          if (error.code === '23505') throw new Error(`${form.profile.name} already has Founding Supporter status.`);
          throw error;
        }
        showToast(`Status granted to ${form.profile.name}.`);
      }
      setShowForm(false); setEditItem(null);
      await load();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, name, current) => {
    const action = current ? 'Revoke' : 'Restore';
    if (!window.confirm(`${action} supporter status for ${name}?`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    const update = current
      ? { active: false, deactivated_by: user.id }
      : { active: true,  deactivated_by: null };
    const { error } = await supabase.from('founding_supporters').update(update).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    showToast(`Status ${current?'revoked':'restored'} for ${name}.`);
    await load();
  };

  const togglePin = async (id, current) => {
    const { error } = await supabase.from('founding_supporters').update({ is_pinned: !current }).eq('id', id);
    if (error) { showToast(error.message,'error'); return; }
    await load();
  };

  const openEdit = (s) => { setEditItem(s); setShowForm(true); };

  const toForm = (s) => ({
    profile:         null,
    supporter_level: s.supporter_level || 'Founding Supporter',
    website_url:     s.website_url   || '',
    headline:        s.headline      || '',
    body_text:       s.body_text     || '',
    image_url:       s.image_url     || '',
    image_alt:       s.image_alt     || '',
    published_at:    s.published_at ? new Date(s.published_at).toISOString().slice(0,16) : '',
    expires_at:      s.expires_at   ? new Date(s.expires_at).toISOString().slice(0,16)   : '',
    notes:           s.notes         || '',
    archive_visible: s.archive_visible,
    is_pinned:       s.is_pinned,
    display_order:   s.display_order || 0,
  });

  const levels = [...new Set(supporters.map(s => s.supporter_level).filter(Boolean))];

  const filtered = supporters.filter(s => {
    if (filterStatus === 'active'   && !s.active) return false;
    if (filterStatus === 'revoked'  &&  s.active) return false;
    if (filterLevel  !== 'all'      && s.supporter_level !== filterLevel) return false;
    return true;
  });

  const activeCount  = supporters.filter(s =>  s.active).length;
  const revokedCount = supporters.filter(s => !s.active).length;

  return (
    <AdminPage>
      <AdminHeader
        icon="💜" title="Founding Supporters" subtitle="Community recognition — non-purchasable"
        action={!showForm && (
          <PrimaryButton accent={ACCENT} onClick={() => { setShowForm(true); setEditItem(null); }}>+ Grant status</PrimaryButton>
        )}
      />

      <SystemNotice accent={ACCENT}>
        <strong>COMMUNITY SYSTEM</strong> — Supporter status cannot be purchased. Separate from editorial awards and commercial listings.
      </SystemNotice>

      <StatGrid minWidth={140}>
        <StatCard value={supporters.length} label="Total" />
        <StatCard value={activeCount} label="Active" />
        <StatCard value={revokedCount} label="Revoked" />
      </StatGrid>

      <Toast toast={toast} />

      {showForm && (
        <SupporterForm
          existingIds={grantedIds}
          initial={editItem ? toForm(editItem) : null}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
          saving={saving}
        />
      )}

      <ResultsPanel title="Supporters" count={`${filtered.length} record${filtered.length!==1?'s':''}`}>
        <FilterBar>
          <div style={{ display:'flex', gap:8 }}>
            {[['all','All'],['active','Active'],['revoked','Revoked']].map(([v,l]) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                style={{
                  padding:'9px 16px', fontSize:12.5, fontWeight:600, borderRadius:8, cursor:'pointer',
                  border: filterStatus===v ? `1px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.09)',
                  background: filterStatus===v ? ACCENT : 'transparent',
                  color: filterStatus===v ? '#0d0d0d' : '#b3b3b3',
                }}
              >{l}</button>
            ))}
          </div>
          {levels.length > 0 && (
            <Select accent={ACCENT} value={filterLevel} onChange={e => setFilterLevel(e.target.value)} style={{ maxWidth:200 }}>
              <option value="all">All levels</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </Select>
          )}
        </FilterBar>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : error ? (
          <div style={{ fontSize:13, color:'#f87171', padding:'14px 16px', background:'rgba(248,113,113,0.1)', borderRadius:10 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="💜">No supporters found. Grant status above.</EmptyState>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {filtered.map((s) => (
              <div key={s.id} style={{
                background:'#141414', border:`1px solid ${s.active ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius:14, padding:20, opacity: s.active ? 1 : 0.6,
              }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
                  <div style={{ flexShrink:0 }}>
                    {(s.image_url || s.profile_photo_url) ? (
                      <img src={s.image_url || s.profile_photo_url} alt={s.image_alt||s.profile_name}
                        style={{ width:56, height:56, borderRadius:10, objectFit:'contain', background:'#0a0a0a', border:'1px solid rgba(255,255,255,0.09)', padding:2 }}
                        onError={e=>e.target.style.display='none'} />
                    ) : (
                      <div style={{ width:56, height:56, borderRadius:10, background:'rgba(167,139,250,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ color:ACCENT, fontWeight:700, fontSize:20 }}>{(s.profile_name||'?')[0]}</span>
                      </div>
                    )}
                  </div>

                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                      <div>
                        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, marginBottom:6 }}>
                          {s.is_pinned && <span style={{ fontSize:12 }}>📌</span>}
                          <p style={{ fontWeight:700, color:'#fff', margin:0 }}>{s.profile_name}</p>
                          {s.supporter_level && <Pill color={levelColour(s.supporter_level)}>{s.supporter_level}</Pill>}
                          {!s.active && <Pill tone="negative">Revoked</Pill>}
                        </div>
                        {s.headline && <p style={{ fontSize:13.5, color:ACCENT, fontWeight:600, margin:'2px 0 0' }}>{s.headline}</p>}
                        {s.body_text && <p style={{ fontSize:12.5, color:'#8a8a8a', margin:'8px 0 0', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{s.body_text}</p>}
                        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:'4px 16px', marginTop:10 }}>
                          {s.website_url && (
                            <a href={s.website_url} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize:12, color:'#60a5fa', textDecoration:'none', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              🔗 {s.website_url.replace(/^https?:\/\//, '')}
                            </a>
                          )}
                          {s.profile_city && <span style={{ fontSize:12, color:'#8a8a8a' }}>{s.profile_city}</span>}
                          <span style={{ fontSize:12, color:'#8a8a8a' }}>Since {fmtDate(s.granted_at)}</span>
                        </div>
                      </div>

                      <div style={{ display:'flex', gap:8, flexWrap:'wrap', flexShrink:0 }}>
                        <SmallActionButton onClick={() => openEdit(s)}>Edit</SmallActionButton>
                        <SmallActionButton tone={s.is_pinned ? 'accent' : 'neutral'} accent="#fbbf24" onClick={() => togglePin(s.id, s.is_pinned)}>{s.is_pinned?'Unpin':'Pin'}</SmallActionButton>
                        <SmallActionButton tone={s.active ? 'danger' : 'positive'} onClick={() => toggleActive(s.id, s.profile_name, s.active)}>
                          {s.active?'Revoke':'Restore'}
                        </SmallActionButton>
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
