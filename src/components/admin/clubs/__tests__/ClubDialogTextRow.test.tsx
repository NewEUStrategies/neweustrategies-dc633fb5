// Molekuła: wiersz tekstowy dialogu panelu klubów.
//
// CO TEN PLIK DOWODZI.
//   1. ETYKIETA JEST POWIĄZANA Z POLEM przez `id`. To nie kosmetyka: bez tego
//      powiązania nie da się kliknąć etykiety, czytnik ekranu czyta pole jako
//      bezimienne, a test formularza musi zgadywać kolejność pól zamiast pytać
//      o nazwę.
//   2. POLE ODDAJE TREŚĆ, KTÓRĄ WPISANO - dokładnie raz i dokładnie tę.
//      Molekuła nie wie, do którego klucza wersji roboczej treść trafi, więc
//      pomyłka „etykieta angielska, klucz polski" nie ma tu gdzie się schować.
//   3. LICZBA WIERSZY WYBIERA RODZAJ POLA: brak = jednolinijkowe, obecna =
//      wielolinijkowe. Limit znaków odwzorowuje limit kolumny w bazie, więc
//      pole bez limitu przyjmuje treść, której zapis wróci błędem serwera -
//      czyli piszący traci wpisany tekst.
//   4. ZASTĘPCZA TREŚĆ GOTOWA BIJE SŁOWNIK. Nazwa angielska odbija wpisaną
//      nazwę polską (bo właśnie nią się zapisze), a gdy tamta jest pusta -
//      odbija pustkę, nie podpowiedź ze słownika.
//   5. TYP POLA HTML PRZECHODZI (`datetime-local` harmonogramu działu) - bez
//      niego przeglądarka pokazuje zwykłe pole tekstowe i przyjmuje śmieć.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Samych `Input`/`Textarea`/`Label`
// z `components/ui` - to biblioteka. (2) Istnienia kluczy w słownikach - robi
// to `adminClubsI18nLoading.gate.test.ts`; tutaj asercje idą po KLUCZACH.
// (3) Reguły, KTÓRE pole formularza dostaje jaki klucz - to testy organizmów
// (`ClubCreateDialog.test.tsx`, `ClubGroupEditorDialog.test.tsx`).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubDialogTextRow } from "@/components/admin/clubs/molecules/ClubDialogTextRow";

describe("ClubDialogTextRow - pole jednolinijkowe", () => {
  it("etykieta jest powiązana z polem i pokazuje KLUCZ, nie napis", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value="Klub Energetyczny"
        onValueChange={() => undefined}
      />,
    );
    const pole = screen.getByLabelText("adminClubs.fields.namePl");
    expect(pole).toHaveValue("Klub Energetyczny");
    expect(pole).toHaveAttribute("id", "pole-nazwa");
  });

  it("wpisanie treści oddaje DOKŁADNIE tę treść i dokładnie raz", () => {
    const onValueChange = vi.fn();
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        onValueChange={onValueChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("adminClubs.fields.namePl"), {
      target: { value: "Nowa nazwa" },
    });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("Nowa nazwa");
  });

  it("limit znaków odwzorowuje limit kolumny w bazie", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        maxLength={120}
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl")).toHaveAttribute("maxlength", "120");
  });

  it("typ pola HTML przechodzi - harmonogram potrzebuje `datetime-local`", () => {
    render(
      <ClubDialogTextRow
        id="pole-otwarcia"
        labelKey="adminClubs.groups.opensAt"
        type="datetime-local"
        value="2026-08-18T10:00"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.groups.opensAt")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  it("pole można wyłączyć na czas zapisu", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        disabled
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl")).toBeDisabled();
  });

  it("pole z autofokusem dostaje fokus - pierwsze pole dialogu ma być gotowe", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        autoFocus
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl")).toHaveFocus();
  });
});

describe("ClubDialogTextRow - pole wielolinijkowe", () => {
  it("obecna liczba wierszy zamienia pole na wielolinijkowe", () => {
    render(
      <ClubDialogTextRow
        id="pole-opis"
        labelKey="adminClubs.fields.descriptionPl"
        value="Opis"
        rows={3}
        maxLength={2000}
        onValueChange={() => undefined}
      />,
    );
    const pole = screen.getByLabelText("adminClubs.fields.descriptionPl");
    expect(pole.tagName).toBe("TEXTAREA");
    expect(pole).toHaveAttribute("rows", "3");
    expect(pole).toHaveAttribute("maxlength", "2000");
  });

  it("brak liczby wierszy zostawia pole jednolinijkowe", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl").tagName).toBe("INPUT");
  });

  it("pole wielolinijkowe też oddaje wpisaną treść i daje się wyłączyć", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ClubDialogTextRow
        id="pole-opis"
        labelKey="adminClubs.fields.descriptionPl"
        value=""
        rows={2}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("adminClubs.fields.descriptionPl"), {
      target: { value: "Nowy opis" },
    });
    expect(onValueChange).toHaveBeenCalledWith("Nowy opis");

    rerender(
      <ClubDialogTextRow
        id="pole-opis"
        labelKey="adminClubs.fields.descriptionPl"
        value=""
        rows={2}
        disabled
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.descriptionPl")).toBeDisabled();
  });
});

describe("ClubDialogTextRow - podpowiedź i zastępcza treść", () => {
  it("podpowiedź pokazuje się tylko wtedy, gdy podano jej klucz", () => {
    const { rerender } = render(
      <ClubDialogTextRow
        id="pole-slug"
        labelKey="adminClubs.fields.slug"
        value="klub"
        hintKey="adminClubs.fields.slugHint"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByText("adminClubs.fields.slugHint")).toBeInTheDocument();

    rerender(
      <ClubDialogTextRow
        id="pole-slug"
        labelKey="adminClubs.fields.slug"
        value="klub"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.queryByText("adminClubs.fields.slugHint")).not.toBeInTheDocument();
  });

  it("zastępcza treść ze SŁOWNIKA renderuje się jako klucz", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        placeholderKey="adminClubs.create.namePlaceholder"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl")).toHaveAttribute(
      "placeholder",
      "adminClubs.create.namePlaceholder",
    );
  });

  it("zastępcza treść GOTOWA bije słownik - nazwa angielska odbija polską", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa-en"
        labelKey="adminClubs.fields.nameEn"
        value=""
        placeholderKey="adminClubs.create.namePlaceholder"
        placeholderText="Klub Energetyczny"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.nameEn")).toHaveAttribute(
      "placeholder",
      "Klub Energetyczny",
    );
  });

  it("PUSTA gotowa treść zastępcza wygrywa ze słownikiem - odbija pustkę", () => {
    // Regresja, którą to łapie: `placeholderText || t(key)` pokazywałoby
    // podpowiedź ze słownika, choć pole polskie jest jeszcze puste - czyli
    // sugerowałoby wartość, którą zapis NIE wpisze.
    render(
      <ClubDialogTextRow
        id="pole-nazwa-en"
        labelKey="adminClubs.fields.nameEn"
        value=""
        placeholderKey="adminClubs.create.namePlaceholder"
        placeholderText=""
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.nameEn")).toHaveAttribute("placeholder", "");
  });

  it("bez obu wejść pole nie ma zastępczej treści wcale", () => {
    render(
      <ClubDialogTextRow
        id="pole-nazwa"
        labelKey="adminClubs.fields.namePl"
        value=""
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.namePl")).not.toHaveAttribute("placeholder");
  });

  it("zastępcza treść dochodzi także do pola wielolinijkowego", () => {
    render(
      <ClubDialogTextRow
        id="pole-zajawka"
        labelKey="adminClubs.fields.taglinePl"
        value=""
        rows={2}
        placeholderKey="adminClubs.create.taglinePlaceholder"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.taglinePl")).toHaveAttribute(
      "placeholder",
      "adminClubs.create.taglinePlaceholder",
    );
  });
});
