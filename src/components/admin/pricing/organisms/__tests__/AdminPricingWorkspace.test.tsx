// Cały panel Cennika 2.0 - kompozycja i trzy zapytania wspólne dla zakładek.
//
// Dowodzimy tu tego, czego nie widać w testach pojedynczych zakładek: że dane
// czytane RAZ trafiają do wszystkich zakładek naraz (segmenty są potrzebne i
// w „Segmentach", i w „Warstwach", i w „FAQ"), że kolejność odczytu jest ta
// sama, co u klienta, i że panel prowadzi do pozostałych modułów monetyzacji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  membershipTier,
  ok,
  pricingAudience,
  pricingFaqItem,
  radixSelectStub,
  radixSwitchStub,
  radixTabsStub,
  reactI18nextStub,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { retentionSettings } from "@/test/billing/fixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AdminPricingWorkspace } =
  await import("@/components/admin/pricing/organisms/AdminPricingWorkspace");

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("pricing_audiences", ok([pricingAudience()]));
  chain.setResponse("membership_tiers", ok([membershipTier()]));
  chain.setResponse("pricing_faq_items", ok([pricingFaqItem()]));
  chain.setResponse("retention_settings", ok(retentionSettings()));
  chain.setResponse("retention_reasons", ok([]));
  chain.setResponse("retention_feedback", ok([]));
});

describe("AdminPricingWorkspace - odczyt katalogu", () => {
  it("czyta segmenty w KOLEJNOŚCI PREZENTACYJNEJ, nie w kolejności wstawienia", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(chain.lastChain("pricing_audiences")).toBeTruthy());
    expect(chain.lastChain("pricing_audiences")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("czyta warstwy po randze - tak samo, jak układa je strona publiczna", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(chain.lastChain("membership_tiers")).toBeTruthy());
    expect(chain.lastChain("membership_tiers")!.argsOf("order")).toEqual([
      "rank",
      { ascending: true },
    ]);
  });

  it("czyta pytania FAQ po kolejności redakcyjnej", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(chain.lastChain("pricing_faq_items")).toBeTruthy());
    expect(chain.lastChain("pricing_faq_items")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("każdy katalog czytany JEDNYM zapytaniem, mimo czterech zakładek", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(1);
    expect(chain.chainsFor("membership_tiers")).toHaveLength(1);
  });
});

describe("AdminPricingWorkspace - zakładki", () => {
  it("otwiera się na segmentach", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "adminPricing.tabs.audiences" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("ma cztery zakładki: segmenty, warstwy, FAQ, retencja", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(screen.getByRole("tab", { name: "adminPricing.tabs.retention" })).toBeInTheDocument();
  });

  it("segmenty wczytane RAZ trafiają też do zakładki warstw", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "adminPricing.tabs.tiers" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Osoba prywatna" })).toBeInTheDocument(),
    );
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(1);
  });

  it("zakładka FAQ pokazuje wczytane pytania", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "adminPricing.tabs.faq" }));

    await waitFor(() =>
      expect(screen.getByText("Czy mogę zrezygnować w każdej chwili?")).toBeInTheDocument(),
    );
  });

  it("zakładka retencji czyta ustawienia dopiero po jej otwarciu", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(chain.chainsFor("retention_settings")).toHaveLength(0);

    fireEvent.click(screen.getByRole("tab", { name: "adminPricing.tabs.retention" }));

    await waitFor(() => expect(chain.chainsFor("retention_settings")).toHaveLength(1));
  });
});

describe("AdminPricingWorkspace - powiązane moduły monetyzacji", () => {
  it("prowadzi do kuponów, członkostwa, paywalla i pulpitu", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/admin/coupons",
        "/admin/membership",
        "/admin/paywall",
        "/admin/monetization",
      ]),
    );
  });

  it("nagłówek mówi, czym jest ten panel", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("adminPricing.title");
  });
});

describe("AdminPricingWorkspace - odmowa odczytu", () => {
  it("BŁĄD odczytu segmentów nie udaje pustego katalogu", async () => {
    // Puste zakładki w panelu redakcyjnym znaczą „nie ma oferty". Odmowa
    // odczytu musi zostawić panel w stanie bez danych, a nie pokazać zero
    // segmentów jako fakt.
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(chain.chainsFor("pricing_audiences")).toHaveLength(1));
    expect(screen.queryByText("individual")).not.toBeInTheDocument();
  });

  it("pusty katalog daje ogłoszony komunikat, nie milczącą stronę", async () => {
    chain.setResponse("pricing_audiences", ok([]));
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("adminPricing.audiences.empty");
  });
});
