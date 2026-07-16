// @vitest-environment node
//
// Node environment: the resolver's window branch is exercised through an
// explicit stubGlobal, and the process.env branch through stubEnv - matching
// how the module behaves in the Worker (no window) and in the browser.
import { describe, it, expect, afterEach, vi } from "vitest";

import { resolveSupabasePublicConfig, supabasePublicConfigScript } from "../supabasePublicConfig";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveSupabasePublicConfig", () => {
  it("prefers build-time VITE_ values", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    vi.stubEnv("SUPABASE_URL", "https://env.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "env-key");
    expect(resolveSupabasePublicConfig()).toEqual({
      url: "https://vite.supabase.co",
      key: "vite-key",
    });
  });

  it("falls back to the SSR-injected window config when the bundle has no VITE_ values", () => {
    vi.stubGlobal("window", {
      __SUPABASE_CONFIG__: { url: "https://window.supabase.co", key: "window-key" },
    });
    expect(resolveSupabasePublicConfig()).toEqual({
      url: "https://window.supabase.co",
      key: "window-key",
    });
  });

  it("falls back to server process.env on the server", () => {
    vi.stubEnv("SUPABASE_URL", "https://env.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "env-key");
    expect(resolveSupabasePublicConfig()).toEqual({
      url: "https://env.supabase.co",
      key: "env-key",
    });
  });

  it("resolves each value independently and reports missing halves as undefined", () => {
    vi.stubEnv("SUPABASE_URL", "https://env.supabase.co");
    expect(resolveSupabasePublicConfig()).toEqual({
      url: "https://env.supabase.co",
      key: undefined,
    });
  });
});

describe("supabasePublicConfigScript", () => {
  it("serializes the config for the document head", () => {
    vi.stubEnv("SUPABASE_URL", "https://env.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "env-key");
    expect(supabasePublicConfigScript()).toBe(
      'window.__SUPABASE_CONFIG__={"url":"https://env.supabase.co","key":"env-key"};',
    );
  });

  it("returns null when the config is unknown, so nothing is emitted", () => {
    expect(supabasePublicConfigScript()).toBeNull();
  });

  it("escapes < so a value can never close the script element", () => {
    vi.stubEnv("SUPABASE_URL", "https://env.supabase.co/</script><script>alert(1)</script>");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "env-key");
    const script = supabasePublicConfigScript();
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script");
  });
});
