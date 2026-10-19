// Paywall czytelnika (S3, AD-16): MACIERZ PERSON - jedna ściana, osiem
// czytelników, każdy z właściwym tekstem i CTA (P14), powrotem po logowaniu
// (P15) i pomiarem (P18). Dla KAŻDEJ persony: zajawka jest w DOM, treść
// artykułu (`body`) nie - ściana nie dostaje body i nie może go wyrenderować.
// Tryb `preview` (symulator czytelnika w hubie) nie mierzy niczego.
//
// `proposal_ux.md §10.1` (wiążąca macierz w SPEC) nie istnieje w repozytorium
// - persony i oczekiwania wynikają z karty S3 (raport: odchylenie).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { accessPlan, accessRule, meterSettings, meterState } from "@/test/paywall/fixtures";
import { translateKey as k } from "@/test/network/fixtures";
import { axeViolations, summarize } from "@/test/axe";
import type { ContentAccessRule } from "@/hooks/useContentAccess";
import type { PaywallViewer } from "@/lib/access/paywallOffer";

const ENTITY = "00000000-0000-4000-8000-0000000000aa";
const BODY_SENTINEL = "TRESC-ARTYKULU-ZA-SCIANA";
const TEASER = "Zajawka dla każdego czytelnika";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  plans: [] as unknown[],
  tiers: [] as unknown[],
  currentTier: null as { key: string; rank: number } | null,
  org: null as { name: string } | null,
  rpc: vi.fn(),
  visitorHit: vi.fn(),
  track: vi.fn(),
  consent: true,
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
// Link z `search` w adresie - asercje czytają realny cel (`next`, `intent`).
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, value);
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query ? `${href}?${query}` : href} {...rest}>
        {children}
      </a>
    );
  },
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
  fetchCurrentTier: async () => h.currentTier,
}));
vi.mock("@/lib/billing/membership", () => ({ fetchMyOrganization: async () => h.org }));
vi.mock("@/lib/access/paywallHits.functions", () => ({
  recordPaywallHitVisitor: (input: unknown) => h.visitorHit(input),
}));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

import { Paywall, type PaywallPreview } from "@/components/Paywall";

const TIERS = [
  { key: "free", rank: 0, name_pl: "Bezpłatny", name_en: "Free", features: {} },
  { key: "plus", rank: 1, name_pl: "Plus", name_en: "Plus", features: { premium_content: true } },
  { key: "pro", rank: 2, name_pl: "Pro", name_en: "Pro", features: { premium_content: true } },
  {
    key: "decision_lab",
    rank: 3,
    name_pl: "Decision Lab",
    name_en: "Decision Lab",
    features: { premium_content: true },
  },
];
const PLUS_M = accessPlan({ id: "11111111-1111-4111-8111-111111111111", tier_key: "plus" });
const PRO_M = accessPlan({
  id: "22222222-2222-4222-8222-222222222222",
  tier_key: "pro",
  name_pl: "Pro miesięczny",
  price_cents: 9900,
  sort_order: 2,
});
const LAB = accessPlan({
  id: "33333333-3333-4333-8333-333333333333",
  tier_key: "decision_lab",
  name_pl: "Decision Lab",
  sort_order: 3,
});

const rule = (overrides: Partial<ContentAccessRule> = {}) =>
  accessRule({ entity_id: ENTITY, teaser_pl: TEASER, ...overrides });

function renderWall(props: {
  rule: ContentAccessRule;
  preview?: PaywallPreview;
  meter?: boolean;
  lang?: "pl" | "en";
}) {
  return render(
    <Paywall
      rule={props.rule}
      lang={props.lang ?? "pl"}
      fallbackText={null}
      preview={props.preview}
      onPasswordVerify={async () => ({ ok: true })}
      {...(props.meter
        ? {
            meterSettings: meterSettings(),
            meterApplies: true,
            meterState: meterState({ granted: false, used: 3, monthlyLimit: 3, remaining: 0 }),
          }
        : {})}
    />,
  );
}

/** Wspólna asercja każdej persony: zajawka tak, treść artykułu nie. */
function expectTeaserWithoutBody() {
  expect(screen.getByText(new RegExp(TEASER))).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(BODY_SENTINEL);
}

function hrefOf(name: string): URL {
  return new URL(screen.getByRole("link", { name }).getAttribute("href") ?? "", "https://x.test");
}

beforeEach(() => {
  h.session = null;
  h.plans = [PLUS_M, PRO_M, LAB];
  h.tiers = TIERS;
  h.currentTier = null;
  h.org = null;
  h.consent = true;
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  h.visitorHit.mockReset().mockResolvedValue(true);
  h.track.mockReset();
  window.history.replaceState({}, "", "/analizy/tekst-premium?ref=nl");
  window.sessionStorage.clear();
});

describe("Paywall czytelnika - macierz person (P14)", () => {
  it("gość: ceny planów i ścieżka rejestracja -> kasa z powrotem na tekst", async () => {
    const { container } = renderWall({ rule: rule({ mode: "paid" }) });
    expect(await screen.findByText("Pro miesięczny")).toBeInTheDocument();
    expect(container.textContent).toContain("49");
    expectTeaserWithoutBody();
    // Logowanie wraca na artykuł (P15) - adres razem z zapytaniem.
    await waitFor(() =>
      expect(hrefOf(k("paywall.signin")).searchParams.get("next")).toBe(
        "/analizy/tekst-premium?ref=nl",
      ),
    );
    expect(hrefOf(k("paywall.signin")).searchParams.get("intent")).toBe("paywall");
    // Karta planu: konto, potem kasa TEGO planu.
    const buy = screen.getAllByRole("link", { name: k("paywall.offer.signupBuy") })[0];
    const url = new URL(buy.getAttribute("href") ?? "", "https://x.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(url.searchParams.get("next")).toBe(`/checkout/${PLUS_M.id}`);
    expect(url.searchParams.get("plan")).toBe(PLUS_M.id);
    // Plan na zapytanie nie ma ceny w kasie.
    expect(screen.queryByText("Decision Lab")).not.toBeInTheDocument();
  });

  it("zarejestrowany bez planu: subskrypcja prowadzi do kasy, bez logowania", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "free", rank: 0 };
    renderWall({
      rule: rule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    const links = await screen.findAllByRole("link", { name: k("paywall.subscribe") });
    expect(links[0]).toHaveAttribute("href", `/checkout/${PLUS_M.id}`);
    expect(screen.getByRole("button", { name: k("paywall.buy") })).toBeInTheDocument();
    expect(screen.queryByText(k("paywall.signin"))).not.toBeInTheDocument();
    expectTeaserWithoutBody();
  });

  it("ranga za niska: wymaga planu Pro i upgrade zamiast logowania", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "plus", rank: 1 };
    renderWall({ rule: rule({ mode: "members", min_tier_rank: 2 }) });
    expect(
      await screen.findByRole("heading", {
        name: k("paywall.offer.upgradeTitle", { tier: "Pro" }),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(k("paywall.offer.upgradeDesc"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: k("paywall.offer.upgrade") })).toHaveAttribute(
      "href",
      `/checkout/${PRO_M.id}`,
    );
    expect(screen.queryByText(k("paywall.signin"))).not.toBeInTheDocument();
    expectTeaserWithoutBody();
  });

  it("z planem spełniającym regułę: informacja o dostępie, bez sprzedaży", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "pro", rank: 2 };
    renderWall({ rule: rule({ mode: "members", min_tier_rank: 2 }) });
    expect(await screen.findByText(k("paywall.offer.granted"))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: k("paywall.offer.upgrade") })).toBeNull();
    expect(screen.queryByRole("link", { name: k("paywall.subscribe") })).toBeNull();
    expectTeaserWithoutBody();
  });

  it("wyczerpany limit: licznik i oferta planów", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "free", rank: 0 };
    renderWall({ rule: rule({ mode: "paid" }), meter: true });
    expect(
      screen.getByRole("heading", { name: k("paywall.meter.exhaustedTitle") }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paywall-meter")).toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: k("paywall.subscribe") })).length).toBe(2);
    expectTeaserWithoutBody();
  });

  it("hasło: formularz, bez oferty i bez logowania", () => {
    renderWall({ rule: rule({ mode: "password" }) });
    expect(screen.getByLabelText(k("paywall.passwordPlaceholder"))).toBeInTheDocument();
    expect(screen.queryByText(k("paywall.signin"))).not.toBeInTheDocument();
    expect(screen.queryByText(k("paywall.seeAllPlans"), { exact: false })).toBeNull();
    expectTeaserWithoutBody();
  });

  it("członek organizacji bez miejsca: kontakt z organizacją", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "free", rank: 0 };
    h.org = { name: "Fundacja Wschód" };
    renderWall({ rule: rule({ mode: "paid" }) });
    expect(
      await screen.findByText(k("paywall.offer.org", { name: "Fundacja Wschód" }), {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: k("paywall.offer.orgLink") })).toHaveAttribute(
      "href",
      "/profile/organization",
    );
    expectTeaserWithoutBody();
  });

  it("plan na zapytanie: zapytanie o ofertę zamiast kasy", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "free", rank: 0 };
    renderWall({ rule: rule({ mode: "members", min_tier_rank: 3 }) });
    expect(await screen.findByRole("link", { name: k("paywall.offer.salesCta") })).toHaveAttribute(
      "href",
      `/plans/${LAB.id}`,
    );
    expect(screen.queryByRole("link", { name: k("paywall.subscribe") })).toBeNull();
    expectTeaserWithoutBody();
  });

  it("EN: napis waluty obciążenia przy cenie (P09)", async () => {
    renderWall({ rule: rule({ mode: "paid" }), lang: "en" });
    expect(
      await screen.findByText(k("paywall.offer.chargedIn", { currency: "PLN" })),
    ).toBeInTheDocument();
  });

  it("gość z ofertą nie wnosi naruszeń axe", async () => {
    const { container } = renderWall({ rule: rule({ mode: "paid" }) });
    await screen.findByText("Pro miesięczny");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("Paywall czytelnika - pomiar (P18, AD-16)", () => {
  it("konto: record_paywall_hit z powodem i warstwą; paywall_view przy zgodzie", async () => {
    h.session = { user: { id: "u1" } };
    h.currentTier = { key: "plus", rank: 1 };
    renderWall({ rule: rule({ mode: "members", min_tier_rank: 2 }) });
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("record_paywall_hit", {
        p_entity_type: "post",
        p_entity_id: ENTITY,
        p_reason: "tier_rank",
        p_required_tier_key: "pro",
        p_variant: "default",
      }),
    );
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({ type: "paywall_view", name: "paywall_view", entityId: ENTITY }),
    );
    fireEvent.click(await screen.findByRole("link", { name: k("paywall.offer.upgrade") }));
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "paywall_cta_click",
        meta: expect.objectContaining({ cta: "upgrade", plan: PRO_M.id }),
      }),
    );
  });

  it("gość: uderzenie przez server fn, z powodem z licznika", async () => {
    // Gość bez puli (anon_monthly_limit = 0) dostaje ścianę rejestracji.
    renderWall({ rule: rule({ mode: "paid" }), meter: true });
    await waitFor(() =>
      expect(h.visitorHit).toHaveBeenCalledWith({
        data: {
          entityType: "post",
          entityId: ENTITY,
          reason: "registration",
          requiredTierKey: null,
          variant: "register",
        },
      }),
    );
    expect(h.rpc).not.toHaveBeenCalledWith("record_paywall_hit", expect.anything());
  });

  it("bez zgody analitycznej: zero zdarzeń klienta, licznik serwera działa", async () => {
    h.consent = false;
    h.session = { user: { id: "u1" } };
    renderWall({ rule: rule({ mode: "paid" }) });
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("record_paywall_hit", expect.anything()),
    );
    fireEvent.click((await screen.findAllByRole("link", { name: k("paywall.subscribe") }))[0]);
    expect(h.track).not.toHaveBeenCalled();
  });

  it("błąd RPC pomiaru nie psuje ściany", async () => {
    h.session = { user: { id: "u1" } };
    h.rpc.mockRejectedValue(new Error("boom"));
    renderWall({ rule: rule({ mode: "paid" }) });
    expect((await screen.findAllByRole("link", { name: k("paywall.subscribe") })).length).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uderzenie liczone raz na wpis, nie przy każdym renderze", async () => {
    h.session = { user: { id: "u1" } };
    const view = renderWall({ rule: rule({ mode: "paid" }) });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    view.rerender(<Paywall rule={rule({ mode: "paid" })} lang="pl" fallbackText={null} />);
    await screen.findAllByRole("link", { name: k("paywall.subscribe") });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("Paywall czytelnika - tryb preview (symulator S7)", () => {
  const persona = (viewer: Partial<PaywallViewer>): PaywallPreview => ({
    viewer: { signedIn: false, tierRank: 0, ...viewer },
  });

  it("persona zamiast sesji, bez consume_metered_view, record_paywall_hit i track", async () => {
    h.session = { user: { id: "admin" } };
    renderWall({
      rule: rule({ mode: "members", min_tier_rank: 2 }),
      preview: persona({ signedIn: true, tierRank: 1, tierKey: "plus" }),
    });
    const upgrade = await screen.findByRole("link", { name: k("paywall.offer.upgrade") });
    expect(upgrade).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(upgrade);
    // Odczyt sesji admina nie wpływa na personę: brak RPC warstwy/organizacji.
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.visitorHit).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("checkout:returnTo")).toBeNull();
  });

  it("gość w podglądzie: martwe linki logowania, zero pomiaru", async () => {
    renderWall({ rule: rule({ mode: "paid" }), preview: persona({}) });
    await screen.findByText("Pro miesięczny");
    const wall = screen.getByRole("heading", { name: k("paywall.paidOnly") }).parentElement;
    for (const link of within(wall as HTMLElement).getAllByRole("link")) {
      expect(link).toHaveAttribute("aria-disabled", "true");
    }
    expect(h.visitorHit).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });
});
