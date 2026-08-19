// Karta warstwy na stronie cennika - 0 z 6 funkcji pokrytych do 18.08.2026.
//
// To jedyny ekran, na którym klient NIEZALOGOWANY podejmuje decyzję o zakupie.
// Model decyzyjny (co w miejscu ceny, który przycisk) ma własne testy
// jednostkowe; tu sprawdzamy, że karta faktycznie POKAZUJE to, co model mówi -
// z właściwym adresem checkoutu, właściwą kwotą i właściwym zdarzeniem
// analitycznym, bo to ono mierzy, ile ta strona sprzedaje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { accessPlan, moneyPattern } from "@/test/billing/fixtures";
import { membershipTier, reactI18nextStub } from "@/test/admin/pricingFixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";

let lang = "pl";
const trackCta = vi.fn();

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/lib/analytics/track", () => ({ trackCta: (...args: unknown[]) => trackCta(...args) }));

const { TierCard } = await import("@/components/pricing/organisms/TierCard");

const monthly = accessPlan({
  id: "plan-month",
  interval: "month",
  price_cents: 4900,
  currency: "PLN",
});
const yearly = accessPlan({
  id: "plan-year",
  interval: "year",
  price_cents: 49000,
  currency: "PLN",
});

function renderCard(overrides: Partial<Parameters<typeof TierCard>[0]> = {}) {
  const onContact = vi.fn();
  render(
    <TierCard
      tier={membershipTier()}
      plans={[monthly]}
      interval="month"
      lang={lang}
      isCurrentTier={false}
      currentPlanId={null}
      isAuthenticated={false}
      onContact={onContact}
      {...overrides}
    />,
  );
  return { onContact };
}

beforeEach(() => {
  lang = "pl";
  trackCta.mockClear();
});

describe("TierCard - nazwa i opis warstwy", () => {
  it("nazwa warstwy jest nagłówkiem, nie zwykłym tekstem", () => {
    renderCard({ tier: membershipTier({ name_pl: "Członek" }) });

    expect(screen.getByRole("heading", { name: "Członek" })).toBeInTheDocument();
  });

  it("po angielsku pokazuje nazwę i opis angielski", () => {
    lang = "en";
    renderCard({
      tier: membershipTier({
        name_pl: "Członek",
        name_en: "Member",
        description_pl: "Opis",
        description_en: "Description",
      }),
      lang: "en",
    });

    expect(screen.getByRole("heading", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("badge redakcyjny pokazuje się przy nazwie", () => {
    renderCard({ tier: membershipTier({ badge_pl: "Najpopularniejszy" }) });

    expect(screen.getByText("Najpopularniejszy")).toBeInTheDocument();
  });

  it("WYRÓŻNIONA warstwa bez badge'a dostaje domyślne „popularne”", () => {
    renderCard({ tier: membershipTier({ highlight: true, badge_pl: null, badge_en: null }) });

    expect(screen.getByText("pricing.popular")).toBeInTheDocument();
  });

  it("OBECNA warstwa jest oznaczona własnym znacznikiem", () => {
    renderCard({ isCurrentTier: true, tier: membershipTier({ highlight: false }) });

    expect(screen.getByText("pricing.tiers.current")).toBeInTheDocument();
  });
});

describe("TierCard - CENA, którą widzi klient", () => {
  it("pokazuje kwotę planu i sufiks okresu", () => {
    renderCard({ plans: [monthly] });

    expect(screen.getByText(moneyPattern(4900))).toBeInTheDocument();
    expect(screen.getByText(/pricing\.perMonth/)).toBeInTheDocument();
  });

  it("plan roczny pokazuje kwotę ROCZNĄ i realny procent oszczędności", () => {
    renderCard({ plans: [monthly, yearly], interval: "year" });

    expect(screen.getByText(moneyPattern(49000))).toBeInTheDocument();
    expect(screen.getByText(/pricing\.savePct/)).toBeInTheDocument();
  });

  it("warstwa DOMYŚLNA pokazuje „bezpłatnie”, a nie kwotę", () => {
    renderCard({ tier: membershipTier({ is_default: true }), plans: [monthly] });

    expect(screen.getByText("pricing.free")).toBeInTheDocument();
    expect(screen.queryByText(moneyPattern(4900))).not.toBeInTheDocument();
  });

  it("warstwa bez planu pokazuje ofertę NA ZAPYTANIE", () => {
    renderCard({ plans: [] });

    expect(screen.getByText("pricing.onRequest")).toBeInTheDocument();
  });

  it("warstwa „tylko na zaproszenie” pokazuje to wprost", () => {
    renderCard({ tier: membershipTier({ cta_mode: "none" }), plans: [] });

    expect(screen.getByText("pricing.invitationOnly")).toBeInTheDocument();
    expect(screen.queryByText("pricing.onRequest")).not.toBeInTheDocument();
  });

  it("plan ZA MIEJSCE pokazuje „od” przed kwotą", () => {
    renderCard({ tier: membershipTier({ per_seat: true }), plans: [monthly] });

    expect(screen.getByText("pricing.fromPrefix")).toBeInTheDocument();
    expect(screen.getByText(/pricing\.perSeat/)).toBeInTheDocument();
  });

  it("nota cenowa redakcji pokazuje się pod kwotą", () => {
    renderCard({ tier: membershipTier({ price_note_pl: "2-20 miejsc" }), plans: [monthly] });

    expect(screen.getByText("2-20 miejsc")).toBeInTheDocument();
  });

  it("OKRES PRÓBNY planu jest ogłoszony z liczbą dni", () => {
    renderCard({ plans: [accessPlan({ id: "p", interval: "month", trial_days: 14 })] });

    expect(screen.getByText(/pricing\.trial/)).toHaveTextContent('"days":14');
  });

  it("plan bez okresu próbnego nie pokazuje pustej obietnicy", () => {
    renderCard({ plans: [accessPlan({ id: "p", interval: "month", trial_days: 0 })] });

    expect(screen.queryByText(/pricing\.trial/)).not.toBeInTheDocument();
  });
});

describe("TierCard - PRZYCISK ZAKUPU", () => {
  it("plan w sprzedaży prowadzi do checkoutu TEGO planu", () => {
    renderCard({ plans: [monthly] });

    expect(screen.getByRole("link", { name: "pricing.choose" })).toHaveAttribute(
      "href",
      "/checkout/plan-month",
    );
  });

  it("obok checkoutu jest skrót do szczegółów planu", () => {
    renderCard({ plans: [monthly] });

    expect(screen.getByRole("link", { name: "pricing.planDetails.cta" })).toHaveAttribute(
      "href",
      "/plans/plan-month",
    );
  });

  it("kliknięcie checkoutu zgłasza zdarzenie z KWOTĄ i planem", () => {
    // To zdarzenie mierzy, ile ta strona sprzedaje - bez kwoty i identyfikatora
    // planu raport jest bezużyteczny.
    renderCard({ plans: [monthly] });

    fireEvent.click(screen.getByRole("link", { name: "pricing.choose" }));

    expect(trackCta).toHaveBeenCalledWith(
      "pricing_checkout_click",
      expect.objectContaining({ plan_id: "plan-month", amount_cents: 4900, currency: "PLN" }),
    );
  });

  it("przełącznik na rok prowadzi do checkoutu planu ROCZNEGO", () => {
    renderCard({ plans: [monthly, yearly], interval: "year" });

    expect(screen.getByRole("link", { name: "pricing.choose" })).toHaveAttribute(
      "href",
      "/checkout/plan-year",
    );
  });

  it("TEN SAM plan, który klient ma, jest WYŁĄCZONY", () => {
    renderCard({ plans: [monthly], currentPlanId: "plan-month" });

    expect(screen.getByRole("button", { name: "pricing.current" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "pricing.choose" })).not.toBeInTheDocument();
  });

  it("warstwa domyślna dla niezalogowanego prowadzi do REJESTRACJI", () => {
    renderCard({ tier: membershipTier({ is_default: true }), isAuthenticated: false });

    expect(screen.getByRole("link", { name: "pricing.signupCta" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("kliknięcie rejestracji zgłasza własne zdarzenie", () => {
    renderCard({ tier: membershipTier({ is_default: true }), isAuthenticated: false });

    fireEvent.click(screen.getByRole("link", { name: "pricing.signupCta" }));

    expect(trackCta).toHaveBeenCalledWith("pricing_signup_click", expect.any(Object));
  });

  it("warstwa domyślna dla zalogowanego NIE MA przycisku", () => {
    renderCard({ tier: membershipTier({ is_default: true }), isAuthenticated: true });

    expect(screen.queryByRole("link", { name: "pricing.signupCta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("warstwa „tylko na zaproszenie” nie ma ŻADNEGO przycisku", () => {
    renderCard({ tier: membershipTier({ cta_mode: "none" }), plans: [monthly] });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("tryb „kontakt” otwiera okno rozmowy z TĄ warstwą", () => {
    const tier = membershipTier({ cta_mode: "contact", contact_url: null });
    const { onContact } = renderCard({ tier, plans: [monthly] });

    fireEvent.click(screen.getByRole("button", { name: /pricing\.contactCta/ }));

    expect(onContact).toHaveBeenCalledWith(tier);
    expect(trackCta).toHaveBeenCalledWith(
      "pricing_contact_click",
      expect.objectContaining({ target: "dialog" }),
    );
  });

  it("tryb „kontakt” z adresem redakcji prowadzi TYM adresem", () => {
    renderCard({
      tier: membershipTier({ cta_mode: "contact", contact_url: "mailto:sprzedaz@example.test" }),
    });

    expect(screen.getByRole("link", { name: /pricing\.contactCta/ })).toHaveAttribute(
      "href",
      "mailto:sprzedaz@example.test",
    );
  });

  it("kliknięcie kontaktu zewnętrznego zgłasza cel „external”", () => {
    renderCard({ tier: membershipTier({ cta_mode: "contact", contact_url: "/kontakt" }) });

    fireEvent.click(screen.getByRole("link", { name: /pricing\.contactCta/ }));

    expect(trackCta).toHaveBeenCalledWith(
      "pricing_contact_click",
      expect.objectContaining({ target: "external" }),
    );
  });

  it("warstwa WSPIERAJĄCA bez planu prowadzi do darowizny", () => {
    renderCard({ tier: membershipTier({ key: "supporter" }), plans: [] });

    expect(screen.getByRole("link", { name: /pricing\.tiers\.supporterCta/ })).toHaveAttribute(
      "href",
      "/support",
    );
  });

  it("obecna warstwa bez planu pokazuje wyłączone „obecna warstwa”", () => {
    renderCard({ plans: [], isCurrentTier: true });

    expect(screen.getByRole("button", { name: "pricing.currentTier" })).toBeDisabled();
  });
});

describe("TierCard - BENEFITY", () => {
  it("spotlight „co wyróżnia” pokazuje się nad pełną listą", () => {
    renderCard({
      tier: membershipTier({
        benefits: [
          { pl: "Poranny briefing", en: "Morning briefing" },
          { pl: "Klub dyskusyjny", en: "Discussion club" },
        ],
      }),
      highlights: [{ pl: "Klub dyskusyjny", en: "Discussion club" }],
    });

    expect(screen.getByText("pricing.highlightsHeading")).toBeInTheDocument();
    expect(screen.getByText("Klub dyskusyjny")).toBeInTheDocument();
  });

  it("benefit ze spotlightu NIE POWTARZA się na pełnej liście", () => {
    renderCard({
      tier: membershipTier({
        benefits: [
          { pl: "Poranny briefing", en: "Morning briefing" },
          { pl: "Klub dyskusyjny", en: "Discussion club" },
        ],
      }),
      highlights: [{ pl: "Klub dyskusyjny", en: "Discussion club" }],
    });

    expect(screen.getAllByText("Klub dyskusyjny")).toHaveLength(1);
    expect(screen.getByText("Poranny briefing")).toBeInTheDocument();
  });

  it("bez spotlightu karta nie pokazuje pustego nagłówka wyróżnień", () => {
    renderCard({ highlights: [] });

    expect(screen.queryByText("pricing.highlightsHeading")).not.toBeInTheDocument();
  });
});
