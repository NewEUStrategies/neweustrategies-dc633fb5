// `MoneyByCurrencyText` - kwoty per waluta: preferowana na wierzchu, reszta
// w popoverze „+N inne waluty", NIGDY suma; `null` = brak danych, `[]` = zero.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import { axeViolations, summarize } from "@/test/axe";
import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

/** Twarda spacja i wąska twarda spacja z ICU → zwykła, żeby asercje były czytelne. */
function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/[\u00a0\u202f]/g, " ");
}

const MIXED: MoneyByCurrency[] = [
  { currency: "PLN", amountMinor: 1_000_000 },
  { currency: "EUR", amountMinor: 240_000 },
  { currency: "JPY", amountMinor: 5_000 },
];

describe("MoneyByCurrencyText", () => {
  it("pokazuje walutę wiodącą, a pozostałe chowa pod „+2 inne waluty”", () => {
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} lang="pl" />);

    expect(plain(container.querySelector('[data-money="primary"]')?.textContent)).toBe(
      "10 000,00 zł",
    );
    expect(screen.getByRole("button", { name: "+2 inne waluty" })).toBeInTheDocument();
  });

  it("NIGDY nie sumuje walut - żadna liczba na ekranie nie jest sumą pozycji", () => {
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: "+2 inne waluty" }));

    const shown = plain(document.body.textContent);
    // Suma „w jednostkach drobnych" (10 000 + 2 400 + 50) i suma liczb
    // (12 450) nie mogą się pojawić w żadnym formacie.
    for (const sum of ["12 450", "12450", "1 245 000", "12 400,00", "12 405"]) {
      expect(shown, sum).not.toContain(sum);
    }
    expect(container.querySelectorAll('[data-money="primary"]')).toHaveLength(1);
    expect(
      screen.getByText("Kwot w różnych walutach nie sumujemy", { exact: false }),
    ).toBeInTheDocument();
  });

  it("popover wymienia każdą walutę osobno, z wykładnikiem z ICU (JPY bez groszy)", () => {
    render(<MoneyByCurrencyText amounts={MIXED} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: "+2 inne waluty" }));

    const rows = [...document.querySelectorAll("li[data-currency]")].map((li) => [
      li.getAttribute("data-currency"),
      plain(li.lastElementChild?.textContent),
    ]);
    expect(rows).toEqual([
      ["PLN", "10 000,00 zł"],
      ["EUR", "2400,00 €"],
      ["JPY", "5000 JPY"],
    ]);
  });

  it("waluta preferowana idzie na wierzch, reszta zachowuje kolejność serwera", () => {
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} preferred="EUR" lang="pl" />);

    const primary = container.querySelector('[data-money="primary"]');
    expect(primary).toHaveAttribute("data-currency", "EUR");
    fireEvent.click(screen.getByRole("button", { name: "+2 inne waluty" }));
    expect(
      [...document.querySelectorAll("li[data-currency]")].map((li) =>
        li.getAttribute("data-currency"),
      ),
    ).toEqual(["EUR", "PLN", "JPY"]);
  });

  it("preferowana waluta spoza listy niczego nie zmyśla - zostaje kolejność serwera", () => {
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} preferred="USD" lang="pl" />);
    expect(container.querySelector('[data-money="primary"]')).toHaveAttribute(
      "data-currency",
      "PLN",
    );
  });

  it("liczebniki: jedna inna waluta i pięć innych walut", () => {
    render(
      <MoneyByCurrencyText
        amounts={[
          { currency: "PLN", amountMinor: 100 },
          { currency: "EUR", amountMinor: 100 },
        ]}
        lang="pl"
      />,
    );
    expect(screen.getByRole("button", { name: "+1 inna waluta" })).toBeInTheDocument();
    cleanup();

    const six = ["PLN", "EUR", "USD", "GBP", "CHF", "CZK"].map((currency) => ({
      currency,
      amountMinor: 1,
    }));
    render(<MoneyByCurrencyText amounts={six} lang="pl" />);
    expect(screen.getByRole("button", { name: "+5 innych walut" })).toBeInTheDocument();
  });

  it("null = brak danych słowem, nie zero", () => {
    const { container } = render(<MoneyByCurrencyText amounts={null} lang="pl" />);

    expect(container).toHaveTextContent("brak danych");
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("[] = zmierzone zero (w walucie preferowanej, gdy ją znamy)", () => {
    const { container } = render(<MoneyByCurrencyText amounts={[]} preferred="PLN" lang="pl" />);
    expect(plain(container.textContent)).toBe("0,00 zł");
    cleanup();

    const bare = render(<MoneyByCurrencyText amounts={[]} lang="pl" />);
    expect(bare.container.textContent).toBe("0");
  });

  it("jedna waluta - bez przycisku innych walut", () => {
    render(<MoneyByCurrencyText amounts={[{ currency: "PLN", amountMinor: 1999 }]} lang="pl" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wersja angielska: format en-GB i liczebnik EN", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} lang="en" />);

    expect(plain(container.querySelector('[data-money="primary"]')?.textContent)).toBe(
      "PLN 10,000.00",
    );
    expect(screen.getByRole("button", { name: "+2 other currencies" })).toBeInTheDocument();
    cleanup();
    render(<MoneyByCurrencyText amounts={null} lang="en" />);
    expect(screen.getByText("no data")).toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności (zamknięty i otwarty popover)", async () => {
    const { container } = render(<MoneyByCurrencyText amounts={MIXED} lang="pl" />);
    expect(summarize(await axeViolations(container))).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "+2 inne waluty" }));
    expect(summarize(await axeViolations(document.body))).toBe("");
  });
});
