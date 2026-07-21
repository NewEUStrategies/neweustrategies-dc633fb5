// Tests for the Theme Design controller hook, focused on:
//  1. draft hydration + editing wiring
//  2. save orchestration (only-changed-fields overlay diff)
//  3. TENANT ISOLATION - unsaved drafts are dropped and reads invalidated when
//     the active workspace (tenant) changes, so one company's in-progress edits
//     can never bleed into another company's workspace.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  tenant: { current: "tenant-A" as string | null },
  langMode: { current: "shared" as "shared" | "split" },
  saveTd: vi.fn(),
  saveLangMode: vi.fn(),
  saveCarousel: vi.fn(),
  saveOverlay: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
}));

vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenant.current,
}));

vi.mock("@/lib/theme/themeDesign", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/theme/themeDesign")>();
  return {
    ...actual,
    useThemeDesign: () => ({ data: actual.THEME_DESIGN_DEFAULTS, isLoading: false }),
    useThemeDesignEn: () => ({ data: actual.THEME_DESIGN_DEFAULTS, isLoading: false }),
    useThemeDesignLangMode: () => ({ data: { mode: h.langMode.current } }),
    useSaveThemeDesign: () => ({ mutate: h.saveTd, isPending: false }),
    useSaveThemeDesignLangMode: () => ({ mutate: h.saveLangMode, isPending: false }),
    useLiveThemeDesignPreview: () => {},
  };
});

vi.mock("@/lib/theme/carouselDefaults", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/theme/carouselDefaults")>();
  return {
    ...actual,
    useCarouselDefaults: () => ({ data: actual.CAROUSEL_DEFAULTS, isLoading: false }),
    useSaveCarouselDefaults: () => ({ mutate: h.saveCarousel, isPending: false }),
  };
});

vi.mock("@/hooks/usePostLayoutSettings", async () => {
  const { defaultPostLayoutSettings } = await import("@/lib/postLayouts");
  const fixture = defaultPostLayoutSettings();
  return {
    usePostLayoutSettings: () => ({ data: fixture, isLoading: false }),
    useSavePostLayoutSettings: () => ({ mutate: h.saveOverlay, isPending: false }),
  };
});

import { useThemeDesignDrafts } from "../useThemeDesignDrafts";

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useThemeDesignDrafts(), { wrapper });
  return { ...view, qc, invalidateSpy };
}

beforeEach(() => {
  h.tenant.current = "tenant-A";
  h.langMode.current = "shared";
  h.saveTd.mockClear();
  h.saveLangMode.mockClear();
  h.saveCarousel.mockClear();
  h.saveOverlay.mockClear();
});

describe("useThemeDesignDrafts - hydration + editing", () => {
  it("hydrates drafts and clears the loading flag", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).not.toBeNull();
    expect(result.current.carouselDraft).not.toBeNull();
    expect(result.current.overlayDraft).not.toBeNull();
    expect(result.current.tenantId).toBe("tenant-A");
  });

  it("set() patches the active theme draft", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.set("blockHeading", { fontSize: "40px" }));
    expect(result.current.draft?.blockHeading.fontSize).toBe("40px");
  });

  it("setColor() writes a dark override without touching the light value", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const lightBefore = result.current.draft?.blockHeading.color;
    act(() => {
      result.current.setPreviewMode("dark");
    });
    act(() => result.current.setColor("blockHeading", "color", "#123456"));
    expect(result.current.draft?.darkOverrides.blockHeading?.color).toBe("#123456");
    expect(result.current.draft?.blockHeading.color).toBe(lightBefore);
  });
});

describe("useThemeDesignDrafts - save orchestration", () => {
  it("saves the PL theme + carousel and skips an unchanged overlay in shared mode", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.set("blockHeading", { fontSize: "40px" }));
    act(() => result.current.saveAll());

    expect(h.saveTd).toHaveBeenCalledTimes(1);
    expect(h.saveTd).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "pl" }),
    );
    expect(h.saveCarousel).toHaveBeenCalledTimes(1);
    // Overlay draft never changed -> no columns to write.
    expect(h.saveOverlay).not.toHaveBeenCalled();
  });

  it("saves both PL and EN in split mode", async () => {
    h.langMode.current = "split";
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.saveAll());
    expect(h.saveTd).toHaveBeenCalledTimes(2);
    const langs = h.saveTd.mock.calls.map((call) => call[0].lang).sort();
    expect(langs).toEqual(["en", "pl"]);
  });
});

describe("useThemeDesignDrafts - tenant isolation", () => {
  it("drops unsaved drafts and invalidates reads when the tenant changes", async () => {
    const { result, invalidateSpy } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Unsaved local edit in workspace A.
    act(() => result.current.set("blockHeading", { fontSize: "40px" }));
    expect(result.current.draft?.blockHeading.fontSize).toBe("40px");

    // Switch to workspace B.
    invalidateSpy.mockClear();
    h.tenant.current = "tenant-B";
    act(() => result.rerender());

    // The in-progress edit must not survive the switch: the draft re-hydrates
    // from the (tenant-scoped) server data instead of keeping "40px".
    await waitFor(() => expect(result.current.draft?.blockHeading.fontSize).toBe("18px"));
    expect(result.current.tenantId).toBe("tenant-B");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["site_settings"] });
  });

  it("does not reset drafts on the initial tenant resolution", async () => {
    h.tenant.current = "tenant-A";
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.set("blockHeading", { fontSize: "40px" }));
    // Re-render with the SAME tenant - the edit must be preserved.
    act(() => result.rerender());
    expect(result.current.draft?.blockHeading.fontSize).toBe("40px");
  });
});
