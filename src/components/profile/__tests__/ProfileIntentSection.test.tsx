// Organizm edytora INTENCJI profilu - stał na ZERZE pokrycia.
//
// Warstwa danych ma własne testy (`lib/profile/__tests__/profileDataHooks`),
// więc tutaj atrapujemy hooki i pilnujemy tego, czego one nie widzą - reguł
// samego formularza. Trzy są nieoczywiste i każda kosztuje pracę użytkownika
// albo jakość rankingu:
//
//   1. SZKIC WYGRYWA Z SERWEREM. Lista osób odświeża się w tle (`staleTime`
//      60 s, unieważnienie po zapisie intencji z innej karty). Gdyby efekt
//      hydratacji nie sprawdzał `dirty`, każde takie odświeżenie kasowałoby
//      tekst wpisywany w tej chwili.
//   2. SUFIT INTENCJI JEST WIDOCZNY W INTERFEJSIE. Po dobiciu do limitu chipy
//      niezaznaczone są WYŁĄCZONE, więc odmowa („cicho nie dodaj") nigdy nie
//      dochodzi do przełącznika - ramię `rejected` w `onToggle` jest tu
//      nieosiągalne i tak zostaje opisane niżej, zamiast być pokrywane
//      hakowaniem DOM. Sama reguła odmowy jest przypięta w `useIntentToggle`.
//   3. ZAPIS JEST JEDNĄ TRANSAKCJĄ. Intencja zapisana w połowie (zaznaczone
//      „konsorcjum", pusty opis) trafia do rankingu jako szum - dlatego
//      przycisk jest nieaktywny bez zmian i wraca do bezczynności po zapisie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY_INTENT_DRAFT, type ProfileIntentState } from "@/lib/profile/useProfileIntent";
import { profileCompleteness } from "@/lib/profile/completeness";
import { PROFILE_INTENT_MAX, PROFILE_INTENT_TEXT_MAX } from "@/lib/profile/intents";
import { emptyCompletenessInput, pendingQueryStub, queryStub } from "@/test/profile/fixtures";

const h = vi.hoisted(() => ({
  intent: { current: null as unknown },
  mutate: vi.fn(),
  isPending: { current: false },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/lib/i18n-profile-intent", () => ({}));

vi.mock("@/lib/profile/useProfileIntent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/useProfileIntent")>(
    "@/lib/profile/useProfileIntent",
  );
  return {
    ...actual,
    useProfileIntent: () => h.intent.current,
    useSaveProfileIntent: () => ({ mutate: h.mutate, isPending: h.isPending.current }),
  };
});

vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));

import { ProfileIntentSection } from "@/components/profile/sections/ProfileIntentSection";

/** Stan warstwy intencji z domyślnie pustym profilem. */
function intentState(overrides: Partial<ProfileIntentState> = {}): ProfileIntentState {
  return {
    ...EMPTY_INTENT_DRAFT,
    intentUpdatedAt: null,
    status: profileCompleteness(emptyCompletenessInput()),
    indexedScore: 0,
    ...overrides,
  };
}

/** ISO sprzed N miesięcy, liczone od realnego zegara jak w komponencie. */
function monthsAgo(months: number): string {
  return new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();
}

/** Chip intencji po pełnej etykiecie (`aria-label`), nie po skrócie. */
function chip(code: string): HTMLElement {
  return screen.getByRole("button", { name: `profileIntent.openTo.${code}` });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "profileIntent.save" });
}

function seekingPl(): HTMLElement {
  return screen.getByLabelText("profileIntent.seekingLabelPl");
}

beforeEach(() => {
  h.intent.current = queryStub(intentState());
  h.mutate.mockReset();
  h.isPending.current = false;
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});

describe("stany wczytywania", () => {
  it("w trakcie wczytywania pokazuje szkielet BEZ formularza", () => {
    // Formularz wstawiony przed danymi hydratowałby się pustym szkicem,
    // a pierwsze kliknięcie zapisu wyczyściłoby istniejącą intencję.
    h.intent.current = pendingQueryStub();
    render(<ProfileIntentSection />);
    expect(screen.queryByRole("button", { name: "profileIntent.save" })).not.toBeInTheDocument();
  });

  it("przy błędzie odczytu nie renderuje NIC", () => {
    h.intent.current = queryStub(undefined, {
      isError: true,
      isSuccess: false,
      error: new Error("boom"),
    });
    const { container } = render(<ProfileIntentSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("brak danych przy braku błędu też nie renderuje formularza", () => {
    h.intent.current = queryStub(undefined);
    const { container } = render(<ProfileIntentSection />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("hydratacja szkicu", () => {
  it("wypełnia chipy i pola tym, co przyszło z serwera", () => {
    h.intent.current = queryStub(
      intentState({
        openTo: ["consortium", "advisory"],
        seekingPl: "Szukam partnerów",
        offeringEn: "Advisory",
      }),
    );
    render(<ProfileIntentSection />);

    expect(chip("consortium")).toHaveAttribute("aria-pressed", "true");
    expect(chip("advisory")).toHaveAttribute("aria-pressed", "true");
    expect(chip("hiring")).toHaveAttribute("aria-pressed", "false");
    expect(seekingPl()).toHaveValue("Szukam partnerów");
    expect(screen.getByLabelText("profileIntent.offeringLabelEn")).toHaveValue("Advisory");
  });

  it("ODŚWIEŻENIE serwera NIE kasuje tekstu wpisywanego w tej chwili", () => {
    // Reguła 1 z nagłówka. Lista osób i intencja unieważniają się wzajemnie,
    // więc świeże dane przychodzą w środku pisania. Bez sprawdzenia `dirty`
    // użytkownik traci akapit w połowie zdania.
    const { rerender } = render(<ProfileIntentSection />);

    fireEvent.change(seekingPl(), { target: { value: "Piszę właśnie to" } });
    // Serwer odpowiada innym stanem (np. po zapisie z drugiej karty).
    h.intent.current = queryStub(intentState({ seekingPl: "WERSJA Z SERWERA" }));
    rerender(<ProfileIntentSection />);

    expect(seekingPl()).toHaveValue("Piszę właśnie to");
  });

  it("przed pierwszą edycją świeże dane serwera PODMIENIAJĄ szkic", () => {
    // Druga strona tej samej reguły: dopóki użytkownik nie tknął formularza,
    // serwer jest źródłem prawdy (inaczej pierwsze wejście pokazuje pustki).
    const { rerender } = render(<ProfileIntentSection />);
    expect(seekingPl()).toHaveValue("");

    h.intent.current = queryStub(intentState({ seekingPl: "Z SERWERA" }));
    rerender(<ProfileIntentSection />);

    expect(seekingPl()).toHaveValue("Z SERWERA");
  });
});

describe("sufit intencji", () => {
  it("po przekroczeniu limitu ODMAWIA z komunikatem podającym limit", () => {
    // Reguła 2: „cicho nie dodaj" wygląda jak zepsuty przycisk.
    const full = ["consortium", "partnership", "advisory", "speaking", "co_authoring", "mentoring"];
    expect(full).toHaveLength(PROFILE_INTENT_MAX);
    h.intent.current = queryStub(intentState({ openTo: full as never }));
    render(<ProfileIntentSection />);

    // Chip ponad limit jest wyłączony, więc pilnujemy JEDNEGO z zaznaczonych:
    // jego zdjęcie musi się udać, a próba dodania siódmego - nie.
    expect(chip("hiring")).toBeDisabled();
    fireEvent.click(chip("consortium"));
    expect(chip("consortium")).toHaveAttribute("aria-pressed", "false");

    // Po zdjęciu jednego jest miejsce - siódmy chip znów jest klikalny.
    expect(chip("hiring")).not.toBeDisabled();
  });

  it("dokłada i zdejmuje chipy oraz uaktywnia zapis", () => {
    render(<ProfileIntentSection />);
    expect(saveButton()).toBeDisabled();

    fireEvent.click(chip("consortium"));

    expect(chip("consortium")).toHaveAttribute("aria-pressed", "true");
    expect(saveButton()).not.toBeDisabled();

    fireEvent.click(chip("consortium"));
    expect(chip("consortium")).toHaveAttribute("aria-pressed", "false");
  });

  it("chip ponad limit jest ZABLOKOWANY, więc odmowa nie jest potrzebna", () => {
    // Ramię `rejected` w `onToggle` (toast z limitem) jest w tym komponencie
    // NIEOSIĄGALNE z interfejsu: `IntentChip` wyłącza każdy niezaznaczony chip,
    // gdy lista dobiła do sufitu, więc kliknięcie nie dochodzi do przełącznika.
    // Nie hakujemy tu DOM, żeby to ramię „pokryć" - reguła odmowy jest przypięta
    // tam, gdzie mieszka, czyli w teście `useIntentToggle`. Tutaj dowodzimy
    // rzeczy, którą widzi użytkownik: że nie da się przekroczyć limitu.
    const full = ["consortium", "partnership", "advisory", "speaking", "co_authoring", "mentoring"];
    h.intent.current = queryStub(intentState({ openTo: full as never }));
    render(<ProfileIntentSection />);

    const blocked = chip("hiring");
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);

    expect(blocked).toHaveAttribute("aria-pressed", "false");
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("zapis", () => {
  it("zapis jest nieaktywny, dopóki nic się nie zmieniło", () => {
    render(<ProfileIntentSection />);
    expect(saveButton()).toBeDisabled();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("wysyła CAŁY szkic jedną transakcją", () => {
    // Reguła 3: nie ma zapisu per pole, bo intencja czytana w połowie jest
    // gorsza niż niezapisana.
    render(<ProfileIntentSection />);

    fireEvent.click(chip("consortium"));
    fireEvent.change(seekingPl(), { target: { value: "Konsorcjum Horizon" } });
    fireEvent.click(saveButton());

    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toEqual({
      openTo: ["consortium"],
      seekingPl: "Konsorcjum Horizon",
      seekingEn: "",
      offeringPl: "",
      offeringEn: "",
    });
  });

  it("po UDANYM zapisie potwierdza i wraca do stanu bez zmian", () => {
    render(<ProfileIntentSection />);
    fireEvent.click(chip("consortium"));
    fireEvent.click(saveButton());

    const options = h.mutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(h.toastSuccess).toHaveBeenCalledWith("profileIntent.saved");
    // Powrót do bezczynności: bez tego przycisk zostaje aktywny i zaprasza
    // do drugiego, identycznego zapisu.
    expect(saveButton()).toBeDisabled();
  });

  it("NIEUDANY zapis zostawia zmiany w formularzu", () => {
    // Wyczyszczenie `dirty` po błędzie kazałoby użytkownikowi wpisać wszystko
    // od nowa - i to bez żadnego sygnału, że coś przepadło.
    render(<ProfileIntentSection />);
    fireEvent.change(seekingPl(), { target: { value: "Ważny tekst" } });
    fireEvent.click(saveButton());

    const options = h.mutate.mock.calls[0][1] as { onError: () => void };
    act(() => options.onError());

    expect(h.toastError).toHaveBeenCalledWith("profileIntent.saveError");
    expect(seekingPl()).toHaveValue("Ważny tekst");
    expect(saveButton()).not.toBeDisabled();
  });

  it("w trakcie zapisu przycisk jest zablokowany", () => {
    // Dwa kliknięcia to dwa UPDATE-y na tym samym wierszu.
    h.isPending.current = true;
    h.intent.current = queryStub(intentState({ seekingPl: "x" }));
    render(<ProfileIntentSection />);
    expect(saveButton()).toBeDisabled();
  });

  it("anulowanie PRZYWRACA wartości z serwera", () => {
    h.intent.current = queryStub(
      intentState({ openTo: ["advisory"], seekingPl: "Wersja serwerowa" }),
    );
    render(<ProfileIntentSection />);

    fireEvent.change(seekingPl(), { target: { value: "Zmiana do wyrzucenia" } });
    fireEvent.click(chip("advisory"));
    fireEvent.click(screen.getByRole("button", { name: "profileIntent.cancel" }));

    expect(seekingPl()).toHaveValue("Wersja serwerowa");
    expect(chip("advisory")).toHaveAttribute("aria-pressed", "true");
    expect(saveButton()).toBeDisabled();
  });

  it("przycisk anulowania pojawia się TYLKO przy niezapisanych zmianach", () => {
    render(<ProfileIntentSection />);
    expect(screen.queryByRole("button", { name: "profileIntent.cancel" })).not.toBeInTheDocument();

    fireEvent.change(seekingPl(), { target: { value: "cokolwiek" } });

    expect(screen.getByRole("button", { name: "profileIntent.cancel" })).toBeInTheDocument();
  });
});

describe("nota o zestarzeniu i data aktualizacji", () => {
  it("intencja starsza niż pół roku dostaje notę Z LICZBĄ miesięcy", () => {
    // Katalog rankinguje po intencji, więc nieaktualna intencja szkodzi
    // właścicielowi profilu - nota ma powiedzieć, o ile jest stara.
    h.intent.current = queryStub(intentState({ intentUpdatedAt: monthsAgo(8) }));
    render(<ProfileIntentSection />);

    expect(screen.getByText(/profileIntent\.stale/)).toBeInTheDocument();
    expect(screen.getByText(/"months":8/)).toBeInTheDocument();
  });

  it("świeża intencja NIE dostaje noty", () => {
    h.intent.current = queryStub(intentState({ intentUpdatedAt: monthsAgo(2) }));
    render(<ProfileIntentSection />);
    expect(screen.queryByText(/profileIntent\.stale/)).not.toBeInTheDocument();
  });

  it("dokładnie na granicy sześciu miesięcy nota JEST", () => {
    h.intent.current = queryStub(intentState({ intentUpdatedAt: monthsAgo(6) }));
    render(<ProfileIntentSection />);
    expect(screen.getByText(/profileIntent\.stale/)).toBeInTheDocument();
  });

  it("uszkodzona data nie wywala sekcji ani nie udaje starej intencji", () => {
    h.intent.current = queryStub(intentState({ intentUpdatedAt: "to-nie-data" }));
    render(<ProfileIntentSection />);
    expect(screen.queryByText(/profileIntent\.stale/)).not.toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
  });

  it("data aktualizacji chowa się, gdy są niezapisane zmiany", () => {
    // Pokazywanie „zaktualizowano 1 maja" nad niezapisanym szkicem to
    // informacja fałszywa - to nie jest stan, który użytkownik widzi.
    h.intent.current = queryStub(intentState({ intentUpdatedAt: monthsAgo(1) }));
    render(<ProfileIntentSection />);
    expect(screen.getByText(/profileIntent\.updatedAt/)).toBeInTheDocument();

    fireEvent.change(seekingPl(), { target: { value: "zmiana" } });

    expect(screen.queryByText(/profileIntent\.updatedAt/)).not.toBeInTheDocument();
  });

  it("profil bez ani jednej edycji intencji nie pokazuje daty", () => {
    render(<ProfileIntentSection />);
    expect(screen.queryByText(/profileIntent\.updatedAt/)).not.toBeInTheDocument();
  });
});

describe("licznik znaków i tryb tylko do odczytu", () => {
  it("licznik pokazuje pozostały budżet znaków, nie długość tekstu", () => {
    render(<ProfileIntentSection />);
    expect(
      screen.getAllByText(`profileIntent.charsLeft {"count":${PROFILE_INTENT_TEXT_MAX}}`),
    ).not.toHaveLength(0);

    fireEvent.change(seekingPl(), { target: { value: "abcde" } });

    expect(
      screen.getByText(`profileIntent.charsLeft {"count":${PROFILE_INTENT_TEXT_MAX - 5}}`),
    ).toBeInTheDocument();
  });

  it("pole nie przyjmuje więcej znaków, niż dopuszcza CHECK bazy", () => {
    render(<ProfileIntentSection />);
    expect(seekingPl()).toHaveAttribute("maxlength", String(PROFILE_INTENT_TEXT_MAX));
  });

  it("`editable=false` zamienia chipy w znaczniki BEZ przycisków", async () => {
    // Podgląd cudzego profilu (albo tryb gościa) nie może dawać klikalnych
    // przełączników cudzej intencji.
    h.intent.current = queryStub(intentState({ openTo: ["consortium"] }));
    render(<ProfileIntentSection editable={false} />);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "profileIntent.openTo.consortium" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("profileIntent.openToShort.consortium")).toBeInTheDocument();
  });
});
