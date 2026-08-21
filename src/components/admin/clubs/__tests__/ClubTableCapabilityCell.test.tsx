// Molekuła komórki macierzy uprawnień - IKONA PLUS SŁOWO, dla każdej wartości.
//
// CO TEN PLIK DOWODZI. Macierz ma dziewięć kolumn ikon, więc sama ikona nie
// wystarcza: komórka MUSI mieć etykietę tekstową dla czytnika ekranu (`sr-only`)
// i podpowiedź dla wzroku (`title`). Test jedzie przez PEŁNĄ unię
// `CapabilityValue` (`yes`/`cond`/`no`) i sprawdza:
//   1. że każda wartość ma etykietę i że to KLUCZ i18n, nie polski napis,
//   2. że `cond` NIE wygląda jak `no` - „zależy od ustawień" i „nie wolno" to
//      dwie różne odpowiedzi, a pomyłka między nimi czyta się jak odcięcie,
//   3. że etykieta jest w komórce DWA razy (title + sr-only) - to nie
//      przypadek, tylko wymóg dostępności tabeli samych ikon.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) ZAWARTOŚCI macierzy - `capabilityMatrix.test.ts`.
// (2) Mapowania wartości na etykietę jako REKORDU - `adminClubPermissions.test.ts`.
// (3) Układu tabeli i podglądu - `ClubPermissionsTab.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubTableCapabilityCell } from "@/components/admin/clubs/molecules/ClubTableCapabilityCell";
import type { CapabilityValue } from "@/lib/clubs/capabilityMatrix";

const OCZEKIWANE: Record<CapabilityValue, string> = {
  yes: "adminClubs.permissions.value.yes",
  cond: "adminClubs.permissions.value.conditional",
  no: "adminClubs.permissions.value.no",
};

describe("komórka macierzy uprawnień", () => {
  it.each(["yes", "cond", "no"] as const)("wartość %s ma etykietę tekstową", (value) => {
    render(<ClubTableCapabilityCell value={value} />);

    const label = OCZEKIWANE[value];
    expect(screen.getByText(label).className).toContain("sr-only");
    expect(screen.getByTitle(label)).toBeTruthy();
  });

  it("„zależy od ustawień” nie jest tym samym co „nie wolno”", () => {
    const warunkowa = render(<ClubTableCapabilityCell value="cond" />);
    expect(screen.getByText(OCZEKIWANE.cond)).toBeTruthy();
    expect(screen.queryByText(OCZEKIWANE.no)).toBeNull();
    warunkowa.unmount();

    render(<ClubTableCapabilityCell value="no" />);
    expect(screen.getByText(OCZEKIWANE.no)).toBeTruthy();
    expect(screen.queryByText(OCZEKIWANE.cond)).toBeNull();
  });
});
