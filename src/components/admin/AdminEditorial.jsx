/**
 * AdminEditorial.jsx
 * MSM Gig Calendar – Phase 5A
 * Editorial Features management screen.
 * Covers: Record of the Week | Album of the Month | Editor's Choice | MSM Recommended
 *
 * SYSTEM: EDITORIAL only. Non-purchasable. Admin/editor assignment only.
 * Route:  /admin/editorial
 *
 * NOTE: Hall of Fame is managed in AdminHallOfFame.jsx
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function generateSlug(awardSlug, subjectName, date) {
  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
  return `${awardSlug}-${slugify(subjectName || 'unknown')}-${year}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SystemBoundaryNotice() {
  return (
    <div className="mb-5 p-3 bg-green-50 border border-green-200 rounded text-xs text-green-800">
      <strong>EDITORIAL SYSTEM</strong> — Awards are non-purchasable and assigned by MSM editorial 
      staff only. There is a strict firewall between editorial awards and commercial featured listings.
    </div>
  );
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

function AwardTypeBadge({ label, colorHex, singleton }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-white"
      style={{ backgroundColor: `#${colorHex}` }}
    >
      {singleton ? '🔁' : '✦'} {label}
    </span>
  );
}

// ─── Profile/Gig search ───────────────────────────────────────────────────────

function SubjectSearch({ targetType, value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      let data, error;
      if (targetType === 'gig') {
        ({ data, error } = await supabase.rpc('admin_search_gigs', { p_query: q, p_limit: 10 }));
      } else {
        // profile search (band, festival, solo_artist, etc.)
        ({ data, error } = await supabase.rpc('admin_search_profiles', { p_query: q, p_limit: 10 }));
      }
      if (error) throw error;
      setResults(data || []);
      setOpen(true);
    } catch (e) {
      console.error('Subject search error:', e);
    } finally {
      setLoading(false);
    }
  }, [targetType]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  function labelFor(item) {
    if (targetType === 'gig') return `${item.band_name} @ ${item.venue} (${fmt(item.date)})`;
    return `${item.band_name}${item.city ? ` – ${item.city}` : ''}${item.profile_type ? ` [${item.profile_type}]` : ''}`;
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${targetType === 'gig' ? 'gigs' : 'bands / artists / festivals'}…`}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
      {loading && <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li
              key={item.id}
              onClick={() => {
                const label = labelFor(item);
                const name = targetType === 'gig' ? item.band_name : item.band_name;
                onChange({ id: item.id, label, name });
                setQuery(label);
                setOpen(false);
              }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-green-50"
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

// ─── Award form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  award_type_id: '',
  target_type: 'profile',   // 'gig' | 'profile'
  subject: null,
  awarded_at: new Date().toISOString().slice(0, 10),
  review_url: '',
  notes: '',
  archive_visible: true,
  slug: '',
};

function EditorialForm({ awardTypes, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const selectedType = awardTypes.find(a => a.id === form.award_type_id);

  // Auto-generate slug when subject or award type changes
  useEffect(() => {
    if (selectedType && form.subject) {
      set('slug', generateSlug(selectedType.slug, form.subject.name, form.awarded_at));
    }
  }, [form.award_type_id, form.subject?.id, form.awarded_at]);

  function validate() {
    if (!form.award_type_id) return 'Select an award type.';
    if (!form.subject) return 'Select a gig or profile to assign this award to.';
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { alert(err); return; }
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-green-50 border border-green-200 rounded-lg p-5">
      <h3 className="font-semibold text-gray-800 text-sm">
        {initial ? 'Edit Award' : 'Assign Editorial Award'}
      </h3>

      {/* Award type selection */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Award type *</label>
        <div className="grid grid-cols-2 gap-2">
          {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
            <label key={a.id} className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer transition-colors ${
              form.award_type_id === a.id
                ? 'border-green-500 bg-white'
                : 'border-gray-200 bg-white hover:border-green-300'
            }`}>
              <input
                type="radio"
                name="award_type"
                value={a.id}
                checked={form.award_type_id === a.id}
                onChange={() => set('award_type_id', a.id)}
                className="sr-only"
              />
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: `#${a.color_hex}` }}
              />
              <span className="text-xs font-medium text-gray-800">{a.label}</span>
              {a.singleton && (
                <span className="text-xs text-orange-600 ml-auto">Singleton</span>
              )}
            </label>
          ))}
        </div>
        {selectedType?.singleton && (
          <p className="mt-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            ⚠ Singleton award — only one active at a time. Assigning this will prompt you to 
            deactivate any existing active award of this type.
          </p>
        )}
      </div>

      {/* Target type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Award applies to</label>
        <div className="flex gap-3">
          {[
            { value: 'profile', label: 'Band / Artist / Festival' },
            { value: 'gig',     label: 'Specific gig' },
          ].map(tt => (
            <label key={tt.value} className="flex items-center gap-1.5 cursor-pointer text-sm">
              <input
                type="radio"
                name="target_type"
                value={tt.value}
                checked={form.target_type === tt.value}
                onChange={() => { set('target_type', tt.value); set('subject', null); }}
              />
              {tt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Subject search */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {form.target_type === 'gig' ? 'Select gig *' : 'Select band / artist / festival *'}
        </label>
        <SubjectSearch
          targetType={form.target_type}
          value={form.subject}
          onChange={v => set('subject', v)}
        />
      </div>

      {/* Award date */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Award date *</label>
        <input
          type="date"
          value={form.awarded_at}
          onChange={e => set('awarded_at', e.target.value)}
          required
          className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Review URL */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Review / article URL (for archive link)
        </label>
        <input
          type="url"
          value={form.review_url}
          onChange={e => set('review_url', e.target.value)}
          placeholder="https://musicscenemagazine.co.uk/reviews/…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Slug */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Archive slug (auto-generated, editable)
        </label>
        <input
          type="text"
          value={form.slug}
          onChange={e => set('slug', e.target.value)}
          placeholder="record-of-the-week-band-name-2025"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Public URL: /editorial-archive/{form.slug || '…'}
        </p>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (internal)</label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
          placeholder="Internal notes — not shown publicly"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
      </div>

      {/* Archive visibility */}
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={form.archive_visible}
          onChange={e => set('archive_visible', e.target.checked)}
        />
        Show in public archive
      </label>

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Assign award'}
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

export default function AdminEditorial() {
  const [awardTypes, setAwardTypes]     = useState([]);
  const [features, setFeatures]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filterType, setFilterType]     = useState('all');
  const [filterActive, setFilterActive] = useState('all');
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function loadAwardTypes() {
    const { data } = await supabase
      .from('editorial_award_types')
      .select('*')
      .order('sort_order');
    setAwardTypes(data || []);
  }

  async function loadFeatures() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_editorial_features');
      if (error) throw error;
      setFeatures(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAwardTypes();
    loadFeatures();
  }, []);

  // ── Check for active singleton conflict ──
  async function checkSingletonConflict(awardTypeId) {
    const type = awardTypes.find(a => a.id === awardTypeId);
    if (!type?.singleton) return false;

    const activeOfType = features.filter(f => f.award_type_id === awardTypeId && f.active);
    if (activeOfType.length === 0) return false;

    return window.confirm(
      `There is already an active "${type.label}" award.\n\n` +
      `The existing award will be deactivated before assigning the new one.\n\nContinue?`
    );
  }

  async function deactivateSingletons(awardTypeId) {
    const { error } = await supabase
      .from('editorial_features')
      .update({ active: false })
      .eq('award_type_id', awardTypeId)
      .eq('active', true);
    if (error) throw error;
  }

  // ── Save ──
  async function handleSave(form) {
    setSaving(true);
    try {
      const type = awardTypes.find(a => a.id === form.award_type_id);

      // Singleton conflict check
      if (type?.singleton) {
        const hasConflict = features.some(f => f.award_type_id === form.award_type_id && f.active);
        if (hasConflict) {
          const confirmed = await checkSingletonConflict(form.award_type_id);
          if (!confirmed) { setSaving(false); return; }
          await deactivateSingletons(form.award_type_id);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();

      const row = {
        award_type_id:   form.award_type_id,
        gig_id:          form.target_type === 'gig' ? form.subject.id : null,
        profile_id:      form.target_type === 'profile' ? form.subject.id : null,
        awarded_by:      user.id,
        awarded_at:      form.awarded_at,
        review_url:      form.review_url || null,
        notes:           form.notes || null,
        archive_visible: form.archive_visible,
        slug:            form.slug || null,
        active:          true,
      };

      const { error } = await supabase.from('editorial_features').insert(row);
      if (error) throw error;

      showToast('Award assigned.');
      setShowForm(false);
      await loadFeatures();
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
        .from('editorial_features')
        .update({ active: !current })
        .eq('id', id);
      if (error) throw error;
      showToast(`Award ${!current ? 'activated' : 'deactivated'}.`);
      await loadFeatures();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ── Toggle archive visibility ──
  async function toggleArchive(id, current) {
    try {
      const { error } = await supabase
        .from('editorial_features')
        .update({ archive_visible: !current })
        .eq('id', id);
      if (error) throw error;
      showToast(`Archive visibility ${!current ? 'shown' : 'hidden'}.`);
      await loadFeatures();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ── Filtered ──
  const filtered = features.filter(f => {
    if (f.is_hall_of_fame) return false; // HOF handled separately
    if (filterType !== 'all' && f.award_slug !== filterType) return false;
    if (filterActive === 'active' && !f.active) return false;
    if (filterActive === 'inactive' && f.active) return false;
    return true;
  });

  function subjectLabel(f) {
    if (f.gig_id) return `${f.gig_band_name} @ ${f.gig_venue}`;
    return f.profile_name || '—';
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Editorial Awards</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Non-purchasable — editorial assignment only
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded shadow-sm"
        >
          + Assign award
        </button>
      </div>

      <SystemBoundaryNotice />

      {/* Active singletons summary */}
      <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {awardTypes.filter(a => a.singleton && !a.is_hall_of_fame).map(a => {
          const active = features.find(f => f.award_type_id === a.id && f.active);
          return (
            <div key={a.id} className="p-3 bg-white border border-gray-200 rounded-lg">
              <p className="text-xs font-medium text-gray-500 mb-1">{a.label}</p>
              {active ? (
                <p className="text-sm font-semibold text-gray-900 truncate">{subjectLabel(active)}</p>
              ) : (
                <p className="text-sm text-gray-400 italic">None assigned</p>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
        }`}>
          {toast.msg}
        </div>
      )}

      {showForm && (
        <div className="mb-6">
          <EditorialForm
            awardTypes={awardTypes}
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
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">All award types</option>
          {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
            <option key={a.id} value={a.slug}>{a.label}</option>
          ))}
        </select>
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <span className="text-xs text-gray-400 self-center ml-1">
          {filtered.length} award{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-lg">
          No awards found. Assign one above.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Award</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Archive</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(f => (
                <tr key={f.id} className={`${!f.active ? 'opacity-50' : ''} hover:bg-gray-50`}>
                  <td className="px-4 py-3">
                    <AwardTypeBadge
                      label={f.award_label}
                      colorHex={f.award_color_hex}
                      singleton={f.award_singleton}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{subjectLabel(f)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(f.awarded_at)}</td>
                  <td className="px-4 py-3"><StatusPill active={f.active} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${f.archive_visible ? 'text-green-700' : 'text-gray-400'}`}>
                      {f.archive_visible ? '✓ Visible' : '— Hidden'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => toggleActive(f.id, f.active)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600"
                      >
                        {f.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => toggleArchive(f.id, f.archive_visible)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600"
                      >
                        {f.archive_visible ? 'Hide' : 'Show'} in archive
                      </button>
                      {f.review_url && (
                        <a
                          href={f.review_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50"
                        >
                          Review ↗
                        </a>
                      )}
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
