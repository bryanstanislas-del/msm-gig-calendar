/**
 * AdminFeatured.jsx
 * MSM Gig Calendar – Phase 5A
 * Commercial Featured Listings management screen.
 * Supports: Featured Gigs | Featured Bands | Featured Venues | Featured Festivals
 *
 * SYSTEM: COMMERCIAL only. No editorial or community content here.
 * Route:  /admin/featured
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { value: 'gig',      label: 'Featured Gigs',      icon: '🎵' },
  { value: 'band',     label: 'Featured Bands',      icon: '🎸' },
  { value: 'venue',    label: 'Featured Venues',     icon: '📍' },
  { value: 'festival', label: 'Featured Festivals',  icon: '🎪' },
];

const LISTING_TYPES = [
  { value: 'gold', label: 'Gold', description: 'Premium – homepage spotlight' },
  { value: 'blue', label: 'Blue', description: 'Standard – calendar badge' },
];

const TODAY = new Date().toISOString().split('T')[0];

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function ListingTypePill({ type }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
      type === 'gold'
        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
        : 'bg-blue-100 text-blue-800 border border-blue-300'
    }`}>
      {type === 'gold' ? '★ Gold' : '◆ Blue'}
    </span>
  );
}

// ─── Entity search components ─────────────────────────────────────────────────

function EntitySearch({ entityType, value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      let data, error;
      if (entityType === 'venue') {
        ({ data, error } = await supabase.rpc('admin_search_venues', { p_query: q, p_limit: 10 }));
      } else if (entityType === 'gig') {
        ({ data, error } = await supabase.rpc('admin_search_gigs', { p_query: q, p_limit: 10 }));
      } else {
        // band or festival → profiles
        ({ data, error } = await supabase.rpc('admin_search_profiles', {
          p_query: q,
          p_profile_type: entityType,
          p_limit: 10,
        }));
      }
      if (error) throw error;
      setResults(data || []);
      setOpen(true);
    } catch (e) {
      console.error('Entity search error:', e);
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  function labelFor(item) {
    if (entityType === 'gig') return `${item.band_name} @ ${item.venue} (${fmt(item.date)})`;
    if (entityType === 'venue') return `${item.name} – ${item.city}`;
    return `${item.band_name}${item.city ? ` – ${item.city}` : ''}`;
  }

  function idFor(item) {
    return item.id;
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${entityType}s…`}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
      />
      {loading && (
        <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Searching…</div>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li
              key={idFor(item)}
              onClick={() => {
                onChange({ id: idFor(item), label: labelFor(item) });
                setQuery(labelFor(item));
                setOpen(false);
              }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-yellow-50"
            >
              {labelFor(item)}
            </li>
          ))}
        </ul>
      )}
      {open && results.length === 0 && !loading && (
        <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 px-3 py-2 text-sm text-gray-400">
          No results found
        </div>
      )}
      {value && (
        <p className="mt-1 text-xs text-green-700 font-medium">✓ Selected: {value.label}</p>
      )}
    </div>
  );
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  entity_type: 'gig',
  listing_type: 'blue',
  entity: null,
  start_date: TODAY,
  end_date: '',
  notes: '',
};

function FeaturedForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function validate() {
    if (!form.entity) return 'Please select an entity.';
    if (!form.start_date) return 'Start date is required.';
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { alert(err); return; }
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-yellow-50 border border-yellow-200 rounded-lg p-5">
      <h3 className="font-semibold text-gray-800 text-sm">
        {initial ? 'Edit Featured Listing' : 'New Featured Listing'}
      </h3>

      {/* Entity type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Featured type</label>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map(et => (
            <button
              key={et.value}
              type="button"
              onClick={() => { set('entity_type', et.value); set('entity', null); }}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                form.entity_type === et.value
                  ? 'bg-yellow-500 border-yellow-600 text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:border-yellow-400'
              }`}
            >
              {et.icon} {et.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entity search */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Select {form.entity_type}
        </label>
        <EntitySearch
          entityType={form.entity_type}
          value={form.entity}
          onChange={v => set('entity', v)}
        />
      </div>

      {/* Listing type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Listing tier</label>
        <div className="flex gap-3">
          {LISTING_TYPES.map(lt => (
            <label key={lt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="listing_type"
                value={lt.value}
                checked={form.listing_type === lt.value}
                onChange={() => set('listing_type', lt.value)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">{lt.label}</span>
                <span className="text-gray-500 text-xs block">{lt.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Start date *</label>
          <input
            type="date"
            value={form.start_date}
            onChange={e => set('start_date', e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">End date (optional)</label>
          <input
            type="date"
            value={form.end_date}
            onChange={e => set('end_date', e.target.value)}
            min={form.start_date}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (internal)</label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
          placeholder="Internal notes — not shown publicly"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save listing'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminFeatured() {
  const [listings, setListings]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [filterType, setFilterType]   = useState('all');
  const [filterActive, setFilterActive] = useState('all');
  const [showForm, setShowForm]       = useState(false);
  const [editItem, setEditItem]       = useState(null);
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Load ──
  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_featured_listings');
      if (error) throw error;
      setListings(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Save (create) ──
  async function handleSave(form) {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const row = {
        entity_type:  form.entity_type,
        listing_type: form.listing_type,
        start_date:   form.start_date,
        end_date:     form.end_date || null,
        notes:        form.notes || null,
        active:       true,
        created_by:   user.id,
      };

      // Assign the correct FK based on entity_type
      if (form.entity_type === 'gig')      row.gig_id     = form.entity.id;
      if (form.entity_type === 'venue')     row.venue_id   = form.entity.id;
      if (form.entity_type === 'band')      row.profile_id = form.entity.id;
      if (form.entity_type === 'festival')  row.profile_id = form.entity.id;

      const { error } = await supabase.from('featured_listings').insert(row);
      if (error) throw error;

      showToast('Featured listing created.');
      setShowForm(false);
      setEditItem(null);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle active ──
  async function toggleActive(id, current) {
    try {
      const { error } = await supabase
        .from('featured_listings')
        .update({ active: !current })
        .eq('id', id);
      if (error) throw error;
      showToast(`Listing ${!current ? 'activated' : 'deactivated'}.`);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ── Delete ──
  async function deleteListing(id) {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    try {
      const { error } = await supabase.from('featured_listings').delete().eq('id', id);
      if (error) throw error;
      showToast('Listing deleted.');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ── Filtered list ──
  const filtered = listings.filter(l => {
    if (filterType !== 'all' && l.entity_type !== filterType) return false;
    if (filterActive === 'active' && !l.active) return false;
    if (filterActive === 'inactive' && l.active) return false;
    return true;
  });

  function entityLabel(l) {
    if (l.entity_type === 'gig')   return `${l.gig_band_name} @ ${l.gig_venue}`;
    if (l.entity_type === 'venue') return `${l.venue_name} – ${l.venue_city}`;
    return l.profile_name || '—';
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Featured Listings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Commercial system — Gigs, Bands, Venues, Festivals
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditItem(null); }}
          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold rounded shadow-sm"
        >
          + New listing
        </button>
      </div>

      {/* System boundary notice */}
      <div className="mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
        <strong>COMMERCIAL SYSTEM</strong> — Featured listings are paid placements. 
        Do not conflate with Editorial Features or Founding Supporters.
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Add form */}
      {showForm && !editItem && (
        <div className="mb-6">
          <FeaturedForm
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
        >
          <option value="all">All types</option>
          {ENTITY_TYPES.map(et => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <span className="text-xs text-gray-400 self-center ml-1">
          {filtered.length} listing{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-lg">
          No listings found. Create one above.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Entity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Dates</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(l => (
                <tr key={l.id} className={`${!l.active ? 'opacity-50' : ''} hover:bg-gray-50`}>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-gray-600 capitalize">
                      {ENTITY_TYPES.find(e => e.value === l.entity_type)?.icon} {l.entity_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{entityLabel(l)}</td>
                  <td className="px-4 py-3"><ListingTypePill type={l.listing_type} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {fmt(l.start_date)}{l.end_date ? ` → ${fmt(l.end_date)}` : ' → ongoing'}
                  </td>
                  <td className="px-4 py-3"><StatusPill active={l.active} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => toggleActive(l.id, l.active)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600"
                      >
                        {l.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => deleteListing(l.id)}
                        className="text-xs px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-600"
                      >
                        Delete
                      </button>
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
