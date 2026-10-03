// Karta planu dla oferty WYCENIANEJ INDYWIDUALNIE (Decision Lab) oraz karta
// planu bez żadnej listy benefitów.
//
// RYZYKO. Decision Lab nie ma publicznej ceny ani samoobsługowego checkoutu:
// zakres cyklu, liczba miejsc i zobowiązania raportowe są negocjowane. Karta,
// która pokaże kwotę z `price_cents` (wartość techniczna w katalogu) albo
// przycisk „Wybieram" prowadzący do checkoutu, sprzedaje ofertę po cenie,
// której nikt nie zatwierdził. Jedyną ścieżką jest okno kontaktu - i ono musi
// wiedzieć, o JAKI plan pyta klient (bez warstwy temat byłby ogólny, a dział
// sprzedaży nie wiedziałby, czego dotyczy lead).
//
// Atrapowane są wyłącznie granice: słownik (echo klucza), `Link` routera,
// funkcja serwerowa Contact Center (`useServerFn`) i toasty. Reguła ofert
// zgłoszeniowych (`isEnquiryOnlyPlan`) i okno kontaktu biegną prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { accessPlan, moneyPattern } from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
// Częściowa atrapa: `createIsomorphicFn` (rdzeń i18n, wciągany przez słowniki
// karty) zostaje prawdziwy, podmieniona jest tylko granica funkcji serwerowej.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.submit,
}));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PlanCard } from "@/components/billing/molecules/PlanCard";

const DECISION_LAB = accessPlan({
  id: "plan-decision-lab",
  tier_key: "decision_lab",
  name_pl: "Decision Lab",
  name_en: "Decision Lab",
  price_cents: 1_500_000,
  interval: "year",
  features_pl: ["Warsztat strategiczny"],
  features_en: ["Strategy workshop"],
});

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue(undefined);
});

describe("PlanCard - oferta wyceniana indywidualnie", () => {
  it("NIE ujawnia kwoty ani cyklu - zamiast ceny jest zapowiedź wyceny", () => {
    const { container } = render(<PlanCard plan={DECISION_LAB} />);

    expect(screen.getByText("pricing.enquiry.price")).toBeInTheDocument();
    expect(screen.getByText("pricing.enquiry.note")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(moneyPattern(1_500_000));
    expect(screen.queryByText("pricing.perYear")).not.toBeInTheDocument();
  });

  it("NIE prowadzi do checkoutu - jedyną akcją zakupu jest zgłoszenie", () => {
    render(<PlanCard plan={DECISION_LAB} />);

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/checkout/plan-decision-lab");
    expect(screen.queryByText("pricing.choose")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pricing.enquiry.cta" })).toBeEnabled();
  });

  it("szczegóły planu zostają dostępne pod jego własnym adresem", () => {
    render(<PlanCard plan={DECISION_LAB} />);

    expect(screen.getByRole("link", { name: "pricing.planDetails.cta" })).toHaveAttribute(
      "href",
      "/plans/plan-decision-lab",
    );
  });

  it("zgłoszenie otwiera okno kontaktu z NAZWĄ planu w temacie", async () => {
    render(<PlanCard plan={DECISION_LAB} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "pricing.enquiry.cta" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/contactDialog\.subject/)).toHaveTextContent("Decision Lab");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("klient, który JUŻ ma ten plan, nie dostaje przycisku zgłoszenia", () => {
    render(<PlanCard plan={DECISION_LAB} isCurrent />);

    expect(screen.getByRole("button", { name: "pricing.current" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "pricing.enquiry.cta" })).not.toBeInTheDocument();
  });

  it("NIE ogłasza okresu próbnego - zgłoszenie nie uruchamia żadnego triala", () => {
    // Ta sama reguła co na stronie planu (`plans.$planId.tsx`): darmowe dni bez
    // checkoutu to obietnica handlowa, której nikt nie spełni. Cykl roczny jest
    // tu celowy - dowodzi strażnika ZGŁOSZENIA niezależnie od strażnika planu
    // jednorazowego (test niżej).
    render(<PlanCard plan={{ ...DECISION_LAB, trial_days: 14 }} />);

    expect(screen.getByText("pricing.enquiry.price")).toBeInTheDocument();
    expect(screen.queryByText(/^pricing\.trial/)).not.toBeInTheDocument();
  });

  it("wyróżniony plan zgłoszeniowy ma przycisk w TYM SAMYM stylu co wyróżniony checkout", () => {
    const { unmount } = render(<PlanCard plan={{ ...DECISION_LAB, highlighted: true }} />);
    const enquiryHighlighted = screen.getByRole("button", {
      name: "pricing.enquiry.cta",
    }).className;
    unmount();

    const { unmount: unmountRegular } = render(<PlanCard plan={DECISION_LAB} />);
    const enquiryRegular = screen.getByRole("button", { name: "pricing.enquiry.cta" }).className;
    unmountRegular();

    render(<PlanCard plan={accessPlan({ id: "plan-hl", highlighted: true })} />);
    const checkoutHighlighted = screen.getByRole("link", { name: "pricing.choose" }).className;

    expect(enquiryHighlighted).toBe(checkoutHighlighted);
    expect(enquiryRegular).not.toBe(enquiryHighlighted);
  });
});

describe("PlanCard - okres próbny planu jednorazowego", () => {
  it("przepustka jednorazowa NIE obiecuje darmowych dni, których checkout nie przyzna", () => {
    // `createCheckoutOrder` liczy trial wyłącznie dla `kind: "subscription"`,
    // a checkout planu `one_time` to płatność - więc `trial_days` takiego planu
    // nie ma pokrycia. Strona checkoutu i paywall mają ten sam strażnik.
    render(
      <PlanCard plan={accessPlan({ id: "plan-pass", interval: "one_time", trial_days: 14 })} />,
    );

    expect(screen.getByRole("link", { name: "pricing.choose" })).toHaveAttribute(
      "href",
      "/checkout/plan-pass",
    );
    expect(screen.queryByText(/^pricing\.trial/)).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: subskrypcja z okresem próbnym dalej go ogłasza", () => {
    // Bez tej pary testy wyżej przechodziłyby także wtedy, gdyby karta nie
    // pokazywała okresu próbnego NIGDY.
    render(<PlanCard plan={accessPlan({ interval: "month", trial_days: 14 })} />);

    expect(screen.getByText('pricing.trial {"count":14}')).toBeInTheDocument();
  });
});

describe("PlanCard - plan bez benefitów", () => {
  it("plan bez własnych benefitów i bez benefitów warstwy nie rysuje pustych punktów", () => {
    render(<PlanCard plan={accessPlan({ features_pl: [], features_en: [] })} />);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "pricing.choose" })).toHaveAttribute(
      "href",
      "/checkout/plan-member-monthly",
    );
  });
});
