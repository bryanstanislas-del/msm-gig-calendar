/**
 * adminUI.jsx — shared dark-theme admin design system
 *
 * IMPORTANT CONTEXT: this project has no Tailwind build pipeline (no
 * tailwindcss package, no postcss/tailwind config, no CDN script) --
 * className="bg-white border-gray-300 ..." strings used throughout the
 * admin panels have never actually rendered any styling. That's why the
 * forms looked like unstyled HTML no matter how those class names were
 * adjusted. This module fixes that at the root by using real inline
 * styles (the same approach the rest of the app -- App.jsx -- already
 * uses successfully), so every admin panel that imports from here is
 * guaranteed to actually render.
 *
 * Every one of the four admin management panels (Editorial Awards,
 * Featured Listings, MSM Hall of Fame, Founding Supporters) imports these
 * same components, so page width, card styling, section spacing, field
 * structure, inputs, radio/checkbox presentation, buttons, stat cards,
 * filters and tables are all governed from one place. Each panel keeps
 * its own identity via a single `accent` colour passed down.
 */

import { useState } from 'react';

// ── Shared tokens ──────────────────────────────────────────────────────────

export const BG          = '#0d0d0d';
export const PANEL_BG     = '#141414';
export const FIELD_BG     = '#0a0a0a';
export const BORDER       = 'rgba(255,255,255,0.09)';
export const BORDER_SOFT  = 'rgba(255,255,255,0.06)';
export const TEXT_PRIMARY = '#ffffff';
export const TEXT_SECOND  = '#b3b3b3';
export const TEXT_MUTED   = '#8a8a8a';
export const TEXT_DIM     = '#666666';

export const ACCENTS = {
  editorial:  '#34d399', // green  -- Editorial Awards
  featured:   '#fbbf24', // amber  -- Featured Listings (commercial)
  hallOfFame: '#eab308', // gold   -- MSM Hall of Fame
  supporters: '#a78bfa', // violet -- Founding Supporters
};

const hex2rgba = (hex, alpha) => {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// ── Page shell ──────────────────────────────────────────────────────────────

export function AdminPage({ children }) {
  return (
    <div style={{ background: BG, minHeight: '100%', padding: '40px 20px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export function AdminHeader({ icon, title, subtitle, action }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:16, marginBottom:24 }}>
      <div>
        <h1 style={{ fontSize:26, fontWeight:800, color:TEXT_PRIMARY, margin:0, display:'flex', alignItems:'center', gap:10 }}>
          {icon}{title}
        </h1>
        {subtitle && <p style={{ fontSize:14, color:TEXT_MUTED, margin:'6px 0 0' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function SystemNotice({ accent, children }) {
  return (
    <div style={{
      marginBottom:28, padding:'14px 18px', borderRadius:10, fontSize:13, lineHeight:1.6,
      background: hex2rgba(accent, 0.08), border: `1px solid ${hex2rgba(accent, 0.28)}`, color: accent,
    }}>{children}</div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryButton({ children, accent = ACCENTS.editorial, style, ...props }) {
  const [hover, setHover] = useState(false);
  return (
    <button {...props}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        padding:'12px 26px', fontSize:14, fontWeight:700, color: '#0d0d0d', background: accent,
        border:'none', borderRadius:9, cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : (hover ? 0.88 : 1), transition:'opacity 0.15s',
        boxShadow: hover && !props.disabled ? `0 4px 14px ${hex2rgba(accent,0.35)}` : 'none',
        ...style,
      }}
    >{children}</button>
  );
}

export function SecondaryButton({ children, style, ...props }) {
  const [hover, setHover] = useState(false);
  return (
    <button {...props}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        padding:'12px 26px', fontSize:14, fontWeight:600, color: hover ? TEXT_PRIMARY : TEXT_SECOND,
        background: hover ? '#1d1d1d' : 'transparent', border:`1px solid ${BORDER}`, borderRadius:9,
        cursor:'pointer', transition:'all 0.15s',
        ...style,
      }}
    >{children}</button>
  );
}

export function SmallActionButton({ children, tone='neutral', accent, active, style, ...props }) {
  const [hover, setHover] = useState(false);
  const tones = {
    neutral: { border: BORDER, color: hover ? TEXT_PRIMARY : TEXT_SECOND, bg: hover ? '#1c1c1c' : 'transparent' },
    danger:  { border: 'rgba(248,113,113,0.35)', color: '#f87171', bg: hover ? 'rgba(248,113,113,0.1)' : 'transparent' },
    positive:{ border: 'rgba(74,222,128,0.35)', color: '#4ade80', bg: hover ? 'rgba(74,222,128,0.1)' : 'transparent' },
    accent:  { border: hex2rgba(accent||ACCENTS.editorial,0.4), color: accent||ACCENTS.editorial, bg: hover ? hex2rgba(accent||ACCENTS.editorial,0.12) : hex2rgba(accent||ACCENTS.editorial,0.06) },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <button {...props}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        padding:'7px 13px', fontSize:12, fontWeight:600, borderRadius:7, whiteSpace:'nowrap',
        border:`1px solid ${t.border}`, color:t.color, background:t.bg, cursor:'pointer', transition:'all 0.15s',
        ...style,
      }}
    >{children}</button>
  );
}

// ── Stat cards ────────────────────────────────────────────────────────────

export function StatGrid({ children, minWidth=140 }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${minWidth}px, 1fr))`, gap:14, marginBottom:32 }}>
      {children}
    </div>
  );
}
export function StatCard({ value, label }) {
  return (
    <div style={{ padding:'20px 16px', background:PANEL_BG, border:`1px solid ${BORDER_SOFT}`, borderRadius:12, textAlign:'center' }}>
      <p style={{ fontSize:26, fontWeight:800, color:TEXT_PRIMARY, margin:0 }}>{value}</p>
      <p style={{ fontSize:12, color:TEXT_MUTED, margin:'6px 0 0', letterSpacing:0.3 }}>{label}</p>
    </div>
  );
}

// ── Form card & sections ───────────────────────────────────────────────────

export function AdminCard({ children, accent }) {
  return (
    <div style={{
      background:PANEL_BG, border:`1px solid ${BORDER}`, borderTop:`3px solid ${accent}`,
      borderRadius:16, padding:'32px', maxWidth:760, boxShadow:'0 8px 30px rgba(0,0,0,0.35)', marginBottom:32,
    }}>{children}</div>
  );
}

export function FormHeader({ icon, title, onCancel }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28, paddingBottom:20, borderBottom:`1px solid ${BORDER_SOFT}` }}>
      <h3 style={{ fontSize:18, fontWeight:700, color:TEXT_PRIMARY, margin:0, display:'flex', alignItems:'center', gap:8 }}>{icon}{title}</h3>
      <button type="button" onClick={onCancel}
        style={{ background:'none', border:'none', color:TEXT_MUTED, fontSize:24, lineHeight:1, cursor:'pointer', padding:4 }}
        onMouseEnter={e=>e.currentTarget.style.color=TEXT_PRIMARY}
        onMouseLeave={e=>e.currentTarget.style.color=TEXT_MUTED}
      >×</button>
    </div>
  );
}

export function FormSection({ title, first, children }) {
  return (
    <div style={{ paddingTop: first?0:28, paddingBottom:28, borderTop: first?'none':`1px solid ${BORDER_SOFT}` }}>
      {title && <p style={{ fontSize:11, fontWeight:800, color:TEXT_MUTED, textTransform:'uppercase', letterSpacing:'0.12em', margin:'0 0 18px' }}>{title}</p>}
      <div style={{ display:'flex', flexDirection:'column', gap:22 }}>{children}</div>
    </div>
  );
}

export function FieldRow({ children, minWidth=220 }) {
  return <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${minWidth}px, 1fr))`, gap:20 }}>{children}</div>;
}

export function Field({ children }) { return <div>{children}</div>; }

export function Label({ children, required }) {
  return (
    <label style={{ display:'block', fontSize:12.5, fontWeight:600, color:TEXT_SECOND, marginBottom:8, letterSpacing:0.2 }}>
      {children}{required && <span style={{ color:'#f87171', marginLeft:3 }}>*</span>}
    </label>
  );
}
export function HelpText({ children }) {
  return <p style={{ marginTop:8, fontSize:12, color:TEXT_DIM, lineHeight:1.6 }}>{children}</p>;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

function useFocusRing(accent) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: (e) => setFocused(true),
    onBlur: (e) => setFocused(false),
    style: {
      border: `1px solid ${focused ? accent : BORDER}`,
      boxShadow: focused ? `0 0 0 3px ${hex2rgba(accent,0.18)}` : 'none',
    },
  };
}

const fieldBase = {
  width:'100%', maxWidth:480, background:FIELD_BG, borderRadius:9,
  padding:'11px 14px', fontSize:14, color:TEXT_PRIMARY, transition:'border-color 0.15s, box-shadow 0.15s',
  boxSizing:'border-box',
};

export function TextInput({ accent = ACCENTS.editorial, wide, style, ...props }) {
  const ring = useFocusRing(accent);
  return (
    <input {...props}
      onFocus={e=>{ring.onFocus(e); props.onFocus?.(e);}} onBlur={e=>{ring.onBlur(e); props.onBlur?.(e);}}
      style={{ ...fieldBase, ...(wide?{maxWidth:'100%'}:{}) , ...ring.style, ...style }}
    />
  );
}

export function Select({ accent = ACCENTS.editorial, style, children, ...props }) {
  const ring = useFocusRing(accent);
  return (
    <select {...props}
      onFocus={e=>{ring.onFocus(e); props.onFocus?.(e);}} onBlur={e=>{ring.onBlur(e); props.onBlur?.(e);}}
      style={{ ...fieldBase, cursor:'pointer', ...ring.style, ...style }}
    >{children}</select>
  );
}

export function Textarea({ accent = ACCENTS.editorial, style, ...props }) {
  const ring = useFocusRing(accent);
  return (
    <textarea {...props}
      onFocus={e=>{ring.onFocus(e); props.onFocus?.(e);}} onBlur={e=>{ring.onBlur(e); props.onBlur?.(e);}}
      style={{ ...fieldBase, maxWidth:'100%', lineHeight:1.6, resize:'vertical', minHeight: props.rows ? undefined : 90, ...ring.style, ...style }}
    />
  );
}

// ── Radio option grid (replaces run-together radio lines) ───────────────────

export function RadioGrid({ minWidth=200, children }) {
  return <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap:10 }}>{children}</div>;
}

export function RadioOption({ checked, onChange, accent = ACCENTS.editorial, name, dot, badge, children }) {
  return (
    <label style={{
      display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:9, cursor:'pointer',
      border:`1px solid ${checked ? accent : BORDER}`, background: checked ? hex2rgba(accent,0.1) : 'transparent',
      transition:'all 0.15s',
    }}>
      <input type="radio" name={name} checked={checked} onChange={onChange}
        style={{ width:16, height:16, accentColor:accent, flexShrink:0, cursor:'pointer' }} />
      {dot && <span style={{ width:10, height:10, borderRadius:'50%', flexShrink:0, background:dot }} />}
      <span style={{ fontSize:13, fontWeight:500, color: checked ? TEXT_PRIMARY : TEXT_SECOND, flex:1 }}>{children}</span>
      {badge && <span style={{ fontSize:10, fontWeight:700, color:'#fb923c', whiteSpace:'nowrap' }}>{badge}</span>}
    </label>
  );
}

// ── Toggle / checkbox setting row ────────────────────────────────────────────

export function ToggleSetting({ checked, onChange, accent = ACCENTS.editorial, label, hint }) {
  return (
    <label style={{ display:'flex', alignItems:'flex-start', gap:12, cursor:'pointer', userSelect:'none' }}>
      <span style={{
        position:'relative', flexShrink:0, width:38, height:22, borderRadius:11, marginTop:1,
        background: checked ? accent : 'rgba(255,255,255,0.12)', transition:'background 0.15s',
      }}>
        <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}
          style={{ position:'absolute', opacity:0, width:'100%', height:'100%', cursor:'pointer', margin:0 }} />
        <span style={{
          position:'absolute', top:2, left: checked ? 18 : 2, width:18, height:18, borderRadius:'50%',
          background:'#fff', transition:'left 0.15s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)',
        }} />
      </span>
      <span>
        <span style={{ display:'block', fontSize:13.5, fontWeight:600, color:TEXT_PRIMARY }}>{label}</span>
        {hint && <span style={{ display:'block', fontSize:12, color:TEXT_MUTED, marginTop:2 }}>{hint}</span>}
      </span>
    </label>
  );
}

// ── Actions row ───────────────────────────────────────────────────────────

export function ActionsRow({ children }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:14, paddingTop:28, marginTop:4, borderTop:`1px solid ${BORDER_SOFT}` }}>
      {children}
    </div>
  );
}

// ── Filters & results container ──────────────────────────────────────────

export function FilterBar({ children }) {
  return (
    <div style={{
      display:'flex', flexWrap:'wrap', alignItems:'center', gap:12, marginBottom:20,
      paddingBottom:20, borderBottom:`1px solid ${BORDER_SOFT}`,
    }}>{children}</div>
  );
}

export function ResultsPanel({ title, count, children }) {
  return (
    <div>
      {title && (
        <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:16 }}>
          <h2 style={{ fontSize:15, fontWeight:700, color:TEXT_PRIMARY, margin:0, textTransform:'uppercase', letterSpacing:'0.08em' }}>{title}</h2>
          {count != null && <span style={{ fontSize:12, color:TEXT_MUTED }}>{count}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ icon, children }) {
  return (
    <div style={{ padding:'56px 20px', textAlign:'center', border:`1px dashed ${BORDER}`, borderRadius:14 }}>
      {icon && <p style={{ fontSize:34, marginBottom:10 }}>{icon}</p>}
      <p style={{ fontSize:13.5, color:TEXT_MUTED, margin:0 }}>{children}</p>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────

export function TableShell({ minWidth=860, children }) {
  return (
    <div style={{ border:`1px solid ${BORDER}`, borderRadius:14, overflowX:'auto' }}>
      <table style={{ width:'100%', minWidth, borderCollapse:'collapse', fontSize:13 }}>
        {children}
      </table>
    </div>
  );
}
export function Th({ children, align='left' }) {
  return (
    <th style={{
      textAlign:align, padding:'14px 18px', fontSize:11, fontWeight:700, color:TEXT_MUTED,
      textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap', borderBottom:`1px solid ${BORDER}`,
      background:'rgba(255,255,255,0.02)',
    }}>{children}</th>
  );
}
export function Td({ children, align='left', style }) {
  return <td style={{ textAlign:align, padding:'16px 18px', verticalAlign:'top', ...style }}>{children}</td>;
}
export function Tr({ children, dim, style }) {
  const [hover, setHover] = useState(false);
  return (
    <tr onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        borderBottom:`1px solid ${BORDER_SOFT}`, opacity: dim?0.5:1,
        background: hover ? 'rgba(255,255,255,0.02)' : 'transparent', transition:'background 0.1s',
        ...style,
      }}
    >{children}</tr>
  );
}

// ── Badges & pills ─────────────────────────────────────────────────────────

export function Pill({ children, tone='neutral', color }) {
  const tones = {
    neutral:  { bg:'rgba(255,255,255,0.08)', fg:TEXT_SECOND },
    positive: { bg:'rgba(74,222,128,0.12)',  fg:'#4ade80' },
    negative: { bg:'rgba(248,113,113,0.12)', fg:'#f87171' },
    warning:  { bg:'rgba(251,191,36,0.12)',  fg:'#fbbf24' },
  };
  const t = color ? { bg:hex2rgba(color,0.16), fg:color } : (tones[tone]||tones.neutral);
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'4px 11px', borderRadius:999,
      fontSize:11, fontWeight:700, whiteSpace:'nowrap', background:t.bg, color:t.fg,
    }}>{children}</span>
  );
}

export function StatusPill({ active }) {
  return <Pill tone={active ? 'positive' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Pill>;
}

// ── Toast ───────────────────────────────────────────────────────────────

export function Toast({ toast }) {
  if (!toast) return null;
  const positive = toast.type !== 'error';
  return (
    <div style={{
      marginBottom:20, padding:'14px 18px', borderRadius:10, fontSize:13.5, fontWeight:500,
      background: positive ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
      color: positive ? '#4ade80' : '#f87171',
      border: `1px solid ${positive ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
    }}>{toast.msg}</div>
  );
}

// ── Search dropdown (used by entity/subject/profile search widgets) ─────────

export function SearchDropdown({ children }) {
  return (
    <ul style={{
      position:'absolute', zIndex:30, width:'100%', maxWidth:480, marginTop:6, maxHeight:200, overflowY:'auto',
      background:'#1a1a1a', border:`1px solid ${BORDER}`, borderRadius:10, boxShadow:'0 12px 30px rgba(0,0,0,0.5)',
      listStyle:'none', padding:0,
    }}>{children}</ul>
  );
}
export function SearchOption({ onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <li onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ padding:'10px 14px', fontSize:13.5, color:TEXT_SECOND, cursor:'pointer',
        background: hover ? 'rgba(255,255,255,0.05)' : 'transparent', borderBottom:`1px solid ${BORDER_SOFT}` }}
    >{children}</li>
  );
}
export function SearchEmpty({ children }) {
  return (
    <div style={{ position:'absolute', zIndex:30, width:'100%', maxWidth:480, marginTop:6, padding:'10px 14px',
      background:'#1a1a1a', border:`1px solid ${BORDER}`, borderRadius:10, fontSize:13, color:TEXT_MUTED }}
    >{children}</div>
  );
}
