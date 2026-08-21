// Organizm „Edytor działu" - SKLEJENIE wersji roboczej z dwiema mutacjami.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG BEZ DZIAŁU NIE RENDERUJE TREŚCI, a podanie działu wypełnia
//      formularz jego wartościami. Trzy kształty wiersza mają trzy widoki:
//      dane pełne, dane CZĘŚCIOWE (puste kolumny opisu i harmonogramu, próg
//      planu w zerze, status spoza słownika klienta) i BRAK działu. Nigdzie
//      nie może pojawić się gołe `undefined`.
//   2. DZIEDZICZENIE JEST WIDOCZNE I PRZEŁĄCZALNE W OBIE STRONY. Pole
//      dziedziczone pokazuje, skąd bierze się wartość, i jest NIECZYNNE;
//      nadpisane - czynne. ZDJĘCIE dziedziczenia widoczności sprowadza wartość
//      klubu w dół (`public` -> `members`), bo CHECK działu nie zna `public`:
//      nadpisanie WĘŻSZE jest dozwolone, szersze nie.
//   3. WALIDACJA ODRZUCA PUSTE POLE WYMAGANE i NIE wysyła żądania - komunikat
//      idzie kluczem i18n.
//   4. KSZTAŁT PAYLOADU jest asertowany na OBIEKCIE przekazanym do mutacji:
//      dziedziczone ustawienie jedzie jako PUSTY STRING (próg planu jako
//      `null`), a nie jako wartość widoczna w wyłączonej dropliście.
//   5. PODWÓJNY SUBMIT WYSYŁA RAZ.
//   6. SUKCES zamyka dialog; ODMOWA go zostawia i mówi kluczem.
//   7. KASOWANIE: przycisk jest wyłączony, gdy odmowa jest PEWNA (ostatni
//      dział, dział z wątkami bez celu), okno potwierdzenia mówi o
//      PRZENIESIENIU tam, gdzie ono nastąpi, a trzy odmowy RPC mają trzy różne
//      komunikaty.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł edytora - przepisanie wiersza na
// wersję roboczą, kontrakt pustego stringa, zawężenie widoczności, konwersja
// harmonogramu, warunek kasowania i słownik odmów mają tabele w
// `lib/clubs/__tests__/adminClubGroupForm.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i co robi z odpowiedzią. (2) Rozwiązywania dziedziczenia -
// to robi BAZA i zwraca kolumny `*_inherited`. (3) Atomu `InheritedField`
// i molekuł `ClubDialogTextRow`, `ClubDialogInheritedEnum`, `ClubEnumSelect` -
// mają własne pliki. (4) Okna potwierdzenia (`ConfirmDialog`) - jest atrapą,
// bo przedmiotem dowodu jest TREŚĆ pytania i to, co robi potwierdzenie.
// (5) Hooków `useUpsertClubGroup`/`useDeleteClubGroup` (unieważnianie cache) -
// są zamockowane na poziomie MODUŁU.
//
// DETERMINIZM: żadnego `Date.now()`; terminy pochodzą z `CLUB_BASE_ISO`
// i `clubIsoOffset`, a konwersja na wartość pola HTML idzie tą samą funkcją,
// którą testuje moduł reguł - dzięki temu test nie zakłada strefy maszyny.
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ConfirmState } from "@/components/admin/ConfirmDialog";
import { CLUB_BASE_ISO, CLUB_IDS, clubGroupRow, clubIsoOffset } from "@/test/clubs/fixtures";
import { clubGroupLocalInput } from "@/lib/clubs/adminClubGroupForm";
import type { AdminClubGroupRow, ClubGroupRow, ClubGroupUpsertInput } from "@/lib/clubs/types";

type WynikZapisu = { onSuccess: () => void; onError: (error: Error) => void };
type WynikKasowania = { onSuccess: (moved: number) => void; onError: (error: Error) => void };
type WejscieKasowania = { groupId: string; moveToGroupId?: string | null };

const h = vi.hoisted(() => ({
  language: "pl",
  savePending: false,
  deletePending: false,
  saveClubs: [] as string[],
  deleteClubs: [] as string[],
  saves: [] as { vars: ClubGroupUpsertInput; wynik: WynikZapisu }[],
  deletes: [] as { vars: WejscieKasowania; wynik: WynikKasowania }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Radix Dialog: `Root` zawsze renderuje dzieci, ale `Content` istnieje tylko
// przy otwartym dialogu. Atrapa odwzorowuje to wprost.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return (
        <div data-testid="dialog" data-open={String(open)}>
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});
// Droplista celu przeniesienia wątków - organizm używa jej bezpośrednio.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="cel-przeniesienia"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">brak celu</option>
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
// Droplista słownikowa ma własny plik testowy; tutaj potrzebny jest wyłącznie
// STABILNY uchwyt do wartości, którą organizm wysyła do wersji roboczej.
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: ({
    id,
    label,
    value,
    options,
    i18nPrefix,
    onChange,
    disabled,
  }: {
    id?: string;
    label?: string;
    value: string;
    options: readonly string[];
    i18nPrefix: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      {label === undefined ? null : <label htmlFor={id}>{label}</label>}
      <select
        id={id}
        data-testid={`enum-${i18nPrefix}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {`${i18nPrefix}.${option}`}
          </option>
        ))}
      </select>
    </div>
  ),
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({
  ConfirmDialog: ({
    state,
    onOpenChange,
  }: {
    state: ConfirmState | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    state === null ? null : (
      <div data-testid="potwierdzenie" data-destrukcyjne={String(state.destructive === true)}>
        <p>{state.title}</p>
        <p>{state.description}</p>
        <button
          type="button"
          data-testid="potwierdz"
          onClick={() => {
            void state.onConfirm();
            onOpenChange(false);
          }}
        />
        <button
          type="button"
          data-testid="anuluj-potwierdzenie"
          onClick={() => onOpenChange(false)}
        />
      </div>
    ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useUpsertClubGroup: (clubId: string) => {
    h.saveClubs.push(clubId);
    return {
      isPending: h.savePending,
      mutate: (vars: ClubGroupUpsertInput, wynik: WynikZapisu) => {
        h.saves.push({ vars, wynik });
      },
    };
  },
  useDeleteClubGroup: (clubId: string) => {
    h.deleteClubs.push(clubId);
    return {
      isPending: h.deletePending,
      mutate: (vars: WejscieKasowania, wynik: WynikKasowania) => {
        h.deletes.push({ vars, wynik });
      },
    };
  },
}));

import { ClubGroupEditorDialog } from "@/components/admin/clubs/organisms/ClubGroupEditorDialog";

const KLUB = CLUB_IDS.club;
const RODZENSTWO_A = "aaaa1111-2222-4333-8444-555566667777";
const RODZENSTWO_B = "bbbb1111-2222-4333-8444-555566667777";

/** Wiersz działu z projekcji administracyjnej (nadzbiór produktowej). */
function dzial(overrides: Partial<ClubGroupRow> = {}): AdminClubGroupRow {
  return clubGroupRow(overrides);
}

function renderuj(props: {
  group?: AdminClubGroupRow | null;
  siblings?: readonly AdminClubGroupRow[];
}) {
  const onOpenChange = vi.fn();
  const grupa = props.group === undefined ? dzial() : props.group;
  const rodzenstwo =
    props.siblings ??
    (grupa === null ? [] : [grupa, dzial({ id: RODZENSTWO_A, name_pl: "Analizy" })]);
  const wynik = render(
    <ClubGroupEditorDialog
      clubId={KLUB}
      group={grupa}
      siblings={rodzenstwo}
      onOpenChange={onOpenChange}
    />,
  );
  const przerysuj = (
    next: AdminClubGroupRow | null,
    nextSiblings: readonly AdminClubGroupRow[] = rodzenstwo,
  ) =>
    wynik.rerender(
      <ClubGroupEditorDialog
        clubId={KLUB}
        group={next}
        siblings={nextSiblings}
        onOpenChange={onOpenChange}
      />,
    );
  return { ...wynik, onOpenChange, przerysuj };
}

const poleNazwyPl = () => screen.getByLabelText("adminClubs.fields.namePl");
const poleAdresu = () => screen.getByLabelText("adminClubs.fields.slug");
const przyciskZapisu = () => screen.getByRole("button", { name: "common.save" });
const przyciskKasowania = () => screen.getByRole("button", { name: /adminClubs.groups.delete$/ });
const droplista = (prefix: string) => screen.getByTestId<HTMLSelectElement>(`enum-${prefix}`);

/** Przełącznik „dziedzicz / nadpisz" stojący obok podanej etykiety pola. */
function przelacznik(labelKey: string): HTMLButtonElement {
  const wiersz = screen.getByText(labelKey).parentElement;
  const przycisk = wiersz === null ? null : wiersz.querySelector("button");
  if (przycisk === null) throw new Error(`brak przełącznika dla ${labelKey}`);
  return przycisk;
}

beforeEach(() => {
  h.language = "pl";
  h.savePending = false;
  h.deletePending = false;
  h.saveClubs = [];
  h.deleteClubs = [];
  h.saves = [];
  h.deletes = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("ClubGroupEditorDialog - trzy kształty wejścia", () => {
  it("BRAK działu nie renderuje treści dialogu", () => {
    renderuj({ group: null });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
    expect(screen.queryByText("adminClubs.groups.editTitle")).not.toBeInTheDocument();
  });

  it("dane PEŁNE wypełniają formularz wartościami wiersza", () => {
    renderuj({
      group: dzial({
        slug: "dyskusje",
        name_pl: "Dyskusje",
        name_en: "Discussions",
        description_pl: "Opis polski",
        description_en: "English description",
        status: "frozen",
      }),
    });
    expect(screen.getByText("adminClubs.groups.editTitle")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.groups.editHint")).toBeInTheDocument();
    expect(poleNazwyPl()).toHaveValue("Dyskusje");
    expect(screen.getByLabelText("adminClubs.fields.nameEn")).toHaveValue("Discussions");
    expect(poleAdresu()).toHaveValue("dyskusje");
    expect(screen.getByLabelText("adminClubs.fields.descriptionPl")).toHaveValue("Opis polski");
    expect(droplista("club.groupStatus").value).toBe("frozen");
    expect(screen.getByLabelText("adminClubs.groups.opensAt")).toHaveValue(
      clubGroupLocalInput(CLUB_BASE_ISO),
    );
  });

  it("dane CZĘŚCIOWE nie pokazują gołego „undefined” ani „null”", () => {
    // Kolumny opcjonalne przychodzą z RPC jako PUSTY NAPIS (generator Supabase
    // typuje je jako `string`, nie `string | null`), a status bywa wartością
    // spoza słownika klienta. Oba przypadki muszą dać czytelny formularz.
    renderuj({
      group: dzial({
        description_pl: "",
        description_en: "",
        opens_at: "",
        closes_at: "",
        min_tier_rank: 0,
        status: "published",
      }),
    });
    const tresc = screen.getByTestId("dialog-content");
    expect(tresc.textContent ?? "").not.toContain("undefined");
    expect(screen.getByLabelText("adminClubs.fields.descriptionPl")).toHaveValue("");
    expect(screen.getByLabelText("adminClubs.groups.opensAt")).toHaveValue("");
    expect(screen.getByRole("spinbutton")).toHaveValue(0);
    // Status spoza słownika degraduje się do wersji roboczej, nie do pustki.
    expect(droplista("club.groupStatus").value).toBe("draft");
  });

  it("zamknięcie i ponowne otwarcie na INNYM dziale przepisuje formularz", () => {
    const { przerysuj } = renderuj({ group: dzial({ name_pl: "Dyskusje" }) });
    fireEvent.change(poleNazwyPl(), { target: { value: "Ręczna zmiana" } });

    przerysuj(dzial({ id: RODZENSTWO_B, name_pl: "Analizy", slug: "analizy" }));

    expect(poleNazwyPl()).toHaveValue("Analizy");
    expect(poleAdresu()).toHaveValue("analizy");
  });

  it("przycisk anulowania zamyka dialog bez żądania", () => {
    const { onOpenChange } = renderuj({});
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.saves).toHaveLength(0);
  });

  it("oba hooki mutacji dostają identyfikator KLUBU, nie działu", () => {
    renderuj({});
    expect(h.saveClubs).toContain(KLUB);
    expect(h.deleteClubs).toContain(KLUB);
  });
});

describe("ClubGroupEditorDialog - walidacja", () => {
  it("pusta nazwa polska nie wysyła żądania i mówi kluczem i18n", () => {
    renderuj({});
    fireEvent.change(poleNazwyPl(), { target: { value: "   " } });
    fireEvent.click(przyciskZapisu());
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.requiredFields");
    expect(h.saves).toHaveLength(0);
  });

  it("pusty adres nie wysyła żądania", () => {
    renderuj({});
    fireEvent.change(poleAdresu(), { target: { value: "" } });
    fireEvent.click(przyciskZapisu());
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.requiredFields");
    expect(h.saves).toHaveLength(0);
  });

  it("pusta nazwa ANGIELSKA zapisu nie blokuje - dziedziczy po polskiej", () => {
    renderuj({ group: dzial({ name_pl: "Dyskusje", name_en: "" }) });
    fireEvent.click(przyciskZapisu());
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].vars.name_en).toBe("Dyskusje");
  });
});

describe("ClubGroupEditorDialog - dziedziczenie ustawień", () => {
  it("pole DZIEDZICZONE mówi, skąd bierze wartość, i jest nieczynne", () => {
    renderuj({});
    expect(przelacznik("adminClubs.fields.visibility")).toHaveTextContent("club.inheritedFromClub");
    expect(droplista("club.visibility")).toBeDisabled();
    expect(droplista("club.whoCanPost")).toBeDisabled();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("dziedziczona widoczność renderuje słownik KLUBU - z wartością publiczną", () => {
    renderuj({ group: dzial({ visibility: "public", visibility_inherited: true }) });
    expect(droplista("club.visibility").value).toBe("public");
    expect(screen.getByRole("option", { name: "club.visibility.public" })).toBeInTheDocument();
  });

  it("ZDJĘCIE dziedziczenia widoczności sprowadza wartość klubu w dół", () => {
    // Nadpisanie WĘŻSZE jest dozwolone, szersze nie: CHECK
    // `club_groups.visibility` nie zna `public`, więc zapis wybranej wartości
    // publicznej wróciłby błędem serwera.
    renderuj({ group: dzial({ visibility: "public", visibility_inherited: true }) });
    fireEvent.click(przelacznik("adminClubs.fields.visibility"));

    const pole = droplista("club.visibility");
    expect(pole).toBeEnabled();
    expect(pole.value).toBe("members");
    expect(
      screen.queryByRole("option", { name: "club.visibility.public" }),
    ).not.toBeInTheDocument();
    expect(przelacznik("adminClubs.fields.visibility")).toHaveTextContent(
      "adminClubs.groups.override",
    );
  });

  it("POWRÓT do dziedziczenia znów wyłącza pole - przełącznik działa w obie strony", () => {
    renderuj({ group: dzial({ visibility: "public", visibility_inherited: true }) });
    fireEvent.click(przelacznik("adminClubs.fields.visibility"));
    expect(droplista("club.visibility")).toBeEnabled();

    fireEvent.click(przelacznik("adminClubs.fields.visibility"));
    expect(droplista("club.visibility")).toBeDisabled();
    expect(przelacznik("adminClubs.fields.visibility")).toHaveTextContent("club.inheritedFromClub");
  });

  it.each([
    ["adminClubs.fields.whoCanPost", "club.whoCanPost", "staff_only"],
    ["adminClubs.fields.moderationMode", "club.moderation", "pre"],
    ["adminClubs.fields.attributionMode", "club.attribution", "chatham"],
  ])("nadpisanie pola %s odblokowuje droplistę i przepuszcza wybór", (labelKey, prefix, wybor) => {
    renderuj({});
    fireEvent.click(przelacznik(labelKey));
    const pole = droplista(prefix);
    expect(pole).toBeEnabled();
    fireEvent.change(pole, { target: { value: wybor } });
    expect(droplista(prefix).value).toBe(wybor);
  });

  it("nadpisany próg planu przyjmuje liczbę, a śmieć schodzi do zera", () => {
    renderuj({});
    fireEvent.click(przelacznik("adminClubs.fields.minTierRank"));
    const pole = screen.getByRole("spinbutton");
    expect(pole).toBeEnabled();
    fireEvent.change(pole, { target: { value: "7" } });
    expect(pole).toHaveValue(7);
    fireEvent.change(pole, { target: { value: "" } });
    expect(pole).toHaveValue(0);
  });

  it("nagłówki sekcji nadpisań i harmonogramu są na miejscu", () => {
    renderuj({});
    expect(screen.getByText("adminClubs.groups.overridesTitle")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.groups.overridesHint")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.groups.scheduleTitle")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.groups.scheduleHint")).toBeInTheDocument();
  });
});

describe("ClubGroupEditorDialog - kształt payloadu zapisu", () => {
  it("wszystko dziedziczone jedzie jako PUSTY STRING, próg planu jako null", () => {
    renderuj({
      group: dzial({
        slug: "dyskusje",
        name_pl: "Dyskusje",
        name_en: "Discussions",
        description_pl: "",
        description_en: "",
        status: "active",
        opens_at: "",
        closes_at: "",
      }),
    });
    fireEvent.click(przyciskZapisu());

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].vars).toEqual({
      id: CLUB_IDS.group,
      club_id: KLUB,
      slug: "dyskusje",
      name_pl: "Dyskusje",
      name_en: "Discussions",
      description_pl: null,
      description_en: null,
      status: "active",
      visibility: "",
      who_can_post: "",
      moderation_mode: "",
      attribution_mode: "",
      min_tier_rank: null,
      opens_at: null,
      closes_at: null,
    });
  });

  it("nadpisania i harmonogram dochodzą do payloadu jako WARTOŚCI", () => {
    renderuj({
      group: dzial({ visibility: "public", visibility_inherited: true, opens_at: "" }),
    });
    fireEvent.click(przelacznik("adminClubs.fields.visibility"));
    // Po zdjęciu dziedziczenia droplista jest czynna i jej wybór ma dojść do
    // payloadu - `secret` jest WĘŻSZE niż `members`, a to jedyny dozwolony
    // kierunek nadpisania widoczności.
    fireEvent.change(droplista("club.visibility"), { target: { value: "secret" } });
    fireEvent.click(przelacznik("adminClubs.fields.whoCanPost"));
    fireEvent.change(droplista("club.whoCanPost"), { target: { value: "staff_only" } });
    fireEvent.click(przelacznik("adminClubs.fields.minTierRank"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("adminClubs.groups.opensAt"), {
      target: { value: clubGroupLocalInput(clubIsoOffset(120)) },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.descriptionPl"), {
      target: { value: "  Nowy opis  " },
    });
    fireEvent.click(przyciskZapisu());

    expect(h.saves[0].vars).toMatchObject({
      visibility: "secret",
      who_can_post: "staff_only",
      moderation_mode: "",
      min_tier_rank: 30,
      opens_at: clubIsoOffset(120),
      description_pl: "Nowy opis",
    });
  });

  it("zmiana statusu i nazw dochodzi do payloadu", () => {
    renderuj({});
    fireEvent.change(poleNazwyPl(), { target: { value: " Debaty " } });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.nameEn"), {
      target: { value: " Debates " },
    });
    fireEvent.change(poleAdresu(), { target: { value: " debaty " } });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.descriptionEn"), {
      target: { value: "English" },
    });
    fireEvent.change(droplista("club.groupStatus"), { target: { value: "archived" } });
    fireEvent.change(screen.getByLabelText("adminClubs.groups.closesAt"), {
      target: { value: clubGroupLocalInput(clubIsoOffset(240)) },
    });
    fireEvent.click(przyciskZapisu());

    expect(h.saves[0].vars).toMatchObject({
      name_pl: "Debaty",
      name_en: "Debates",
      slug: "debaty",
      description_en: "English",
      status: "archived",
      closes_at: clubIsoOffset(240),
    });
  });
});

describe("ClubGroupEditorDialog - odpowiedź zapisu", () => {
  it("sukces mówi o zapisie i zamyka dialog", () => {
    const { onOpenChange } = renderuj({});
    fireEvent.click(przyciskZapisu());
    act(() => h.saves[0].wynik.onSuccess());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("odmowa mówi kluczem i ZOSTAWIA dialog z wpisaną treścią", () => {
    const { onOpenChange } = renderuj({});
    fireEvent.change(poleNazwyPl(), { target: { value: "Debaty" } });
    fireEvent.click(przyciskZapisu());
    act(() => h.saves[0].wynik.onError(new Error("cokolwiek")));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(poleNazwyPl()).toHaveValue("Debaty");
  });

  it("trwający zapis wyłącza przycisk i kontrolki - PODWÓJNY submit wysyła RAZ", () => {
    const { przerysuj } = renderuj({});
    fireEvent.click(przyciskZapisu());
    expect(h.saves).toHaveLength(1);

    h.savePending = true;
    przerysuj(dzial());

    expect(przyciskZapisu()).toBeDisabled();
    expect(droplista("club.groupStatus")).toBeDisabled();
    expect(przelacznik("adminClubs.fields.visibility")).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(h.saves).toHaveLength(1);
  });
});

describe("ClubGroupEditorDialog - kasowanie działu", () => {
  it("dział PUSTY z rodzeństwem: pytanie bez przeniesienia, żądanie bez celu", () => {
    const { onOpenChange } = renderuj({
      group: dzial({ thread_count: 0 }),
      siblings: [dzial({ thread_count: 0 }), dzial({ id: RODZENSTWO_A, name_pl: "Analizy" })],
    });
    expect(screen.getByText("adminClubs.groups.deleteEmpty")).toBeInTheDocument();
    expect(screen.queryByTestId("cel-przeniesienia")).not.toBeInTheDocument();

    fireEvent.click(przyciskKasowania());
    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-destrukcyjne", "true");
    expect(screen.getByText("adminClubs.groups.deleteConfirmTitle")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.groups.deleteConfirmBody")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("potwierdz"));
    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0].vars).toEqual({ groupId: CLUB_IDS.group, moveToGroupId: null });

    act(() => h.deletes[0].wynik.onSuccess(0));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.groups.deleted");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dział z WĄTKAMI wymaga celu: przycisk wyłączony, dopóki cel nie wskazany", () => {
    renderuj({
      group: dzial({ thread_count: 4 }),
      siblings: [dzial({ thread_count: 4 }), dzial({ id: RODZENSTWO_A, name_pl: "Analizy" })],
    });
    expect(screen.getByText("adminClubs.groups.deleteWithThreads(count=4)")).toBeInTheDocument();
    expect(przyciskKasowania()).toBeDisabled();

    fireEvent.change(screen.getByTestId("cel-przeniesienia"), {
      target: { value: RODZENSTWO_A },
    });
    expect(przyciskKasowania()).toBeEnabled();

    fireEvent.click(przyciskKasowania());
    expect(screen.getByText("adminClubs.groups.deleteConfirmMove")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("potwierdz"));
    expect(h.deletes[0].vars).toEqual({
      groupId: CLUB_IDS.group,
      moveToGroupId: RODZENSTWO_A,
    });

    act(() => h.deletes[0].wynik.onSuccess(4));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.groups.deletedWithMove(count=4)");
  });

  it("droplista celu pokazuje NAZWY rodzeństwa w języku interfejsu, bez kasowanego", () => {
    renderuj({
      group: dzial({ thread_count: 2 }),
      siblings: [
        dzial({ thread_count: 2, name_pl: "Dyskusje" }),
        dzial({ id: RODZENSTWO_A, name_pl: "Analizy", name_en: "Analyses" }),
        dzial({ id: RODZENSTWO_B, name_pl: "Raporty", name_en: "Reports" }),
      ],
    });
    expect(screen.getByRole("option", { name: "Analizy" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Raporty" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dyskusje" })).not.toBeInTheDocument();
  });

  it("angielski interfejs pokazuje nazwy rodzeństwa po angielsku", () => {
    h.language = "en";
    renderuj({
      group: dzial({ thread_count: 2 }),
      siblings: [
        dzial({ thread_count: 2 }),
        dzial({ id: RODZENSTWO_A, name_pl: "Analizy", name_en: "Analyses" }),
      ],
    });
    expect(screen.getByRole("option", { name: "Analyses" })).toBeInTheDocument();
  });

  it("OSTATNI dział klubu jest nieusuwalny i mówi o tym wprost", () => {
    renderuj({
      group: dzial({ thread_count: 0 }),
      siblings: [dzial({ thread_count: 0 })],
    });
    expect(przyciskKasowania()).toBeDisabled();
    expect(screen.getByText("adminClubs.groups.deleteLast")).toBeInTheDocument();
  });

  it("trwające kasowanie wyłącza przycisk", () => {
    h.deletePending = true;
    renderuj({ group: dzial({ thread_count: 0 }) });
    expect(przyciskKasowania()).toBeDisabled();
  });

  it("anulowanie potwierdzenia zamyka pytanie i nie wysyła żądania", () => {
    renderuj({ group: dzial({ thread_count: 0 }) });
    fireEvent.click(przyciskKasowania());
    fireEvent.click(screen.getByTestId("anuluj-potwierdzenie"));
    expect(screen.queryByTestId("potwierdzenie")).not.toBeInTheDocument();
    expect(h.deletes).toHaveLength(0);
  });

  it.each([
    ["group not empty", "adminClubs.groups.deleteNeedsTarget"],
    ["cannot delete last group", "adminClubs.groups.deleteLast"],
    ["network down", "adminClubs.saveFailed"],
  ])("odmowa „%s” mówi kluczem %s i nie zamyka dialogu", (message, key) => {
    const { onOpenChange } = renderuj({ group: dzial({ thread_count: 0 }) });
    fireEvent.click(przyciskKasowania());
    fireEvent.click(screen.getByTestId("potwierdz"));
    act(() => h.deletes[0].wynik.onError(new Error(message)));
    expect(h.toastError).toHaveBeenCalledWith(key);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("zmiana działu ZERUJE wskazany cel przeniesienia", () => {
    // Cel wskazany dla poprzedniego działu nie może zostać: to identyfikator
    // z innej listy rodzeństwa i wysłanie go skasowałoby wątki nie tam, gdzie
    // ktokolwiek chciał.
    const rodzenstwo = [
      dzial({ thread_count: 3 }),
      dzial({ id: RODZENSTWO_A, name_pl: "Analizy" }),
    ];
    const { przerysuj } = renderuj({ group: dzial({ thread_count: 3 }), siblings: rodzenstwo });
    fireEvent.change(screen.getByTestId("cel-przeniesienia"), {
      target: { value: RODZENSTWO_A },
    });
    expect(przyciskKasowania()).toBeEnabled();

    przerysuj(dzial({ id: RODZENSTWO_B, name_pl: "Raporty", thread_count: 5 }), [
      dzial({ id: RODZENSTWO_B, thread_count: 5 }),
      dzial({ id: RODZENSTWO_A, name_pl: "Analizy" }),
    ]);

    expect(screen.getByTestId<HTMLSelectElement>("cel-przeniesienia").value).toBe("");
    expect(przyciskKasowania()).toBeDisabled();
  });
});
