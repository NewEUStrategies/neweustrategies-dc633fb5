// MOLEKUŁA „NA ŻYWO" - rzeczywisty adres strony + cztery wyjścia (strona,
// Google, Facebook, LinkedIn).
//
// PRZEDMIOT DOWODU: CZYJ to adres. Do 2026-10 molekuła składała go zawsze na
// `SITE_CANONICAL_ORIGIN`, więc admin tenanta z własną domeną dostawał linki
// walidatorów prowadzące na stronę MARKI - Facebook Debugger pokazywał mu
// kartę cudzego serwisu jako „to, co widzi świat". Origin idzie teraz
// z `useTenantPublicOrigin` (domena z `tenants.domain`, inaczej reguła
// powierzchni maszynowych dla hosta karty).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";
import { LivePreviewLinks } from "@/components/admin/seo/LivePreviewLinks";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const h = vi.hoisted(() => ({
  tenantDomain: null as string | null,
  /** `tenants.is_default` (undefined = nieznane - spadek na host karty). */
  tenantIsDefault: undefined as boolean | undefined,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: "t-1" }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const link = {
        select: () => link,
        eq: () => link,
        maybeSingle: () =>
          Promise.resolve({
            data: { domain: h.tenantDomain, is_default: h.tenantIsDefault },
            error: null,
          }),
      };
      return link;
    },
  },
}));

afterEach(() => {
  cleanup();
  h.tenantDomain = null;
  h.tenantIsDefault = undefined;
});

function hrefs(): string[] {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
}

describe("LivePreviewLinks", () => {
  it("marka: adres i walidatory na originie kanonicznym", async () => {
    renderWithQueryClient(<LivePreviewLinks path="en" />);
    const url = `${SITE_CANONICAL_ORIGIN}/en`;
    await waitFor(() => expect(screen.getByText(url)).toBeTruthy());
    expect(hrefs()).toEqual([
      url,
      `https://www.google.com/search?q=${encodeURIComponent(`site:${url}`)}`,
      `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`,
      `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`,
    ]);
  });

  it("tenant z własną domeną: adres i KAŻDY walidator idą na jego origin", async () => {
    h.tenantDomain = "analizy.example.org";
    renderWithQueryClient(<LivePreviewLinks path="blog/wpis" />);
    const url = "https://analizy.example.org/blog/wpis";
    await waitFor(() => expect(screen.getByText(url)).toBeTruthy());
    expect(hrefs()[0]).toBe(url);
    for (const href of hrefs().slice(1)) {
      expect(href).toContain(encodeURIComponent(url));
    }
    // Negatyw: żaden link nie prowadzi na markę.
    expect(hrefs().some((href) => href.includes("neweuropeanstrategies"))).toBe(false);
  });

  it("strona główna tenanta to sam jego origin, bez końcowego ukośnika", async () => {
    h.tenantDomain = "analizy.example.org";
    renderWithQueryClient(<LivePreviewLinks path="" />);
    await waitFor(() => expect(hrefs()[0]).toBe("https://analizy.example.org"));
  });

  it("tenant NIEDOMYŚLNY bez domeny: komunikat zamiast linków na markę", async () => {
    // Runda 2: spadek na host karty dawał takiemu tenantowi origin MARKI, więc
    // Facebook Debugger i LinkedIn Inspector otwierały stronę marki.
    h.tenantIsDefault = false;
    renderWithQueryClient(<LivePreviewLinks path="en" />);
    await waitFor(() => expect(screen.getByText("adminSeoHub.noPublicDomain")).toBeTruthy());
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(`${SITE_CANONICAL_ORIGIN}/en`)).toBeNull();
  });

  it("tenant DOMYŚLNY bez domeny (marka) dalej dostaje linki na origin kanoniczny", async () => {
    h.tenantIsDefault = true;
    renderWithQueryClient(<LivePreviewLinks path="en" />);
    await waitFor(() => expect(hrefs()[0]).toBe(`${SITE_CANONICAL_ORIGIN}/en`));
  });
});
