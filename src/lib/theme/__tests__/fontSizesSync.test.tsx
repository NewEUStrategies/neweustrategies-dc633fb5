// Regresja: zmiana rozmiarów czcionek w panelu MUSI natychmiast przeliczyć
// tokeny --fs-h1 / --fs-lead na stronie publicznej (ThemeFontSizesStyle) oraz
// przetrwać równoległy refetch, który wróciłby ze starą wartością.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  applyPendingWrites,
  commitSiteSettingWrite,
  resetPendingWrites,
  siteSettingsQueryOptions,
} from "@/lib/useSiteSetting";
import { FONT_SIZES_DEFAULTS, FONT_SIZES_KEY } from "@/lib/theme/fontSizes";
import { ThemeFontSizesStyle } from "@/components/theme/ThemeFontSizesStyle";
import { overlayTypographyStyle, headerTypographyStyle } from "@/lib/postLayouts";

let serverMap: Record<string, unknown> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: async () => ({
        data: Object.entries(serverMap).map(([key, value]) => ({ key, value })),
        error: null,
      }),
    }),
  },
}));

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function renderStyle(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <div data-testid="host">
        <ThemeFontSizesStyle />
      </div>
    </QueryClientProvider>,
  );
}

const css = () => screen.getByTestId("host").querySelector("style")?.textContent ?? "";

describe("font sizes -> public page sync", () => {
  beforeEach(() => {
    resetPendingWrites();
    serverMap = {};
  });

  it("renders theme defaults before settings load", async () => {
    const qc = makeClient();
    renderStyle(qc);
    expect(css()).toContain(`--fs-h1:${FONT_SIZES_DEFAULTS.headings.h1.desktop}px;`);
    expect(css()).toContain(`--fs-lead:${FONT_SIZES_DEFAULTS.lead.size}px;`);
  });

  it("propagates an admin save to H1 and lead tokens immediately", async () => {
    const qc = makeClient();
    await qc.fetchQuery(siteSettingsQueryOptions);
    renderStyle(qc);

    const next = {
      ...FONT_SIZES_DEFAULTS,
      lead: { size: 21, lineHeight: 1.45 },
      headings: {
        ...FONT_SIZES_DEFAULTS.headings,
        h1: { ...FONT_SIZES_DEFAULTS.headings.h1, desktop: 57, lineHeight: 1.02 },
      },
    };
    await commitSiteSettingWrite(qc, FONT_SIZES_KEY, next);

    await waitFor(() => {
      expect(css()).toContain("--fs-h1:57px;");
      expect(css()).toContain("--lh-h1:1.02;");
      expect(css()).toContain("--fs-lead:21px;");
      expect(css()).toContain("--lh-lead:1.45;");
    });
  });

  it("keeps the saved value when a refetch returns stale server data", async () => {
    const qc = makeClient();
    serverMap = { [FONT_SIZES_KEY]: FONT_SIZES_DEFAULTS };
    await qc.fetchQuery(siteSettingsQueryOptions);
    renderStyle(qc);

    const next = {
      ...FONT_SIZES_DEFAULTS,
      headings: {
        ...FONT_SIZES_DEFAULTS.headings,
        h1: { ...FONT_SIZES_DEFAULTS.headings.h1, desktop: 61 },
      },
    };
    // Serwer nadal zwraca stare dane (replika/edge cache) - wersjonowany zapis
    // musi wygrać z odpowiedzią refetcha.
    await commitSiteSettingWrite(qc, FONT_SIZES_KEY, next);
    await qc.refetchQueries({ queryKey: siteSettingsQueryOptions.queryKey });

    await waitFor(() => expect(css()).toContain("--fs-h1:61px;"));
  });

  it("drops the pending write once the server confirms it", () => {
    const value = { a: 1 };
    applyPendingWrites({ x: value });
    expect(applyPendingWrites({ x: value })).toEqual({ x: value });
  });
});

describe("line-height stays owned by the theme", () => {
  it("exposes theme line-height vars for overlay and header titles/leads", () => {
    const custom = {
      title_size_source: "custom" as const,
      overlay_title_size_base: 20,
      overlay_title_size_md: 24,
      overlay_title_size_lg: 28,
      overlay_excerpt_size_base: 12,
      overlay_excerpt_size_md: 13,
      overlay_excerpt_size_lg: 14,
      header_title_size_base: 30,
      header_title_size_md: 36,
      header_title_size_lg: 48,
      header_excerpt_size_base: 16,
      header_excerpt_size_md: 17,
      header_excerpt_size_lg: 18,
    };
    const overlay = overlayTypographyStyle(custom) as Record<string, string>;
    const header = headerTypographyStyle(custom) as Record<string, string>;
    expect(overlay["--overlay-title-lh"]).toContain("--lh-h1");
    expect(overlay["--overlay-excerpt-lh"]).toContain("--lh-lead");
    expect(header["--header-title-lh"]).toContain("--lh-h1");
    expect(header["--header-excerpt-lh"]).toContain("--lh-lead");

    const themed = overlayTypographyStyle({
      ...custom,
      title_size_source: "theme",
    }) as Record<string, string>;
    expect(themed["--overlay-title-lh"]).toContain("--lh-h1");
  });
});
