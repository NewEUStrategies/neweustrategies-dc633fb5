// CTA darowizny w widgecie CMS. Adres zbiórki był tu kiedyś wpisany w kodzie,
// więc po przełączeniu serwisu na własną kasę zapisane strony dalej
// wyprowadzały darczyńcę na zewnątrz. Teraz decyduje konfiguracja modułu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DONATIONS_DEFAULTS, type DonationsConfig } from "@/lib/billing/donationsConfig";

const h = vi.hoisted(() => ({ config: null as DonationsConfig | null }));

vi.mock("@/lib/billing/donations.functions", () => ({
  getDonationsConfig: async () => h.config,
  getDonationsPublicStats: async () => ({}),
  createDonationCheckout: vi.fn(),
}));

import { DonationCta, type DonationCtaMode } from "@/components/donations/DonationCta";

function renderCta(mode: DonationCtaMode, config: Partial<DonationsConfig> = {}) {
  h.config = { ...DONATIONS_DEFAULTS, ...config };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DonationCta href="/support" label="Wesprzyj" className="cta" mode={mode} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("DonationCta", () => {
  it("tryb `link` zostaje nawigacją wewnętrzną pod wskazany adres", async () => {
    renderCta("link", { provider: "external", externalUrl: "https://z.example" });
    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toBe("/support"));
    expect(screen.getByRole("link").getAttribute("target")).toBeNull();
  });

  it("tryb szybkiej wpłaty prowadzi do NASZEJ kasy, gdy moduł jej używa", async () => {
    renderCta("quick");
    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toBe("/donate"));
    expect(screen.getByRole("link").getAttribute("target")).toBeNull();
  });

  it("tryb szybkiej wpłaty otwiera zbiórkę zewnętrzną w nowej karcie", async () => {
    renderCta("form", { provider: "external", externalUrl: "https://z.example/nes" });
    await waitFor(() =>
      expect(screen.getByRole("link").getAttribute("href")).toBe("https://z.example/nes"),
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("wyłączony moduł degraduje wpłatę do zwykłego linku, nie do martwego przycisku", async () => {
    renderCta("quick", { enabled: false });
    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toBe("/support"));
    expect(screen.getByRole("link").getAttribute("target")).toBeNull();
  });
});
