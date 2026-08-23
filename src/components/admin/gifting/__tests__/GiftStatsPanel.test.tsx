// Organizm paska statystyk gifting - CO PANEL MÓWI, GDY ODCZYT SIĘ NIE UDA.
//
// CO TEN PLIK DOWODZI.
//   1. DZIESIĘĆ POLI ODPOWIEDZI JEST PODPISANE DZIESIĘCIOMA WŁAŚCIWYMI
//      ETYKIETAMI, w ustalonej kolejności. Mapowanie 10 → 10 to dokładnie ten
//      rodzaj kodu, w którym przestawienie dwóch linii jest niewidoczne dla tsc
//      (wszystkie pola są `number`), a admin czyta „cofnięte" jako „wygasłe" i
//      podejmuje decyzję o polityce paywalla na przekłamanych liczbach.
//   2. W LOCIE WIDAĆ DZIESIĘĆ SZKIELETÓW I ZERO LICZB - pasek nie miga zerami,
//      które admin mógłby wziąć za „brak ruchu".
//   3. AWARIA ODCZYTU NIE JEST ZAKOMUNIKOWANA (defekt, `it.fails` niżej): pasek
//      po prostu znika. Klucz `giftingAdmin.common.error` leży w słowniku
//      nieużywany.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formatowania liczby i wysokości szkieletu -
// to `GiftStatCard.test.tsx`. Tego, że pasek stoi NAD zakładkami i nie
// odmontowuje się przy ich przełączaniu - `src/routes/__tests__/adminGiftingRoute.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({ getStats: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));
// `useServerFn` w produkcji owija server fn w wywołanie RPC; w teście
// przepuszczamy tożsamość, żeby asercja widziała ten sam obiekt wywołania.
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/gifting-admin.functions", () => ({ getGiftAdminStats: h.getStats }));

import { GiftStatsPanel } from "@/components/admin/gifting/organisms/GiftStatsPanel";

/** Dziesięć RÓŻNYCH liczb - inaczej przestawienie pól byłoby niewidoczne. */
const STATY = {
  active_links: 11,
  created_this_month: 22,
  redeemed_this_month: 33,
  total_created: 44,
  total_redeemed: 55,
  unique_gifters: 66,
  unique_recipients: 77,
  exhausted_links: 88,
  revoked_links: 99,
  expired_links: 101,
};

const OCZEKIWANE: Array<[string, number]> = [
  ["giftingAdmin.stats.active", 11],
  ["giftingAdmin.stats.createdThisMonth", 22],
  ["giftingAdmin.stats.redeemedThisMonth", 33],
  ["giftingAdmin.stats.totalCreated", 44],
  ["giftingAdmin.stats.totalRedeemed", 55],
  ["giftingAdmin.stats.gifters", 66],
  ["giftingAdmin.stats.recipients", 77],
  ["giftingAdmin.stats.exhausted", 88],
  ["giftingAdmin.stats.revoked", 99],
  ["giftingAdmin.stats.expired", 101],
];

beforeEach(() => {
  h.getStats.mockReset();
});

describe("pasek statystyk gifting", () => {
  it("podpisuje KAŻDE z dziesięciu pól odpowiedzi właściwą etykietą i w tej kolejności", async () => {
    h.getStats.mockResolvedValue(STATY);
    const { container } = renderWithQueryClient(<GiftStatsPanel />);

    await screen.findByText("giftingAdmin.stats.active");

    const kafle = [...container.querySelectorAll(".bg-card")];
    expect(kafle).toHaveLength(10);
    expect(
      kafle.map((k) => [k.firstElementChild?.textContent, Number(k.lastElementChild?.textContent)]),
    ).toEqual(OCZEKIWANE);
  });

  it("odczyt w locie pokazuje dziesięć szkieletów i ANI JEDNEJ liczby", () => {
    h.getStats.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithQueryClient(<GiftStatsPanel />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(10);
    expect(container.textContent).toBe("");
  });

  it("odczyt idzie bez argumentów - statystyki nie są parametryzowane", async () => {
    h.getStats.mockResolvedValue(STATY);
    renderWithQueryClient(<GiftStatsPanel />);

    await screen.findByText("giftingAdmin.stats.active");

    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(h.getStats.mock.calls[0]).toEqual([]);
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("awaria odczytu statystyk MÓWI o awarii, zamiast pokazać puste miejsce", async () => {
    // Oczekiwane: odmowa (np. requireAdminEditor odrzuca redaktora bez MFA)
    // zapala komunikat `giftingAdmin.common.error` - klucz JEST w słowniku i
    // nikt go nie woła. Dziś `useQuery` oddaje tu tylko `data` i `isLoading`,
    // gałęzi `isError` nie ma wcale.
    h.getStats.mockRejectedValue(new Error("Forbidden"));
    renderWithQueryClient(<GiftStatsPanel />);

    await waitFor(() => expect(screen.getByText("giftingAdmin.common.error")).toBeTruthy());
  });

  it("STAN FAKTYCZNY: przy awarii pasek statystyk po prostu znika (zero komunikatu)", async () => {
    h.getStats.mockRejectedValue(new Error("Forbidden"));
    const { container } = renderWithQueryClient(<GiftStatsPanel />);

    // Admin czyta puste miejsce jako „brak ruchu", a nie „brak odczytu".
    await waitFor(() => expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0));
    expect(container.querySelectorAll(".bg-card")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});
