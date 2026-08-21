// Molekuła: ustawienie działu ze słownika, które może dziedziczyć z klubu.
//
// CO TEN PLIK DOWODZI.
//   1. DROPLISTA JEST WYŁĄCZONA Z DWÓCH POWODÓW NARAZ: gdy trwa zapis ALBO gdy
//      wartość jest dziedziczona. Zgubienie drugiego członka daje droplistę,
//      którą można ruszyć przy włączonym dziedziczeniu - i wybór, który nigdzie
//      nie poleci, bo payload wysyła wtedy pusty string. Na ekranie wygląda to
//      jak zapisana zmiana, która „sama się cofa".
//   2. PRZEŁĄCZNIK ODDAJE INTENCJĘ ODWROTNĄ DO STANU: z dziedziczenia w
//      nadpisanie i z powrotem. Przełącznik, który zawsze woła `true`, blokuje
//      nadpisanie na zawsze.
//   3. WARTOŚĆ WYBRANA Z DROPLISTY WYCHODZI Z MOLEKUŁY - i wychodzi wartość ze
//      SŁOWNIKA, nie dowolny napis.
//   4. OPCJE POCHODZĄ Z PRZEKAZANEJ TABLICY, a nie z wiedzy molekuły o polu -
//      dzięki temu ta sama molekuła obsługuje widoczność (dwa różne słowniki),
//      politykę zakładania tematu, moderację i atrybucję.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Zawężenia widoczności przy zdjęciu
// dziedziczenia - to `clubGroupOverridePatch` z tabelą w
// `adminClubGroupForm.test.ts`. (2) Kontraktu pustego stringa w payloadzie -
// `clubGroupSavePayload` tam samo. (3) Atomu `InheritedField` (etykieta
// „dziedziczone/nadpisz", wyszarzenie) - `InheritedField.test.tsx`.
// (4) Molekuły `ClubEnumSelect` (składanie kluczy opcji, zawężanie wartości
// z Radiksa) - ma własny test. Radix Select nie działa pod happy-dom bez
// pełnego pointer API, więc podmieniamy go na natywny `<select>`.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
  type ClubPostPolicy,
} from "@/lib/clubs/types";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      data-testid="droplista"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ClubDialogInheritedEnum } from "@/components/admin/clubs/molecules/ClubDialogInheritedEnum";

function renderujPolityke(
  props: {
    inherited?: boolean;
    disabled?: boolean;
    value?: ClubPostPolicy;
  } = {},
) {
  const onToggleInherit = vi.fn();
  const onValueChange = vi.fn();
  render(
    <ClubDialogInheritedEnum
      labelKey="adminClubs.fields.whoCanPost"
      i18nPrefix="club.whoCanPost"
      value={props.value ?? "moderators"}
      options={CLUB_POST_POLICIES}
      inherited={props.inherited ?? true}
      disabled={props.disabled}
      onToggleInherit={onToggleInherit}
      onValueChange={onValueChange}
    />,
  );
  return {
    onToggleInherit,
    onValueChange,
    droplista: screen.getByTestId<HTMLSelectElement>("droplista"),
  };
}

describe("ClubDialogInheritedEnum - wyłączanie dropListy", () => {
  it("wartość DZIEDZICZONA wyłącza droplistę, choć zapis nie trwa", () => {
    // Regresja, którą to łapie: droplista czynna przy dziedziczeniu przyjmuje
    // wybór, którego payload nie wyśle (jedzie pusty string) - na ekranie
    // wygląda to jak zmiana, która sama się cofa po odświeżeniu.
    expect(renderujPolityke({ inherited: true, disabled: false }).droplista).toBeDisabled();
  });

  it("wartość NADPISANA przy zapisie w locie też jest wyłączona", () => {
    expect(renderujPolityke({ inherited: false, disabled: true }).droplista).toBeDisabled();
  });

  it("wartość nadpisana i brak zapisu - droplista jest czynna", () => {
    expect(renderujPolityke({ inherited: false, disabled: false }).droplista).toBeEnabled();
  });

  it("brak flagi zapisu (undefined) czyta się jak „nie zapisuję”", () => {
    // Gałąź `disabled ?? false`: bez niej `undefined || inherited` dawałoby
    // wartość nie-logiczną w atrybucie DOM.
    expect(renderujPolityke({ inherited: false }).droplista).toBeEnabled();
  });
});

describe("ClubDialogInheritedEnum - przełącznik dziedziczenia", () => {
  it("z dziedziczenia przełącza w NADPISANIE", () => {
    const { onToggleInherit } = renderujPolityke({ inherited: true });
    fireEvent.click(screen.getByRole("button"));
    expect(onToggleInherit).toHaveBeenCalledTimes(1);
    expect(onToggleInherit).toHaveBeenCalledWith(false);
  });

  it("z nadpisania przełącza w DZIEDZICZENIE - obie strony działają", () => {
    const { onToggleInherit } = renderujPolityke({ inherited: false });
    fireEvent.click(screen.getByRole("button"));
    expect(onToggleInherit).toHaveBeenCalledWith(true);
  });

  it("przełącznik jest wyłączony na czas zapisu", () => {
    renderujPolityke({ inherited: true, disabled: true });
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("ClubDialogInheritedEnum - wartość i słownik", () => {
  it("wybór z dropListy wychodzi z molekuły jako wartość ze słownika", () => {
    const { onValueChange, droplista } = renderujPolityke({ inherited: false });
    fireEvent.change(droplista, { target: { value: "staff_only" } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("staff_only");
  });

  it("etykieta pola i etykiety opcji renderują KLUCZE i18n", () => {
    renderujPolityke({ inherited: false });
    expect(screen.getByText("adminClubs.fields.whoCanPost")).toBeInTheDocument();
    for (const option of CLUB_POST_POLICIES) {
      expect(screen.getByText(`club.whoCanPost.${option}`)).toBeInTheDocument();
    }
  });

  it("ta sama molekuła obsługuje SZERSZY słownik widoczności klubu", () => {
    // To jest cały sens przekazywania tablicy: dziedziczona widoczność musi
    // umieć wyrenderować `public`, którego słownik działu nie zna.
    const onValueChange = vi.fn();
    render(
      <ClubDialogInheritedEnum
        labelKey="adminClubs.fields.visibility"
        i18nPrefix="club.visibility"
        value="public"
        options={CLUB_VISIBILITIES}
        inherited
        onToggleInherit={() => undefined}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByText("club.visibility.public")).toBeInTheDocument();
    expect(screen.getByTestId<HTMLSelectElement>("droplista").value).toBe("public");
  });

  it("i WĘŻSZY słownik trybu moderacji - liczba opcji idzie z wejścia", () => {
    render(
      <ClubDialogInheritedEnum
        labelKey="adminClubs.fields.moderationMode"
        i18nPrefix="club.moderation"
        value="trusted"
        options={CLUB_MODERATION_MODES}
        inherited={false}
        onToggleInherit={() => undefined}
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(CLUB_MODERATION_MODES.length);
  });
});
