// Molekuła karty klubu (układ poniżej `lg`) - KLIK W KARCIE, KTÓRA JEST LINKIEM.
//
// CO TEN PLIK DOWODZI.
//   1. CAŁA KARTA JEST LINKIEM do edytora - z rozwiązanym adresem, nie
//      z szablonem trasy.
//   2. PODGLĄD PUBLICZNY WEWNĄTRZ TEGO LINKU zatrzymuje zdarzenie: bez
//      `preventDefault` przeglądarka rusza za linkiem karty, a administrator
//      dostaje edytor ZAMIAST podglądu. Test sprawdza JEDNO I DRUGIE -
//      że domyślna akcja została odwołana i że nowa karta dostała `noopener`.
//   3. KARTA POKAZUJE TE SAME DANE, co wiersz tabeli (liczniki, znaczniki,
//      data) - to dwa układy jednej treści, a nie dwa widoki.
//   4. ZNACZNIK ZGŁOSZEŃ ma dwa warianty; na karcie brak zgłoszeń NIE rysuje
//      kreski (jest miejsce, żeby po prostu nic nie mówić), i to jest jedyna
//      różnica względem tabeli.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł projekcji wiersza - `lib/clubs/__tests__/adminClubsTable.test.ts`.
// (2) Tonów znaczników - `ClubBadges.test.tsx`. (3) Progu `lg` (klasy `hidden
// lg:block` / `lg:hidden`) - to `ClubsTable.test.tsx`, bo decyzja o dwóch
// układach należy do organizmu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubTableCard } from "@/components/admin/clubs/molecules/ClubTableCard";
import { clubsTableRowView } from "@/lib/clubs/adminClubsTable";
import type { AdminClubRow } from "@/lib/clubs/types";
import { adminClubRow } from "@/test/clubs/fixtures";

function renderCard(overrides: Partial<AdminClubRow> = {}) {
  return render(<ClubTableCard view={clubsTableRowView(adminClubRow(overrides), "pl")} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("karta klubu", () => {
  it("cała karta prowadzi do edytora", () => {
    renderCard();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/community/clubs/club-1");
    expect(screen.getByText("Klub energetyczny")).toBeTruthy();
    expect(screen.getByText("/klub-energetyczny")).toBeTruthy();
  });

  it("pokazuje liczniki, znaczniki i datę", () => {
    renderCard({ group_count: 3, member_count: 42, thread_count: 12 });

    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("club.status.draft")).toBeTruthy();
    expect(screen.getByText("club.visibility.public")).toBeTruthy();
    expect(screen.getByText(/sie 2026/)).toBeTruthy();
  });

  it("podgląd publiczny NIE pozwala linkowi karty ruszyć", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderCard();

    const notCancelled = fireEvent.click(
      screen.getByRole("button", { name: /adminClubs.openPublic/ }),
    );

    // `fireEvent` zwraca `false`, gdy zdarzenie zostało odwołane - to jest
    // dowód na `preventDefault`, którego sam `window.open` nie daje.
    expect(notCancelled).toBe(false);
    expect(open).toHaveBeenCalledWith("/club/klub-energetyczny", "_blank", "noopener,noreferrer");
  });

  it("brak aktywności i brak prowadzących nie wywraca karty", () => {
    renderCard({ last_activity_at: "", lead_names: [], pending_count: 0 });

    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText(/adminClubs.columns.pending/)).toBeNull();
  });

  it("oczekujące zgłoszenia dostają własny znacznik z liczbą", () => {
    renderCard({ pending_count: 4 });

    expect(screen.getByText(/adminClubs.columns.pending/).textContent).toContain("4");
  });
});
