// Pozostałe powierzchnie cennika: lista benefitów, pasek wspierających, FAQ,
// macierz porównania i okno „porozmawiajmy" - 0 z 12 funkcji pokrytych
// do 18.08.2026.
//
// Trzy rzeczy pilnowane tu twardo:
//   FAQ emituje schema.org FAQPage - to on decyduje o widoczności cennika
//   w wyszukiwarce, a błąd w JSON-LD jest niewidoczny na ekranie.
//   Macierz porównania pokazuje FAKTYCZNY zakres dostępu z `tier.features`,
//   nie tabelę życzeń: kolumna bez pokrycia w segmencie nie może się pojawić.
//   Okno kontaktu nie wysyła zgłoszenia bez ZGODY i bez poprawnego adresu -
//   to jedyna ścieżka zakupu dla ofert bez checkoutu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  membershipTier,
  pricingFaqItem,
  reactI18nextStub,
  translateKey,
} from "@/test/admin/pricingFixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";

let lang = "pl";
const submitContact = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

// Macierz porównania czyta WIERSZE ze słownika przez `returnObjects` - zwykłe
// echo klucza nie wystarcza, bo komponent sprawdza `Array.isArray`. Atrapa
// oddaje trzy wiersze w trzech wariantach, jakie macierz obsługuje: flaga
// z `features`, wartość redakcyjna per warstwa i limit wyliczany z danych.
const MATRIX_ROWS = [
  { id: "briefings", label: "Briefingi", feature: "briefings" },
  { id: "articles", label: "Artykuły", values: { reader: "5", member: "check", pro: "check" } },
  { id: "expert", label: "Ekspert", derive: "expertRequest" },
];

vi.mock("react-i18next", () => {
  const base = reactI18nextStub(() => lang);
  const withRows = (key: string, options?: Record<string, unknown>) =>
    key === "pricing.comparisonMatrix.rows" && options?.returnObjects
      ? (MATRIX_ROWS as never)
      : translateKey(key, options);
  return {
    ...base,
    useTranslation: () => ({ t: withRows, i18n: { language: lang, t: withRows } }),
  };
});
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => submitContact }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: vi.fn() }));

const { TierBenefitList } = await import("@/components/pricing/atoms/TierBenefitList");
const { SupporterStrip } = await import("@/components/pricing/molecules/SupporterStrip");
const { PricingFaq } = await import("@/components/pricing/organisms/PricingFaq");
const { PricingComparisonMatrix } =
  await import("@/components/pricing/organisms/PricingComparisonMatrix");
const { ContactSalesDialog } = await import("@/components/pricing/organisms/ContactSalesDialog");

beforeEach(() => {
  lang = "pl";
  submitContact.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("TierBenefitList - obietnice warstwy", () => {
  it("pokazuje benefity w języku strony", () => {
    render(
      <TierBenefitList benefits={[{ pl: "Poranny briefing", en: "Morning briefing" }]} lang="pl" />,
    );

    expect(screen.getByText("Poranny briefing")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("po angielsku pokazuje wersję angielską", () => {
    render(
      <TierBenefitList benefits={[{ pl: "Poranny briefing", en: "Morning briefing" }]} lang="en" />,
    );

    expect(screen.getByText("Morning briefing")).toBeInTheDocument();
    expect(screen.queryByText("Poranny briefing")).not.toBeInTheDocument();
  });

  it("rozwinięcie benefitu pokazuje się pod nim", () => {
    render(
      <TierBenefitList
        benefits={[{ pl: "Briefing", en: "Briefing", detail_pl: "Codziennie o 7:00" }]}
        lang="pl"
      />,
    );

    expect(screen.getByText("Codziennie o 7:00")).toBeInTheDocument();
  });

  it("pusta lista nie renderuje pustego kontenera", () => {
    const { container } = render(<TierBenefitList benefits={[]} lang="pl" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("SupporterStrip - wsparcie misji poza drabinką cen", () => {
  it("pokazuje nazwę i opis warstwy oraz prowadzi do wsparcia", () => {
    render(
      <SupporterStrip
        tier={membershipTier({ key: "supporter", name_pl: "Wspierający", description_pl: "Opis" })}
        lang="pl"
      />,
    );

    expect(screen.getByText("Wspierający")).toBeInTheDocument();
    expect(screen.getByText("Opis")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/support");
  });

  it("warstwa bez opisu dostaje domyślne zdanie ze słownika", () => {
    render(
      <SupporterStrip
        tier={membershipTier({ key: "supporter", description_pl: null, description_en: null })}
        lang="pl"
      />,
    );

    expect(screen.getByText("pricing.supporterStrip.body")).toBeInTheDocument();
  });
});

describe("PricingFaq - pytania klienta i widoczność w wyszukiwarce", () => {
  it("pokazuje pytania jako listę rozwijaną z tytułem sekcji", () => {
    render(<PricingFaq items={[pricingFaqItem()]} lang="pl" title="Pytania" />);

    expect(screen.getByRole("heading", { name: "Pytania" })).toBeInTheDocument();
    expect(screen.getByText("Czy mogę zrezygnować w każdej chwili?")).toBeInTheDocument();
  });

  it("emituje schema.org FAQPage z pytaniem I odpowiedzią", () => {
    // Błąd w tym JSON-LD jest niewidoczny na ekranie, a kosztuje widoczność
    // cennika w wynikach wyszukiwania.
    const { container } = render(
      <PricingFaq items={[pricingFaqItem()]} lang="pl" title="Pytania" />,
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.innerHTML);
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "Czy mogę zrezygnować w każdej chwili?",
    });
  });

  it("dane strukturalne idą w JĘZYKU STRONY", () => {
    const { container } = render(
      <PricingFaq items={[pricingFaqItem()]} lang="en" title="Questions" />,
    );

    const data = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    );
    expect(data.mainEntity[0].name).toBe("Can I cancel at any time?");
    expect(data.mainEntity[0].acceptedAnswer.text).toContain("paid period");
  });

  it("brak pytań nie renderuje sekcji ani pustych danych strukturalnych", () => {
    const { container } = render(<PricingFaq items={[]} lang="pl" title="Pytania" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("PricingComparisonMatrix - FAKTYCZNY zakres dostępu", () => {
  const reader = membershipTier({
    id: "t-reader",
    key: "reader",
    name_pl: "Czytelnik",
    features: {},
  });
  const member = membershipTier({
    id: "t-member",
    key: "member",
    name_pl: "Członek",
    features: { briefings: true },
  });

  it("kolumnami są WYŁĄCZNIE warstwy przekazane w segmencie", () => {
    render(<PricingComparisonMatrix tiers={[reader, member]} lang="pl" currentTierKey={null} />);

    expect(screen.getByText("Czytelnik")).toBeInTheDocument();
    expect(screen.getByText("Członek")).toBeInTheDocument();
    expect(screen.queryByText("VIP")).not.toBeInTheDocument();
  });

  it("kolumna planu klienta jest oznaczona", () => {
    render(<PricingComparisonMatrix tiers={[reader, member]} lang="pl" currentTierKey="member" />);

    expect(screen.getByText(/comparisonMatrix\.yourPlan/)).toBeInTheDocument();
  });

  it("bez warstw macierz się nie renderuje", () => {
    const { container } = render(
      <PricingComparisonMatrix tiers={[]} lang="pl" currentTierKey={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("JEDNA warstwa też nie renderuje macierzy - nie ma czego porównywać", () => {
    const { container } = render(
      <PricingComparisonMatrix tiers={[member]} lang="pl" currentTierKey={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("warstwa o kluczu POZA katalogiem nie tworzy kolumny", () => {
    // Klucz dopisany ręcznie w SQL nie może wstawić kolumny bez wierszy.
    const unknown = membershipTier({ id: "t-x", key: "wymyslona", name_pl: "Wymyślona" });

    const { container } = render(
      <PricingComparisonMatrix tiers={[member, unknown]} lang="pl" currentTierKey={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("LIMIT zapytań do eksperta wynika z realnej liczby w warstwie", () => {
    const withQuota = membershipTier({
      id: "t-pro",
      key: "pro",
      name_pl: "Pro",
      features: { expert_request_quota: 3 },
    });

    // Macierz z jedną kolumną nie ma czego porównywać - stąd druga warstwa.
    render(<PricingComparisonMatrix tiers={[reader, withQuota]} lang="pl" currentTierKey={null} />);

    expect(screen.getByText(/comparisonMatrix\.perMonth/)).toHaveTextContent('"n":3');
  });

  it("warstwa z pisaniem BEZPOŚREDNIM pokazuje to zamiast liczby", () => {
    const direct = membershipTier({
      id: "t-vip",
      key: "vip",
      name_pl: "VIP",
      features: { chat_direct_gated: true },
    });

    render(<PricingComparisonMatrix tiers={[reader, direct]} lang="pl" currentTierKey={null} />);

    expect(screen.getByText("pricing.comparisonMatrix.expertRequestDirect")).toBeInTheDocument();
  });
});

describe("ContactSalesDialog - jedyna ścieżka zakupu ofert bez checkoutu", () => {
  function renderDialog(tier = membershipTier({ name_pl: "Korporacyjny" })) {
    const onOpenChange = vi.fn();
    render(<ContactSalesDialog open onOpenChange={onOpenChange} tier={tier} lang="pl" />);
    return { onOpenChange };
  }

  /** Wypełnia formularz zgłoszenia. */
  function fill(values: { name?: string; email?: string; message?: string; consent?: boolean }) {
    if (values.name !== undefined)
      fireEvent.change(screen.getByLabelText("pricing.contactDialog.name"), {
        target: { value: values.name },
      });
    if (values.email !== undefined)
      fireEvent.change(screen.getByLabelText("pricing.contactDialog.email"), {
        target: { value: values.email },
      });
    if (values.message !== undefined)
      fireEvent.change(screen.getByLabelText("pricing.contactDialog.message"), {
        target: { value: values.message },
      });
    if (values.consent) fireEvent.click(screen.getByRole("checkbox"));
  }

  it("temat zgłoszenia nosi NAZWĘ warstwy, o którą pyta klient", () => {
    renderDialog();

    expect(screen.getByText(/contactDialog\.subject/)).toHaveTextContent("Korporacyjny");
  });

  it("bez warstwy temat jest ogólny, a okno nadal działa", () => {
    render(<ContactSalesDialog open onOpenChange={vi.fn()} tier={null} lang="pl" />);

    expect(screen.getByText("pricing.contactDialog.subjectGeneric")).toBeInTheDocument();
  });

  it("wszystkie pola mają dostępne nazwy", () => {
    renderDialog();

    expect(screen.getByLabelText("pricing.contactDialog.name")).toBeInTheDocument();
    expect(screen.getByLabelText("pricing.contactDialog.company")).toBeInTheDocument();
  });

  it("wysyłka jest zablokowana BEZ ZGODY na kontakt", () => {
    // Zgłoszenie bez zgody byłoby przetwarzaniem danych bez podstawy.
    renderDialog();

    fill({ name: "Jan Testowy", email: "jan@example.test", message: "Proszę o ofertę" });

    expect(screen.getByRole("button", { name: /contactDialog\.submit/ })).toBeDisabled();
  });

  it("wysyłka jest zablokowana przy adresie bez domeny", () => {
    renderDialog();

    fill({
      name: "Jan Testowy",
      email: "jan@localhost",
      message: "Proszę o ofertę",
      consent: true,
    });

    expect(screen.getByRole("button", { name: /contactDialog\.submit/ })).toBeDisabled();
  });

  it("komplet danych ze zgodą odblokowuje wysyłkę", () => {
    renderDialog();

    fill({
      name: "Jan Testowy",
      email: "jan@example.test",
      message: "Proszę o ofertę",
      consent: true,
    });

    expect(screen.getByRole("button", { name: /contactDialog\.submit/ })).toBeEnabled();
  });

  it("zgłoszenie idzie ISTNIEJĄCĄ ścieżką kontaktu, z identyfikatorem źródła", async () => {
    renderDialog();
    fill({
      name: "  Jan Testowy  ",
      email: " jan@example.test ",
      message: "  Proszę o ofertę  ",
      consent: true,
    });

    fireEvent.submit(
      screen.getByRole("button", { name: /contactDialog\.submit/ }).closest("form")!,
    );

    await waitFor(() => expect(submitContact).toHaveBeenCalledTimes(1));
    expect(submitContact.mock.calls[0][0].data).toMatchObject({
      name: "Jan Testowy",
      email: "jan@example.test",
      message: "Proszę o ofertę",
      consent: true,
      source: "pricing",
      formId: "pricing-contact-sales",
      lang: "pl",
    });
  });

  it("udana wysyłka potwierdza komunikatem i ZAMYKA okno", async () => {
    const { onOpenChange } = renderDialog();
    fill({
      name: "Jan Testowy",
      email: "jan@example.test",
      message: "Proszę o ofertę",
      consent: true,
    });

    fireEvent.submit(
      screen.getByRole("button", { name: /contactDialog\.submit/ }).closest("form")!,
    );

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("pricing.contactDialog.success"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("NIEUDANA wysyłka zgłasza błąd, NIE zamyka okna i NIE gubi wpisanego tekstu", async () => {
    // Klient, który pisze do sprzedaży, nie może stracić treści zgłoszenia.
    submitContact.mockRejectedValue(new Error("network"));
    const { onOpenChange } = renderDialog();
    fill({
      name: "Jan Testowy",
      email: "jan@example.test",
      message: "Proszę o ofertę",
      consent: true,
    });

    fireEvent.submit(
      screen.getByRole("button", { name: /contactDialog\.submit/ }).closest("form")!,
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("pricing.contactDialog.error"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("pricing.contactDialog.message")).toHaveValue("Proszę o ofertę");
  });

  it("wersja angielska zgłasza język `en` (auto-odpowiedź musi trafić w język)", async () => {
    lang = "en";
    render(<ContactSalesDialog open onOpenChange={vi.fn()} tier={membershipTier()} lang="en" />);
    fill({
      name: "John Test",
      email: "john@example.test",
      message: "Quote please",
      consent: true,
    });

    fireEvent.submit(
      screen.getByRole("button", { name: /contactDialog\.submit/ }).closest("form")!,
    );

    await waitFor(() => expect(submitContact).toHaveBeenCalledTimes(1));
    expect(submitContact.mock.calls[0][0].data.lang).toBe("en");
  });
});
