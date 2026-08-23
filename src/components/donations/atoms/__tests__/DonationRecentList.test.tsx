// Lista ostatnich wpłat (atom wariantu `thermometer`). RYZYKIEM jest tu RODO
// i WALUTA: server fn oddaje wyłącznie kwotę, walutę i czas (nigdy darczyńcy),
// a kwota jest tu etykietowana walutą WIDGETU, nie walutą wiersza.
//
// CO TEN PLIK DOWODZI.
//   1. Pusta lista renderuje NIC (to samo, co dawny warunek
//      `stats.recent.length > 0` w widoku) - a nie pusty `<ul>` z marginesem.
//   2. Kwota wiersza dostaje walutę widgetu; wiersz w EUR na widgecie w PLN
//      zostaje przemianowany na złotówki. Pole `r.currency` jest IGNOROWANE.
//   3. Czas relatywny liczy się od `Date.now()`, więc bez zamrożonego zegara
//      ten atom jest nietestowalny - i był nietestowany.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Granic „60 min / 24 godz." i formatu kwoty
// dowodzi `donationsWidgetModel.test.ts`; tu chodzi o SKŁAD wiersza.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DonationRecentList } from "../DonationRecentList";
import type { RecentDonation } from "../../donationsWidgetModel";
import { donationsWidgetEn, donationsWidgetPl } from "@/lib/i18n-donations-widget";

/**
 * Tłumacz na PRAWDZIWYM słowniku widgetu. Atom dostaje `t` propem (a nie bierze
 * go z `useTranslation()`), bo czas relatywny musi jechać w języku WIDGETU,
 * nie strony - patrz komentarz w `DonationRecentList.tsx`. Tu stawiam pod to
 * słownik realny, żeby asercje pokazywały napis, który zobaczy darczyńca.
 */
const T = (key: string, opts?: Record<string, unknown>) => {
  const drzewo = opts?.lng === "en" ? donationsWidgetEn : donationsWidgetPl;
  const wzor = key
    .split(".")
    .reduce<unknown>(
      (n, part) =>
        n !== null && typeof n === "object" ? (n as Record<string, unknown>)[part] : undefined,
      drzewo,
    );
  if (typeof wzor !== "string") throw new Error(`test: brak klucza ${key}`);
  return wzor.replace(/\{\{(\w+)\}\}/g, (_m, nazwa: string) => String(opts?.[nazwa] ?? ""));
};

const NOW = new Date("2026-08-23T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const WPLATY: RecentDonation[] = [
  { amount_cents: 5000, currency: "PLN", created_at: ago(5) },
  { amount_cents: 150, currency: "PLN", created_at: ago(90) },
  { amount_cents: 10000, currency: "PLN", created_at: ago(3 * 24 * 60) },
];

describe("DonationRecentList", () => {
  it("DECYZJA: pusta lista renderuje NIC - żadnego pustego <ul> z marginesem", () => {
    const { container } = render(<DonationRecentList recent={[]} currency="PLN" lang="pl" t={T} />);
    expect(container.innerHTML).toBe("");
  });

  it("DECYZJA: każdy wiersz to kwota + „ile temu”, bez śladu po darczyńcy", () => {
    const { container } = render(
      <DonationRecentList recent={WPLATY} currency="PLN" lang="pl" t={T} />,
    );
    const rows = [...container.querySelectorAll("li")].map((li) =>
      [...li.querySelectorAll("span")].map((s) => s.textContent),
    );
    expect(rows).toEqual([
      ["50\u00a0zł", "5 min temu"],
      ["1,50\u00a0zł", "1 godz. temu"],
      ["100\u00a0zł", "3 dni temu"],
    ]);
  });

  it("DECYZJA: język przełącza JEDNOCZEŚNIE format kwoty i skrót czasu", () => {
    const { container } = render(
      <DonationRecentList recent={[WPLATY[1]]} currency="EUR" lang="en" t={T} />,
    );
    expect(container.querySelector("li")!.textContent).toBe("€1.501h ago");
  });

  it("DEFEKT (przypięty): waluta WIERSZA jest ignorowana - euro dostaje etykietę zł", () => {
    const { container } = render(
      <DonationRecentList
        recent={[{ amount_cents: 2500, currency: "EUR", created_at: ago(1) }]}
        currency="PLN"
        lang="pl"
        t={T}
      />,
    );
    expect(container.querySelector("li span")!.textContent).toBe("25\u00a0zł");
  });

  it.fails("DEFEKT: wpłata w EUR POWINNA zostać pokazana w EUR, nie przemianowana", () => {
    // Oczekiwane: wiersz niesie własną walutę (`r.currency`) i to ona
    // etykietuje kwotę - inaczej lista wpłat kłamie o jednostce pieniądza.
    const { container } = render(
      <DonationRecentList
        recent={[{ amount_cents: 2500, currency: "EUR", created_at: ago(1) }]}
        currency="PLN"
        lang="pl"
        t={T}
      />,
    );
    expect(container.querySelector("li span")!.textContent).toBe("25\u00a0€");
  });

  it("DECYZJA: lista zachowuje kolejność wejścia - nie sortuje po dacie", () => {
    const odwrotnie = [...WPLATY].reverse();
    const { container } = render(
      <DonationRecentList recent={odwrotnie} currency="PLN" lang="pl" t={T} />,
    );
    const czasy = [...container.querySelectorAll("li span:last-child")].map((s) => s.textContent);
    expect(czasy).toEqual(["3 dni temu", "1 godz. temu", "5 min temu"]);
  });
});
