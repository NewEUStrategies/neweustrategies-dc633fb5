// Katalog specjalizacji - SKLEJENIE listy, dialogu ośmiu pól i trzech mutacji.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY LISTY MAJĄ TRZY WIDOKI (w locie / awaria / pustka), a czwarty
//      to lista. Specjalizacja jest wejściem do katalogu klubów, więc „nie ma
//      żadnej” pokazane w czasie wczytywania to zaproszenie do założenia
//      duplikatu.
//   2. WPIS SYSTEMOWY I WPIS PRZYPISANY DO KLUBÓW MAJĄ ODCIĘTY KOSZ, a
//      kliknięcie NIE otwiera pytania i NIE woła mutacji. Usunięta specjalizacja
//      osierociłaby kluby - nie pokazałaby ich żadna strona.
//   3. CO IDZIE DO MUTACJI ZAPISU: adres znormalizowany (nowy wpis) albo
//      zamrożony (edycja), KOMPLET tekstów PL/EN przycięty, ikona i kolejność
//      z formularza. Asercja jest na OBIEKCIE przekazanym do `mutate`.
//   4. WALIDACJA ODRZUCA BEZ ŻĄDANIA: brak nazwy w jednym języku i adres krótszy
//      niż trzy znaki nie mają jak wyjść z tego dialogu.
//   5. ADRES PODĄŻA ZA NAZWĄ TYLKO DO PIERWSZEGO TKNIĘCIA POLA i jest
//      NORMALIZOWANY w locie - adres jest publicznym kontraktem
//      (`/club/specialization/$slug`), a nie polem tekstowym.
//   6. DANE CZĘŚCIOWE (`lead_*`, `desc_*` puste w bazie) trafiają do formularza
//      jako PUSTE POLA, a nie jako goły `null` na ekranie.
//   7. PODGLĄD STRONY PUBLICZNEJ prowadzi pod ADRES WIERSZA i otwiera się osobno
//      - administrator sprawdza stronę, nie opuszczając panelu.
//   8. ODMOWA BAZY MA DWIE DROGI: duplikat i „w użyciu” jadą zdaniem ze
//      słownika, każdy inny błąd - surowym tekstem z bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł katalogu (wersja robocza z kolumn
// NULL-owalnych, walidacja, payload, odcięcie kosza, mapowanie odmowy) - tabele
// przypadków są w `lib/clubs/__tests__/adminTaxonomyCatalog.test.ts`. (2) Molekuł
// `AdminCatalogToolbar`, `AdminCatalogListState`, `AdminCatalogRow`. (3) Normalizacji
// adresu (`clubSlugFromName` - `clubTypes.test.ts`) i katalogu ikon
// (`resolveSpecializationIcon` - `clubPureModules.test.ts`). (4) Samych hooków
// katalogu - są zamockowane na poziomie MODUŁU.
//
// Radix (Dialog, AlertDialog, Select) nie działa pod happy-dom bez pełnego
// pointer API; `Link` routera potrzebuje kontekstu routera. Wszystkie cztery są
// podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  ClubSpecializationAdminRow,
  ClubSpecializationUpsertInput,
} from "@/lib/clubs/specializationsApi";

interface Wynik<T> {
  onSuccess: (value: T) => void;
  onError: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  rows: undefined as ClubSpecializationAdminRow[] | undefined,
  isLoading: false,
  isError: false,
  listError: "permission denied for function admin_club_specializations_list",
  upsertInputs: [] as ClubSpecializationUpsertInput[],
  upsertFails: null as string | null,
  upsertPending: false,
  activeCalls: [] as { id: string; isActive: boolean }[],
  activeFails: null as string | null,
  activePending: false,
  removeIds: [] as string[],
  removeFails: null as string | null,
  removePending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
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
      data-testid="wybor-ikony"
      value={value}
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
// Atrapa Radixa: `Content` istnieje tylko przy otwartym dialogu (portal nie jest
// montowany), a dwa przyciski oddają `onOpenChange` w obie strony.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div data-testid="dialog" data-open={String(open)}>
          <button
            type="button"
            data-testid="dialog-zamknij-z-zewnatrz"
            onClick={() => onOpenChange?.(false)}
          />
          <button
            type="button"
            data-testid="dialog-otworz-z-zewnatrz"
            onClick={() => onOpenChange?.(true)}
          />
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const stan = { open: false };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div data-testid="alert" data-open={String(open)}>
          <button
            type="button"
            data-testid="alert-zamknij-z-zewnatrz"
            onClick={() => onOpenChange?.(false)}
          />
          <button
            type="button"
            data-testid="alert-otworz-z-zewnatrz"
            onClick={() => onOpenChange?.(true)}
          />
          {children}
        </div>
      );
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="alert-content">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" data-testid="alert-anuluj">
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      disabled,
      onClick,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" data-testid="alert-potwierdz" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});
vi.mock("@/lib/clubs/useClubSpecializations", () => ({
  useAdminClubSpecializations: () => ({
    data: h.rows,
    isLoading: h.isLoading,
    isError: h.isError,
    error: new Error(h.listError),
  }),
  useUpsertClubSpecialization: () => ({
    mutate: (input: ClubSpecializationUpsertInput, wynik: Wynik<string>) => {
      h.upsertInputs.push(input);
      if (h.upsertFails === null) wynik.onSuccess("spec-nowa");
      else wynik.onError(new Error(h.upsertFails));
    },
    isPending: h.upsertPending,
  }),
  useSetClubSpecializationActive: () => ({
    mutate: (vars: { id: string; isActive: boolean }, wynik: Wynik<boolean>) => {
      h.activeCalls.push(vars);
      if (h.activeFails === null) wynik.onSuccess(true);
      else wynik.onError(new Error(h.activeFails));
    },
    isPending: h.activePending,
  }),
  useDeleteClubSpecialization: () => ({
    mutate: (id: string, wynik: Wynik<boolean>) => {
      h.removeIds.push(id);
      if (h.removeFails === null) wynik.onSuccess(true);
      else wynik.onError(new Error(h.removeFails));
    },
    isPending: h.removePending,
  }),
}));

import { ClubSpecializationsManager } from "@/components/admin/clubs/organisms/ClubSpecializationsManager";
import { clubSpecializationAdminRow } from "@/test/clubs/catalogFixtures";

function panel() {
  return render(<ClubSpecializationsManager />);
}

function trzySpecjalizacje(): ClubSpecializationAdminRow[] {
  return [
    clubSpecializationAdminRow({
      id: "s1",
      slug: "energy",
      label_pl: "Energetyka",
      label_en: "Energy",
      sort_order: 40,
    }),
    clubSpecializationAdminRow({
      id: "s2",
      slug: "transport",
      label_pl: "Transport",
      label_en: "Transport",
      icon: "Ship",
      sort_order: 50,
      is_system: true,
    }),
    clubSpecializationAdminRow({
      id: "s3",
      slug: "legislation",
      label_pl: "Legislacja",
      label_en: "Legislation",
      icon: "Scale",
      sort_order: 60,
      is_active: false,
      clubs_count: 3,
    }),
  ];
}

function dialog(): HTMLElement {
  return screen.getByTestId("dialog-content");
}

function pole(klucz: string): HTMLElement {
  return within(dialog()).getByLabelText(klucz);
}

function wiersz(nazwa: string): HTMLElement {
  const element = screen.getByText(nazwa).closest("li");
  if (element === null) throw new Error(`brak wiersza ${nazwa}`);
  return element;
}

function otwórzDodawanie(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminClubs.specializations.add" }));
}

function otwórzEdycję(nazwa: string): void {
  fireEvent.click(
    within(wiersz(nazwa)).getByRole("button", { name: "adminClubs.specializations.edit" }),
  );
}

function zapisz(): void {
  fireEvent.click(
    within(dialog()).getByRole("button", { name: "adminClubs.specializations.save" }),
  );
}

/** Wypełnia oba pola nazwy - bez nich walidacja nie puszcza dalej. */
function wpiszNazwy(pl: string, en: string): void {
  fireEvent.change(pole("adminClubs.specializations.labelPl"), { target: { value: pl } });
  fireEvent.change(pole("adminClubs.specializations.labelEn"), { target: { value: en } });
}

beforeEach(() => {
  h.rows = trzySpecjalizacje();
  h.isLoading = false;
  h.isError = false;
  h.upsertInputs = [];
  h.upsertFails = null;
  h.upsertPending = false;
  h.activeCalls = [];
  h.activeFails = null;
  h.activePending = false;
  h.removeIds = [];
  h.removeFails = null;
  h.removePending = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("trzy stany listy katalogu", () => {
  it("zapytanie W LOCIE pokazuje postęp, a nie komunikat pustki", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText("adminClubs.specializations.loading")).toBeTruthy();
    expect(screen.queryByText("adminClubs.specializations.empty")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("AWARIA pokazuje treść z bazy, a nie pustkę", () => {
    h.isError = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(h.listError)).toBeTruthy();
    expect(screen.queryByText("adminClubs.specializations.empty")).toBeNull();
  });

  it("pusty katalog mówi to wprost, a licznik pokazuje zero z zera", () => {
    h.rows = [];
    panel();

    expect(screen.getByText("adminClubs.specializations.empty")).toBeTruthy();
    expect(
      screen.getByText("adminClubs.specializations.activeSummary(active=0,total=0)"),
    ).toBeTruthy();
  });

  it("dane PEŁNE rysują wiersz na specjalizację, znaczniki i licznik", () => {
    panel();

    expect(screen.queryAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getByText("adminClubs.specializations.activeSummary(active=2,total=3)"),
    ).toBeTruthy();
    expect(screen.getByText("adminClubs.specializations.system")).toBeTruthy();
    expect(screen.getByText("adminClubs.specializations.disabled")).toBeTruthy();
    expect(wiersz("Legislacja").textContent).toContain("adminClubs.specializations.usage(clubs=3)");
  });

  it("dane CZĘŚCIOWE: puste kolumny opisowe nie wyciekają jako `null` na ekran", () => {
    h.rows = [
      clubSpecializationAdminRow({ lead_pl: null, lead_en: null, desc_pl: null, desc_en: null }),
    ];
    const { container } = panel();

    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });

  it("PODGLĄD prowadzi pod adres wiersza i otwiera się osobno", () => {
    panel();

    const podgląd = within(wiersz("Energetyka")).getByRole("link", {
      name: "adminClubs.specializations.preview",
    });

    expect(podgląd.getAttribute("href")).toBe("/club/specialization/energy");
    expect(podgląd.getAttribute("target")).toBe("_blank");
  });
});

describe("odcięcie kosza jest regułą danych", () => {
  it("specjalizacja SYSTEMOWA ma kosz nieaktywny i nie otwiera pytania", () => {
    panel();
    const kosz = within(wiersz("Transport")).getByRole("button", {
      name: "adminClubs.specializations.delete",
    });

    expect(kosz.hasAttribute("disabled")).toBe(true);
    fireEvent.click(kosz);

    expect(screen.queryByTestId("alert-content")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  it("specjalizacja PRZYPISANA DO KLUBÓW ma kosz nieaktywny", () => {
    panel();

    expect(
      within(wiersz("Legislacja"))
        .getByRole("button", { name: "adminClubs.specializations.delete" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("specjalizacja bez klubów pyta o potwierdzenie, a potem kasuje", () => {
    panel();

    fireEvent.click(
      within(wiersz("Energetyka")).getByRole("button", {
        name: "adminClubs.specializations.delete",
      }),
    );
    expect(screen.getByText("adminClubs.specializations.deleteBody")).toBeTruthy();

    fireEvent.click(screen.getByTestId("alert-potwierdz"));

    expect(h.removeIds).toEqual(["s1"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.specializations.deleted");
    expect(screen.queryByTestId("alert-content")).toBeNull();
  });

  it("odmowa „w użyciu” jedzie ZDANIEM ze słownika, każda inna surowym tekstem", () => {
    h.removeFails = "specialization_in_use";
    panel();
    fireEvent.click(
      within(wiersz("Energetyka")).getByRole("button", {
        name: "adminClubs.specializations.delete",
      }),
    );
    fireEvent.click(screen.getByTestId("alert-potwierdz"));
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.specializations.errors.inUse");

    h.removeFails = "deadlock detected";
    fireEvent.click(screen.getByTestId("alert-potwierdz"));
    expect(h.toastError).toHaveBeenCalledWith("deadlock detected");
  });

  it("zamknięcie pytania z zewnątrz porzuca wybraną specjalizację", () => {
    h.removePending = true;
    panel();
    fireEvent.click(
      within(wiersz("Energetyka")).getByRole("button", {
        name: "adminClubs.specializations.delete",
      }),
    );
    expect(screen.getByTestId("alert-potwierdz").hasAttribute("disabled")).toBe(true);

    // Otwarcie z zewnątrz nie ma czego zmienić - pytanie już stoi.
    fireEvent.click(screen.getByTestId("alert-otworz-z-zewnatrz"));
    expect(screen.getByTestId("alert-content")).toBeTruthy();

    fireEvent.click(screen.getByTestId("alert-zamknij-z-zewnatrz"));

    expect(screen.queryByTestId("alert-content")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });
});

describe("przełącznik wiersza", () => {
  it("wysyła NOWĄ wartość dla właściwej specjalizacji", () => {
    panel();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "adminClubs.specializations.toggleAria(name=Legislacja)",
      }),
    );

    expect(h.activeCalls).toEqual([{ id: "s3", isActive: true }]);
  });

  it("AWARIA przełączenia mówi treścią z bazy", () => {
    h.activeFails = "row level security violation";
    panel();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "adminClubs.specializations.toggleAria(name=Energetyka)",
      }),
    );

    expect(h.activeCalls).toEqual([{ id: "s1", isActive: false }]);
    expect(h.toastError).toHaveBeenCalledWith("row level security violation");
  });

  it("trwający zapis blokuje wszystkie przełączniki listy", () => {
    h.activePending = true;
    panel();

    for (const przełącznik of screen.getAllByRole("switch")) {
      expect(przełącznik.hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("dodanie specjalizacji", () => {
  it("dialog jest zamknięty, dopóki nikt nie kliknie dodania", () => {
    panel();

    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });

  it("nowy wpis startuje z kolejnością z OSTATNIEGO wiersza i domyślną ikoną", () => {
    panel();
    otwórzDodawanie();

    expect(screen.getByText("adminClubs.specializations.dialogCreate")).toBeTruthy();
    expect((pole("adminClubs.specializations.order") as HTMLInputElement).value).toBe("70");
    expect((screen.getByTestId("wybor-ikony") as HTMLSelectElement).value).toBe("Globe2");
  });

  it("adres PODĄŻA za nazwą polską, a KOMPLET tekstów jedzie przycięty", () => {
    panel();
    otwórzDodawanie();

    wpiszNazwy("  Transport morski  ", "  Maritime  ");
    expect((pole("adminClubs.specializations.slug") as HTMLInputElement).value).toBe(
      "transport-morski",
    );

    fireEvent.change(pole("adminClubs.specializations.leadPl"), {
      target: { value: "  Zajawka  " },
    });
    fireEvent.change(pole("adminClubs.specializations.leadEn"), { target: { value: "  Lead  " } });
    fireEvent.change(pole("adminClubs.specializations.descPl"), { target: { value: "  Opis  " } });
    fireEvent.change(pole("adminClubs.specializations.descEn"), { target: { value: "  Desc  " } });
    fireEvent.change(screen.getByTestId("wybor-ikony"), { target: { value: "Ship" } });
    fireEvent.change(pole("adminClubs.specializations.order"), { target: { value: "15" } });
    zapisz();

    expect(h.upsertInputs).toEqual([
      {
        id: null,
        slug: "transport-morski",
        key: "transport-morski",
        labelPl: "Transport morski",
        labelEn: "Maritime",
        leadPl: "Zajawka",
        leadEn: "Lead",
        descPl: "Opis",
        descEn: "Desc",
        icon: "Ship",
        sortOrder: 15,
        isActive: true,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.specializations.saved");
    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });

  it("adres TKNIĘTY ręcznie przestaje podążać za nazwą i jest NORMALIZOWANY w locie", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.specializations.slug"), {
      target: { value: "Własny Adres!" },
    });
    expect((pole("adminClubs.specializations.slug") as HTMLInputElement).value).toBe(
      "wlasny-adres",
    );

    wpiszNazwy("Energetyka", "Energy");
    zapisz();

    expect(h.upsertInputs[0].slug).toBe("wlasny-adres");
  });

  it("przełącznik aktywności i treść niebędąca liczbą w kolejności jadą z formularza", () => {
    panel();
    otwórzDodawanie();

    wpiszNazwy("Energetyka", "Energy");
    fireEvent.change(pole("adminClubs.specializations.order"), { target: { value: "abc" } });
    fireEvent.click(within(dialog()).getByRole("switch"));
    zapisz();

    expect(h.upsertInputs[0]).toMatchObject({ sortOrder: 0, isActive: false });
  });

  it("otwarcie dodawania po edycji CZYŚCI formularz", () => {
    panel();
    otwórzEdycję("Energetyka");
    expect((pole("adminClubs.specializations.labelPl") as HTMLInputElement).value).toBe(
      "Energetyka",
    );

    fireEvent.click(screen.getByTestId("dialog-zamknij-z-zewnatrz"));
    otwórzDodawanie();

    expect((pole("adminClubs.specializations.labelPl") as HTMLInputElement).value).toBe("");
    expect((pole("adminClubs.specializations.slug") as HTMLInputElement).value).toBe("");
  });

  it("otwarcie dialogu z zewnątrz nie tworzy wersji roboczej z niczego", () => {
    panel();

    fireEvent.click(screen.getByTestId("dialog-otworz-z-zewnatrz"));

    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });
});

describe("walidacja nie wypuszcza żądania", () => {
  it("brak nazwy angielskiej odrzuca zapis bez wołania mutacji", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.specializations.labelPl"), {
      target: { value: "Energetyka" },
    });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.specializations.errors.labels");
    expect(h.upsertInputs).toEqual([]);
    expect(screen.getByTestId("dialog-content")).toBeTruthy();
  });

  it("adres krótszy niż trzy znaki odrzuca zapis nowego wpisu", () => {
    panel();
    otwórzDodawanie();

    wpiszNazwy("Energetyka", "Energy");
    fireEvent.change(pole("adminClubs.specializations.slug"), { target: { value: "ab" } });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.specializations.errors.slug");
    expect(h.upsertInputs).toEqual([]);
  });
});

describe("edycja specjalizacji", () => {
  it("dialog startuje z KOMPLETEM wartości wiersza", () => {
    panel();
    otwórzEdycję("Legislacja");

    expect(screen.getByText("adminClubs.specializations.dialogEdit")).toBeTruthy();
    expect((pole("adminClubs.specializations.labelEn") as HTMLInputElement).value).toBe(
      "Legislation",
    );
    expect((pole("adminClubs.specializations.leadPl") as HTMLTextAreaElement).value).toBe(
      "Rynek energii w Unii",
    );
    expect((screen.getByTestId("wybor-ikony") as HTMLSelectElement).value).toBe("Scale");
  });

  it("dane CZĘŚCIOWE z bazy dają PUSTE pola, a nie pole niesterowane", () => {
    h.rows = [
      clubSpecializationAdminRow({
        id: "s9",
        label_pl: "Kultura",
        lead_pl: null,
        lead_en: null,
        desc_pl: null,
        desc_en: null,
      }),
    ];
    panel();
    otwórzEdycję("Kultura");

    expect((pole("adminClubs.specializations.leadPl") as HTMLTextAreaElement).value).toBe("");
    expect((pole("adminClubs.specializations.descEn") as HTMLTextAreaElement).value).toBe("");
  });

  it("zmiana nazwy NIE rusza adresu i jedzie z identyfikatorem wiersza", () => {
    panel();
    otwórzEdycję("Legislacja");

    fireEvent.change(pole("adminClubs.specializations.labelPl"), {
      target: { value: "Legislacja i prawo" },
    });
    zapisz();

    expect(h.upsertInputs[0]).toMatchObject({
      id: "s3",
      slug: "legislation",
      key: "legislation",
      labelPl: "Legislacja i prawo",
      isActive: false,
    });
  });
});

describe("odmowa zapisu", () => {
  it("duplikat adresu jedzie ZDANIEM ze słownika, a dialog zostaje z treścią", () => {
    h.upsertFails = 'duplicate key value violates unique constraint "club_specializations_slug"';
    panel();
    otwórzDodawanie();

    wpiszNazwy("Energetyka", "Energy");
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.specializations.errors.duplicate");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect((pole("adminClubs.specializations.labelPl") as HTMLInputElement).value).toBe(
      "Energetyka",
    );
  });

  it("każda inna odmowa jedzie SUROWYM tekstem z bazy", () => {
    h.upsertFails = "permission denied for function admin_club_specialization_upsert";
    panel();
    otwórzDodawanie();

    wpiszNazwy("Energetyka", "Energy");
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith(
      "permission denied for function admin_club_specialization_upsert",
    );
  });

  it("trwający zapis blokuje przycisk i pokazuje wskaźnik postępu", () => {
    h.upsertPending = true;
    panel();
    otwórzDodawanie();

    expect(
      within(dialog())
        .getByRole("button", { name: "adminClubs.specializations.save" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(dialog().querySelector(".animate-spin")).toBeTruthy();
  });

  it("anulowanie zamyka dialog bez żądania", () => {
    panel();
    otwórzDodawanie();

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "adminClubs.specializations.cancel" }),
    );

    expect(screen.queryByTestId("dialog-content")).toBeNull();
    expect(h.upsertInputs).toEqual([]);
  });
});
