// Kontrakt atomów rozliczeniowych - bramka po scaleniu duplikatów.
//
// Cztery atomy powstały ze scalenia kopii rozsianych po `components/billing`:
// znacznik stanu (trzy kopie z RÓŻNYMI zestawami stanów „czerwonych"), pusta
// lista (trzy kopie), kwota i data (osiem kopii formatowania daty, żadna bez
// zabezpieczenia przed wartością niepoprawną).
//
// Kontrakt każdego z nich dotyczy tego, co klient MOŻE ODCZYTAĆ ze strony,
// na której sprawdza, czy zapłacił - i co ze zrzutu tej strony odczyta wsparcie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { reactI18nextStub, translateKey } from "@/test/billing/fixtures";

let lang = "pl";

/**
 * Wspólna atrapa i18n świadomie POMIJA `defaultValue`, żeby testy asertowały
 * KLUCZE, nie polskie copy. Zapas jest jednak zachowaniem widocznym dla klienta
 * (stan dołożony przez operatora musi być czytelny), więc dwa przypadki niżej
 * potrzebują atrapy zachowującej się jak PRAWDZIWY i18next przy BRAKUJĄCYM
 * kluczu: zwraca `defaultValue`. Przełącznik jest domyślnie wyłączony, żeby
 * pozostałe asercje na klucze działały bez zmian.
 */
let missingKeys = false;

vi.mock("react-i18next", () => {
  const base = reactI18nextStub(() => lang);
  const t = (key: string, options?: Record<string, unknown>): string => {
    if (missingKeys && typeof options?.defaultValue === "string") return options.defaultValue;
    return translateKey(key, options);
  };
  return {
    ...base,
    useTranslation: () => ({ t, i18n: { language: lang, t } }),
  };
});

beforeEach(() => {
  lang = "pl";
  missingKeys = false;
});

const { PaymentStatusBadge } = await import("@/components/billing/atoms/PaymentStatusBadge");
const { BillingEmptyState } = await import("@/components/billing/atoms/BillingEmptyState");
const { MoneyText } = await import("@/components/billing/atoms/MoneyText");
const { BillingDate } = await import("@/components/billing/atoms/BillingDate");

describe("PaymentStatusBadge - kolor NIE jest jedynym nośnikiem informacji", () => {
  it("znacznik zawsze niesie TEKST stanu, nie tylko barwę", () => {
    render(<PaymentStatusBadge status="paid" />);

    expect(screen.getByText("profile.status.paid")).toBeInTheDocument();
  });

  it("surowy stan z bazy zostaje w `data-status` - wsparcie musi go odczytać", () => {
    render(<PaymentStatusBadge status="processing" />);

    expect(screen.getByText("profile.status.processing")).toHaveAttribute(
      "data-status",
      "processing",
    );
  });

  it("NIEZNANY stan pokazuje SUROWĄ wartość operatora, nie klucz słownika", () => {
    // Regresja wychwycona w przeglądzie PR #261. Poprzedni renderer historii
    // wołał `t(klucz, { defaultValue: status })`; atom początkowo tego zapasu
    // nie miał, więc stan dołożony przez operatora (`disputed`,
    // `requires_action`) wyświetlałby się klientowi jako
    // „profile.planPage.history.status.disputed".
    missingKeys = true;
    render(<PaymentStatusBadge status="disputed" />);

    expect(screen.getByText("disputed")).toBeInTheDocument();
    expect(screen.queryByText(/^profile\.status\./)).not.toBeInTheDocument();
  });

  it("nieznany stan zachowuje surową wartość także w `data-status`", () => {
    missingKeys = true;
    render(<PaymentStatusBadge status="requires_action" labelPrefix="profile.orders.status" />);

    expect(screen.getByText("requires_action")).toHaveAttribute("data-status", "requires_action");
  });

  it("prefiks klucza da się zmienić na słownik danej karty", () => {
    render(<PaymentStatusBadge status="void" labelPrefix="profile.orders.documents.status" />);

    expect(screen.getByText("profile.orders.documents.status.void")).toBeInTheDocument();
  });

  it("TEN SAM stan wygląda identycznie niezależnie od karty (bramka po defekcie)", () => {
    // Do 19.08.2026 `failed` był czerwony w historii i neutralny w dokumentach,
    // a `void` odwrotnie - klient nie miał jak zgadnąć, która karta mówi prawdę.
    const { container: first } = render(<PaymentStatusBadge status="failed" />);
    const { container: second } = render(
      <PaymentStatusBadge status="failed" labelPrefix="profile.orders.documents.status" />,
    );

    const tone = (el: HTMLElement) => el.querySelector("[data-status]")!.className;
    expect(tone(first as HTMLElement)).toBe(tone(second as HTMLElement));
  });
});

describe("BillingEmptyState - pusta lista jest OGŁOSZONA", () => {
  it("komunikat ma rolę statusu", () => {
    render(<BillingEmptyState>Brak faktur</BillingEmptyState>);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Brak faktur");
    expect(status.tagName).toBe("P");
  });
});

describe("MoneyText - kwota czytelna dla człowieka I dla maszyny", () => {
  it("pokazuje kwotę sformatowaną i ZACHOWUJE grosze z walutą w atrybucie", () => {
    render(<MoneyText cents={4900} currency="PLN" />);

    const money = screen.getByText(/49/);
    expect(money).toHaveAttribute("value", "4900:PLN");
    expect(money.tagName).toBe("DATA");
  });

  it("kwota ZEROWA nie znika (0 zł to informacja, nie brak danych)", () => {
    const { container } = render(<MoneyText cents={0} currency="PLN" />);

    expect(container.querySelector("data")).toHaveAttribute("value", "0:PLN");
    expect(container.querySelector("data")!.textContent).not.toBe("");
  });

  it("kwota UJEMNA (korekta, zwrot) też przechodzi z właściwą wartością", () => {
    const { container } = render(<MoneyText cents={-4900} currency="EUR" />);

    expect(container.querySelector("data")).toHaveAttribute("value", "-4900:EUR");
  });

  it("nieznana waluta nie wywala kwoty - schodzi na zapis z kodem", () => {
    // `Intl` rzuca dla niepoprawnego kodu; `formatMoney` ma zabezpieczenie.
    const { container } = render(<MoneyText cents={1000} currency="XXXX" />);

    expect(container.querySelector("data")!.textContent).toContain("XXXX");
  });
});

describe("BillingDate - dzień, w którym pobrano pieniądze", () => {
  it("data jest elementem `<time>` z surowym znacznikiem czasu", () => {
    render(<BillingDate iso="2026-08-18T10:00:00.000Z" />);

    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-08-18T10:00:00.000Z");
  });

  it("BRAK daty pokazuje kreskę, nie puste miejsce", () => {
    render(<BillingDate iso={null} />);

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("własny tekst zastępczy przechodzi (np. „bez końca”)", () => {
    render(<BillingDate iso={undefined} fallback="bez końca" />);

    expect(screen.getByText("bez końca")).toBeInTheDocument();
  });

  it("NIEPOPRAWNY znacznik czasu NIE pokazuje „Invalid Date” (bramka po defekcie)", () => {
    // Osiem dawnych kopii formatowania nie miało tego zabezpieczenia - uszkodzona
    // data pokazywała klientowi „Invalid Date" w miejscu daty faktury.
    render(<BillingDate iso="to-nie-data" />);

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid/)).not.toBeInTheDocument();
  });

  it("wariant skrócony i pełny dają RÓŻNY tekst z tej samej daty", () => {
    const { container: long } = render(<BillingDate iso="2026-08-18T10:00:00.000Z" />);
    const { container: short } = render(
      <BillingDate iso="2026-08-18T10:00:00.000Z" variant="short" />,
    );

    expect(long.textContent).not.toBe(short.textContent);
    expect(short.querySelector("time")).toHaveAttribute("datetime", "2026-08-18T10:00:00.000Z");
  });

  it("po angielsku data jest formatowana europejsko (dzień przed miesiącem)", () => {
    lang = "en";
    const { container } = render(<BillingDate iso="2026-08-18T10:00:00.000Z" variant="short" />);
    lang = "pl";

    expect(container.textContent).toMatch(/18/);
    expect(container.querySelector("time")).toBeInTheDocument();
  });
});

describe("translateKey - atrapa słownika nie maskuje kluczy", () => {
  it("echo klucza pozwala asertować KLUCZ, nie polski tekst", () => {
    expect(translateKey("profile.status.paid")).toBe("profile.status.paid");
  });
});
