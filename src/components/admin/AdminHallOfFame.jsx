/**
 * AdminHallOfFame.jsx
 * MSM Gig Calendar – Phase 5A
 * MSM Hall of Fame administration screen.
 *
 * SYSTEM: EDITORIAL — Hall of Fame is a permanent editorial award.
 * Route:  /admin/hall-of-fame
 *
 * Rules:
 *  - Non-purchasable. Editorial discretion only.
 *  - Permanent archive — entries are never deleted, only suppressed.
 *  - Entries always archive_visible unless explicitly hidden by admin.
 *  - No singleton restriction — multiple inductees permitted.
 *  - Separate screen from general editorial awards for clarity and prestige.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtYear(date) {
  if (!date) return '—';
  return new Date(date).getFullYear();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ─── Profile / Gig search ─────────────────────────────────────────────────────

function SubjectSearch({ targetType, value, onChange }) {
  const [query, setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]     = useState(false);

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      let data, error;
      if (targetType === 'gig') {
        ({ data, error } = await supabase.rpc('admin_search_gigs', { p_query: q, p_limit: 10 }));
      } else {
        ({ data, error } = await supabase.rpc('admin_search_profiles', { p_query: q, p_limit: 10 }));
      }
      if (error) throw error;
      setResults(data || []);
      setOpen(true);
    } catch (e) {
      console.error('HOF search error:', e);
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
    return `${item.band_name}${item.city ? ` – ${item.city}` : ''}`;
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${targetType === 'gig' ? 'gigs' : 'bands / artists / festivals'}…`}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600"
      />
      {loading && <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li
              key={item.id}
              onClick={() => {
                const label = labelFor(item);
                const name  = item.band_name || item.name;
                onChange({ id: item.id, label, name });
                setQuery(label);
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
        <p className="mt-1 text-xs text-yellow-700 font-medium">✓ Selected: {value.label}</p>
      )}
    </div>
  );
}

// ─── Induction form ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  target_type:     'profile',
  subject:         null,
  awarded_at:      new Date().toISOString().slice(0, 10),
  review_url:      '',
  notes:           '',
  archive_visible: true,
  slug:            '',
};

function InductionForm({ hofTypeId, onSave, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY_FORM);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Auto-generate slug
  useEffect(() => {
    if (form.subject) {
      const year = form.awarded_at ? new Date(form.awarded_at).getFullYear() : new Date().getFullYear();
      set('slug', `hall-of-fame-${slugify(form.subject.name)}-${year}`);
    }
  }, [form.subject?.id, form.awarded_at]);

  function validate() {
    if (!form.subject) return 'Select a band, artist, or festival to induct.';
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { alert(err); return; }
    onSave({ ...form, hofTypeId });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg p-5">
      <div className="flex items-center gap-2">
        <span className="text-xl">🏆</span>
        <h3 className="font-bold text-gray-900">Induct into MSM Hall of Fame</h3>
      </div>

      <div className="p-3 bg-yellow-100 rounded text-xs text-yellow-900">
        Hall of Fame inductions are <strong>permanent editorial recognition</strong>. 
        This record will remain in the archive indefinitely. 
        It cannot be purchased and is separate from all commercial listings.
      </div>

      {/* Target type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Inductee type</label>
        <div className="flex gap-3">
          {[
            { value: 'profile', label: 'Band / Artist / Festival' },
            { value: 'gig',     label: 'Specific gig / performance' },
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

      {/* Subject */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {form.target_type === 'gig' ? 'Select gig *' : 'Select inductee *'}
        </label>
        <SubjectSearch
          targetType={form.target_type}
          value={form.subject}
          onChange={v => set('subject', v)}
        />
      </div>

      {/* Induction date */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Induction date *</label>
        <input
          type="date"
          value={form.awarded_at}
          onChange={e => set('awarded_at', e.target.value)}
          required
          className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600"
        />
      </div>

      {/* Review / feature URL */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          MSM feature / tribute URL (recommended)
        </label>
        <input
          type="url"
          value={form.review_url}
          onChange={e => set('review_url', e.target.value)}
          placeholder="https://musicscenemagazine.co.uk/features/…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600"
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
          placeholder="hall-of-fame-band-name-2025"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-600"
        />
        <p className="mt-1 text-xs text-gray-400">
          Public URL: /editorial-archive/{form.slug || '…'}
        </p>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Citation / notes
        </label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          placeholder="Reason for induction, citation text, editorial notes…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600 resize-none"
        />
      </div>

      {/* Archive visibility */}
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={form.archive_visible}
          onChange={e => set('archive_visible', e.target.checked)}
        />
        Show in public Hall of Fame archive
        <span className="text-xs text-gray-400">(defaults on — only uncheck to suppress temporarily)</span>
      </label>

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || !form.subject}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold rounded disabled:opacity-50"
        >
          {saving ? 'Inducting…' : '🏆 Induct into Hall of Fame'}
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

export default function AdminHallOfFame() {
  const [hofTypeId, setHofTypeId]       = useState(null);
  const [inductees, setInductees]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filterYear, setFilterYear]     = useState('all');
  const [filterVisible, setFilterVisible] = useState('all');
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // Load HOF award type ID
  useEffect(() => {
    supabase
      .from('editorial_award_types')
      .select('id')
      .eq('slug', 'hall_of_fame')
      .single()
      .then(({ data }) => {
        if (data) setHofTypeId(data.id);
      });
  }, []);

  async function load() {
    if (!hofTypeId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_editorial_features', {
        p_award_type_slug: 'hall_of_fame',
      });
      if (error) throw error;
      setInductees(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (hofTypeId) load(); }, [hofTypeId]);

  // ── Induct ──
  async function handleInduct(form) {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const row = {
        award_type_id:   form.hofTypeId,
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

      showToast(`${form.subject.name} inducted into the MSM Hall of Fame.`);
      setShowForm(false);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle archive visibility ──
  async function toggleVisibility(id, name, current) {
    const action = current ? 'hide from' : 'show in';
    if (!window.confirm(`${current ? 'Hide' : 'Show'} ${name} in the public Hall of Fame?`)) return;
    try {
      const { error } = await supabase
        .from('editorial_features')
        .update({ archive_visible: !current })
        .eq('id', id);
      if (error) throw error;
      showToast(`${name} ${action} public archive.`);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // Available years for filter
  const years = [...new Set(inductees.map(i => fmtYear(i.awarded_at)))].sort((a, b) => b - a);

  const filtered = inductees.filter(i => {
    if (filterYear !== 'all' && fmtYear(i.awarded_at) !== parseInt(filterYear)) return false;
    if (filterVisible === 'visible' && !i.archive_visible) return false;
    if (filterVisible === 'hidden' && i.archive_visible) return false;
    return true;
  });

  function subjectLabel(i) {
    if (i.gig_id) return `${i.gig_band_name} @ ${i.gig_venue}`;
    return i.profile_name || '—';
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            🏆 MSM Hall of Fame
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Permanent editorial recognition — non-purchasable
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={!hofTypeId}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold rounded shadow-sm disabled:opacity-40"
        >
          🏆 Induct
        </button>
      </div>

      {/* System notice */}
      <div className="mb-5 p-3 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-900">
        <strong>EDITORIAL SYSTEM — HALL OF FAME</strong> — Inductions are permanent. 
        Entries are never deleted — only visibility can be toggled. 
        The Hall of Fame is editorial-only and has no commercial connection.
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="p-3 bg-white border border-gray-200 rounded-lg text-center">
          <p className="text-2xl font-bold text-gray-900">{inductees.length}</p>
          <p className="text-xs text-gray-500">Total inductees</p>
        </div>
        <div className="p-3 bg-white border border-gray-200 rounded-lg text-center">
          <p className="text-2xl font-bold text-gray-900">{inductees.filter(i => i.archive_visible).length}</p>
          <p className="text-xs text-gray-500">Publicly visible</p>
        </div>
        <div className="p-3 bg-white border border-gray-200 rounded-lg text-center">
          <p className="text-2xl font-bold text-gray-900">{years.length}</p>
          <p className="text-xs text-gray-500">Years represented</p>
        </div>
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
        }`}>
          {toast.msg}
        </div>
      )}

      {showForm && hofTypeId && (
        <div className="mb-6">
          <InductionForm
            hofTypeId={hofTypeId}
            onSave={handleInduct}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600"
        >
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={filterVisible}
          onChange={e => setFilterVisible(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600"
        >
          <option value="all">All visibility</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
        <span className="text-xs text-gray-400 self-center ml-1">
          {filtered.length} inductee{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-gray-200 rounded-lg">
          <p className="text-4xl mb-3">🏆</p>
          <p className="text-sm text-gray-400">No inductees yet. Use the button above to induct.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-yellow-50 border-b border-yellow-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Year</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Inductee</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Inducted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Archive</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Feature link</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(i => (
                <tr key={i.id} className="hover:bg-yellow-50/40">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-800">
                      {fmtYear(i.awarded_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{subjectLabel(i)}</p>
                    {i.slug && (
                      <p className="text-xs text-gray-400 font-mono">/editorial-archive/{i.slug}</p>
                    )}
                    {i.notes && (
                      <p className="text-xs text-gray-500 mt-0.5 italic truncate max-w-xs">{i.notes}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmt(i.awarded_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${i.archive_visible ? 'text-green-700' : 'text-gray-400'}`}>
                      {i.archive_visible ? '✓ Visible' : '— Hidden'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {i.review_url ? (
                      <a
                        href={i.review_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-yellow-700 hover:underline"
                      >
                        Feature ↗
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleVisibility(i.id, subjectLabel(i), i.archive_visible)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-gray-600"
                    >
                      {i.archive_visible ? 'Hide' : 'Show'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Permanent record notice */}
      {inductees.length > 0 && (
        <p className="mt-4 text-xs text-gray-400 text-center">
          Hall of Fame records are permanent. Entries cannot be deleted — only hidden from public view.
        </p>
      )}
    </div>
  );
}
