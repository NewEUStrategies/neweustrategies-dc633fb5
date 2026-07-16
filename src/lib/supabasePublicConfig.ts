/**
 * Public (anon) Supabase config - ONE resolution order for both bundles:
 *
 *   1. `import.meta.env.VITE_SUPABASE_*` - inlined at build time when the
 *      build environment carries them (Lovable sandbox, local dev with .env).
 *   2. `window.__SUPABASE_CONFIG__` - runtime handoff written into the
 *      document <head> by RootShell during SSR (see __root.tsx). This is what
 *      keeps the PUBLISHED site alive: the publish build does NOT inject
 *      VITE_* into the client bundle (2026-07-16 incident: every published
 *      asset shipped with both values empty, the browser Supabase client threw
 *      at first touch - `supabase.auth` in AuthProvider - and the root error
 *      boundary replaced fully-rendered pages with the error screen). The
 *      Worker runtime DOES have SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, so
 *      SSR forwards them. Both values are public by design: the anon
 *      (publishable) key ships in every client bundle and is gated by RLS.
 *   3. `process.env.SUPABASE_*` - the server runtime itself (Worker / Node).
 *
 * Never put a service-role key or any other secret through this module.
 */

export interface SupabasePublicConfig {
  url?: string;
  key?: string;
}

declare global {
  interface Window {
    __SUPABASE_CONFIG__?: SupabasePublicConfig;
  }
}

function pick(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) if (value) return value;
  return undefined;
}

/** Resolved per-value (URL and key fall back independently, like the original
 * client.ts logic) so a partially-configured environment reports exactly the
 * missing half. */
export function resolveSupabasePublicConfig(): SupabasePublicConfig {
  const windowConfig = typeof window !== "undefined" ? window.__SUPABASE_CONFIG__ : undefined;
  const env = typeof process !== "undefined" ? process.env : undefined;
  return {
    url: pick(import.meta.env.VITE_SUPABASE_URL, windowConfig?.url, env?.SUPABASE_URL),
    key: pick(
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      windowConfig?.key,
      env?.SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

/**
 * Inline-script payload for the SSR -> browser handoff, or null when the
 * config is unknown (then nothing is emitted and behaviour is unchanged).
 * Rendered by RootShell on BOTH passes: on the server it serializes the
 * Worker env; during hydration it re-serializes from the very script it
 * emitted (window.__SUPABASE_CONFIG__ is set before the app bundle runs), so
 * server and client markup always agree. `<` is escaped so a value can never
 * close the <script> element.
 */
export function supabasePublicConfigScript(): string | null {
  const { url, key } = resolveSupabasePublicConfig();
  if (!url || !key) return null;
  const json = JSON.stringify({ url, key }).replace(/</g, "\\u003c");
  return `window.__SUPABASE_CONFIG__=${json};`;
}
