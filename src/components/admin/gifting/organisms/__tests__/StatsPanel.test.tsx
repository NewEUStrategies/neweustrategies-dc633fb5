// Organizm: kafelki statystyk panelu prezentow.
//
// PO CO TEN PLIK ISTNIEJE. Kafelki sa jedynym miejscem, w ktorym redakcja
// widzi SKALE mechaniki "udostepnij pelny artykul" - ile linkow zyje, ile razy
// otwarto tresc zza paywalla i ilu ludzi weszlo nie placac. Trzy klasy bledow,
// ktorych nie zlapie kompilator:
//
//   1. PRZESTAWIONE ETYKIETY. Dziesiec liczb tego samego typu (`number`) idzie
//      do dziesieciu kafelkow. Zamiana "Cofniete" z "Wygasle" albo "Unikalni
//      darczyncy" z "Unikalni odbiorcy" przechodzi przez `tsc`, przez przeglad
//      i przez kazdy test liczacy same kafelki - a raportuje nieprawde.
//   2. ZERO UDAJACE BRAK DANYCH. Stan ladowania i stan "wszystko na zerach"
//      musza wygladac inaczej; szkielet pokazany zamiast zer sugerowalby, ze
//      dane sa w drodze, kiedy juz przyszly.
//   3. FORMAT LICZB. `toLocaleString()` jest jedyna rzecza dzielaca "12345" od
//      "12 345" na kafelku - regresja czyni panel nieczytelnym przy skali,
//      przy ktorej w ogole zaczyna byc potrzebny.
//
// ATRAPY: granica sieciowa (server fn + `useServerFn`) i i18n. React-query
// biegnie prawdziwy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

/** Ksztalt wiersza `get_gift_stats_admin` (RETURNS TABLE, jeden wiersz). */
interface GiftAdminStats {
  active_links: number;
  revoked_links: number;
  expired_links: number;
  exhausted_links: number;
  total_created: number;
  total_redeemed: number;
  created_this_month: number;
  redeemed_this_month: number;
  unique_gifters: number;
  unique_recipients: number;
}

const h = vi.hoisted(() => ({ getStats: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminStats: (...args: unknown[]) => h.getStats(...args),
}));

const { StatsPanel } = await import("@/components/admin/gifting/organisms/StatsPanel");

function stats(overrides: Partial<GiftAdminStats> = {}): GiftAdminStats {
  return {
    active_links: 1,
    revoked_links: 2,
    expired_links: 3,
    exhausted_links: 4,
    total_created: 5,
    total_redeemed: 6,
    created_this_month: 7,
    redeemed_this_month: 8,
    unique_gifters: 9,
    unique_recipients: 10,
    ...overrides,
  };
}

/** Liczba pokazana pod danym kluczem etykiety. */
function valueUnder(labelKey: string): string {
  const label = screen.getByText(labelKey);
  const tile = label.parentElement;
  return tile?.querySelector("div:last-child")?.textContent ?? "";
}

beforeEach(() => {
  h.getStats.mockReset();
});

describe("StatsPanel - stan ladowania", () => {
  it("pokazuje szkielet, dopoki serwer nie odpowie", () => {
    h.getStats.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQueryClient(<StatsPanel />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(10);
  });

  it("szkielet ma tyle pol, ile bedzie kafelkow - siatka nie skacze", () => {
    // Skok ukladu po dojsciu danych przesuwa zakladki pod kursorem admina.
    h.getStats.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQueryClient(<StatsPanel />);
    const skeletons = container.querySelectorAll(".animate-pulse").length;
    expect(skeletons).toBe(10);
  });

  it("w stanie ladowania NIE pokazuje zadnej liczby", () => {
    h.getStats.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<StatsPanel />);
    expect(screen.queryByText("giftingAdmin.stats.active")).toBeNull();
  });
});

describe("StatsPanel - dane", () => {
  it("renderuje wszystkie dziesiec kafelkow", async () => {
    h.getStats.mockResolvedValue(stats());
    renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
    for (const key of [
      "active",
      "createdThisMonth",
      "redeemedThisMonth",
      "totalCreated",
      "totalRedeemed",
      "gifters",
      "recipients",
      "exhausted",
      "revoked",
      "expired",
    ]) {
      expect(screen.getByText(`giftingAdmin.stats.${key}`), `brak kafelka ${key}`).toBeTruthy();
    }
  });

  it.each([
    ["active", "active_links"],
    ["createdThisMonth", "created_this_month"],
    ["redeemedThisMonth", "redeemed_this_month"],
    ["totalCreated", "total_created"],
    ["totalRedeemed", "total_redeemed"],
    ["gifters", "unique_gifters"],
    ["recipients", "unique_recipients"],
    ["exhausted", "exhausted_links"],
    ["revoked", "revoked_links"],
    ["expired", "expired_links"],
  ] as const)("kafelek %s czyta pole %s (a nie sasiednie)", async (labelKey, field) => {
    // KAZDE pole dostaje UNIKALNA wartosc, wiec przestawienie dwoch kafelkow
    // miejscami pada tutaj, a nie dopiero w kwartalnym raporcie.
    const unique: GiftAdminStats = {
      active_links: 101,
      revoked_links: 102,
      expired_links: 103,
      exhausted_links: 104,
      total_created: 105,
      total_redeemed: 106,
      created_this_month: 107,
      redeemed_this_month: 108,
      unique_gifters: 109,
      unique_recipients: 110,
    };
    h.getStats.mockResolvedValue(unique);
    renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(screen.getByText(`giftingAdmin.stats.${labelKey}`)).toBeTruthy());
    expect(valueUnder(`giftingAdmin.stats.${labelKey}`)).toBe(String(unique[field]));
  });

  it("same zera to DANE, nie brak danych - szkielet znika", async () => {
    const zeros: GiftAdminStats = {
      active_links: 0,
      revoked_links: 0,
      expired_links: 0,
      exhausted_links: 0,
      total_created: 0,
      total_redeemed: 0,
      created_this_month: 0,
      redeemed_this_month: 0,
      unique_gifters: 0,
      unique_recipients: 0,
    };
    h.getStats.mockResolvedValue(zeros);
    const { container } = renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(valueUnder("giftingAdmin.stats.active")).toBe("0");
  });

  it("duze liczby sa grupowane (toLocaleString), a nie sklejone", async () => {
    h.getStats.mockResolvedValue(stats({ total_redeemed: 1234567 }));
    renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.totalRedeemed")).toBeTruthy());
    const shown = valueUnder("giftingAdmin.stats.totalRedeemed");
    expect(shown).not.toBe("1234567");
    expect(shown.replace(/\D/g, "")).toBe("1234567");
  });

  it("nie wnosi naruszen dostepnosci", async () => {
    h.getStats.mockResolvedValue(stats());
    const { container } = renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("StatsPanel - odmowa serwera", () => {
  it("blad odczytu nie wywraca panelu i nie zostawia wiecznego szkieletu", async () => {
    // `useQuery` bez `isError` w tym organizmie znaczy, ze awaria konczy sie
    // PUSTA siatka. To swiadomy kompromis (kafelki nie sa blokujace), ale
    // musi byc udokumentowany testem: pusta siatka to NIE jest szkielet,
    // wiec admin widzi, ze cos poszlo nie tak, zamiast czekac w nieskonczonosc.
    h.getStats.mockRejectedValue(new Error("Forbidden"));
    const { container } = renderWithQueryClient(<StatsPanel />);
    await waitFor(() => expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0));
    expect(screen.queryByText("giftingAdmin.stats.active")).toBeNull();
  });
});
