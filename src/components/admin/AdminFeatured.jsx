/**
 * AdminFeatured.jsx — Phase 5A-2
 * MSM Gig Calendar | Commercial Featured Listings
 * Covers: Featured Gigs · Featured Bands · Featured Venues · Featured Festivals
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

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

// ─── Shared atoms ─────────────────────────────────────────────────────────────

const Label = ({children, required}) => (
  <label className="block text-xs font-semibold text-gray-600 mb-1">
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);
const Input = (props) => (
  <input {...props} className={`w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 ${props.className||''}`} />
);
const Textarea = (props) => (
  <textarea {...props} className={`w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none ${props.className||''}`} />
);
const Toggle = ({checked, onChange, label, hint}) => (
  <label className="flex items-start gap-2 cursor-pointer select-none">
    <div className="relative mt-0.5 flex-shrink-0">
      <input type="checkbox" className="sr-only" checked={checked} onChange={e=>onChange(e.target.checked)} />
      <div className={`w-9 h-5 rounded-full transition-colors ${checked?'bg-yellow-500':'bg-gray-300'}`} />
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked?'translate-x-4':''}`} />
    </div>
    <div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  </label>
);
const Toast = ({toast}) => toast ? (
  <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${toast.type==='error'?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}`}>{toast.msg}</div>
) : null;

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
    <div className="relative">
      <Input type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder={`Search ${entityType}s…`} />
      {loading && <div className="absolute right-3 top-2.5 text-xs text-gray-500">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-30 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li key={item.id} onClick={() => select(item)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-yellow-50 border-b border-gray-50 last:border-0">
              {labelFor(item)}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-30 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 px-3 py-2 text-sm text-gray-500">No results</div>
      )}
      {value && <p className="mt-1 text-xs text-yellow-700 font-medium">✓ {value.label}</p>}
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
    <form onSubmit={handleSubmit} className="bg-white border-2 border-yellow-200 rounded-xl p-6 space-y-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">{initial ? 'Edit Featured Listing' : 'New Featured Listing'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-600 text-xl leading-none">×</button>
      </div>

      {/* Entity type tabs */}
      <div>
        <Label required>Featured type</Label>
        <div className="flex gap-2">
          {ENTITY_TYPES.map(et => (
            <button key={et.value} type="button"
              onClick={() => { set('entity_type', et.value); set('entity', null); }}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                form.entity_type === et.value
                  ? 'bg-yellow-500 border-yellow-600 text-white shadow-sm'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-yellow-400'
              }`}>
              {et.icon} {et.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entity search */}
      <div>
        <Label required>Select {form.entity_type}</Label>
        <EntitySearch key={form.entity_type} entityType={form.entity_type} value={form.entity} onChange={v => set('entity', v)} />
      </div>

      {/* Listing tier */}
      <div>
        <Label required>Listing tier</Label>
        <div className="grid grid-cols-2 gap-3">
          {LISTING_TYPES.map(lt => (
            <label key={lt.value} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              form.listing_type === lt.value ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'
            }`}>
              <input type="radio" name="listing_type" value={lt.value} className="sr-only"
                checked={form.listing_type === lt.value} onChange={() => set('listing_type', lt.value)} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{lt.label}</p>
                <p className="text-xs text-gray-500">{lt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Headline + Body */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <Label>Headline</Label>
          <Input type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
            placeholder="Optional — entity name used if blank" />
        </div>
        <div>
          <Label>Body text</Label>
          <Textarea rows={3} value={form.body_text} onChange={e => set('body_text', e.target.value)}
            placeholder="Optional editorial copy for this listing" />
        </div>
      </div>

      {/* Image */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Image URL</Label>
          <Input type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <Label>Image alt text</Label>
          <Input type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)} placeholder="Describe the image" />
        </div>
      </div>
      {form.image_url && (
        <img src={form.image_url} alt={form.image_alt||''} className="h-20 w-auto rounded border border-gray-200 object-cover" onError={e=>e.target.style.display='none'} />
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required>Start date</Label>
          <Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} required />
        </div>
        <div>
          <Label>End date</Label>
          <Input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} min={form.start_date} />
          <p className="mt-1 text-xs text-gray-500">Leave blank for ongoing.</p>
        </div>
        <div>
          <Label>Publish date / time</Label>
          <Input type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">Blank = publish immediately.</p>
        </div>
        <div>
          <Label>Expiry date / time</Label>
          <Input type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">Blank = no expiry.</p>
        </div>
      </div>

      {/* Display controls */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Display order</Label>
          <Input type="number" value={form.display_order} min="0"
            onChange={e => set('display_order', parseInt(e.target.value)||0)} />
          <p className="mt-1 text-xs text-gray-500">Lower = higher position.</p>
        </div>
        <div className="space-y-3 pt-5">
          <Toggle checked={form.is_pinned} onChange={v => set('is_pinned', v)} label="Pin to top" hint="Overrides display order" />
          <Toggle checked={form.archive_visible} onChange={v => set('archive_visible', v)} label="Show in archive" />
        </div>
      </div>

      {/* Notes */}
      <div>
        <Label>Internal notes</Label>
        <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Admin-only notes — not shown publicly" />
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100">
        <button type="submit" disabled={saving}
          className="px-5 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create listing'}
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
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Featured Listings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Commercial system — Gigs, Bands, Venues, Festivals</p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditItem(null); }}
            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold rounded-lg shadow-sm">
            + New listing
          </button>
        )}
      </div>

      <div className="mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
        <strong>COMMERCIAL SYSTEM</strong> — Featured listings are paid placements. Strict firewall from Editorial Awards.
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {ENTITY_TYPES.map(et => (
          <div key={et.value} className="p-3 bg-white border border-gray-200 rounded-lg text-center">
            <p className="text-xl font-bold text-gray-900">{counts[et.value]}</p>
            <p className="text-xs text-gray-500">{et.icon} {et.label}</p>
          </div>
        ))}
      </div>

      <Toast toast={toast} />

      {showForm && (
        <div className="mb-6">
          <FeaturedForm
            initial={editItem ? toForm(editItem) : null}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditItem(null); }}
            saving={saving}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
          <option value="all">All types</option>
          {ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.icon} {et.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="text-xs text-gray-500 ml-1">{filtered.length} listing{filtered.length!==1?'s':''}</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4 px-4 bg-red-50 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 text-sm">No listings found. Create one above.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Type','Entity','Headline','Tier','Dates','Status','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(l => (
                <tr key={l.id} className={`hover:bg-gray-50 transition-colors ${!l.active?'opacity-50':''}`}>
                  <td className="px-4 py-3 text-xs font-medium text-gray-600">
                    {l.is_pinned && <span className="text-yellow-500 mr-1">📌</span>}
                    {ENTITY_TYPES.find(e=>e.value===l.entity_type)?.icon} {l.entity_type}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-[160px]">{entityLabel(l)}</p>
                    {l.image_url && <p className="text-xs text-gray-500">📷 Image</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[140px] truncate">{l.headline||'—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                      l.listing_type==='gold' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {l.listing_type==='gold'?'★ Gold':'◆ Blue'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    <p>{fmtDate(l.start_date)}</p>
                    <p>{l.end_date ? `→ ${fmtDate(l.end_date)}` : '→ ongoing'}</p>
                    {l.expires_at && <p className="text-orange-500">Exp: {fmtDate(l.expires_at)}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${l.active?'bg-green-100 text-green-800':'bg-gray-100 text-gray-500'}`}>
                      {l.active?'Active':'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      <button onClick={() => openEdit(l)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600">Edit</button>
                      <button onClick={() => toggleActive(l.id, l.active)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600">
                        {l.active?'Deactivate':'Activate'}</button>
                      <button onClick={() => togglePin(l.id, l.is_pinned)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${l.is_pinned?'border-yellow-300 bg-yellow-50 text-yellow-700':'border-gray-300 hover:bg-gray-100 text-gray-600'}`}>
                        {l.is_pinned?'Unpin':'Pin'}</button>
                      <button onClick={() => deleteListing(l.id)}
                        className="text-xs px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
