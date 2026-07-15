/**
 * AdminHallOfFame.jsx — Phase 5A-2
 * MSM Gig Calendar | Hall of Fame Management
 * Permanent editorial recognition — non-purchasable.
 * Records are never deleted, only visibility controlled.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtYear  = (d) => d ? new Date(d).getFullYear() : '—';
const slugify  = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
const autoSlug = (name, date) => `hall-of-fame-${slugify(name||'unknown')}-${date ? new Date(date).getFullYear() : new Date().getFullYear()}`;

// ─── Shared atoms ─────────────────────────────────────────────────────────────

const Label = ({children, required}) => (
  <label className="block text-xs font-semibold text-gray-600 mb-2">
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);
const HelpText = ({children}) => <p className="mt-2 text-xs text-gray-500 leading-relaxed">{children}</p>;
const Field = ({children, className=''}) => <div className={`mb-6 last:mb-0 ${className}`}>{children}</div>;
const FormSection = ({title, first, children}) => (
  <div className={first ? 'pb-8' : 'pt-8 pb-8 border-t border-gray-100'}>
    {title && <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-5">{title}</p>}
    {children}
  </div>
);
const Input    = (props) => <input    {...props} className={`w-full max-w-xl border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600 ${props.className||''}`} />;
const Textarea = (props) => <textarea {...props} className={`w-full border border-gray-300 rounded-lg px-3.5 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-yellow-600 resize-y ${props.className||''}`} />;
const Toggle   = ({checked, onChange, label, hint}) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <div className="relative mt-0.5 flex-shrink-0">
      <input type="checkbox" className="sr-only" checked={checked} onChange={e=>onChange(e.target.checked)} />
      <div className={`w-9 h-5 rounded-full transition-colors ${checked?'bg-yellow-600':'bg-gray-300'}`} />
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked?'translate-x-4':''}`} />
    </div>
    <div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  </label>
);
const Toast = ({toast}) => toast ? (
  <div className={`mb-5 px-4 py-3 rounded-lg text-sm font-medium ${toast.type==='error'?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}`}>{toast.msg}</div>
) : null;

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
    <div className="relative">
      <Input type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder={targetType === 'gig' ? 'Search gigs…' : 'Search bands, artists, festivals…'} />
      {loading && <div className="absolute right-3 top-2.5 text-xs text-gray-500">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-30 w-full max-w-xl bg-white border border-gray-200 rounded-lg shadow-lg mt-2 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li key={item.id} onClick={() => select(item)}
              className="px-3.5 py-2.5 text-sm cursor-pointer hover:bg-yellow-50 border-b border-gray-50 last:border-0">
              {labelFor(item)}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-30 w-full max-w-xl bg-white border border-gray-200 rounded-lg shadow-lg mt-2 px-3.5 py-2.5 text-sm text-gray-500">No results</div>
      )}
      {value && <p className="mt-2 text-xs text-yellow-700 font-medium">✓ {value.label}</p>}
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
    <form onSubmit={handleSubmit} className="bg-white border-2 border-yellow-400 rounded-xl p-8 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏆</span>
          <h3 className="font-bold text-gray-900 text-base">{initial ? 'Edit Hall of Fame Entry' : 'Induct into MSM Hall of Fame'}</h3>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-600 text-xl leading-none">×</button>
      </div>

      <div className="mt-4 mb-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-900 leading-relaxed">
        Hall of Fame inductions are <strong>permanent editorial recognition</strong>. Records are never deleted — only visibility can be toggled. Non-purchasable.
      </div>

      {/* 1. Inductee */}
      <FormSection title="Inductee" first>
        <Field>
          <Label required>Inductee type</Label>
          <div className="flex flex-wrap gap-5">
            {[['profile','Band / Artist / Festival'],['gig','Specific gig / performance']].map(([v,l]) => (
              <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="target_type" checked={form.target_type===v}
                  onChange={() => { set('target_type',v); set('subject',null); }} />
                {l}
              </label>
            ))}
          </div>
        </Field>

        <Field className="mb-0">
          <Label required>{form.target_type==='gig' ? 'Select gig / performance' : 'Select inductee'}</Label>
          <SubjectSearch key={form.target_type} targetType={form.target_type} value={form.subject} onChange={v => set('subject', v)} />
        </Field>
      </FormSection>

      {/* 2. Content */}
      <FormSection title="Content">
        <Field>
          <Label>Induction headline</Label>
          <Input type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
            placeholder={`e.g. "Pioneering the Southampton indie scene since 2012"`} />
        </Field>
        <Field>
          <Label>Citation / biography</Label>
          <Textarea rows={5} value={form.body_text} onChange={e => set('body_text', e.target.value)}
            placeholder="Editorial citation, biography, or reason for induction. Shown on the Hall of Fame archive page." />
        </Field>
        <Field className={form.image_url ? '' : 'mb-0'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Label>Image URL</Label>
              <Input type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label>Image alt text</Label>
              <Input type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)} placeholder="Describe the image" />
            </div>
          </div>
        </Field>
        {form.image_url && (
          <Field className="mb-0">
            <img src={form.image_url} alt={form.image_alt||''} className="h-24 w-auto rounded-lg border border-gray-200 object-cover" onError={e=>e.target.style.display='none'} />
          </Field>
        )}
      </FormSection>

      {/* 3. Feature link, schedule & slug */}
      <FormSection title="Feature Link, Schedule & Slug">
        <Field>
          <Label>MSM feature / tribute URL</Label>
          <Input type="url" value={form.review_url} onChange={e => set('review_url', e.target.value)}
            placeholder="https://musicscenemagazine.co.uk/features/…" />
          <HelpText>Strongly recommended — shown as "Read Feature" on the archive page.</HelpText>
        </Field>

        <Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-6">
            <div>
              <Label required>Induction date</Label>
              <Input type="date" value={form.awarded_at} onChange={e => set('awarded_at', e.target.value)} required />
            </div>
            <div>
              <Label>Publish date / time</Label>
              <Input type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
              <HelpText>Blank = publish immediately.</HelpText>
            </div>
          </div>
        </Field>

        <Field className="mb-0">
          <Label>Archive slug</Label>
          <Input type="text" value={form.slug} onChange={e => set('slug', e.target.value)} className="font-mono text-xs"
            placeholder="hall-of-fame-band-name-2026" />
          <HelpText>Permanent URL: /editorial-archive/{form.slug || '…'}</HelpText>
        </Field>
      </FormSection>

      {/* 4. Display Options */}
      <FormSection title="Display Options">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-6">
          <div>
            <Label>Display order</Label>
            <Input type="number" value={form.display_order} min="0"
              onChange={e => set('display_order', parseInt(e.target.value)||0)} />
          </div>
          <div className="space-y-4 sm:pt-1">
            <Toggle checked={form.is_pinned} onChange={v => set('is_pinned', v)} label="Pin to top" />
            <Toggle checked={form.archive_visible} onChange={v => set('archive_visible', v)}
              label="Visible in Hall of Fame" hint="Uncheck only to suppress temporarily" />
          </div>
        </div>
      </FormSection>

      {/* 5. Internal/Admin Notes */}
      <FormSection title="Internal / Admin Notes">
        <Field className="mb-0">
          <Label>Internal notes</Label>
          <Textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Admin-only notes — not shown publicly" />
        </Field>
      </FormSection>

      {/* 6. Actions */}
      <div className="flex gap-4 pt-8 border-t border-gray-100">
        <button type="submit" disabled={saving||!form.subject}
          className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save changes' : '🏆 Induct into Hall of Fame'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
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
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">🏆 MSM Hall of Fame</h1>
          <p className="text-sm text-gray-500 mt-1">Permanent editorial recognition — non-purchasable</p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditItem(null); }} disabled={!hofTypeId}
            className="px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-40 self-start sm:self-auto">
            🏆 Induct
          </button>
        )}
      </div>

      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-300 rounded-lg text-xs text-yellow-900 leading-relaxed">
        <strong>EDITORIAL SYSTEM — HALL OF FAME</strong> — Inductions are permanent. Records are never deleted — only visibility can be toggled. Non-purchasable and separate from all commercial systems.
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total inductees',   value: inductees.length },
          { label: 'Publicly visible',  value: inductees.filter(i=>i.archive_visible).length },
          { label: 'Years represented', value: years.length },
        ].map(s => (
          <div key={s.label} className="p-5 bg-white border border-gray-200 rounded-xl text-center">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      <Toast toast={toast} />

      {showForm && hofTypeId && (
        <div className="mb-8">
          <InductionForm
            hofTypeId={hofTypeId}
            initial={editItem ? toForm(editItem) : null}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditItem(null); }}
            saving={saving}
          />
        </div>
      )}

      {/* Filters -- visually separated from the results below */}
      <div className="flex flex-wrap gap-3 items-center mb-5 pb-5 border-b border-gray-200">
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterVis} onChange={e => setFilterVis(e.target.value)}
          className="border border-gray-300 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-600">
          <option value="all">All visibility</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
        <span className="text-xs text-gray-500 ml-1">{filtered.length} inductee{filtered.length!==1?'s':''}</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4 px-4 bg-red-50 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-4xl mb-3">🏆</p>
          <p className="text-gray-500 text-sm">No inductees yet. Use the button above to induct.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(i => (
            <div key={i.id} className={`bg-white border rounded-xl p-5 transition-all ${i.archive_visible ? 'border-yellow-200 shadow-sm' : 'border-gray-200 opacity-60'}`}>
              <div className="flex items-start gap-4">
                {i.image_url && (
                  <img src={i.image_url} alt={i.image_alt||''} className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0" onError={e=>e.target.style.display='none'} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        {i.is_pinned && <span className="text-yellow-500 text-xs">📌</span>}
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800">
                          {fmtYear(i.awarded_at)}
                        </span>
                        {!i.archive_visible && (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Hidden</span>
                        )}
                      </div>
                      <p className="font-bold text-gray-900">{subjectLabel(i)}</p>
                      {i.headline && <p className="text-sm text-yellow-700 font-medium mt-1">{i.headline}</p>}
                      {i.body_text && <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{i.body_text}</p>}
                      {i.slug && <p className="text-xs text-gray-500 font-mono mt-1.5">/editorial-archive/{i.slug}</p>}
                    </div>
                    <div className="flex gap-2 flex-wrap flex-shrink-0">
                      <button onClick={() => openEdit(i)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 text-gray-600">Edit</button>
                      <button onClick={() => toggleVisibility(i.id, i.archive_visible)}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${i.archive_visible?'border-gray-300 hover:bg-gray-100 text-gray-600':'border-green-300 text-green-700 hover:bg-green-50'}`}>
                        {i.archive_visible ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={() => togglePin(i.id, i.is_pinned)}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${i.is_pinned?'border-yellow-300 bg-yellow-50 text-yellow-700':'border-gray-300 hover:bg-gray-100 text-gray-600'}`}>
                        {i.is_pinned?'Unpin':'Pin'}
                      </button>
                      {i.review_url && (
                        <a href={i.review_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs px-2.5 py-1.5 rounded-md border border-yellow-200 text-yellow-700 hover:bg-yellow-50">Feature ↗</a>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">Inducted {fmtDate(i.awarded_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {inductees.length > 0 && (
        <p className="mt-8 text-xs text-gray-500 text-center leading-relaxed">
          Hall of Fame records are permanent. Entries cannot be deleted — only hidden from public view.
        </p>
      )}
    </div>
  );
}
