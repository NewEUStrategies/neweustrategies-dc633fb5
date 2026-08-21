// Molekuła: pole adresu klubu z żywą informacją o dostępności.
//
// CO TEN PLIK DOWODZI.
//   1. JEDEN STAN STERUJE TRZEMA RZECZAMI NARAZ: znacznikiem obok pola, tonem
//      napisu pod polem i tym, czy ten napis jest ALARMEM. Wcześniej każda
//      z tych trzech rzeczy miała własną drabinkę warunków po tym samym
//      stanie - i rozjechanie ich znaczyło zieloną fajkę nad czerwonym
//      komunikatem. Test jedzie WSZYSTKIMI pięcioma stanami.
//   2. ZNACZNIK JEST IKONĄ, więc jego znaczenie istnieje wyłącznie w
//      `aria-label`. Znacznik bez etykiety to informacja niedostępna dla
//      czytnika ekranu, a to jedyna informacja, po którą przychodzi się do
//      tego pola.
//   3. NAPIS STANU JEST POWIĄZANY Z POLEM przez `aria-describedby`, a przy
//      zajętym adresie dostaje `role="alert"` - czytnik ma przeczytać odmowę
//      bez pytania.
//   4. POLE ODDAJE WPISANĄ TREŚĆ SUROWO. Normalizacja adresu należy do
//      wywołującego (`clubSlugFromName`), nie do molekuły - inaczej byłyby dwa
//      miejsca normalizujące ten sam napis.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Wyliczania stanu adresu - to
// `clubCreateSlugState` z własnym testem tabelarycznym w
// `adminClubCreateForm.test.ts`; tutaj stan WCHODZI gotowy. (2) Doboru klucza
// napisu i znacznika - `clubCreateSlugMessage`/`clubCreateSlugMark` mają tam
// swoje tabele; tu dowodzimy, że molekuła ich UŻYWA i że przekłada je na DOM.
// (3) Normalizacji adresu (`clubSlugFromName` w `types.ts`).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ClubCreateSlugState } from "@/lib/clubs/adminClubCreateForm";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubDialogSlugRow } from "@/components/admin/clubs/molecules/ClubDialogSlugRow";

function renderuj(state: ClubCreateSlugState, onValueChange = vi.fn()) {
  render(
    <ClubDialogSlugRow
      id="club-create-slug"
      labelKey="adminClubs.fields.slug"
      prefix="/club/"
      value="klub-energetyczny"
      state={state}
      maxLength={80}
      onValueChange={onValueChange}
    />,
  );
  return { onValueChange, pole: screen.getByLabelText("adminClubs.fields.slug") };
}

const WSZYSTKIE_STANY: readonly ClubCreateSlugState[] = [
  "empty",
  "short",
  "checking",
  "free",
  "taken",
];

describe("ClubDialogSlugRow - pole", () => {
  it("etykieta wiąże się z polem, a przedrostek adresu jest widoczny", () => {
    const { pole } = renderuj("free");
    expect(pole).toHaveValue("klub-energetyczny");
    expect(pole).toHaveAttribute("maxlength", "80");
    expect(screen.getByText("/club/")).toBeInTheDocument();
  });

  it("wpisana treść wychodzi SUROWO - normalizacja należy do wywołującego", () => {
    const { onValueChange, pole } = renderuj("free");
    fireEvent.change(pole, { target: { value: "Klub Łączności!!" } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("Klub Łączności!!");
  });

  it("pole można wyłączyć", () => {
    render(
      <ClubDialogSlugRow
        id="club-create-slug"
        labelKey="adminClubs.fields.slug"
        prefix="/club/"
        value="klub"
        state="free"
        disabled
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("adminClubs.fields.slug")).toBeDisabled();
  });

  it.each(WSZYSTKIE_STANY)(
    "w stanie %s napis stanu jest POWIĄZANY z polem przez aria-describedby",
    (state) => {
      const { pole } = renderuj(state);
      const opisId = pole.getAttribute("aria-describedby");
      expect(opisId).toBe("club-create-slug-state");
      expect(document.getElementById(opisId ?? "")).not.toBeNull();
    },
  );
});

describe("ClubDialogSlugRow - znacznik dostępności", () => {
  it("sprawdzanie w toku rysuje znacznik z etykietą „sprawdzam”", () => {
    renderuj("checking");
    expect(screen.getByLabelText("adminClubs.create.slugChecking")).toBeInTheDocument();
  });

  it("wolny adres rysuje znacznik potwierdzenia", () => {
    renderuj("free");
    // Etykieta znacznika i napis pod polem mają ten sam klucz - to jedna
    // informacja podana dwoma kanałami, więc szukamy jej po ROLI.
    expect(screen.getByLabelText("adminClubs.create.slugFree")).toBeInTheDocument();
  });

  it("zajęty adres rysuje znacznik odmowy", () => {
    renderuj("taken");
    expect(screen.getByLabelText("adminClubs.create.slugTaken")).toBeInTheDocument();
  });

  it.each<ClubCreateSlugState>(["empty", "short"])(
    "stan %s nie rysuje znacznika, tylko rezerwuje miejsce (element ukryty)",
    (state) => {
      renderuj(state);
      expect(screen.queryByLabelText("adminClubs.create.slugChecking")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("adminClubs.create.slugFree")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("adminClubs.create.slugTaken")).not.toBeInTheDocument();
    },
  );
});

describe("ClubDialogSlugRow - napis stanu", () => {
  it("zajęty adres to ALARM z tonem destrukcyjnym", () => {
    renderuj("taken");
    const alarm = screen.getByRole("alert");
    expect(alarm).toHaveTextContent("adminClubs.create.slugTaken");
    expect(alarm.className).toContain("text-destructive");
  });

  it("wolny adres to potwierdzenie BEZ alarmu i bez tonu destrukcyjnego", () => {
    renderuj("free");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const napis = document.getElementById("club-create-slug-state");
    expect(napis).toHaveTextContent("adminClubs.create.slugFree");
    expect(napis?.className).toContain("text-muted-foreground");
  });

  it.each<ClubCreateSlugState>(["empty", "short", "checking"])(
    "stan %s pokazuje neutralną podpowiedź o formacie adresu",
    (state) => {
      renderuj(state);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(document.getElementById("club-create-slug-state")).toHaveTextContent(
        "adminClubs.fields.slugHint",
      );
    },
  );
});
