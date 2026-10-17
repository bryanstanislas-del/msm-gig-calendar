// Minimal Supabase REST client for the ads API (server only). Uses the
// caller's own JWT for user-scoped RPCs (so RLS and auth.uid() apply) and
// the service-role key only for the narrow service-role RPCs/storage reads.

export class RpcError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseRest(cfg, fetchImpl = globalThis.fetch) {
  const base = cfg.supabaseUrl;

  async function rpc(fn, args, bearer, apikey) {
    const r = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!r.ok) throw new RpcError(body?.message || `rpc ${fn} failed`, r.status, body?.code);
    return body;
  }

  return {
    rpcAsUser: (jwt, fn, args) => rpc(fn, args, jwt, cfg.anonKey),
    rpcAsAnon: (fn, args) => rpc(fn, args, cfg.anonKey, cfg.anonKey),
    rpcAsService: (fn, args) => rpc(fn, args, cfg.serviceKey, cfg.serviceKey),

    async getUser(jwt) {
      const r = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${jwt}` } });
      if (!r.ok) return null;
      const u = await r.json();
      return u?.id ? { id: u.id } : null;
    },

    async downloadObject(bucket, path, maxBytes) {
      const r = await fetchImpl(`${base}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` },
      });
      if (!r.ok) return null;
      const len = Number(r.headers?.get?.("content-length") || 0);
      if (len && len > maxBytes) return { tooLarge: true };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) return { tooLarge: true };
      return { buffer: buf };
    },

    async signedUrl(bucket, path, expiresIn) {
      const r = await fetchImpl(`${base}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const rel = j?.signedURL || j?.signedUrl;
      return rel ? `${base}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` : null;
    },
  };
}
