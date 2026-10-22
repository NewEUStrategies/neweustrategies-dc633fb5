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

// (I9) Sesja dla bramki odnośnika do huba (`useRevenueHubTab`); domyślnie
// gość (bez roli huba) - tak renderowały się testy sprzed montażu huba.
const session = vi.hoisted(() => ({
  roles: [] as string[],
  tenantId: null as string | null,
}));

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub, useHydrated: () => true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => session }));
// Sygnał Diagnostyki ma własne testy (`RevenueSignalChip.test.tsx`) - tu
// sprawdzamy wyłącznie MIEJSCE montażu i ekran (`surface`).
vi.mock("@/components/admin/revenue/molecules/RevenueSignalChip", () => ({
  RevenueSignalChip: (props: { surface?: string; variant?: string }) => (
    <div
      data-testid="revenue-signal-mount"
      data-surface={props.surface}
      data-variant={props.variant}
    />
  ),
}));
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
  session.roles = [];
  session.tenantId = null;
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

describe("AdminPricingWorkspace - zakładka z adresu (SPEC §2.6, `?tab=`)", () => {
  it("zakładka podana przez trasę jest otwarta od pierwszego renderu", async () => {
    renderWithQueryClient(<AdminPricingWorkspace tab="retention" onTabChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "adminPricing.tabs.retention" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(chain.chainsFor("retention_settings")).toHaveLength(1));
  });

  it("wybór zakładki wraca do trasy (zapis w adresie), zamiast żyć tylko w stanie", async () => {
    const onTabChange = vi.fn();
    renderWithQueryClient(<AdminPricingWorkspace tab="audiences" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "adminPricing.tabs.faq" }));

    expect(onTabChange).toHaveBeenCalledWith("faq");
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

  // I9 (SPEC §2.7): lokalny pasek zastąpiła wspólna molekuła huba
  // `RelatedModulesBar` - nazwany landmark i napisy ze słownika powłoki.
  it("pasek to wspólny `RelatedModulesBar` (nazwany landmark, napisy powłoki huba)", async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    const nav = screen.getByRole("navigation", { name: "adminRevenue.related.heading" });
    expect(nav).toHaveTextContent("adminRevenue.related.coupons");
    expect(nav).toHaveTextContent("adminRevenue.related.dashboard");
  });

  it("odnośnik do huba tylko dla roli huba z najemcą; gość i sam super_admin go nie dostają", async () => {
    const { unmount } = renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    const hrefsOf = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefsOf()).not.toContain("/admin/revenue");
    unmount();

    session.roles = ["super_admin"];
    session.tenantId = "tenant-1";
    const second = renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(hrefsOf()).not.toContain("/admin/revenue");
    second.unmount();

    session.roles = ["admin"];
    renderWithQueryClient(<AdminPricingWorkspace />);
    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    expect(hrefsOf()).toContain("/admin/revenue");
  });

  it('sygnał Diagnostyki cennika (`surface="pricing"`) w nagłówku panelu', async () => {
    renderWithQueryClient(<AdminPricingWorkspace />);

    await waitFor(() => expect(screen.getByText("individual")).toBeInTheDocument());
    const mount = screen.getByTestId("revenue-signal-mount");
    expect(mount).toHaveAttribute("data-surface", "pricing");
    expect(mount).toHaveAttribute("data-variant", "bar");
    expect(mount.closest("header")).not.toBeNull();
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
