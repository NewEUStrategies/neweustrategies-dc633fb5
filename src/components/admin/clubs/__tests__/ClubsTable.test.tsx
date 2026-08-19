// Organizm tabeli klubów - SKLEJENIE dwóch układów z jednej projekcji.
//
// CO TEN PLIK DOWODZI.
//   1. DWA UKŁADY, JEDNA TREŚĆ. Ten sam klub renderuje się jako wiersz tabeli
//      (od `lg`) I jako karta (niżej) - oba warianty są w drzewie równocześnie,
//      przełącza je CSS. Test liczy je OSOBNO, bo regresją, której nie widać
//      w przeglądarce na szerokim ekranie, jest zniknięcie kart.
//   2. LISTA PUSTA NIE ZNACZY EKRAN PUSTY: nagłówek kolumn zostaje (to on mówi,
//      czego tu nie ma), a wierszy jest zero. Komunikat „brak klubów" należy do
//      trasy, nie do tabeli - dlatego tabela go NIE renderuje.
//   3. JĘZYK INTERFEJSU WYBIERA KOLUMNĘ NAZWY i format daty - organizm
//      wyprowadza go sam z `i18n.language`, bez propsa.
//   4. KOMPLET DZIESIĘCIU KOLUMN w nagłówku, z kolumną akcji ukrytą dla wzroku
//      (`sr-only`) - poziomy scroll w tabeli panelu schowałby akcje dokładnie
//      wtedy, gdy są potrzebne, więc kolumna jest wąska i bez widocznej nazwy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł projekcji wiersza (zawężenie kolumn
// CHECK-owych, kreska, data, prowadzący) - `lib/clubs/__tests__/adminClubsTable.test.ts`.
// (2) Znacznika wiersza i karty - `ClubTableRow.test.tsx` i `ClubTableCard.test.tsx`.
// (3) Filtrów, stronicowania i trzech stanów listy - to trasa
// `admin.community.clubs.index.tsx` i `src/routes/__tests__/adminClubRoutes.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () => {
  const stub = await import("@/test/i18nStub");
  return stub.reactI18nextStub(() => h.lang);
});
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubsTable } from "@/components/admin/clubs/organisms/ClubsTable";
import type { AdminClubRow } from "@/lib/clubs/types";
import { CLUB_IDS, adminClubRow, clubIsoOffset } from "@/test/clubs/fixtures";

/** Kontener układu tabelarycznego (widoczny od `lg`). */
function tabela(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("div.hidden.lg\\:block");
  if (node === null) throw new Error("brak układu tabelarycznego");
  return node;
}

/** Kontener układu kartowego (widoczny poniżej `lg`). */
function karty(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("div.lg\\:hidden");
  if (node === null) throw new Error("brak układu kartowego");
  return node;
}

function renderTable(rows: AdminClubRow[]) {
  return render(<ClubsTable rows={rows} />);
}

beforeEach(() => {
  h.lang = "pl";
});

describe("dwa układy jednej listy", () => {
  it("każdy klub jedzie i jako wiersz tabeli, i jako karta", () => {
    const { container } = renderTable([
      adminClubRow({ id: CLUB_IDS.club, slug: "pierwszy", name_pl: "Pierwszy" }),
      adminClubRow({ id: CLUB_IDS.otherClub, slug: "drugi", name_pl: "Drugi" }),
    ]);

    // Wiersze danych: wszystkie `<tr>` minus wiersz nagłówka.
    expect(within(tabela(container)).getAllByRole("row")).toHaveLength(3);
    // Karta jest jednym linkiem na klub.
    expect(within(karty(container)).getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText("Pierwszy")).toHaveLength(2);
    expect(screen.getAllByText("Drugi")).toHaveLength(2);
  });

  it("lista PUSTA zostawia nagłówek kolumn i zero wierszy", () => {
    const { container } = renderTable([]);

    expect(within(tabela(container)).getAllByRole("row")).toHaveLength(1);
    expect(within(karty(container)).queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("adminClubs.columns.name")).toBeTruthy();
  });

  it("nagłówek wymienia wszystkie kolumny, a akcje są tylko dla czytnika", () => {
    renderTable([adminClubRow()]);

    for (const kolumna of [
      "name",
      "visibility",
      "groups",
      "members",
      "threads",
      "pending",
      "leads",
      "lastActivity",
      "status",
      "actions",
    ]) {
      expect(screen.getByText(`adminClubs.columns.${kolumna}`)).toBeTruthy();
    }
    expect(screen.getByText("adminClubs.columns.actions").className).toContain("sr-only");
  });
});

describe("język i dane wiersza", () => {
  it("polski interfejs bierze nazwę z kolumny polskiej i polski format daty", () => {
    renderTable([adminClubRow()]);

    expect(screen.getAllByText("Klub energetyczny")).toHaveLength(2);
    expect(screen.getAllByText(/sie 2026/)).toHaveLength(2);
  });

  it("angielski interfejs bierze nazwę z kolumny angielskiej i inny format daty", () => {
    h.lang = "en";
    renderTable([adminClubRow()]);

    expect(screen.getAllByText("Energy club")).toHaveLength(2);
    expect(screen.getAllByText(/Aug 2026/)).toHaveLength(2);
  });

  it("wiersz CZĘŚCIOWY: brak aktywności i brak prowadzących nie wywraca żadnego układu", () => {
    const { container } = renderTable([
      adminClubRow({ last_activity_at: "", lead_names: [], pending_count: 0 }),
    ]);

    // Tabela: trzy kreski (zgłoszenia, prowadzący, aktywność). Karta: jedna
    // (aktywność) - brak zgłoszeń na karcie po prostu milczy.
    expect(within(tabela(container)).getAllByText("-")).toHaveLength(3);
    expect(within(karty(container)).getAllByText("-")).toHaveLength(1);
  });

  it("wiersz z aktywnością i zgłoszeniami pokazuje licznik w obu układach", () => {
    const { container } = renderTable([
      adminClubRow({ pending_count: 2, last_activity_at: clubIsoOffset(-60) }),
    ]);

    expect(within(tabela(container)).getByText("2")).toBeTruthy();
    expect(within(karty(container)).getByText(/adminClubs.columns.pending/)).toBeTruthy();
  });

  it("status spoza słownika degraduje się w OBU układach, nie tylko w jednym", () => {
    renderTable([adminClubRow()]);

    expect(screen.getAllByText("club.status.draft")).toHaveLength(2);
    expect(screen.getAllByText("club.visibility.public")).toHaveLength(2);
  });
});
