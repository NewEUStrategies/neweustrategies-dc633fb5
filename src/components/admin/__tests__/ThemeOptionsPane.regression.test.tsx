/**
 * Regression: /admin/theme-options must render the full options tree for a
 * tenant with stored data, and it must NOT crash into an error boundary when
 * auth/tenant context is missing (2026-07-23 incident: ImageSlot called
 * useRequiredTenant() during render, taking the whole panel down before any
 * option could appear).
 *
 * We assert two things:
 *  1. Every section from SECTIONS renders as a nav button (nested "header.*"
 *     entries included) - so partial DB rows no longer wipe branches.
 *  2. Rendering without an AuthProvider does not throw / does not trip the
 *     surrounding error boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";


// ---- supabase client mock -----------------------------------------------
// vi.mock is hoisted, so the factory cannot close over module-scope values.
vi.mock("@/integrations/supabase/client", () => {
  // A minimal stored row that DOES NOT include every branch of ThemeOptions
  // defaults - the pane must still render header/buttons/text_fields sections
  // thanks to deep-merge in useSettings, not because they were stored.
  const STORED = {
    logo: { main: "https://cdn.example.com/logo.png" },
    header: { layout: "layout-2" },
  };
  const siteSettingsRows = [{ key: "theme_options", value: STORED }];
  const from = (table: string) => {
    if (table !== "site_settings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
        }),
      };
    }
    return {
      select: (cols: string) => {
        if (cols === "value") {
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: { value: STORED }, error: null }),
            }),
          };
        }
        return {
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: siteSettingsRows, error: null }),
        };
      },
    };
  };

  return {
    supabase: {
      from,
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        }),
      },
    },
  };
});

// SSR-only edge cache used by useSiteSetting - execute the fetcher directly.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));


class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <div data-testid="boundary">{this.state.error.message}</div>;
    return this.props.children;
  }
}

// Import AFTER vi.mock calls above; vitest hoists vi.mock so this order works.
import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";

function renderPane() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Deliberately NO <AuthProvider> - regression: pane must not crash without it.
  return render(
    <QueryClientProvider client={qc}>
      <Boundary>
        <ThemeOptionsPane />
      </Boundary>
    </QueryClientProvider>,
  );
}


describe("/admin/theme-options regression", () => {
  beforeEach(() => {
    // Fresh hash each test - the pane seeds `active` from window.location.hash.
    if (typeof window !== "undefined") window.location.hash = "";
  });

  it("renders every section (including nested header.* branches) from a partial stored row", async () => {
    renderPane();

    // These labels correspond to SECTIONS in ThemeOptionsPane. i18next is
    // uninitialised in the test environment, so t(labelKey) returns the key
    // itself - which is exactly the assertion surface we want (stable, no
    // translation coupling).
    const expected = [
      "themeOptions.sections.logo",
      "themeOptions.sections.globalColors",
      "themeOptions.sections.backgrounds",
      "themeOptions.sections.headerLayout",
      "themeOptions.sections.mainMenu",
      "themeOptions.sections.headerSearch",
      "themeOptions.sections.alertBar",
      "themeOptions.sections.socialIcons",
      "themeOptions.sections.signinButtons",
      "themeOptions.sections.mobileHeader",
      "themeOptions.sections.buttons",
      "themeOptions.sections.textFields",
      "themeOptions.sections.inputColors",
      "themeOptions.sections.iconColors",
      "themeOptions.sections.linkColors",
      "themeOptions.sections.fontSizes",
      "themeOptions.sections.contentStylingAdvanced",
    ];

    // Wait for the pane to hydrate from the mocked settings row.
    await waitFor(() => {
      expect(screen.getByTitle("themeOptions.sections.logo")).toBeInTheDocument();
    });

    for (const key of expected) {
      expect(
        screen.getByTitle(key),
        `section button "${key}" should render`,
      ).toBeInTheDocument();
    }

    // Error boundary must NOT have fired.
    expect(screen.queryByTestId("boundary")).toBeNull();
  });

  it("does not throw into the error boundary when no AuthProvider is mounted", async () => {
    renderPane();
    await waitFor(() => {
      expect(screen.getByTitle("themeOptions.sections.logo")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("boundary")).toBeNull();
  });
});
