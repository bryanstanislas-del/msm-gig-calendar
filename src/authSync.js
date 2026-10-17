// Keeps the app's `auth` state in step with Supabase's auth events.
//
// * The onAuthStateChange callback is SYNCHRONOUS and makes no Supabase call:
//   Supabase's guidance is not to await client calls inside it (on some SDK
//   versions/lock implementations that blocks every later request). Profile
//   loading (buildAuth -> profiles/venues/user_roles reads) is deferred to a
//   macrotask outside the callback.
// * Stale results are dropped: every sign-in/out/account switch bumps a
//   generation, and a profile load only applies if it is still current and
//   the component is still mounted. A slow load for the previous user can
//   therefore never resurrect them after SIGNED_OUT or a switch.
// * TOKEN_REFRESHED / USER_UPDATED for the same user keep the loaded profile
//   (no refetch); a different user is loaded fresh, and the previous user's
//   auth is cleared IMMEDIATELY so their (e.g. admin) UI is never shown to
//   the new account while its profile loads.
// * The startup getSession() result is only used if no auth event has arrived
//   since it was requested (event revision, separate from the profile
//   generation): a slow startup can never resurrect a signed-out user or
//   replace a newer account. A startup failure is reported, never unhandled.
// No tokens or session contents are ever logged.
export function startAuthSync({ supabase, buildAuth, setAuth, defer = (fn) => setTimeout(fn, 0), onError = () => {} }) {
  let stopped = false;
  let generation = 0;          // profile loads
  let eventRevision = 0;       // authoritative auth events from the listener
  let currentUserId = null;

  const signedOut = () => {
    generation += 1;
    currentUserId = null;
    setAuth(null);
  };

  const load = (session) => {
    const gen = ++generation;
    currentUserId = session.user.id;
    defer(async () => {
      if (stopped || gen !== generation) return;
      try {
        const result = await buildAuth(session);
        if (!stopped && gen === generation) setAuth(result);
      } catch (e) {
        if (!stopped && gen === generation) onError(e);
      }
    });
  };

  const handle = (event, session) => {
    if (stopped) return;
    if (event === "SIGNED_OUT" || !session?.user?.id) {
      if (event === "SIGNED_OUT" || currentUserId !== null) signedOut();
      return;
    }
    if (session.user.id === currentUserId) return;            // same user: keep the loaded profile
    if (currentUserId !== null) setAuth(null);               // account switch: drop the previous user's UI now
    load(session);                                           // first session, sign-in, or account switch
  };

  // 1) Explicit startup check (Supabase's recommended pattern), guarded
  //    against any auth event that arrives while it is pending.
  const startupRevision = eventRevision;
  Promise.resolve()
    .then(() => supabase.auth.getSession())
    .then(({ data, error } = {}) => {
      if (stopped || eventRevision !== startupRevision) return;   // a newer event is authoritative
      if (error) { onError(error); return; }
      if (data?.session) handle("STARTUP", data.session);
    })
    .catch((e) => { if (!stopped) onError(e); });
  // 2) Synchronous listener -- returns nothing, awaits nothing.
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => { eventRevision += 1; handle(event, session); });

  return () => { stopped = true; listener?.subscription?.unsubscribe(); };
}
