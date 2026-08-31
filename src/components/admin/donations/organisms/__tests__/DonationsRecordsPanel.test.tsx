// Lista ostatnich wplat w panelu darowizn.
//
// PO CO TEN PLIK ISTNIEJE. Ta tabela jest rejestrem wplat, z ktorego robi sie
// uzgodnienie z operatorem platnosci i podziekowania dla darczyncow. Ryzyka:
//   1. TRZY STANY, TRZY WIDOKI. „Wczytuje", „brak wplat" i „sa wplaty" musza
//      byc rozroznialne. Pokazanie „Brak zarejestrowanych wplat." w trakcie
//      odczytu prowadzi do wniosku, ze zbiorka nie dziala - i do zglaszania
//      awarii operatorowi platnosci.
//   2. WPLATA BEZ DARCZYNCY MUSI ZOSTAC W TABELI. Wplata anonimowa (bez
//      adresu e-mail) to normalny przypadek. Wiersz, ktory z tego powodu
//      znika albo pokazuje „undefined", falszuje rejestr.
//   3. KWOTA W WALUCIE WIERSZA. Rejestr bywa dwuwalutowy - kazdy wiersz ma
//      WLASNA walute i musi byc sformatowany swoja, a nie waluta zbiorki.
//
// `formatDonationAmount` biegnie PRAWDZIWY (sasiad z warstwy rozliczen).
//
// RODO: wszystkie adresy w tym pliku sa z domen zarezerwowanych do przykladow
// (`example.com` / `example.org`) - w testach nie moze byc realnych danych
// osobowych darczyncow.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
// Prawdziwy slownik zamiast atrapy echa kluczy: cala tabela (naglowek sekcji,
// naglowki kolumn, komunikat pustki, rodzaj wsparcia) bierze napisy
// z `donate.admin.records.*` i to je ma mierzyc asercja. Nakladka rejestruje
// sie efektem ubocznym importu.
import "@/test/i18nReal";
import "@/lib/i18n-donate";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { formatDonationAmount } from "@/lib/billing/donationsConfig";
import type { AdminDonationRow } from "@/lib/billing/donationsAdmin.server";

import { DonationsRecordsPanel } from "../DonationsRecordsPanel";

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

function wplata(over: Partial<AdminDonationRow> = {}): AdminDonationRow {
  return {
    id: "dddddddd-1111-4111-8111-dddddddddddd",
    amountCents: 15000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donorEmail: "darczynca@example.com",
    message: null,
    provider: "stripe",
    providerSessionId: "cs_test_000",
    providerIntentId: null,
    createdAt: "2026-03-15T12:30:00.000Z",
    paidAt: "2026-03-15T12:31:00.000Z",
    ...over,
  };
}

describe("DonationsRecordsPanel - stany listy", () => {
  it("W TRAKCIE odczytu mowi `wczytuje`, a nie `brak wplat`", () => {
    render(<DonationsRecordsPanel records={undefined} isPending lang="pl" />);
    expect(screen.getByText(realT("pl")("admin.loading"))).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BRAK wplat (pusta tablica) konczy sie komunikatem, nie pusta tabela", () => {
    render(<DonationsRecordsPanel records={[]} isPending={false} lang="pl" />);
    expect(screen.getByText(/Brak zarejestrowanych/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BRAK odpowiedzi po zakonczonym odczycie tez daje komunikat, a nie awarie", () => {
    // `records` bywa `undefined` takze po nieudanym zapytaniu. Komponent nie
    // moze wtedy probowac mapowac `undefined`.
    render(<DonationsRecordsPanel records={undefined} isPending={false} lang="pl" />);
    expect(screen.getByText(/Brak zarejestrowanych/)).toBeInTheDocument();
  });

  it("LISTA wplat renderuje sie jako tabela z jednym wierszem na wplate", () => {
    render(
      <DonationsRecordsPanel
        records={[wplata(), wplata({ id: "druga", donorEmail: "druga@example.org" })]}
        isPending={false}
        lang="pl"
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("DonationsRecordsPanel - wiersz wplaty", () => {
  it("kwota jest sformatowana w walucie TEGO wiersza", () => {
    // Rejestr bywa dwuwalutowy; wiersz w euro sformatowany zlotowka to blad
    // w uzgodnieniu z operatorem platnosci.
    render(
      <DonationsRecordsPanel
        records={[wplata({ amountCents: 5000, currency: "EUR" })]}
        isPending={false}
        lang="pl"
      />,
    );
    expect(screen.getByText(kwota(5000, "EUR", "pl"))).toBeInTheDocument();
  });

  it("status wplaty jest widoczny wprost", () => {
    // „pending" kontra „paid" decyduje o tym, czy wplata wchodzi do sumy -
    // to jest kolumna, po ktorej szuka sie rozbieznosci.
    render(
      <DonationsRecordsPanel
        records={[wplata({ status: "pending" })]}
        isPending={false}
        lang="pl"
      />,
    );
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("wsparcie MIESIECZNE i JEDNORAZOWE sa rozroznione", () => {
    // Wsparcie cykliczne to osobna subskrypcja u operatora - pomylenie go
    // z wplata jednorazowa psuje prognoze przychodu.
    render(
      <DonationsRecordsPanel
        records={[
          wplata({ id: "cykliczna", recurring: true }),
          wplata({ id: "jednorazowa", recurring: false }),
        ]}
        isPending={false}
        lang="pl"
      />,
    );
    expect(screen.getByText(/miesi/)).toBeInTheDocument();
    expect(screen.getByText(/jednorazowa/)).toBeInTheDocument();
  });

  it("wplata BEZ adresu darczyncy zostaje w tabeli i pokazuje dywiz", () => {
    // Wplata anonimowa jest normalna. Wiersz nie moze zniknac ani pokazac
    // „undefined" - rejestr ma sie zgadzac co do sztuki i co do kwoty.
    render(
      <DonationsRecordsPanel
        records={[wplata({ donorEmail: null, amountCents: 7700 })]}
        isPending={false}
        lang="pl"
      />,
    );
    const wiersze = screen.getAllByRole("row");
    expect(wiersze).toHaveLength(2);
    const komorki = within(wiersze[1]);
    expect(komorki.getByText("-")).toBeInTheDocument();
    expect(komorki.queryByText(/undefined/)).toBeNull();
    expect(komorki.getByText(kwota(7700, "PLN", "pl"))).toBeInTheDocument();
  });

  it("adres darczyncy pokazuje sie, gdy istnieje", () => {
    render(<DonationsRecordsPanel records={[wplata()]} isPending={false} lang="pl" />);
    expect(screen.getByText("darczynca@example.com")).toBeInTheDocument();
  });

  it("data wplaty jest lokalizowana wedlug jezyka panelu", () => {
    // Surowy ISO („2026-03-15T12:30:00.000Z") jest dla ksiegowosci nieczytelny,
    // a roznica formatu PL/EN decyduje o tym, czy „03/15" czyta sie jako
    // 15 marca czy 3 maja.
    const { unmount } = render(
      <DonationsRecordsPanel records={[wplata()]} isPending={false} lang="pl" />,
    );
    expect(
      screen.getByText(new Date("2026-03-15T12:30:00.000Z").toLocaleString("pl-PL")),
    ).toBeInTheDocument();
    unmount();
    render(<DonationsRecordsPanel records={[wplata()]} isPending={false} lang="en" />);
    expect(
      screen.getByText(new Date("2026-03-15T12:30:00.000Z").toLocaleString("en-GB")),
    ).toBeInTheDocument();
  });
});

describe("DonationsRecordsPanel - dostepnosc", () => {
  it("tabela rejestru nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = render(
      <DonationsRecordsPanel records={[wplata()]} isPending={false} lang="pl" />,
    );
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BRAK i18n - ZAREJESTROWANY I NAPRAWIONY (08.2026).
// ---------------------------------------------------------------------------
describe("DonationsRecordsPanel - dawny brak i18n", () => {
  it("naglowek sekcji i naglowki kolumn pochodza ze slownika", async () => {
    // CO BYLO ZLE. Komponent WOLAL `useTranslation()` (uzywal `t("admin.loading")`
    // dla stanu ladowania), ale wszystko pozostale mial wpisane po polsku:
    // „Ostatnie wpłaty", „Data", „Kwota", „Status", „Typ", „Darczyńca",
    // „Brak zarejestrowanych wpłat.", „miesięczna", „jednorazowa".
    //
    // DLACZEGO TO BYLO RYZYKO. Komponent dostaje `lang` i uzywa go do formatowania
    // DATY i KWOTY - w wersji angielskiej powstawala wiec tabela z angielskimi
    // datami i kwotami pod polskimi naglowkami. Dodatkowo „miesięczna" jest
    // JEDYNYM sygnalem, ze wplata jest cykliczna: dla anglojezycznego
    // uzytkownika ta informacja byla po prostu nieczytelna, a ma wplyw na
    // prognoze przychodu.
    //
    // JAK NAPRAWIONE. Napisy ida przez `donate.admin.records.*` z wymuszeniem
    // jezyka `{ lng: lang }`, czyli tym samym, ktorym formatowana jest data
    // i kwota w wierszu - tabela nie ma jak przemowic dwoma jezykami naraz.
    const t = realT("en");
    render(
      <DonationsRecordsPanel records={[wplata({ recurring: true })]} isPending={false} lang="en" />,
    );
    expect(screen.queryByRole("columnheader", { name: "Darczyńca" })).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: t("donate.admin.records.donor") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: t("donate.admin.records.title") }),
    ).toBeInTheDocument();
    // Rodzaj wsparcia to jedyny sygnal cyklicznosci - musi byc czytelny.
    expect(screen.getByText(t("donate.admin.records.recurring"))).toBeInTheDocument();
    expect(screen.queryByText("miesięczna")).toBeNull();
  });
});
