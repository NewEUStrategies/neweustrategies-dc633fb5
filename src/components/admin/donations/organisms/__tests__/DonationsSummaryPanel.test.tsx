// Trzy kafelki podsumowania darowizn: suma, biezacy miesiac, liczba wplat.
//
// PO CO TEN PLIK ISTNIEJE. Kafelki sa jedynym miejscem w panelu, ktore mowi
// „ile zebralismy". Komponent jest czysto prezentacyjny, wiec cale ryzyko
// siedzi w dwoch miejscach:
//   1. STAN PRZED ODPOWIEDZIA. Zapytanie statystyk moze jeszcze nie wrocic
//      (`stats === undefined`). Kafelek musi wtedy pokazac ZERO, a nie „NaN zl"
//      ani pustke - i musi uzyc waluty Z KONFIGURACJI, bo waluty ze statystyk
//      jeszcze nie ma. Sklejenie `undefined` z formatowaniem waluty daje
//      „NaN PLN" na ekranie, ktory administrator pokazuje zarzadowi.
//   2. KTORA WALUTA WYGRYWA. Rejestr bywa dwuwalutowy (PLN historycznie, EUR
//      po zmianie ustawien). Statystyki licza sie WYLACZNIE w walucie zbiorki
//      i przynosza ja ze soba - wiec gdy juz sa, to ONE rozstrzygaja. Kafelek
//      pokazujacy sume euro z symbolem zlotego to blad ksiegowy na ekranie.
//
// `formatDonationAmount` biegnie PRAWDZIWY - to sasiad z warstwy rozliczen
// i to on odpowiada za polska/angielska konwencje zapisu kwoty.
//
// RODO: zaden kafelek nie dotyka danych darczyncow - operuje wylacznie
// sumami, wiec w tym pliku nie ma zadnych danych osobowych.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
// Prawdziwy slownik: kafelki biora etykiety z `donate.admin.summary.*`, wiec
// asercja ma mierzyc napis ze slownika, a nie klucz z atrapy. Nakladka
// rejestruje sie efektem ubocznym importu.
import "@/test/i18nReal";
import "@/lib/i18n-donate";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { formatDonationAmount } from "@/lib/billing/donationsConfig";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";
import { DonationsSummaryPanel } from "../DonationsSummaryPanel";

/**
 * Kwota w postaci, w jakiej widzi ja `getByText`. `Intl.NumberFormat` wstawia
 * TWARDA spacje (U+00A0) miedzy liczba a symbolem waluty, a RTL normalizuje ja
 * w drzewie do zwyklej - porownanie z surowym wynikiem formatera nigdy by sie
 * nie zgodzilo. Formatowanie liczy PRAWDZIWY `formatDonationAmount`; tu
 * wyrownujemy wylacznie bialy znak.
 */
function kwota(cents: number, currency: string, lang: "pl" | "en"): string {
  return formatDonationAmount(cents, currency, lang).replace(/\u00a0/g, " ");
}

function statystyki(over: Partial<DonationsPublicStats> = {}): DonationsPublicStats {
  return {
    totalCents: 1_250_00,
    monthCents: 320_00,
    count: 42,
    monthCount: 9,
    currency: "PLN",
    recent: [],
    truncated: false,
    ...over,
  };
}

describe("DonationsSummaryPanel - brak statystyk", () => {
  it("przed odpowiedzia pokazuje ZERA, a nie `NaN` ani pustke", () => {
    render(<DonationsSummaryPanel stats={undefined} currency="PLN" lang="pl" />);
    const zero = kwota(0, "PLN", "pl");
    expect(screen.getAllByText(zero)).toHaveLength(2);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("przed odpowiedzia uzywa waluty Z KONFIGURACJI zbiorki", () => {
    // Waluta ze statystyk jeszcze nie istnieje; jedyne poprawne zrodlo to
    // ustawienia modulu. Sztywne „PLN" pokazywaloby zlote zbiorce w euro.
    render(<DonationsSummaryPanel stats={undefined} currency="EUR" lang="pl" />);
    expect(screen.getAllByText(kwota(0, "EUR", "pl"))).toHaveLength(2);
  });
});

describe("DonationsSummaryPanel - statystyki obecne", () => {
  it("pokazuje sume, biezacy miesiac i liczbe wplat", () => {
    render(<DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="pl" />);
    expect(screen.getByText(kwota(125000, "PLN", "pl"))).toBeInTheDocument();
    expect(screen.getByText(kwota(32000, "PLN", "pl"))).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("waluta ZE STATYSTYK wygrywa nad waluta z konfiguracji", () => {
    // Rejestr bywa dwuwalutowy: statystyki sumuja wylacznie walute zbiorki
    // i przynosza ja ze soba. Konfiguracja moze byc juz przestawiona na inna,
    // podczas gdy zliczone wplaty sa nadal w starej.
    render(
      <DonationsSummaryPanel stats={statystyki({ currency: "EUR" })} currency="PLN" lang="pl" />,
    );
    expect(screen.getByText(kwota(125000, "EUR", "pl"))).toBeInTheDocument();
    expect(screen.queryByText(kwota(125000, "PLN", "pl"))).toBeNull();
  });

  it("ZEROWE statystyki to nadal zera, a nie brak kafelkow", () => {
    // Zbiorka, ktora dopiero ruszyla, ma zero wplat - i musi to POWIEDZIEC,
    // zamiast wygladac na awarie odczytu.
    render(
      <DonationsSummaryPanel
        stats={statystyki({ totalCents: 0, monthCents: 0, count: 0 })}
        currency="PLN"
        lang="pl"
      />,
    );
    expect(screen.getAllByText(kwota(0, "PLN", "pl"))).toHaveLength(2);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("kwota niepelnych zlotowek pokazuje grosze, pelna - nie pokazuje", () => {
    // Reguła formatowania siedzi w `formatDonationAmount` i jest tu sprawdzana
    // NA ZYWO (bez atrapy), bo to ona decyduje, czy podsumowanie da sie
    // porownac z wyciagiem bankowym.
    render(
      <DonationsSummaryPanel
        stats={statystyki({ totalCents: 12345, monthCents: 10000 })}
        currency="PLN"
        lang="pl"
      />,
    );
    expect(screen.getByText(kwota(12345, "PLN", "pl"))).toBeInTheDocument();
    expect(screen.getByText(kwota(10000, "PLN", "pl"))).toBeInTheDocument();
  });

  it("jezyk EN zmienia konwencje zapisu kwoty", () => {
    // Panel jest dwujezyczny; ta sama liczba ma inny separator i inne miejsce
    // symbolu waluty w obu wersjach.
    const { unmount } = render(
      <DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="en" />,
    );
    expect(screen.getByText(kwota(125000, "PLN", "en"))).toBeInTheDocument();
    unmount();
    render(<DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="pl" />);
    expect(screen.getByText(kwota(125000, "PLN", "pl"))).toBeInTheDocument();
  });

  it("liczba wplat NIE jest formatowana jako kwota", () => {
    // Licznik to sztuki, nie pieniadze - „42 zl" bylby oczywistym falszem
    // przy 42 wplatach.
    render(<DonationsSummaryPanel stats={statystyki({ count: 42 })} currency="PLN" lang="pl" />);
    const licznik = screen.getByText("42");
    expect(licznik.textContent).toBe("42");
  });
});

describe("DonationsSummaryPanel - dostepnosc", () => {
  it("nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = render(
      <DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="pl" />,
    );
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BRAK i18n - ZAREJESTROWANY I NAPRAWIONY (08.2026).
// ---------------------------------------------------------------------------
describe("DonationsSummaryPanel - dawny brak i18n", () => {
  it("etykiety kafelkow pochodza ze slownika, w jezyku PODANYM W PROPSIE", async () => {
    // CO BYLO ZLE. Trzy etykiety („Suma wpłat", „W tym miesiącu", „Liczba
    // wpłat") byly wpisane w kod wprost, mimo ze komponent dostaje juz `lang`
    // i formatuje po nim KWOTY.
    //
    // DLACZEGO TO BYLO RYZYKO. Efekt byl szczegolnie mylacy: kwota obok etykiety
    // sformatowana po angielsku, a sama etykieta polska. Panel wygladal wtedy
    // na uszkodzony, a nie na nieprzetlumaczony - i to jest ten ekran, ktory
    // pokazuje sie zarzadowi i darczyncom instytucjonalnym.
    //
    // JAK NAPRAWIONE. Etykiety ida przez `donate.admin.summary.*` z wymuszeniem
    // jezyka `{ lng: lang }` - tym SAMYM, ktorym formatowana jest kwota obok.
    // Wymuszenie jest istotne: komponent jest prezentacyjny i dostaje jezyk
    // propsem, wiec czytanie go z instancji i18n moglo by rozjechac napis
    // z liczba stojaca pod nim.
    const t = realT("en");
    render(<DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="en" />);
    expect(screen.queryByText("Suma wpłat")).toBeNull();
    expect(screen.getByText(t("donate.admin.summary.total"))).toBeInTheDocument();
    expect(screen.getByText(t("donate.admin.summary.month"))).toBeInTheDocument();
    expect(screen.getByText(t("donate.admin.summary.count"))).toBeInTheDocument();
    expect(screen.getByText(kwota(125000, "PLN", "en"))).toBeInTheDocument();
  });

  it("po polsku kafelki mowia po polsku", () => {
    // Druga strona tej samej galezi: bez niej test wyzej przechodzilby takze
    // wtedy, gdyby panel byl na stale angielski.
    const t = realT("pl");
    render(<DonationsSummaryPanel stats={statystyki()} currency="PLN" lang="pl" />);
    expect(screen.getByText(t("donate.admin.summary.total"))).toBeInTheDocument();
    expect(screen.getByText("Suma wpłat")).toBeInTheDocument();
  });
});
