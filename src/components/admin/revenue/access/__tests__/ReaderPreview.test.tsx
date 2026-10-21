// `ReaderPreview` - symulator czytelnika (S7, SPEC §2.2 `access`; karta S7:
// „renderuje ten sam moduł Paywall, test tożsamości importu, tryb preview bez
// efektów").
//
// CO TEN PLIK DOWODZI.
//   1. TOŻSAMOŚĆ IMPORTU: symulator importuje `Paywall` z
//      `src/components/Paywall.tsx` (ten sam moduł co artykuł) i nie ma
//      własnej kopii ściany; renderowany komponent to TEN eksport, z propem
//      `preview.viewer` persony.
//   2. BEZ EFEKTÓW: prawdziwa ściana w podglądzie nie woła `record_paywall_hit`
//      (ani RPC zalogowanego, ani funkcji gościa), nie woła `track()`, a jej
//      odnośniki są `aria-disabled`.
//   3. Pięć person z warstw najemcy: gość, zalogowany bez planu, członek
//      niższej warstwy, subskrybent (przechodzi przez bramkę - ściany nie ma),
//      członek organizacji; brak niższej warstwy = zdanie, nie zmyślona ranga.
//   4. Scenariusze z inwentarza (tryb × próg) i axe bez naruszeń.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  visitorHit: vi.fn(),
  track: vi.fn(),
  plans: [] as unknown[],
  tiers: [] as unknown[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-1" } }, loading: false }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(),
}));
vi.mock("@/lib/billing/checkout.functions", () => ({ createCheckoutOrder: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: (): "sandbox" => "sandbox" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => h.rpc(name, args) },
}));
vi.mock("@/lib/billing/queries", () => ({ fetchActivePlans: async () => h.plans }));
vi.mock("@/lib/billing/tiers", () => ({
  fetchMembershipTiers: async () => h.tiers,
  fetchCurrentTier: async () => null,
}));
vi.mock("@/lib/billing/membership", () => ({ fetchMyOrganization: async () => null }));
vi.mock("@/lib/access/paywallHits.functions", () => ({
  recordPaywallHitVisitor: (input: unknown) => h.visitorHit(input),
}));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => true }));
// Ten sam komponent, owinięty szpiegiem: render przechodzi przez PRAWDZIWĄ
// ścianę, a test widzi, z jakimi propami symulator ją woła.
vi.mock("@/components/Paywall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Paywall")>();
  return { ...actual, Paywall: vi.fn(actual.Paywall) };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { accessPlan } from "@/test/paywall/fixtures";
import * as PaywallModule from "@/components/Paywall";
import { ReaderPreview } from "@/components/admin/revenue/access/ReaderPreview";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { ACCESS_INVENTORY, clone } from "../../overview/__tests__/hubFixtures";

const paywallSpy = vi.mocked(PaywallModule.Paywall);
const inventory = () => clone(ACCESS_INVENTORY) as AccessInventoryDto;

const TIERS = [
  { key: "free", rank: 0, name_pl: "Bezpłatny", name_en: "Free", features: {} },
  { key: "plus", rank: 1, name_pl: "Plus", name_en: "Plus", features: { premium_content: true } },
  { key: "pro", rank: 2, name_pl: "Pro", name_en: "Pro", features: { premium_content: true } },
];

beforeEach(async () => {
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  h.visitorHit.mockReset().mockResolvedValue(true);
  h.track.mockReset();
  h.plans = [
    accessPlan({ id: "11111111-1111-4111-8111-111111111111", tier_key: "plus" }),
    accessPlan({ id: "22222222-2222-4222-8222-222222222222", tier_key: "pro", sort_order: 2 }),
  ];
  h.tiers = TIERS;
  paywallSpy.mockClear();
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

function lastViewer() {
  return paywallSpy.mock.calls.at(-1)?.[0].preview?.viewer;
}

function persona(name: string) {
  fireEvent.click(
    within(screen.getByRole("group", { name: "Czytelnik" })).getByRole("button", { name }),
  );
}

describe("ReaderPreview - ten sam moduł Paywall", () => {
  it("import `Paywall` z src/components/Paywall.tsx, bez własnej kopii ściany", () => {
    const source = readFileSync("src/components/admin/revenue/access/ReaderPreview.tsx", "utf8");
    expect(source).toMatch(/import \{ Paywall \} from "@\/components\/Paywall";/);
    const dir = "src/components/admin/revenue/access";
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/function Paywall\b|const Paywall\b/);
    }
  });

  it("renderuje TEN eksport z propem preview persony (domyślnie gość)", async () => {
    render(<ReaderPreview inventory={inventory()} />);
    await waitFor(() => expect(paywallSpy).toHaveBeenCalled());
    expect(lastViewer()).toEqual({ signedIn: false, tierRank: 0 });
    expect(paywallSpy.mock.calls.at(-1)?.[0].rule).toMatchObject({
      mode: "paid",
      min_tier_rank: 0,
    });
  });

  it("podgląd bez efektów: zero record_paywall_hit, zero track(), martwe odnośniki", async () => {
    render(<ReaderPreview inventory={inventory()} />);
    const frame = screen.getByRole("region", { name: "Podgląd ściany dla czytelnika: Gość" });
    await waitFor(() => expect(within(frame).getAllByRole("link").length).toBeGreaterThan(0));
    for (const link of within(frame).getAllByRole("link")) {
      expect(link).toHaveAttribute("aria-disabled", "true");
    }
    persona("Członek organizacji");
    await waitFor(() => expect(lastViewer()?.org).toEqual({ name: "Instytut Przykładowy" }));
    // Ściana miała czas na efekty po montażu - żadnego pomiaru.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.rpc).not.toHaveBeenCalledWith("record_paywall_hit", expect.anything());
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.visitorHit).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });
});

describe("ReaderPreview - persony i scenariusze", () => {
  it("zalogowany bez planu i członek organizacji dostają ścianę jako persona", async () => {
    render(<ReaderPreview inventory={inventory()} />);
    persona("Zalogowany bez planu");
    await waitFor(() => expect(lastViewer()).toEqual({ signedIn: true, tierRank: 0 }));
    expect(
      within(screen.getByRole("group", { name: "Czytelnik" })).getByRole("button", {
        name: "Zalogowany bez planu",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("treść płatna bez progu: subskrybent przechodzi, niższej warstwy brak", async () => {
    render(<ReaderPreview inventory={inventory()} />);
    persona("Subskrybent");
    expect(screen.getByTestId("preview-has-access")).toHaveTextContent(
      "Ten czytelnik widzi całą treść",
    );
    persona("Członek niższej warstwy");
    expect(screen.getByText("Serwis nie ma warstwy niższej niż próg tej treści.")).toBeVisible();
  });

  it("scenariusz z progiem rangi 2: niższa warstwa = Plus (ranga 1) i widzi ścianę", async () => {
    render(<ReaderPreview inventory={inventory()} />);
    const select = screen.getByRole("combobox", { name: "Rodzaj treści" });
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Dla zalogowanych · Ranga od 2" }));
    persona("Członek niższej warstwy");
    await waitFor(() =>
      expect(lastViewer()).toEqual({ signedIn: true, tierRank: 1, tierKey: "plus" }),
    );
    expect(paywallSpy.mock.calls.at(-1)?.[0].rule).toMatchObject({
      mode: "members",
      min_tier_rank: 2,
    });
    persona("Subskrybent");
    expect(screen.getByTestId("preview-has-access")).toBeVisible();
  });

  it("serwis bez bramek: przykładowa treść płatna", async () => {
    const open = { ...inventory(), rows: [inventory().rows[2]] } as AccessInventoryDto;
    render(<ReaderPreview inventory={open} />);
    expect(screen.getByRole("combobox", { name: "Rodzaj treści" })).toHaveTextContent(
      "Przykładowa treść płatna",
    );
    await waitFor(() => expect(paywallSpy).toHaveBeenCalled());
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<ReaderPreview inventory={inventory()} />);
    const frame = screen.getByRole("region", { name: "Podgląd ściany dla czytelnika: Gość" });
    await waitFor(() => expect(within(frame).getAllByRole("link").length).toBeGreaterThan(0));
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
