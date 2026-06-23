/**
 * AdminSupporters.jsx
 * MSM Gig Calendar – Phase 5A
 * Founding Supporters management screen.
 *
 * SYSTEM: COMMUNITY only. No commercial or editorial content here.
 * Route:  /admin/founding-supporters
 *
 * Rules:
 *  - One record per profile (unique constraint enforced at DB)
 *  - No tiers, no payment, no renewal
 *  - Admin grant / revoke only
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      active ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-500'
    }`}>
      {active ? 'Active' : 'Revoked'}
    </span>
  );
}

// ─── Profile search ───────────────────────────────────────────────────────────

function ProfileSearch({ value, onChange, excludeIds = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_search_profiles', {
        p_query: q,
        p_limit: 15,
      });
      if (error) throw error;
      // Filter out already-granted profiles
      const filtered = (data || []).filter(p => !excludeIds.includes(p.id));
      setResults(filtered);
      setOpen(true);
    } catch (e) {
      console.error('Profile search error:', e);
    } finally {
      setLoading(false);
    }
  }, [excludeIds]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  function labelFor(p) {
    return `${p.band_name}${p.city ? ` – ${p.city}` : ''}${p.profile_type ? ` [${p.profile_type}]` : ''}`;
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search registered bands, artists, festivals…"
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {loading && <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(p => (
            <li
              key={p.id}
              onClick={() => {
                onChange({ id: p.id, label: labelFor(p), name: p.band_name });
                setQuery(labelFor(p));
                setOpen(false);
              }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-purple-50"
            >
              {labelFor(p)}
            </li>
          ))}
        </ul>
      )}
      {open && results.length === 0 && !loading && (
        <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 px-3 py-2 text-sm text-gray-400">
          No results — profile must be registered in the system
        </div>
      )}
      {value && (
        <p className="mt-1 text-xs text-purple-700 font-medium">✓ Selected: {value.label}</p>
      )}
    </div>
  );
}

// ─── Grant form ───────────────────────────────────────────────────────────────

function GrantForm({ existingIds, onGrant, onCancel, saving }) {
  const [profile, setProfile] = useState(null);
  const [notes, setNotes]     = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!profile) { alert('Select a profile to grant Founding Supporter status to.'); return; }
    onGrant({ profile, notes });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-purple-50 border border-purple-200 rounded-lg p-5">
      <h3 className="font-semibold text-gray-800 text-sm">Grant Founding Supporter Status</h3>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Profile *</label>
        <ProfileSearch
          value={profile}
          onChange={setProfile}
          excludeIds={existingIds}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (internal)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Reason for granting status, internal notes…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
        />
      </div>

      <div className="p-3 bg-purple-100 rounded text-xs text-purple-800">
        Founding Supporter status is community recognition only. It cannot be purchased. 
        One record per profile is enforced — profiles already granted are excluded from search.
      </div>

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || !profile}
          className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Granting…' : 'Grant status'}
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

export default function AdminSupporters() {
  const [supporters, setSupporters]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filterActive, setFilterActive] = useState('active');
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_founding_supporters');
      if (error) throw error;
      setSupporters(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // IDs of profiles already granted (for excluding from search)
  const grantedProfileIds = supporters.map(s => s.profile_id);

  // ── Grant ──
  async function handleGrant({ profile, notes }) {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from('founding_supporters').insert({
        profile_id: profile.id,
        granted_by: user.id,
        notes:      notes || null,
        active:     true,
      });

      if (error) {
        // Unique constraint violation
        if (error.code === '23505') {
          throw new Error(`${profile.name} already has Founding Supporter status.`);
        }
        throw error;
      }

      showToast(`Founding Supporter status granted to ${profile.name}.`);
      setShowForm(false);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle active (revoke / restore) ──
  async function toggleActive(id, name, current) {
    const action = current ? 'revoke' : 'restore';
    if (!window.confirm(`${action === 'revoke' ? 'Revoke' : 'Restore'} Founding Supporter status for ${name}?`)) return;

    try {
      const { error } = await supabase
        .from('founding_supporters')
        .update({ active: !current })
        .eq('id', id);
      if (error) throw error;
      showToast(`Status ${action === 'revoke' ? 'revoked' : 'restored'} for ${name}.`);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const filtered = supporters.filter(s => {
    if (filterActive === 'active' && !s.active) return false;
    if (filterActive === 'revoked' && s.active) return false;
    return true;
  });

  const activeCount  = supporters.filter(s => s.active).length;
  const revokedCount = supporters.filter(s => !s.active).length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Founding Supporters</h1>
          <p className="text-sm text-gray-500 mt-0.5">Community recognition — non-purchasable</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold rounded shadow-sm"
        >
          + Grant status
        </button>
      </div>

      {/* System notice */}
      <div className="mb-5 p-3 bg-purple-50 border border-purple-200 rounded text-xs text-purple-800">
        <strong>COMMUNITY SYSTEM</strong> — Founding Supporter status is recognition for early registered 
        members. It cannot be purchased and is separate from editorial awards and commercial listings.
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total', value: supporters.length, color: 'gray' },
          { label: 'Active', value: activeCount, color: 'purple' },
          { label: 'Revoked', value: revokedCount, color: 'red' },
        ].map(s => (
          <div key={s.label} className="p-3 bg-white border border-gray-200 rounded-lg text-center">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
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
          <GrantForm
            existingIds={grantedProfileIds}
            onGrant={handleGrant}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {[
          { value: 'all',     label: 'All' },
          { value: 'active',  label: 'Active' },
          { value: 'revoked', label: 'Revoked' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilterActive(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
              filterActive === f.value
                ? 'bg-purple-700 border-purple-700 text-white'
                : 'bg-white border-gray-300 text-gray-600 hover:border-purple-400'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 self-center ml-1">
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-lg">
          No supporters found. Grant status above.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Profile</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Granted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((s, i) => (
                <tr key={s.id} className={`${!s.active ? 'opacity-50' : ''} hover:bg-gray-50`}>
                  <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{s.profile_name}</p>
                    {s.profile_city && <p className="text-xs text-gray-400">{s.profile_city}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 capitalize">{s.profile_type}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmt(s.granted_at)}</td>
                  <td className="px-4 py-3"><StatusPill active={s.active} /></td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleActive(s.id, s.profile_name, s.active)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        s.active
                          ? 'border-red-200 text-red-600 hover:bg-red-50'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {s.active ? 'Revoke' : 'Restore'}
                    </button>
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
