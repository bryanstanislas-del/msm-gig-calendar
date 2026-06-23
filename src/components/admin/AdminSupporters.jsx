/**
 * AdminSupporters.jsx — Phase 5A-2
 * MSM Gig Calendar | Founding Supporters Management
 * Community recognition — non-purchasable.
 * One record per profile. Permanent — never deleted, only revoked/restored.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

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

// ─── Shared atoms ─────────────────────────────────────────────────────────────

const Label = ({children, required}) => (
  <label className="block text-xs font-semibold text-gray-600 mb-1">
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);
const Input    = (props) => <input    {...props} className={`w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${props.className||''}`} />;
const Textarea = (props) => <textarea {...props} className={`w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none ${props.className||''}`} />;
const Toggle   = ({checked, onChange, label, hint}) => (
  <label className="flex items-start gap-2 cursor-pointer select-none">
    <div className="relative mt-0.5 flex-shrink-0">
      <input type="checkbox" className="sr-only" checked={checked} onChange={e=>onChange(e.target.checked)} />
      <div className={`w-9 h-5 rounded-full transition-colors ${checked?'bg-purple-600':'bg-gray-300'}`} />
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked?'translate-x-4':''}`} />
    </div>
    <div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  </label>
);
const Toast = ({toast}) => toast ? (
  <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${toast.type==='error'?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}`}>{toast.msg}</div>
) : null;

// ─── Level badge ─────────────────────────────────────────────────────────────

const levelColour = (level) => {
  const map = {
    'Platinum':         'bg-indigo-100 text-indigo-800',
    'Gold':             'bg-yellow-100 text-yellow-800',
    'Silver':           'bg-gray-200 text-gray-700',
    'Bronze':           'bg-orange-100 text-orange-700',
    'Headline Sponsor': 'bg-red-100 text-red-800',
    'Community Supporter': 'bg-teal-100 text-teal-800',
    'Founding Supporter':  'bg-purple-100 text-purple-800',
  };
  return map[level] || 'bg-purple-100 text-purple-800';
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
    <div className="relative">
      <Input type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search registered bands, artists, festivals…" />
      {loading && <div className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-30 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(p => (
            <li key={p.id} onClick={() => select(p)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 border-b border-gray-50 last:border-0">
              {labelFor(p)}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-30 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 px-3 py-2 text-sm text-gray-400">
          No results — profile must be registered in the system
        </div>
      )}
      {value && <p className="mt-1 text-xs text-purple-700 font-medium">✓ {value.label}</p>}
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
    <form onSubmit={handleSubmit} className="bg-white border-2 border-purple-200 rounded-xl p-6 space-y-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">{initial ? 'Edit Supporter' : 'Grant Founding Supporter Status'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
      </div>

      {/* Profile (only on create) */}
      {!initial && (
        <div>
          <Label required>Profile</Label>
          <ProfileSearch value={form.profile} onChange={v => set('profile', v)} excludeIds={existingIds} />
        </div>
      )}

      {/* Supporter level */}
      <div>
        <Label required>Supporter level</Label>
        <select value={form.supporter_level} onChange={e => set('supporter_level', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
          {SUPPORTER_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <p className="mt-1 text-xs text-gray-400">Level is for display and filtering only — no automated privileges.</p>
      </div>

      {/* Website URL */}
      <div>
        <Label>Website URL</Label>
        <Input type="url" value={form.website_url} onChange={e => set('website_url', e.target.value)}
          placeholder="https://…" />
        <p className="mt-1 text-xs text-gray-400">Shown as an external link on the supporters page.</p>
      </div>

      {/* Headline + Body */}
      <div>
        <Label>Headline / tagline</Label>
        <Input type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
          placeholder={`e.g. "Supporting live music in Southampton since 2020"`} />
      </div>
      <div>
        <Label>Description / bio</Label>
        <Textarea rows={4} value={form.body_text} onChange={e => set('body_text', e.target.value)}
          placeholder="Short description or biography for the supporters page." />
      </div>

      {/* Logo / image */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Logo / image URL</Label>
          <Input type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…" />
          <p className="mt-1 text-xs text-gray-400">Replaces profile photo on supporters page.</p>
        </div>
        <div>
          <Label>Image alt text</Label>
          <Input type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)} placeholder="e.g. Company logo" />
        </div>
      </div>
      {form.image_url && (
        <img src={form.image_url} alt={form.image_alt||''} className="h-20 w-auto rounded border border-gray-200 object-contain bg-gray-50 p-1" onError={e=>e.target.style.display='none'} />
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Publish date / time</Label>
          <Input type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">Blank = publish immediately.</p>
        </div>
        <div>
          <Label>Expiry date / time</Label>
          <Input type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">Blank = no expiry.</p>
        </div>
      </div>

      {/* Display controls */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Display order</Label>
          <Input type="number" value={form.display_order} min="0"
            onChange={e => set('display_order', parseInt(e.target.value)||0)} />
          <p className="mt-1 text-xs text-gray-400">Lower = higher position.</p>
        </div>
        <div className="space-y-3 pt-5">
          <Toggle checked={form.is_pinned} onChange={v => set('is_pinned', v)} label="Pin to top" hint="Overrides display order" />
          <Toggle checked={form.archive_visible} onChange={v => set('archive_visible', v)} label="Show publicly" />
        </div>
      </div>

      {/* Internal notes */}
      <div>
        <Label>Internal notes</Label>
        <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Admin-only notes — not shown publicly" />
      </div>

      <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-800">
        Founding Supporter status is community recognition only. It cannot be purchased and is separate from editorial awards and commercial listings.
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100">
        <button type="submit" disabled={saving || (!initial && !form.profile)}
          className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Grant status'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-5 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
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
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Founding Supporters</h1>
          <p className="text-sm text-gray-500 mt-0.5">Community recognition — non-purchasable</p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditItem(null); }}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold rounded-lg shadow-sm">
            + Grant status
          </button>
        )}
      </div>

      <div className="mb-5 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
        <strong>COMMUNITY SYSTEM</strong> — Supporter status cannot be purchased. Separate from editorial awards and commercial listings.
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[{l:'Total',v:supporters.length},{l:'Active',v:activeCount},{l:'Revoked',v:revokedCount}].map(s => (
          <div key={s.l} className="p-3 bg-white border border-gray-200 rounded-lg text-center">
            <p className="text-2xl font-bold text-gray-900">{s.v}</p>
            <p className="text-xs text-gray-500">{s.l}</p>
          </div>
        ))}
      </div>

      <Toast toast={toast} />

      {showForm && (
        <div className="mb-6">
          <SupporterForm
            existingIds={grantedIds}
            initial={editItem ? toForm(editItem) : null}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditItem(null); }}
            saving={saving}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="flex gap-1">
          {[['all','All'],['active','Active'],['revoked','Revoked']].map(([v,l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filterStatus===v ? 'bg-purple-700 border-purple-700 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-purple-400'
              }`}>{l}</button>
          ))}
        </div>
        {levels.length > 0 && (
          <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            <option value="all">All levels</option>
            {levels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <span className="text-xs text-gray-400 ml-1">{filtered.length} record{filtered.length!==1?'s':''}</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4 px-4 bg-red-50 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No supporters found. Grant status above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s, i) => (
            <div key={s.id} className={`bg-white border rounded-xl p-4 transition-all ${s.active?'border-purple-100 shadow-sm':'border-gray-200 opacity-60'}`}>
              <div className="flex items-start gap-4">
                {/* Logo / avatar */}
                <div className="flex-shrink-0">
                  {(s.image_url || s.profile_photo_url) ? (
                    <img src={s.image_url || s.profile_photo_url} alt={s.image_alt||s.profile_name}
                      className="w-14 h-14 rounded-lg object-contain bg-gray-50 border border-gray-200 p-0.5"
                      onError={e=>e.target.style.display='none'} />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-600 font-bold text-lg">{(s.profile_name||'?')[0]}</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        {s.is_pinned && <span className="text-yellow-500 text-xs">📌</span>}
                        <p className="font-bold text-gray-900">{s.profile_name}</p>
                        {s.supporter_level && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${levelColour(s.supporter_level)}`}>
                            {s.supporter_level}
                          </span>
                        )}
                        {!s.active && <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Revoked</span>}
                      </div>
                      {s.headline && <p className="text-sm text-purple-700 font-medium">{s.headline}</p>}
                      {s.body_text && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{s.body_text}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        {s.website_url && (
                          <a href={s.website_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline truncate max-w-[200px]">
                            🔗 {s.website_url.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                        {s.profile_city && <span className="text-xs text-gray-400">{s.profile_city}</span>}
                        <span className="text-xs text-gray-400">Since {fmtDate(s.granted_at)}</span>
                      </div>
                    </div>

                    <div className="flex gap-1.5 flex-wrap flex-shrink-0">
                      <button onClick={() => openEdit(s)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600">Edit</button>
                      <button onClick={() => togglePin(s.id, s.is_pinned)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${s.is_pinned?'border-yellow-300 bg-yellow-50 text-yellow-700':'border-gray-300 hover:bg-gray-100 text-gray-600'}`}>
                        {s.is_pinned?'Unpin':'Pin'}</button>
                      <button onClick={() => toggleActive(s.id, s.profile_name, s.active)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${s.active?'border-red-200 text-red-600 hover:bg-red-50':'border-green-200 text-green-700 hover:bg-green-50'}`}>
                        {s.active?'Revoke':'Restore'}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
