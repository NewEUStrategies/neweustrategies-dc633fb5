// Zakładka „Uprawnienia" - SKLEJENIE macierzy z podglądem realnym.
//
// CO TEN PLIK DOWODZI.
//   1. MACIERZ RENDERUJE SIĘ CAŁA: dziewięć zdolności na osiem ról, każda
//      komórka z etykietą tekstową. Macierz jest dokumentacją migracji
//      `club_capabilities` - wiersz, który wypadł z widoku, znaczy regułę,
//      o której nikt się nie dowie.
//   2. ZAPYTANIE PODGLĄDU NIE LECI BEZ OSOBY. Organizm woła hook z `userId:
//      undefined`, dopóki nikt nie jest wybrany - to `undefined` wyłącza
//      zapytanie, a nie tylko chowa wynik.
//   3. WYBÓR OSOBY ZMIENIA ARGUMENT zapytania, a wyczyszczenie wyboru wraca do
//      stanu „wybierz osobę" - obie drogi przez REALNE kliknięcie w atrapę
//      wyboru członka.
//   4. CZTERY STANY PODGLĄDU MAJĄ CZTERY RÓŻNE WIDOKI: prośba o wybór,
//      szkielet, wynik, oraz AWARIA RPC, która nie udaje pustki ani szkieletu.
//   5. PODGLĄD POKAZUJE POWÓD - z kluczem powodu, gdy jest, i z osobną
//      etykietą „brak przeszkód", gdy powodu nie ma. Bez tego administrator
//      widzi „nie może", ale nie wie dlaczego.
//   6. ETYKIETY WYBORU CZŁONKA IDĄ Z i18n panelu, a nie z propsów rodzica -
//      atrapa pokazuje je jako klucze.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) ZAWARTOŚCI macierzy ani inwariantu
// „super_admin przechodzi wszystko, co admin" - `capabilityMatrix.test.ts`.
// (2) Czterech stanów jako REGUŁY (kolejność sprawdzeń) - to tabela przypadków
// w `lib/clubs/__tests__/adminClubPermissions.test.ts`; tutaj dowodzimy, że
// organizm ją WOŁA i rysuje jej wynik. (3) Ikony komórki - `ClubTableCapabilityCell.test.tsx`.
// (4) Autorytetu: prawdą o dostępie jest `club_capabilities()` w bazie (pgTAP),
// a nie ten ekran.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ClubCapabilities } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  osoba: "user-member",
  previewCalls: [] as { clubId: string | undefined; userId: string | undefined }[],
  caps: undefined as ClubCapabilities | undefined,
  isPending: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
// `MemberPicker` stoi na Radix Popover, który pod happy-dom nie otwiera się bez
// pełnego pointer API. Przedmiotem dowodu jest to, CO organizm robi z wyborem
// (i jakie etykiety mu podaje), a nie mechanika listy - więc atrapa natywna.
vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: ({
    value,
    onChange,
    labels,
  }: {
    value: string;
    onChange: (userId: string) => void;
    labels: Record<string, string>;
  }) => (
    <div data-testid="wybor-osoby" data-wartosc={value}>
      <button type="button" onClick={() => onChange(h.osoba)}>
        {labels.placeholder}
      </button>
      <button type="button" onClick={() => onChange("")}>
        {labels.clear}
      </button>
      <span>{labels.search}</span>
      <span>{labels.empty}</span>
    </div>
  ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubCapabilitiesPreview: (params: {
    clubId: string | undefined;
    userId: string | undefined;
  }) => {
    h.previewCalls.push(params);
    return { data: h.caps, isPending: h.isPending };
  },
}));

import { ClubPermissionsTab } from "@/components/admin/clubs/organisms/ClubPermissionsTab";
import { CAPABILITY_KEYS, CAPABILITY_ROLES } from "@/lib/clubs/capabilityMatrix";
import { NO_CLUB_CAPABILITIES } from "@/lib/clubs/types";
import { CLUB_IDS } from "@/test/clubs/fixtures";

function caps(overrides: Partial<ClubCapabilities> = {}): ClubCapabilities {
  return { ...NO_CLUB_CAPABILITIES, ...overrides };
}

function panel() {
  return render(<ClubPermissionsTab clubId={CLUB_IDS.club} />);
}

/** Ostatnie argumenty, z jakimi organizm zawołał podgląd zdolności. */
function ostatnieZapytanie(): { clubId: string | undefined; userId: string | undefined } {
  const last = h.previewCalls[h.previewCalls.length - 1];
  if (last === undefined) throw new Error("organizm nie zawołał podglądu");
  return last;
}

/** Kafelek podglądu dla danej zdolności - drugie wystąpienie klucza (pierwsze jest w macierzy). */
function kafelek(key: string): HTMLElement {
  const wystapienia = screen.getAllByText(`adminClubs.permissions.caps.${key}`);
  const tile = wystapienia[1]?.parentElement;
  if (!tile) throw new Error(`brak kafelka podglądu dla ${key}`);
  return tile;
}

function wybierzOsobe(): void {
  fireEvent.click(
    within(screen.getByTestId("wybor-osoby")).getByText("adminClubs.permissions.previewAs"),
  );
}

beforeEach(() => {
  h.previewCalls = [];
  h.caps = undefined;
  h.isPending = false;
  h.osoba = CLUB_IDS.member;
});

describe("macierz zdolności", () => {
  it("rysuje wiersz na zdolność i kolumnę na rolę", () => {
    panel();

    // Dziewięć wierszy danych plus wiersz nagłówka.
    expect(screen.getAllByRole("row")).toHaveLength(CAPABILITY_KEYS.length + 1);
    for (const role of CAPABILITY_ROLES) {
      expect(screen.getByText(`adminClubs.permissions.roles.${role}`)).toBeTruthy();
    }
    for (const key of CAPABILITY_KEYS) {
      expect(screen.getByText(`adminClubs.permissions.caps.${key}`)).toBeTruthy();
    }
  });

  it("każda komórka ma etykietę tekstową, nie tylko ikonę", () => {
    panel();

    const etykiety = [
      ...screen.getAllByText("adminClubs.permissions.value.yes"),
      ...screen.getAllByText("adminClubs.permissions.value.conditional"),
      ...screen.getAllByText("adminClubs.permissions.value.no"),
    ];

    expect(etykiety).toHaveLength(CAPABILITY_KEYS.length * CAPABILITY_ROLES.length);
  });
});

describe("podgląd jako wskazana osoba", () => {
  it("bez wybranej osoby zapytanie NIE leci, a ekran prosi o wybór", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({ clubId: CLUB_IDS.club, userId: undefined });
    expect(screen.getByText("adminClubs.permissions.previewEmpty")).toBeTruthy();
  });

  it("etykiety wyboru członka jadą ze słownika panelu", () => {
    panel();

    const picker = within(screen.getByTestId("wybor-osoby"));
    expect(picker.getByText("adminClubs.permissions.previewAs")).toBeTruthy();
    expect(picker.getByText("adminClubs.searchPlaceholder")).toBeTruthy();
    expect(picker.getByText("adminClubs.members.empty")).toBeTruthy();
    expect(picker.getByText("adminClubs.filterAny")).toBeTruthy();
  });

  it("wybór osoby zmienia argument zapytania", () => {
    panel();

    wybierzOsobe();

    expect(ostatnieZapytanie()).toEqual({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member });
    expect(screen.getByTestId("wybor-osoby").getAttribute("data-wartosc")).toBe(CLUB_IDS.member);
  });

  it("wyczyszczenie wyboru wraca do prośby o wybór i gasi zapytanie", () => {
    panel();
    wybierzOsobe();

    fireEvent.click(within(screen.getByTestId("wybor-osoby")).getByText("adminClubs.filterAny"));

    expect(ostatnieZapytanie().userId).toBeUndefined();
    expect(screen.getByText("adminClubs.permissions.previewEmpty")).toBeTruthy();
  });

  it("zapytanie W LOCIE pokazuje szkielet, a nie pustkę", () => {
    h.isPending = true;
    panel();
    wybierzOsobe();

    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText("adminClubs.permissions.previewEmpty")).toBeNull();
  });

  it("AWARIA zapytania nie udaje ani pustki, ani szkieletu", () => {
    h.isPending = false;
    h.caps = undefined;
    panel();
    wybierzOsobe();

    expect(screen.queryByText("adminClubs.permissions.previewEmpty")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
    expect(screen.queryByText("adminClubs.permissions.effectiveRole")).toBeNull();
  });

  it("odpowiedź RPC pokazuje rolę, POWÓD i zdolności czytane z bazy", () => {
    h.caps = caps({
      effectiveRole: "observer",
      reason: "tier_too_low",
      canRead: true,
      canSeeMembers: true,
    });
    panel();
    wybierzOsobe();

    expect(screen.getByText("club.role.observer")).toBeTruthy();
    expect(screen.getByText("club.reason.tier_too_low")).toBeTruthy();
    // Kafelek zdolności przyznanej ma ptaszek, odmówionej - minus.
    expect(kafelek("can_read").querySelector(".text-emerald-600")).toBeTruthy();
    expect(kafelek("can_moderate").querySelector(".text-muted-foreground\\/60")).toBeTruthy();
  });

  it("brak przeszkód ma własną etykietę, nie klucz bez ogona", () => {
    h.caps = caps({ effectiveRole: "lead", reason: null, canManage: false });
    panel();
    wybierzOsobe();

    expect(screen.getByText("adminClubs.permissions.reasonNone")).toBeTruthy();
    expect(screen.getByText("club.role.lead")).toBeTruthy();
  });

  it("podgląd wymienia WSZYSTKIE zdolności, także odmówione", () => {
    h.caps = caps({ effectiveRole: "non_member", reason: "not_member" });
    panel();
    wybierzOsobe();

    for (const key of CAPABILITY_KEYS) {
      expect(screen.getAllByText(`adminClubs.permissions.caps.${key}`)).toHaveLength(2);
    }
  });
});
