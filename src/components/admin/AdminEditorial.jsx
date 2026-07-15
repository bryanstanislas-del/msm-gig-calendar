/**
 * AdminEditorial.jsx — Phase 5A-2
 * MSM Gig Calendar | Editorial Awards Management
 * Covers: Record of the Week · Album of the Month · Editor's Choice · MSM Recommended
 * Hall of Fame is managed separately in AdminHallOfFame.jsx
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const toDateInput = (d) => d ? new Date(d).toISOString().slice(0,10) : '';
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
const autoSlug = (awardSlug, name, date) =>
  `${awardSlug}-${slugify(name||'unknown')}-${date ? new Date(date).getFullYear() : new Date().getFullYear()}`;

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

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

const Input = (props) => (
  <input {...props} className={`w-full max-w-xl border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${props.className||''}`} />
);

const Textarea = (props) => (
  <textarea {...props} className={`w-full border border-gray-300 rounded-lg px-3.5 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-green-500 resize-y ${props.className||''}`} />
);

const Toggle = ({checked, onChange, label, hint}) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <div className="relative mt-0.5 flex-shrink-0">
      <input type="checkbox" className="sr-only" checked={checked} onChange={e=>onChange(e.target.checked)} />
      <div className={`w-9 h-5 rounded-full transition-colors ${checked?'bg-green-600':'bg-gray-300'}`} />
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked?'translate-x-4':''}`} />
    </div>
    <div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  </label>
);

const Pill = ({active}) => (
  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${active?'bg-green-100 text-green-800':'bg-gray-100 text-gray-500'}`}>
    {active?'Active':'Inactive'}
  </span>
);

const Toast = ({toast}) => toast ? (
  <div className={`mb-5 px-4 py-3 rounded-lg text-sm font-medium ${toast.type==='error'?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}`}>
    {toast.msg}
  </div>
) : null;

// ─── Subject search (gig or profile) ─────────────────────────────────────────

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
    : `${item.band_name}${item.city ? ` — ${item.city}` : ''}${item.profile_type ? ` [${item.profile_type}]` : ''}`;

  const select = (item) => {
    onChange({ id: item.id, label: labelFor(item), name: item.band_name });
    setQ(labelFor(item));
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        type="text" value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={targetType === 'gig' ? 'Search approved gigs…' : 'Search bands, artists, festivals…'}
      />
      {loading && <div className="absolute right-3 top-2.5 text-xs text-gray-500">Searching…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-30 w-full max-w-xl bg-white border border-gray-200 rounded-lg shadow-lg mt-2 max-h-48 overflow-y-auto">
          {results.map(item => (
            <li key={item.id} onClick={() => select(item)}
              className="px-3.5 py-2.5 text-sm cursor-pointer hover:bg-green-50 border-b border-gray-50 last:border-0">
              {labelFor(item)}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-30 w-full max-w-xl bg-white border border-gray-200 rounded-lg shadow-lg mt-2 px-3.5 py-2.5 text-sm text-gray-500">No results</div>
      )}
      {value && <p className="mt-2 text-xs text-green-700 font-medium">✓ {value.label}</p>}
    </div>
  );
}

// ─── Editorial form ───────────────────────────────────────────────────────────

const EMPTY = {
  award_type_id:   '',
  target_type:     'profile',
  subject:         null,
  awarded_at:      new Date().toISOString().slice(0,10),
  published_at:    '',
  expires_at:      '',
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

function EditorialForm({ awardTypes, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedType = awardTypes.find(a => a.id === form.award_type_id);

  // Auto-generate slug when key fields change
  useEffect(() => {
    if (selectedType && form.subject && !initial) {
      set('slug', autoSlug(selectedType.slug, form.subject.name, form.awarded_at));
    }
  }, [form.award_type_id, form.subject?.id, form.awarded_at]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.award_type_id) { alert('Select an award type.'); return; }
    if (!form.subject)        { alert('Select a subject (gig or profile).'); return; }
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border-2 border-green-200 rounded-xl p-8 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-gray-900 text-base">{initial ? 'Edit Award' : 'Assign Editorial Award'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-600 text-xl leading-none">×</button>
      </div>

      {/* 1. Award Type & Subject */}
      <FormSection title="Award Type & Subject" first>
        <Field>
          <Label required>Award type</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
              <label key={a.id} className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                form.award_type_id === a.id ? 'border-green-500 bg-green-50 shadow-sm' : 'border-gray-200 hover:border-green-300'
              }`}>
                <input type="radio" name="award_type" value={a.id} className="sr-only"
                  checked={form.award_type_id === a.id} onChange={() => set('award_type_id', a.id)} />
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: `#${a.color_hex}` }} />
                <span className="text-xs font-medium text-gray-800">{a.label}</span>
                {a.singleton && <span className="ml-auto text-xs text-orange-500 font-medium">Singleton</span>}
              </label>
            ))}
          </div>
          {selectedType?.singleton && (
            <p className="mt-3 text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded-lg px-3.5 py-2.5 leading-relaxed">
              ⚠ Singleton — only one active {selectedType.label} at a time. Assigning will deactivate the current one.
            </p>
          )}
        </Field>

        <Field>
          <Label required>Award applies to</Label>
          <div className="flex flex-wrap gap-5">
            {[['profile','Band / Artist / Festival'],['gig','Specific gig']].map(([v,l]) => (
              <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="target_type" checked={form.target_type === v}
                  onChange={() => { set('target_type', v); set('subject', null); }} />
                {l}
              </label>
            ))}
          </div>
        </Field>

        <Field className="mb-0">
          <Label required>{form.target_type === 'gig' ? 'Select gig' : 'Select band / artist / festival'}</Label>
          <SubjectSearch targetType={form.target_type} value={form.subject} onChange={v => set('subject', v)} />
        </Field>
      </FormSection>

      {/* 2. Content */}
      <FormSection title="Content">
        <Field>
          <Label>Headline</Label>
          <Input type="text" value={form.headline} onChange={e => set('headline', e.target.value)}
            placeholder="Short editorial headline (optional — subject name used if blank)" />
        </Field>
        <Field>
          <Label>Editorial body text</Label>
          <Textarea rows={4} value={form.body_text} onChange={e => set('body_text', e.target.value)}
            placeholder="Editorial copy for this entry. Shown on archive page and public entry." />
        </Field>
        <Field className={form.image_url ? '' : 'mb-0'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Label>Image URL</Label>
              <Input type="url" value={form.image_url} onChange={e => set('image_url', e.target.value)}
                placeholder="https://…" />
            </div>
            <div>
              <Label>Image alt text</Label>
              <Input type="text" value={form.image_alt} onChange={e => set('image_alt', e.target.value)}
                placeholder="Describe the image" />
            </div>
          </div>
        </Field>
        {form.image_url && (
          <Field className="mb-0">
            <img src={form.image_url} alt={form.image_alt || ''} className="h-24 w-auto rounded-lg border border-gray-200 object-cover" onError={e=>e.target.style.display='none'} />
          </Field>
        )}
      </FormSection>

      {/* 3. Schedule */}
      <FormSection title="Schedule">
        <Field>
          <Label>Review / article URL</Label>
          <Input type="url" value={form.review_url} onChange={e => set('review_url', e.target.value)}
            placeholder="https://musicscenemagazine.co.uk/reviews/…" />
          <HelpText>Shown as "Read Review" link on the archive page.</HelpText>
        </Field>

        <Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-6">
            <div>
              <Label required>Award date</Label>
              <Input type="date" value={form.awarded_at} onChange={e => set('awarded_at', e.target.value)} required />
            </div>
            <div>
              <Label>Publish date</Label>
              <Input type="datetime-local" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
              <HelpText>Leave blank to publish immediately.</HelpText>
            </div>
            <div>
              <Label>Expiry date</Label>
              <Input type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
              <HelpText>Leave blank for no expiry.</HelpText>
            </div>
          </div>
        </Field>

        <Field className="mb-0">
          <Label>Archive slug</Label>
          <Input type="text" value={form.slug} onChange={e => set('slug', e.target.value)}
            placeholder="auto-generated — edit if needed" className="font-mono text-xs" />
          <HelpText>Public URL: /editorial-archive/{form.slug || '…'}</HelpText>
        </Field>
      </FormSection>

      {/* 4. Display Options */}
      <FormSection title="Display Options">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-6">
          <div>
            <Label>Display order</Label>
            <Input type="number" value={form.display_order} onChange={e => set('display_order', parseInt(e.target.value)||0)}
              min="0" placeholder="0" />
            <HelpText>Lower = higher position. 0 = default.</HelpText>
          </div>
          <div className="space-y-4 sm:pt-1">
            <Toggle checked={form.is_pinned} onChange={v => set('is_pinned', v)}
              label="Pin to top" hint="Overrides display order" />
            <Toggle checked={form.archive_visible} onChange={v => set('archive_visible', v)}
              label="Show in archive" hint="Historical record visible publicly" />
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
        <button type="submit" disabled={saving}
          className="px-6 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Assign award'}
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

export default function AdminEditorial() {
  const [awardTypes, setAwardTypes] = useState([]);
  const [features, setFeatures]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAwardTypes = async () => {
    const { data } = await supabase.from('editorial_award_types').select('*').eq('active', true).order('sort_order');
    setAwardTypes(data || []);
  };

  const loadFeatures = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_editorial_features');
      if (error) throw error;
      setFeatures(data || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAwardTypes(); loadFeatures(); }, []);

  // Singleton conflict handling
  const handleSingletonConflict = async (awardTypeId) => {
    const type = awardTypes.find(a => a.id === awardTypeId);
    if (!type?.singleton) return true;
    const active = features.filter(f => f.award_type_id === awardTypeId && f.active);
    if (active.length === 0) return true;
    if (!window.confirm(`There is already an active "${type.label}".\n\nThe existing award will be deactivated. Continue?`)) return false;
    const { error } = await supabase.from('editorial_features').update({ active: false }).eq('award_type_id', awardTypeId).eq('active', true);
    if (error) { showToast(error.message, 'error'); return false; }
    return true;
  };

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const ok = await handleSingletonConflict(form.award_type_id);
      if (!ok) { setSaving(false); return; }

      const { data: { user } } = await supabase.auth.getUser();

      const row = {
        award_type_id:   form.award_type_id,
        gig_id:          form.target_type === 'gig'     ? form.subject.id : null,
        profile_id:      form.target_type === 'profile' ? form.subject.id : null,
        awarded_by:      user.id,
        created_by:      user.id,
        awarded_at:      form.awarded_at,
        published_at:    form.published_at || null,
        expires_at:      form.expires_at   || null,
        headline:        form.headline     || null,
        body_text:       form.body_text    || null,
        review_url:      form.review_url   || null,
        image_url:       form.image_url    || null,
        image_alt:       form.image_alt    || null,
        slug:            form.slug         || null,
        notes:           form.notes        || null,
        archive_visible: form.archive_visible,
        is_pinned:       form.is_pinned,
        display_order:   form.display_order,
        active:          true,
      };

      if (editItem) {
        row.updated_by = user.id;
        const { error } = await supabase.from('editorial_features').update(row).eq('id', editItem.id);
        if (error) throw error;
        showToast('Award updated.');
      } else {
        const { error } = await supabase.from('editorial_features').insert(row);
        if (error) throw error;
        showToast('Award assigned.');
      }

      setShowForm(false);
      setEditItem(null);
      await loadFeatures();
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, current) => {
    const { data: { user } } = await supabase.auth.getUser();
    const update = current
      ? { active: false, deactivated_by: user.id }
      : { active: true,  deactivated_by: null };
    const { error } = await supabase.from('editorial_features').update(update).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(`Award ${current ? 'deactivated' : 'activated'}.`);
    await loadFeatures();
  };

  const toggleArchive = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ archive_visible: !current }).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(`Archive visibility ${!current ? 'enabled' : 'disabled'}.`);
    await loadFeatures();
  };

  const togglePin = async (id, current) => {
    const { error } = await supabase.from('editorial_features').update({ is_pinned: !current }).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    await loadFeatures();
  };

  const openEdit = (f) => {
    setEditItem(f);
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditItem(null); };

  // Map feature to form shape for editing
  const featureToForm = (f) => ({
    award_type_id:   f.award_type_id,
    target_type:     f.gig_id ? 'gig' : 'profile',
    subject:         f.gig_id
      ? { id: f.gig_id, label: `${f.gig_band_name} @ ${f.gig_venue}`, name: f.gig_band_name }
      : { id: f.profile_id, label: f.profile_name, name: f.profile_name },
    awarded_at:      toDateInput(f.awarded_at),
    published_at:    f.published_at ? new Date(f.published_at).toISOString().slice(0,16) : '',
    expires_at:      f.expires_at   ? new Date(f.expires_at).toISOString().slice(0,16)   : '',
    headline:        f.headline        || '',
    body_text:       f.body_text       || '',
    review_url:      f.review_url      || '',
    image_url:       f.image_url       || '',
    image_alt:       f.image_alt       || '',
    slug:            f.slug            || '',
    notes:           f.notes           || '',
    archive_visible: f.archive_visible,
    is_pinned:       f.is_pinned,
    display_order:   f.display_order   || 0,
  });

  const filtered = features.filter(f => {
    if (f.is_hall_of_fame) return false;
    if (filterType !== 'all' && f.award_slug !== filterType) return false;
    if (filterStatus === 'active'   && !f.active) return false;
    if (filterStatus === 'inactive' &&  f.active) return false;
    return true;
  });

  const subjectLabel = (f) => f.gig_id ? `${f.gig_band_name} @ ${f.gig_venue}` : (f.profile_name || '—');

  // Singleton summary cards
  const singletons = awardTypes.filter(a => a.singleton && !a.is_hall_of_fame);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Editorial Awards</h1>
          <p className="text-sm text-gray-500 mt-1">Non-purchasable — editorial assignment only</p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditItem(null); }}
            className="px-4 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg shadow-sm self-start sm:self-auto">
            + Assign award
          </button>
        )}
      </div>

      {/* System boundary */}
      <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 leading-relaxed">
        <strong>EDITORIAL SYSTEM</strong> — Awards are non-purchasable. Strict firewall from commercial Featured Listings.
      </div>

      {/* Singleton summary */}
      {singletons.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {singletons.map(a => {
            const current = features.find(f => f.award_type_id === a.id && f.active);
            return (
              <div key={a.id} className="p-4 bg-white border border-gray-200 rounded-xl flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: `#${a.color_hex}` }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{a.label}</p>
                  {current ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900 truncate mt-1">{subjectLabel(current)}</p>
                      {current.headline && <p className="text-xs text-gray-500 truncate mt-0.5">{current.headline}</p>}
                      <p className="text-xs text-gray-500 mt-0.5">{fmtDate(current.awarded_at)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 italic mt-1">None assigned</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Toast toast={toast} />

      {/* Form */}
      {showForm && (
        <div className="mb-8">
          <EditorialForm
            awardTypes={awardTypes}
            initial={editItem ? featureToForm(editItem) : null}
            onSave={handleSave}
            onCancel={cancelForm}
            saving={saving}
          />
        </div>
      )}

      {/* Filters -- visually separated from the results below */}
      <div className="flex flex-wrap gap-3 items-center mb-5 pb-5 border-b border-gray-200">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="all">All award types</option>
          {awardTypes.filter(a => !a.is_hall_of_fame).map(a => (
            <option key={a.id} value={a.slug}>{a.label}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="text-xs text-gray-500 ml-1">{filtered.length} award{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-4 px-4 bg-red-50 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 text-sm">No awards found. Assign one above.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Award','Subject','Headline','Date','Status','Archive','Actions'].map(h => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(f => (
                <tr key={f.id} className={`hover:bg-gray-50 transition-colors ${!f.active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      {f.is_pinned && <span className="text-yellow-500 text-xs">📌</span>}
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white whitespace-nowrap"
                        style={{ backgroundColor: `#${f.award_color_hex}` }}>
                        {f.award_label}
                      </span>
                    </div>
                    {f.display_order > 0 && <p className="text-xs text-gray-500 mt-1">Order: {f.display_order}</p>}
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-medium text-gray-900 truncate max-w-[180px]">{subjectLabel(f)}</p>
                    {f.image_url && <p className="text-xs text-gray-500 mt-0.5">📷 Image set</p>}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500 max-w-[160px] truncate">{f.headline || '—'}</td>
                  <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap leading-relaxed">
                    <p>{fmtDate(f.awarded_at)}</p>
                    {f.published_at && <p className="text-green-600">Pub: {fmtDate(f.published_at)}</p>}
                    {f.expires_at   && <p className="text-orange-500">Exp: {fmtDate(f.expires_at)}</p>}
                  </td>
                  <td className="px-5 py-4"><Pill active={f.active} /></td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium whitespace-nowrap ${f.archive_visible ? 'text-green-700' : 'text-gray-500'}`}>
                      {f.archive_visible ? '✓ Visible' : '— Hidden'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2 justify-end flex-wrap">
                      <button onClick={() => openEdit(f)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 text-gray-600 whitespace-nowrap">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(f.id, f.active)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 text-gray-600 whitespace-nowrap">
                        {f.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => toggleArchive(f.id, f.archive_visible)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 text-gray-600 whitespace-nowrap">
                        {f.archive_visible ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={() => togglePin(f.id, f.is_pinned)}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${f.is_pinned ? 'border-yellow-300 bg-yellow-50 text-yellow-700' : 'border-gray-300 hover:bg-gray-100 text-gray-600'}`}>
                        {f.is_pinned ? 'Unpin' : 'Pin'}
                      </button>
                      {f.review_url && (
                        <a href={f.review_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs px-2.5 py-1.5 rounded-md border border-green-200 text-green-700 hover:bg-green-50 whitespace-nowrap">
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
