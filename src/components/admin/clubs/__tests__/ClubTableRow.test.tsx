// Molekuła wiersza tabelarycznego listy klubów - CO widzi administrator.
//
// CO TEN PLIK DOWODZI. Wiersz jest gotową projekcją (`ClubsTableRowView`), więc
// tutaj przedmiotem dowodu jest wyłącznie znacznik:
//   1. NAZWA JEST LINKIEM DO EDYTORA, i to linkiem z rozwiązanym adresem
//      (`/admin/community/clubs/club-1`), a nie szablonem trasy.
//   2. AKCJE MAJĄ DOSTĘPNE NAZWY: podgląd publiczny (nowa karta, `rel`)
//      i edycja (`sr-only`), bo kolumna „Akcje" jest w nagłówku ukryta dla
//      wzroku - czytnik ekranu musi ją odczytać z samych przycisków.
//   3. ZGŁOSZENIA MAJĄ DWA WARIANTY: licznik w bursztynowym znaczniku
//      i kreska. Kreska, nie pustka - pusta komórka czyta się jak błąd
//      wczytywania.
//   4. ZNACZNIKI dostają ZAWĘŻONE wartości, więc wiersz z kolumną CHECK-ową
//      z innej migracji (`status: "published"` w atrapie RPC) renderuje klucz
//      wersji roboczej, a nie pustą klasę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł projekcji (zawężenie, kreska, data,
// prowadzący) - mają tabelę przypadków w `lib/clubs/__tests__/adminClubsTable.test.ts`;
// tu wchodzą przez PRAWDZIWĄ projekcję, żeby test nie opisywał widoku, którego
// nie ma. (2) Tonów znaczników - `ClubBadges.test.tsx`. (3) Dwóch układów listy
// i nagłówka kolumn - `ClubsTable.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubTableRow } from "@/components/admin/clubs/molecules/ClubTableRow";
import { Table, TableBody } from "@/components/ui/table";
import { clubsTableRowView } from "@/lib/clubs/adminClubsTable";
import type { AdminClubRow } from "@/lib/clubs/types";
import { adminClubRow } from "@/test/clubs/fixtures";

function renderRow(overrides: Partial<AdminClubRow> = {}, children?: ReactNode) {
  const view = clubsTableRowView(adminClubRow(overrides), "pl");
  return render(
    <Table>
      <TableBody>
        <ClubTableRow view={view} />
        {children}
      </TableBody>
    </Table>,
  );
}

describe("wiersz tabeli klubów", () => {
  it("nazwa prowadzi do edytora klubu, a pod nią jest adres", () => {
    renderRow();

    const link = screen.getByRole("link", { name: "Klub energetyczny" });
    expect(link.getAttribute("href")).toBe("/admin/community/clubs/club-1");
    expect(screen.getByText("/klub-energetyczny")).toBeTruthy();
  });

  it("podgląd publiczny otwiera nową kartę i ma dostępną nazwę", () => {
    renderRow();

    const preview = screen.getByRole("link", { name: "adminClubs.openPublic" });
    expect(preview.getAttribute("href")).toBe("/club/klub-energetyczny");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toBe("noreferrer");
  });

  it("edycja ma nazwę tylko dla czytnika ekranu", () => {
    renderRow();

    expect(screen.getByText("adminClubs.editClub").className).toContain("sr-only");
  });

  it("liczniki i prowadzący jadą z projekcji", () => {
    renderRow({ group_count: 7, member_count: 120, thread_count: 33 });

    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("33")).toBeTruthy();
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
  });

  it("oczekujące zgłoszenia dostają licznik w znaczniku", () => {
    renderRow({ pending_count: 5 });

    const badge = screen.getByText("5");
    expect(badge.className).toContain("bg-amber-500/15");
  });

  it("brak zgłoszeń to KRESKA, nie pusta komórka", () => {
    renderRow({ pending_count: 0, lead_names: [], last_activity_at: "" });

    // Trzy kreski: zgłoszenia, prowadzący, ostatnia aktywność.
    expect(screen.getAllByText("-")).toHaveLength(3);
  });

  it("status z innej migracji renderuje wersję roboczą, nie pustkę", () => {
    // `adminClubRow()` oddaje `status: "published"` - dokładnie taką wartość
    // widzi panel, gdy CHECK zmienił się w bazie, a słownik nie.
    renderRow();

    expect(screen.getByText("club.status.draft")).toBeTruthy();
    expect(screen.getByText("club.visibility.public")).toBeTruthy();
  });

  it("data ostatniej aktywności jest sformatowana po polsku", () => {
    renderRow();

    expect(screen.getByText(/sie 2026/)).toBeTruthy();
  });
});
