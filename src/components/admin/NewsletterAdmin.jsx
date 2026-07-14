// NewsletterAdmin.jsx
// MSM Gig Calendar – Newsletter Subscriber Management
// -------------------------------------------------------
// Drop-in admin component. Receives `supabase` client as prop.
// Place in src/components/admin/ and add a route/tab in AdminPanel.
// -------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';

// ── helpers ────────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function downloadCSV(filename, rows, headers) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(','))
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── constants ──────────────────────────────────────────────
const TABS = [
  { id: 'opted_in',   label: 'Opted-In Subscribers' },
  { id: 'unsubscribed', label: 'Unsubscribed' },
  { id: 'legacy',     label: 'Legacy MSM Registrations' },
];

const BRAND = '#1A1A2E';
const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const RED   = '#ef4444';
const SLATE = '#334155';

// ── main component ─────────────────────────────────────────
export default function NewsletterAdmin({ supabase }) {
  const [activeTab,     setActiveTab]     = useState('opted_in');
  const [subscribers,   setSubscribers]   = useState([]);   // newsletter_subscribers records
  const [legacy,        setLegacy]        = useState([]);   // auth users with no record
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [actionStatus,  setActionStatus]  = useState({});   // { email: 'pending'|'done'|'error' }
  const [confirmEmail,  setConfirmEmail]  = useState(null); // email awaiting confirm
  const [searchTerm,    setSearchTerm]    = useState('');

  // ── fetch data ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: subData, error: subErr }, { data: legData, error: legErr }] = await Promise.all([
        supabase.rpc('admin_get_newsletter_summary'),
        supabase.rpc('admin_get_legacy_registrations'),
      ]);
      if (subErr) throw subErr;
      if (legErr) throw legErr;
      setSubscribers(subData || []);
      setLegacy(legData || []);
    } catch (e) {
      setError(e.message || 'Failed to load newsletter data');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── derived lists ─────────────────────────────────────────
  const optedIn      = subscribers.filter(s => s.newsletter_opt_in && !s.unsubscribed_at);
  const unsubscribed = subscribers.filter(s => s.unsubscribed_at);

  const filterBySearch = (list, key = 'email') =>
    searchTerm
      ? list.filter(r => (r[key] || '').toLowerCase().includes(searchTerm.toLowerCase()))
      : list;

  const visibleOptedIn      = filterBySearch(optedIn);
  const visibleUnsubscribed = filterBySearch(unsubscribed);
  const visibleLegacy       = filterBySearch(legacy);

  // ── unsubscribe handler ───────────────────────────────────
  const handleUnsubscribe = async (email) => {
    setConfirmEmail(null);
    setActionStatus(s => ({ ...s, [email]: 'pending' }));
    try {
      const { error: fnErr } = await supabase.rpc('admin_unsubscribe_user', { p_email: email });
      if (fnErr) throw fnErr;
      setActionStatus(s => ({ ...s, [email]: 'done' }));
      await fetchData();
    } catch (e) {
      setActionStatus(s => ({ ...s, [email]: 'error' }));
      console.error('Unsubscribe failed:', e);
    }
  };

  // ── CSV exports ───────────────────────────────────────────
  const exportOptedIn = () => {
    downloadCSV(
      `msm_newsletter_opted_in_${new Date().toISOString().slice(0,10)}.csv`,
      optedIn.map(r => ({
        email:    r.email,
        opt_in_date: r.newsletter_opt_in_date ? new Date(r.newsletter_opt_in_date).toISOString() : '',
        source:   r.newsletter_source || '',
      })),
      ['email', 'opt_in_date', 'source']
    );
  };

  const exportUnsubscribed = () => {
    downloadCSV(
      `msm_newsletter_unsubscribed_${new Date().toISOString().slice(0,10)}.csv`,
      unsubscribed.map(r => ({
        email:          r.email,
        opt_in_date:    r.newsletter_opt_in_date ? new Date(r.newsletter_opt_in_date).toISOString() : '',
        unsubscribed_at: new Date(r.unsubscribed_at).toISOString(),
      })),
      ['email', 'opt_in_date', 'unsubscribed_at']
    );
  };

  const exportLegacy = () => {
    downloadCSV(
      `msm_legacy_registrations_${new Date().toISOString().slice(0,10)}.csv`,
      legacy.map(r => ({
        email:         r.email,
        registered_at: new Date(r.registered_at).toISOString(),
        last_sign_in:  r.last_sign_in ? new Date(r.last_sign_in).toISOString() : '',
        newsletter_consent: 'NOT GIVEN – Legacy Registration',
      })),
      ['email', 'registered_at', 'last_sign_in', 'newsletter_consent']
    );
  };

  // ── styles ────────────────────────────────────────────────
  const styles = {
    container: {
      fontFamily: 'Arial, sans-serif',
      color: '#1e293b',
      maxWidth: 1100,
      margin: '0 auto',
      padding: '24px 16px',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 24,
      flexWrap: 'wrap',
      gap: 12,
    },
    title: {
      fontSize: 22,
      fontWeight: 700,
      color: BRAND,
      margin: 0,
    },
    // Stat cards
    statsRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 12,
      marginBottom: 24,
    },
    statCard: (color) => ({
      background: '#fff',
      border: `2px solid ${color}`,
      borderRadius: 8,
      padding: '14px 16px',
      textAlign: 'center',
    }),
    statNum: (color) => ({
      fontSize: 32,
      fontWeight: 800,
      color,
      lineHeight: 1,
    }),
    statLabel: {
      fontSize: 11,
      color: '#64748b',
      marginTop: 4,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    // Tabs
    tabRow: {
      display: 'flex',
      borderBottom: '2px solid #e2e8f0',
      marginBottom: 20,
      gap: 2,
      flexWrap: 'wrap',
    },
    tab: (active) => ({
      padding: '10px 18px',
      border: 'none',
      borderBottom: active ? `3px solid ${BRAND}` : '3px solid transparent',
      background: 'none',
      cursor: 'pointer',
      fontWeight: active ? 700 : 400,
      color: active ? BRAND : '#64748b',
      fontSize: 14,
      marginBottom: -2,
      transition: 'all 0.15s',
    }),
    // Toolbar
    toolbar: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
      flexWrap: 'wrap',
      gap: 10,
    },
    searchInput: {
      padding: '8px 12px',
      border: '1px solid #cbd5e1',
      borderRadius: 6,
      fontSize: 14,
      width: 220,
    },
    exportBtn: {
      padding: '8px 16px',
      background: BRAND,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
    },
    // Table
    tableWrap: {
      overflowX: 'auto',
      background: '#fff',
      borderRadius: 8,
      border: '1px solid #e2e8f0',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
    },
    th: {
      padding: '10px 14px',
      textAlign: 'left',
      background: '#f8fafc',
      borderBottom: '2px solid #e2e8f0',
      color: '#475569',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    },
    td: {
      padding: '10px 14px',
      borderBottom: '1px solid #f1f5f9',
      verticalAlign: 'middle',
    },
    badge: (color, bg) => ({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      color,
      background: bg,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }),
    unsubBtn: {
      padding: '5px 12px',
      background: '#fff',
      color: RED,
      border: `1px solid ${RED}`,
      borderRadius: 5,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
    },
    // Confirm modal
    overlay: {
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    },
    modal: {
      background: '#fff',
      borderRadius: 10,
      padding: 28,
      maxWidth: 400,
      width: '90%',
      boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    },
    modalTitle: { fontSize: 17, fontWeight: 700, marginBottom: 10, color: BRAND },
    modalText:  { fontSize: 14, color: '#475569', marginBottom: 20 },
    modalBtns:  { display: 'flex', gap: 10, justifyContent: 'flex-end' },
    cancelBtn:  {
      padding: '8px 18px', background: '#f1f5f9', border: 'none',
      borderRadius: 6, cursor: 'pointer', fontWeight: 600, color: SLATE,
    },
    confirmBtn: {
      padding: '8px 18px', background: RED, color: '#fff',
      border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
    },
    // Legacy warning banner
    legacyBanner: {
      background: '#fffbeb',
      border: '1px solid #fcd34d',
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 16,
      fontSize: 13,
      color: '#92400e',
      lineHeight: 1.5,
    },
    emptyState: {
      textAlign: 'center',
      padding: '48px 16px',
      color: '#64748b',
      fontSize: 14,
    },
    statusDot: (status) => ({
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: status === 'done' ? GREEN : status === 'error' ? RED : AMBER,
      marginLeft: 6,
    }),
  };

  // ── render helpers ────────────────────────────────────────
  const renderOptedInTab = () => (
    <>
      <div style={styles.toolbar}>
        <input
          style={styles.searchInput}
          placeholder="Search by email…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button style={styles.exportBtn} onClick={exportOptedIn}>
          ⬇ Export CSV ({optedIn.length})
        </button>
      </div>
      {visibleOptedIn.length === 0 ? (
        <div style={styles.emptyState}>No opted-in subscribers found.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Opted In</th>
                <th style={styles.th}>Source</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleOptedIn.map(r => (
                <tr key={r.email}>
                  <td style={styles.td}>{r.email}</td>
                  <td style={styles.td}>{formatDate(r.newsletter_opt_in_date)}</td>
                  <td style={styles.td}>
                    <span style={styles.badge('#1d4ed8', '#dbeafe')}>
                      {r.newsletter_source || 'unknown'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge('#166534', '#dcfce7')}>Active</span>
                    {actionStatus[r.email] === 'done' && (
                      <span style={styles.statusDot('done')} title="Unsubscribed" />
                    )}
                    {actionStatus[r.email] === 'error' && (
                      <span style={styles.statusDot('error')} title="Error" />
                    )}
                  </td>
                  <td style={styles.td}>
                    {actionStatus[r.email] === 'pending' ? (
                      <span style={{ color: AMBER, fontSize: 12 }}>Processing…</span>
                    ) : (
                      <button
                        style={styles.unsubBtn}
                        onClick={() => setConfirmEmail(r.email)}
                      >
                        Unsubscribe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderUnsubscribedTab = () => (
    <>
      <div style={styles.toolbar}>
        <input
          style={styles.searchInput}
          placeholder="Search by email…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button style={styles.exportBtn} onClick={exportUnsubscribed}>
          ⬇ Export CSV ({unsubscribed.length})
        </button>
      </div>
      {visibleUnsubscribed.length === 0 ? (
        <div style={styles.emptyState}>No unsubscribed users found.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Opted In</th>
                <th style={styles.th}>Unsubscribed</th>
                <th style={styles.th}>Source</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleUnsubscribed.map(r => (
                <tr key={r.email}>
                  <td style={styles.td}>{r.email}</td>
                  <td style={styles.td}>{formatDate(r.newsletter_opt_in_date)}</td>
                  <td style={styles.td}>{formatDate(r.unsubscribed_at)}</td>
                  <td style={styles.td}>
                    <span style={styles.badge('#1d4ed8', '#dbeafe')}>
                      {r.newsletter_source || 'unknown'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge('#991b1b', '#fee2e2')}>Unsubscribed</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderLegacyTab = () => (
    <>
      <div style={styles.legacyBanner}>
        ⚠️ <strong>Legacy MSM Registrations</strong> — These users registered before the newsletter
        system existed. <strong>No consent has been given</strong>. Do not add them to any mailing
        list without a fresh opt-in. Export is provided for reference purposes only.
      </div>
      <div style={styles.toolbar}>
        <input
          style={styles.searchInput}
          placeholder="Search by email…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button style={styles.exportBtn} onClick={exportLegacy}>
          ⬇ Export Legacy CSV ({legacy.length})
        </button>
      </div>
      {visibleLegacy.length === 0 ? (
        <div style={styles.emptyState}>No legacy registrations found.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Registered</th>
                <th style={styles.th}>Last Sign-In</th>
                <th style={styles.th}>Newsletter Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleLegacy.map(r => (
                <tr key={r.user_id}>
                  <td style={styles.td}>{r.email}</td>
                  <td style={styles.td}>{formatDate(r.registered_at)}</td>
                  <td style={styles.td}>{formatDate(r.last_sign_in)}</td>
                  <td style={styles.td}>
                    <span style={styles.badge('#92400e', '#fef3c7')}>
                      No Consent — Legacy
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── render ────────────────────────────────────────────────
  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
      Loading newsletter data…
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: 60, color: RED }}>
      <strong>Error loading newsletter data:</strong><br />{error}
    </div>
  );

  const counts = {
    total:   subscribers.length + legacy.length,
    optedIn: optedIn.length,
    unsub:   unsubscribed.length,
    legacy:  legacy.length,
  };

  const tabCounts = {
    opted_in:     optedIn.length,
    unsubscribed: unsubscribed.length,
    legacy:       legacy.length,
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>📧 Newsletter Management</h2>
        <button
          style={{ ...styles.exportBtn, background: '#64748b' }}
          onClick={fetchData}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div style={styles.statsRow}>
        <div style={styles.statCard('#1A1A2E')}>
          <div style={styles.statNum('#1A1A2E')}>{counts.total}</div>
          <div style={styles.statLabel}>Total Records</div>
        </div>
        <div style={styles.statCard(GREEN)}>
          <div style={styles.statNum(GREEN)}>{counts.optedIn}</div>
          <div style={styles.statLabel}>Active Opt-Ins</div>
        </div>
        <div style={styles.statCard(RED)}>
          <div style={styles.statNum(RED)}>{counts.unsub}</div>
          <div style={styles.statLabel}>Unsubscribed</div>
        </div>
        <div style={styles.statCard(AMBER)}>
          <div style={styles.statNum(AMBER)}>{counts.legacy}</div>
          <div style={styles.statLabel}>Legacy Registrations</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabRow}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={styles.tab(activeTab === t.id)}
            onClick={() => { setActiveTab(t.id); setSearchTerm(''); }}
          >
            {t.label} ({tabCounts[t.id]})
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'opted_in'     && renderOptedInTab()}
      {activeTab === 'unsubscribed' && renderUnsubscribedTab()}
      {activeTab === 'legacy'       && renderLegacyTab()}

      {/* Confirm modal */}
      {confirmEmail && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalTitle}>Confirm Unsubscribe</div>
            <p style={styles.modalText}>
              Unsubscribe <strong>{confirmEmail}</strong> from the MSM newsletter?
              Their consent record will be marked as unsubscribed. This cannot be undone
              without the user re-opting in.
            </p>
            <div style={styles.modalBtns}>
              <button style={styles.cancelBtn} onClick={() => setConfirmEmail(null)}>
                Cancel
              </button>
              <button style={styles.confirmBtn} onClick={() => handleUnsubscribe(confirmEmail)}>
                Yes, Unsubscribe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
