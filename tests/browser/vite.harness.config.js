// Builds the local browser-test harness with the shared Supabase client
// replaced by the synthetic fake (no network, no real project).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const fake = path.resolve(__dirname, "fakeSupabase.js");
export default defineConfig({
  root: __dirname,
  logLevel: "error",
  plugins: [react(), {
    name: "fake-supabase-client",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (!/supabaseClient(\.js)?$/.test(source) || !importer || importer === fake) return null;
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      return r && r.id.endsWith(path.join("src", "supabaseClient.js")) ? fake : null;
    },
  }],
  build: { rollupOptions: { input: path.resolve(__dirname, "harness.html") }, emptyOutDir: true },
});
