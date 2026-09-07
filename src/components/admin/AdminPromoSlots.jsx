/**
 * AdminPromoSlots.jsx — Editorial Promo + Future Advertising Positions, Phase 1
 *
 * The three fixed slots (TOP / IN_FEED / LOWER) only -- no arbitrary slot
 * creation, no campaign scheduling/rotation/tracking/billing (see the
 * promo_slots migration and PromoSlot.jsx's own header comments for the
 * full scope reasoning). Bryan's actual workflow: upload artwork to the
 * existing WordPress Media Library himself, copy its URL, paste it here
 * alongside a destination URL and alt text, choose a label, activate,
 * save -- no code deployment involved.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { FIXED_SLOTS, VALID_PROMO_LABELS, validatePromoSlotForm } from '../PromoSlot.jsx';
import {
  ACCENTS, AdminPage, AdminHeader, SystemNotice,
  AdminCard, FormSection, FieldRow, Field, Label, HelpText,
  TextInput, Select, ToggleSetting, ActionsRow, PrimaryButton, Toast,
} from './adminUI';

const ACCENT = ACCENTS.featured; // same "commercial" amber the other paid-inventory panel (Featured Listings) uses

const SLOT_COPY = {
  TOP:     { title: 'TOP',     desc: 'Leaderboard / hero position, immediately below the calendar/list navigation.' },
  IN_FEED: { title: 'IN_FEED', desc: 'Mid-list, inside List View only -- appears after the 6th gig when there are enough results.' },
  LOWER:   { title: 'LOWER',   desc: 'Quiet secondary position, below the "Showing N of M gigs" line.' },
};

const emptyForm = (slot) => ({
  slot, image_url: '', mobile_image_url: '', target_url: '', alt_text: '', label: 'Editorial', active: false,
});

function SlotCard({ row, saving, onSave }) {
  const [form, setForm] = useState(() => ({
    slot: row.slot,
    image_url: row.image_url || '',
    mobile_image_url: row.mobile_image_url || '',
    target_url: row.target_url || '',
    alt_text: row.alt_text || '',
    label: row.label || 'Editorial',
    active: !!row.active,
  }));
  const [errors, setErrors] = useState([]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = () => {
    const validationErrors = validatePromoSlotForm(form);
    setErrors(validationErrors);
    if (validationErrors.length) return;
    onSave(form);
  };

  return (
    <AdminCard accent={ACCENT}>
      <FormSection title={`${SLOT_COPY[row.slot]?.title || row.slot} POSITION`} first>
        <HelpText>{SLOT_COPY[row.slot]?.desc}</HelpText>

        {form.image_url && (
          <div style={{ marginTop: 4 }}>
            <img src={form.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 90, borderRadius: 8, border: '1px solid rgba(255,255,255,0.09)', display: 'block' }} />
          </div>
        )}

        <FieldRow>
          <Field>
            <Label>Desktop image URL (1200×250)</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.image_url} onChange={set('image_url')} placeholder="https://musicscenemagazine.co.uk/wp-content/uploads/…" />
          </Field>
          <Field>
            <Label>Mobile image URL (600×250, optional)</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.mobile_image_url} onChange={set('mobile_image_url')} placeholder="Falls back to the desktop image if left blank" />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <Label>Destination URL</Label>
            <TextInput accent={ACCENT} wide type="url" value={form.target_url} onChange={set('target_url')} placeholder="https://musicscenemagazine.co.uk/" />
            <HelpText>Opens in a new tab. If left blank or invalid, the artwork still shows but isn't clickable.</HelpText>
          </Field>
          <Field>
            <Label>Alt text</Label>
            <TextInput accent={ACCENT} wide type="text" value={form.alt_text} onChange={set('alt_text')} placeholder="Describe the artwork for screen readers" />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <Label>Label</Label>
            <Select accent={ACCENT} value={form.label} onChange={set('label')}>
              {VALID_PROMO_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <HelpText>Shown as a small badge on the artwork. Use "Editorial" for MSM's own promotion, or the label matching a paid placement.</HelpText>
          </Field>
          <Field>
            <ToggleSetting
              checked={form.active}
              onChange={(v) => setForm((f) => ({ ...f, active: v }))}
              accent={ACCENT}
              label="Active"
              hint="Only one configuration exists per slot -- switching this off removes it from the public calendar immediately."
            />
          </Field>
        </FieldRow>

        {errors.length > 0 && (
          <SystemNotice accent="#f87171">
            {errors.map((e) => <div key={e}>{e}</div>)}
          </SystemNotice>
        )}

        <ActionsRow>
          <PrimaryButton accent={ACCENT} onClick={handleSave} disabled={saving}>{saving ? 'SAVING…' : 'SAVE'}</PrimaryButton>
        </ActionsRow>
      </FormSection>
    </AdminCard>
  );
}

export default function AdminPromoSlots() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingSlot, setSavingSlot] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  const load = async () => {
    setLoading(true);
    try {
      // Admin RLS (promo_slots_admin_select) returns every row regardless
      // of active state -- the public policy (active-only) is what the
      // calendar itself reads through instead. Ordered so the three
      // cards always render in the same TOP/IN_FEED/LOWER order.
      const { data, error: err } = await supabase.from('promo_slots').select('*');
      if (err) throw err;
      const bySlot = Object.fromEntries((data || []).map((r) => [r.slot, r]));
      // Every environment this admin page can load in already has the
      // three seeded rows (see the migration) -- emptyForm() here is only
      // a defensive fallback so a slot can never simply fail to render a
      // card if a row were ever missing.
      setRows(FIXED_SLOTS.map((slot) => bySlot[slot] || emptyForm(slot)));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSavingSlot(form.slot);
    try {
      const update = {
        image_url: form.image_url || null,
        mobile_image_url: form.mobile_image_url || null,
        target_url: form.target_url || null,
        alt_text: form.alt_text || null,
        label: form.label,
        active: form.active,
      };
      // UPDATE only, by slot -- there is no INSERT path here (matches the
      // migration's own RLS, which has no INSERT policy at all: the three
      // rows already exist, seeded inactive, and are never created from
      // the client).
      const { error: err } = await supabase.from('promo_slots').update(update).eq('slot', form.slot);
      if (err) throw err;
      showToast(`${form.slot} slot saved.`);
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSavingSlot(null); }
  };

  return (
    <AdminPage>
      <AdminHeader title="PROMO SLOTS" subtitle="MSM editorial promotion today; the same three positions become sellable advertising inventory later -- no rebuild required." />
      <Toast toast={toast} />
      {loading && <p style={{ color: '#8a8a8a', fontSize: 13.5 }}>Loading…</p>}
      {error && <SystemNotice accent="#f87171">{error}</SystemNotice>}
      {!loading && !error && rows.map((row) => (
        <SlotCard key={row.slot} row={row} saving={savingSlot === row.slot} onSave={handleSave} />
      ))}
    </AdminPage>
  );
}
